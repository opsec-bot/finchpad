// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FinchLocker} from "../src/FinchLocker.sol";
import {ClaimKind} from "../src/interfaces/IFinchLockerControl.sol";
import {MockERC20, MockPositionManager} from "./mocks/Mocks.sol";

contract FinchLockerTest is Test {
    FinchLocker locker;
    MockPositionManager pm;
    MockERC20 token;
    MockERC20 weth;

    address factory = makeAddr("factory");
    address registry = makeAddr("registry");
    address protocol = makeAddr("protocol");
    address admin = makeAddr("admin");
    address creator = makeAddr("creator");

    uint256 constant POSITION_ID = 42;
    uint16 constant PROTOCOL_BPS = 2000; // 20% to protocol, 80% to creator
    uint256 constant GITHUB_ID = 1307535933;

    function setUp() public {
        pm = new MockPositionManager();
        weth = new MockERC20("Wrapped Ether", "WETH");
        token = new MockERC20("Token", "TKN");

        // Base fixture uses no referral / no graduation bonus so existing split assertions
        // are exact; the referral and graduation tests spin up their own locker.
        locker = new FinchLocker(factory, address(pm), address(weth), protocol, admin, 0, 0, type(uint256).max);
        vm.prank(admin);
        locker.setRegistry(registry);

        bool tokenIsToken0 = address(token) < address(weth);
        vm.prank(factory);
        locker.registerLaunch(
            address(token), POSITION_ID, PROTOCOL_BPS, tokenIsToken0, creator, ClaimKind.None, 0, address(0)
        );
    }

    // Registers a second token bound to a GitHub identity and queues `tokenFees` for collect.
    function _githubLaunch(ClaimKind kind) internal returns (MockERC20 gh) {
        gh = new MockERC20("Gh", "GH");
        bool ghIsToken0 = address(gh) < address(weth);
        vm.prank(factory);
        locker.registerLaunch(address(gh), 7, PROTOCOL_BPS, ghIsToken0, creator, kind, GITHUB_ID, address(0));
    }

    function _queueFees(MockERC20 tok, uint256 tokenFees, uint256 wethFees) internal {
        tok.mint(address(pm), tokenFees);
        weth.mint(address(pm), wethFees);
        bool isToken0 = address(tok) < address(weth);
        (address t0, address t1, uint256 a0, uint256 a1) = isToken0
            ? (address(tok), address(weth), tokenFees, wethFees)
            : (address(weth), address(tok), wethFees, tokenFees);
        pm.setCollectReturns(t0, t1, a0, a1);
    }

    function test_registerLaunch_onlyFactory() public {
        vm.expectRevert(FinchLocker.NotFactory.selector);
        locker.registerLaunch(address(0x1), 1, 1000, true, creator, ClaimKind.None, 0, address(0));
    }

    function test_registerLaunch_noDoubleRegister() public {
        vm.prank(factory);
        vm.expectRevert(FinchLocker.AlreadyRegistered.selector);
        locker.registerLaunch(address(token), 1, 1000, true, creator, ClaimKind.None, 0, address(0));
    }

    function test_registerLaunch_validatesGithubBinding() public {
        // github kind requires a nonzero id
        vm.prank(factory);
        vm.expectRevert(FinchLocker.InvalidGithubBinding.selector);
        locker.registerLaunch(address(0x2), 1, 1000, true, creator, ClaimKind.Repo, 0, address(0));
        // and a plain launch must not smuggle one in
        vm.prank(factory);
        vm.expectRevert(FinchLocker.InvalidGithubBinding.selector);
        locker.registerLaunch(address(0x2), 1, 1000, true, creator, ClaimKind.None, GITHUB_ID, address(0));
    }

    function test_setRegistry_onceOnly() public {
        vm.prank(admin);
        vm.expectRevert(FinchLocker.AlreadyRegistered.selector);
        locker.setRegistry(makeAddr("other"));
    }

    function test_setControl_onlyRegistry() public {
        vm.expectRevert(FinchLocker.NotRegistry.selector);
        locker.setControl(address(token), creator, creator);

        vm.prank(registry);
        locker.setControl(address(token), creator, makeAddr("newWallet"));
        assertEq(locker.feeWalletOf(address(token)), makeAddr("newWallet"));
        assertEq(locker.controllerOf(address(token)), creator);
    }

    function test_collect_splitsFeesPerSnapshot() public {
        // 1000 TKN and 10 WETH of fees earned
        uint256 tokenFees = 1000e18;
        uint256 wethFees = 10e18;
        _queueFees(token, tokenFees, wethFees);

        locker.collect(address(token));

        // creator (feeWallet) gets 80%, protocol gets 20%
        assertEq(token.balanceOf(creator), (tokenFees * 8000) / 10000);
        assertEq(weth.balanceOf(creator), (wethFees * 8000) / 10000);
        assertEq(token.balanceOf(protocol), (tokenFees * 2000) / 10000);
        assertEq(weth.balanceOf(protocol), (wethFees * 2000) / 10000);
    }

    function test_collect_respectsRedirect() public {
        address newWallet = makeAddr("redirected");
        vm.prank(registry);
        locker.setControl(address(token), creator, newWallet);

        uint256 tokenFees = 500e18;
        _queueFees(token, tokenFees, 0);

        locker.collect(address(token));

        assertEq(token.balanceOf(newWallet), (tokenFees * 8000) / 10000);
        assertEq(token.balanceOf(creator), 0);
    }

    function test_collect_unknownTokenReverts() public {
        vm.expectRevert(FinchLocker.UnknownToken.selector);
        locker.collect(address(0xdead));
    }

    // --- github escrow lifecycle ---

    function test_githubLaunch_launcherGetsNoFeeRights() public {
        MockERC20 gh = _githubLaunch(ClaimKind.User);
        assertEq(locker.controllerOf(address(gh)), address(0));
        assertEq(locker.feeWalletOf(address(gh)), address(0));
        (ClaimKind kind, uint256 id, bool claimed) = locker.githubBindingOf(address(gh));
        assertEq(uint8(kind), uint8(ClaimKind.User));
        assertEq(id, GITHUB_ID);
        assertFalse(claimed);
    }

    function test_collect_escrowsCreatorShareWhileUnclaimed() public {
        MockERC20 gh = _githubLaunch(ClaimKind.Repo);
        uint256 tokenFees = 1000e18;
        uint256 wethFees = 10e18;
        _queueFees(gh, tokenFees, wethFees);

        locker.collect(address(gh));

        // creator share held in the locker, protocol share paid out as usual
        (uint256 escT, uint256 escW,) = locker.escrowOf(address(gh));
        assertEq(escT, (tokenFees * 8000) / 10000);
        assertEq(escW, (wethFees * 8000) / 10000);
        assertEq(gh.balanceOf(address(locker)), escT);
        assertEq(weth.balanceOf(address(locker)), escW);
        assertEq(gh.balanceOf(protocol), (tokenFees * 2000) / 10000);
        assertEq(gh.balanceOf(creator), 0, "launcher must earn nothing pre-claim");
    }

    function test_setControl_blockedWhileGithubUnclaimed() public {
        MockERC20 gh = _githubLaunch(ClaimKind.Repo);
        vm.prank(registry);
        vm.expectRevert(FinchLocker.GithubUnclaimed.selector);
        locker.setControl(address(gh), creator, creator);
    }

    function test_settleGithubClaim_paysEscrowAndHandsOverControl() public {
        MockERC20 gh = _githubLaunch(ClaimKind.User);
        _queueFees(gh, 1000e18, 10e18);
        locker.collect(address(gh));

        address claimant = makeAddr("ghCreator");
        vm.prank(registry);
        locker.settleGithubClaim(address(gh), claimant);

        assertEq(gh.balanceOf(claimant), 800e18, "escrow backlog paid on claim");
        assertEq(weth.balanceOf(claimant), 8e18);
        assertEq(locker.controllerOf(address(gh)), claimant);
        assertEq(locker.feeWalletOf(address(gh)), claimant);
        (uint256 escT, uint256 escW,) = locker.escrowOf(address(gh));
        assertEq(escT + escW, 0, "escrow drained");

        // second settle must fail
        vm.prank(registry);
        vm.expectRevert(FinchLocker.AlreadyClaimed.selector);
        locker.settleGithubClaim(address(gh), claimant);

        // post-claim fees flow directly to the claimant
        _queueFees(gh, 100e18, 0);
        locker.collect(address(gh));
        assertEq(gh.balanceOf(claimant), 800e18 + 80e18);
    }

    function test_settleGithubClaim_onlyRegistry_andOnlyGithubLaunches() public {
        MockERC20 gh = _githubLaunch(ClaimKind.Repo);
        vm.expectRevert(FinchLocker.NotRegistry.selector);
        locker.settleGithubClaim(address(gh), creator);

        vm.prank(registry);
        vm.expectRevert(FinchLocker.NotGithubLaunch.selector);
        locker.settleGithubClaim(address(token), creator);
    }

    function test_sweepEscrow_onlyAfterExpiry_thenToProtocol() public {
        MockERC20 gh = _githubLaunch(ClaimKind.Repo);
        _queueFees(gh, 1000e18, 10e18);
        locker.collect(address(gh));

        vm.expectRevert(FinchLocker.EscrowNotExpired.selector);
        locker.sweepEscrow(address(gh));

        vm.warp(block.timestamp + 365 days + 1);
        uint256 protocolBefore = gh.balanceOf(protocol);
        locker.sweepEscrow(address(gh)); // anyone may call
        assertEq(gh.balanceOf(protocol) - protocolBefore, 800e18, "escrow swept to protocol");
        assertEq(weth.balanceOf(protocol), 2e18 + 8e18);

        vm.expectRevert(FinchLocker.NothingToSweep.selector);
        locker.sweepEscrow(address(gh));
    }

    function test_collect_afterExpiryUnclaimed_creatorShareToProtocol() public {
        MockERC20 gh = _githubLaunch(ClaimKind.User);
        vm.warp(block.timestamp + 365 days + 1);
        _queueFees(gh, 1000e18, 0);
        locker.collect(address(gh));
        assertEq(gh.balanceOf(protocol), 1000e18, "entire collect to protocol after expiry");
        (uint256 escT,,) = locker.escrowOf(address(gh));
        assertEq(escT, 0, "nothing new escrows after expiry");
    }

    function test_claimStillPossibleAfterExpiry() public {
        MockERC20 gh = _githubLaunch(ClaimKind.User);
        _queueFees(gh, 1000e18, 0);
        locker.collect(address(gh));
        vm.warp(block.timestamp + 365 days + 1);

        address claimant = makeAddr("lateCreator");
        vm.prank(registry);
        locker.settleGithubClaim(address(gh), claimant);
        // unswept escrow still goes to the late claimant; control transfers
        assertEq(gh.balanceOf(claimant), 800e18);
        assertEq(locker.feeWalletOf(address(gh)), claimant);
    }

    function test_ctoAllowedAfterExpiryUnclaimed() public {
        MockERC20 gh = _githubLaunch(ClaimKind.Repo);
        vm.warp(block.timestamp + 365 days + 1);
        address community = makeAddr("community");
        vm.prank(registry);
        locker.setControl(address(gh), community, community);
        // post-expiry CTO wallet now receives the creator share — and FeesCollected must
        // report the real creator payout, not zero (indexers bill off this event)
        _queueFees(gh, 100e18, 0);
        vm.expectEmit(true, false, false, true);
        emit FinchLocker.FeesCollected(address(gh), 80e18, 0, 20e18, 0);
        locker.collect(address(gh));
        assertEq(gh.balanceOf(community), 80e18);
    }

    // --- referral ---

    // A locker with a 10%-of-protocol referral rate, and a token launched with a referrer.
    function _referralLocker(address referrer) internal returns (FinchLocker refLocker, MockERC20 tok) {
        refLocker = new FinchLocker(factory, address(pm), address(weth), protocol, admin, 1000, 0, type(uint256).max);
        vm.prank(admin);
        refLocker.setRegistry(registry);
        tok = new MockERC20("Ref", "REF");
        bool isToken0 = address(tok) < address(weth);
        vm.prank(factory);
        refLocker.registerLaunch(address(tok), 9, PROTOCOL_BPS, isToken0, creator, ClaimKind.None, 0, referrer);
    }

    function _queueFeesFor(MockERC20 tok, uint256 tokenFees, uint256 wethFees) internal {
        tok.mint(address(pm), tokenFees);
        weth.mint(address(pm), wethFees);
        bool isToken0 = address(tok) < address(weth);
        (address t0, address t1, uint256 a0, uint256 a1) = isToken0
            ? (address(tok), address(weth), tokenFees, wethFees)
            : (address(weth), address(tok), wethFees, tokenFees);
        pm.setCollectReturns(t0, t1, a0, a1);
    }

    function test_collect_paysReferralOutOfProtocolShare() public {
        address referrer = makeAddr("referrer");
        (FinchLocker refLocker, MockERC20 tok) = _referralLocker(referrer);

        uint256 tokenFees = 1000e18;
        uint256 wethFees = 10e18;
        _queueFeesFor(tok, tokenFees, wethFees);
        refLocker.collect(address(tok));

        // Creator still gets the full 80% — referral never touches the creator side.
        assertEq(tok.balanceOf(creator), (tokenFees * 8000) / 10000, "creator unchanged");
        assertEq(weth.balanceOf(creator), (wethFees * 8000) / 10000, "creator weth unchanged");
        // Protocol base is 20%; referrer takes 10% of THAT (=2% of the trade), protocol keeps 18%.
        uint256 protoBase = (tokenFees * 2000) / 10000;
        uint256 refCut = (protoBase * 1000) / 10000;
        assertEq(tok.balanceOf(referrer), refCut, "referrer gets 10% of protocol share");
        assertEq(tok.balanceOf(protocol), protoBase - refCut, "protocol keeps the rest");
        // Conservation: nothing created or stranded.
        assertEq(tok.balanceOf(creator) + tok.balanceOf(protocol) + tok.balanceOf(referrer), tokenFees, "conserved");
        assertEq(tok.balanceOf(address(refLocker)), 0, "no dust stranded");
    }

    function test_collect_noReferralWhenReferrerZero() public {
        (FinchLocker refLocker, MockERC20 tok) = _referralLocker(address(0));
        _queueFeesFor(tok, 1000e18, 0);
        refLocker.collect(address(tok));
        // With no referrer, the whole protocol share goes to protocol as before.
        assertEq(tok.balanceOf(protocol), (1000e18 * 2000) / 10000, "no referral carved");
    }

    // --- graduation reward (protocol-controlled accounting) ---

    uint256 constant GRAD_THRESHOLD = 1 ether; // 1 WETH of collected fees

    function _gradLocker() internal returns (FinchLocker gLocker, MockERC20 tok) {
        // graduation shifts 500 bps (5%) protocol->creator: 20% -> 15% once graduated.
        gLocker = new FinchLocker(factory, address(pm), address(weth), protocol, admin, 0, 500, GRAD_THRESHOLD);
        vm.prank(admin);
        gLocker.setRegistry(registry);
        tok = new MockERC20("Grad", "GRAD");
        bool isToken0 = address(tok) < address(weth);
        vm.prank(factory);
        gLocker.registerLaunch(address(tok), 11, PROTOCOL_BPS, isToken0, creator, ClaimKind.None, 0, address(0));
    }

    function test_graduation_derivedFromCollectedWethFees() public {
        (FinchLocker gLocker, MockERC20 tok) = _gradLocker();

        // Below the threshold: still 80/20, and the accounting tracks what we actually paid.
        _queueFeesFor(tok, 1000e18, 0.4 ether);
        gLocker.collect(address(tok));
        assertEq(tok.balanceOf(creator), 800e18, "pre-grad creator 80%");
        assertEq(tok.balanceOf(protocol), 200e18, "pre-grad protocol 20%");
        (uint256 fees, uint256 threshold, bool graduated) = gLocker.graduationOf(address(tok));
        assertEq(fees, 0.4 ether, "lifetime weth fees banked");
        assertEq(threshold, GRAD_THRESHOLD);
        assertFalse(graduated, "0.4 < 1 ether");

        // The collect that crosses the threshold emits Graduated exactly once and already
        // pays the graduated rate (state and applied rate agree).
        _queueFeesFor(tok, 1000e18, 0.6 ether);
        vm.expectEmit(true, false, false, true);
        emit FinchLocker.Graduated(address(tok), 1 ether);
        gLocker.collect(address(tok));
        (,, graduated) = gLocker.graduationOf(address(tok));
        assertTrue(graduated, "crossed the threshold");
        assertEq(tok.balanceOf(creator), 800e18 + 850e18, "graduated creator 85%");
        assertEq(tok.balanceOf(protocol), 200e18 + 150e18, "graduated protocol 15%");

        // Stays graduated, and does NOT re-emit.
        _queueFeesFor(tok, 1000e18, 0);
        gLocker.collect(address(tok));
        assertEq(tok.balanceOf(creator), 800e18 + 850e18 + 850e18, "still 85%");
    }

    /// The whole point of the rewrite: nobody can hand a token graduation without paying real
    /// swap fees. Donating WETH to the locker (or anywhere else) must not move the accounting.
    function test_graduation_notGrantedByDonation() public {
        (FinchLocker gLocker, MockERC20 tok) = _gradLocker();

        weth.mint(address(gLocker), 100 ether); // donation straight to the locker
        weth.mint(address(pm), 100 ether);
        (,, bool graduated) = gLocker.graduationOf(address(tok));
        assertFalse(graduated, "donations are not fees");

        // and a collect that yields no WETH fees still does not graduate it
        _queueFeesFor(tok, 1000e18, 0);
        gLocker.collect(address(tok));
        uint256 fees;
        (fees,, graduated) = gLocker.graduationOf(address(tok));
        assertEq(fees, 0, "no weth fees collected");
        assertFalse(graduated, "still not graduated");
    }

    function test_graduation_disabledWhenThresholdUnreachable() public {
        // The base fixture locker uses type(uint256).max — graduation can never trigger.
        _queueFees(token, 0, 5 ether);
        locker.collect(address(token));
        (,, bool graduated) = locker.graduationOf(address(token));
        assertFalse(graduated, "max threshold disables graduation");
    }
}

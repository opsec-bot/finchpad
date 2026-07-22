// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FinchLocker} from "../src/FinchLocker.sol";
import {FeeRightsRegistry} from "../src/FeeRightsRegistry.sol";
import {ClaimKind} from "../src/interfaces/IFinchLockerControl.sol";
import {MockPositionManager, MockERC20} from "./mocks/Mocks.sol";

contract FeeRightsRegistryTest is Test {
    FinchLocker locker;
    FeeRightsRegistry registry;

    address admin = makeAddr("admin");
    address creator = makeAddr("creator");
    address protocol = makeAddr("protocol");

    address signer;
    uint256 signerPk;

    // "tokens" only need to be addresses the locker has registered. (MockERC20s because
    // settling a claim transfers escrow balances, which requires real token code.)
    address plainToken; // no github binding, claims disabled
    address repoToken; // bound to a repo id
    address userToken; // bound to a user id
    uint256 constant REPO_ID = 12345;
    uint256 constant USER_ID = 67890;

    bytes32 constant TYPEHASH =
        keccak256("GithubClaim(address token,uint8 claimKind,uint256 githubId,address claimant,uint256 deadline)");

    function setUp() public {
        (signer, signerPk) = makeAddrAndKey("signer");

        MockPositionManager pm = new MockPositionManager();
        MockERC20 weth = new MockERC20("W", "W");
        // This test contract is the factory.
        locker = new FinchLocker(address(this), address(pm), address(weth), protocol, admin, 0, 0);
        vm.prank(admin);
        registry = new FeeRightsRegistry(address(locker), signer, admin);
        vm.prank(admin);
        locker.setRegistry(address(registry));

        plainToken = address(new MockERC20("P", "P"));
        repoToken = address(new MockERC20("R", "R"));
        userToken = address(new MockERC20("U", "U"));
        locker.registerLaunch(plainToken, 1, 2000, true, creator, ClaimKind.None, 0, address(0));
        locker.registerLaunch(repoToken, 2, 2000, true, creator, ClaimKind.Repo, REPO_ID, address(0));
        locker.registerLaunch(userToken, 3, 2000, true, creator, ClaimKind.User, USER_ID, address(0));
    }

    // --- controller-signed ---

    function test_redirectFees_byController() public {
        address newWallet = makeAddr("newWallet");
        vm.prank(creator);
        registry.redirectFees(plainToken, newWallet);
        assertEq(locker.feeWalletOf(plainToken), newWallet);
        assertEq(locker.controllerOf(plainToken), creator); // control unchanged
    }

    function test_redirectFees_notControllerReverts() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(FeeRightsRegistry.NotController.selector);
        registry.redirectFees(plainToken, makeAddr("x"));
    }

    function test_handoff_movesControl() public {
        address successor = makeAddr("successor");
        vm.prank(creator);
        registry.handoff(plainToken, successor);
        assertEq(locker.controllerOf(plainToken), successor);

        // old creator can no longer act
        vm.prank(creator);
        vm.expectRevert(FeeRightsRegistry.NotController.selector);
        registry.redirectFees(plainToken, creator);
    }

    // --- admin CTO ---

    function test_approveCTO_byOwner() public {
        address community = makeAddr("community");
        vm.prank(admin);
        registry.approveCTO(plainToken, community);
        assertEq(locker.controllerOf(plainToken), community);
        assertEq(locker.feeWalletOf(plainToken), community);
    }

    function test_approveCTO_notOwnerReverts() public {
        vm.prank(creator);
        vm.expectRevert();
        registry.approveCTO(plainToken, makeAddr("x"));
    }

    // --- github claim ---

    function _sign(address token, ClaimKind kind, uint256 githubId, address claimant, uint256 deadline, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("finchpad")),
                keccak256(bytes("1")),
                block.chainid,
                address(registry)
            )
        );
        bytes32 structHash = keccak256(abi.encode(TYPEHASH, token, kind, githubId, claimant, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_claimGithub_repoHappyPath() public {
        address claimant = makeAddr("repoOwner");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(repoToken, ClaimKind.Repo, REPO_ID, claimant, deadline, signerPk);

        vm.prank(claimant);
        registry.claimGithub(repoToken, ClaimKind.Repo, REPO_ID, deadline, sig);

        assertEq(locker.controllerOf(repoToken), claimant);
        assertEq(locker.feeWalletOf(repoToken), claimant);
    }

    function test_claimGithub_userHappyPath() public {
        address claimant = makeAddr("ghUser");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(userToken, ClaimKind.User, USER_ID, claimant, deadline, signerPk);

        vm.prank(claimant);
        registry.claimGithub(userToken, ClaimKind.User, USER_ID, deadline, sig);

        assertEq(locker.controllerOf(userToken), claimant);
        (,, bool claimed) = locker.githubBindingOf(userToken);
        assertTrue(claimed);
    }

    function test_claimGithub_disabledForPlainToken() public {
        address claimant = makeAddr("repoOwner");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(plainToken, ClaimKind.None, 0, claimant, deadline, signerPk);
        vm.prank(claimant);
        vm.expectRevert(FeeRightsRegistry.GithubDisabled.selector);
        registry.claimGithub(plainToken, ClaimKind.None, 0, deadline, sig);
    }

    function test_claimGithub_idMismatchReverts() public {
        address claimant = makeAddr("repoOwner");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(repoToken, ClaimKind.Repo, 99999, claimant, deadline, signerPk);
        vm.prank(claimant);
        vm.expectRevert(FeeRightsRegistry.BindingMismatch.selector);
        registry.claimGithub(repoToken, ClaimKind.Repo, 99999, deadline, sig);
    }

    function test_claimGithub_kindMismatchReverts() public {
        // a signature for user id N must not claim a token bound to repo id N
        address claimant = makeAddr("tricky");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(repoToken, ClaimKind.User, REPO_ID, claimant, deadline, signerPk);
        vm.prank(claimant);
        vm.expectRevert(FeeRightsRegistry.BindingMismatch.selector);
        registry.claimGithub(repoToken, ClaimKind.User, REPO_ID, deadline, sig);
    }

    function test_claimGithub_secondClaimReverts() public {
        address claimant = makeAddr("repoOwner");
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(claimant);
        registry.claimGithub(
            repoToken, ClaimKind.Repo, REPO_ID, deadline, _sign(repoToken, ClaimKind.Repo, REPO_ID, claimant, deadline, signerPk)
        );

        // even a fresh, validly-signed claim for another wallet must fail once claimed
        address second = makeAddr("secondAdmin");
        vm.prank(second);
        vm.expectRevert(FeeRightsRegistry.AlreadyClaimed.selector);
        registry.claimGithub(
            repoToken, ClaimKind.Repo, REPO_ID, deadline, _sign(repoToken, ClaimKind.Repo, REPO_ID, second, deadline, signerPk)
        );
    }

    function test_claimGithub_expiredReverts() public {
        address claimant = makeAddr("repoOwner");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(repoToken, ClaimKind.Repo, REPO_ID, claimant, deadline, signerPk);
        vm.warp(deadline + 1);
        vm.prank(claimant);
        vm.expectRevert(FeeRightsRegistry.ClaimExpired.selector);
        registry.claimGithub(repoToken, ClaimKind.Repo, REPO_ID, deadline, sig);
    }

    function test_claimGithub_replayReverts() public {
        address claimant = makeAddr("repoOwner");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(repoToken, ClaimKind.Repo, REPO_ID, claimant, deadline, signerPk);
        vm.prank(claimant);
        registry.claimGithub(repoToken, ClaimKind.Repo, REPO_ID, deadline, sig);
        // second time, same signature (AlreadyClaimed fires before the digest check)
        vm.prank(claimant);
        vm.expectRevert(FeeRightsRegistry.AlreadyClaimed.selector);
        registry.claimGithub(repoToken, ClaimKind.Repo, REPO_ID, deadline, sig);
    }

    function test_claimGithub_badSignerReverts() public {
        (, uint256 wrongPk) = makeAddrAndKey("attacker");
        address claimant = makeAddr("repoOwner");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(repoToken, ClaimKind.Repo, REPO_ID, claimant, deadline, wrongPk);
        vm.prank(claimant);
        vm.expectRevert(FeeRightsRegistry.BadSignature.selector);
        registry.claimGithub(repoToken, ClaimKind.Repo, REPO_ID, deadline, sig);
    }

    function test_claimGithub_wrongClaimantReverts() public {
        // signature bound to `claimant`, but a different caller submits it
        address claimant = makeAddr("repoOwner");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(repoToken, ClaimKind.Repo, REPO_ID, claimant, deadline, signerPk);
        vm.prank(makeAddr("thief"));
        vm.expectRevert(FeeRightsRegistry.BadSignature.selector);
        registry.claimGithub(repoToken, ClaimKind.Repo, REPO_ID, deadline, sig);
    }
}

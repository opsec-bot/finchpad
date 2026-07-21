// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FinchLocker} from "../src/FinchLocker.sol";
import {FinchLock} from "../src/FinchLock.sol";
import {MockERC20, MockPositionManager} from "./mocks/Mocks.sol";

/// Property tests over the two money-handling paths: fee splitting and vesting.
/// These target the failure modes unit tests miss — rounding drift, overflow at the
/// boundaries, and non-monotonic release schedules.
contract FuzzTest is Test {
    FinchLocker locker;
    FinchLock vault;
    MockPositionManager pm;
    MockERC20 token;
    MockERC20 weth;

    address factory = makeAddr("factory");
    address registry = makeAddr("registry");
    address protocol = makeAddr("protocol");
    address admin = makeAddr("admin");
    address creator = makeAddr("creator");

    function setUp() public {
        pm = new MockPositionManager();
        weth = new MockERC20("W", "W");
        token = new MockERC20("T", "T");
        locker = new FinchLocker(factory, address(pm), address(weth), protocol, admin);
        vm.prank(admin);
        locker.setRegistry(registry);
        vault = new FinchLock();
    }

    // --- fee splitting -------------------------------------------------------------------

    /// Every wei collected must land with either the creator or the protocol. None created,
    /// none destroyed, none stranded in the locker.
    function testFuzz_feeSplitConservesEveryWei(uint128 tokenFees, uint128 wethFees, uint16 protocolBps) public {
        protocolBps = uint16(bound(protocolBps, 0, 10_000));

        address t = address(uint160(uint256(keccak256(abi.encode(tokenFees, wethFees, protocolBps)))));
        bool tokenIsToken0 = address(token) < address(weth);
        vm.prank(factory);
        locker.registerLaunch(address(token), 1, protocolBps, tokenIsToken0, creator, 0);

        token.mint(address(pm), tokenFees);
        weth.mint(address(pm), wethFees);
        (address t0, address t1, uint256 a0, uint256 a1) = tokenIsToken0
            ? (address(token), address(weth), uint256(tokenFees), uint256(wethFees))
            : (address(weth), address(token), uint256(wethFees), uint256(tokenFees));
        pm.setCollectReturns(t0, t1, a0, a1);

        locker.collect(address(token));

        assertEq(
            token.balanceOf(creator) + token.balanceOf(protocol), uint256(tokenFees), "token fees conserved"
        );
        assertEq(weth.balanceOf(creator) + weth.balanceOf(protocol), uint256(wethFees), "weth fees conserved");
        assertEq(token.balanceOf(address(locker)), 0, "no token dust stranded in locker");
        assertEq(weth.balanceOf(address(locker)), 0, "no weth dust stranded in locker");
        t; // silence unused
    }

    /// The protocol must never be able to take more than its snapshotted share.
    function testFuzz_protocolNeverExceedsItsShare(uint128 fees, uint16 protocolBps) public {
        protocolBps = uint16(bound(protocolBps, 0, 10_000));
        vm.assume(fees > 0);

        bool tokenIsToken0 = address(token) < address(weth);
        vm.prank(factory);
        locker.registerLaunch(address(token), 1, protocolBps, tokenIsToken0, creator, 0);

        token.mint(address(pm), fees);
        (address t0, address t1, uint256 a0, uint256 a1) = tokenIsToken0
            ? (address(token), address(weth), uint256(fees), uint256(0))
            : (address(weth), address(token), uint256(0), uint256(fees));
        pm.setCollectReturns(t0, t1, a0, a1);

        locker.collect(address(token));

        // Integer division favors the creator, so protocol <= ceil of its nominal share.
        uint256 nominal = (uint256(fees) * protocolBps) / 10_000;
        assertLe(token.balanceOf(protocol), nominal + 1, "protocol cannot over-take");
    }

    // --- vesting -------------------------------------------------------------------------

    function _mkLock(uint256 amount, uint64 cliff, uint64 duration) internal returns (uint256 id) {
        token.mint(creator, amount);
        vm.startPrank(creator);
        token.approve(address(vault), amount);
        id = vault.lock(address(token), creator, amount, cliff, duration);
        vm.stopPrank();
    }

    /// Vested can never exceed what was locked, at any point in time, ever.
    function testFuzz_vestedNeverExceedsLocked(uint96 amount, uint32 cliff, uint32 duration, uint64 t) public {
        amount = uint96(bound(amount, 1, type(uint96).max));
        duration = uint32(bound(duration, 1, 10 * 365 days));
        cliff = uint32(bound(cliff, 0, duration));

        uint64 start = uint64(block.timestamp);
        uint256 id = _mkLock(amount, cliff, duration);

        uint64 at = uint64(bound(t, start, start + 100 * 365 days));
        assertLe(vault.vestedAmount(id, at), amount, "vested exceeded locked");
    }

    /// Nothing is releasable before the cliff, no matter the schedule.
    function testFuzz_nothingBeforeCliff(uint96 amount, uint32 cliff, uint32 duration, uint32 offset) public {
        amount = uint96(bound(amount, 1, type(uint96).max));
        duration = uint32(bound(duration, 1, 10 * 365 days));
        cliff = uint32(bound(cliff, 1, duration));
        offset = uint32(bound(offset, 0, cliff - 1));

        uint64 start = uint64(block.timestamp);
        uint256 id = _mkLock(amount, cliff, duration);

        assertEq(vault.vestedAmount(id, start + offset), 0, "released before cliff");
    }

    /// Vesting is monotonic: time moving forward can never reduce the vested amount.
    function testFuzz_vestingIsMonotonic(uint96 amount, uint32 duration, uint64 a, uint64 b) public {
        amount = uint96(bound(amount, 1, type(uint96).max));
        duration = uint32(bound(duration, 1, 10 * 365 days));

        uint64 start = uint64(block.timestamp);
        uint256 id = _mkLock(amount, 0, duration);

        uint64 ta = uint64(bound(a, start, start + 20 * 365 days));
        uint64 tb = uint64(bound(b, ta, start + 20 * 365 days)); // tb >= ta

        assertGe(vault.vestedAmount(id, tb), vault.vestedAmount(id, ta), "vesting went backwards");
    }

    /// Fully vested always releases exactly the locked amount — no dust left behind.
    function testFuzz_fullyVestedReleasesEverything(uint96 amount, uint32 cliff, uint32 duration) public {
        amount = uint96(bound(amount, 1, type(uint96).max));
        duration = uint32(bound(duration, 1, 10 * 365 days));
        cliff = uint32(bound(cliff, 0, duration));

        uint256 id = _mkLock(amount, cliff, duration);
        vm.warp(block.timestamp + duration + 1);

        uint256 balBefore = token.balanceOf(creator);
        vault.release(id);
        assertEq(token.balanceOf(creator) - balBefore, amount, "did not release the full amount");
        assertEq(token.balanceOf(address(vault)), 0, "vault retained dust");
    }
}

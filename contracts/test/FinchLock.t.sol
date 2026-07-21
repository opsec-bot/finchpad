// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FinchLock} from "../src/FinchLock.sol";
import {MockERC20, FeeOnTransferERC20} from "./mocks/Mocks.sol";

contract FinchLockTest is Test {
    FinchLock lockContract;
    MockERC20 token;

    address creator = makeAddr("creator");
    address beneficiary = makeAddr("beneficiary");

    uint64 constant CLIFF = 30 days;
    uint64 constant DURATION = 365 days;
    uint256 constant AMOUNT = 1_000_000e18;

    function setUp() public {
        lockContract = new FinchLock();
        token = new MockERC20("Token", "TKN");
        token.mint(creator, AMOUNT);
        vm.prank(creator);
        token.approve(address(lockContract), type(uint256).max);
    }

    function _lock() internal returns (uint256 id) {
        vm.prank(creator);
        id = lockContract.lock(address(token), beneficiary, AMOUNT, CLIFF, DURATION);
    }

    function test_lock_storesActualAmount() public {
        uint256 id = _lock();
        (,, uint256 amount,,,,) = lockContract.locks(id);
        assertEq(amount, AMOUNT);
        assertEq(token.balanceOf(address(lockContract)), AMOUNT);
    }

    function test_lock_rejectsZeroAmount() public {
        vm.prank(creator);
        vm.expectRevert(FinchLock.ZeroAmount.selector);
        lockContract.lock(address(token), beneficiary, 0, CLIFF, DURATION);
    }

    function test_lock_rejectsCliffAfterDuration() public {
        vm.prank(creator);
        vm.expectRevert(FinchLock.CliffAfterDuration.selector);
        lockContract.lock(address(token), beneficiary, AMOUNT, DURATION + 1, DURATION);
    }

    function test_nothingReleasableBeforeCliff() public {
        uint256 id = _lock();
        assertEq(lockContract.releasable(id), 0);
        vm.warp(block.timestamp + CLIFF - 1);
        assertEq(lockContract.releasable(id), 0);
    }

    function test_linearAfterCliff() public {
        uint64 start = uint64(block.timestamp);
        uint256 id = _lock();

        // exactly at cliff: vested = amount * cliff/duration
        assertEq(lockContract.vestedAmount(id, start + CLIFF), (AMOUNT * CLIFF) / DURATION);
        // halfway through duration
        assertEq(lockContract.vestedAmount(id, start + DURATION / 2), AMOUNT / 2);
        // just before cliff: nothing
        assertEq(lockContract.vestedAmount(id, start + CLIFF - 1), 0);
    }

    function test_fullAfterDuration() public {
        uint256 start = block.timestamp;
        uint256 id = _lock();
        vm.warp(start + DURATION);
        assertEq(lockContract.vestedAmount(id, uint64(block.timestamp)), AMOUNT);
        vm.warp(start + DURATION + 999 days);
        assertEq(lockContract.vestedAmount(id, uint64(block.timestamp)), AMOUNT);
    }

    function test_release_transfersAndTracks() public {
        uint256 start = block.timestamp;
        uint256 id = _lock();
        vm.warp(start + DURATION / 2);

        uint256 expected = lockContract.releasable(id);
        lockContract.release(id); // anyone can call; funds go to beneficiary
        assertEq(token.balanceOf(beneficiary), expected);

        (,,, uint256 released,,,) = lockContract.locks(id);
        assertEq(released, expected);
        // immediately releasing again yields nothing
        vm.expectRevert(FinchLock.NothingToRelease.selector);
        lockContract.release(id);
    }

    function test_releasedNeverExceedsAmount() public {
        uint256 start = block.timestamp;
        uint256 id = _lock();
        vm.warp(start + DURATION / 3);
        lockContract.release(id);
        vm.warp(start + DURATION + 100 days);
        lockContract.release(id);
        assertEq(token.balanceOf(beneficiary), AMOUNT);
        assertEq(token.balanceOf(address(lockContract)), 0);
    }

    function test_feeOnTransferToken_accountedByReceived() public {
        FeeOnTransferERC20 feeToken = new FeeOnTransferERC20(500); // 5% fee
        feeToken.mint(creator, AMOUNT);
        vm.prank(creator);
        feeToken.approve(address(lockContract), type(uint256).max);

        vm.prank(creator);
        uint256 id = lockContract.lock(address(feeToken), beneficiary, AMOUNT, 0, DURATION);

        uint256 received = (AMOUNT * 9500) / 10000; // 95% arrived
        (,, uint256 amount,,,,) = lockContract.locks(id);
        assertEq(amount, received);
        assertEq(feeToken.balanceOf(address(lockContract)), received);

        // fully vest and release: contract pays out exactly what it holds for this lock
        vm.warp(block.timestamp + DURATION);
        lockContract.release(id);
        // beneficiary receives received minus the 5% transfer fee on the way out
        assertEq(feeToken.balanceOf(beneficiary), (received * 9500) / 10000);
    }
}

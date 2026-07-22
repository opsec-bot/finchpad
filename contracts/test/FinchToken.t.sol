// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {FinchToken} from "../src/FinchToken.sol";

contract FinchTokenTest is Test {
    FinchToken impl;
    FinchToken token; // the clone

    address creator = makeAddr("creator");
    address treasury = makeAddr("treasury"); // stands in for the factory/locker holding supply
    address pool = makeAddr("pool");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant SUPPLY = 1_000_000_000e18;

    function _socials() internal pure returns (FinchToken.Socials memory) {
        return FinchToken.Socials("x", "tg", "dc", "web", "fc");
    }

    function setUp() public {
        impl = new FinchToken();
        token = FinchToken(Clones.clone(address(impl)));
        // This test contract is the "factory" (msg.sender to initialize).
        token.initialize("Finch Coin", "FNCH", "logo://", "a test token", _socials(), creator, treasury);
        token.setLiquidityPool(pool);

        // Seed the pool so we can simulate buys (to==pool is a sell, unrestricted).
        vm.prank(treasury);
        token.transfer(pool, 300_000_000e18);
    }

    // --- basics ---

    function test_initialize_setsSupplyAndMetadata() public view {
        assertEq(token.name(), "Finch Coin");
        assertEq(token.symbol(), "FNCH");
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.creator(), creator);
        assertEq(token.liquidityPool(), pool);
        assertEq(token.launchBlock(), block.number);
        (string memory tw,,,,) = token.socials();
        assertEq(tw, "x");
    }

    function test_implementation_cannotBeInitialized() public {
        vm.expectRevert();
        impl.initialize("x", "x", "", "", _socials(), creator, treasury);
    }

    function test_cannotReinitialize() public {
        vm.expectRevert();
        token.initialize("x", "x", "", "", _socials(), creator, treasury);
    }

    function test_setLiquidityPool_onceOnly() public {
        vm.expectRevert(FinchToken.PoolAlreadySet.selector);
        token.setLiquidityPool(address(0xBEEF));
    }

    /// A zero pool would make _update treat protection as inactive, silently disabling the
    /// entire anti-snipe window. Must be rejected.
    function test_setLiquidityPool_rejectsZero() public {
        FinchToken t2 = FinchToken(Clones.clone(address(impl)));
        t2.initialize("t", "t", "", "", _socials(), creator, treasury);
        vm.expectRevert(FinchToken.ZeroAddress.selector);
        t2.setLiquidityPool(address(0));
    }

    function test_setLiquidityPool_onlyFactory() public {
        FinchToken t2 = FinchToken(Clones.clone(address(impl)));
        t2.initialize("t", "t", "", "", _socials(), creator, treasury);
        vm.prank(alice);
        vm.expectRevert(FinchToken.NotFactory.selector);
        t2.setLiquidityPool(pool);
    }

    // --- holder burns ---

    function test_burn_reducesSupply() public {
        vm.roll(block.number + 5); // past the window, unrestricted
        vm.prank(treasury);
        token.transfer(alice, 1_000e18);

        vm.prank(alice);
        token.burn(400e18);

        assertEq(token.balanceOf(alice), 600e18);
        assertEq(token.totalSupply(), SUPPLY - 400e18);
    }

    // --- unrestricted trading -----------------------------------------------------------
    //
    // Launch protection was removed deliberately: capping the first blocks punished real
    // buyers as often as bots, and the reverts it produced (surfacing as Uniswap's opaque
    // "TF") were indistinguishable from a broken pool. These tests pin the token as a plain
    // ERC-20 so a future change cannot quietly reintroduce a transfer restriction.

    function test_buyOfAnySizeAllowedImmediately() public {
        assertEq(block.number, token.launchBlock(), "still the launch block");
        // A buy is a transfer out of the pool. Any size, any recipient, first block.
        vm.prank(pool);
        token.transfer(alice, 200_000_000e18);
        assertEq(token.balanceOf(alice), 200_000_000e18);
    }

    function test_nonCreatorCanBuyOnTheLaunchBlock() public {
        assertEq(block.number, token.launchBlock());
        vm.prank(pool);
        token.transfer(bob, 90_000_000e18);
        assertEq(token.balanceOf(bob), 90_000_000e18);
    }

    function test_entireHolderBalanceCanMoveInOneTransfer() public {
        uint256 all = token.balanceOf(treasury);
        vm.prank(treasury);
        token.transfer(alice, all);
        assertEq(token.balanceOf(alice), all, "no cap on transfer size");
    }

    function test_sellsAndWalletTransfersUnrestricted() public {
        vm.prank(pool);
        token.transfer(alice, 40_000_000e18);
        vm.prank(alice);
        token.transfer(pool, 40_000_000e18); // sell straight back
        assertEq(token.balanceOf(alice), 0);

        vm.prank(treasury);
        token.transfer(bob, 80_000_000e18); // wallet to wallet
        assertEq(token.balanceOf(bob), 80_000_000e18);
    }

    function test_burn_worksOnTheLaunchBlock() public {
        vm.prank(treasury);
        token.transfer(alice, 1_000e18);
        vm.prank(alice);
        token.burn(1_000e18);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.totalSupply(), SUPPLY - 1_000e18);
    }
}

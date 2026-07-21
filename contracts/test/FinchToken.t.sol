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
    uint256 constant MAX_WALLET = (SUPPLY * 5) / 100; // 50M
    uint256 constant MAX_BUY = (SUPPLY * 55) / 1000; // 55M

    function _socials() internal pure returns (FinchToken.Socials memory) {
        return FinchToken.Socials("x", "tg", "dc", "web", "fc");
    }

    function setUp() public {
        impl = new FinchToken();
        token = FinchToken(Clones.clone(address(impl)));
        // This test contract is the "factory" (msg.sender to initialize).
        token.initialize("Finch Coin", "FNCH", "logo://", "a test token", _socials(), creator, treasury, 3);
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
        assertEq(token.maxWalletAmount(), MAX_WALLET);
        assertEq(token.maxBuyAmount(), MAX_BUY);
        (string memory tw,,,,) = token.socials();
        assertEq(tw, "x");
    }

    function test_implementation_cannotBeInitialized() public {
        vm.expectRevert();
        impl.initialize("x", "x", "", "", _socials(), creator, treasury, 3);
    }

    function test_cannotReinitialize() public {
        vm.expectRevert();
        token.initialize("x", "x", "", "", _socials(), creator, treasury, 3);
    }

    function test_setLiquidityPool_onceOnly() public {
        vm.expectRevert(FinchToken.PoolAlreadySet.selector);
        token.setLiquidityPool(address(0xBEEF));
    }

    /// A zero pool would make _update treat protection as inactive, silently disabling the
    /// entire anti-snipe window. Must be rejected.
    function test_setLiquidityPool_rejectsZero() public {
        FinchToken t2 = FinchToken(Clones.clone(address(impl)));
        t2.initialize("t", "t", "", "", _socials(), creator, treasury, 3);
        vm.expectRevert(FinchToken.ZeroAddress.selector);
        t2.setLiquidityPool(address(0));
    }

    function test_setLiquidityPool_onlyFactory() public {
        FinchToken t2 = FinchToken(Clones.clone(address(impl)));
        t2.initialize("t", "t", "", "", _socials(), creator, treasury, 3);
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

    function test_burn_allowedDuringLaunchWindow() public {
        // still inside the restriction window
        assertLe(block.number, token.restrictionsEndBlock());
        vm.prank(treasury);
        token.transfer(alice, 1_000e18); // wallet-to-wallet, unrestricted
        vm.prank(alice);
        token.burn(1_000e18); // to address(0) must be exempt from launch protection
        assertEq(token.balanceOf(alice), 0);
    }

    // --- launch protection ---

    function test_launchBlock_onlyCreatorCanBuy() public {
        assertEq(block.number, token.launchBlock());
        // buy = transfer from pool
        vm.prank(pool);
        vm.expectRevert(FinchToken.LaunchBlockCreatorOnly.selector);
        token.transfer(alice, 1e18);

        // creator buy allowed
        vm.prank(pool);
        token.transfer(creator, 1e18);
        assertEq(token.balanceOf(creator), 1e18);
    }

    function test_window_buyOverMaxBuyReverts() public {
        vm.roll(block.number + 1); // block 2, inside window, past launch block
        vm.prank(pool);
        vm.expectRevert(FinchToken.MaxBuyExceeded.selector);
        token.transfer(alice, MAX_BUY + 1);
    }

    function test_window_buyOverMaxWalletReverts() public {
        vm.roll(block.number + 1);
        // 51M: under the 55M buy cap but over the 50M wallet cap
        vm.prank(pool);
        vm.expectRevert(FinchToken.MaxWalletExceeded.selector);
        token.transfer(alice, 51_000_000e18);
    }

    function test_window_normalBuyOk() public {
        vm.roll(block.number + 1);
        vm.prank(pool);
        token.transfer(alice, 40_000_000e18);
        assertEq(token.balanceOf(alice), 40_000_000e18);
    }

    function test_window_sellUnrestricted() public {
        vm.roll(block.number + 1);
        vm.prank(pool);
        token.transfer(alice, 40_000_000e18); // buy up to cap
        // alice sells everything back (to==pool), no restriction
        vm.prank(alice);
        token.transfer(pool, 40_000_000e18);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_window_walletToWalletUnrestricted() public {
        vm.roll(block.number + 1);
        // treasury sends alice a large amount wallet-to-wallet (not a buy)
        vm.prank(treasury);
        token.transfer(alice, 80_000_000e18); // > wallet cap, but not from pool
        assertEq(token.balanceOf(alice), 80_000_000e18);
    }

    function test_afterWindow_largeBuyOk() public {
        vm.roll(token.restrictionsEndBlock() + 1);
        vm.prank(pool);
        token.transfer(alice, 200_000_000e18); // way over caps, but window closed
        assertEq(token.balanceOf(alice), 200_000_000e18);
    }
}

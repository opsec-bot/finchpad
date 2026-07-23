// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FeatureBoost} from "../src/FeatureBoost.sol";

contract FeatureBoostTest is Test {
    FeatureBoost boost;

    address feeRecipient = makeAddr("feeRecipient");
    address admin = makeAddr("admin");
    address payer = makeAddr("payer");
    address token = makeAddr("token");

    uint256 constant PRICE_PER_HOUR = 0.001 ether;

    function setUp() public {
        boost = new FeatureBoost(feeRecipient, admin, PRICE_PER_HOUR);
        vm.deal(payer, 100 ether);
    }

    function test_boost_setsWindowAndPaysRecipient() public {
        vm.prank(payer);
        boost.boost{value: 6 * PRICE_PER_HOUR}(token, 6);

        assertEq(boost.boostedUntil(token), uint64(block.timestamp + 6 hours), "window set");
        assertTrue(boost.isBoosted(token), "boosted now");
        assertEq(feeRecipient.balance, 6 * PRICE_PER_HOUR, "recipient paid exactly the cost");
    }

    function test_boost_stacks() public {
        vm.startPrank(payer);
        boost.boost{value: 12 * PRICE_PER_HOUR}(token, 12);
        boost.boost{value: 24 * PRICE_PER_HOUR}(token, 24);
        vm.stopPrank();
        // Buying more hours adds time rather than overwriting.
        assertEq(boost.boostedUntil(token), uint64(block.timestamp + 36 hours), "window extended, not reset");
    }

    function test_boost_stacksFromNowAfterExpiry() public {
        vm.prank(payer);
        boost.boost{value: 6 * PRICE_PER_HOUR}(token, 6);
        vm.warp(block.timestamp + 10 hours); // expired 4h ago
        vm.prank(payer);
        boost.boost{value: 6 * PRICE_PER_HOUR}(token, 6);
        // A lapsed window restarts from now — expired hours are not resurrected.
        assertEq(boost.boostedUntil(token), uint64(block.timestamp + 6 hours), "restarts from now");
    }

    function test_boost_expires() public {
        vm.prank(payer);
        boost.boost{value: PRICE_PER_HOUR}(token, 1);
        assertTrue(boost.isBoosted(token));
        vm.warp(block.timestamp + 1 hours + 1);
        assertFalse(boost.isBoosted(token), "no longer boosted after window");
    }

    function test_boost_refundsOverpayment() public {
        uint256 before = payer.balance;
        vm.prank(payer);
        boost.boost{value: 1 ether}(token, 2); // cost is 0.002 ether
        assertEq(feeRecipient.balance, 2 * PRICE_PER_HOUR, "recipient gets exactly the cost");
        assertEq(before - payer.balance, 2 * PRICE_PER_HOUR, "payer only out the cost");
    }

    function test_boost_revertsOnZeroHours() public {
        vm.prank(payer);
        vm.expectRevert(FeatureBoost.ZeroHours.selector);
        boost.boost{value: 1 ether}(token, 0);
    }

    function test_boost_revertsOverMaxHours() public {
        vm.prank(payer);
        vm.expectRevert(FeatureBoost.TooManyHours.selector);
        boost.boost{value: 10 ether}(token, 721);
    }

    function test_boost_revertsOnUnderpayment() public {
        vm.prank(payer);
        vm.expectRevert(FeatureBoost.InsufficientPayment.selector);
        boost.boost{value: PRICE_PER_HOUR - 1}(token, 1);
    }

    function test_setPrice_onlyAdmin() public {
        vm.expectRevert(FeatureBoost.NotAdmin.selector);
        boost.setPrice(1);

        vm.prank(admin);
        boost.setPrice(0.002 ether);
        assertEq(boost.pricePerHour(), 0.002 ether);
    }

    function test_setAdmin_onlyAdmin() public {
        address next = makeAddr("nextAdmin");
        vm.prank(admin);
        boost.setAdmin(next);
        assertEq(boost.admin(), next);

        // old admin can no longer act
        vm.prank(admin);
        vm.expectRevert(FeatureBoost.NotAdmin.selector);
        boost.setPrice(1);
    }

    function test_feeRecipientIsImmutable() public view {
        assertEq(boost.feeRecipient(), feeRecipient);
    }
}

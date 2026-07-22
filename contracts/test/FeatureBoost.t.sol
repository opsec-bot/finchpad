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

    uint256 constant PRICE_PER_DAY = 0.01 ether;
    uint256 constant VERIFY_PRICE = 0.05 ether;

    function setUp() public {
        boost = new FeatureBoost(feeRecipient, admin, PRICE_PER_DAY, VERIFY_PRICE);
        vm.deal(payer, 100 ether);
    }

    function test_feature_setsWindowAndPaysRecipient() public {
        vm.prank(payer);
        boost.feature{value: 3 * PRICE_PER_DAY}(token, 3);

        assertEq(boost.featuredUntil(token), uint64(block.timestamp + 3 days), "window set");
        assertTrue(boost.isFeatured(token), "featured now");
        assertEq(feeRecipient.balance, 3 * PRICE_PER_DAY, "recipient paid exactly the cost");
    }

    function test_feature_extendsExistingWindow() public {
        vm.startPrank(payer);
        boost.feature{value: 3 * PRICE_PER_DAY}(token, 3);
        boost.feature{value: 2 * PRICE_PER_DAY}(token, 2);
        vm.stopPrank();
        // Buying more days adds time rather than overwriting.
        assertEq(boost.featuredUntil(token), uint64(block.timestamp + 5 days), "window extended, not reset");
    }

    function test_feature_expires() public {
        vm.prank(payer);
        boost.feature{value: PRICE_PER_DAY}(token, 1);
        assertTrue(boost.isFeatured(token));
        vm.warp(block.timestamp + 1 days + 1);
        assertFalse(boost.isFeatured(token), "no longer featured after window");
    }

    function test_feature_refundsOverpayment() public {
        uint256 before = payer.balance;
        vm.prank(payer);
        boost.feature{value: 1 ether}(token, 2); // cost is 0.02 ether
        assertEq(feeRecipient.balance, 2 * PRICE_PER_DAY, "recipient gets exactly the cost");
        assertEq(before - payer.balance, 2 * PRICE_PER_DAY, "payer only out the cost");
    }

    function test_feature_revertsOnZeroDays() public {
        vm.prank(payer);
        vm.expectRevert(FeatureBoost.ZeroDays.selector);
        boost.feature{value: 1 ether}(token, 0);
    }

    function test_feature_revertsOnUnderpayment() public {
        vm.prank(payer);
        vm.expectRevert(FeatureBoost.InsufficientPayment.selector);
        boost.feature{value: PRICE_PER_DAY - 1}(token, 1);
    }

    function test_verify_setsBadgeAndPays() public {
        vm.prank(payer);
        boost.verify{value: VERIFY_PRICE}(token);
        assertTrue(boost.verified(token), "verified");
        assertEq(feeRecipient.balance, VERIFY_PRICE, "recipient paid");
    }

    function test_verify_revertsOnDoubleVerify() public {
        vm.startPrank(payer);
        boost.verify{value: VERIFY_PRICE}(token);
        vm.expectRevert(FeatureBoost.AlreadyVerified.selector);
        boost.verify{value: VERIFY_PRICE}(token);
        vm.stopPrank();
    }

    function test_setPrices_onlyAdmin() public {
        vm.expectRevert(FeatureBoost.NotAdmin.selector);
        boost.setPrices(1, 2);

        vm.prank(admin);
        boost.setPrices(0.02 ether, 0.1 ether);
        assertEq(boost.pricePerDay(), 0.02 ether);
        assertEq(boost.verifyPrice(), 0.1 ether);
    }

    function test_setAdmin_onlyAdmin() public {
        address next = makeAddr("nextAdmin");
        vm.prank(admin);
        boost.setAdmin(next);
        assertEq(boost.admin(), next);

        // old admin can no longer act
        vm.prank(admin);
        vm.expectRevert(FeatureBoost.NotAdmin.selector);
        boost.setPrices(1, 2);
    }

    function test_feeRecipientIsImmutable() public view {
        assertEq(boost.feeRecipient(), feeRecipient);
    }
}

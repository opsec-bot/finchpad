// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FinchLocker} from "../src/FinchLocker.sol";
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

    function setUp() public {
        pm = new MockPositionManager();
        weth = new MockERC20("Wrapped Ether", "WETH");
        token = new MockERC20("Token", "TKN");

        locker = new FinchLocker(factory, address(pm), address(weth), protocol, admin);
        vm.prank(admin);
        locker.setRegistry(registry);

        bool tokenIsToken0 = address(token) < address(weth);
        vm.prank(factory);
        locker.registerLaunch(address(token), POSITION_ID, PROTOCOL_BPS, tokenIsToken0, creator, 0);
    }

    function test_registerLaunch_onlyFactory() public {
        vm.expectRevert(FinchLocker.NotFactory.selector);
        locker.registerLaunch(address(0x1), 1, 1000, true, creator, 0);
    }

    function test_registerLaunch_noDoubleRegister() public {
        vm.prank(factory);
        vm.expectRevert(FinchLocker.AlreadyRegistered.selector);
        locker.registerLaunch(address(token), 1, 1000, true, creator, 0);
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
        token.mint(address(pm), tokenFees);
        weth.mint(address(pm), wethFees);

        bool tokenIsToken0 = address(token) < address(weth);
        (address t0, address t1, uint256 a0, uint256 a1) = tokenIsToken0
            ? (address(token), address(weth), tokenFees, wethFees)
            : (address(weth), address(token), wethFees, tokenFees);
        pm.setCollectReturns(t0, t1, a0, a1);

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
        token.mint(address(pm), tokenFees);
        bool tokenIsToken0 = address(token) < address(weth);
        (address t0, address t1, uint256 a0, uint256 a1) = tokenIsToken0
            ? (address(token), address(weth), tokenFees, uint256(0))
            : (address(weth), address(token), uint256(0), tokenFees);
        pm.setCollectReturns(t0, t1, a0, a1);

        locker.collect(address(token));

        assertEq(token.balanceOf(newWallet), (tokenFees * 8000) / 10000);
        assertEq(token.balanceOf(creator), 0);
    }

    function test_collect_unknownTokenReverts() public {
        vm.expectRevert(FinchLocker.UnknownToken.selector);
        locker.collect(address(0xdead));
    }
}

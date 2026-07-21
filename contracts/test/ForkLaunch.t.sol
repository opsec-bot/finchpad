// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FinchToken} from "../src/FinchToken.sol";
import {FinchFactory} from "../src/FinchFactory.sol";
import {FinchLocker} from "../src/FinchLocker.sol";
import {FeeRightsRegistry} from "../src/FeeRightsRegistry.sol";
import {
    IUniswapV3Factory,
    INonfungiblePositionManager,
    IUniswapV3Pool,
    ISwapRouter02
} from "../src/interfaces/IUniswapV3.sol";

/// @notice Curve-A launch + a real buy against the live Robinhood Chain Uniswap V3, on a fork.
contract ForkLaunchTest is Test {
    // Real periphery from the pons docs (validated by ForkSmoke).
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    // Curve A (degen/fair-launch): ~1 ETH implied start mcap, 1e9 supply. Exact values from
    // src/lib/launchCurve.js getLaunchConfig(), one set per token/WETH address ordering.
    uint160 constant SQRT_A_TOKEN0 = 2505414483750479311864138;
    uint160 constant SQRT_A_TOKEN1 = 2505414483750479311864138015696063;

    FinchToken impl;
    FinchFactory factory;
    FinchLocker locker;
    FeeRightsRegistry registry;

    address admin = makeAddr("admin");
    address protocol = makeAddr("protocol");
    address feeRecipient = makeAddr("feeRecipient");
    address signer = makeAddr("signer");
    address creator = makeAddr("creator");
    address buyer = makeAddr("buyer");

    function setUp() public {
        // FORK_RPC_URL (CI secret) overrides the public rh_mainnet alias when set.
        vm.createSelectFork(vm.envOr("FORK_RPC_URL", string("rh_mainnet")));

        impl = new FinchToken();
        factory = new FinchFactory(address(impl), POSITION_MANAGER, WETH, 2000, feeRecipient, admin);
        locker = new FinchLocker(address(factory), POSITION_MANAGER, WETH, protocol, admin);
        registry = new FeeRightsRegistry(address(locker), signer, admin);

        vm.startPrank(admin);
        factory.setLocker(address(locker));
        locker.setRegistry(address(registry));
        vm.stopPrank();
    }

    function _socials() internal pure returns (FinchToken.Socials memory) {
        return FinchToken.Socials("x", "tg", "dc", "web", "fc");
    }

    /// @dev Launches with curve-A params, choosing the config for the predicted address ordering.
    function _launchCurveA()
        internal
        returns (address token, address pool, uint256 positionId, uint160 sqrtP)
    {
        address predicted = vm.computeCreateAddress(address(factory), 1);
        bool tokenIsToken0 = predicted < WETH;
        int24 tickLower;
        int24 tickUpper;
        (sqrtP, tickLower, tickUpper) = tokenIsToken0
            ? (SQRT_A_TOKEN0, int24(-207000), int24(887200))
            : (SQRT_A_TOKEN1, int24(-887200), int24(207000));

        FinchFactory.LaunchParams memory p = FinchFactory.LaunchParams({
            name: "Finch Coin",
            symbol: "FNCH",
            logo: "logo://",
            description: "curve A launch on a fork",
            socials: _socials(),
            repoId: 0,
            initialSqrtPriceX96: sqrtP,
            tickLower: tickLower,
            tickUpper: tickUpper,
            restrictionBlocks: 3
        });

        deal(creator, 1 ether);
        vm.prank(creator);
        (token, pool, positionId) = factory.launch{value: 0.0005 ether}(p);
    }

    function test_fork_fullLaunch() public {
        (address token, address pool, uint256 positionId, uint160 sqrtP) = _launchCurveA();

        assertEq(FinchToken(token).name(), "Finch Coin");
        assertEq(FinchToken(token).totalSupply(), 1_000_000_000e18);

        // pool created, wired, and initialized at the curve-A price
        assertTrue(pool != address(0), "pool created");
        assertEq(IUniswapV3Factory(V3_FACTORY).getPool(token, WETH, 10000), pool, "pool registered in v3 factory");
        assertEq(FinchToken(token).liquidityPool(), pool, "token knows its pool");
        (uint160 poolSqrt,,,,,,) = IUniswapV3Pool(pool).slot0();
        assertEq(poolSqrt, sqrtP, "pool initialized at curve-A price");

        // ~full supply as single-sided liquidity; factory swept clean, dust to the creator
        assertApproxEqAbs(IERC20(token).balanceOf(pool), 1_000_000_000e18, 1e12, "~full supply in pool");
        assertEq(IERC20(token).balanceOf(address(factory)), 0, "factory swept clean");
        assertLt(IERC20(token).balanceOf(creator), 1e12, "creator holds only dust");

        // LP locked; control = creator; 80/20 snapshot
        assertEq(INonfungiblePositionManager(POSITION_MANAGER).ownerOf(positionId), address(locker), "locker owns LP");
        assertEq(locker.controllerOf(token), creator, "creator controls fee rights");
        (, uint16 protocolBps,,,,,) = locker.launches(token);
        assertEq(protocolBps, 2000, "80/20 split snapshotted");

        assertEq(feeRecipient.balance, 0.0005 ether, "launch fee forwarded");
    }

    /// Overpaying the launch fee must be refunded, not silently pocketed. Forwarding the
    /// whole msg.value would capture a fat-fingered 1 ETH on a 0.0005 ETH fee.
    function test_fork_overpaymentIsRefunded() public {
        address predicted = vm.computeCreateAddress(address(factory), 1);
        bool tokenIsToken0 = predicted < WETH;
        int24 tickLower;
        int24 tickUpper;
        uint160 sqrtP;
        (sqrtP, tickLower, tickUpper) = tokenIsToken0
            ? (SQRT_A_TOKEN0, int24(-207000), int24(887200))
            : (SQRT_A_TOKEN1, int24(-887200), int24(207000));

        FinchFactory.LaunchParams memory p = FinchFactory.LaunchParams({
            name: "Over Pay",
            symbol: "OVER",
            logo: "",
            description: "",
            socials: _socials(),
            repoId: 0,
            initialSqrtPriceX96: sqrtP,
            tickLower: tickLower,
            tickUpper: tickUpper,
            restrictionBlocks: 3
        });

        deal(creator, 5 ether);
        uint256 before = creator.balance;

        vm.prank(creator);
        factory.launch{value: 1 ether}(p); // wildly overpaying a 0.0005 ETH fee

        assertEq(feeRecipient.balance, 0.0005 ether, "fee recipient gets exactly the fee");
        assertEq(before - creator.balance, 0.0005 ether, "creator only out the fee, rest refunded");
    }

    /// The money path, end to end, against REAL Uniswap: launch -> trade both directions to
    /// accrue real 1% pool fees -> collect -> verify the 80/20 split lands in the right
    /// assets. Every other collect() test uses a mock that returns what I already assumed,
    /// so this is the only thing that proves the token0/token1 mapping is actually right.
    function test_fork_collectRealFeesAndSplit() public {
        (address token,,,) = _launchCurveA();
        vm.roll(block.number + 10); // past the anti-snipe window

        // Buy: fee accrues in WETH (the input asset).
        uint256 amountIn = 0.5 ether;
        deal(WETH, buyer, amountIn);
        vm.startPrank(buyer);
        IERC20(WETH).approve(SWAP_ROUTER, amountIn);
        uint256 bought = ISwapRouter02(SWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: WETH, tokenOut: token, fee: 10000, recipient: buyer,
                amountIn: amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        // Sell half back: fee accrues in the TOKEN. Now both assets have fees, which is what
        // makes the ordering mapping observable.
        IERC20(token).approve(SWAP_ROUTER, bought / 2);
        ISwapRouter02(SWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: token, tokenOut: WETH, fee: 10000, recipient: buyer,
                amountIn: bought / 2, amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();

        uint256 creatorTokenBefore = IERC20(token).balanceOf(creator);
        uint256 creatorWethBefore = IERC20(WETH).balanceOf(creator);

        locker.collect(token);

        uint256 creatorToken = IERC20(token).balanceOf(creator) - creatorTokenBefore;
        uint256 creatorWeth = IERC20(WETH).balanceOf(creator) - creatorWethBefore;
        uint256 protoToken = IERC20(token).balanceOf(protocol);
        uint256 protoWeth = IERC20(WETH).balanceOf(protocol);

        // Real fees actually accrued and were paid out in BOTH assets.
        assertGt(creatorWeth, 0, "creator earned WETH fees");
        assertGt(creatorToken, 0, "creator earned token fees");
        assertGt(protoWeth, 0, "protocol earned WETH fees");
        assertGt(protoToken, 0, "protocol earned token fees");

        // 80/20 split holds on real amounts (integer division favors the creator by <=1 wei).
        assertApproxEqAbs(protoWeth * 4, creatorWeth, 4, "WETH split is 80/20");
        assertApproxEqAbs(protoToken * 4, creatorToken, 4, "token split is 80/20");

        // Nothing stranded in the locker.
        assertEq(IERC20(token).balanceOf(address(locker)), 0, "no token left in locker");
        assertEq(IERC20(WETH).balanceOf(address(locker)), 0, "no WETH left in locker");

        emit log_named_uint("creator WETH fees", creatorWeth);
        emit log_named_uint("protocol WETH fees", protoWeth);
    }

    function test_fork_buyMovesGraduationProgress() public {
        (address token,,,) = _launchCurveA();

        // At launch: no WETH paired, not graduated.
        (uint256 principal0, uint256 threshold, bool graduated0) = factory.graduationStatus(token);
        assertEq(principal0, 0, "no WETH paired at launch");
        assertEq(threshold, 4.2 ether, "curve A graduation threshold");
        assertFalse(graduated0, "not graduated at launch");

        // Move past the anti-snipe window so anyone can buy.
        vm.roll(block.number + 10);

        // Real buy: WETH -> token through the live Uniswap router.
        uint256 amountIn = 0.05 ether;
        deal(WETH, buyer, amountIn);
        vm.startPrank(buyer);
        IERC20(WETH).approve(SWAP_ROUTER, amountIn);
        uint256 out = ISwapRouter02(SWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: token,
                fee: 10000,
                recipient: buyer,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();

        assertGt(out, 0, "buyer received tokens");
        assertEq(IERC20(token).balanceOf(buyer), out, "tokens delivered to buyer");

        // Graduation progress moved with the paired WETH.
        (uint256 principal1,, bool graduated1) = factory.graduationStatus(token);
        assertGt(principal1, principal0, "paired principal increased after buy");
        assertFalse(graduated1, "0.05 ETH is well under the 4.2 ETH threshold");
        emit log_named_uint("tokens bought for 0.05 WETH", out);
        emit log_named_uint("paired principal (wei)", principal1);
    }
}

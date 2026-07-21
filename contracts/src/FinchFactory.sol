// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FinchToken} from "./FinchToken.sol";
import {FinchLocker} from "./FinchLocker.sol";
import {INonfungiblePositionManager} from "./interfaces/IUniswapV3.sol";

/**
 * @title FinchFactory
 * @notice One-transaction launch: clone a FinchToken, create + initialize its Uniswap V3
 *         pool, deposit the entire supply as single-sided liquidity, and hand the locked
 *         LP position to the FinchLocker. No bonding curve, no migration.
 *
 * Launch-curve economics (starting price, tick range) are passed in per launch, computed
 * off-chain by the finchpad UI. The contract validates ordering and single-sidedness; it
 * does not hardcode a price. This keeps the curve a product decision, not a contract one.
 */
contract FinchFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint24 public constant POOL_FEE = 10_000; // 1%
    uint256 public constant LAUNCH_FEE = 0.0005 ether;
    /// @notice Curve A graduation marker. Cosmetic: trading continues in the same pool.
    uint256 public constant GRADUATION_THRESHOLD = 4.2 ether;

    address public immutable tokenImplementation;
    INonfungiblePositionManager public immutable positionManager;
    address public immutable weth;
    uint16 public immutable protocolShareBps; // 2000 = 80/20 creator/protocol
    address public immutable admin;
    // Immutable by design, not just for gas: a launch-fee destination that cannot be changed
    // means a compromised admin cannot redirect protocol revenue to themselves. If the
    // destination ever needs to change, point this at a multisig/splitter you control and
    // rotate inside that, or ship a new factory (contracts here are immutable anyway).
    address public immutable feeRecipient;
    FinchLocker public locker; // settable once (breaks factory <-> locker deploy cycle)

    struct LaunchParams {
        string name;
        string symbol;
        string logo;
        string description;
        FinchToken.Socials socials;
        uint256 repoId; // 0 if not a GitHub-repo launch
        uint160 initialSqrtPriceX96; // starting pool price (respecting token ordering)
        int24 tickLower; // single-sided range for the full supply
        int24 tickUpper;
        uint64 restrictionBlocks; // anti-snipe window length
    }

    event Launched(
        address indexed token, address indexed creator, address pool, uint256 positionId, bool tokenIsToken0
    );

    error LockerAlreadySet();
    error LockerNotSet();
    error NotAdmin();
    error InsufficientLaunchFee();
    error FeeForwardFailed();
    error RefundFailed();
    error NoLiquidityMinted();
    error ZeroAddress();

    constructor(
        address tokenImplementation_,
        address positionManager_,
        address weth_,
        uint16 protocolShareBps_,
        address feeRecipient_,
        address admin_
    ) {
        if (
            tokenImplementation_ == address(0) || positionManager_ == address(0) || weth_ == address(0)
                || feeRecipient_ == address(0) || admin_ == address(0)
        ) revert ZeroAddress();
        tokenImplementation = tokenImplementation_;
        positionManager = INonfungiblePositionManager(positionManager_);
        weth = weth_;
        protocolShareBps = protocolShareBps_;
        feeRecipient = feeRecipient_;
        admin = admin_;
    }

    function setLocker(address locker_) external {
        if (msg.sender != admin) revert NotAdmin();
        if (address(locker) != address(0)) revert LockerAlreadySet();
        if (locker_ == address(0)) revert ZeroAddress();
        locker = FinchLocker(locker_);
    }

    /**
     * @notice Graduation progress for a launched token.
     * @dev pairedPrincipal is the WETH sitting in the token's pool. Our single locked
     *      position is the only liquidity and WETH only enters via buys, so the pool's WETH
     *      balance tracks progress. It slightly overstates principal while uncollected fees
     *      sit in the pool — fine for a cosmetic progress marker.
     */
    function graduationStatus(address token)
        external
        view
        returns (uint256 pairedPrincipal, uint256 threshold, bool graduated)
    {
        address pool = FinchToken(token).liquidityPool();
        pairedPrincipal = pool == address(0) ? 0 : IERC20(weth).balanceOf(pool);
        threshold = GRADUATION_THRESHOLD;
        graduated = pairedPrincipal >= threshold;
    }

    function launch(LaunchParams calldata p)
        external
        payable
        nonReentrant
        returns (address token, address pool, uint256 positionId)
    {
        if (address(locker) == address(0)) revert LockerNotSet();
        if (msg.value < LAUNCH_FEE) revert InsufficientLaunchFee();

        // 1. Clone + initialize the token; full supply is minted to this factory.
        token = Clones.clone(tokenImplementation);
        FinchToken(token).initialize(
            p.name, p.symbol, p.logo, p.description, p.socials, msg.sender, address(this), p.restrictionBlocks
        );

        // 2. Order token0/token1 by address (Uniswap invariant).
        bool tokenIsToken0 = token < weth;
        (address token0, address token1) = tokenIsToken0 ? (token, weth) : (weth, token);

        // 3. Create + initialize the pool at the launch price.
        pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, p.initialSqrtPriceX96);
        FinchToken(token).setLiquidityPool(pool);

        // 4. Deposit the full supply as single-sided liquidity. The token side is whichever
        //    of amount0/amount1 corresponds to the launch token; the WETH side is zero.
        uint256 supply = FinchToken(token).SUPPLY();
        IERC20(token).forceApprove(address(positionManager), supply);
        (uint256 amount0Desired, uint256 amount1Desired) =
            tokenIsToken0 ? (supply, uint256(0)) : (uint256(0), supply);

        uint128 liquidity;
        (positionId, liquidity,,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(locker), // LP NFT goes straight to the locker (locked)
                deadline: block.timestamp
            })
        );

        // A mint that produces no liquidity would leave a "successful" launch with an empty
        // pool — nothing to trade against. Bad tick params must fail loudly, not silently.
        if (liquidity == 0) revert NoLiquidityMinted();

        // Single-sided mints leave microscopic dust (liquidity rounding). Sweep it to the
        // creator so the factory never accumulates stuck balances across launches.
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) IERC20(token).safeTransfer(msg.sender, dust);

        // 5. Register the launch with the locker (fee split snapshot + control = creator).
        locker.registerLaunch(token, positionId, protocolShareBps, tokenIsToken0, msg.sender, p.repoId);

        // 6. Forward exactly the launch fee and refund any overpayment. Forwarding the whole
        //    msg.value would silently pocket a fat-fingered 1 ETH on a 0.0005 ETH fee.
        (bool ok,) = feeRecipient.call{value: LAUNCH_FEE}("");
        if (!ok) revert FeeForwardFailed();

        uint256 excess = msg.value - LAUNCH_FEE;
        if (excess > 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            if (!refunded) revert RefundFailed();
        }

        emit Launched(token, msg.sender, pool, positionId, tokenIsToken0);
    }
}

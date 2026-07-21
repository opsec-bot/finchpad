// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INonfungiblePositionManager} from "./interfaces/IUniswapV3.sol";

/**
 * @title FinchLocker
 * @notice Holds each launch's locked Uniswap V3 LP position, collects the trading fees it
 *         earns, and splits them per the snapshot taken at launch. Also the single source
 *         of truth for who controls a token's fee payout (the "fee rights").
 *
 * Control model:
 *  - `controller` may redirect the fee wallet or hand off control. Set at launch to the creator.
 *  - `feeWallet` is where the creator share of fees is sent. Set at launch to the creator.
 *  - Only the FeeRightsRegistry may change controller/feeWallet (`setControl`). The registry
 *    enforces WHO is allowed to (creator redirect, admin CTO, or GitHub-verified claim).
 *
 * The protocol share is sent to `protocolFeeRecipient`. The FINCH buyback-burn runs
 * downstream of that recipient (keeper/TWAP), not inside fee collection, matching pons.
 */
contract FinchLocker is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Launch {
        uint256 positionId;
        uint16 protocolShareBps; // e.g. 2000 = 20% to protocol
        bool tokenIsToken0; // token < weth
        address controller;
        address feeWallet;
        uint256 repoId; // 0 = not launched for a GitHub repo (github claim disabled)
        bool exists;
    }

    uint16 public constant BPS = 10_000;

    address public immutable factory;
    INonfungiblePositionManager public immutable positionManager;
    address public immutable weth;
    address public registry; // set once after deploy (registry <-> locker constructor cycle)
    address public protocolFeeRecipient;
    address public admin; // may update protocolFeeRecipient and set the registry once

    mapping(address token => Launch) public launches;

    event LaunchRegistered(address indexed token, uint256 positionId, address controller, uint16 protocolShareBps);
    event ControlChanged(address indexed token, address controller, address feeWallet);
    event FeesCollected(address indexed token, uint256 tokenToCreator, uint256 wethToCreator, uint256 tokenToProtocol, uint256 wethToProtocol);

    error NotFactory();
    error NotRegistry();
    error NotAdmin();
    error UnknownToken();
    error AlreadyRegistered();
    error ZeroAddress();

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier onlyRegistry() {
        if (registry == address(0) || msg.sender != registry) revert NotRegistry();
        _;
    }

    constructor(
        address factory_,
        address positionManager_,
        address weth_,
        address protocolFeeRecipient_,
        address admin_
    ) {
        if (
            factory_ == address(0) || positionManager_ == address(0) || weth_ == address(0)
                || protocolFeeRecipient_ == address(0) || admin_ == address(0)
        ) revert ZeroAddress();
        factory = factory_;
        positionManager = INonfungiblePositionManager(positionManager_);
        weth = weth_;
        protocolFeeRecipient = protocolFeeRecipient_;
        admin = admin_;
    }

    /// @notice Wire the registry once (breaks the registry <-> locker constructor cycle).
    function setRegistry(address registry_) external {
        if (msg.sender != admin) revert NotAdmin();
        if (registry_ == address(0)) revert ZeroAddress();
        if (registry != address(0)) revert AlreadyRegistered();
        registry = registry_;
    }

    // --- launch registration (factory) ---

    function registerLaunch(
        address token,
        uint256 positionId,
        uint16 protocolShareBps,
        bool tokenIsToken0,
        address controller,
        uint256 repoId
    ) external onlyFactory {
        if (launches[token].exists) revert AlreadyRegistered();
        if (controller == address(0)) revert ZeroAddress();
        launches[token] = Launch({
            positionId: positionId,
            protocolShareBps: protocolShareBps,
            tokenIsToken0: tokenIsToken0,
            controller: controller,
            feeWallet: controller,
            repoId: repoId,
            exists: true
        });
        emit LaunchRegistered(token, positionId, controller, protocolShareBps);
    }

    // --- fee rights (registry only) ---

    function setControl(address token, address controller, address feeWallet) external onlyRegistry {
        Launch storage l = launches[token];
        if (!l.exists) revert UnknownToken();
        if (controller == address(0) || feeWallet == address(0)) revert ZeroAddress();
        l.controller = controller;
        l.feeWallet = feeWallet;
        emit ControlChanged(token, controller, feeWallet);
    }

    function controllerOf(address token) external view returns (address) {
        return launches[token].controller;
    }

    function feeWalletOf(address token) external view returns (address) {
        return launches[token].feeWallet;
    }

    function repoIdOf(address token) external view returns (uint256) {
        return launches[token].repoId;
    }

    // --- fee collection ---

    /// @notice Collect this token's LP trading fees and split them per the launch snapshot.
    function collect(address token) external nonReentrant {
        Launch memory l = launches[token];
        if (!l.exists) revert UnknownToken();

        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: l.positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (uint256 tokenAmt, uint256 wethAmt) =
            l.tokenIsToken0 ? (amount0, amount1) : (amount1, amount0);

        uint16 creatorBps = BPS - l.protocolShareBps;
        uint256 tokenToCreator = (tokenAmt * creatorBps) / BPS;
        uint256 wethToCreator = (wethAmt * creatorBps) / BPS;
        uint256 tokenToProtocol = tokenAmt - tokenToCreator;
        uint256 wethToProtocol = wethAmt - wethToCreator;

        if (tokenToCreator > 0) IERC20(token).safeTransfer(l.feeWallet, tokenToCreator);
        if (wethToCreator > 0) IERC20(weth).safeTransfer(l.feeWallet, wethToCreator);
        if (tokenToProtocol > 0) IERC20(token).safeTransfer(protocolFeeRecipient, tokenToProtocol);
        if (wethToProtocol > 0) IERC20(weth).safeTransfer(protocolFeeRecipient, wethToProtocol);

        emit FeesCollected(token, tokenToCreator, wethToCreator, tokenToProtocol, wethToProtocol);
    }

    // --- admin ---

    function setProtocolFeeRecipient(address recipient) external {
        if (msg.sender != admin) revert NotAdmin();
        if (recipient == address(0)) revert ZeroAddress();
        protocolFeeRecipient = recipient;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FeatureBoost
 * @notice Paid promotion for launched tokens: pay ETH to feature a token in the finchpad UI
 *         for a number of days, or pay a one-time fee for a permanent "boosted" badge. This
 *         is pure
 *         advertising revenue — it never touches trading fees, fee splits, or who controls a
 *         token. Ranking is off-chain: the indexer reads the `Featured`/`Boosted` events and
 *         the `featuredUntil`/`boosted` mappings, and the frontend surfaces active ones.
 *
 * Naming: the badge is "boosted", never "verified". It is bought, not earned — anyone can
 * buy it for any token, including their own. Calling it verified would read to users as
 * vetted-by-finchpad, which is exactly the false assurance a scam-spam pad must not sell.
 *
 * Deliberately standalone: it is NOT wired into the factory or locker, so it can ship (and be
 * priced/retired) without any risk to the fee-collection path.
 *
 * Regulatory posture: selling ad placement and a badge is ordinary commerce. It pays nobody a
 * share of protocol revenue, so it carries none of the dividend/security questions that a
 * fee-share or staking design would.
 *
 * `feeRecipient` is immutable, on purpose: a compromised admin can change the price but can
 * never redirect the money. Point it at a multisig/splitter if the destination must rotate.
 */
contract FeatureBoost is ReentrancyGuard {
    address public immutable feeRecipient;
    address public admin;
    uint256 public pricePerDay;
    uint256 public boostPrice;

    /// @notice Unix timestamp a token is featured until. Featured iff this is in the future.
    mapping(address token => uint64 until) public featuredUntil;
    /// @notice One-time paid "boosted" badge. Once true, stays true.
    mapping(address token => bool isBoosted) public boosted;

    event Featured(address indexed token, address indexed payer, uint64 until, uint256 paid);
    event Boosted(address indexed token, address indexed payer, uint256 paid);
    event PriceChanged(uint256 pricePerDay, uint256 boostPrice);
    event AdminChanged(address indexed admin);

    error ZeroAddress();
    error ZeroDays();
    error InsufficientPayment();
    error AlreadyBoosted();
    error NotAdmin();
    error PayoutFailed();
    error RefundFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address feeRecipient_, address admin_, uint256 pricePerDay_, uint256 boostPrice_) {
        if (feeRecipient_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        feeRecipient = feeRecipient_;
        admin = admin_;
        pricePerDay = pricePerDay_;
        boostPrice = boostPrice_;
    }

    /**
     * @notice Feature `token` for `daysCount` days. Extends any existing window rather than
     *         overwriting it, so buying more days always adds time. Overpayment is refunded.
     */
    function feature(address token, uint32 daysCount) external payable nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (daysCount == 0) revert ZeroDays();
        uint256 cost = pricePerDay * daysCount;
        if (msg.value < cost) revert InsufficientPayment();

        uint64 base = featuredUntil[token] > block.timestamp ? featuredUntil[token] : uint64(block.timestamp);
        uint64 newUntil = base + uint64(daysCount) * 1 days;
        featuredUntil[token] = newUntil;

        _settle(cost);
        emit Featured(token, msg.sender, newUntil, cost);
    }

    /// @notice One-time paid "boosted" badge for `token`. Overpayment is refunded.
    function boost(address token) external payable nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (boosted[token]) revert AlreadyBoosted();
        if (msg.value < boostPrice) revert InsufficientPayment();

        boosted[token] = true;

        _settle(boostPrice);
        emit Boosted(token, msg.sender, boostPrice);
    }

    /// @notice True iff the token's featured window has not yet elapsed.
    function isFeatured(address token) external view returns (bool) {
        return featuredUntil[token] > block.timestamp;
    }

    /// @dev Forward exactly `cost` to the fee recipient and refund any overpayment. Forwarding
    ///      the whole msg.value would silently pocket a fat-fingered overpayment.
    function _settle(uint256 cost) internal {
        (bool ok,) = feeRecipient.call{value: cost}("");
        if (!ok) revert PayoutFailed();
        uint256 excess = msg.value - cost;
        if (excess > 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            if (!refunded) revert RefundFailed();
        }
    }

    // --- admin ---

    function setPrices(uint256 pricePerDay_, uint256 boostPrice_) external onlyAdmin {
        pricePerDay = pricePerDay_;
        boostPrice = boostPrice_;
        emit PriceChanged(pricePerDay_, boostPrice_);
    }

    function setAdmin(address admin_) external onlyAdmin {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        emit AdminChanged(admin_);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FeatureBoost
 * @notice Paid promotion for launched tokens — ONE product: pay ETH to "boost" a token for a
 *         number of hours. Boosted tokens get a badge, a highlighted card, and top-rail
 *         placement in the finchpad UI (while also remaining in the organic feed — placement
 *         adds, never reorders). Buying more hours while boosted EXTENDS the window, so boosts
 *         stack. This is pure advertising revenue — it never touches trading fees, fee splits,
 *         or who controls a token. Ranking is off-chain: the indexer reads `Boosted` events and
 *         the `boostedUntil` mapping, and the frontend surfaces active ones.
 *
 *         (v1 sold day-based "featuring" plus a separate permanent badge; both collapsed into
 *         this single hour-based product before first deployment. Contract name kept to avoid
 *         churn in deploy tooling.)
 *
 * Naming: the badge is "boosted", never "verified". It is bought, not earned — anyone can
 * buy it for any token, including their own. Calling it verified would read to users as
 * vetted-by-finchpad, which is exactly the false assurance a scam-spam pad must not sell.
 *
 * Deliberately standalone: it is NOT wired into the factory or locker, so it can ship (and be
 * priced/retired) without any risk to the fee-collection path.
 *
 * Regulatory posture: selling ad placement is ordinary commerce. It pays nobody a share of
 * protocol revenue, so it carries none of the dividend/security questions that a fee-share or
 * staking design would.
 *
 * `feeRecipient` is immutable, on purpose: a compromised admin can change the price but can
 * never redirect the money. Point it at a multisig/splitter if the destination must rotate.
 */
contract FeatureBoost is ReentrancyGuard {
    /// @dev Sanity cap: nobody can buy (or fat-finger) more than 30 days of boost at once.
    uint32 public constant MAX_HOURS = 720;

    address public immutable feeRecipient;
    address public admin;
    uint256 public pricePerHour;

    /// @notice Unix timestamp a token is boosted until. Boosted iff this is in the future.
    mapping(address token => uint64 until) public boostedUntil;

    event Boosted(address indexed token, address indexed payer, uint64 until, uint256 paid);
    event PriceChanged(uint256 pricePerHour);
    event AdminChanged(address indexed admin);

    error ZeroAddress();
    error ZeroHours();
    error TooManyHours();
    error InsufficientPayment();
    error NotAdmin();
    error PayoutFailed();
    error RefundFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address feeRecipient_, address admin_, uint256 pricePerHour_) {
        if (feeRecipient_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        feeRecipient = feeRecipient_;
        admin = admin_;
        pricePerHour = pricePerHour_;
    }

    /**
     * @notice Boost `token` for `numHours` hours. Extends any active window rather than
     *         overwriting it, so buying more hours always adds time. Overpayment is refunded.
     */
    function boost(address token, uint32 numHours) external payable nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (numHours == 0) revert ZeroHours();
        if (numHours > MAX_HOURS) revert TooManyHours();
        uint256 cost = pricePerHour * numHours;
        if (msg.value < cost) revert InsufficientPayment();

        uint64 base = boostedUntil[token] > block.timestamp ? boostedUntil[token] : uint64(block.timestamp);
        uint64 newUntil = base + uint64(numHours) * 1 hours;
        boostedUntil[token] = newUntil;

        _settle(cost);
        emit Boosted(token, msg.sender, newUntil, cost);
    }

    /// @notice True iff the token's boost window has not yet elapsed.
    function isBoosted(address token) external view returns (bool) {
        return boostedUntil[token] > block.timestamp;
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

    function setPrice(uint256 pricePerHour_) external onlyAdmin {
        pricePerHour = pricePerHour_;
        emit PriceChanged(pricePerHour_);
    }

    function setAdmin(address admin_) external onlyAdmin {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        emit AdminChanged(admin_);
    }
}

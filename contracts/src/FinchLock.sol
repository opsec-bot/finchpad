// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FinchLock
 * @notice Streamflow-style token locking + vesting. Any holder can lock any ERC-20 on a
 *         cliff/linear schedule. The anti-rug trust primitive: a creator locking their own
 *         allocation is a public, verifiable "I can't dump on you."
 *
 * Accepts ANY ERC-20. The stored locked amount is the actual balance received, so
 * fee-on-transfer / rebasing tokens can't desync the accounting.
 */
contract FinchLock is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Lock {
        address token;
        address beneficiary;
        uint256 amount; // actual amount received on deposit
        uint256 released;
        uint64 start;
        uint64 cliff; // seconds after start before anything releases
        uint64 duration; // seconds after start until fully vested
    }

    mapping(uint256 id => Lock) public locks;
    uint256 public nextId;

    event Locked(
        uint256 indexed id, address indexed token, address indexed beneficiary, uint256 amount, uint64 start, uint64 cliff, uint64 duration
    );
    event Released(uint256 indexed id, uint256 amount);

    error ZeroAmount();
    error ZeroAddress();
    error CliffAfterDuration();
    error NothingToRelease();

    /**
     * @notice Lock `amount` of `token` for `beneficiary` on a cliff/linear schedule.
     * @param cliffSeconds seconds after now before any tokens release
     * @param durationSeconds seconds after now until fully vested (>= cliffSeconds)
     * @return id the lock id
     */
    function lock(address token, address beneficiary, uint256 amount, uint64 cliffSeconds, uint64 durationSeconds)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (amount == 0) revert ZeroAmount();
        if (token == address(0) || beneficiary == address(0)) revert ZeroAddress();
        if (cliffSeconds > durationSeconds) revert CliffAfterDuration();

        // Measure actual received so fee-on-transfer tokens can't desync accounting.
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        // slither-disable-next-line incorrect-equality
        if (received == 0) revert ZeroAmount();

        id = nextId++;
        locks[id] = Lock({
            token: token,
            beneficiary: beneficiary,
            amount: received,
            released: 0,
            start: uint64(block.timestamp),
            cliff: cliffSeconds,
            duration: durationSeconds
        });

        emit Locked(id, token, beneficiary, received, uint64(block.timestamp), cliffSeconds, durationSeconds);
    }

    /// @notice Total vested at `timestamp`: 0 before the cliff, then linear from start over duration.
    function vestedAmount(uint256 id, uint64 timestamp) public view returns (uint256) {
        Lock memory l = locks[id];
        if (timestamp < l.start + l.cliff) return 0;
        if (timestamp >= l.start + l.duration) return l.amount;
        return (l.amount * (timestamp - l.start)) / l.duration;
    }

    function releasable(uint256 id) public view returns (uint256) {
        return vestedAmount(id, uint64(block.timestamp)) - locks[id].released;
    }

    /// @notice Release vested tokens to the beneficiary. Callable by anyone; funds go to the beneficiary.
    function release(uint256 id) external nonReentrant {
        Lock storage l = locks[id];
        uint256 amount = vestedAmount(id, uint64(block.timestamp)) - l.released;
        // slither-disable-next-line incorrect-equality
        if (amount == 0) revert NothingToRelease();
        l.released += amount; // effects before interaction
        IERC20(l.token).safeTransfer(l.beneficiary, amount);
        emit Released(id, amount);
    }
}

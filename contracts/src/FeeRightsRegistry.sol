// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFinchLockerControl, ClaimKind} from "./interfaces/IFinchLockerControl.sol";

/**
 * @title FeeRightsRegistry
 * @notice The one place that decides who may change a token's fee payout. Every path ends
 *         in the locker; the difference is how the caller proves the right.
 *
 *  1. redirectFees / handoff  — the current controller signs a tx (cheap, on-chain).
 *  2. approveCTO              — the admin executes a reviewed community takeover of an
 *                               abandoned token (manual review is off-chain, pons model).
 *  3. claimGithub            — a GitHub identity proves itself off-chain; the backend signs
 *                               an EIP-712 message that this contract verifies against a
 *                               trusted signer key. Bound to a numeric GitHub id: a repo id
 *                               (claimed by a repo admin) or a user id (claimed by that
 *                               account, bags.fm-style). Settling a claim also pays out the
 *                               escrowed pre-claim fees held by the locker.
 *
 * The GitHub signer key is a trusted component. If it leaks, any GitHub-launched token is
 * claimable. It must live in an HSM/KMS or behind a multisig, never a hot wallet.
 */
contract FeeRightsRegistry is EIP712, Ownable {
    IFinchLockerControl public immutable locker;
    address public trustedSigner;

    bytes32 public constant GITHUB_CLAIM_TYPEHASH =
        keccak256("GithubClaim(address token,uint8 claimKind,uint256 githubId,address claimant,uint256 deadline)");

    mapping(bytes32 digest => bool used) public usedClaims;

    event FeesRedirected(address indexed token, address indexed by, address feeWallet);
    event ControlHandedOff(address indexed token, address indexed from, address to);
    event CTOApproved(address indexed token, address newController);
    event GithubClaimed(address indexed token, ClaimKind claimKind, uint256 indexed githubId, address claimant);
    event TrustedSignerUpdated(address indexed signer);

    error NotController();
    error GithubDisabled();
    error BindingMismatch();
    error AlreadyClaimed();
    error ClaimExpired();
    error ClaimAlreadyUsed();
    error BadSignature();
    error ZeroAddress();

    constructor(address locker_, address signer_, address admin_)
        EIP712("finchpad", "1")
        Ownable(admin_)
    {
        if (locker_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        locker = IFinchLockerControl(locker_);
        trustedSigner = signer_; // may be zero until the signer service is provisioned
    }

    // --- 1. controller-signed paths ---

    /// @notice Current controller points the creator fee share at a new wallet. Control unchanged.
    function redirectFees(address token, address newFeeWallet) external {
        if (msg.sender != locker.controllerOf(token)) revert NotController();
        if (newFeeWallet == address(0)) revert ZeroAddress();
        locker.setControl(token, msg.sender, newFeeWallet);
        emit FeesRedirected(token, msg.sender, newFeeWallet);
    }

    /// @notice Current controller hands the whole fee right to a successor.
    function handoff(address token, address newController) external {
        if (msg.sender != locker.controllerOf(token)) revert NotController();
        if (newController == address(0)) revert ZeroAddress();
        locker.setControl(token, newController, newController);
        emit ControlHandedOff(token, msg.sender, newController);
    }

    // --- 2. admin CTO (manual review off-chain) ---

    /// @notice Admin executes a reviewed community takeover of an abandoned token.
    function approveCTO(address token, address newController) external onlyOwner {
        if (newController == address(0)) revert ZeroAddress();
        locker.setControl(token, newController, newController);
        emit CTOApproved(token, newController);
    }

    // --- 3. GitHub-verified claim ---

    /**
     * @notice Claim a GitHub-launched token's fee rights with a backend-signed attestation.
     *         Settling also transfers the locker's escrowed pre-claim fees to the claimant.
     * @param token the launched token
     * @param claimKind Repo or User — must match the binding snapshotted at launch
     * @param githubId the numeric GitHub id (bound, never a name — names get re-registered)
     * @param deadline signature expiry
     * @param signature EIP-712 signature from the trusted signer over the claim
     */
    function claimGithub(
        address token,
        ClaimKind claimKind,
        uint256 githubId,
        uint256 deadline,
        bytes calldata signature
    ) external {
        (ClaimKind boundKind, uint256 boundId, bool claimed) = locker.githubBindingOf(token);
        if (boundKind == ClaimKind.None) revert GithubDisabled();
        if (claimed) revert AlreadyClaimed();
        if (boundKind != claimKind || boundId != githubId) revert BindingMismatch();
        if (block.timestamp > deadline) revert ClaimExpired();

        bytes32 structHash =
            keccak256(abi.encode(GITHUB_CLAIM_TYPEHASH, token, claimKind, githubId, msg.sender, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (usedClaims[digest]) revert ClaimAlreadyUsed();

        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0) || signer != trustedSigner) revert BadSignature();

        usedClaims[digest] = true;
        locker.settleGithubClaim(token, msg.sender);
        emit GithubClaimed(token, claimKind, githubId, msg.sender);
    }

    /**
     * @notice The exact EIP-712 digest the backend signer must sign for a GitHub claim.
     * @dev Exposed so the signer service and frontend can verify they're producing the
     *      identical digest this contract will check. Mismatch here is the most likely
     *      integration bug in the whole claim flow.
     */
    function claimDigest(address token, ClaimKind claimKind, uint256 githubId, address claimant, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(GITHUB_CLAIM_TYPEHASH, token, claimKind, githubId, claimant, deadline))
        );
    }

    // --- admin ---

    function setTrustedSigner(address signer) external onlyOwner {
        trustedSigner = signer;
        emit TrustedSignerUpdated(signer);
    }
}

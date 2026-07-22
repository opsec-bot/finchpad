// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INonfungiblePositionManager} from "./interfaces/IUniswapV3.sol";
import {IFinchLockerControl, ClaimKind} from "./interfaces/IFinchLockerControl.sol";

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
 * GitHub launches (claimKind != None) bind the fee right to a GitHub identity — a repo or a
 * user account — instead of the launcher. Until that identity claims:
 *  - the launcher gets nothing: controller and feeWallet start at zero, so nobody can
 *    redirect, and the creator share of every collect accrues in escrow inside this
 *    contract (killing the "launch a token on a famous repo and farm fees" grift);
 *  - a successful claim (via the registry) pays out the entire escrow backlog and hands
 *    the fee right to the claimant;
 *  - if nobody claims within ESCROW_WINDOW, anyone may sweep the escrow to the protocol
 *    recipient (feeding the FINCH buyback-burn), and subsequent creator-share fees follow
 *    it there until a claim happens.
 *
 * The full claim lifecycle is emitted as indexed events (GithubBound, EscrowAccrued,
 * GithubClaimSettled, EscrowSwept) so charts and external indexers can reconstruct it from
 * logs alone — e.g. rendering a claim marker on a price chart at the GithubClaimSettled
 * block, or listing every token bound to one githubId.
 *
 * The protocol share is sent to `protocolFeeRecipient`. The FINCH buyback-burn runs
 * downstream of that recipient (keeper/TWAP), not inside fee collection, matching pons.
 */
contract FinchLocker is IFinchLockerControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Launch {
        uint256 positionId;
        uint16 protocolShareBps; // e.g. 2000 = 20% to protocol
        bool tokenIsToken0; // token < weth
        address controller;
        address feeWallet;
        ClaimKind claimKind; // None = fee right belongs to the launcher from block one
        uint256 githubId; // numeric repo id (Repo) or user id (User); 0 iff None
        bool githubClaimed;
        uint64 escrowDeadline; // claim-or-sweep deadline for GitHub launches
        uint256 escrowedToken; // creator share held for the unclaimed GitHub identity
        uint256 escrowedWeth;
        bool exists;
        address referrer; // paid a slice of the PROTOCOL share; address(0) = no referral
        // Protocol-controlled traction accounting: WETH fees this position has actually paid
        // out through collect(). Monotonic by construction, and only real swaps can move it
        // (donating tokens to a V3 pool does not touch fee growth), so graduation is derived
        // from it rather than latched from a manipulable spot read.
        uint256 lifetimeWethFees;
    }

    uint16 public constant BPS = 10_000;
    /// @notice How long a GitHub identity has to claim before the escrow becomes sweepable.
    uint64 public constant ESCROW_WINDOW = 365 days;

    address public immutable factory;
    INonfungiblePositionManager public immutable positionManager;
    address public immutable weth;
    /// @notice Referral commission, in bps OF THE PROTOCOL SHARE (not of the whole trade). The
    ///         creator's share is never touched. Global (immutable) so every launch on this
    ///         locker gets the same terms; a new locker ships to change them.
    uint16 public immutable referralShareBps;
    /// @notice How many bps shift from the protocol share to the creator once a token has
    ///         graduated. Rewards successful tokens; set to 0 to make graduation badge-only.
    uint16 public immutable graduationBonusBps;
    /// @notice Lifetime collected WETH fees at which a token counts as graduated. Set to
    ///         type(uint256).max to disable graduation entirely.
    uint256 public immutable graduationFeeThreshold;
    address public registry; // set once after deploy (registry <-> locker constructor cycle)
    address public protocolFeeRecipient;
    address public immutable admin; // may update protocolFeeRecipient and set the registry once

    mapping(address token => Launch) public launches;

    event LaunchRegistered(address indexed token, uint256 positionId, address controller, uint16 protocolShareBps);
    event ControlChanged(address indexed token, address controller, address feeWallet);
    event RegistrySet(address indexed registry);
    event FeesCollected(address indexed token, uint256 tokenToCreator, uint256 wethToCreator, uint256 tokenToProtocol, uint256 wethToProtocol);
    /// @notice A launch bound its fee right to a GitHub identity. githubId indexed so
    ///         indexers can list every token launched for one repo/user.
    event GithubBound(address indexed token, ClaimKind kind, uint256 indexed githubId, uint64 escrowDeadline);
    /// @notice Creator-share fees accrued into escrow for the still-unclaimed identity.
    event EscrowAccrued(address indexed token, uint256 tokenAmount, uint256 wethAmount, uint256 totalEscrowedToken, uint256 totalEscrowedWeth);
    /// @notice The GitHub identity claimed: fee right transferred, escrow backlog paid out.
    ///         This is the chart-marker event ("creator claimed" bubble).
    event GithubClaimSettled(address indexed token, address indexed claimant, uint256 escrowedTokenPaid, uint256 escrowedWethPaid);
    /// @notice Expired unclaimed escrow was swept to the protocol recipient (buyback path).
    event EscrowSwept(address indexed token, uint256 tokenAmount, uint256 wethAmount);
    /// @notice A referral commission was paid out of the protocol share on a collect.
    event ReferralPaid(address indexed token, address indexed referrer, uint256 tokenAmount, uint256 wethAmount);
    /// @notice A token crossed the graduation threshold; its protocol share now drops.
    /// @notice Token crossed the graduation threshold. Emitted once, from collect().
    event Graduated(address indexed token, uint256 lifetimeWethFees);

    error NotFactory();
    error NotRegistry();
    error NotAdmin();
    error UnknownToken();
    error AlreadyRegistered();
    error ZeroAddress();
    error InvalidGithubBinding();
    error GithubUnclaimed();
    error NotGithubLaunch();
    error AlreadyClaimed();
    error EscrowNotExpired();
    error NothingToSweep();
    error InvalidBps();

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
        address admin_,
        uint16 referralShareBps_,
        uint16 graduationBonusBps_,
        uint256 graduationFeeThreshold_
    ) {
        if (
            factory_ == address(0) || positionManager_ == address(0) || weth_ == address(0)
                || protocolFeeRecipient_ == address(0) || admin_ == address(0)
        ) revert ZeroAddress();
        // referral is a fraction of the protocol share; graduation shifts at most the whole
        // protocol share to the creator. Both are bounded by BPS.
        if (referralShareBps_ > BPS || graduationBonusBps_ > BPS) revert InvalidBps();
        factory = factory_;
        positionManager = INonfungiblePositionManager(positionManager_);
        weth = weth_;
        protocolFeeRecipient = protocolFeeRecipient_;
        admin = admin_;
        referralShareBps = referralShareBps_;
        graduationBonusBps = graduationBonusBps_;
        graduationFeeThreshold = graduationFeeThreshold_;
    }

    /// @notice Wire the registry once (breaks the registry <-> locker constructor cycle).
    function setRegistry(address registry_) external {
        if (msg.sender != admin) revert NotAdmin();
        if (registry_ == address(0)) revert ZeroAddress();
        if (registry != address(0)) revert AlreadyRegistered();
        registry = registry_;
        emit RegistrySet(registry_);
    }

    // --- launch registration (factory) ---

    function registerLaunch(
        address token,
        uint256 positionId,
        uint16 protocolShareBps,
        bool tokenIsToken0,
        address creator,
        ClaimKind claimKind,
        uint256 githubId,
        address referrer,
        address feeWallet_
    ) external onlyFactory {
        if (launches[token].exists) revert AlreadyRegistered();
        if (creator == address(0)) revert ZeroAddress();
        bool github = claimKind != ClaimKind.None;
        if (github ? githubId == 0 : githubId != 0) revert InvalidGithubBinding();

        uint64 escrowDeadline = github ? uint64(block.timestamp) + ESCROW_WINDOW : 0;
        // GitHub launches: the fee right belongs to the bound identity, not the launcher.
        // controller/feeWallet stay zero (nobody can redirect, creator share escrows here)
        // until the claim settles.
        //
        // Otherwise the creator controls the token, but fees may be directed elsewhere from
        // the very first block — chosen at launch, so there is no window where fees briefly
        // point at the launcher before a follow-up transaction moves them.
        address owner = github ? address(0) : creator;
        address payTo = github ? address(0) : (feeWallet_ == address(0) ? creator : feeWallet_);

        launches[token] = Launch({
            positionId: positionId,
            protocolShareBps: protocolShareBps,
            tokenIsToken0: tokenIsToken0,
            controller: owner,
            feeWallet: payTo,
            claimKind: claimKind,
            githubId: githubId,
            githubClaimed: false,
            escrowDeadline: escrowDeadline,
            escrowedToken: 0,
            escrowedWeth: 0,
            exists: true,
            referrer: referrer,
            lifetimeWethFees: 0
        });
        emit LaunchRegistered(token, positionId, owner, protocolShareBps);
        if (github) emit GithubBound(token, claimKind, githubId, escrowDeadline);
    }

    /// @notice Traction accounting for a token: WETH fees collected so far, the threshold
    ///         they must reach, and whether they have. Derived, never latched.
    function graduationOf(address token)
        external
        view
        returns (uint256 lifetimeWethFees, uint256 threshold, bool graduated)
    {
        Launch storage l = launches[token];
        return (l.lifetimeWethFees, graduationFeeThreshold, l.lifetimeWethFees >= graduationFeeThreshold);
    }

    // --- fee rights (registry only) ---

    function setControl(address token, address controller, address feeWallet) external override onlyRegistry {
        Launch storage l = launches[token];
        if (!l.exists) revert UnknownToken();
        if (controller == address(0) || feeWallet == address(0)) revert ZeroAddress();
        // While a GitHub binding is unclaimed and inside its window, the fee right belongs
        // to the bound identity alone — not even an admin CTO may take it. After the window
        // expires unclaimed, CTO is allowed again (the identity abandoned it too).
        if (l.claimKind != ClaimKind.None && !l.githubClaimed && block.timestamp <= l.escrowDeadline) {
            revert GithubUnclaimed();
        }
        l.controller = controller;
        l.feeWallet = feeWallet;
        emit ControlChanged(token, controller, feeWallet);
    }

    /// @notice Registry-only: the GitHub identity proved itself. Hands over the fee right
    ///         and pays out the entire escrow backlog. Allowed even after the escrow window
    ///         (the claimant then gets control and any unswept remainder).
    function settleGithubClaim(address token, address claimant) external override onlyRegistry nonReentrant {
        Launch storage l = launches[token];
        if (!l.exists) revert UnknownToken();
        if (l.claimKind == ClaimKind.None) revert NotGithubLaunch();
        if (l.githubClaimed) revert AlreadyClaimed();
        if (claimant == address(0)) revert ZeroAddress();

        l.githubClaimed = true;
        l.controller = claimant;
        l.feeWallet = claimant;

        uint256 tokenOut = l.escrowedToken;
        uint256 wethOut = l.escrowedWeth;
        l.escrowedToken = 0;
        l.escrowedWeth = 0;
        if (tokenOut > 0) IERC20(token).safeTransfer(claimant, tokenOut);
        if (wethOut > 0) IERC20(weth).safeTransfer(claimant, wethOut);

        emit GithubClaimSettled(token, claimant, tokenOut, wethOut);
        emit ControlChanged(token, claimant, claimant);
    }

    function controllerOf(address token) external view override returns (address) {
        return launches[token].controller;
    }

    function feeWalletOf(address token) external view override returns (address) {
        return launches[token].feeWallet;
    }

    function githubBindingOf(address token)
        external
        view
        override
        returns (ClaimKind kind, uint256 githubId, bool claimed)
    {
        Launch storage l = launches[token];
        return (l.claimKind, l.githubId, l.githubClaimed);
    }

    /// @notice Escrow state for a token — what an unclaimed GitHub identity would receive
    ///         today, and until when. Zeroes for non-GitHub launches. Read surface for the
    ///         frontend ("unclaimed creator fees: X") and external indexers.
    function escrowOf(address token)
        external
        view
        returns (uint256 escrowedToken, uint256 escrowedWeth, uint64 escrowDeadline)
    {
        Launch storage l = launches[token];
        return (l.escrowedToken, l.escrowedWeth, l.escrowDeadline);
    }

    // --- fee collection ---

    /// @notice Collect this token's LP trading fees and split them per the launch snapshot.
    /// @dev Escrow accounting necessarily writes AFTER positionManager.collect() — the
    ///      amounts don't exist until it returns, so CEI cannot apply. Safe because every
    ///      state-writing entrypoint here shares the nonReentrant guard, setControl is
    ///      registry-only, and the callee is the canonical Uniswap position manager (no
    ///      callback path; FinchToken/WETH have no transfer hooks).
    // slither-disable-next-line reentrancy-no-eth
    function collect(address token) external nonReentrant {
        Launch storage l = launches[token];
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

        // Protocol-controlled accounting: bank the WETH fees we actually received, then
        // derive graduation from the running total. Accumulate BEFORE evaluating so the rate
        // applied here always agrees with what graduationOf() reports afterwards.
        uint256 feesBefore = l.lifetimeWethFees;
        uint256 feesAfter = feesBefore + wethAmt;
        l.lifetimeWethFees = feesAfter;
        bool graduated = feesAfter >= graduationFeeThreshold;
        // Chart marker: emitted exactly once, on the collect that crosses the threshold.
        if (graduated && feesBefore < graduationFeeThreshold) emit Graduated(token, feesAfter);

        // Graduated tokens pay a reduced protocol share; the freed bps go to the creator. The
        // <= guard means an unusually low-protocol launch simply gets no discount (never an
        // underflow).
        uint16 protocolBps = l.protocolShareBps;
        if (graduated && graduationBonusBps <= protocolBps) {
            protocolBps -= graduationBonusBps;
        }
        uint16 creatorBps = BPS - protocolBps;
        uint256 tokenToCreator = (tokenAmt * creatorBps) / BPS;
        uint256 wethToCreator = (wethAmt * creatorBps) / BPS;
        uint256 tokenToProtocol = tokenAmt - tokenToCreator;
        uint256 wethToProtocol = wethAmt - wethToCreator;

        // Referral: carve a slice of the PROTOCOL share for the referrer, before any branch.
        // Deliberately not applied to creator-share that later redirects to protocol on an
        // expired unclaimed GitHub launch — that stays whole for the buyback path.
        // Left at the zero default when there is no referrer — that is the intended value,
        // and both are read unconditionally below.
        // slither-disable-next-line uninitialized-local
        uint256 tokenToReferrer;
        // slither-disable-next-line uninitialized-local
        uint256 wethToReferrer;
        if (l.referrer != address(0) && referralShareBps > 0) {
            tokenToReferrer = (tokenToProtocol * referralShareBps) / BPS;
            wethToReferrer = (wethToProtocol * referralShareBps) / BPS;
            tokenToProtocol -= tokenToReferrer;
            wethToProtocol -= wethToReferrer;
        }

        if (l.claimKind != ClaimKind.None && !l.githubClaimed && block.timestamp <= l.escrowDeadline) {
            // Identity hasn't claimed yet: hold its share here until it does.
            l.escrowedToken += tokenToCreator;
            l.escrowedWeth += wethToCreator;
            if (tokenToCreator > 0 || wethToCreator > 0) {
                emit EscrowAccrued(token, tokenToCreator, wethToCreator, l.escrowedToken, l.escrowedWeth);
            }
            emit FeesCollected(token, 0, 0, tokenToProtocol, wethToProtocol);
        } else {
            if (l.claimKind != ClaimKind.None && !l.githubClaimed && l.feeWallet == address(0)) {
                // Window expired unclaimed and no post-expiry CTO: creator share follows
                // the swept escrow to the protocol recipient (buyback path).
                tokenToProtocol += tokenToCreator;
                wethToProtocol += wethToCreator;
                tokenToCreator = 0;
                wethToCreator = 0;
            } else {
                if (tokenToCreator > 0) IERC20(token).safeTransfer(l.feeWallet, tokenToCreator);
                if (wethToCreator > 0) IERC20(weth).safeTransfer(l.feeWallet, wethToCreator);
            }
            emit FeesCollected(token, tokenToCreator, wethToCreator, tokenToProtocol, wethToProtocol);
        }

        if (tokenToReferrer > 0) IERC20(token).safeTransfer(l.referrer, tokenToReferrer);
        if (wethToReferrer > 0) IERC20(weth).safeTransfer(l.referrer, wethToReferrer);
        if (tokenToReferrer > 0 || wethToReferrer > 0) {
            emit ReferralPaid(token, l.referrer, tokenToReferrer, wethToReferrer);
        }

        if (tokenToProtocol > 0) IERC20(token).safeTransfer(protocolFeeRecipient, tokenToProtocol);
        if (wethToProtocol > 0) IERC20(weth).safeTransfer(protocolFeeRecipient, wethToProtocol);
    }

    /// @notice After the escrow window passes unclaimed, anyone may sweep the escrow to the
    ///         protocol recipient, which funds the FINCH buyback-burn.
    function sweepEscrow(address token) external nonReentrant {
        Launch storage l = launches[token];
        if (!l.exists) revert UnknownToken();
        if (l.claimKind == ClaimKind.None || l.githubClaimed) revert NothingToSweep();
        if (block.timestamp <= l.escrowDeadline) revert EscrowNotExpired();

        uint256 tokenOut = l.escrowedToken;
        uint256 wethOut = l.escrowedWeth;
        if (tokenOut == 0 && wethOut == 0) revert NothingToSweep();
        l.escrowedToken = 0;
        l.escrowedWeth = 0;
        if (tokenOut > 0) IERC20(token).safeTransfer(protocolFeeRecipient, tokenOut);
        if (wethOut > 0) IERC20(weth).safeTransfer(protocolFeeRecipient, wethOut);

        emit EscrowSwept(token, tokenOut, wethOut);
    }

    // --- admin ---

    function setProtocolFeeRecipient(address recipient) external {
        if (msg.sender != admin) revert NotAdmin();
        if (recipient == address(0)) revert ZeroAddress();
        protocolFeeRecipient = recipient;
    }
}

# finchpad TODOS

## PR #8 review (monetization: referral / graduation rewards / featured) — 2026-07-22

Reviewed locally with a real Foundry+Slither toolchain (cloud CI couldn't run them).
CI now green on all 4 jobs. Fixed on the branch: SeedLocal stack-too-deep at
`forge build --sizes` (run() held 6 contracts + 4 tokens live through the console.log
block; now state vars), and 2 Slither Medium false positives (uninitialized-local on
the referrer amounts, unused-return in markGraduated).

- [x] **FIXED: graduation now uses protocol-controlled accounting.** The spot
      `IERC20(weth).balanceOf(pool)` read is gone from the money path. `collect()` banks the
      WETH fees the locker actually pays out (`lifetimeWethFees`) and derives graduation from
      that total; monotonic by construction, so `markGraduated()`, the `graduated` flag, the
      AlreadyGraduated/NotGraduated errors and the IFinchFactoryGraduation interface were all
      deleted. Original PoC re-run against the new code: 10 ETH donated, zero trades, fee
      bonus does NOT move. Threshold is an immutable ctor arg (default 0.25 ether via
      FINCH_GRAD_FEE_THRESHOLD ~= 25 ETH of buy volume at the 1% tier; uint256.max disables).
      `Graduated(token, lifetimeWethFees)` still fires once for chart markers. 87 Foundry +
      35 JS green, incl. a fuzz property that the accumulator advances by exactly the
      collected WETH and never by donations or token-side fees.
- [ ] **Decide: point the UI progress bar at the honest number.** The factory's
      `graduationStatus()` is untouched and still reads the pool balance — now purely
      cosmetic (no money depends on it), but a donation can still fake visible "traction" to
      lure buyers. Either drive the bar from `graduationOf()` (one honest number) or accept
      it as decorative. One-line frontend change.
- [x] **Renamed the paid badge to "boosted"** (your call, done on the branch). Anyone can
      buy it for any token including their own scam, so "verified" would have read as
      "vetted by finchpad" — the exact false assurance an anti-scam-spam pad must not sell.
      `verify()`->`boost()`, `verified`->`boosted`, `verifyPrice`->`boostPrice`,
      `Verified`->`Boosted`, `AlreadyVerified`->`AlreadyBoosted`,
      `FINCH_VERIFY_PRICE`->`FINCH_BOOST_PRICE`; ABI/seed/README follow. Nothing rendered
      it yet, so there was no migration. CI green on all 4 jobs.

## Stale branches cleaned 2026-07-22

- Deleted `claude/readme-update-vt2fpj` (fully merged into master) and
  `claude/security-audit-adoption-twk0ef` (PR #1 closed; content ported to master in
  04e1a1d, verified present before deleting).
- `ALCHEMY_RH_MAINNET` set as a repo secret: the public RH RPC now serves Cloudflare bot
  challenges to GitHub runners (13x HTTP 403, reproduced twice), so fork tests in CI need
  it. Fork job green with it set.

## Contract revision 2026-07-21 (user + repo claims, pre-claim escrow)

- [x] **ClaimKind {None, Repo, User}** replaces bare repoId across factory/locker/registry.
      User claims (bags.fm-style) sign over the OAuth'd account's own numeric id — no repo,
      no scopes, no admin check. EIP-712 struct is now
      `GithubClaim(address token,uint8 claimKind,uint256 githubId,address claimant,uint256 deadline)`;
      JS/contract digests re-cross-pinned for BOTH kinds.
- [x] **Pre-claim escrow** (closes the plan-vs-code gap): GitHub launches give the launcher
      no fee rights; creator share escrows in the locker until the identity claims (backlog
      paid on claim). 365-day expiry → `sweepEscrow()` by anyone → protocol recipient
      (buyback path); post-expiry unclaimed creator share follows it. Admin CTO is blocked
      while a binding is unclaimed and in-window (fee right belongs to the identity, not
      the admin), allowed after expiry.
- [x] **Observability for charts/DexScreener-style indexers**: indexed events
      `GithubBound(token, kind, githubId)`, `EscrowAccrued`, `GithubClaimSettled(token,
      claimant, amounts)` (the chart-bubble event), `EscrowSwept`; views `escrowOf()`,
      `githubBindingOf()`; API token detail now returns a `github{kind, githubId, claimed,
      escrow…}` object.
- [x] 97 tests green (64 unit/fuzz Foundry incl. new escrow-conservation property, 5 fork
      against live Uniswap, 28 JS). Sizes fine (max 8.4KB vs 96KB).
- [ ] Re-run the full Phase 5 pass (slither/manual) over the revision before audit —
      escrow is new money-holding surface. Self-review pass done 2026-07-21: found + fixed
      FeesCollected under-reporting the creator payout in the post-expiry-CTO branch
      (event-accuracy bug, indexers bill off that event); EscrowAccrued no longer emits
      zero-amount noise. CI Slither (fail-on: medium) green over the revision.

## Phase 3 website — started 2026-07-21

- [x] Token page GitHub surface: binding (kind + id), claimed pill, live escrow balance
      ("unclaimed creator fees"), claim-by deadline, and a claim button that launches the
      OAuth flow (typed-in payout wallet until wallet-connect lands).
- [x] PR #1 security fixes ported to master (XSS escapes incl. error messages, API param
      clamps); PR closed. Dependabot #2/#4/#5 merged, #3 applied manually (conflict).
- [ ] Wallet connect + submit claimGithub() tx from the returned signature.
- [ ] Launch / trade / lock / burn / CTO flows. No blind-signing.

## Needs the user (blocking next steps)

- [x] **Launch-curve economics: A (degen/fair-launch) CONFIRMED + IMPLEMENTED.** ~1 ETH
      implied start mcap, 4.2 ETH graduation marker. `src/lib/launchCurve.js` computes exact
      `initialSqrtPriceX96` + single-sided tick range per token (4/4 unit tests). Fork test
      now launches a real ~1 ETH-start token against live Uniswap and asserts the pool
      initializes at the curve-A price. Factory sweeps single-sided-mint dust to the creator.
- [ ] **Mainnet deploy (later, after Phase 5 audit).** Needs a funded deployer key (you run
      `Deploy.s.sol`, I never touch the key) + small real ETH on chain 4663.

## Contract follow-ups

- [x] **graduationStatus(token)** on the factory: returns (pairedPrincipal, threshold,
      graduated). Threshold 4.2 ETH. Fork-tested with a REAL buy through the live Uniswap
      router (0.05 WETH → 46.08M tokens, ~1.09 ETH implied mcap — curve A confirmed working).
- [ ] **Anvil mainnet-fork rehearsal env**: script to run a local fork + deploy + launch, so
      the frontend (Phase 3) has a real environment to point at (no live testnet with Uniswap).

## Phase 2 infra progress

- [x] **Swap indexing + OHLC** (`src/indexer/swaps.js`, `src/lib/ohlc.js`). Indexes V3 Swap
      events per pool, derives buy/sell from token ordering, prices from sqrtPriceX96,
      aggregates OHLCV candles. Validated on the live PONS pool: 112 real trades, 40 buys /
      72 sells, 47.85 WETH volume. Last candle close matched the pool's live slot0 price
      exactly (independent cross-check).
- [x] **RPC architecture split** (measured, not assumed): Alchemy free tier caps `eth_getLogs`
      at 10 blocks; the public RPC serves 500+ block spans. So `publicClient` (Alchemy) does
      contract reads/blocks and `logsClient` (public RPC) does log scanning. See
      `src/lib/chain.js`. Override via FINCHPAD_RPC_URL / FINCHPAD_LOGS_RPC_URL.
- [x] **Holder balances + concentration** (`src/indexer/holders.js`). Two-step for exactness:
      discover candidates from Transfer logs, then read balances via Multicall3 (verified
      deployed on 4663 at the canonical address). Reports burn amounts and top-N concentration
      as a rug-risk signal. **Self-validating**: computes supply coverage and refuses to
      present concentration as reliable when discovery is partial (`complete: false` flag for
      the frontend to gate on) — a wrong rug-risk number is worse than none. Complete data
      requires scanning from the token's TokenLaunched block.
- [x] **GitHub claim signer** (`src/backend/githubClaim.js`). Produces the EIP-712 attestation
      `FeeRightsRegistry.claimGithub()` verifies. **Cross-pinned**: the contract exposes
      `claimDigest()`, a Foundry test computes it for fixed fixtures, and a JS test asserts
      the signer produces the identical digest — so a domain/type drift between backend and
      contract fails a test instead of silently breaking claims in production. Also guards
      that repoId is GitHub's numeric id, never owner/name.
- [x] **GitHub OAuth built** (`src/backend/githubOauth.js`, mounted at `/auth/github/*`).
      User created the OAuth app (id+secret in `.env`); flow: single-use 10-min `state`
      binding token/claimant/repo → GitHub authorize → server-side code exchange → require
      `permissions.admin` → sign EIP-712 over the numeric repo id. 8 tests (mocked GitHub)
      cover state replay/expiry, admin gate, signature verification, and that the GitHub
      access token is never echoed. Works unsigned in dev (`signed:false`) until
      `FINCH_CLAIM_SIGNER_KEY` + `FINCH_REGISTRY` are provisioned. Module stays separate
      from the read API so production can run it isolated next to the signer key.
      - [ ] **Rotate the OAuth client secret** (it transited chat during setup) — flow is
            confirmed, rotation is now unblocked. One click in the OAuth app settings,
            then swap `GITHUB_CLIENT_SECRET` in `.env`.
      - [x] End-to-end browser test 2026-07-21: authorized on github.com, admin verified,
            numeric repoId 1307535933 returned, `signed:false` as designed (no signer key
            provisioned). Private repo required `GITHUB_OAUTH_SCOPE=repo`; public repos
            need no scope.
- [x] **Backend REST API** (`src/backend/api.js`, `npm run api`). Zero HTTP deps (this service
      sits next to a signing key; every dep is attack surface). Endpoints: `/health`,
      `/tokens`, `/tokens/:address`, `/tokens/:address/candles`, `/tokens/:address/trades`.
      Reads live off-chain with a TTL cache, so it runs today with no database. Verified
      against the live pons pool.
      - Fixed: `getLaunchedToken` returns a ZERO-FILLED struct for tokens not from that
        factory instead of reverting; the API was reporting `deployer: 0x0` / `poolFee: 0` as
        real. Now gated on `exists` and surfaced as `knownToFactory`.
- [x] **Postgres schema** (`src/backend/schema.sql`) for the persistent indexer. Response
      shapes stay identical when handlers switch from live reads to SQL.
- [x] **Alchemy: both RH networks enabled** (mainnet + testnet). Key in `.env` (gitignored).
      Indexer reads wired to Alchemy (`src/lib/chain.js`), 9/9 reference checks pass through it.
      Note: free-tier getLogs capped at 10 blocks → use Transfers API / Blockscout PRO for
      wide scans. See docs/robinhood-chain-reference.md (Alchemy support).

## Contract-design decisions from the Arbitrum/Robinhood findings

- [ ] **block.number semantics (launch protection).** RH Chain is Arbitrum: `block.number`
      is the L1 block estimate, advancing ~every 12s, NOT per L2 block. So `restrictionBlocks`
      is measured in ~12s units, not L2 blocks. This is SAFE (variance only extends
      protection) and matches pons. Decide: keep `block.number` (recommended, time-granular,
      pons-consistent) vs switch to `ArbSys.arbBlockNumber()` for per-L2-block precision.
      See docs/robinhood-chain-reference.md.

## Resolved

- **Testnet: no live rehearsal exists.** Robinhood testnet (chain 46630, RPC
  `https://rpc.testnet.chain.robinhood.com`, faucet `faucet.testnet.chain.robinhood.com`)
  is reachable but **Uniswap V3 is NOT deployed there** (verified: no code at the mainnet
  factory/position-manager/WETH addresses on testnet). The launch flow needs Uniswap, so:
  - Integration/QA = local **anvil fork of mainnet 4663** (real periphery, fake ETH, free).
  - First live deploy = **mainnet 4663**, gated behind the security audit. No cheap live
    test, so Phase 5 must be thorough.
- **GitHub escrow: expiry, unclaimed routes to FINCH buyback-burn.** After ~12 months
  unclaimed, escrowed fees feed the FINCH buyback-burn (not a treasury). Reuses the existing
  buyback path, transparent (public burn), on-theme.

## Deferred (tracked, not now)

- [ ] **Initial buy in the launch tx.** pons lets the creator buy in the same tx as launch.
      v1 skips it; creator can buy in a follow-up tx (launch protection already allows only
      the creator on the launch block). Add a router swap in `launch()` later.
- [ ] **FINCH buyback-burn keeper.** Locker routes protocol fees to `protocolFeeRecipient`;
      the buyback+burn runs downstream (TWAP keeper/contract), not in fee collection. Build
      the keeper. Launch FINCH through finchpad itself to give the buyback a market.
- [ ] **FinchLock streaming payments + airdrop tooling.** The rest of Streamflow. Separate
      product, not now.

## Phase 2 infra (not started)

- [ ] Extend indexer: Swap indexing per pool, OHLC, holders via Transfer, graduation polling.
- [ ] Backend REST API (token list/detail/price/chart/holders).
- [ ] GitHub OAuth + EIP-712 signer service (network-isolated; signer key in HSM/KMS).
- [ ] Postgres schema.

## Squeeze GitHub for everything free (revisit before web dev)

Worth doing because it's free infrastructure we're currently not using at all.

**Highest value first:**
- [x] **CI on every push** (`.github/workflows/ci.yml`) — 4 jobs: JS tests, Foundry tests
      (non-fork), fork tests against live RPC, Slither. Fork tests use the `ALCHEMY_RH_MAINNET`
      repo secret via `FORK_RPC_URL` when set, else fall back to the public RPC (works today
      with zero secrets — verified locally, 5/5 fork tests pass through the fallback).
- [x] **Slither in CI** (`crytic/slither-action`, `fail-on: medium`) — safe to enforce now:
      the Phase 5 audit left zero High/Medium findings (17 remaining are all Low/Info/accepted).
      Config at `contracts/slither.config.json` filters lib/test/script.
- [ ] **Secret scanning + push protection — BLOCKED: paid on private repos.** API returns
      "Secret scanning is not available for this repository" (it's GitHub Secret Protection,
      paid for private repos; free only if the repo goes public). Ties into the visibility
      decision below. Meanwhile: keys stay in gitignored `.env` only.
- [x] **Dependabot** — vuln alerts + automated security fixes enabled via API;
      `.github/dependabot.yml` adds weekly npm + github-actions version PRs.
      Noise caveat: most alerts (48 on day one) come from the vendored
      `contracts/lib/openzeppelin-contracts` devDependency lockfile — dev tooling of a
      pinned library, not our attack surface. Closed its two auto-PRs; dismiss those
      alerts in bulk on the security tab if the count bothers you. Our own deps: viem
      only, clean.
- [ ] **Branch protection on master — BLOCKED: needs GitHub Pro or a public repo** (403
      "Upgrade to GitHub Pro or make this repository public"). Also a visibility-decision item.

**Free only if the repo goes PUBLIC** (ties back to the visibility decision):
- [ ] **CodeQL** — free for public repos; private needs paid GitHub Advanced Security.
- [ ] **GitHub Pages** — free static hosting for public repos. Our frontend is a single static
      HTML file, so Pages could host the read-only UI for nothing. Private repos need Pro/Team.

**Also free, lower priority:**
- [ ] Codespaces (60 core-hours/month free) — a ready dev env without local setup.
- [ ] Releases + tags for versioned contract deployments (which address ran which commit).
- [ ] Issues/Projects instead of this markdown file, once there's more than one person.

## Phase 3 website (not started)

- [ ] Launch / trade / token page / lock / burn / claim / CTO flows. No blind-signing.

## Phase 5 security gate (before mainnet)

- [ ] Contracts: slither, solhint, Foundry invariant + echidna fuzz, external audit.
      Focus: reentrancy on `collect()`, registry authorizer access control, EIP-712 replay,
      signer-key custody, launch/graduation front-run.
- [ ] Website/backend: `/security-review` on the diff, OAuth (state+PKCE), signer isolation,
      dependency scan, no secrets in frontend.
- [ ] Lint note to check: `forge lint` flagged `erc20-unchecked-transfer` at
      FeeRightsRegistry.sol:102 (likely false positive — the registry does no token transfers;
      confirm during the audit pass).
- [ ] Legal: US securities / money-transmitter review before mainnet with real funds.

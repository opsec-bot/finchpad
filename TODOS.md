# finchpad TODOS

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
- [ ] **GitHub OAuth — BLOCKED ON USER.** Needs a GitHub OAuth app (client id + secret) that
      only the project owner can create. Flow is documented in `src/backend/githubClaim.js`:
      authorize → GET /repos/{owner}/{name} → require `permissions.admin` → sign with the
      numeric `id`. Everything downstream of OAuth is built and tested.
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
- [ ] **CI on every push** (`.github/workflows/ci.yml`) — `forge test` + `npm test` + `forge build --sizes`.
      Free tier gives 2,000 Actions min/month on private repos. Catches regressions and builds
      an audit trail an external auditor can actually look at. Use `foundry-rs/foundry-toolchain`.
      Note: fork tests need an RPC secret (`ALCHEMY_RH_MAINNET`) in repo secrets, or gate them
      behind a `--match-path` so CI can run the non-fork suite without credentials.
- [ ] **Slither in CI** (`crytic/slither-action`) — fail the build on new High/Medium findings.
      We're at zero High; CI keeps it that way instead of relying on me remembering to re-run it.
- [ ] **Secret scanning + push protection** — free on all repos now. Would physically block a
      committed key. Given how many keys have moved through this project (Blockscout, Alchemy,
      the Telegram bot token), this one is not theoretical.
- [ ] **Dependabot** — free vuln alerts + auto-PRs for npm deps. `npm audit` is clean today;
      this keeps it that way without anyone checking.
- [ ] **Branch protection on master** — require CI green before merge.

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

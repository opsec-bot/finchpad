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
- [ ] Backend REST API + Postgres schema.
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

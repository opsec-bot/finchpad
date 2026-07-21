<!-- finchpad build plan. Draft 1, 2026-07-21. Awaiting review pass. -->

# finchpad build plan

A token launchpad on Robinhood Chain (chain 4663), pons-style V3 launches plus a
fee-rights layer: creator redirects, community takeovers (CTO), GitHub-verified fee
claims, and burns.

**Sequence the user asked for:** contracts, then infra, then website, all tested
locally first, then live deployment, with a security-review gate on contracts AND
website before anything goes live.

---

## The one idea the whole thing rests on

CTO, GitHub claims, and "send fees to someone" are the same on-chain action:
change a token's fee-payout wallet. The locker exposes `setFeeRedirect(token, wallet)`.
Everything else is just *who is allowed to call it, and how they prove it*.

| Feature       | Who proves what                                  | Verifier         |
| ------------- | ------------------------------------------------ | ---------------- |
| redirect      | current creator signs a tx                       | on-chain, cheap  |
| CTO           | community requests, admin reviews abandonment    | human (off-chain)|
| GitHub claim  | repo admin proves ownership via OAuth            | backend + EIP-712|

So we build ONE `FeeRightsRegistry` with pluggable authorizers, not three features.
That is the cheapest coherent v1, and it is the same shape pons ships (their CTO is a
form plus an admin `setFeeRedirect`).

---

## Current state (done, validated)

The indexer read layer already works against live chain state.

- `src/lib/` chain client, pons addresses + ABIs, chunked `getLogs`.
- `verifyReference.js` reads the known graduated PONS token end-to-end. 9/9 checks pass.
- `backfill.js` pulled 93 real launches from the last 5k blocks in 0.8s.

This proves the event shapes and read paths. finchpad's factory will emit a
`TokenLaunched` event matching the pons shape so this indexer keeps working unchanged.

---

## Phase 1: Contracts

Tooling: Foundry. `forge` is NOT installed yet. Install is step one.
Target testnet 46630 first, mainnet 4663 only after the security gate.

Four contracts. All immutable once deployed (pons ships new versions as new addresses,
we do the same).

### 1a. FinchToken (ERC-20, fixed 1e9 supply)
- Self-describing on-chain: `name`, `symbol`, `logo`, `description`, `liquidityPool`,
  `socials(twitter, telegram, discord, website, farcaster)`. Matches pons so the
  indexer reads it with the same ABI.
- Launch protection (anti-snipe), copied from pons behavior:
  - launch block: only the creator's initial buy executes
  - next 2 blocks: max 5% supply held per wallet, max 5.5% bought per wallet
  - sells and wallet-to-wallet transfers never restricted
  - all limits end at `restrictionsEndBlock`
- **Holder burns (pump.fun-style)**: extends OpenZeppelin `ERC20Burnable`, so any holder
  can call `burn(amount)` to destroy their own tokens and reduce total supply for real (no
  dead-address fudge). This is the per-token trust/hype flex ("dev burned 30%"), distinct
  from the protocol FINCH buyback-burn. Contract detail: the launch-protection hook MUST
  exempt transfers to `address(0)`, or a burn inside the anti-snipe window trips the
  wallet-cap check. "Fixed supply" means no MINT function; burning down is allowed.
- Deployed via EIP-1167 minimal proxy (`Clones.clone`) to cut per-launch gas ~90%.
  This matters: the active pons pad did 42,709 launches in a day.

### 1b. FinchFactory
- `launchToken(params)` in ONE transaction: deploy token clone, create + initialize the
  Uniswap V3 pool (1% fee tier), mint a concentrated LP position (NFT), hand the NFT to
  the locker. No bonding curve, no later migration. Pool is live from block one.
- Snapshots the fee split per token at launch (default 80/20 creator/protocol, undercutting
  pons' 70/30). Immutable per token afterward (pons does this, legacy tokens are stuck at
  90/10 forever). One-way door.
- 0.0005 ETH launch fee.
- Emits `TokenLaunched(token, deployer, dexFactory, pairToken, pool, dexId,
  launchConfigId, positionId, restrictionsEndBlock, initialBuyAmount)` matching pons.
- Reads: `getLaunchedToken(token)`, `graduationStatus(token)`, `locker()`.
- Graduation at 4.2 ETH paired is a progress marker only. Trading never moves pools.

### 1c. FinchLocker
- Holds the LP position NFTs. Liquidity is locked, cannot be pulled.
- `collect(token)` harvests V3 trading fees (accrue in both token and WETH).
- Distributes per the snapshotted split: creator share to the payout wallet, protocol
  share to the protocol recipient.
- `setFeeRedirect(token, wallet)` changes the creator payout wallet. GATED by the
  registry (see 1d), not open to the locker admin alone.

### 1d. FeeRightsRegistry (the finchpad addition)
- Owns the authorization for "who may redirect fees for token X."
- Authorizers:
  - **creator**: the current creator signs, redirects immediately.
  - **CTO** (RESOLVED per your call: manual request + admin review): community submits a
    request, an admin reviews for genuine abandonment, admin approves, registry allows the
    `setFeeRedirect`. Same model as pons. No on-chain vote, no inactivity timer.
  - **GitHub claim (two kinds, bags.fm-style)**: a launch may bind its fee right to a
    GitHub **repo** (claimed by a repo admin, verified via OAuth) or a GitHub **user**
    (claimed by that account simply OAuth-ing — no permission check needed). Backend signs
    an EIP-712 message `(token, claimKind, githubId, claimant, deadline)`; the registry
    verifies against the trusted signer. Bind to GitHub's NUMERIC ids, never names
    (repos/usernames get renamed and re-registered, a squatter could claim someone else's
    fees). **Pre-claim escrow**: GitHub launches give the launcher NO fee rights — the
    creator share escrows in the locker until the identity claims (killing launch-on-a-
    famous-repo fee farming); claims pay out the full backlog; after 365 days unclaimed,
    anyone can sweep the escrow to the protocol recipient (FINCH buyback path). Full
    lifecycle emitted as indexed events (GithubBound / EscrowAccrued / GithubClaimSettled /
    EscrowSwept) so charts and external indexers (DexScreener-style) can render claim
    markers and per-creator token lists from logs alone.
- **Burns (RESOLVED: FINCH buyback-burn)**: 80% of protocol fees (matching pons) fund a
  buyback of the FINCH platform token via the V3 router, then burn to `0xdead`. The value
  is the buyback (real revenue, real buy pressure), the burn just distributes it pro-rata
  to FINCH holders via scarcity. Requires FINCH to exist and trade, so FINCH is launched
  THROUGH finchpad itself once the pad works (dogfood, like PONS is a pons token). This is
  a discretionary lever early (pons keeps theirs mutable); path to immutable/automated TWAP
  later. Only spins on real launch volume.

### 1e. FinchLock (Streamflow-style token locking + vesting)
The anti-rug trust primitive. On a pad positioned against scam-spam, a creator locking
their own allocation on a public schedule is a credible "I can't dump on you" signal.
- Any holder can lock any ERC-20 on a schedule: cliff and/or linear vest, beneficiary,
  start/end. Publicly verifiable, surfaced on the token page ("creator locked 20% until
  2027-01").
- Build on OpenZeppelin `VestingWallet` primitives, do not hand-roll the schedule math.
- **IN scope:** allocation locks + cliff/linear vesting for ANY ERC-20 (not just finchpad
  tokens), read API for the UI. Measure actual balance received on deposit so fee-on-
  transfer / rebasing tokens can't desync the accounting.
- **OUT of scope (defer, this is the rest of Streamflow, a separate product):** streaming
  payroll/payments, airdrop distribution tooling. Note in TODOS, do not build now.

### Contract risks to design against from day one
- Reentrancy on `collect()` and the fee-distribution path. Holds user funds.
- EIP-712 replay: nonce, deadline, chainId, domain separator all required.
- The GitHub signer key is a crown-jewel secret. If it leaks, every unclaimed escrow is
  drainable. It lives in an HSM/KMS or behind a multisig, never a hot `.env`.
- Locker admin key can redirect any token's fees. This is the honest centralization
  tradeoff. pons is upfront that CTO approval is administrative. Expect disputes.
- Front-run window on launch and graduation. Do pool creation + liquidity + lock
  atomically in the launch tx.

---

## Phase 2: Infra

### 2a. Indexer (extend what exists)
- Add Swap indexing per registered pool (topic0 known). Derive buy/sell from amount signs
  and token ordering (`token < pairToken`).
- OHLC aggregation for charts.
- Holder balances via Transfer events.
- Graduation via polling `graduationStatus(token)` (no migration event exists).
- Postgres. Reorg handling. Backfill in bounded block chunks (public RPC times out on
  wide ranges, already handled in `logs.js`).

### 2b. Backend API
- REST for the frontend: token list, token detail, live price, chart series, holders,
  graduation progress. Node, reuses the viem client patterns already in `src/lib`.

### 2c. GitHub OAuth + EIP-712 signer service (isolated)
- OAuth (with `state` + PKCE) → confirm the user has admin on the repo → sign the EIP-712
  claim. This service holds the signer key and MUST be network-isolated from the public
  API. Its only job is: verify GitHub, sign, return signature.

### 2d. Database schema
- tokens, launches, swaps, holders, ohlc, fee_claims, cto_requests, github_escrows, locks.

---

## Phase 3: Website

- **Launch flow**: name, symbol, logo, description, socials, fee wallet → factory tx.
  Wallet approves. finchpad never holds funds or keys.
- **Trade**: V3 swaps via the router, slippage control, price impact display.
- **Token page**: live price, chart, holders, graduation progress bar, socials, plus any
  active FinchLock schedules ("creator locked 20% until 2027-01") as a trust signal.
- **Lock flow**: pick token + amount + cliff/linear schedule → FinchLock tx. Surfaced back
  on the token page.
- **Burn action**: any holder burns their own tokens of a launched coin via `burn(amount)`.
  Token page shows total burned + burn-adjusted market cap live.
- **Claim / CTO / redirect flows**: creator redirect, GitHub claim (OAuth → signature →
  tx), CTO request form.
- Wallet connect. No private keys ever touched. No blind-signing patterns (this is the
  same drainer surface as the bagsfumbled scam we traced earlier, build the opposite).

---

## Phase 4: Local testing (before any deploy)

- **Foundry unit + fuzz/invariant tests**: pool math, launch-protection caps, fee-split
  immutability, locker distribution accounting, registry authorization, EIP-712 replay,
  FinchLock vesting math (nothing releasable before cliff, total released never exceeds
  locked), holder burn (reduces total supply, allowed during the anti-snipe window because
  `address(0)` is exempt).
- **Fork tests** against Robinhood testnet 46630, plus a mainnet 4663 fork for realistic
  Uniswap V3 periphery (position manager, router, quoter).
- **anvil** local chain for fast iteration.
- **Frontend e2e** against local + testnet.
- **Indexer** already validated against the reference token for reads; add swap/OHLC
  validation against a known graduated pool.

Gate: everything green locally before Phase 5.

---

## Phase 5: Security review (HARD GATE before go-live)

Nothing touches mainnet with real funds until both halves pass.

### Contracts
- Static: `slither`, `solhint`.
- Fuzz/invariant: Foundry invariant suite + `echidna` on the fee-accounting and
  authorization invariants.
- Focused manual review: reentrancy on `collect()`/redirect, access control on locker
  admin and every registry authorizer, EIP-712 replay, signer-key custody, launch/
  graduation front-run.
- External audit strongly recommended before mainnet. Testnet bug-bounty window first.

### Website + backend
- Run the `/security-review` skill on the diff.
- OAuth flow (state, PKCE, redirect validation), signer-service isolation, API authz,
  input validation, no secrets in the frontend bundle, CSP headers.
- `npm audit` / dependency scan.
- Verify no wallet-drainer or blind-sign patterns in the signing UX.

---

## Phase 6: Live deployment

1. **Testnet 46630**: deploy factory/locker/registry, run the full launch → trade →
   graduate → claim → CTO flow, monitor.
2. **Mainnet 4663**: deploy the immutable contracts, verify source on Blockscout, seed,
   canary-monitor the first launches.
3. Contracts are immutable. Get it right. New versions ship as new addresses.

---

## Open decisions (need your call before Phase 1 finalizes)

1. **RESOLVED** CTO trigger: manual request + admin review (your "CTO request").

2. **RESOLVED** Burns: FINCH buyback-burn, 80% of protocol fees. FINCH launched through
   finchpad itself. Discretionary early, path to immutable TWAP later.

3. **RESOLVED** Token locking: add FinchLock (cliff/linear vesting) as an anti-rug trust
   signal. Streaming payments + airdrop tooling deferred (separate product).

4. **RESOLVED** Platform fee split: 80/20 creator-favorable. Undercut pons on creator take
   to pull launches. Immutable per token, one-way door. Protocol revenue per trade is
   lower, the bet is more launches make up for it.

5. **RESOLVED** FinchLock accepts ANY ERC-20, not just finchpad tokens. Standalone trust
   tool. Vesting contract never trusts token behavior for accounting; handle fee-on-
   transfer / rebasing tokens by measuring actual balance received on deposit.

6. **RESOLVED** Unclaimed GitHub escrow: escrow WITH EXPIRY (~12 months), and unclaimed fees
   route into the **FINCH buyback-burn** (not a treasury). Reuses the existing buyback path,
   transparent public burn, on-theme. Fees accrue in an escrow keyed by numeric repoId until
   claimed; after expiry the sweep sends them to the buyback.

7. **RESOLVED (testing reality)** No live testnet rehearsal: Robinhood testnet (46630) has no
   Uniswap V3. Integration testing = local anvil fork of mainnet 4663. First live deploy is
   mainnet, gated behind the Phase 5 audit.

---

## Regulatory reality (not optional)

Taking a fee cut on token launches raises US securities and money-transmitter questions.
Buyback-and-burn can look like a dividend to a regulator. Robinhood Chain being
Robinhood-affiliated gives zero cover, it is a permissionless L2. Talk to a lawyer before
mainnet with real money. This is a Phase 5 gate item, not a someday item.

---

## Status

Foundry 1.7.1 (`~/.foundry/bin`), OpenZeppelin 5.6.1, solc 0.8.30 / optimizer 300 /
`via_ir`. **Entire contract layer built and tested: 44/44 Foundry tests green**, including
a full launch against the real Robinhood Chain Uniswap V3 periphery on a mainnet fork.

| Contract | What | Tests |
|---|---|---|
| FinchToken | fixed 1e9, ERC20Burnable holder burns, self-describing, launch protection | 14 |
| FinchLocker | holds locked LP, collects + splits fees, gated fee-rights control | 7 |
| FeeRightsRegistry | creator redirect / handoff / admin CTO / EIP-712 GitHub claim | 12 |
| FinchLock | any-ERC20 cliff/linear vesting, fee-on-transfer safe | 9 |
| Fork (smoke + full launch) | real V3 periphery: clone → pool → single-sided LP → lock, at the curve-A price | 2 |
| launchCurve.js (JS) | curve A math: target mcap → sqrtPrice + single-sided ticks | 4 |

**49 tests green** (45 Foundry + 4 JS). Launch curve = **A (degen/fair-launch)** confirmed:
~1 ETH implied start mcap, 4.2 ETH graduation marker. The fork test launches a real curve-A
token against live Uniswap AND executes a real buy through the router (0.05 WETH bought
46.08M tokens ≈ 1.09 ETH implied mcap — curve A behaving exactly as designed).
`graduationStatus()` is live. Deploy script at `contracts/script/Deploy.s.sol` (key at runtime).

**Phase 2 started:** swap indexing + OHLC candles working against the live PONS pool (112 real
trades indexed; last candle close matched the pool's slot0 price exactly). RPC split by
measurement — Alchemy for reads, public RPC for logs (Alchemy free caps getLogs at 10 blocks).

All contracts well under size limits (largest FinchToken 8.3KB vs 96KB chain limit).

**Not done (needs the user or a later phase):** production launch-curve economics (the fork
test used plumbing values at tick 0), testnet deploy (needs a funded key + testnet RPC URL),
initial-buy-in-launch-tx (deferred), Phase 2 infra, Phase 3 website, Phase 5 security gate.

- Indexer read layer built and validated (9/9 reference checks).
- `codex` not installed (autoplan review runs subagent-only without it).

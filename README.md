# finchpad

A token launchpad on **Robinhood Chain** (chain 4663), modeled on [pons](https://docs.ponsfamily.com/)
with a fee-rights layer on top: community takeovers (CTO), GitHub-verified fee claims,
creator fee redirects, token locking/vesting, and buyback-burns.

## Model (inherited from pons)

- Launch deploys a fixed-supply (1e9) ERC-20 **and** its Uniswap V3 pool in one transaction.
- Liquidity is locked immediately; the LP position is an NFT held by a locker.
- Every token trades against WETH at a 1% pool fee. **No bonding curve, no migration.**
- "Graduation" (default 4.2 ETH paired) is a progress marker only — trading never moves pools.
- Fee split is snapshotted per token at launch and is immutable afterward.

See [`docs/pons-protocol-reference.md`](docs/pons-protocol-reference.md) for the full scraped
spec and [`docs/robinhood-chain-reference.md`](docs/robinhood-chain-reference.md) for the chain.

## The finchpad addition: a fee-rights registry

CTO, GitHub claims, and "send fees to someone" are the **same primitive** — authorizing a
change to a token's fee-payout wallet (`setControl` on the locker) — with different verifiers:

| Feature      | Verifier                                              |
| ------------ | ----------------------------------------------------- |
| redirect     | the current controller signs on-chain                 |
| CTO          | an admin executes a reviewed abandonment takeover     |
| GitHub claim | backend verifies repo/user ownership, signs EIP-712   |

GitHub launches bind the fee right to a numeric GitHub identity (a repo id or a user id)
instead of the launcher. Until that identity claims, the creator share accrues in **escrow**
in the locker — the launcher gets nothing — which kills the "launch a token on a famous repo
and farm the fees" grift. A successful claim pays out the whole escrow backlog; if nobody
claims within the escrow window, the escrow sweeps to the protocol recipient and feeds the
buyback-burn.

## Revenue & growth

The protocol's take is a **20% cut of the 1% trading fee** (creator keeps 80% — deliberately
more generous than pons' 70/30) plus a flat `0.0005 ETH` launch fee. Three growth-aligned
mechanisms sit on top, none of which raise that headline take, and none of which pay token
holders a share of revenue (so they stay clear of dividend/security questions):

- **Referrals** — a launch may name a `referrer`, who earns a slice of the *protocol* share on
  every trade of that token (default 10% of the 20%, i.e. 2% of a trade). Funded entirely from
  the protocol side; the creator's 80% is never touched. A launcher can't refer themselves.
- **Graduation rewards** — the 4.2-ETH graduation milestone is now real: once `markGraduated`
  latches a token past the threshold, its protocol share drops (default 20% → 15%), the freed
  bps going to the creator. Rewards successful tokens and gamifies pushing volume to the line.
- **Featured placement** (`FeatureBoost`) — pay ETH to feature a token in the UI for N days or
  buy a one-time "boosted" badge. Standalone contract, pure advertising margin to the treasury,
  never touches the fee path.

The referral rate and graduation bonus are locker-level deploy dials (`referralShareBps`,
`graduationBonusBps`); featuring prices are admin-settable on `FeatureBoost`.

## Contracts (`contracts/`, Foundry)

- `FinchToken` — fixed-supply (1e9), self-describing on-chain, holder-burnable, EIP-1167
  clone with pons-style anti-snipe launch protection.
- `FinchFactory` — one-transaction launch: clone a token, create + initialize its V3 pool,
  deposit the full supply as single-sided liquidity, hand the locked LP to the locker.
  Launch-curve economics are passed in per launch (computed off-chain), not hardcoded.
- `FinchLocker` — holds each launch's locked LP position, collects and splits trading fees
  per the launch snapshot, and is the source of truth for who controls a token's fee rights
  (including the GitHub escrow accounting).
- `FeeRightsRegistry` — the single place that authorizes fee-rights changes: `redirectFees`/
  `handoff` (controller signs), `approveCTO` (admin), and `claimGithub` (EIP-712 against a
  trusted signer key).
- `FinchLock` — Streamflow-style locking + vesting for any ERC-20 (cliff/linear). The
  anti-rug primitive: a creator locking their own allocation is a verifiable "I can't dump."
- `FeatureBoost` — standalone paid featured-placement + "boosted"-badge contract (see
  Revenue & growth above). Not wired into the factory or locker.

Tests cover unit, fuzz (`Fuzz.t.sol`), a claim-digest cross-check, and mainnet-fork launch/
smoke tests (`ForkLaunch.t.sol`, `ForkSmoke.t.sol`).

```bash
cd contracts
forge build
forge test                     # unit + fuzz
forge test --match-path 'test/Fork*.t.sol'   # needs a mainnet fork RPC
```

> The GitHub signer key is a trusted component: if it leaks, any GitHub-launched token is
> claimable. It must live in an HSM/KMS or behind a multisig — never a hot wallet.

## Backend + indexer (`src/`)

- `src/lib/` — chain client, contract addresses + ABIs (pons reference **and** finchpad's
  own), chunked `getLogs`, OHLC aggregation, and read helpers shared by the CLIs and API.
- `src/backend/api.js` — read-only HTTP API serving the frontend (launches, token detail,
  price, candles, trades). Reads live off-chain with a TTL cache, so it runs today with no
  database; a Postgres indexer (`schema.sql`) can back it later without changing response
  shapes. Zero HTTP dependencies on purpose — it sits next to a signing key.
- `src/backend/githubOauth.js` + `githubClaim.js` — GitHub OAuth flow and EIP-712 claim
  signing. The digest is cross-pinned against the contract in the test suite.
- `src/indexer/` — `backfill.js` (launch events in bounded chunks), `swaps.js` (trades +
  OHLCV candles), `holders.js` (exact balances + concentration via Multicall3), and
  `verifyReference.js` (reads a known graduated pons token end-to-end and asserts pool,
  supply, WETH pairing, graduation, fee split, and live price).

```bash
npm install
npm run verify:reference        # validate read paths against live chain state
npm run api                     # read API + frontend on :8787
npm test                        # node --test
node src/indexer/swaps.js <token> --from <n> --to <n> --interval 300
```

The API and indexer default to the live pons factory so they return real data before
finchpad deploys; finchpad's own factory/locker addresses drop into `src/lib/contracts.js`
once the contracts ship.

## Frontend (`web/`)

`web/index.html` — a single-page, no-build token explorer (launch list, token detail,
candles, trades, holder concentration), served from the same origin as the API.

## Local development

Robinhood's testnet (46630) has no Uniswap V3 deployed, so the launch flow can't run there.
The dev scripts fork mainnet instead, giving the real Uniswap periphery with fake money:

```bash
npm run dev:fork                # boot anvil forking RH mainnet (leave running)
npm run dev:seed                # deploy finchpad on the fork + seed launches/trades
```

Seeding impersonates a clean address via anvil — no private key lives in this repo.

## Security

Internal reviews live in [`docs/security-audit.md`](docs/security-audit.md) and
[`docs/security-adoption-report.md`](docs/security-adoption-report.md). Contracts are
pre-mainnet and unaudited by a third party; treat the signer key and admin roles as
trusted components accordingly.

## License

MIT

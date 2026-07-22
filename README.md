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
cp .env.example .env            # one config file for backend, Foundry, and the frontend
npm install                     # backend deps (viem only)
npm run web:install             # frontend deps (separate package, see below)

npm run api                     # builds the frontend, then serves API + app on :8787
npm run api:only                # API alone, skips the frontend build
npm run web:dev                 # live-reload frontend on :5173, proxying the API
npm run verify:reference        # validate read paths against live chain state
npm test                        # node --test
```

**Config lives in one file: the repo-root `.env`** (copy it from `.env.example`). The API,
the Foundry deploy scripts, and the frontend build all read it. The one rule to remember:
**anything named `VITE_*` is public** — Vite inlines those into the browser bundle everyone
downloads. Everything without that prefix (`GITHUB_CLIENT_SECRET`, `ALCHEMY_*`,
`PRIVATE_KEY`) stays server-side and never reaches the browser.

Because `VITE_*` values are baked in at build time, `:8787` serves whatever was last built —
after changing a `VITE_*` var, re-run `npm run api` (which rebuilds) or `npm run web:build`.
For frontend work use `npm run web:dev` on `:5173` instead, which hot-reloads.

The API and indexer default to the live pons factory so they return real data before
finchpad deploys; finchpad's own factory/locker addresses drop into `src/lib/contracts.js`
once the contracts ship.

## Frontend (`web/`)

A Vite + React app: token explorer (launch list, detail, candles, trades, graduation and
GitHub-claim state) plus the launch flow, with wallet connection via
[Privy](https://privy.io) — external wallets or an embedded wallet created on login, so
someone with no wallet can still launch a token.

It is a **separate npm package** on purpose. The backend will eventually sit next to a
signing key, so it keeps a deliberately tiny dependency surface (viem only); React, Vite and
the wallet stack never enter that process. `npm run api` serves the built output from
`web/dist` with a CSP, `nosniff`, and an extension-allowlisted asset handler.

Write actions stay disabled until `VITE_FINCH_FACTORY` is set, so nothing is sent before the
contracts exist — point it at a local deployment via `npm run dev:fork` + `npm run dev:seed`.

## Local development

The launch flow needs Uniswap V3, and Robinhood's testnet does not have it — so local
development runs against an **anvil fork of mainnet**: real Uniswap periphery, fake money.

```bash
npm run dev:fork     # terminal 1: anvil forking chain 4663 on :8545 (leave running)
npm run dev:seed     # terminal 2: deploys finchpad + seeds 4 tokens and real trades
```

`dev:seed` prints the exact command to point the API at the fork. **Use it verbatim** —
in particular `FINCHPAD_MIN_BLOCK`, which is not optional: anvil proxies `eth_getLogs` for
pre-fork blocks to the upstream RPC, and Alchemy's free tier rejects any range wider than 10
blocks, so a scan crossing the fork base fails and the launch list comes back empty. Pinning
the floor to the fork base keeps every scan inside local blocks.

Both scripts are Node, not shell, so they run on Windows too (`npm run` there shells to cmd,
where `bash` resolves to the WSL relay rather than Git Bash).

`dev:seed` broadcasts in `--slow` mode (one transaction per block). That is not politeness:
the seed buys each token immediately after launching it, and batched into one block a buy
lands inside that token's anti-snipe window and reverts — the pool's transfer to the buyer
fails and surfaces as Uniswap's opaque `TF`. Slow mode makes the seed deterministic.

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

# finchpad

A token launchpad on **Robinhood Chain** (chain 4663), modeled on [pons](https://docs.ponsfamily.com/)
with a fee-rights layer on top: community takeovers (CTO), GitHub-verified fee claims,
creator fee redirects, and burns.

## Model (inherited from pons)

- Launch deploys a fixed-supply (1e9) ERC-20 **and** its Uniswap V3 pool in one transaction.
- Liquidity is locked immediately; the LP position is an NFT held by a locker.
- Every token trades against WETH at a 1% pool fee. **No bonding curve, no migration.**
- "Graduation" (default 4.2 ETH paired) is a progress marker only — trading never moves pools.
- Fee split is snapshotted per token at launch and is immutable afterward.

See [`docs/pons-protocol-reference.md`](docs/pons-protocol-reference.md) for the full scraped spec.

## The finchpad addition: a fee-rights registry

CTO, GitHub claims, and "send fees to someone" are the **same primitive** — authorizing a
change to a token's fee-payout wallet (`setFeeRedirect` on the locker) — with different
verifiers:

| Feature      | Verifier                                    |
| ------------ | ------------------------------------------- |
| redirect     | the current creator signs                   |
| CTO          | an admin reviews an abandonment request     |
| GitHub claim | backend verifies repo ownership, signs EIP-712 |

Burns follow the pons pattern: route a share of protocol fees through the V3 router into the
burn address. (Design decisions on trigger/target still open — see conversation notes.)

## Status

**Indexer read/discovery layer — working and validated against live chain state.**

- `src/lib/` — chain client, contract addresses + ABIs, chunked `getLogs` helper.
- `src/indexer/verifyReference.js` — reads the known graduated PONS token end-to-end and
  asserts pool, supply, WETH pairing, graduation, 90/10 fee split, and live price. **9/9 pass.**
- `src/indexer/backfill.js` — backfills `TokenLaunched` from a factory in bounded block chunks
  (the public RPC times out on wide ranges).

```bash
npm install
npm run verify:reference                     # validate read paths against live state
node src/indexer/backfill.js active --from <n> --to <n> --chunk 1000
```

The indexer currently points at the pons factories as its validation target; finchpad's own
factory/locker addresses drop into `src/lib/contracts.js` once the contracts ship.

## Not yet built

- `contracts/` — finchpad factory + locker + `FeeRightsRegistry` (Foundry, target testnet 46630 first).
- Swap indexing per registered pool + OHLC aggregation.
- GitHub OAuth backend + EIP-712 signer (the signer key is a trusted component — HSM/multisig).
- Frontend.

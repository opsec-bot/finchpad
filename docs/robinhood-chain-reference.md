# Robinhood Chain reference

Scraped from https://docs.robinhood.com/chain on 2026-07-21. What matters for finchpad.

## What it is

A permissionless, EVM-compatible L2 built on **Arbitrum Dedicated Blockchains** (Arbitrum
Orbit / Nitro), not OP Stack. Native gas token ETH. ERC-4337 account abstraction supported.
Sequencer orders transactions **first-come-first-served by arrival time** — no MEV priority
gas auctions (higher fees do NOT reorder queued txs).

## Networks

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Alchemy RPC | `https://robinhood-mainnet.g.alchemy.com/v2/{KEY}` | `https://robinhood-testnet.g.alchemy.com/v2/{KEY}` |
| Sequencer WS feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |
| Explorer | robinhoodchain.blockscout.com | explorer.testnet.chain.robinhood.com |
| Faucet | n/a | faucet.testnet.chain.robinhood.com (0.05 ETH / 24h) |

**Uniswap V3 is NOT on testnet** (verified: no code at the mainnet periphery addresses).
Integration testing = local anvil fork of mainnet. First live deploy = mainnet.

## Arbitrum differences that touch OUR contracts

### block.number — the big one
`block.number` returns an **estimate of the L1 (Ethereum) block number**, updating only
**periodically (~every 12s)**, NOT per L2 block. Many L2 transactions share one
`block.number`. The real L2 block number comes from the ArbSys precompile at
`0x0000000000000000000000000000000000000064`, `arbBlockNumber()`.

**Impact on FinchToken launch protection** (uses `block.number`):
- `restrictionBlocks = 3` is NOT ~3 L2 blocks. It is ~3 L1 ticks ≈ **~36 seconds**.
- "launch block only creator buys" = the ~12s that `block.number` holds its launch value.
- This is **safe** — any timing variance extends protection (block.number advancing slower =
  longer window), never bypasses it. And a ~12-36s TIME window is arguably a *better*
  anti-snipe than a sub-second L2-block window would be.
- **Consistent with pons** — pons also uses block-number restrictions (`restrictionsEndBlock`
  in its TokenLaunched event). We match the incumbent.
- **Decision:** keep `block.number` (time-granular, pons-consistent) OR switch to
  `ArbSys.arbBlockNumber()` for precise per-L2-block windows. Recommend keeping block.number;
  set `restrictionBlocks` understanding each unit ≈ 12s.

### First-come-first-served sequencing (helps us)
No priority-gas auctions means snipers can't outbid to jump the queue. Combined with the
creator-only launch window, anti-snipe is stronger here than on Ethereum L1. The graduation
front-run risk I flagged earlier is also softened (can't buy priority ordering).

### Other differences (checked against our code)
- `block.prevrandao` / `block.difficulty` return constants — not randomness. We use none. OK.
- `blockhash(n)` reliable only for recent blocks. We use none. OK.
- `gasleft()` behaves differently. We don't branch on it. OK.
- **Address aliasing**: L1→L2 messages arrive with an aliased `msg.sender`. Only matters for
  cross-chain messaging, which we don't do. Note for any future bridge integration.
- **Two-component gas**: L2 execution + L1 data (calldata) fee. Launch cost is dominated by
  the metadata strings (name/logo/description/socials) in calldata. pons stores metadata
  on-chain too; if launch fees ever bite, move heavy metadata off-chain (IPFS hash on-chain).
- **Sequencer compliance filtering**: sanctioned addresses may be excluded at the sequencer.
  Product note, not a contract issue.
- **Contract size**: 96 KB code / 192 KB init code (vs Ethereum 24 KB). Our largest is 8.3 KB.

### EVM version
Uniswap V4 (transient storage, a Cancun feature) is live on mainnet, so Cancun opcodes are
supported. Our `foundry.toml` uses `evm_version = "cancun"` — consistent. Cheap way to
confirm our compiler output actually deploys: push FinchLock (no external deps) to testnet
46630 with a faucet-funded key.

## Alchemy support (scraped from dashboard 2026-07-21)

Both endpoints ENABLED on our app (`Gian's First App`). Key in `.env` (gitignored).

| | Mainnet | Testnet |
|---|---|---|
| Network enum | `robinhood-mainnet` | `robinhood-testnet` |
| Chain ID | 4663 | 46630 |
| RPC | `https://robinhood-mainnet.g.alchemy.com/v2/{KEY}` | `https://robinhood-testnet.g.alchemy.com/v2/{KEY}` |
| Services | 9/16 | 10/16 (adds Smart Wallets) |

**Supported (both):** Node API, NFT API, Token API, Prices API, **Transfers API**, Bundler
API, Gas Manager, **Websockets**, **Webhooks**. Testnet also: Smart Wallets.

**NOT supported (request-only):** Debug API, **Trace API**, Block Timestamp API, Transaction
Receipts API, userOp Simulation API, gRPC.

### What this means for the finchpad indexer
- **Free-tier `eth_getLogs` is capped at a 10-block range.** Fine for tip-following and
  forward-indexing from our own factory's deploy block; not for millions of blocks of history
  (use Blockscout PRO for wide historical scans — no such cap).
- **Transfers API (`alchemy_getAssetTransfers`)** is supported → fetch token transfer history
  (holder balances) WITHOUT the 10-block getLogs limit. Preferred path for holders.
- **Webhooks** supported → push-based real-time indexing (Address Activity / Custom webhooks
  notify our backend of new launches + swaps) instead of polling. Good Phase 2 architecture.
- **Trace / Debug NOT supported** → no `debug_traceTransaction` / internal-tx traces. We
  index via events (logs), so this doesn't block us.
- **Bundler + Gas Manager + Smart Wallets** → ERC-4337 available if we ever want gasless /
  smart-wallet launches (Phase 3+).

Indexer read path is wired to Alchemy (`src/lib/chain.js`); verified 9/9 reference checks
pass through it.

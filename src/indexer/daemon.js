// The persistent indexer daemon. Tails the chain and writes launches, swaps and referral
// payouts to SQLite so the API can serve all-time data (token list, trade history, protocol
// stats) instead of a bounded block-window scan.
//
// Usage:
//   node --env-file=.env src/indexer/daemon.js [--once] [--interval MS]
//
// Design:
//  - Resumable: a cursor row survives restarts; each pass re-scans a REORG_DEPTH overlap and
//    prunes that window first, so shallow reorgs correct themselves (PK dedupe handles the rest).
//  - One writer: this process owns the write lock; the API opens the same file read-only (WAL).
//  - trader = tx.from — the pool's Swap event only names the router, and "traders" stats need
//    the human. Fetched once per unique tx with bounded concurrency.

import { formatEther } from "viem";
import { publicClient } from "../lib/chain.js";
import { getLogsChunked } from "../lib/logs.js";
import { PONS, SWAP, TOKEN_LAUNCHED, FINCH_LAUNCHED, REFERRAL_PAID, GITHUB_CLAIM_SETTLED, finchFactoryAbi, finchLockerAbi, tokenAbi } from "../lib/contracts.js";
import { openDb, upsertToken, insertSwap, insertReferralPayout, setTokenGithubBinding, markGithubClaimed, pruneFromBlock, getCursor, setCursor } from "./db.js";

const FACTORY = process.env.FINCH_FACTORY;
if (!FACTORY) {
  console.error("FINCH_FACTORY is not set — nothing to index.");
  process.exit(1);
}

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const intervalArg = args.indexOf("--interval");
const INTERVAL_MS = intervalArg >= 0 ? Number(args[intervalArg + 1]) : Number(process.env.FINCHPAD_INDEX_INTERVAL_MS || 5000);
const REORG_DEPTH = 30n;
const CHUNK = 1000n;
const MIN_BLOCK = process.env.FINCHPAD_MIN_BLOCK ? BigInt(process.env.FINCHPAD_MIN_BLOCK) : null;

const db = openDb();
const lc = (s) => s.toLowerCase();

/** Bounded-concurrency map. */
async function pmap(items, fn, concurrency = 8) {
  const out = [];
  for (let i = 0; i < items.length; i += concurrency) {
    out.push(...(await Promise.all(items.slice(i, i + concurrency).map(fn))));
  }
  return out;
}

const locker = await publicClient
  .readContract({ address: FACTORY, abi: finchFactoryAbi, functionName: "locker" })
  .catch(() => null);

console.log(`finchpad indexer · factory ${FACTORY} · locker ${locker ?? "n/a"} · db ready`);

// One-time backfill: rows indexed before binding support (github_kind=0) get their binding
// read now, so the claim menu sees them without waiting for a full re-index.
if (locker) {
  const unbound = db.prepare("SELECT address FROM tokens WHERE github_kind = 0").all();
  let bound = 0;
  for (const t of unbound) {
    const b = await publicClient
      .readContract({ address: locker, abi: finchLockerAbi, functionName: "githubBindingOf", args: [t.address] })
      .catch(() => null);
    if (b && Number(b[0]) !== 0) {
      setTokenGithubBinding(db, t.address, { kind: Number(b[0]), githubId: b[1], claimed: b[2] });
      bound++;
    }
  }
  if (bound > 0) console.log(`backfilled github bindings for ${bound} token(s)`);
}

async function pass() {
  const head = await publicClient.getBlockNumber();
  const cursor = getCursor(db, "main");
  let from = cursor !== null ? BigInt(cursor) - REORG_DEPTH : (MIN_BLOCK ?? (head > 50_000n ? head - 50_000n : 0n));
  if (MIN_BLOCK !== null && from < MIN_BLOCK) from = MIN_BLOCK;
  if (from < 0n) from = 0n;
  if (from > head) return;

  // 1. launches — both event shapes, so one indexer serves a pons or finch factory alike.
  const [ponsL, finchL] = await Promise.allSettled([
    getLogsChunked({ address: FACTORY, event: TOKEN_LAUNCHED, fromBlock: from, toBlock: head, chunkSize: CHUNK }),
    getLogsChunked({ address: FACTORY, event: FINCH_LAUNCHED, fromBlock: from, toBlock: head, chunkSize: CHUNK }),
  ]);
  if (ponsL.status === "rejected" && finchL.status === "rejected") {
    throw new Error(`launch scan failed: ${finchL.reason?.shortMessage || finchL.reason?.message}`);
  }
  const launches = [
    ...(ponsL.status === "fulfilled" ? ponsL.value : []).map((l) => ({ log: l, isFinch: false })),
    ...(finchL.status === "fulfilled" ? finchL.value : []).map((l) => ({ log: l, isFinch: true })),
  ];

  for (const { log, isFinch } of launches) {
    const token = log.args.token;
    const [symbol, name, decimals] = await Promise.all([
      publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }).catch(() => "?"),
      publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }).catch(() => "?"),
      publicClient.readContract({ address: token, abi: tokenAbi, functionName: "decimals" }).catch(() => 18),
    ]);
    upsertToken(db, {
      address: token,
      symbol,
      name,
      decimals: Number(decimals),
      pool: log.args.pool,
      tokenIsToken0: isFinch ? log.args.tokenIsToken0 : lc(token) < lc(PONS.weth),
      deployer: isFinch ? log.args.creator : log.args.deployer,
      factory: FACTORY,
      launchBlock: Number(log.blockNumber),
      launchTx: log.transactionHash,
      initialBuyEth: log.args.initialBuyAmount ? Number(formatEther(log.args.initialBuyAmount)) : 0,
    });
    // GitHub binding is set at launch and never re-bound, so one read at index time is the
    // whole story (the claimed flag is kept fresh by the GithubClaimSettled scan below).
    if (locker) {
      const b = await publicClient
        .readContract({ address: locker, abi: finchLockerAbi, functionName: "githubBindingOf", args: [token] })
        .catch(() => null);
      if (b && Number(b[0]) !== 0) {
        setTokenGithubBinding(db, token, { kind: Number(b[0]), githubId: b[1], claimed: b[2] });
      }
    }
  }

  // 2. swaps — one chunked scan across every known pool (getLogs takes an address array).
  const tokens = db.prepare("SELECT address, pool, token_is_token0 FROM tokens").all();
  const byPool = new Map(tokens.map((t) => [t.pool, t]));
  let swapRows = [];
  if (byPool.size > 0) {
    const logs = await getLogsChunked({
      address: [...byPool.keys()],
      event: SWAP,
      fromBlock: from,
      toBlock: head,
      chunkSize: CHUNK,
    });

    // Timestamps per unique block, trader (tx.from) per unique tx.
    const blocks = [...new Set(logs.map((l) => l.blockNumber))];
    const tsOf = new Map(
      (await pmap(blocks, (b) => publicClient.getBlock({ blockNumber: b }))).map((b) => [b.number, Number(b.timestamp)]),
    );
    const txs = [...new Set(logs.map((l) => l.transactionHash))];
    const fromOf = new Map(
      (await pmap(txs, (h) => publicClient.getTransaction({ hash: h }).catch(() => null)))
        .filter(Boolean)
        .map((tx) => [tx.hash, tx.from]),
    );

    swapRows = logs.map((l) => {
      const t = byPool.get(lc(l.address));
      const tokenRaw = t.token_is_token0 ? l.args.amount0 : l.args.amount1;
      const wethRaw = t.token_is_token0 ? l.args.amount1 : l.args.amount0;
      const s = Number(l.args.sqrtPriceX96) / 2 ** 96;
      const p = s * s;
      return {
        blockNumber: Number(l.blockNumber),
        logIndex: Number(l.logIndex),
        token: t.address,
        txHash: l.transactionHash,
        ts: tsOf.get(l.blockNumber) ?? 0,
        side: wethRaw > 0n ? "buy" : "sell",
        tokenAmount: Number(formatEther(tokenRaw < 0n ? -tokenRaw : tokenRaw)),
        wethAmount: Number(formatEther(wethRaw < 0n ? -wethRaw : wethRaw)),
        priceWeth: t.token_is_token0 ? p : 1 / p,
        trader: fromOf.get(l.transactionHash) ?? null,
      };
    });
  }

  // 3. referral payouts off the locker.
  let refRows = [];
  if (locker) {
    const logs = await getLogsChunked({ address: locker, event: REFERRAL_PAID, fromBlock: from, toBlock: head, chunkSize: CHUNK })
      .catch(() => []);
    const blocks = [...new Set(logs.map((l) => l.blockNumber))];
    const tsOf = new Map(
      (await pmap(blocks, (b) => publicClient.getBlock({ blockNumber: b }))).map((b) => [b.number, Number(b.timestamp)]),
    );
    refRows = logs.map((l) => ({
      blockNumber: Number(l.blockNumber),
      logIndex: Number(l.logIndex),
      token: l.args.token,
      referrer: l.args.referrer,
      tokenAmount: Number(formatEther(l.args.tokenAmount)),
      wethAmount: Number(formatEther(l.args.wethAmount)),
      ts: tsOf.get(l.blockNumber) ?? 0,
      txHash: l.transactionHash,
    }));
  }

  // 3b. claim settlements — flip github_claimed so the claim menu stops offering the token.
  let settled = [];
  if (locker) {
    settled = await getLogsChunked({ address: locker, event: GITHUB_CLAIM_SETTLED, fromBlock: from, toBlock: head, chunkSize: CHUNK })
      .catch(() => []);
  }

  // 4. commit atomically: prune the re-scan window, insert fresh, advance the cursor.
  db.exec("BEGIN");
  try {
    pruneFromBlock(db, Number(from));
    for (const r of swapRows) insertSwap(db, r);
    for (const r of refRows) insertReferralPayout(db, r);
    for (const l of settled) markGithubClaimed(db, l.args.token);
    setCursor(db, "main", Number(head));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (launches.length || swapRows.length || refRows.length) {
    console.log(
      `[${new Date().toISOString()}] blocks ${from}→${head}: +${launches.length} launches, ` +
        `${swapRows.length} swaps, ${refRows.length} referral payouts`,
    );
  }
}

if (ONCE) {
  await pass();
  console.log("single pass complete");
  process.exit(0);
}

// Tail forever. Failures log and retry next tick — a flaky RPC must not kill the daemon.
for (;;) {
  try {
    await pass();
  } catch (err) {
    console.error(`indexer pass failed: ${err.shortMessage || err.message}`);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

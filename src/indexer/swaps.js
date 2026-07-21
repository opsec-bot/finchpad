// Index Uniswap V3 Swap events for a launched token's pool, normalize them into trades
// (side, amounts, price), and aggregate OHLCV candles.
//
// Usage:
//   node --env-file=.env src/indexer/swaps.js <tokenAddress> [--from N] [--to N] [--chunk N] [--interval S]
//
// Defaults: last 5000 blocks, chunk 1000, 5-minute candles.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { formatEther } from "viem";
import { publicClient } from "../lib/chain.js";
import { getLogsChunked } from "../lib/logs.js";
import { PONS, SWAP, tokenAbi } from "../lib/contracts.js";
import { toCandles } from "../lib/ohlc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { token: positional[0], flags };
}

const { token, flags } = parseArgs(process.argv.slice(2));
if (!token) {
  console.error("usage: swaps.js <tokenAddress> [--from N] [--to N] [--chunk N] [--interval S]");
  process.exit(1);
}

// Resolve the pool straight off the token (launch tokens are self-describing).
const pool = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "liquidityPool" });
const symbol = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" });
const tokenIsToken0 = token.toLowerCase() < PONS.weth.toLowerCase();

const latest = await publicClient.getBlockNumber();
const toBlock = flags.to ? BigInt(flags.to) : latest;
const fromBlock = flags.from ? BigInt(flags.from) : toBlock - 5000n;
const chunkSize = flags.chunk ? BigInt(flags.chunk) : 1000n;
const interval = flags.interval ? Number(flags.interval) : 300;

console.log(`\nfinchpad · swap index for ${symbol} (${token})`);
console.log(`pool ${pool} | tokenIsToken0=${tokenIsToken0}`);
console.log(`blocks ${fromBlock} → ${toBlock} (chunk ${chunkSize})\n`);

const logs = await getLogsChunked({
  address: pool,
  event: SWAP,
  fromBlock,
  toBlock,
  chunkSize,
  onProgress: ({ from, found, total }) => {
    if (found > 0) process.stdout.write(`  block ${from}: +${found} (total ${total})\n`);
  },
});

// Fetch timestamps for the distinct blocks we saw (bounded concurrency).
const uniqueBlocks = [...new Set(logs.map((l) => l.blockNumber))];
const timestamps = new Map();
const CONCURRENCY = 8;
for (let i = 0; i < uniqueBlocks.length; i += CONCURRENCY) {
  const slice = uniqueBlocks.slice(i, i + CONCURRENCY);
  const blocks = await Promise.all(slice.map((b) => publicClient.getBlock({ blockNumber: b })));
  blocks.forEach((b) => timestamps.set(b.number, Number(b.timestamp)));
}

/** sqrtPriceX96 -> WETH per token */
function priceFromSqrt(sqrtPriceX96) {
  const s = Number(sqrtPriceX96) / 2 ** 96;
  const token1PerToken0 = s * s;
  return tokenIsToken0 ? token1PerToken0 : 1 / token1PerToken0;
}

const trades = logs
  .map((l) => {
    const { amount0, amount1, sqrtPriceX96, sender, recipient } = l.args;
    // Signed from the pool's perspective: positive = flowing INTO the pool.
    const tokenRaw = tokenIsToken0 ? amount0 : amount1;
    const wethRaw = tokenIsToken0 ? amount1 : amount0;
    const side = wethRaw > 0n ? "buy" : "sell"; // WETH into the pool = someone bought the token
    return {
      block: Number(l.blockNumber),
      timestamp: timestamps.get(l.blockNumber) ?? 0,
      txHash: l.transactionHash,
      side,
      tokenAmount: Number(formatEther(tokenRaw < 0n ? -tokenRaw : tokenRaw)),
      wethAmount: Number(formatEther(wethRaw < 0n ? -wethRaw : wethRaw)),
      priceWeth: priceFromSqrt(sqrtPriceX96),
      sender,
      recipient,
    };
  })
  .sort((a, b) => a.timestamp - b.timestamp || a.block - b.block);

const candles = toCandles(trades, interval);

const buys = trades.filter((t) => t.side === "buy");
const sells = trades.filter((t) => t.side === "sell");
const volWeth = trades.reduce((s, t) => s + t.wethAmount, 0);

await mkdir(DATA_DIR, { recursive: true });
const outPath = join(DATA_DIR, `swaps-${symbol}-${token.slice(0, 8)}.json`);
await writeFile(
  outPath,
  JSON.stringify(
    { token, symbol, pool, tokenIsToken0, fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), interval, trades, candles },
    null,
    2
  )
);

console.log(`\ntrades: ${trades.length}  (buys ${buys.length} / sells ${sells.length})`);
console.log(`volume: ${volWeth.toFixed(4)} WETH`);
console.log(`candles: ${candles.length} @ ${interval}s`);
if (candles.length) {
  const f = candles[0];
  const l = candles[candles.length - 1];
  console.log(`  first  o=${f.o.toExponential(4)} c=${f.c.toExponential(4)} trades=${f.trades}`);
  console.log(`  last   o=${l.o.toExponential(4)} c=${l.c.toExponential(4)} trades=${l.trades}`);
}
console.log(`→ ${outPath}`);

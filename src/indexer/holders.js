// Holder balances + concentration for a launched token.
//
// Two-step, so balances are EXACT rather than reconstructed:
//   1. discover candidate holders from Transfer events (logs, wide-range RPC)
//   2. read balanceOf for each via Multicall3 (exact current state, one call per batch)
//
// Concentration is a rug-risk signal — the token page surfaces it, which is the whole
// anti-scam positioning. A dev holding 40% is something buyers should see before they ape.
//
// Usage:
//   node --env-file=.env src/indexer/holders.js <tokenAddress> [--from N] [--to N] [--chunk N] [--top N]
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { formatEther, getAddress, zeroAddress } from "viem";
import { publicClient } from "../lib/chain.js";
import { getLogsChunked } from "../lib/logs.js";
import { TRANSFER, tokenAbi } from "../lib/contracts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const DEAD = "0x000000000000000000000000000000000000dEaD";
const INITIAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

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
  console.error("usage: holders.js <tokenAddress> [--from N] [--to N] [--chunk N] [--top N]");
  process.exit(1);
}

const [symbol, totalSupply, pool] = await Promise.all([
  publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
  publicClient.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply" }),
  publicClient.readContract({ address: token, abi: tokenAbi, functionName: "liquidityPool" }),
]);

const latest = await publicClient.getBlockNumber();
const toBlock = flags.to ? BigInt(flags.to) : latest;
const fromBlock = flags.from ? BigInt(flags.from) : toBlock - 5000n;
const chunkSize = flags.chunk ? BigInt(flags.chunk) : 1000n;
const topN = flags.top ? Number(flags.top) : 10;

console.log(`\nfinchpad · holders for ${symbol} (${token})`);
console.log(`discovery blocks ${fromBlock} → ${toBlock} (chunk ${chunkSize})\n`);

// 1. Discover candidate addresses from Transfer events.
const logs = await getLogsChunked({
  address: token,
  event: TRANSFER,
  fromBlock,
  toBlock,
  chunkSize,
  onProgress: ({ from, found, total }) => {
    if (found > 0) process.stdout.write(`  block ${from}: +${found} transfers (total ${total})\n`);
  },
});

const candidates = new Set();
for (const l of logs) {
  const { from, to } = l.args;
  if (from && from !== zeroAddress) candidates.add(getAddress(from));
  if (to && to !== zeroAddress) candidates.add(getAddress(to));
}
console.log(`\ndiscovered ${candidates.size} candidate addresses from ${logs.length} transfers`);

// 2. Exact balances via Multicall3.
const addresses = [...candidates];
const balances = [];
const BATCH = 200;
for (let i = 0; i < addresses.length; i += BATCH) {
  const slice = addresses.slice(i, i + BATCH);
  const results = await publicClient.multicall({
    contracts: slice.map((a) => ({
      address: token,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [a],
    })),
    allowFailure: true,
  });
  results.forEach((r, j) => {
    if (r.status === "success" && r.result > 0n) balances.push({ address: slice[j], balance: r.result });
  });
}

balances.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));

// 3. Concentration + burn metrics.
const circulating = totalSupply;
const poolBal = balances.find((b) => getAddress(b.address) === getAddress(pool))?.balance ?? 0n;
const deadBal = balances.find((b) => getAddress(b.address) === getAddress(DEAD))?.balance ?? 0n;
// Exclude the pool (that's liquidity, not a holder) from concentration.
const realHolders = balances.filter(
  (b) => getAddress(b.address) !== getAddress(pool) && getAddress(b.address) !== getAddress(DEAD)
);
const heldByHolders = realHolders.reduce((s, b) => s + b.balance, 0n);
const topSlice = realHolders.slice(0, topN);
const topSum = topSlice.reduce((s, b) => s + b.balance, 0n);
const pct = (part, whole) => (whole === 0n ? 0 : Number((part * 10000n) / whole) / 100);

const burnedBySupply = INITIAL_SUPPLY > totalSupply ? INITIAL_SUPPLY - totalSupply : 0n;

// Self-validating completeness check. Discovery only sees addresses that transferred inside
// the scanned range, so a narrow range silently misses most holders. If accounted supply
// (holders + pool + burn address) doesn't cover ~all of totalSupply, the concentration
// numbers are NOT trustworthy — and a wrong rug-risk signal is worse than none.
const accounted = heldByHolders + poolBal + deadBal;
const coveragePct = pct(accounted, circulating);
const complete = coveragePct >= 99;
const report = {
  token,
  symbol,
  pool,
  complete,
  supplyCoveragePct: coveragePct,
  scannedFromBlock: fromBlock.toString(),
  scannedToBlock: toBlock.toString(),
  totalSupply: formatEther(totalSupply),
  burnedViaBurnFn: formatEther(burnedBySupply),
  sentToDeadAddress: formatEther(deadBal),
  inPool: formatEther(poolBal),
  holderCount: realHolders.length,
  heldByHolders: formatEther(heldByHolders),
  topNConcentrationPctOfHeld: pct(topSum, heldByHolders),
  topNConcentrationPctOfSupply: pct(topSum, circulating),
  top: topSlice.map((b) => ({
    address: b.address,
    balance: formatEther(b.balance),
    pctOfSupply: pct(b.balance, circulating),
  })),
};

await mkdir(DATA_DIR, { recursive: true });
const outPath = join(DATA_DIR, `holders-${symbol}-${token.slice(0, 8)}.json`);
await writeFile(outPath, JSON.stringify(report, null, 2));

if (!complete) {
  console.log(`\n!! PARTIAL DATA — only ${coveragePct}% of supply accounted for.`);
  console.log(`   Discovery only sees addresses that transferred within the scanned range.`);
  console.log(`   Concentration numbers below are NOT reliable. Re-run with --from <launch block>`);
  console.log(`   (for a finchpad token: the block of its TokenLaunched event).`);
}

console.log(`\nholders (excl. pool + burn addr): ${report.holderCount}`);
console.log(`supply: ${Number(report.totalSupply).toLocaleString()} ${symbol}`);
console.log(`  in pool:        ${Number(report.inPool).toLocaleString()}`);
console.log(`  burned (burn fn): ${Number(report.burnedViaBurnFn).toLocaleString()}`);
console.log(`  sent to 0xdead: ${Number(report.sentToDeadAddress).toLocaleString()}`);
console.log(
  `top ${topN} hold ${report.topNConcentrationPctOfHeld}% of holder-held supply (${report.topNConcentrationPctOfSupply}% of total)` +
    (complete ? "" : "  <-- UNRELIABLE, partial data")
);
report.top.slice(0, 5).forEach((h, i) => {
  console.log(`  ${i + 1}. ${h.address}  ${Number(h.balance).toLocaleString()}  (${h.pctOfSupply}%)`);
});
console.log(`→ ${outPath}`);

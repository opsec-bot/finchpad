// Backfill TokenLaunched events from a factory into data/launches-<factory>.json.
// This is the authoritative discovery path: index the factory's TokenLaunched
// events, and each emitted `pool` becomes a Swap-indexing target downstream.
//
// Usage:
//   node src/indexer/backfill.js [active|legacy] [--from N] [--to N] [--chunk N]
//
// Defaults: factory=active, from=factory.startBlock, to=latest, chunk=2000.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { formatEther } from "viem";
import { publicClient } from "../lib/chain.js";
import { getLogsChunked } from "../lib/logs.js";
import { PONS, TOKEN_LAUNCHED } from "../lib/contracts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { which: positional[0] || "active", flags };
}

const { which, flags } = parseArgs(process.argv.slice(2));
const factoryKey = which === "legacy" ? "legacyFactory" : "activeFactory";
const factory = PONS[factoryKey];

const fromBlock = flags.from ? BigInt(flags.from) : factory.startBlock;
const toBlock = flags.to ? BigInt(flags.to) : await publicClient.getBlockNumber();
const chunkSize = flags.chunk ? BigInt(flags.chunk) : 2000n;

console.log(`\nfinchpad · backfill ${factoryKey} ${factory.address}`);
console.log(`blocks ${fromBlock} → ${toBlock} (${toBlock - fromBlock + 1n} blocks, chunk ${chunkSize})\n`);

const started = Date.now();
const logs = await getLogsChunked({
  address: factory.address,
  event: TOKEN_LAUNCHED,
  fromBlock,
  toBlock,
  chunkSize,
  onProgress: ({ from, found, total }) => {
    if (found > 0) process.stdout.write(`  block ${from}: +${found} (total ${total})\n`);
  },
});

// Normalize into a stable, serializable launch record keyed by token address.
const launches = logs.map((l) => ({
  token: l.args.token,
  deployer: l.args.deployer,
  pool: l.args.pool,
  pairToken: l.args.pairToken,
  dexFactory: l.args.dexFactory,
  positionId: l.args.positionId?.toString(),
  restrictionsEndBlock: l.args.restrictionsEndBlock?.toString(),
  initialBuyAmount: l.args.initialBuyAmount ? formatEther(l.args.initialBuyAmount) : "0",
  block: l.blockNumber?.toString(),
  txHash: l.transactionHash,
}));

await mkdir(DATA_DIR, { recursive: true });
const outPath = join(DATA_DIR, `launches-${which}.json`);
await writeFile(
  outPath,
  JSON.stringify(
    { factory: factory.address, fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), count: launches.length, launches },
    null,
    2
  )
);

console.log(`\n${launches.length} launches → ${outPath}`);
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

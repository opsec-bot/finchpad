#!/usr/bin/env node
// Deploy finchpad onto the local anvil fork and seed it with real launches + trades.
// Requires `npm run dev:fork` to already be running.
//
// NO PRIVATE KEY IS USED. We impersonate a clean address via anvil and let forge broadcast
// unlocked, so nothing secret lives in this repo.
//
// Why not anvil's default accounts: all five of them carry EIP-7702 delegations on Robinhood
// Chain mainnet pointing at a sweeper contract. A mainnet fork inherits that state, so paying
// them the launch fee triggers the delegate and sweeps the balance (this actually happened —
// the seed ran out of funds mid-run). Their private keys are public, so someone set that up
// on purpose. Never send real funds to a default dev address on this chain.
//
// Node rather than bash so this runs on Windows too; the anvil cheatcodes are plain JSON-RPC,
// so this no longer shells out to `cast` at all.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { foundryBin, onSpawnError } from "./foundry.mjs";

const RPC = "http://localhost:8545";
// Verified to have no code on Robinhood Chain mainnet (so the fork inherits nothing).
const DEV_ADDR = process.env.DEV_ADDR || "0xC97df7BE376BAf3EdC44110e232aeCEa881AEA1e";

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

/**
 * Print the exact command to point the API at this fork.
 *
 * FINCHPAD_MIN_BLOCK is not optional here. anvil proxies eth_getLogs for pre-fork blocks to
 * the upstream RPC, and Alchemy's free tier rejects any range wider than 10 blocks — so a
 * scan that crosses the fork base fails outright and the launch list silently comes back
 * empty. Pinning the floor to the fork base keeps every scan inside local blocks.
 */
async function printPointer() {
  let forkBase;
  try {
    forkBase = (await rpc("anvil_nodeInfo"))?.forkConfig?.forkBlockNumber;
  } catch {
    /* older anvil without anvil_nodeInfo — fall through */
  }
  console.log("");
  console.log("=== point the API at this fork ===");
  console.log("Run the API with (note FINCHPAD_MIN_BLOCK — without it the launch list is empty):");
  console.log("");
  console.log(
    [
      "  FINCHPAD_RPC_URL=http://localhost:8545",
      "FINCHPAD_LOGS_RPC_URL=http://localhost:8545",
      forkBase ? `FINCHPAD_MIN_BLOCK=${forkBase}` : "FINCHPAD_MIN_BLOCK=<fork base block>",
      "\
    npm run api -- --factory <FinchFactory printed above>",
    ].join(" "),
  );
  console.log("");
  console.log("And in .env for the frontend:");
  console.log("  VITE_RPC_URL=http://localhost:8545");
  console.log("  VITE_FINCH_FACTORY=<FinchFactory printed above>");
}

async function main() {
  try {
    await rpc("eth_chainId");
  } catch {
    console.error("anvil not reachable on :8545 — start `npm run dev:fork` first");
    process.exit(1);
  }

  // Guard: if the chosen address somehow has code on the fork, bail loudly rather than
  // produce a confusing OutOfFunds halfway through.
  const code = await rpc("eth_getCode", [DEV_ADDR, "latest"]);
  if (code && code !== "0x") {
    console.error(`ERROR: ${DEV_ADDR} has code on the fork (likely a 7702 delegation). Pick another.`);
    console.error("Set DEV_ADDR to an address with no code on Robinhood Chain mainnet.");
    process.exit(1);
  }

  console.log(`funding + impersonating ${DEV_ADDR}`);
  await rpc("anvil_setBalance", [DEV_ADDR, "0x21e19e0c9bab2400000"]); // 10,000 ETH
  await rpc("anvil_impersonateAccount", [DEV_ADDR]);

  const contracts = join(dirname(fileURLToPath(import.meta.url)), "..", "contracts");
  const forge = foundryBin("forge");
  const child = spawn(
    forge,
    [
      "script",
      "script/SeedLocal.s.sol",
      "--rpc-url",
      RPC,
      "--broadcast",
      "--unlocked",
      "--sender",
      DEV_ADDR,
      // One transaction per block, waiting for each receipt.
      //
      // Without this, forge fires the whole batch and anvil packs several into one block.
      // The seed buys each token right after launching it, so a buy could land inside that
      // token's anti-snipe window (restrictionBlocks = 2) and revert — the pool's transfer
      // to the buyer fails, surfacing as Uniswap's opaque "TF". That made the seed
      // non-deterministic: same script, different tokens failing per run. Slow mode
      // guarantees blocks advance between a launch and its buys.
      "--slow",
    ],
    { stdio: "inherit", cwd: contracts },
  );

  child.on("error", onSpawnError("forge"));
  child.on("exit", async (code) => {
    if (code === 0) await printPointer();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

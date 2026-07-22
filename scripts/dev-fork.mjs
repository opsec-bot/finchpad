#!/usr/bin/env node
// Boot a local anvil forking Robinhood Chain mainnet.
//
// Why a fork and not the testnet: Robinhood's testnet (46630) has NO Uniswap V3 deployed, so
// the launch flow cannot run there at all. Forking mainnet gives us the real Uniswap
// periphery with fake money.
//
// Node rather than bash: `npm run` on Windows shells out to cmd, where `bash` resolves to the
// WSL relay and fails with execvpe(/bin/bash). Node is already required to run anything here.
//
// Usage: npm run dev:fork    (leave it running; seed in another terminal)

import { spawn } from "node:child_process";
import { foundryBin, loadEnv, onSpawnError } from "./foundry.mjs";

loadEnv();

// Prefer Alchemy if configured: the public RPC rate-limits under a fork's request volume,
// and now also serves Cloudflare challenges to some clients.
const forkRpc = process.env.ALCHEMY_RH_MAINNET || "https://rpc.mainnet.chain.robinhood.com";
const redacted = forkRpc.replace(/\/v2\/.*$/, "/v2/***");

console.log("forking Robinhood Chain mainnet (4663) -> http://localhost:8545");
console.log(`rpc: ${redacted}`);

const anvil = foundryBin("anvil");
const child = spawn(
  anvil,
  ["--fork-url", forkRpc, "--chain-id", "4663", "--port", "8545", "--accounts", "5", "--balance", "10000"],
  { stdio: "inherit" },
);

child.on("error", (err) => {
  if (err.code === "ENOENT") {
    console.error(`\nanvil not found (looked for "${anvil}").`);
    console.error("Install Foundry: https://getfoundry.sh  then run  foundryup");
  } else {
    console.error(err);
  }
  process.exit(1);
});

// Ctrl-C should stop anvil, not orphan it.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));

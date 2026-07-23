#!/usr/bin/env node
// One command for a complete local environment:
//
//   npm run dev
//
// Boots an anvil fork, deploys and seeds finchpad onto it, writes every resulting address
// back into .env, rebuilds the frontend, and starts the API — then holds it all open until
// Ctrl-C. Replaces a six-step copy-paste dance that had to be repeated after every fork
// restart, and that silently broke things when a step was missed.
//
// Flags:
//   --no-seed     boot the fork only (keep an existing deployment)
//   --chain-id N  local chain id (default 31337; see the note below)
//   --port N      API port (default 8787)

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { foundryBin, loadEnv, onSpawnError } from "./foundry.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "http://localhost:8545";
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
// 31337 rather than 4663 on purpose: MetaMask has a built-in entry for 4663 pinned to the
// public RPC, so a fork on 4663 shows a 0 balance in the wallet whatever RPC you configure.
const CHAIN_ID = flag("chain-id", "31337");
const PORT = flag("port", "8787");
const SEED = !args.includes("--no-seed");

loadEnv();

const children = [];
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => shutdown(0));

const step = (n, msg) => console.log(`\n[${n}/5] ${msg}`);

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

/** Resolve once anvil answers, or reject after ~30s. */
async function waitForAnvil() {
  for (let i = 0; i < 150; i++) {
    try {
      return await rpc("eth_chainId");
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("anvil did not come up within 30s");
}

/** Run a command to completion, streaming output, and return what it printed. */
function run(bin, argv, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, argv, { cwd: opts.cwd ?? ROOT, stdio: ["inherit", "pipe", "inherit"] });
    children.push(child);
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (!opts.quiet) process.stdout.write(d);
    });
    child.on("error", onSpawnError(bin));
    child.on("exit", (code) => (code === 0 ? resolvePromise(out) : reject(new Error(`${bin} exited ${code}`))));
  });
}

/** Rewrite keys in .env in place, preserving comments and anything we do not manage. */
function updateEnv(updates) {
  const path = join(ROOT, ".env");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const managed = new Set(Object.keys(updates));
  const kept = existing
    .split(/\r?\n/)
    .filter((line) => {
      const key = line.split("=")[0]?.trim();
      return !managed.has(key) && !line.startsWith("# --- local dev (written by npm run dev)");
    })
    .join("\n")
    .replace(/\n{3,}$/, "\n");

  const block = [
    "",
    "# --- local dev (written by npm run dev) — safe to delete when you go back to live chain",
    ...Object.entries(updates).map(([k, v]) => `${k}=${v}`),
    "",
  ].join("\n");

  writeFileSync(path, `${kept.trimEnd()}\n${block}`);
}

/** Fail early if the API port is taken — otherwise we seed and rewrite .env, then die. */
async function assertPortFree(port) {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1500) });
    const who = await res.json().catch(() => ({}));
    throw new Error(
      `Something is already serving :${port}` +
        (who.factory ? ` (a finchpad API on factory ${who.factory})` : "") +
        `.\nStop it first, or run with --port <other>. Leaving it would seed a fresh deployment` +
        ` and rewrite .env while the old API keeps serving the old addresses.`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Something is already serving")) throw err;
    // Nothing listening (or it is not us) — good.
  }
}

async function main() {
  await assertPortFree(PORT);

  // 1. fork ------------------------------------------------------------------------------
  // Reuse a node already on :8545 rather than failing to bind. Leaving `npm run dev:fork`
  // running in another terminal is the normal state of things, and a port-in-use crash
  // there is a confusing way to be told so.
  let running = null;
  try {
    running = await rpc("eth_chainId");
  } catch {
    /* nothing listening — we start our own */
  }

  if (running) {
    const existingId = parseInt(running, 16);
    step(1, `reusing the node already on :8545 (chain id ${existingId})`);
    if (String(existingId) !== CHAIN_ID) {
      console.log(`      NOTE: it reports ${existingId}, not the requested ${CHAIN_ID}.`);
      console.log(`      Using ${existingId} so the wallet and frontend agree with the chain.`);
    }
  } else {
    step(1, `starting anvil fork (chain id ${CHAIN_ID})`);
    const anvil = spawn(process.execPath, [join(ROOT, "scripts", "dev-fork.mjs")], {
      cwd: ROOT,
      stdio: ["inherit", "ignore", "inherit"],
      env: { ...process.env, FORK_CHAIN_ID: CHAIN_ID },
    });
    children.push(anvil);
    anvil.on("error", onSpawnError("anvil"));
    anvil.on("exit", (code) => {
      if (!shuttingDown) {
        console.error(`\nanvil exited unexpectedly (${code}).`);
        shutdown(1);
      }
    });
    await waitForAnvil();
  }

  // Whatever the node reports wins — the frontend and wallet have to match the chain, not
  // the flag.
  const actualChainId = String(parseInt(await rpc("eth_chainId"), 16));
  const forkBase = (await rpc("anvil_nodeInfo"))?.forkConfig?.forkBlockNumber ?? 0;
  console.log(`      up on ${RPC}, forked at block ${forkBase}`);

  // 2. seed ------------------------------------------------------------------------------
  let deployment = null;
  if (SEED) {
    step(2, "deploying + seeding finchpad");
    const out = await run(process.execPath, [join(ROOT, "scripts", "dev-seed.mjs")], { quiet: true });
    const line = out.split(/\r?\n/).find((l) => l.includes("FINCHPAD_DEPLOY "));
    if (!line) throw new Error("seed did not report its addresses (no FINCHPAD_DEPLOY line)");
    deployment = Object.fromEntries(
      line
        .slice(line.indexOf("FINCHPAD_DEPLOY ") + 16)
        .trim()
        .split(/\s+/)
        .map((kv) => kv.split("=")),
    );
    for (const [k, v] of Object.entries(deployment)) console.log(`      ${k.padEnd(13)} ${v}`);
    // A fresh deployment means fresh addresses — anything the indexer stored about the
    // previous fork's contracts is stale and would be served as live data. Start clean.
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(join(ROOT, "data", `finchpad.db${suffix}`), { force: true });
    }
  } else {
    step(2, "skipping seed (--no-seed)");
  }

  // 3. env -------------------------------------------------------------------------------
  step(3, "writing .env");
  const updates = {
    FORK_CHAIN_ID: actualChainId,
    VITE_CHAIN_ID: actualChainId,
    FINCHPAD_RPC_URL: RPC,
    FINCHPAD_LOGS_RPC_URL: RPC,
    FINCHPAD_MIN_BLOCK: String(forkBase),
    VITE_RPC_URL: RPC,
  };
  if (deployment) {
    Object.assign(updates, {
      FINCH_FACTORY: deployment.factory,
      FINCH_REGISTRY: deployment.registry,
      FINCH_FEATURE_BOOST: deployment.featureBoost,
      VITE_FINCH_FACTORY: deployment.factory,
      VITE_FINCH_LOCKER: deployment.locker,
      VITE_FINCH_REGISTRY: deployment.registry,
      VITE_FINCH_FEATURE_BOOST: deployment.featureBoost,
    });
  }
  updateEnv(updates);
  console.log(`      ${Object.keys(updates).length} keys updated`);

  // 4. frontend --------------------------------------------------------------------------
  step(4, "building the frontend");
  // Invoke vite's JS entry directly rather than `npm run build`: Node refuses to spawn .cmd
  // shims without a shell on Windows (EINVAL), and this skips the npm wrapper anyway.
  const vite = join(ROOT, "web", "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(vite)) {
    throw new Error("web/node_modules is missing — run `npm run web:install` first");
  }
  await run(process.execPath, [vite, "build"], { cwd: join(ROOT, "web"), quiet: true });
  console.log("      built");

  // 5. api -------------------------------------------------------------------------------
  step(5, `starting the API on :${PORT}`);
  // Pass the freshly written values explicitly. `--env-file` does NOT override variables
  // already in the environment, and this process loaded the PREVIOUS .env at startup — so an
  // inherited stale FINCH_FACTORY would win and the API would serve the old deployment while
  // .env and the frontend pointed at the new one.
  const api = spawn(process.execPath, ["--env-file=.env", join(ROOT, "src", "backend", "api.js"), "--port", PORT], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...updates },
  });
  children.push(api);
  api.on("exit", (code) => {
    if (!shuttingDown) shutdown(code ?? 0);
  });

  // The indexer daemon tails launches/swaps/referrals into SQLite; the API serves all-time
  // data from it (and falls back to live scans when the DB is empty). Non-fatal if it dies —
  // the site still works, just window-bounded.
  const indexer = spawn(
    process.execPath,
    ["--env-file=.env", join(ROOT, "src", "indexer", "daemon.js"), "--interval", "2000"],
    { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...updates } },
  );
  children.push(indexer);
  indexer.on("exit", (code) => {
    if (!shuttingDown) console.error(`indexer daemon exited (${code}) — API falls back to live reads`);
  });

  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(`  finchpad is up:  http://localhost:${PORT}`);
  console.log(`  wallet network:  chain id ${actualChainId}, RPC ${RPC}`);
  console.log(`  fund a wallet :  npm run dev:fund -- 0xYourAddress`);
  console.log(`  Ctrl-C stops everything.`);
  console.log(`────────────────────────────────────────────────────────`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  shutdown(1);
});

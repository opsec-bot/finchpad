// finchpad read API. Serves the frontend: launches, token detail, price, candles, trades.
//
// Reads live off-chain, so this runs today with no database. A TTL cache keeps repeat
// requests cheap. When a Postgres indexer exists (see schema.sql), swap the handlers to
// query it — the response shapes are the contract with the frontend and shouldn't change.
//
// Zero HTTP dependencies on purpose: this is a read-only public surface, and every dep
// here is attack surface on a service that will sit next to a signing key.
//
// Usage: node --env-file=.env src/backend/api.js [--port 8787] [--factory 0x...]

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PONS } from "../lib/contracts.js";
import { getCandles, getRecentLaunches, getTokenDetail, getTrades } from "../lib/tokenData.js";
import { createGithubAuth } from "./githubOauth.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const PORT = Number(flag("port", process.env.PORT || 8787));

// GitHub claim OAuth. In production this moves to an isolated service next to the signer
// key (see githubOauth.js security notes); mounting it here is a dev convenience.
const githubAuth = createGithubAuth({
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  redirectUri: process.env.GITHUB_REDIRECT_URI,
  registry: process.env.FINCH_REGISTRY,
  chainId: Number(process.env.FINCH_CHAIN_ID || 4663),
  signerKey: process.env.FINCH_CLAIM_SIGNER_KEY,
  scope: process.env.GITHUB_OAUTH_SCOPE,
});
// Defaults to the live pons factory so the API returns real data before finchpad deploys.
const FACTORY = flag("factory", process.env.FINCH_FACTORY || PONS.activeFactory.address);

// --- tiny TTL cache -------------------------------------------------------------------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// --- helpers --------------------------------------------------------------------------
const isAddress = (s) => typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s);

function send(res, status, body, headers) {
  const payload = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=10",
    ...headers,
  });
  res.end(payload);
}

// --- routes ---------------------------------------------------------------------------
async function route(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const q = url.searchParams;

  if (parts.length === 0 || parts[0] === "health") {
    return { status: 200, body: { ok: true, factory: FACTORY, uptimeSec: Math.floor(process.uptime()) } };
  }

  if (parts[0] !== "tokens") return { status: 404, body: { error: "not found" } };

  // GET /tokens
  if (parts.length === 1) {
    const blocks = BigInt(q.get("blocks") || 5000);
    const limit = Number(q.get("limit") || 50);
    const launches = await cached(`launches:${blocks}:${limit}`, 15_000, () =>
      getRecentLaunches({ factoryAddress: FACTORY, blocks, limit })
    );
    return { status: 200, body: { factory: FACTORY, count: launches.length, launches } };
  }

  const token = parts[1];
  if (!isAddress(token)) return { status: 400, body: { error: "invalid token address" } };

  // GET /tokens/:address
  if (parts.length === 2) {
    const detail = await cached(`detail:${token}`, 10_000, () => getTokenDetail(token, FACTORY));
    return { status: 200, body: detail };
  }

  // Sub-resources need pool + ordering, which come from the detail read.
  const detail = await cached(`detail:${token}`, 10_000, () => getTokenDetail(token, FACTORY));
  const opts = { token, pool: detail.pool, tokenIsToken0: detail.tokenIsToken0, blocks: BigInt(q.get("blocks") || 5000) };

  // GET /tokens/:address/candles
  if (parts[2] === "candles") {
    const interval = Number(q.get("interval") || 300);
    const out = await cached(`candles:${token}:${opts.blocks}:${interval}`, 15_000, () => getCandles(opts, interval));
    return { status: 200, body: { token, symbol: detail.symbol, interval, ...out } };
  }

  // GET /tokens/:address/trades
  if (parts[2] === "trades") {
    const limit = Number(q.get("limit") || 100);
    const trades = await cached(`trades:${token}:${opts.blocks}`, 15_000, () => getTrades(opts));
    return { status: 200, body: { token, symbol: detail.symbol, count: trades.length, trades: trades.slice(-limit).reverse() } };
  }

  return { status: 404, body: { error: "not found" } };
}

// Serve the single-page frontend from the same origin (so it needs no CORS and no build).
const WEB_INDEX = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "web", "index.html");

export const server = createServer(async (req, res) => {
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // OAuth responses carry claim signatures — never cacheable.
    const authed = await githubAuth.handle(url);
    if (authed) {
      if (authed.redirect) {
        res.writeHead(302, { location: authed.redirect, "cache-control": "no-store" });
        return res.end();
      }
      return send(res, authed.status, authed.body, { "cache-control": "no-store" });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(WEB_INDEX, "utf8").catch(() => null);
      if (html) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }
    }

    const { status, body } = await route(url);
    send(res, status, body);
  } catch (err) {
    send(res, 500, { error: err.shortMessage || err.message || "internal error" });
  }
});

// Only listen when run directly, so tests can import and control the server.
// Compare resolved filesystem paths — string-matching file:// URLs breaks on Windows,
// where import.meta.url is file:///C:/... (three slashes).
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  server.listen(PORT, () => {
    console.log(`finchpad api on http://localhost:${PORT}  (factory ${FACTORY})`);
    console.log(`  GET /health`);
    console.log(`  GET /tokens?blocks=5000&limit=50`);
    console.log(`  GET /tokens/:address`);
    console.log(`  GET /tokens/:address/candles?interval=300&blocks=5000`);
    console.log(`  GET /tokens/:address/trades?blocks=5000&limit=100`);
  });
}

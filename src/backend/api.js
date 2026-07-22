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
import { getCandles, getFeatured, getRecentLaunches, getTokenDetail, getTrades } from "../lib/tokenData.js";
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
// FeatureBoost address for paid featured placement. Unset until finchpad's contracts deploy,
// in which case /featured simply returns an empty list rather than erroring.
const FEATURE_BOOST = flag("feature-boost", process.env.FINCH_FEATURE_BOOST || null);

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

// Query params drive on-chain scans (getLogs is chunked at 1000 blocks/call), so an
// unbounded `blocks` turns a single unauthenticated request into a full-chain scan —
// thousands of sequential RPC calls that also bust the TTL cache (blocks is in the key).
// Clamp every caller-supplied bound to a sane ceiling and fall back on garbage input.
const MAX_BLOCKS = 50_000n;
const MAX_LIMIT = 200;
const MAX_INTERVAL = 86_400; // 1 day of candle bucketing

export function boundedBlocks(v) {
  let b;
  try {
    b = BigInt(v ?? 5000);
  } catch {
    return 5000n;
  }
  if (b < 1n) return 1n;
  return b > MAX_BLOCKS ? MAX_BLOCKS : b;
}

export function boundedInt(v, fallback, max) {
  const n = Number(v ?? fallback);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(Math.min(n, max));
}

function send(req, res, status, body, headers) {
  const payload = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=10",
    ...headers,
  });
  // HEAD must return headers only. Wallet SDKs probe the page this way (Coinbase's
  // Cross-Origin-Opener-Policy check), and answering 405 breaks their connect flow.
  res.end(req.method === "HEAD" ? undefined : payload);
}

// --- routes ---------------------------------------------------------------------------
async function route(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const q = url.searchParams;

  if (parts.length === 0 || parts[0] === "health") {
    return { status: 200, body: { ok: true, factory: FACTORY, featureBoost: FEATURE_BOOST, uptimeSec: Math.floor(process.uptime()) } };
  }

  // GET /featured — currently-featured tokens (paid placement). Empty until FeatureBoost is
  // configured. Cached hard because featuring changes on the order of days, not seconds.
  if (parts[0] === "featured") {
    const blocks = boundedBlocks(q.get("blocks"));
    const featured = await cached(`featured:${blocks}`, 30_000, () =>
      getFeatured({ featureBoost: FEATURE_BOOST, blocks })
    );
    return { status: 200, body: { featureBoost: FEATURE_BOOST, count: featured.length, featured } };
  }

  if (parts[0] !== "tokens") return { status: 404, body: { error: "not found" } };

  // GET /tokens
  if (parts.length === 1) {
    const blocks = boundedBlocks(q.get("blocks"));
    const limit = boundedInt(q.get("limit"), 50, MAX_LIMIT);
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
  const opts = { token, pool: detail.pool, tokenIsToken0: detail.tokenIsToken0, blocks: boundedBlocks(q.get("blocks")) };

  // GET /tokens/:address/candles
  if (parts[2] === "candles") {
    const interval = boundedInt(q.get("interval"), 300, MAX_INTERVAL);
    const out = await cached(`candles:${token}:${opts.blocks}:${interval}`, 15_000, () => getCandles(opts, interval));
    return { status: 200, body: { token, symbol: detail.symbol, interval, ...out } };
  }

  // GET /tokens/:address/trades
  if (parts[2] === "trades") {
    const limit = boundedInt(q.get("limit"), 100, MAX_LIMIT);
    const trades = await cached(`trades:${token}:${opts.blocks}`, 15_000, () => getTrades(opts));
    return { status: 200, body: { token, symbol: detail.symbol, count: trades.length, trades: trades.slice(-limit).reverse() } };
  }

  return { status: 404, body: { error: "not found" } };
}

// Serve the single-page frontend from the same origin (so it needs no CORS and no build).
// Privy's documented CSP (docs.privy.io/security/implementation-guide/content-security-policy)
// with two additions: our chain RPC, and the local anvil fork in development. img-src allows
// https: because token logos are arbitrary creator-supplied URLs.
const DEV = process.env.NODE_ENV !== "production";
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
  "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
  [
    "connect-src 'self'",
    "https://auth.privy.io https://api.privy.io https://*.rpc.privy.systems",
    "https://explorer-api.walletconnect.com",
    "wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org",
    "https://*.chain.robinhood.com https://*.g.alchemy.com",
    DEV ? "http://localhost:8545 http://127.0.0.1:8545" : "",
  ]
    .filter(Boolean)
    .join(" "),
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

const WEB_DIST = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "web", "dist");
const WEB_INDEX = resolve(WEB_DIST, "index.html");

// Static assets for the built frontend. Deliberately tiny and allowlisted by extension —
// this process sits next to a signing key, so it serves hashed build output and nothing else.
const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

async function serveAsset(req, pathname, res) {
  // Vite emits everything under /assets with content-hashed names.
  if (!pathname.startsWith("/assets/")) return false;
  // Reject anything that could escape the dist directory before touching the filesystem.
  if (pathname.includes("..") || pathname.includes("\0")) return false;
  const ext = pathname.slice(pathname.lastIndexOf("."));
  const type = MIME[ext];
  if (!type) return false;

  const file = resolve(WEB_DIST, "." + pathname);
  if (!file.startsWith(WEB_DIST)) return false; // belt and braces against traversal
  const body = await readFile(file).catch(() => null);
  if (!body) return false;

  res.writeHead(200, {
    "content-type": type,
    // Hashed filenames, so these are immutable.
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

export const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(req, res, 405, { error: "GET or HEAD only" });
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // OAuth responses carry claim signatures — never cacheable.
    const authed = await githubAuth.handle(url);
    if (authed) {
      if (authed.redirect) {
        res.writeHead(302, { location: authed.redirect, "cache-control": "no-store" });
        return res.end();
      }
      return send(req, res, authed.status, authed.body, { "cache-control": "no-store" });
    }

    if (await serveAsset(req, url.pathname, res)) return;

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(WEB_INDEX, "utf8").catch(() => null);
      if (html) {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          // Defence in depth for a page that prompts wallet signing. Privy needs its own
          // origin for auth frames and its RPC/analytics hosts; everything else is denied.
          "content-security-policy": CSP,
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        });
        return res.end(req.method === "HEAD" ? undefined : html);
      }
    }

    const { status, body } = await route(url);
    send(req, res, status, body);
  } catch (err) {
    send(req, res, 500, { error: err.shortMessage || err.message || "internal error" });
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
    console.log(`  GET /featured`);
    console.log(`  GET /tokens?blocks=5000&limit=50`);
    console.log(`  GET /tokens/:address`);
    console.log(`  GET /tokens/:address/candles?interval=300&blocks=5000`);
    console.log(`  GET /tokens/:address/trades?blocks=5000&limit=100`);
  });
}

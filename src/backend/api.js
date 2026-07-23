// finchpad read API. Serves the frontend: tokens, token detail, price, candles, trades.
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
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { formatEther } from "viem";
import { PONS, poolAbi, tokenAbi } from "../lib/contracts.js";
import { publicClient } from "../lib/chain.js";
import { getCandles, getFeatured, getRecentTokens, getTokenDetail, getTrades, priceFromSqrt } from "../lib/tokenData.js";
import { toCandles } from "../lib/ohlc.js";
import { DB_PATH, openDb, listTokens, getTokenRow, listTrades, getStats, getReferralEarnings, getTraderPositions, listUnclaimedBindings } from "../indexer/db.js";
import { applyProfileUpdate, getUserByAddress, getUserByUsername, usernameAvailable } from "./users.js";
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
  // Claim menu: every unclaimed GitHub-bound token, from the indexer. getDb is hoisted;
  // called lazily per request, so daemon startup order doesn't matter.
  listBindings: async () => {
    const db = getDb();
    return db ? listUnclaimedBindings(db) : [];
  },
});
// Defaults to the live pons factory so the API returns real data before finchpad deploys.
const FACTORY = flag("factory", process.env.FINCH_FACTORY || PONS.activeFactory.address);
// FeatureBoost address for paid featured placement. Unset until finchpad's contracts deploy,
// in which case /featured simply returns an empty list rather than erroring.
const FEATURE_BOOST = flag("feature-boost", process.env.FINCH_FEATURE_BOOST || null);

// --- indexer database (optional) -------------------------------------------------------
// The daemon (src/indexer/daemon.js) owns the write lock; this process reads the same file
// read-only through WAL. When the file doesn't exist yet — daemon not running, first boot —
// every handler falls back to the live block-window reads, so the API still works standalone.
let _db = null;
function getDb() {
  if (_db) return _db;
  if (!existsSync(DB_PATH)) return null;
  try {
    _db = openDb({ readonly: true });
  } catch {
    return null;
  }
  return _db;
}

// --- live updates (SSE) ----------------------------------------------------------------
// Server-Sent Events, deliberately not WebSockets: the flow is one-directional, EventSource
// auto-reconnects, and it runs on this zero-dependency http server. The daemon owns the DB
// writes, so the API learns about new rows by watching the indexer cursor — a sub-millisecond
// SQLite read every couple of seconds — and diffing forward from the last block it announced.
const sseClients = new Set();
const SSE_MAX_CLIENTS = 200;

function handleSse(req, res) {
  if (sseClients.size >= SSE_MAX_CLIENTS) {
    res.writeHead(503, { "content-type": "application/json" });
    return res.end('{"error":"too many live connections"}');
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no", // tells buffering proxies to pass events through
  });
  res.write(":connected\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
}

function broadcast(event, data) {
  if (sseClients.size === 0) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(msg);
}

let sseLastBlock = null;
function pumpLiveEvents() {
  const db = getDb();
  if (!db) return;
  const cursor = db.prepare("SELECT last_block FROM indexer_state WHERE name = 'main'").get();
  if (!cursor) return;
  const head = Number(cursor.last_block);
  if (sseLastBlock === null) {
    sseLastBlock = head; // first sight: announce nothing retroactively
    return;
  }
  if (head <= sseLastBlock) return;

  const launches = db.prepare(
    "SELECT address, symbol, name, pool, launch_block FROM tokens WHERE launch_block > ? ORDER BY launch_block"
  ).all(sseLastBlock);
  for (const l of launches) {
    broadcast("launch", { token: l.address, symbol: l.symbol, name: l.name, block: Number(l.launch_block) });
  }

  const swaps = db.prepare(
    `SELECT s.token, COALESCE(t.symbol,'?') AS symbol, s.side, s.token_amount, s.weth_amount,
            s.price_weth, s.ts, s.block_number, s.tx_hash, s.trader
     FROM swaps s LEFT JOIN tokens t ON t.address = s.token
     WHERE s.block_number > ? ORDER BY s.block_number, s.log_index`
  ).all(sseLastBlock);
  for (const s of swaps) {
    broadcast("swap", {
      token: s.token,
      symbol: s.symbol,
      side: s.side,
      tokenAmount: s.token_amount,
      wethAmount: s.weth_amount,
      priceWeth: s.price_weth,
      timestamp: Number(s.ts),
      block: Number(s.block_number),
      txHash: s.tx_hash,
      // trader = tx.from, so "my wallet just traded" is detectable client-side (live cash/PnL).
      trader: s.trader,
    });
  }

  sseLastBlock = head;
}
// unref: imported-for-tests servers must not be kept alive by the timers.
setInterval(pumpLiveEvents, 1000).unref();
setInterval(() => broadcast("ping", { t: Date.now() }), 25_000).unref();

// --- tiny TTL cache -------------------------------------------------------------------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// --- ETH/USD ---------------------------------------------------------------------------
// Fetched server-side and cached, deliberately: doing it in the browser would need a new
// CSP origin on the page that prompts wallet signing, and would rate-limit per visitor
// instead of once per server. Failure is non-fatal — the UI falls back to ETH-only.
const PRICE_TTL_MS = 60_000;
let ethUsd = { value: null, at: 0 };

export async function getEthUsd() {
  if (ethUsd.value !== null && Date.now() - ethUsd.at < PRICE_TTL_MS) return ethUsd.value;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
      signal: AbortSignal.timeout(4000),
    });
    const json = await res.json();
    const usd = Number(json?.ethereum?.usd);
    if (Number.isFinite(usd) && usd > 0) ethUsd = { value: usd, at: Date.now() };
  } catch {
    // Keep serving the last good value rather than flapping to null on one bad fetch.
  }
  return ethUsd.value;
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

// --- GitHub identity resolution --------------------------------------------------------
// Creators type a username or owner/repo; the CONTRACT binds the numeric id, because names
// get renamed and re-registered and a squatter who picks up a freed name would otherwise
// inherit someone else's fee stream. So the UI resolves name -> id here, server-side:
// unauthenticated GitHub calls are rate-limited per IP (60/hr), and doing it in the browser
// would burn the visitor's quota and add a CSP origin to the page that prompts signing.
const ghCache = new Map(); // key -> { id, login, at }
const GH_TTL_MS = 10 * 60_000;

async function resolveGithub(kind, q) {
  const key = `${kind}:${q.toLowerCase()}`;
  const hit = ghCache.get(key);
  if (hit && Date.now() - hit.at < GH_TTL_MS) return hit;

  const url = kind === "user" ? `https://api.github.com/users/${q}` : `https://api.github.com/repos/${q}`;
  const headers = { accept: "application/vnd.github+json", "user-agent": "finchpad" };
  // An OAuth client id/secret lifts the rate limit; optional.
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    const basic = Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`github lookup failed (${res.status})`);
  const j = await res.json();
  const out = {
    id: String(j.id),
    login: kind === "user" ? j.login : j.full_name,
    avatar: kind === "user" ? j.avatar_url : j.owner?.avatar_url,
    at: Date.now(),
  };
  ghCache.set(key, out);
  return out;
}

// --- routes ---------------------------------------------------------------------------
async function route(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const q = url.searchParams;

  if (parts.length === 0 || parts[0] === "health") {
    return {
      status: 200,
      body: {
        ok: true,
        factory: FACTORY,
        featureBoost: FEATURE_BOOST,
        ethUsd: await getEthUsd(),
        uptimeSec: Math.floor(process.uptime()),
      },
    };
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

  // GET /github/resolve?kind=user|repo&q=octocat  ->  { id, login }
  if (parts[0] === "github" && parts[1] === "resolve") {
    const kind = q.get("kind") === "repo" ? "repo" : "user";
    const raw = (q.get("q") || "").trim().replace(/^@/, "");
    const valid = kind === "user" ? /^[A-Za-z0-9-]{1,39}$/.test(raw) : /^[\w.-]+\/[\w.-]+$/.test(raw);
    if (!valid) {
      return { status: 400, body: { error: kind === "user" ? "invalid github username" : "expected owner/name" } };
    }
    try {
      const r = await resolveGithub(kind, raw);
      if (r.notFound) return { status: 404, body: { error: `no such github ${kind}` } };
      return { status: 200, body: { kind, id: r.id, login: r.login, avatar: r.avatar } };
    } catch (err) {
      return { status: 502, body: { error: err.message } };
    }
  }

  // GET /stats — protocol-wide analytics. All-time sums come from the indexer DB; the
  // combined market-cap/liquidity figures are live reads over every indexed token, cached
  // hard because they cost 3 RPC calls per token.
  if (parts[0] === "stats") {
    const db = getDb();
    if (!db) return { status: 503, body: { error: "indexer not running — stats need the daemon" } };
    const agg = getStats(db);
    const combined = await cached("stats:combined", 120_000, async () => {
      const rows = listTokens(db, { limit: 500 });
      let marketCapWeth = 0;
      let liquidityWeth = 0;
      await Promise.all(
        rows.map(async (r) => {
          try {
            const [slot0, wethBal, supply] = await Promise.all([
              publicClient.readContract({ address: r.pool, abi: poolAbi, functionName: "slot0" }),
              publicClient.readContract({ address: PONS.weth, abi: tokenAbi, functionName: "balanceOf", args: [r.pool] }),
              publicClient.readContract({ address: r.address, abi: tokenAbi, functionName: "totalSupply" }),
            ]);
            marketCapWeth += priceFromSqrt(slot0[0], r.token_is_token0 === 1) * Number(formatEther(supply));
            liquidityWeth += Number(formatEther(wethBal));
          } catch {
            /* one unreadable token must not sink the whole aggregate */
          }
        }),
      );
      return { marketCapWeth, liquidityWeth };
    });
    return { status: 200, body: { ...agg, combined, ethUsd: await getEthUsd() } };
  }

  // --- profiles ------------------------------------------------------------------------
  // JSON lives under /users/* — /profile/<username> is a PAGE path (SPA fallback serves the
  // app shell there), so the data API needs its own prefix.
  // GET /users/by-address/:address — profile lookup for the signed-in user.
  if (parts[0] === "users" && parts[1] === "by-address") {
    if (!isAddress(parts[2])) return { status: 400, body: { error: "invalid address" } };
    // no-store: a cached "no profile yet" answer must never outlive profile creation.
    return { status: 200, body: { profile: getUserByAddress(parts[2]) }, headers: { "cache-control": "no-store" } };
  }

  // GET /users/check?u=<username>&address=0x… — live availability for the setup form.
  if (parts[0] === "users" && parts[1] === "check") {
    return { status: 200, body: usernameAvailable(q.get("u") ?? "", q.get("address")) };
  }

  // GET /users/:username — public profile + traded positions from the indexer.
  if (parts[0] === "users" && parts.length === 2) {
    const user = getUserByUsername(parts[1]);
    if (!user) return { status: 404, body: { error: "no such user" } };
    const db = getDb();
    const positions = db ? getTraderPositions(db, user.address) : [];
    return { status: 200, body: { ...user, positions, ethUsd: await getEthUsd() } };
  }

  // GET /referrals/:address — a referrer's on-chain earnings, for the referrals menu.
  if (parts[0] === "referrals") {
    const who = parts[1];
    if (!isAddress(who)) return { status: 400, body: { error: "invalid referrer address" } };
    const db = getDb();
    if (!db) return { status: 503, body: { error: "indexer not running — referrals need the daemon" } };
    const r = getReferralEarnings(db, who);
    return {
      status: 200,
      body: {
        referrer: who.toLowerCase(),
        totalWeth: r.total.weth,
        last7dWeth: r.total.weth_7d,
        tokens: r.perToken.map((t) => ({
          token: t.token,
          symbol: getTokenRow(db, t.token)?.symbol ?? "?",
          earnedWeth: t.weth,
          payouts: Number(t.payouts),
          lastTs: Number(t.last_ts),
        })),
        ethUsd: await getEthUsd(),
      },
    };
  }

  if (parts[0] !== "tokens") return { status: 404, body: { error: "not found" } };

  // GET /tokens — all-time list from the indexer when available, live block-window otherwise.
  if (parts.length === 1) {
    const limit = boundedInt(q.get("limit"), 50, MAX_LIMIT);
    const db = getDb();
    if (db) {
      const rows = listTokens(db, { limit });
      if (rows.length > 0) {
        return {
          status: 200,
          body: {
            factory: FACTORY,
            count: rows.length,
            tokens: rows.map((r) => ({
              token: r.address,
              deployer: r.deployer,
              pool: r.pool,
              block: Number(r.launch_block),
              txHash: r.launch_tx,
              initialBuyEth: r.initial_buy_eth,
            })),
          },
        };
      }
    }
    const blocks = boundedBlocks(q.get("blocks"));
    const tokens = await cached(`tokens:${blocks}:${limit}`, 15_000, () =>
      getRecentTokens({ factoryAddress: FACTORY, blocks, limit })
    );
    return { status: 200, body: { factory: FACTORY, count: tokens.length, tokens } };
  }

  const token = parts[1];
  if (!isAddress(token)) return { status: 400, body: { error: "invalid token address" } };

  // GET /tokens/:address
  if (parts.length === 2) {
    const detail = await cached(`detail:${token}`, 3_000, () => getTokenDetail(token, FACTORY));
    return { status: 200, body: detail };
  }

  // Candles + trades come straight from the indexer when it knows the token — all-time
  // history, no RPC scan. The live path below remains for unindexed/foreign tokens.
  const dbRow = getDb() ? getTokenRow(getDb(), token) : null;

  if (parts[2] === "candles" && dbRow) {
    const interval = boundedInt(q.get("interval"), 300, MAX_INTERVAL);
    const rows = listTrades(getDb(), token, { limit: 100_000 }).reverse(); // chronological
    const candles = toCandles(
      rows.map((r) => ({ timestamp: r.ts, priceWeth: r.price_weth, tokenAmount: r.token_amount, wethAmount: r.weth_amount })),
      interval,
    );
    return { status: 200, body: { token, symbol: dbRow.symbol, interval, trades: rows.length, candles } };
  }

  if (parts[2] === "trades" && dbRow) {
    const limit = boundedInt(q.get("limit"), 100, MAX_LIMIT);
    const rows = listTrades(getDb(), token, { limit });
    return {
      status: 200,
      body: {
        token,
        symbol: dbRow.symbol,
        count: rows.length,
        trades: rows.map((r) => ({
          side: r.side,
          tokenAmount: r.token_amount,
          wethAmount: r.weth_amount,
          timestamp: Number(r.ts),
          block: Number(r.block_number),
          txHash: r.tx_hash,
          priceWeth: r.price_weth,
        })),
      },
    };
  }

  // Sub-resources need pool + ordering, which come from the detail read.
  const detail = await cached(`detail:${token}`, 3_000, () => getTokenDetail(token, FACTORY));
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

// Un-hashed public files referenced by name (the favicon). An explicit allowlist, not a
// directory: this process sits next to a signing key and must not become a general static
// file server. In-app imagery goes through the bundler and lands under /assets/.
const PUBLIC_FILES = new Set(["/logo.svg"]);

async function serveAsset(req, pathname, res) {
  // Vite emits build output under /assets with content-hashed names; the handful of un-hashed
  // public files above are served by exact-path allowlist.
  const hashed = pathname.startsWith("/assets/");
  if (!hashed && !PUBLIC_FILES.has(pathname)) return false;
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
    // Hashed filenames are immutable; un-hashed public files can change on redeploy, so give
    // them a short cache instead of a year.
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    "x-content-type-options": "nosniff",
  });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

/** Read a JSON request body with a hard size cap — profile avatars are ≤64KB data URIs. */
function readJsonBody(req, maxBytes = 200 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        return reject(new Error("body too large"));
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // The only write endpoint. Authorization is the wallet signature INSIDE the body
    // (users.js verifies it), so no session or cookie state exists to steal.
    if (req.method === "POST" && url.pathname === "/users") {
      const body = await readJsonBody(req).catch((e) => ({ __err: e.message }));
      if (body.__err) return send(req, res, 400, { error: body.__err }, { "cache-control": "no-store" });
      const result = await applyProfileUpdate(body);
      return send(req, res, result.ok ? 200 : 400, result, { "cache-control": "no-store" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(req, res, 405, { error: "GET or HEAD only" });

    // Live event stream — long-lived response, handled outside the JSON route table.
    if (req.method === "GET" && url.pathname === "/events") return handleSse(req, res);

    // OAuth responses carry claim signatures — never cacheable.
    const authed = await githubAuth.handle(url);
    if (authed) {
      if (authed.redirect) {
        res.writeHead(302, { location: authed.redirect, "cache-control": "no-store" });
        return res.end();
      }
      // Popup-mode callback: a tiny page that postMessages the claim to the opener.
      if (authed.html) {
        res.writeHead(authed.status, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        return res.end(req.method === "HEAD" ? undefined : authed.html);
      }
      return send(req, res, authed.status, authed.body, { "cache-control": "no-store" });
    }

    if (await serveAsset(req, url.pathname, res)) return;

    // SPA fallback: the frontend owns real URLs (token pages, launch, analytics, terms,
    // future profiles), so those paths serve the app shell and the client router takes over.
    // /tokens/robinhood/* is a PAGE path — the API's own data routes are /tokens/0x…
    const isSpaPath =
      /^\/(launch|analytics|terms|profile(\/[\w.-]+)?|r\/[a-z0-9_]+|tokens\/robinhood\/0x[a-fA-F0-9]{40})$/.test(url.pathname);

    if (url.pathname === "/" || url.pathname === "/index.html" || isSpaPath) {
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

    const { status, body, headers } = await route(url);
    send(req, res, status, body, headers);
  } catch (err) {
    send(req, res, 500, { error: err.shortMessage || err.message || "internal error" });
  }
});

// Only listen when run directly, so tests can import and control the server.
// Compare resolved filesystem paths — string-matching file:// URLs breaks on Windows,
// where import.meta.url is file:///C:/... (three slashes).
/**
 * Deployment-wiring check the digest cross-pinning tests cannot catch: the signer key this
 * API holds must be the signer the REGISTRY trusts. A mismatch means every claim reverts
 * BadSignature after the user has done the whole OAuth dance — exactly what happened when
 * SeedLocal hardcoded the deployer as trustedSigner. Non-fatal: claims are broken, the rest
 * of the API is fine, so warn loudly and keep serving.
 */
async function warnOnSignerMismatch() {
  const registryAddr = process.env.FINCH_REGISTRY;
  const signerKey = process.env.FINCH_CLAIM_SIGNER_KEY;
  if (!registryAddr || !signerKey) return; // claims not configured — nothing to check
  try {
    const { privateKeyToAccount } = await import("viem/accounts");
    const ours = privateKeyToAccount(signerKey).address;
    const trusted = await publicClient.readContract({
      address: registryAddr,
      abi: [{ type: "function", name: "trustedSigner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
      functionName: "trustedSigner",
    });
    if (trusted.toLowerCase() !== ours.toLowerCase()) {
      console.warn(
        `\n!! CLAIM SIGNER MISMATCH — GitHub claims WILL revert BadSignature\n` +
          `!!   registry ${registryAddr} trusts ${trusted}\n` +
          `!!   but FINCH_CLAIM_SIGNER_KEY signs as ${ours}\n` +
          `!!   Fix: redeploy/seed with FINCH_GITHUB_SIGNER=${ours}, or rotate via setTrustedSigner.\n`,
      );
    } else {
      console.log(`claim signer OK: registry trusts ${ours}`);
    }
  } catch (err) {
    console.warn(`could not verify claim signer against the registry: ${err.shortMessage || err.message}`);
  }
}

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
    void warnOnSignerMismatch();
  });
}

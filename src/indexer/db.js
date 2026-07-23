// SQLite persistence for the indexer + API, via node:sqlite — chosen over Postgres to keep
// the backend's zero-dependency posture (this process sits next to a signing key; every dep
// is attack surface). One writer (the daemon) and any number of readers (the API) share the
// file through WAL mode. schema.sql remains the target shape for the eventual Postgres
// migration (see TODOS); this is the same model in SQLite dialect.
//
// Amounts are stored as REAL (ETH-denominated floats), not numeric(78,0) wei — every consumer
// (API responses, candles, stats) is float-based already, and stats need SQL SUM().

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DB_PATH = process.env.FINCHPAD_DB_PATH || join(ROOT, "data", "finchpad.db");

/** Open (and migrate) the database. `readonly` for the API so it can never hold a write lock. */
export function openDb({ readonly = false } = {}) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH, { readOnly: readonly });
  if (!readonly) {
    // journal_mode is persisted in the file; a read-only connection can't (and needn't) set it.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      address          TEXT PRIMARY KEY,          -- lowercase
      symbol           TEXT NOT NULL,
      name             TEXT NOT NULL,
      decimals         INTEGER NOT NULL DEFAULT 18,
      pool             TEXT NOT NULL,             -- lowercase
      token_is_token0  INTEGER NOT NULL,
      deployer         TEXT NOT NULL,
      factory          TEXT NOT NULL,
      launch_block     INTEGER NOT NULL,
      launch_tx        TEXT NOT NULL,
      initial_buy_eth  REAL NOT NULL DEFAULT 0,
      created_ts       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS tokens_launch_block_idx ON tokens (launch_block DESC);

    -- Every Swap on a launched token's pool, normalized to buy/sell in ETH-float amounts.
    CREATE TABLE IF NOT EXISTS swaps (
      block_number  INTEGER NOT NULL,
      log_index     INTEGER NOT NULL,
      token         TEXT NOT NULL,
      tx_hash       TEXT NOT NULL,
      ts            INTEGER NOT NULL,              -- unix seconds
      side          TEXT NOT NULL CHECK (side IN ('buy','sell')),
      token_amount  REAL NOT NULL,
      weth_amount   REAL NOT NULL,
      price_weth    REAL NOT NULL,
      trader        TEXT,                          -- tx.from, lowercase
      PRIMARY KEY (block_number, log_index)        -- natural dedupe across re-scans
    );
    CREATE INDEX IF NOT EXISTS swaps_token_ts_idx ON swaps (token, ts DESC);
    CREATE INDEX IF NOT EXISTS swaps_ts_idx ON swaps (ts DESC);

    -- ReferralPaid events from the locker: who earned what for referring which token.
    CREATE TABLE IF NOT EXISTS referral_payouts (
      block_number  INTEGER NOT NULL,
      log_index     INTEGER NOT NULL,
      token         TEXT NOT NULL,
      referrer      TEXT NOT NULL,                 -- lowercase
      token_amount  REAL NOT NULL,
      weth_amount   REAL NOT NULL,
      ts            INTEGER NOT NULL,
      tx_hash       TEXT NOT NULL,
      PRIMARY KEY (block_number, log_index)
    );
    CREATE INDEX IF NOT EXISTS referral_referrer_idx ON referral_payouts (referrer, ts DESC);

    -- Resumable cursor per scan stream.
    CREATE TABLE IF NOT EXISTS indexer_state (
      name        TEXT PRIMARY KEY,
      last_block  INTEGER NOT NULL,
      updated_ts  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // Column additions land as idempotent ALTERs — SQLite errors when the column exists, which
  // is exactly the "already migrated" signal.
  for (const alter of [
    "ALTER TABLE tokens ADD COLUMN github_kind INTEGER NOT NULL DEFAULT 0",   // 0 none, 1 repo, 2 user
    "ALTER TABLE tokens ADD COLUMN github_id TEXT NOT NULL DEFAULT ''",       // GitHub's numeric id, as text
    "ALTER TABLE tokens ADD COLUMN github_claimed INTEGER NOT NULL DEFAULT 0",
  ]) {
    try {
      db.exec(alter);
    } catch {
      /* column already exists */
    }
  }
}

// --- writes (daemon) --------------------------------------------------------------------

export function upsertToken(db, t) {
  db.prepare(
    `INSERT INTO tokens (address, symbol, name, decimals, pool, token_is_token0, deployer, factory,
                         launch_block, launch_tx, initial_buy_eth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET symbol=excluded.symbol, name=excluded.name`
  ).run(
    t.address.toLowerCase(), t.symbol, t.name, t.decimals, t.pool.toLowerCase(),
    t.tokenIsToken0 ? 1 : 0, t.deployer.toLowerCase(), t.factory.toLowerCase(),
    t.launchBlock, t.launchTx, t.initialBuyEth ?? 0,
  );
}

export function insertSwap(db, s) {
  db.prepare(
    `INSERT OR REPLACE INTO swaps (block_number, log_index, token, tx_hash, ts, side,
                                   token_amount, weth_amount, price_weth, trader)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    s.blockNumber, s.logIndex, s.token.toLowerCase(), s.txHash, s.ts, s.side,
    s.tokenAmount, s.wethAmount, s.priceWeth, s.trader ? s.trader.toLowerCase() : null,
  );
}

export function insertReferralPayout(db, r) {
  db.prepare(
    `INSERT OR REPLACE INTO referral_payouts (block_number, log_index, token, referrer,
                                              token_amount, weth_amount, ts, tx_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(r.blockNumber, r.logIndex, r.token.toLowerCase(), r.referrer.toLowerCase(),
        r.tokenAmount, r.wethAmount, r.ts, r.txHash);
}

export function setTokenGithubBinding(db, token, { kind, githubId, claimed }) {
  db.prepare("UPDATE tokens SET github_kind = ?, github_id = ?, github_claimed = ? WHERE address = ?")
    .run(kind, String(githubId), claimed ? 1 : 0, token.toLowerCase());
}

export function markGithubClaimed(db, token) {
  db.prepare("UPDATE tokens SET github_claimed = 1 WHERE address = ?").run(token.toLowerCase());
}

/** Every unclaimed GitHub-bound token — the claim menu's candidate list. */
export function listUnclaimedBindings(db) {
  return db.prepare(
    `SELECT address, symbol, name, github_kind, github_id
     FROM tokens WHERE github_kind != 0 AND github_claimed = 0`
  ).all();
}

/** All tokens bound to a GitHub identity (claimed or not) — shown in the claim menu. */
export function listTokensByGithubId(db, githubId) {
  return db.prepare(
    `SELECT address, symbol, name, github_kind, github_id, github_claimed
     FROM tokens WHERE github_id = ? ORDER BY launch_block DESC`
  ).all(String(githubId));
}

/** Drop rows at/above a block — called on the re-scan window so reorged-away events vanish. */
export function pruneFromBlock(db, fromBlock) {
  db.prepare("DELETE FROM swaps WHERE block_number >= ?").run(fromBlock);
  db.prepare("DELETE FROM referral_payouts WHERE block_number >= ?").run(fromBlock);
}

export function getCursor(db, name) {
  const row = db.prepare("SELECT last_block FROM indexer_state WHERE name = ?").get(name);
  return row ? Number(row.last_block) : null;
}

export function setCursor(db, name, block) {
  db.prepare(
    `INSERT INTO indexer_state (name, last_block, updated_ts) VALUES (?, ?, unixepoch())
     ON CONFLICT(name) DO UPDATE SET last_block=excluded.last_block, updated_ts=unixepoch()`
  ).run(name, block);
}

// --- reads (API) ------------------------------------------------------------------------

/** All launched tokens, newest first — the all-time list the block-window scan couldn't give. */
export function listTokens(db, { limit = 50 } = {}) {
  return db.prepare(
    `SELECT address, deployer, pool, token_is_token0, launch_block, launch_tx, initial_buy_eth
     FROM tokens ORDER BY launch_block DESC LIMIT ?`
  ).all(limit);
}

export function getTokenRow(db, address) {
  return db.prepare("SELECT * FROM tokens WHERE address = ?").get(address.toLowerCase()) ?? null;
}

export function listTrades(db, token, { limit = 500 } = {}) {
  return db.prepare(
    `SELECT block_number, ts, tx_hash, side, token_amount, weth_amount, price_weth, trader
     FROM swaps WHERE token = ? ORDER BY ts DESC, block_number DESC LIMIT ?`
  ).all(token.toLowerCase(), limit);
}

/** Protocol-wide aggregates for the analytics page. All-time + trailing-24h in one shot. */
export function getStats(db) {
  const cutoff = Math.floor(Date.now() / 1000) - 86_400;
  const allTime = db.prepare(
    "SELECT COALESCE(SUM(weth_amount),0) AS volume_weth, COUNT(*) AS trades FROM swaps"
  ).get();
  const day = db.prepare(
    `SELECT COALESCE(SUM(weth_amount),0) AS volume_weth, COUNT(*) AS trades,
            COUNT(DISTINCT trader) AS traders, COUNT(DISTINCT token) AS tokens_traded
     FROM swaps WHERE ts >= ?`
  ).get(cutoff);
  const tokens = db.prepare("SELECT COUNT(*) AS launched FROM tokens").get();
  return {
    allTime: { volumeWeth: allTime.volume_weth, trades: Number(allTime.trades) },
    last24h: {
      volumeWeth: day.volume_weth,
      trades: Number(day.trades),
      traders: Number(day.traders),
      tokensTraded: Number(day.tokens_traded),
    },
    tokensLaunched: Number(tokens.launched),
  };
}

/** A trader's per-token position, derived from their indexed swaps — powers profile pages.
 *  Approximate by design: transfers outside the pool aren't visible here, so net tokens is
 *  the traded position, not necessarily the wallet balance. */
export function getTraderPositions(db, trader) {
  const rows = db.prepare(
    `SELECT s.token, COALESCE(t.symbol, '?') AS symbol,
            SUM(CASE WHEN s.side='buy'  THEN s.weth_amount  ELSE 0 END) AS buy_weth,
            SUM(CASE WHEN s.side='sell' THEN s.weth_amount  ELSE 0 END) AS sell_weth,
            SUM(CASE WHEN s.side='buy'  THEN s.token_amount ELSE -s.token_amount END) AS net_tokens,
            COUNT(*) AS trades, MAX(s.ts) AS last_ts
     FROM swaps s LEFT JOIN tokens t ON t.address = s.token
     WHERE s.trader = ?
     GROUP BY s.token
     ORDER BY MAX(s.ts) DESC`
  ).all(trader.toLowerCase());
  const lastPrice = db.prepare("SELECT price_weth FROM swaps WHERE token = ? ORDER BY ts DESC, block_number DESC LIMIT 1");
  return rows.map((r) => {
    const price = lastPrice.get(r.token)?.price_weth ?? 0;
    const net = Math.max(0, r.net_tokens); // dust negatives from float math read as 0
    const valueWeth = net * price;
    return {
      token: r.token,
      symbol: r.symbol,
      investedWeth: r.buy_weth,
      receivedWeth: r.sell_weth,
      netTokens: net,
      valueWeth,
      pnlWeth: r.sell_weth + valueWeth - r.buy_weth,
      trades: Number(r.trades),
      lastTs: Number(r.last_ts),
    };
  });
}

/** A referrer's earnings, total and per token — the referrals modal reads this. */
export function getReferralEarnings(db, referrer) {
  const rows = db.prepare(
    `SELECT token, COALESCE(SUM(weth_amount),0) AS weth, COALESCE(SUM(token_amount),0) AS tokens,
            COUNT(*) AS payouts, MAX(ts) AS last_ts
     FROM referral_payouts WHERE referrer = ? GROUP BY token ORDER BY weth DESC`
  ).all(referrer.toLowerCase());
  const total = db.prepare(
    `SELECT COALESCE(SUM(weth_amount),0) AS weth,
            COALESCE(SUM(CASE WHEN ts >= ? THEN weth_amount ELSE 0 END),0) AS weth_7d
     FROM referral_payouts WHERE referrer = ?`
  ).get(Math.floor(Date.now() / 1000) - 7 * 86_400, referrer.toLowerCase());
  return { total, perToken: rows };
}

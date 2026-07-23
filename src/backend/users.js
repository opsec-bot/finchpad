// User profiles: unique usernames, display names, bios, avatars. Stored in a SEPARATE SQLite
// file from the indexer's — the daemon owns finchpad.db's write lock, the API owns this one,
// so the two writers never contend.
//
// Identity = wallet address. Profile writes are authorized by a wallet signature over the
// exact payload (viem verifyMessage — already a dependency), so the API needs no session
// state and never trusts a bare address. The signed message embeds a timestamp to stop
// replays of old updates.

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { verifyMessage } from "viem";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const USERS_DB_PATH = process.env.FINCHPAD_USERS_DB_PATH || join(ROOT, "data", "users.db");

let _db = null;
export function usersDb() {
  if (_db) return _db;
  mkdirSync(dirname(USERS_DB_PATH), { recursive: true });
  _db = new DatabaseSync(USERS_DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      address     TEXT PRIMARY KEY,               -- lowercase wallet address
      username    TEXT NOT NULL UNIQUE,           -- strict charset, the URL identity
      name        TEXT NOT NULL DEFAULT '',       -- freeform display name
      bio         TEXT NOT NULL DEFAULT '',
      avatar      TEXT NOT NULL DEFAULT '',       -- small data: URI, produced client-side
      created_ts  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_ts  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return _db;
}

// --- username rules ---------------------------------------------------------------------
// Lowercase a-z / 0-9, underscores only BETWEEN alphanumerics, 3-20 chars. ASCII is enforced
// before the regex ever runs, and NFKC normalization must be a no-op — so unicode "font"
// letters, homoglyphs and zero-width characters can never smuggle into a handle.
const USERNAME_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const RESERVED = new Set([
  "admin", "finchpad", "root", "support", "help", "api", "www", "profile", "tokens",
  "launch", "analytics", "terms", "settings", "wallet", "null", "undefined",
]);

/** Returns null if valid, otherwise a human-readable reason. */
export function usernameProblem(u) {
  if (typeof u !== "string") return "username required";
  // eslint-disable-next-line no-control-regex
  if (/[^\x21-\x7e]/.test(u)) return "ASCII characters only — no unicode, spaces, or styled letters";
  if (u.normalize("NFKC") !== u) return "username contains disallowed characters";
  if (u.length < 3 || u.length > 20) return "3-20 characters";
  if (!USERNAME_RE.test(u)) return "lowercase letters and numbers, underscores only between them";
  if (RESERVED.has(u)) return "that username is reserved";
  return null;
}

const MAX_NAME = 40;
const MAX_BIO = 280;
const MAX_AVATAR_BYTES = 64 * 1024;

export function profileProblem({ username, name, bio, avatar }) {
  const u = usernameProblem(username);
  if (u) return u;
  if (typeof name !== "string" || name.length > MAX_NAME) return `name must be ${MAX_NAME} characters or fewer`;
  if (typeof bio !== "string" || bio.length > MAX_BIO) return `bio must be ${MAX_BIO} characters or fewer`;
  if (avatar) {
    if (typeof avatar !== "string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))
      return "avatar must be a png/jpeg/webp data URI";
    if (avatar.length * 0.75 > MAX_AVATAR_BYTES) return "avatar too large (64 KB max)";
  }
  return null;
}

// --- signed updates ---------------------------------------------------------------------

/** The exact message the wallet signs. Binds address, payload hash and a freshness window. */
export function profileMessage(address, payload, timestamp) {
  const canonical = JSON.stringify({
    username: payload.username,
    name: payload.name ?? "",
    bio: payload.bio ?? "",
    avatar: payload.avatar ?? "",
  });
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `finchpad profile update v1\naddress: ${address.toLowerCase()}\npayload: ${digest}\ntime: ${timestamp}`;
}

const FRESH_MS = 10 * 60_000;

/**
 * Verify + apply a profile update. Returns { ok } or { error }.
 * Username uniqueness is case-insensitive by construction (usernames are lowercase-only).
 */
export async function applyProfileUpdate({ address, payload, timestamp, signature }) {
  if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) return { error: "invalid address" };
  const problem = profileProblem(payload ?? {});
  if (problem) return { error: problem };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > FRESH_MS) return { error: "stale signature — try again" };

  const message = profileMessage(address, payload, ts);
  const valid = await verifyMessage({ address, message, signature }).catch(() => false);
  if (!valid) return { error: "signature does not match the wallet" };

  const db = usersDb();
  const lower = address.toLowerCase();
  const taken = db.prepare("SELECT address FROM users WHERE username = ?").get(payload.username);
  if (taken && taken.address !== lower) return { error: "username is taken" };

  db.prepare(
    `INSERT INTO users (address, username, name, bio, avatar)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       username=excluded.username, name=excluded.name, bio=excluded.bio,
       avatar=excluded.avatar, updated_ts=unixepoch()`
  ).run(lower, payload.username, payload.name ?? "", payload.bio ?? "", payload.avatar ?? "");
  return { ok: true };
}

// --- reads -------------------------------------------------------------------------------

const pub = (r) =>
  r && {
    address: r.address,
    username: r.username,
    name: r.name,
    bio: r.bio,
    avatar: r.avatar,
    joinedTs: Number(r.created_ts),
  };

export function getUserByUsername(username) {
  if (typeof username !== "string" || username.length > 20) return null;
  return pub(usersDb().prepare("SELECT * FROM users WHERE username = ?").get(username.toLowerCase()));
}

export function getUserByAddress(address) {
  if (typeof address !== "string") return null;
  return pub(usersDb().prepare("SELECT * FROM users WHERE address = ?").get(address.toLowerCase()));
}

export function usernameAvailable(username, forAddress = null) {
  const problem = usernameProblem(username);
  if (problem) return { available: false, reason: problem };
  const row = usersDb().prepare("SELECT address FROM users WHERE username = ?").get(username);
  if (row && row.address !== forAddress?.toLowerCase()) return { available: false, reason: "taken" };
  return { available: true };
}

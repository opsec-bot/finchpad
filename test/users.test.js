// Profile store: username rules (the anti-unicode/homoglyph gate) and signature-authorized
// updates. Uses a throwaway DB file per run.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB = join(tmpdir(), `finchpad-users-test-${process.pid}.db`);
process.env.FINCHPAD_USERS_DB_PATH = DB;

const { usernameProblem, profileMessage, applyProfileUpdate, getUserByUsername, usernameAvailable } =
  await import("../src/backend/users.js");
const { privateKeyToAccount } = await import("viem/accounts");

const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

after(() => {
  // Windows keeps the file locked while the connection is open; best-effort cleanup only —
  // it's the OS temp dir either way.
  try {
    for (const s of ["", "-wal", "-shm"]) rmSync(DB + s, { force: true });
  } catch {
    /* locked on Windows — fine */
  }
});

test("usernames: valid shapes pass", () => {
  for (const u of ["abc", "finch_lord", "a1b2c3", "x_y_z", "user_123"]) {
    assert.equal(usernameProblem(u), null, u);
  }
});

test("usernames: unicode 'fonts', homoglyphs and zero-width are rejected", () => {
  for (const u of ["𝓯𝓲𝓷𝓬𝓱", "ｆｉｎｃｈ", "fin​ch", "fınch", "финч", "finch😀"]) {
    assert.notEqual(usernameProblem(u), null, `should reject: ${u}`);
  }
});

test("usernames: structural rules", () => {
  assert.notEqual(usernameProblem("ab"), null, "too short");
  assert.notEqual(usernameProblem("a".repeat(21)), null, "too long");
  assert.notEqual(usernameProblem("Finch"), null, "uppercase");
  assert.notEqual(usernameProblem("_finch"), null, "leading underscore");
  assert.notEqual(usernameProblem("finch_"), null, "trailing underscore");
  assert.notEqual(usernameProblem("fin__ch"), null, "double underscore");
  assert.notEqual(usernameProblem("fin ch"), null, "space");
  assert.notEqual(usernameProblem("admin"), null, "reserved");
});

async function signedUpdate(payload, { ts = Date.now(), tamper = false } = {}) {
  const timestamp = ts;
  const message = profileMessage(account.address, payload, timestamp);
  const signature = await account.signMessage({ message });
  return applyProfileUpdate({
    address: account.address,
    payload: tamper ? { ...payload, bio: "hijacked" } : payload,
    timestamp,
    signature,
  });
}

test("profile update: valid signature applies and reads back", async () => {
  const r = await signedUpdate({ username: "credit", name: "Credit", bio: "hello.", avatar: "" });
  assert.deepEqual(r, { ok: true });
  const u = getUserByUsername("credit");
  assert.equal(u.name, "Credit");
  assert.equal(u.address, account.address.toLowerCase());
});

test("profile update: tampered payload fails signature check", async () => {
  const r = await signedUpdate({ username: "credit", name: "Credit", bio: "real", avatar: "" }, { tamper: true });
  assert.match(r.error, /signature/);
});

test("profile update: stale timestamp rejected", async () => {
  const r = await signedUpdate({ username: "credit", name: "x", bio: "", avatar: "" }, { ts: Date.now() - 3_600_000 });
  assert.match(r.error, /stale/);
});

test("username uniqueness: second address cannot take a claimed name", async () => {
  const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const payload = { username: "credit", name: "", bio: "", avatar: "" };
  const timestamp = Date.now();
  const message = profileMessage(other.address, payload, timestamp);
  const signature = await other.signMessage({ message });
  const r = await applyProfileUpdate({ address: other.address, payload, timestamp, signature });
  assert.match(r.error, /taken/);
  assert.equal(usernameAvailable("credit").available, false);
  assert.equal(usernameAvailable("credit2").available, true);
});

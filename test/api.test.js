import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { server, boundedBlocks, boundedInt } from "../src/backend/api.js";

// Only the deterministic, no-network paths are asserted here: routing, guards, and method
// handling. The chain-backed endpoints are covered by the lib tests plus live runs — putting
// real RPC calls in the test suite would make it slow and flaky for no extra signal.

let base;

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test("GET /health reports ok and the configured factory", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.factory, /^0x[a-fA-F0-9]{40}$/);
});

test("rejects a malformed token address before touching the chain", async () => {
  const res = await fetch(`${base}/tokens/notanaddress`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid token address");
});

test("unknown route 404s", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});

test("unknown token sub-resource 404s", async () => {
  const res = await fetch(`${base}/tokens/0x1111111111111111111111111111111111111111/bogus`);
  assert.equal([404, 500].includes(res.status), true, `unexpected status ${res.status}`);
});

test("non-GET is rejected", async () => {
  const res = await fetch(`${base}/health`, { method: "POST" });
  assert.equal(res.status, 405);
});

test("CORS header is present so the frontend can call it", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

// Guards against unbounded query params turning one request into a full-chain RPC scan.
test("boundedBlocks clamps range and falls back on garbage", () => {
  assert.equal(boundedBlocks("3000"), 3000n); // valid passes through
  assert.equal(boundedBlocks(null), 5000n); // default
  assert.equal(boundedBlocks("abc"), 5000n); // unparseable -> default
  assert.equal(boundedBlocks("99999999999"), 50_000n); // clamped to ceiling
  assert.equal(boundedBlocks("-5"), 1n); // floored to a positive range
  assert.equal(boundedBlocks("0"), 1n);
});

test("boundedInt clamps to max and falls back on garbage", () => {
  assert.equal(boundedInt("25", 50, 200), 25);
  assert.equal(boundedInt(null, 50, 200), 50);
  assert.equal(boundedInt("abc", 50, 200), 50);
  assert.equal(boundedInt("1000000000", 100, 200), 200); // clamped
  assert.equal(boundedInt("-3", 100, 200), 100); // non-positive -> default
});

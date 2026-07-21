import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { server } from "../src/backend/api.js";

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

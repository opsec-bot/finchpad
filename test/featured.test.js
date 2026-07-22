import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFeatured } from "../src/lib/tokenData.js";

// Pure reducer over FeatureBoost `Featured` logs -> currently-active featured tokens.
// Kept chain-free so it can be asserted deterministically.

const log = (token, until) => ({ args: { token, until: BigInt(until) } });
const A = "0xaaaa000000000000000000000000000000000000";
const B = "0xbbbb000000000000000000000000000000000000";

test("keeps only tokens whose window has not elapsed", () => {
  const now = 1000;
  const out = activeFeatured([log(A, 2000), log(B, 500)], now);
  assert.deepEqual(
    out.map((f) => f.token),
    [A]
  );
});

test("latest until per token wins (buying more days extends, never shrinks)", () => {
  const now = 1000;
  const out = activeFeatured([log(A, 1500), log(A, 3000), log(A, 1200)], now);
  assert.equal(out.length, 1);
  assert.equal(out[0].until, 3000);
});

test("sorts active tokens by soonest-expiring last (longest window first)", () => {
  const now = 1000;
  const out = activeFeatured([log(A, 2000), log(B, 5000)], now);
  assert.deepEqual(
    out.map((f) => f.token),
    [B, A]
  );
});

test("empty input yields empty output", () => {
  assert.deepEqual(activeFeatured([], 1000), []);
});

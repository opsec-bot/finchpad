import { test } from "node:test";
import assert from "node:assert/strict";
import { getLaunchConfig, decodeSqrtPriceX96, CURVE_A } from "../src/lib/launchCurve.js";

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const TOKEN_BELOW = "0x0000000000000000000000000000000000001111"; // < WETH => token0
const TOKEN_ABOVE = "0xffffffffffffffffffffffffffffffffffffffff"; // > WETH => token1
const MAX_TICK = 887200;
const MIN_TICK = -887200;

test("curve A implied start mcap ~ 1 ETH, token0 ordering", () => {
  const c = getLaunchConfig({ tokenAddress: TOKEN_BELOW, wethAddress: WETH });
  assert.equal(c.tokenIsToken0, true);
  assert.ok(Math.abs(c.impliedStartMcapEth - 1) < 0.001, `mcap ${c.impliedStartMcapEth}`);
  assert.equal(c.graduationEth, CURVE_A.graduationEth);
  // single-sided all token0: range above current tick, tickUpper at max
  assert.equal(c.tickUpper, MAX_TICK);
  assert.ok(c.tickLower < MAX_TICK && c.tickLower > MIN_TICK);
  assert.ok(c.initialSqrtPriceX96 > 0n);
});

test("curve A token1 ordering mirrors correctly", () => {
  const c = getLaunchConfig({ tokenAddress: TOKEN_ABOVE, wethAddress: WETH });
  assert.equal(c.tokenIsToken0, false);
  assert.ok(Math.abs(c.impliedStartMcapEth - 1) < 0.001, `mcap ${c.impliedStartMcapEth}`);
  assert.equal(c.tickLower, MIN_TICK);
  assert.ok(c.tickUpper > MIN_TICK && c.tickUpper < MAX_TICK);
});

test("start mcap scales with the target", () => {
  for (const target of [0.5, 2, 5, 10]) {
    const c = getLaunchConfig({ tokenAddress: TOKEN_BELOW, wethAddress: WETH, startMcapEth: target });
    assert.ok(Math.abs(c.impliedStartMcapEth - target) / target < 0.001, `target ${target} got ${c.impliedStartMcapEth}`);
  }
});

test("single-sidedness: current tick sits strictly outside the range on the token side", () => {
  // token0: current price is below tickLower (range is all token0)
  const c0 = getLaunchConfig({ tokenAddress: TOKEN_BELOW, wethAddress: WETH });
  const price0 = decodeSqrtPriceX96(c0.initialSqrtPriceX96);
  const tick0 = Math.floor(Math.log(price0) / Math.log(1.0001));
  assert.ok(tick0 < c0.tickLower, `tick0 ${tick0} should be < tickLower ${c0.tickLower}`);

  // token1: current price is above tickUpper (range is all token1)
  const c1 = getLaunchConfig({ tokenAddress: TOKEN_ABOVE, wethAddress: WETH });
  const price1 = decodeSqrtPriceX96(c1.initialSqrtPriceX96);
  const tick1 = Math.floor(Math.log(price1) / Math.log(1.0001));
  assert.ok(tick1 > c1.tickUpper, `tick1 ${tick1} should be > tickUpper ${c1.tickUpper}`);
});

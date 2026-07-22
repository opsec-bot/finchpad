// Launch-curve math, ported from src/lib/launchCurve.js so the UI computes the exact same
// pool params the factory expects. Kept behaviourally identical — the JS version has unit
// tests and a fork test asserting the pool initializes at this price.

const TICK_SPACING = 200; // Uniswap V3 1% fee tier
const MIN_TICK = -887200;
const MAX_TICK = 887200;
const Q96 = 2n ** 96n;

export const CURVE_A = { startMcapEth: 1, graduationEth: 4.2, totalSupply: 1_000_000_000 };

function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export function encodeSqrtRatioX96(amount1: bigint, amount0: bigint): bigint {
  return bigintSqrt((amount1 << 192n) / amount0);
}

export function decodeSqrtPriceX96(sqrtPriceX96: bigint): number {
  const s = Number(sqrtPriceX96) / Number(Q96);
  return s * s;
}

export interface LaunchConfig {
  initialSqrtPriceX96: bigint;
  tickLower: number;
  tickUpper: number;
  tokenIsToken0: boolean;
  impliedStartMcapEth: number;
}

/**
 * @param tokenAddress the PREDICTED launch token address — ordering vs WETH decides which
 *   side the single-sided position sits on, so this must match the address the factory
 *   actually deploys. See predictTokenAddress() in tx.ts for the race this implies.
 */
export function getLaunchConfig({
  tokenAddress,
  wethAddress,
  startMcapEth = CURVE_A.startMcapEth,
  totalSupply = CURVE_A.totalSupply,
}: {
  tokenAddress: string;
  wethAddress: string;
  startMcapEth?: number;
  totalSupply?: number;
}): LaunchConfig {
  const tokenIsToken0 = tokenAddress.toLowerCase() < wethAddress.toLowerCase();

  const mcapScaled = BigInt(Math.round(startMcapEth * 1e9));
  const supplyScaled = BigInt(totalSupply) * 1_000_000_000n;

  const initialSqrtPriceX96 = tokenIsToken0
    ? encodeSqrtRatioX96(mcapScaled, supplyScaled)
    : encodeSqrtRatioX96(supplyScaled, mcapScaled);

  const priceDecoded = decodeSqrtPriceX96(initialSqrtPriceX96);
  const currentTick = Math.floor(Math.log(priceDecoded) / Math.log(1.0001));

  let tickLower: number;
  let tickUpper: number;
  if (tokenIsToken0) {
    tickLower = (Math.ceil(currentTick / TICK_SPACING) + 1) * TICK_SPACING;
    tickUpper = MAX_TICK;
  } else {
    tickUpper = (Math.floor(currentTick / TICK_SPACING) - 1) * TICK_SPACING;
    tickLower = MIN_TICK;
  }

  const startPrice = tokenIsToken0 ? priceDecoded : 1 / priceDecoded;
  return {
    initialSqrtPriceX96,
    tickLower,
    tickUpper,
    tokenIsToken0,
    impliedStartMcapEth: startPrice * totalSupply,
  };
}

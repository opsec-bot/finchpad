// Launch-curve math for finchpad. Turns a target starting market cap into the exact
// Uniswap V3 pool params the factory's LaunchParams needs: initialSqrtPriceX96 + a
// single-sided tick range holding the full supply.
//
// Default curve "A" (degen/fair-launch, pons parity): ~1 ETH implied start mcap,
// graduation marker at 4.2 ETH. Graduation is cosmetic (a counter vs a threshold),
// so it does NOT constrain the tick range — the range is just wide + single-sided.

const TICK_SPACING = 200; // Uniswap V3 1% fee tier
const MIN_TICK = -887200; // aligned to spacing
const MAX_TICK = 887200;
const Q96 = 2n ** 96n;

// Curve A defaults.
export const CURVE_A = { startMcapEth: 1, graduationEth: 4.2, totalSupply: 1_000_000_000 };

/** Integer sqrt (Newton). */
function bigintSqrt(n) {
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

/** sqrt(amount1/amount0) * 2^96, as a BigInt. */
export function encodeSqrtRatioX96(amount1, amount0) {
  const ratioX192 = (BigInt(amount1) << 192n) / BigInt(amount0);
  return bigintSqrt(ratioX192);
}

/** Decode sqrtPriceX96 back to a float price (token1/token0). */
export function decodeSqrtPriceX96(sqrtPriceX96) {
  const s = Number(sqrtPriceX96) / Number(Q96);
  return s * s;
}

/**
 * Compute the launch config for a token.
 * @param {object} o
 * @param {string} o.tokenAddress   the (predicted) launch token address
 * @param {string} o.wethAddress    WETH on the target chain
 * @param {number} [o.startMcapEth] target implied market cap at launch, in ETH
 * @param {number} [o.totalSupply]  fixed token supply (whole tokens)
 * @param {number} [o.graduationEth] graduation marker, in ETH
 * @returns {{initialSqrtPriceX96: bigint, tickLower: number, tickUpper: number,
 *           tokenIsToken0: boolean, impliedStartMcapEth: number, graduationEth: number}}
 */
export function getLaunchConfig({
  tokenAddress,
  wethAddress,
  startMcapEth = CURVE_A.startMcapEth,
  totalSupply = CURVE_A.totalSupply,
  graduationEth = CURVE_A.graduationEth,
}) {
  const tokenIsToken0 = tokenAddress.toLowerCase() < wethAddress.toLowerCase();

  // Both token and WETH are 18-decimal, so raw ratio == human ratio.
  // Scale mcap by 1e9 so fractional-ETH targets keep precision as integers.
  const mcapScaled = BigInt(Math.round(startMcapEth * 1e9));
  const supplyScaled = BigInt(totalSupply) * 1_000_000_000n;

  // pool price = token1/token0. token0 side is token if tokenIsToken0.
  const initialSqrtPriceX96 = tokenIsToken0
    ? encodeSqrtRatioX96(mcapScaled, supplyScaled) // WETH/token = mcap/supply
    : encodeSqrtRatioX96(supplyScaled, mcapScaled); // token/WETH = supply/mcap

  // Current tick from the ACTUAL encoded price (not the target), so rounding in the encode
  // is accounted for. One extra spacing of buffer guarantees the position sits strictly on
  // one side of the current tick, so the single-sided mint can never require the other token.
  const priceDecoded = decodeSqrtPriceX96(initialSqrtPriceX96);
  const currentTick = Math.floor(Math.log(priceDecoded) / Math.log(1.0001));

  let tickLower;
  let tickUpper;
  if (tokenIsToken0) {
    // All token0: range strictly above current tick.
    tickLower = (Math.ceil(currentTick / TICK_SPACING) + 1) * TICK_SPACING;
    tickUpper = MAX_TICK;
  } else {
    // All token1: range strictly below current tick.
    tickUpper = (Math.floor(currentTick / TICK_SPACING) - 1) * TICK_SPACING;
    tickLower = MIN_TICK;
  }

  const startPrice = tokenIsToken0 ? priceDecoded : 1 / priceDecoded; // WETH per token
  const impliedStartMcapEth = startPrice * totalSupply;

  return { initialSqrtPriceX96, tickLower, tickUpper, tokenIsToken0, impliedStartMcapEth, graduationEth };
}

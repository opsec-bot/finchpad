// Trading against the token's Uniswap V3 pool: quoting, slippage, price impact, execution.
//
// Buys spend native ETH in a single transaction — SwapRouter02's `pay()` wraps ETH itself
// when tokenIn is WETH and value is attached, so there is no separate wrap or approval.
// Sells spend the token, so they need an ERC-20 approval first; the output is unwrapped
// back to ETH via multicall so a seller receives ETH rather than WETH they then have to
// deal with.

import { encodeFunctionData, formatEther, parseAbi } from "viem";
import type { Address, PublicClient, WalletClient } from "viem";
import { addresses } from "./chain";
import { erc20Abi } from "./abis";

export const POOL_FEE = 10_000; // 1% tier, what the factory launches into

export const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

export const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

export type Side = "buy" | "sell";

export interface Quote {
  amountIn: bigint;
  amountOut: bigint;
  /** Fraction, e.g. 0.0123 for 1.23%. Positive means the trade moves price against you. */
  priceImpact: number;
  /** amountOut with slippage tolerance applied — what goes on-chain as the floor. */
  minReceived: bigint;
  /** Execution price vs the pool's spot price, both as tokens-per-ETH for display. */
  spotPrice: number;
  executionPrice: number;
}

/** sqrtPriceX96 -> price of token0 in units of token1. */
function priceFromSqrt(sqrtPriceX96: bigint): number {
  const s = Number(sqrtPriceX96) / 2 ** 96;
  return s * s;
}

/** WETH per whole token, respecting pool ordering. */
export function tokenPriceInEth(sqrtPriceX96: bigint, tokenIsToken0: boolean): number {
  const p = priceFromSqrt(sqrtPriceX96);
  return tokenIsToken0 ? p : 1 / p;
}

export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/**
 * Quote a trade off-chain.
 *
 * QuoterV2 is not a `view` function — it reverts internally to unwind state — so it must be
 * simulated rather than read. Price impact is measured against the pool's live spot price
 * rather than derived from the tick delta, so it reflects what the trader actually pays.
 */
export async function quote(
  client: PublicClient,
  {
    token,
    pool,
    tokenIsToken0,
    side,
    amountIn,
    slippageBps,
  }: {
    token: Address;
    pool: Address;
    tokenIsToken0: boolean;
    side: Side;
    amountIn: bigint;
    slippageBps: number;
  },
): Promise<Quote> {
  const weth = addresses.weth as Address;
  const [tokenIn, tokenOut] = side === "buy" ? [weth, token] : [token, weth];

  const { result } = await client.simulateContract({
    address: addresses.quoter as Address,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: POOL_FEE, sqrtPriceLimitX96: 0n }],
  });
  const amountOut = result[0];

  const [slot0] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
  ]);
  const spot = tokenPriceInEth(slot0[0], tokenIsToken0); // ETH per token

  // Both sides expressed as ETH per token so they are directly comparable.
  const execution =
    side === "buy"
      ? Number(formatEther(amountIn)) / Number(formatEther(amountOut))
      : Number(formatEther(amountOut)) / Number(formatEther(amountIn));

  // Buying pushes price up, selling pushes it down; either way the trader is worse off than
  // spot, so report the magnitude.
  const priceImpact = spot > 0 ? Math.abs(execution - spot) / spot : 0;

  return {
    amountIn,
    amountOut,
    priceImpact,
    minReceived: applySlippage(amountOut, slippageBps),
    spotPrice: spot,
    executionPrice: execution,
  };
}

/** Current ERC-20 allowance for the router. */
export async function routerAllowance(client: PublicClient, token: Address, owner: Address): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: parseAbi(["function allowance(address,address) view returns (uint256)"]),
    functionName: "allowance",
    args: [owner, addresses.swapRouter as Address],
  });
}

export async function approveRouter(
  wallet: WalletClient,
  client: PublicClient,
  token: Address,
  amount: bigint,
): Promise<`0x${string}`> {
  const { request } = await client.simulateContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [addresses.swapRouter as Address, amount],
    account: wallet.account!.address,
  });
  return wallet.writeContract(request);
}

/** Deadline-free: SwapRouter02 dropped the deadline from ExactInputSingleParams. */
function swapParams(tokenIn: Address, tokenOut: Address, recipient: Address, amountIn: bigint, minOut: bigint) {
  return { tokenIn, tokenOut, fee: POOL_FEE, recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n };
}

/**
 * Execute a swap.
 *
 * Buy: one transaction, native ETH attached — the router wraps it.
 * Sell: output is routed to the router itself and unwrapped to ETH in the same multicall,
 *       so the seller ends up with ETH instead of WETH.
 */
export async function swap(
  wallet: WalletClient,
  client: PublicClient,
  {
    token,
    side,
    amountIn,
    minOut,
  }: { token: Address; side: Side; amountIn: bigint; minOut: bigint },
): Promise<`0x${string}`> {
  const account = wallet.account!.address;
  const weth = addresses.weth as Address;
  const router = addresses.swapRouter as Address;

  if (side === "buy") {
    const { request } = await client.simulateContract({
      address: router,
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [swapParams(weth, token, account, amountIn, minOut)],
      value: amountIn,
      account,
    });
    return wallet.writeContract(request);
  }

  // Sell: swap to WETH held by the router, then unwrap the whole balance to the seller.
  const swapCall = encodeFunctionData({
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [swapParams(token, weth, router, amountIn, minOut)],
  });
  const unwrapCall = encodeFunctionData({
    abi: routerAbi,
    functionName: "unwrapWETH9",
    args: [minOut, account],
  });
  const { request } = await client.simulateContract({
    address: router,
    abi: routerAbi,
    functionName: "multicall",
    args: [[swapCall, unwrapCall]],
    account,
  });
  return wallet.writeContract(request);
}

/**
 * Turn a wallet/RPC error into something a trader can act on.
 *
 * The defaults are unusable: viem surfaces a wall of request detail, and the interesting
 * part (a revert string like "Too little received", or a user rejection) is buried.
 */
export function readableError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string; cause?: { reason?: string } };
  const raw = e?.cause?.reason || e?.shortMessage || e?.message || "Transaction failed";

  if (/User rejected|denied transaction|User denied/i.test(raw)) return "You rejected the transaction.";
  if (/Too little received|STF|amountOutMinimum/i.test(raw))
    return "Price moved beyond your slippage tolerance. Raise slippage or try a smaller size.";
  if (/insufficient funds/i.test(raw)) return "Not enough ETH to cover the trade plus gas.";
  // viem's gas-affordability error says "…exceeds the balance of the account" — that's an
  // empty-of-ETH wallet, NOT a token balance problem. Must be matched before the generic
  // "exceeds the balance" ERC20 case or it reads as the wrong failure entirely.
  if (/exceeds the balance of the account|total cost.*of executing this transaction/i.test(raw))
    return "Not enough ETH in your wallet to pay for gas. Add ETH and try again.";
  if (/TF\b/.test(raw)) return "The token blocked this transfer — it may still be inside its anti-snipe window.";
  if (/SPL|LOK/.test(raw)) return "The pool rejected the price limit. Try again.";
  if (/nonce too (high|low)/i.test(raw))
    return "Your wallet's nonce is out of sync with the chain. In MetaMask: Settings, Advanced, Clear activity tab data.";
  if (/transfer amount exceeds|exceeds the balance/i.test(raw)) return "Amount exceeds your token balance.";

  // Keep it to one line; the console has the full object for anyone debugging.
  return raw.split("\n")[0].slice(0, 200);
}

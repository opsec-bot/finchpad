// Reusable read helpers shared by the CLIs and the backend API.
// Everything reads straight off-chain so the API works before any database exists.

import { formatEther } from "viem";
import { publicClient } from "./chain.js";
import { getLogsChunked } from "./logs.js";
import {
  PONS, SWAP, TOKEN_LAUNCHED, FINCH_LAUNCHED, FEATURED,
  factoryAbi, finchFactoryAbi, finchLockerAbi, poolAbi, tokenAbi,
} from "./contracts.js";
import { toCandles } from "./ohlc.js";

// Never scan below this block. Two reasons:
//  - production: scanning before the factory's deploy block is pure waste.
//  - local anvil fork: blocks below the fork base are proxied upstream and error out, so a
//    naive "last 5000 blocks" query crosses the fork boundary and fails.
const MIN_BLOCK = process.env.FINCHPAD_MIN_BLOCK ? BigInt(process.env.FINCHPAD_MIN_BLOCK) : 0n;

function floorBlock(from) {
  return from < MIN_BLOCK ? MIN_BLOCK : from;
}

/** sqrtPriceX96 -> WETH per token, respecting pool ordering. */
export function priceFromSqrt(sqrtPriceX96, tokenIsToken0) {
  const s = Number(sqrtPriceX96) / 2 ** 96;
  const token1PerToken0 = s * s;
  return tokenIsToken0 ? token1PerToken0 : 1 / token1PerToken0;
}

/** Full detail for one launched token: metadata, pool, live price, graduation. */
export async function getTokenDetail(token, factoryAddress) {
  const [name, symbol, decimals, totalSupply, pool] = await Promise.all([
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "decimals" }),
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply" }),
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "liquidityPool" }),
  ]);

  const tokenIsToken0 = token.toLowerCase() < PONS.weth.toLowerCase();

  const [slot0, ponsLaunched, graduation] = await Promise.all([
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
    publicClient
      .readContract({ address: factoryAddress, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] })
      .catch(() => null),
    publicClient
      .readContract({ address: factoryAddress, abi: factoryAbi, functionName: "graduationStatus", args: [token] })
      .catch(() => null),
  ]);

  // pons exposes getLaunchedToken on the factory; finchpad does not — our launch state lives
  // in the locker, reached via factory.locker(). Try pons' shape first, then ours.
  let launched = ponsLaunched?.exists === true ? ponsLaunched : null;
  if (!launched) {
    const lockerAddr = await publicClient
      .readContract({ address: factoryAddress, abi: finchFactoryAbi, functionName: "locker" })
      .catch(() => null);
    if (lockerAddr) {
      const l = await publicClient
        .readContract({ address: lockerAddr, abi: finchLockerAbi, functionName: "launches", args: [token] })
        .catch(() => null);
      // tuple: positionId, protocolShareBps, tokenIsToken0, controller, feeWallet,
      //        claimKind, githubId, githubClaimed, escrowDeadline, escrowedToken,
      //        escrowedWeth, exists, referrer, lifetimeWethFees
      if (l && l[11] === true) {
        launched = {
          exists: true,
          deployer: l[3],
          poolFee: 10000,
          feeWallet: l[4],
          claimKind: Number(l[5]), // 0 none, 1 repo, 2 user
          githubId: l[6],
          githubClaimed: l[7],
          escrowDeadline: l[8],
          escrowedToken: l[9],
          escrowedWeth: l[10],
          referrer: l[12],
          lifetimeWethFees: l[13],
        };
      }
    }
  }

  const priceWeth = priceFromSqrt(slot0[0], tokenIsToken0);
  const supplyTokens = Number(formatEther(totalSupply));

  // getLaunchedToken returns a ZERO-FILLED struct (exists=false) for tokens that didn't come
  // from this factory, rather than reverting. Passing those zeros through would report a
  // deployer of 0x0 and a 0% pool fee as though they were real. Only trust it when exists.
  const known = launched?.exists === true;

  return {
    address: token,
    name,
    symbol,
    decimals,
    totalSupply: supplyTokens,
    pool,
    tokenIsToken0,
    priceWeth,
    marketCapWeth: priceWeth * supplyTokens,
    knownToFactory: known,
    deployer: known ? launched.deployer : null,
    poolFee: known ? Number(launched.poolFee) : null,
    feeWallet: known ? (launched.feeWallet ?? null) : null,
    // GitHub claim surface for the frontend and external indexers: which identity the fee
    // right is bound to, whether it has been claimed, and what's escrowed for it so far.
    github: known && launched.claimKind
      ? {
          kind: launched.claimKind === 1 ? "repo" : "user",
          githubId: launched.githubId.toString(),
          claimed: launched.githubClaimed ?? false,
          escrowDeadline: launched.escrowDeadline ? Number(launched.escrowDeadline) : null,
          escrowedToken: launched.escrowedToken?.toString() ?? "0",
          escrowedWeth: launched.escrowedWeth?.toString() ?? "0",
        }
      : null,
    // Protocol-controlled traction accounting: WETH fees the locker has actually paid out
    // for this token. Unlike `graduation` below (a pool-balance read, cosmetic), this cannot
    // be moved by donating to the pool — only real swap fees advance it.
    traction: known && launched.lifetimeWethFees !== undefined
      ? { lifetimeWethFees: launched.lifetimeWethFees.toString() }
      : null,
    graduation: graduation
      ? {
          pairedPrincipalEth: Number(formatEther(graduation[0])),
          thresholdEth: Number(formatEther(graduation[1])),
          graduated: graduation[2],
          progress: graduation[1] > 0n ? Number((graduation[0] * 10000n) / graduation[1]) / 10000 : 0,
        }
      : null,
  };
}

/** Recent launches from a factory. */
export async function getRecentLaunches({ factoryAddress, blocks = 5000n, chunkSize = 1000n, limit = 50 }) {
  const latest = await publicClient.getBlockNumber();
  const fromBlock = floorBlock(latest > blocks ? latest - blocks : 0n);

  // Query BOTH launch-event shapes: pons' TokenLaunched and finchpad's Launched. One
  // indexer then serves either factory with no configuration, which is what we want while
  // finchpad reads pons data for comparison.
  const [ponsLogs, finchLogs] = await Promise.all([
    getLogsChunked({ address: factoryAddress, event: TOKEN_LAUNCHED, fromBlock, toBlock: latest, chunkSize }).catch(
      () => []
    ),
    getLogsChunked({ address: factoryAddress, event: FINCH_LAUNCHED, fromBlock, toBlock: latest, chunkSize }).catch(
      () => []
    ),
  ]);

  const norm = (l, isFinch) => ({
    token: l.args.token,
    deployer: isFinch ? l.args.creator : l.args.deployer,
    pool: l.args.pool,
    block: Number(l.blockNumber),
    txHash: l.transactionHash,
    initialBuyEth: l.args.initialBuyAmount ? Number(formatEther(l.args.initialBuyAmount)) : 0,
  });

  return [...ponsLogs.map((l) => norm(l, false)), ...finchLogs.map((l) => norm(l, true))]
    .sort((a, b) => a.block - b.block)
    .slice(-limit)
    .reverse();
}

/** Normalized trades for a token's pool over a block window. */
export async function getTrades({ token, pool, tokenIsToken0, blocks = 5000n, chunkSize = 1000n }) {
  const latest = await publicClient.getBlockNumber();
  const fromBlock = floorBlock(latest > blocks ? latest - blocks : 0n);

  const logs = await getLogsChunked({ address: pool, event: SWAP, fromBlock, toBlock: latest, chunkSize });

  // Timestamps for the distinct blocks we touched.
  const uniqueBlocks = [...new Set(logs.map((l) => l.blockNumber))];
  const timestamps = new Map();
  const CONCURRENCY = 8;
  for (let i = 0; i < uniqueBlocks.length; i += CONCURRENCY) {
    const slice = uniqueBlocks.slice(i, i + CONCURRENCY);
    const blocksData = await Promise.all(slice.map((b) => publicClient.getBlock({ blockNumber: b })));
    blocksData.forEach((b) => timestamps.set(b.number, Number(b.timestamp)));
  }

  return logs
    .map((l) => {
      const { amount0, amount1, sqrtPriceX96 } = l.args;
      const tokenRaw = tokenIsToken0 ? amount0 : amount1;
      const wethRaw = tokenIsToken0 ? amount1 : amount0;
      return {
        block: Number(l.blockNumber),
        timestamp: timestamps.get(l.blockNumber) ?? 0,
        txHash: l.transactionHash,
        side: wethRaw > 0n ? "buy" : "sell",
        tokenAmount: Number(formatEther(tokenRaw < 0n ? -tokenRaw : tokenRaw)),
        wethAmount: Number(formatEther(wethRaw < 0n ? -wethRaw : wethRaw)),
        priceWeth: priceFromSqrt(sqrtPriceX96, tokenIsToken0),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp || a.block - b.block);
}

/** Trades bucketed into OHLCV candles. */
export async function getCandles(opts, interval = 300) {
  const trades = await getTrades(opts);
  return { trades: trades.length, candles: toCandles(trades, interval) };
}

/**
 * Reduce raw Featured logs to the currently-active featured tokens. The latest `until` per
 * token wins (buying more days extends the window), and expired entries are dropped. Pure and
 * exported so it can be unit-tested without a chain.
 * @param {{args:{token:string,until:bigint|number}}[]} logs
 * @param {number} nowSec  current unix time in seconds
 */
export function activeFeatured(logs, nowSec) {
  const byToken = new Map();
  for (const log of logs) {
    const token = log.args.token;
    const until = Number(log.args.until);
    const prev = byToken.get(token);
    if (!prev || until > prev.until) byToken.set(token, { token, until });
  }
  return [...byToken.values()].filter((f) => f.until > nowSec).sort((a, b) => b.until - a.until);
}

/**
 * Currently-featured tokens read from a FeatureBoost contract's logs. Returns [] when no
 * FeatureBoost address is configured (i.e. before finchpad's own contracts deploy).
 * @param {{featureBoost?:string, blocks?:bigint, chunkSize?:bigint}} opts
 */
export async function getFeatured({ featureBoost, blocks = 50_000n, chunkSize = 2000n }) {
  if (!featureBoost) return [];
  const latest = await publicClient.getBlockNumber();
  const fromBlock = floorBlock(latest > blocks ? latest - blocks : 0n);
  const logs = await getLogsChunked({ address: featureBoost, event: FEATURED, fromBlock, toBlock: latest, chunkSize });
  return activeFeatured(logs, Math.floor(Date.now() / 1000));
}

// Reusable read helpers shared by the CLIs and the backend API.
// Everything reads straight off-chain so the API works before any database exists.

import { formatEther } from "viem";
import { publicClient } from "./chain.js";
import { getLogsChunked } from "./logs.js";
import { PONS, SWAP, TOKEN_LAUNCHED, factoryAbi, poolAbi, tokenAbi } from "./contracts.js";
import { toCandles } from "./ohlc.js";

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

  const [slot0, launched, graduation] = await Promise.all([
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
    publicClient
      .readContract({ address: factoryAddress, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] })
      .catch(() => null),
    publicClient
      .readContract({ address: factoryAddress, abi: factoryAbi, functionName: "graduationStatus", args: [token] })
      .catch(() => null),
  ]);

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
  const fromBlock = latest > blocks ? latest - blocks : 0n;

  const logs = await getLogsChunked({
    address: factoryAddress,
    event: TOKEN_LAUNCHED,
    fromBlock,
    toBlock: latest,
    chunkSize,
  });

  return logs
    .slice(-limit)
    .reverse()
    .map((l) => ({
      token: l.args.token,
      deployer: l.args.deployer,
      pool: l.args.pool,
      block: Number(l.blockNumber),
      txHash: l.transactionHash,
      initialBuyEth: l.args.initialBuyAmount ? Number(formatEther(l.args.initialBuyAmount)) : 0,
    }));
}

/** Normalized trades for a token's pool over a block window. */
export async function getTrades({ token, pool, tokenIsToken0, blocks = 5000n, chunkSize = 1000n }) {
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > blocks ? latest - blocks : 0n;

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

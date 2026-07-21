// End-to-end indexer validation against a known graduated token.
// Reads the reference token's on-chain state through the same paths the finchpad
// indexer will use, and asserts the pieces we can check against the docs.
import { formatEther, getAddress, zeroAddress } from "viem";
import { publicClient } from "../lib/chain.js";
import {
  PONS,
  REFERENCE_TOKEN,
  factoryAbi,
  lockerAbi,
  poolAbi,
  tokenAbi,
} from "../lib/contracts.js";

const { token, pool: expectedPool, factory: factoryKey } = REFERENCE_TOKEN;
const factory = PONS[factoryKey];

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log(`\nfinchpad · reference token validation`);
console.log(`token   ${token}`);
console.log(`factory ${factory.address} (${factoryKey})\n`);

// 1. Token is self-describing on-chain.
const [name, symbol, decimals, totalSupply, poolFromToken] = await Promise.all([
  publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
  publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
  publicClient.readContract({ address: token, abi: tokenAbi, functionName: "decimals" }),
  publicClient.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply" }),
  publicClient.readContract({ address: token, abi: tokenAbi, functionName: "liquidityPool" }),
]);

check("token metadata reads", Boolean(name && symbol), `${name} (${symbol}), ${decimals} decimals`);
check(
  "liquidityPool() matches reference pool",
  getAddress(poolFromToken) === getAddress(expectedPool),
  poolFromToken
);
check(
  "supply is 1e9 tokens",
  totalSupply === 1_000_000_000n * 10n ** 18n,
  `${(Number(totalSupply / 10n ** 18n)).toLocaleString()} ${symbol}`
);

// 2. Launch-level state from the factory. viem returns the single named-tuple
// output directly (the docs' `{ launched }` destructure assumes a wrapper that
// isn't there).
const launched = await publicClient.readContract({
  address: factory.address,
  abi: factoryAbi,
  functionName: "getLaunchedToken",
  args: [token],
});

check("factory knows this token", launched.exists === true, `deployer ${launched.deployer}`);
check("pairedToken is WETH", getAddress(launched.pairedToken) === getAddress(PONS.weth), launched.pairedToken);
check("pool fee is 1%", launched.poolFee === 10000, String(launched.poolFee));

// 3. Graduation.
const [pairedPrincipal, threshold, graduated] = await publicClient.readContract({
  address: factory.address,
  abi: factoryAbi,
  functionName: "graduationStatus",
  args: [token],
});
const progress = threshold > 0n ? Number((pairedPrincipal * 10000n) / threshold) / 100 : 0;
check("reference token is graduated", graduated === true, `${progress}% of ${formatEther(threshold)} ETH`);

// 4. Fee split + payout, resolving the locker from the factory rather than hardcoding.
const locker = await publicClient.readContract({
  address: factory.address,
  abi: factoryAbi,
  functionName: "locker",
});
const [protocolShare, redirect] = await Promise.all([
  publicClient.readContract({ address: locker, abi: lockerAbi, functionName: "tokenProtocolFeeShares", args: [token] }),
  publicClient.readContract({ address: locker, abi: lockerAbi, functionName: "feeRedirects", args: [token] }),
]);
const creatorShare = 100 - Number(protocolShare);
const payout = redirect === zeroAddress ? launched.deployer : redirect;
check(
  "fee split matches legacy 90/10",
  creatorShare === factory.feeSplit.creator && Number(protocolShare) === factory.feeSplit.protocol,
  `creator ${creatorShare}% / protocol ${protocolShare}% → payout ${payout}`
);

// 5. Live price off the pool's slot0.
const [sqrtPriceX96] = await publicClient.readContract({
  address: expectedPool,
  abi: poolAbi,
  functionName: "slot0",
});
const ratio = Number(sqrtPriceX96) / 2 ** 96;
const t1PerT0 = ratio * ratio;
const priceInWeth = launched.isToken0 ? t1PerT0 : 1 / t1PerT0;
check("pool has a live price", priceInWeth > 0, `${priceInWeth.toExponential(4)} WETH/token (isToken0=${launched.isToken0})`);

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
process.exit(failed.length ? 1 : 0);

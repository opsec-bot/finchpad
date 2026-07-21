import { parseAbi, parseAbiItem } from "viem";

// Deployed pons contracts on Robinhood Chain (chain 4663).
// finchpad will ship its own factory/locker; until then these are the on-chain
// reference the indexer is validated against. Deployed contracts are immutable —
// new versions ship as new addresses.
export const PONS = {
  activeFactory: {
    address: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
    startBlock: 8991118n,
    feeSplit: { creator: 70, protocol: 30 },
  },
  legacyFactory: {
    address: "0x0c37a24F5D23A486FA692d1500881d698B1F77a4",
    startBlock: 8600612n,
    feeSplit: { creator: 90, protocol: 10 },
  },
  activeLocker: "0x736D76699C26D0d966744cAe304C000d471f7F35",
  legacyLocker: "0x31ca5E101941A93A7DD6d0497928700625CF54B5",
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
};

// A graduated token with known state, for validating an indexer end-to-end.
export const REFERENCE_TOKEN = {
  token: "0x39dBED3a2bd333467115dE45665cC57F813C4571",
  pool: "0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA",
  launchTx: "0x1f54f25fec2d963dcb338ecb8b46a6eb123198a5c7a746d34cb2dbe78d074af8",
  factory: "legacyFactory", // launched through the legacy factory → 90/10 split
};

export const TOKEN_LAUNCHED = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)"
);

/// finchpad's own launch event. Deliberately NOT pons-shaped — ours carries the fields we
/// actually index (creator, ordering) instead of pons-specific ones (dexId, launchConfigId).
export const FINCH_LAUNCHED = parseAbiItem(
  "event Launched(address indexed token, address indexed creator, address pool, uint256 positionId, bool tokenIsToken0)"
);

export const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export const SWAP = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
);

// Launch tokens are self-describing on-chain.
export const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function liquidityPool() view returns (address)",
  "function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)",
]);

export const factoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount) launched)",
  "function graduationStatus(address token) view returns (uint256 pairedPrincipal, uint256 threshold, bool graduated)",
  "function locker() view returns (address)",
]);

/// finchpad's factory/locker reads. Our factory has no getLaunchedToken (that's a pons
/// function) — launch state lives in the locker, reachable via factory.locker().
export const finchFactoryAbi = parseAbi([
  "function locker() view returns (address)",
  "function graduationStatus(address token) view returns (uint256 pairedPrincipal, uint256 threshold, bool graduated)",
]);

export const finchLockerAbi = parseAbi([
  "function launches(address token) view returns (uint256 positionId, uint16 protocolShareBps, bool tokenIsToken0, address controller, address feeWallet, uint8 claimKind, uint256 githubId, bool githubClaimed, uint64 escrowDeadline, uint256 escrowedToken, uint256 escrowedWeth, bool exists)",
  "function escrowOf(address token) view returns (uint256 escrowedToken, uint256 escrowedWeth, uint64 escrowDeadline)",
  "function githubBindingOf(address token) view returns (uint8 kind, uint256 githubId, bool claimed)",
]);

export const lockerAbi = parseAbi([
  "function tokenProtocolFeeShares(address token) view returns (uint256)",
  "function feeRedirects(address token) view returns (address)",
  "function protocolFeeRecipient() view returns (address)",
]);

export const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]);

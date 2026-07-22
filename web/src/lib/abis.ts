import { parseAbi } from "viem";

/** Only what the UI actually calls. Kept in sync with contracts/src by the shapes below. */
export const finchFactoryAbi = parseAbi([
  "function LAUNCH_FEE() view returns (uint256)",
  "function POOL_FEE() view returns (uint24)",
  "function locker() view returns (address)",
  "function graduationStatus(address token) view returns (uint256 earned, uint256 threshold, bool graduated)",
  // Field order must match FinchFactory.LaunchParams EXACTLY — the tuple order is part of
  // the selector, so a reordering silently produces a call that matches no function and
  // reverts with empty data. test/abiSync.test.js pins these against the compiled artifacts.
  "function launch((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,uint8 claimKind,uint256 githubId,uint160 initialSqrtPriceX96,int24 tickLower,int24 tickUpper,address referrer,address feeWallet,uint256 creatorBuyAmount) p) payable returns (address token, address pool, uint256 positionId, uint256 amountOut)",
  "event Launched(address indexed token, address indexed creator, address pool, uint256 positionId, bool tokenIsToken0)",
]);

export const finchLockerAbi = parseAbi([
  "function collect(address token)",
  "function escrowOf(address token) view returns (uint256 escrowedToken, uint256 escrowedWeth, uint64 escrowDeadline)",
  "function graduationOf(address token) view returns (uint256 lifetimeWethFees, uint256 threshold, bool graduated)",
  "function githubBindingOf(address token) view returns (uint8 kind, uint256 githubId, bool claimed)",
  "function feeWalletOf(address token) view returns (address)",
  "function controllerOf(address token) view returns (address)",
]);

export const feeRightsRegistryAbi = parseAbi([
  "function claimGithub(address token, uint8 claimKind, uint256 githubId, uint256 deadline, bytes signature)",
  "function redirectFees(address token, address newFeeWallet)",
]);

export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function burn(uint256 amount)",
]);

export const swapRouterAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

export const wethAbi = parseAbi([
  "function deposit() payable",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** Mirrors the on-chain ClaimKind enum. */
export const ClaimKind = { None: 0, Repo: 1, User: 2 } as const;

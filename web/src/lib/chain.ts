import { createPublicClient, defineChain, http } from "viem";

/**
 * Robinhood Chain mainnet. Not in viem/chains, so it is defined here and handed to
 * PrivyProvider via defaultChain/supportedChains.
 *
 * Note this is an Arbitrum Orbit/Nitro chain: `block.number` is an L1 estimate that advances
 * roughly every 12s rather than per L2 block. That only matters for reading the token's
 * anti-snipe window (see docs/robinhood-chain-reference.md).
 */
export const robinhoodChain = defineChain({
  // 4663 in production. Overridable because MetaMask has a built-in entry for 4663 and
  // pins its own public RPC to that id, so a local fork on 4663 shows a 0 balance in the
  // wallet however you configure it. Run the fork on another id (FORK_CHAIN_ID=31337) and
  // set this to match, and MetaMask treats it as a fresh network with only your RPC.
  id: Number(import.meta.env.VITE_CHAIN_ID ?? 4663),
  name: "Robinhood Chain",
  network: "robinhood",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

/** Mainnet Uniswap V3 periphery + the finchpad deployment, all overridable per environment. */
export const addresses = {
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoter: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7", // QuoterV2

  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  // Unset until finchpad deploys. The UI gates write actions on these being present rather
  // than sending transactions into the void.
  factory: (import.meta.env.VITE_FINCH_FACTORY ?? "") as `0x${string}` | "",
  locker: (import.meta.env.VITE_FINCH_LOCKER ?? "") as `0x${string}` | "",
  registry: (import.meta.env.VITE_FINCH_REGISTRY ?? "") as `0x${string}` | "",
  featureBoost: (import.meta.env.VITE_FINCH_FEATURE_BOOST ?? "") as `0x${string}` | "",
} as const;

/** A read-only client for cheap public reads (wallet balances, etc.) that need no signer. */
export const publicClient = createPublicClient({ chain: robinhoodChain, transport: http() });

export const explorerTx = (hash: string) => `${robinhoodChain.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (a: string) => `${robinhoodChain.blockExplorers.default.url}/address/${a}`;

import { createPublicClient, defineChain, http } from "viem";

// Robinhood Chain — the network pons runs on and where finchpad will deploy.
//
// Two RPCs on purpose (measured, not guessed):
//  - READS (eth_call, getBlock): Alchemy is reliable and fast.
//  - LOGS (eth_getLogs): Alchemy's FREE tier caps ranges at 10 blocks, which makes scanning
//    unusable. The public RPC happily serves 500+ block spans. So logs go to the public RPC.
// Override either with FINCHPAD_RPC_URL / FINCHPAD_LOGS_RPC_URL.
// Load env with `node --env-file=.env ...` (Node 20+).
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

// FINCHPAD_RPC_URL wins over the Alchemy default: it's the explicit override, and pointing
// local dev at an anvil fork (http://localhost:8545) has to beat whatever is in .env.
const READ_RPC_URL = process.env.FINCHPAD_RPC_URL || process.env.ALCHEMY_RH_MAINNET || PUBLIC_RPC;
// Logs follow the read RPC when it's explicitly overridden (anvil serves wide ranges fine).
const LOGS_RPC_URL = process.env.FINCHPAD_LOGS_RPC_URL || process.env.FINCHPAD_RPC_URL || PUBLIC_RPC;

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [READ_RPC_URL],
    },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  // Canonical Multicall3, verified deployed on chain 4663. Lets us batch balanceOf reads.
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

/** Contract reads and block lookups (Alchemy when configured). */
export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(READ_RPC_URL),
});

/** eth_getLogs only — always a provider that allows wide block ranges. */
export const logsClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(LOGS_RPC_URL),
});

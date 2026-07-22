// Transaction plumbing: turn a Privy wallet into a viem WalletClient on chain 4663.

import { createPublicClient, createWalletClient, custom, getContractAddress, http } from "viem";
import type { Address, WalletClient } from "viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { robinhoodChain } from "./chain";

export const publicClient = createPublicClient({ chain: robinhoodChain, transport: http() });

/**
 * Put the wallet on Robinhood Chain, adding the network first if it does not know it.
 *
 * Chain 4663 is not in any wallet's default list, so `switchChain` alone fails with
 * "Provider is not connected to the requested chain" on a wallet that has never seen it.
 * EIP-3326 says to fall back to wallet_addEthereumChain (EIP-3085) in that case.
 */
export async function switchToRobinhood(wallet: ConnectedWallet): Promise<void> {
  try {
    await wallet.switchChain(robinhoodChain.id);
    return;
  } catch (err) {
    const provider = await wallet.getEthereumProvider();
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${robinhoodChain.id.toString(16)}`,
            chainName: robinhoodChain.name,
            nativeCurrency: robinhoodChain.nativeCurrency,
            rpcUrls: [...robinhoodChain.rpcUrls.default.http],
            blockExplorerUrls: [robinhoodChain.blockExplorers.default.url],
          },
        ],
      });
    } catch {
      // Surface the original switch failure — it is the more useful of the two.
      throw err;
    }
    await wallet.switchChain(robinhoodChain.id);
  }
}

/**
 * A wallet client for the connected wallet, on Robinhood Chain.
 * Switches the wallet's network first — an external wallet sitting on mainnet would
 * otherwise sign for the wrong chain.
 */
export async function getWalletClient(wallet: ConnectedWallet): Promise<WalletClient> {
  await switchToRobinhood(wallet);
  const provider = await wallet.getEthereumProvider();
  return createWalletClient({
    account: wallet.address as Address,
    chain: robinhoodChain,
    transport: custom(provider),
  });
}

/**
 * Predict the address of the next token the factory will clone.
 *
 * The factory deploys via Clones.clone (CREATE), so the address is a function of the
 * factory's nonce. We need it BEFORE sending, because token/WETH address ordering decides
 * which side of the current tick the single-sided position must sit on.
 *
 * RACE: if another launch lands between this read and our transaction, the nonce moves and
 * the prediction is wrong. If the ordering flips, the tick range ends up on the wrong side
 * and the factory reverts with NoLiquidityMinted — the whole transaction reverts, so nothing
 * is lost but gas, and the fix is to retry. The UI surfaces exactly that.
 */
export async function predictTokenAddress(factory: Address): Promise<Address> {
  const nonce = await publicClient.getTransactionCount({ address: factory });
  return getContractAddress({ from: factory, nonce: BigInt(nonce) });
}

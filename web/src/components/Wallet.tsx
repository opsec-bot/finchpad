import { usePrivy, useWallets } from "@privy-io/react-auth";
import { robinhoodChain } from "../lib/chain";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The connected wallet we transact with, or null. */
export function useActiveWallet() {
  const { wallets } = useWallets();
  return wallets[0] ?? null;
}

export function WalletButton() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const wallet = useActiveWallet();

  if (!ready) return <span className="dim">…</span>;
  if (!authenticated) {
    return (
      <button className="primary" onClick={login}>
        connect wallet
      </button>
    );
  }
  const label = wallet ? short(wallet.address) : (user?.email?.address ?? "connected");
  return (
    <>
      <span className="pill mono" title={wallet?.address}>
        {label}
      </span>
      {wallet && wallet.chainId !== `eip155:${robinhoodChain.id}` && (
        <button onClick={() => wallet.switchChain(robinhoodChain.id)}>switch to chain 4663</button>
      )}
      <button onClick={logout}>disconnect</button>
    </>
  );
}

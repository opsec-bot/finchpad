import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { robinhoodChain } from "../lib/chain";
import { switchToRobinhood } from "../lib/tx";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The connected wallet we transact with, or null. */
export function useActiveWallet() {
  const { wallets } = useWallets();
  return wallets[0] ?? null;
}

export function WalletButton() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const wallet = useActiveWallet();
  const [switchErr, setSwitchErr] = useState<string | null>(null);

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
        <button
          onClick={() => {
            setSwitchErr(null);
            switchToRobinhood(wallet).catch((e: Error) =>
              setSwitchErr(e.message.includes("rejected") ? "chain switch rejected" : "could not switch chain"),
            );
          }}
        >
          switch to chain {robinhoodChain.id}
        </button>
      )}
      {switchErr && <span className="warn">{switchErr}</span>}
      <button onClick={logout}>disconnect</button>
    </>
  );
}

import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
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

  if (!ready) return <span className="text-muted-foreground">…</span>;
  if (!authenticated) {
    return (
      <Button size="sm" onClick={login}>
        Connect wallet
      </Button>
    );
  }
  const label = wallet ? short(wallet.address) : (user?.email?.address ?? "connected");
  return (
    <>
      <span className="pill mono" title={wallet?.address}>
        {label}
      </span>
      {wallet && wallet.chainId !== `eip155:${robinhoodChain.id}` && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setSwitchErr(null);
            switchToRobinhood(wallet).catch((e: Error) =>
              setSwitchErr(e.message.includes("rejected") ? "chain switch rejected" : "could not switch chain"),
            );
          }}
        >
          Switch to {robinhoodChain.id}
        </Button>
      )}
      {switchErr && <span className="text-destructive text-sm">{switchErr}</span>}
      <Button variant="ghost" size="sm" onClick={logout}>Disconnect</Button>
    </>
  );
}

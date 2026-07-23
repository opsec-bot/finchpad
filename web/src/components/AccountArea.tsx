import { useEffect, useState } from "react";
import { usePrivy, useFundWallet } from "@privy-io/react-auth";
import { formatEther } from "viem";
import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/components/AccountMenu";
import { useActiveWallet } from "@/components/Wallet";
import { Balance } from "@/lib/blurBalances";
import { onLive } from "@/lib/live";
import { usdExact } from "@/lib/money";
import { publicClient, robinhoodChain } from "@/lib/chain";
import { switchToRobinhood } from "@/lib/tx";
import { api } from "@/lib/api";

/**
 * The top-right cluster, fomo-style: the wallet's spendable cash (in USD, with ETH beneath),
 * a Deposit action, and the avatar → account menu. Falls back to a single Connect button when
 * signed out, and to a network-switch prompt when the wallet is on the wrong chain.
 */
export function AccountArea() {
  const { ready, authenticated, login } = usePrivy();
  const { fundWallet } = useFundWallet();
  const wallet = useActiveWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [ethUsd, setEthUsd] = useState<number | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setEthUsd(h.ethUsd))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const address = wallet?.address as `0x${string}` | undefined;
    if (!address) {
      setBalance(null);
      return;
    }
    let alive = true;
    const read = () =>
      publicClient
        .getBalance({ address })
        .then((b) => alive && setBalance(b))
        .catch(() => {});
    read();
    // The 15s poll is the backstop (deposits, gas); the live stream makes the number move the
    // instant one of MY swaps is indexed.
    const id = setInterval(read, 15_000);
    const off = onLive("swap", (s) => {
      if (s.trader && s.trader.toLowerCase() === address.toLowerCase()) read();
    });
    return () => {
      alive = false;
      clearInterval(id);
      off();
    };
  }, [wallet?.address]);

  if (!ready) return <span className="text-sm text-muted-foreground">…</span>;
  if (!authenticated)
    return (
      <Button size="sm" onClick={login}>
        Connect wallet
      </Button>
    );

  const eth = balance != null ? Number(formatEther(balance)) : null;
  const usd = eth != null && ethUsd != null ? eth * ethUsd : null;
  const wrongChain = wallet && wallet.chainId !== `eip155:${robinhoodChain.id}`;

  async function deposit() {
    if (!wallet) return;
    try {
      await fundWallet({ address: wallet.address });
    } catch {
      toastUnavailable();
    }
  }

  return (
    <div className="flex items-center gap-3">
      {wrongChain ? (
        <Button variant="secondary" size="sm" onClick={() => switchToRobinhood(wallet!).catch(() => {})}>
          Switch network
        </Button>
      ) : (
        <div className="hidden flex-col items-end leading-tight sm:flex" title={eth != null ? `${eth.toFixed(6)} ETH` : undefined}>
          <Balance className="text-sm font-semibold tnum">
            {usd != null
              ? usdExact(usd)
              : eth != null
                ? `${eth.toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`
                : "—"}
          </Balance>
          <button onClick={deposit} className="text-xs font-medium text-primary hover:underline">
            Deposit
          </button>
        </div>
      )}
      <AccountMenu />
    </div>
  );
}

function toastUnavailable() {
  import("sonner").then(({ toast }) => toast("Deposits aren't available on this network yet."));
}

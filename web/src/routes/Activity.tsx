import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Coins,
  ExternalLink,
  Flame,
  Gift,
  Rocket,
  SendHorizontal,
  TrendingDown,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useActiveWallet } from "@/components/Wallet";
import { api } from "@/lib/api";
import type { LedgerRow } from "@/lib/api";
import { onLive, debounced } from "@/lib/live";
import { navigateTo } from "@/lib/nav";
import { explorerTx, explorerAddress } from "@/lib/chain";
import { usd, amount as fmtAmount } from "@/lib/money";
import { Balance } from "@/lib/blurBalances";
import { cn } from "@/lib/utils";

const KIND: Record<LedgerRow["type"], { icon: LucideIcon; label: string; tone: string }> = {
  buy: { icon: TrendingUp, label: "Bought", tone: "text-primary" },
  sell: { icon: TrendingDown, label: "Sold", tone: "text-destructive" },
  launch: { icon: Rocket, label: "Launched", tone: "text-highlight" },
  referral: { icon: Gift, label: "Referral payout", tone: "text-primary" },
  send: { icon: SendHorizontal, label: "Sent", tone: "text-foreground" },
  withdraw: { icon: ArrowUpRight, label: "Withdrew", tone: "text-foreground" },
  receive: { icon: ArrowDownLeft, label: "Received", tone: "text-primary" },
  burn: { icon: Flame, label: "Burned", tone: "text-destructive" },
  collect: { icon: Coins, label: "Collected fees", tone: "text-primary" },
  claim: { icon: BadgeCheck, label: "Claimed", tone: "text-primary" },
  boost: { icon: Zap, label: "Boosted", tone: "text-highlight" },
};

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * The connected wallet's platform ledger: everything done ON finchpad — trades, launches,
 * referral payouts, sends/withdrawals — newest first. Deliberately scoped to platform
 * activity; the full on-chain history lives on the block explorer, linked below.
 */
export default function Activity() {
  const wallet = useActiveWallet();
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (address: string) =>
    api
      .ledger(address)
      .then((r) => {
        setRows(r.activity);
        setEthUsd(r.ethUsd);
        setErr(null);
      })
      .catch((e) => setErr((e as Error).message));

  useEffect(() => {
    if (!wallet) return;
    setRows(null);
    void load(wallet.address);
  }, [wallet?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  // My own trades appear moments after they're indexed.
  useEffect(() => {
    if (!wallet) return;
    const refresh = debounced(() => void load(wallet.address), 1500);
    const off = onLive("swap", (s) => {
      if (s.trader && s.trader.toLowerCase() === wallet.address.toLowerCase()) refresh.call();
    });
    return () => {
      refresh.cancel();
      off();
    };
  }, [wallet?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!wallet)
    return (
      <Card className="mx-auto max-w-xl p-8 text-center text-sm text-muted-foreground">
        Connect to see your activity.
      </Card>
    );

  return (
    <div className="rise mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Everything you've done on finchpad. For the full on-chain history,{" "}
          <a
            href={explorerAddress(wallet.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            open your address on Blockscout
          </a>
          .
        </p>
      </div>

      {err && <Card className="border-destructive/40 p-4 text-sm text-destructive">{err}</Card>}
      {!rows && !err && <div className="py-16 text-center text-sm text-muted-foreground">loading…</div>}

      {rows && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nothing yet — your trades, launches, sends and referral payouts will land here.
        </Card>
      )}

      {rows && rows.length > 0 && (
        <Card className="gap-0 overflow-hidden p-0">
          <ul>
            {rows.map((r, i) => {
              const k = KIND[r.type];
              const Icon = k.icon;
              return (
                <li
                  key={`${r.txHash}-${r.type}-${i}`}
                  className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                >
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full bg-muted", k.tone)}>
                    <Icon className="size-4" aria-hidden />
                  </span>

                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="text-sm font-medium">
                      {k.label}
                      {r.symbol && (
                        <button
                          className="ml-1 text-primary hover:underline"
                          onClick={() => r.token && navigateTo(`/tokens/robinhood/${r.token}`)}
                        >
                          ${r.symbol}
                        </button>
                      )}
                      {(r.type === "send" || r.type === "receive") && r.counterpartyUsername && (
                        <button
                          className="ml-1 text-primary hover:underline"
                          onClick={() => navigateTo(`/profile/${r.counterpartyUsername}`)}
                        >
                          {r.type === "send" ? "to" : "from"} @{r.counterpartyUsername}
                        </button>
                      )}
                      {(r.type === "withdraw" || ((r.type === "send" || r.type === "receive") && !r.counterpartyUsername)) &&
                        r.counterparty && (
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            {r.type === "receive" ? "from" : "to"} {r.counterparty.slice(0, 6)}…{r.counterparty.slice(-4)}
                          </span>
                        )}
                    </p>
                    <p className="text-xs text-muted-foreground">{ago(r.ts)}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right leading-tight">
                      {r.amountEth !== undefined && (
                        <Balance className="tnum block text-sm font-medium">
                          {ethUsd ? usd(r.amountEth * ethUsd) : `${r.amountEth.toFixed(4)} Ξ`}
                        </Balance>
                      )}
                      {r.tokenAmount !== undefined && (
                        <span className="tnum text-xs text-muted-foreground">
                          {fmtAmount(r.tokenAmount)} {r.symbol}
                        </span>
                      )}
                    </div>
                    <a
                      href={explorerTx(r.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View transaction"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

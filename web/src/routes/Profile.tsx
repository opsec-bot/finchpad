import { useEffect, useState } from "react";
import { CalendarDays, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProfileSetup } from "@/components/ProfileSetup";
import { useActiveWallet } from "@/components/Wallet";
import { api } from "@/lib/api";
import type { Profile as ProfileData, Position } from "@/lib/api";
import { onLive, debounced } from "@/lib/live";
import { navigateTo } from "@/lib/nav";
import { usd, usdExact, amount as fmtAmount } from "@/lib/money";
import { shortenAddress } from "@/lib/format";
import { Balance } from "@/lib/blurBalances";
import { cn } from "@/lib/utils";

type Full = ProfileData & { positions: Position[]; ethBalance: number; ethUsd: number | null };

/**
 * Public profile: identity (avatar, name, @username, bio) plus the wallet's traded positions
 * from the indexer. Positions are what this wallet bought/sold through finchpad pools —
 * transfers outside the pools aren't visible, and it says so.
 */
export default function Profile({ username }: { username: string }) {
  const wallet = useActiveWallet();
  const [data, setData] = useState<Full | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = () =>
    api
      .profile(username)
      .then((p) => (setData(p), setErr(null)))
      .catch((e) => setErr((e as Error).message));

  useEffect(() => {
    setData(null);
    setErr(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // Live PnL: refetch when this wallet trades, or when ANY trade moves the price of a token
  // it holds (position values are priced at last trade, so every tick can change the PnL).
  useEffect(() => {
    const refresh = debounced(() => void load(), 1500);
    const off = onLive("swap", (s) => {
      if (!data) return;
      const mine = s.trader && s.trader.toLowerCase() === data.address;
      const held = data.positions.some((p) => p.token === s.token.toLowerCase() && p.netTokens > 0);
      if (mine || held) refresh.call();
    });
    return () => {
      refresh.cancel();
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.address, data?.positions?.length]);

  if (err)
    return (
      <Card className="mx-auto max-w-xl p-8 text-center">
        <p className="text-base font-semibold">@{username} doesn't exist</p>
        <p className="mt-1 text-sm text-muted-foreground">No one has claimed this username yet.</p>
      </Card>
    );
  if (!data) return <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">loading…</div>;

  const eth = data.ethUsd;
  const isOwn = wallet && wallet.address.toLowerCase() === data.address;
  // Portfolio value = the whole account: ETH balance + every token position at last trade.
  const totalValue = data.ethBalance + data.positions.reduce((s, p) => s + p.valueWeth, 0);
  const totalPnl = data.positions.reduce((s, p) => s + p.pnlWeth, 0);
  const inUsd = (w: number) => (eth ? usdExact(w * eth) : `${w.toFixed(4)} Ξ`);

  return (
    <div className="rise mx-auto flex max-w-4xl flex-col gap-5">
      {/* Identity */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="size-16 rounded-2xl ring-1 ring-border">
            {data.avatar && <AvatarImage src={data.avatar} alt="" className="object-cover" />}
            <AvatarFallback className="rounded-2xl bg-secondary text-lg font-semibold">
              {(data.name || data.username).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-xl font-semibold leading-tight">{data.name || `@${data.username}`}</h1>
            <span className="font-mono text-sm text-muted-foreground">@{data.username}</span>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
              <button
                className="flex items-center gap-1 font-mono transition-colors hover:text-foreground"
                onClick={() => {
                  navigator.clipboard?.writeText(data.address);
                  toast("Address copied");
                }}
              >
                {shortenAddress(data.address, 4)}
                <Copy className="size-3" aria-hidden />
              </button>
              <span className="flex items-center gap-1">
                <CalendarDays className="size-3" aria-hidden />
                joined {new Date(data.joinedTs * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
            </div>
          </div>
        </div>
        {isOwn && (
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" aria-hidden />
            Edit profile
          </Button>
        )}
      </div>

      {data.bio && <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">{data.bio}</p>}

      {/* Portfolio summary */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
        <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Portfolio value</span>
          <Balance className="tnum text-lg font-semibold">{inUsd(totalValue)}</Balance>
        </div>
        <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Total PnL</span>
          <Balance className={cn("tnum text-lg font-semibold", totalPnl >= 0 ? "text-primary" : "text-destructive")}>
            {totalPnl >= 0 ? "+" : ""}
            {inUsd(totalPnl)}
          </Balance>
        </div>
      </div>

      {/* Positions */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Positions</div>
        {data.positions.length === 0 && data.ethBalance <= 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No holdings yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Token</th>
                  <th className="px-4 py-2 text-right font-medium">Holding</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                  <th className="px-4 py-2 text-right font-medium">Invested</th>
                  <th className="px-4 py-2 text-right font-medium">PnL</th>
                </tr>
              </thead>
              <tbody>
                {data.ethBalance > 0 && (
                  <tr className="border-t border-border/60">
                    <td className="px-4 py-2.5 font-medium">ETH</td>
                    <td className="tnum px-4 py-2.5 text-right">
                      <Balance>{data.ethBalance.toLocaleString("en-US", { maximumFractionDigits: 4 })}</Balance>
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">
                      <Balance>{eth ? usd(data.ethBalance * eth) : `${data.ethBalance.toFixed(4)} Ξ`}</Balance>
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-muted-foreground">—</td>
                    <td className="tnum px-4 py-2.5 text-right text-muted-foreground">—</td>
                  </tr>
                )}
                {data.positions.map((p) => (
                  <tr
                    key={p.token}
                    className="cursor-pointer border-t border-border/60 transition-colors hover:bg-muted/40"
                    onClick={() => navigateTo(`/tokens/robinhood/${p.token}`)}
                  >
                    <td className="px-4 py-2.5 font-medium">${p.symbol}</td>
                    <td className="tnum px-4 py-2.5 text-right">{fmtAmount(p.netTokens)}</td>
                    <td className="tnum px-4 py-2.5 text-right">
                      <Balance>{eth ? usd(p.valueWeth * eth) : `${p.valueWeth.toFixed(4)} Ξ`}</Balance>
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-muted-foreground">
                      <Balance>{eth ? usd(p.investedWeth * eth) : `${p.investedWeth.toFixed(4)} Ξ`}</Balance>
                    </td>
                    <td
                      className={cn(
                        "tnum px-4 py-2.5 text-right font-medium",
                        p.pnlWeth >= 0 ? "text-primary" : "text-destructive",
                      )}
                    >
                      <Balance>
                        {p.pnlWeth >= 0 ? "+" : ""}
                        {eth ? usd(p.pnlWeth * eth) : `${p.pnlWeth.toFixed(4)} Ξ`}
                      </Balance>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          Holdings are live on-chain balances (ETH + every finchpad token), valued at each token's last trade. PnL
          compares against what was bought/sold through finchpad pools.
        </p>
      </Card>

      <ProfileSetup
        open={editOpen}
        onClose={() => setEditOpen(false)}
        existing={data}
        onSaved={({ username: u }) => (u === username ? void load() : navigateTo(`/profile/${u}`))}
      />
    </div>
  );
}

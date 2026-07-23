import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { ProtocolStatsResponse } from "@/lib/api";
import { onLive, debounced } from "@/lib/live";
import { usd } from "@/lib/money";

/**
 * Protocol-wide analytics: every number is summed from finchpad's own on-chain indexer —
 * launches and swaps tailed into SQLite by the daemon — with market cap and locked liquidity
 * read live from the pools. No third-party data source.
 */
export default function Analytics() {
  const [stats, setStats] = useState<ProtocolStatsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .stats()
        .then((s) => alive && (setStats(s), setErr(null)))
        .catch((e) => alive && setErr((e as Error).message));
    void load();
    const t = setInterval(load, 30_000);
    // Live swaps nudge the numbers between the 30s ticks (debounced).
    const refresh = debounced(() => void load(), 2000);
    const off = onLive("swap", () => refresh.call());
    return () => {
      alive = false;
      clearInterval(t);
      refresh.cancel();
      off();
    };
  }, []);

  const eth = stats?.ethUsd ?? null;
  const inUsd = (weth: number) => (eth ? usd(weth * eth) : `${weth.toFixed(2)} Ξ`);
  const n = (x: number) => x.toLocaleString("en-US");

  const tiles = stats
    ? [
        { label: "Volume · all-time", value: inUsd(stats.allTime.volumeWeth), sub: "cumulative since launch" },
        {
          label: "Tokens launched",
          value: n(stats.tokensLaunched),
          sub: `${n(stats.last24h.tokensTraded)} traded in the last 24h`,
        },
        { label: "Volume · 24h", value: inUsd(stats.last24h.volumeWeth), sub: "across every finchpad token" },
        { label: "Trades · all-time", value: n(stats.allTime.trades), sub: "total swaps across all pools" },
        { label: "Traders · 24h", value: n(stats.last24h.traders), sub: "buyers + sellers, all pools" },
        { label: "Market cap", value: inUsd(stats.combined.marketCapWeth), sub: "combined, all finchpad tokens" },
        {
          label: "Liquidity locked",
          value: inUsd(stats.combined.liquidityWeth),
          sub: "single-sided on Uniswap V3, forever",
        },
        {
          label: "Value burned",
          value: inUsd(stats.combined.burnedValueWeth),
          sub: "supply destroyed across all finchpad tokens",
        },
      ]
    : [];

  return (
    <div className="rise">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Analytics</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
          Live across every token launched on finchpad. Volume and trades are summed from each pool's
          on-chain swap history; market cap and locked liquidity are read straight off the pools.
        </p>
      </div>

      {err && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">
          {err.includes("indexer")
            ? import.meta.env.DEV
              ? "The indexer isn't running yet — start it with npm run dev."
              : "Analytics are warming up — check back in a moment."
            : err}
        </Card>
      )}

      {!stats && !err && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Card key={i} className="h-28 animate-pulse" />
          ))}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <Card key={t.label} className="flex flex-col gap-1 p-5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{t.label}</span>
              <span className="tnum text-3xl font-semibold leading-tight">{t.value}</span>
              <span className="text-xs text-muted-foreground">{t.sub}</span>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        All-time figures are summed from the on-chain swap history indexed by finchpad and refresh
        continuously; market cap and liquidity are live reads cached for two minutes.
      </p>
    </div>
  );
}

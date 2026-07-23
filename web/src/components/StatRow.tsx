import { Flame } from "lucide-react";
import type { TokenDetail } from "@/lib/api";
import { useEthUsd, usd, amount } from "@/lib/money";

/** The headline numbers under the token header: market cap, liquidity, 24h volume, ATH, supply
 *  (with burned beneath), graduation. Liquidity is the WETH locked in the pool — permanently
 *  locked for finch launches, so it reads as a floor, not something the creator can pull. */
export default function StatRow({
  token,
  volumeWeth,
  athMarketCapWeth,
}: {
  token: TokenDetail;
  volumeWeth: number;
  /** Highest market cap in the indexed candle window; null when there is no price history. */
  athMarketCapWeth: number | null;
}) {
  const ethUsd = useEthUsd();
  const inUsd = (weth: number) => (ethUsd ? usd(weth * ethUsd) : `${weth.toFixed(3)} Ξ`);

  const burned = token.burnedTokens;
  const burnedPct = burned && token.totalSupply + burned > 0 ? (burned / (token.totalSupply + burned)) * 100 : 0;
  // Burned tokens are valued at the current price — same basis as market cap.
  const burnedUsdVal = burned && ethUsd ? burned * token.priceWeth * ethUsd : null;

  const stats: { label: string; value: string; sub?: React.ReactNode }[] = [
    { label: "Market cap", value: inUsd(token.marketCapWeth) },
    { label: "Liquidity", value: Number.isFinite(token.liquidityWeth) ? inUsd(token.liquidityWeth) : "—" },
    { label: "24h volume", value: inUsd(volumeWeth) },
    { label: "ATH", value: athMarketCapWeth !== null ? inUsd(athMarketCapWeth) : "—" },
    {
      label: "Supply",
      value: amount(token.totalSupply),
      sub:
        burned && burned > 0 ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground tnum">
            <Flame className="size-3 text-destructive" aria-hidden />
            {amount(burned)} burned{burnedUsdVal !== null ? ` · ${usd(burnedUsdVal)}` : ""} · {burnedPct.toFixed(2)}%
          </span>
        ) : undefined,
    },
    { label: "Graduation", value: token.graduation ? `${Math.min(100, Math.round(token.graduation.progress * 100))}%` : "—" },
  ];
  // gap-px over a border-coloured background draws clean 1px separators between every cell,
  // however the 2-col mobile / 3-col / 6-col grid wraps — no per-cell border bookkeeping.
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col gap-0.5 bg-card px-4 py-3">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{stat.label}</span>
          <span className="tnum text-base font-semibold">{stat.value}</span>
          {stat.sub}
        </div>
      ))}
    </div>
  );
}

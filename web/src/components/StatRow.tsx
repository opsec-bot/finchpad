import type { TokenDetail } from "@/lib/api";
import { useEthUsd, usd, amount } from "@/lib/money";

/** The headline numbers under the token header: market cap, liquidity, 24h volume, supply,
 *  graduation. Liquidity is the WETH locked in the pool — permanently locked for finch launches,
 *  so it reads as a floor, not something the creator can pull. */
export default function StatRow({ token, volumeWeth }: { token: TokenDetail; volumeWeth: number }) {
  const ethUsd = useEthUsd();
  const stats = [
    { label: "Market cap", value: ethUsd ? usd(token.marketCapWeth * ethUsd) : `${token.marketCapWeth.toFixed(3)} Ξ` },
    {
      label: "Liquidity",
      value: Number.isFinite(token.liquidityWeth)
        ? ethUsd
          ? usd(token.liquidityWeth * ethUsd)
          : `${token.liquidityWeth.toFixed(3)} Ξ`
        : "—",
    },
    { label: "24h volume", value: ethUsd ? usd(volumeWeth * ethUsd) : `${volumeWeth.toFixed(3)} Ξ` },
    { label: "Supply", value: amount(token.totalSupply) },
    { label: "Graduation", value: token.graduation ? `${Math.min(100, Math.round(token.graduation.progress * 100))}%` : "—" },
  ];
  // gap-px over a border-coloured background draws clean 1px separators between every cell,
  // however the 2-col mobile / 5-col desktop grid wraps — no per-cell border bookkeeping.
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col gap-0.5 bg-card px-4 py-3">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{stat.label}</span>
          <span className="tnum text-base font-semibold">{stat.value}</span>
        </div>
      ))}
    </div>
  );
}

import type { TokenDetail } from "@/lib/api";
import { useEthUsd, usd, amount } from "@/lib/money";

/** The four headline numbers under the token header: market cap, 24h volume, supply, graduation. */
export default function StatRow({ token, volumeWeth }: { token: TokenDetail; volumeWeth: number }) {
  const ethUsd = useEthUsd();
  const stats = [
    { label: "Market cap", value: ethUsd ? usd(token.marketCapWeth * ethUsd) : `${token.marketCapWeth.toFixed(3)} Ξ` },
    { label: "24h volume", value: ethUsd ? usd(volumeWeth * ethUsd) : `${volumeWeth.toFixed(3)} Ξ` },
    { label: "Supply", value: amount(token.totalSupply) },
    { label: "Graduation", value: token.graduation ? `${Math.min(100, Math.round(token.graduation.progress * 100))}%` : "—" },
  ];
  return (
    <div className="grid grid-cols-2 divide-border rounded-lg border border-border bg-card sm:grid-cols-4 sm:divide-x">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={`flex flex-col gap-0.5 px-4 py-3 ${i < 2 ? "border-b border-border sm:border-b-0" : ""}`}
        >
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{stat.label}</span>
          <span className="tnum text-base font-semibold">{stat.value}</span>
        </div>
      ))}
    </div>
  );
}

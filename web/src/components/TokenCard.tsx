import { BadgeCheck, GraduationCap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import TokenAvatar from "@/components/TokenAvatar";
import ChangeValue from "@/components/ChangeValue";
import Sparkline from "@/components/Sparkline";
import { useEthUsd, usd } from "@/lib/money";
import type { TokenView } from "@/lib/tokenView";

/** A single token in the explore feed: avatar, market cap, 24h change, sparkline, graduation. */
export default function TokenCard({ token, onSelect }: { token: TokenView; onSelect: (address: string) => void }) {
  const ethUsd = useEthUsd();
  const positive = token.change24h >= 0;
  const pct = Math.min(100, Math.round(token.graduationProgress * 100));

  return (
    <button type="button" onClick={() => onSelect(token.address)} className="group block w-full text-left">
      <Card className="lift gap-0 overflow-hidden p-0 group-hover:border-primary/40">
        <div className="flex items-start gap-3 p-4">
          <TokenAvatar src={token.logo} symbol={token.symbol} size="lg" className="size-12 rounded-lg" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold leading-tight">{token.name}</h3>
              {token.githubVerified && (
                <BadgeCheck className="size-4 shrink-0 text-primary" aria-label="GitHub verified" />
              )}
            </div>
            <p className="tnum font-mono text-xs text-muted-foreground">${token.symbol}</p>
          </div>

          {token.graduated && (
            <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
              <GraduationCap className="size-3" aria-hidden />
              Graduated
            </Badge>
          )}
        </div>

        <div className="flex items-end justify-between gap-3 px-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Market cap</p>
            <p className="tnum text-2xl font-semibold leading-tight">
              {ethUsd ? usd(token.marketCapWeth * ethUsd) : `${token.marketCapWeth.toFixed(3)} Ξ`}
            </p>
            <div className="mt-0.5 flex items-center gap-2 text-sm">
              <ChangeValue value={token.change24h} showIcon />
              <span className="tnum text-xs text-muted-foreground">
                Liq{" "}
                {Number.isFinite(token.liquidityWeth)
                  ? ethUsd
                    ? usd(token.liquidityWeth * ethUsd)
                    : `${token.liquidityWeth.toFixed(3)} Ξ`
                  : "—"}
              </span>
            </div>
          </div>
          <Sparkline data={token.sparkline} positive={positive} className="mb-1 shrink-0" />
        </div>

        <div className="mt-4 px-4 pb-4">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              {token.graduated ? "Graduated to open market" : "Graduation"}
            </span>
            <span className="tnum font-medium text-foreground">{pct}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Card>
    </button>
  );
}

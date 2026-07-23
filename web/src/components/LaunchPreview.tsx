import { Card } from "@/components/ui/card";
import TokenAvatar from "@/components/TokenAvatar";
import Sparkline from "@/components/Sparkline";
import ChangeValue from "@/components/ChangeValue";
import { useEthUsd, usd } from "@/lib/money";

// A static, plausible starting-valuation sparkline for the preview.
const PREVIEW_SPARK = [1, 1.02, 1.01, 1.04, 1.03, 1.06, 1.05, 1.08, 1.07, 1.1, 1.12, 1.11];

/** Live preview of how the token will read in the explore feed as the launch form is filled in. */
export default function LaunchPreview({
  name,
  ticker,
  image,
  startMcapEth,
}: {
  name: string;
  ticker: string;
  image: string | null;
  startMcapEth: number;
}) {
  const ethUsd = useEthUsd();
  const displayName = name.trim() || "Your token";
  const displayTicker = ticker.trim() || "TICKER";
  const mcap = ethUsd ? usd(startMcapEth * ethUsd) : `${startMcapEth} Ξ`;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 p-4">
        <TokenAvatar src={image} symbol={displayTicker} size="lg" className="size-12 rounded-lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-tight">{displayName}</h3>
          <p className="tnum font-mono text-xs text-muted-foreground">${displayTicker}</p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 px-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Opening market cap</p>
          <p className="tnum text-2xl font-semibold leading-tight">{mcap}</p>
          <ChangeValue value={0} showIcon className="mt-0.5 text-sm" />
        </div>
        <Sparkline data={PREVIEW_SPARK} positive className="mb-1 shrink-0" />
      </div>
      <div className="mt-4 px-4 pb-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Graduation</span>
          <span className="tnum font-medium text-foreground">0%</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-0 rounded-full bg-primary" />
        </div>
      </div>
    </Card>
  );
}

import { useMemo, useState } from "react";
import Chart from "@/components/Chart";
import type { Candle } from "@/components/Chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { candlesInWindow } from "@/lib/tokenView";

const RANGES: { value: string; seconds: number }[] = [
  { value: "1H", seconds: 3_600 },
  { value: "4H", seconds: 14_400 },
  { value: "1D", seconds: 86_400 },
  { value: "ALL", seconds: Infinity },
];

/**
 * The price panel: a header with a range selector over the real candlestick chart. The axis is
 * ETH-per-token — the actual on-chain price the pool quotes — so it stays consistent with the
 * chart's precision tuning; USD is shown in the header and stat row instead.
 */
export default function PriceChart({ candles }: { candles: Candle[] }) {
  const [range, setRange] = useState("ALL");

  const shown = useMemo(() => {
    const secs = RANGES.find((r) => r.value === range)?.seconds ?? Infinity;
    if (!Number.isFinite(secs)) return candles;
    const windowed = candlesInWindow(candles, secs);
    // A too-short window with nothing to draw falls back to the full series.
    return windowed.length >= 2 ? windowed : candles;
  }, [candles, range]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Price · ETH</span>
        <Tabs value={range} onValueChange={setRange}>
          <TabsList className="h-7">
            {RANGES.map((r) => (
              <TabsTrigger key={r.value} value={r.value} className="px-2 text-xs">
                {r.value}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="relative min-h-[300px] flex-1 p-2">
        <Chart candles={shown} height={320} />
      </div>
    </div>
  );
}

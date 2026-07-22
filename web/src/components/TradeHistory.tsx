import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEthUsd, usd, amount } from "@/lib/money";
import { formatEth, timeAgo } from "@/lib/format";

interface Trade {
  side: "buy" | "sell";
  tokenAmount: number;
  wethAmount: number;
  timestamp: number;
}

/** Recent swaps against the pool, newest first. Age is derived from each swap's block timestamp. */
export default function TradeHistory({ symbol, trades }: { symbol: string; trades: Trade[] }) {
  const ethUsd = useEthUsd();
  const now = Date.now() / 1000;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-4 py-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">Recent trades</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-[64px_1fr_1fr_56px] gap-2 border-b border-border px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>Side</span>
          <span className="text-right">{symbol}</span>
          <span className="text-right">Value</span>
          <span className="text-right">Age</span>
        </div>
        {trades.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">No trades yet</div>}
        <div className="max-h-[320px] overflow-y-auto">
          {trades.map((trade, i) => {
            const buy = trade.side === "buy";
            return (
              <div
                key={`${trade.timestamp}-${i}`}
                className="grid grid-cols-[64px_1fr_1fr_56px] items-center gap-2 px-4 py-2 text-xs transition-colors hover:bg-muted/40"
              >
                <span className={buy ? "font-medium text-up" : "font-medium text-down"}>{buy ? "Buy" : "Sell"}</span>
                <span className="tnum text-right text-foreground">{amount(trade.tokenAmount)}</span>
                <div className="flex flex-col text-right">
                  <span className="tnum text-foreground">{formatEth(trade.wethAmount, 4)}</span>
                  {ethUsd && (
                    <span className="tnum text-[10px] text-muted-foreground">{usd(trade.wethAmount * ethUsd)}</span>
                  )}
                </div>
                <span className="tnum text-right text-muted-foreground">
                  {trade.timestamp ? timeAgo(now - trade.timestamp) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

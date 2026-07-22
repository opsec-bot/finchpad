import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";
import type { TokenDetail } from "@/lib/api";
import type { Candle } from "@/components/Chart";
import { Card } from "@/components/ui/card";
import TokenHeader from "@/components/TokenHeader";
import StatRow from "@/components/StatRow";
import PriceChart from "@/components/PriceChart";
import TradeHistory from "@/components/TradeHistory";
import TradePanel from "@/components/TradePanel";
import GraduationCard from "@/components/GraduationCard";
import TrustPanel from "@/components/TrustPanel";
import { change24h as change24hOf } from "@/lib/tokenView";

interface Trade {
  side: "buy" | "sell";
  tokenAmount: number;
  wethAmount: number;
  timestamp: number;
}

export default function Token({ address, onBack }: { address: string; onBack: () => void }) {
  const [t, setT] = useState<TokenDetail | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api.token(address);
      setT(detail);
      const [c, tr] = await Promise.all([
        api.candles(address).catch(() => null),
        api.trades(address).catch(() => null),
      ]);
      if (c) setCandles(c.candles);
      if (tr) setTrades(tr.trades);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [address]);

  useEffect(() => {
    setT(null);
    setErr(null);
    setCandles([]);
    setTrades([]);
    void load();
  }, [load]);

  if (err) return <Card className="border-destructive/40 p-4 text-sm text-destructive">{err}</Card>;
  if (!t)
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">loading…</div>
    );

  // 24h volume from the indexed window, in ETH; change from the candle series.
  const volumeWeth = trades.reduce((sum, x) => sum + x.wethAmount, 0);
  const change = change24hOf(candles);

  return (
    <div className="flex flex-col gap-4 rise">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Explore
      </button>

      <TokenHeader token={t} change24h={change} />
      <StatRow token={t} volumeWeth={volumeWeth} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: chart + trades */}
        <div className="order-last flex flex-col gap-4 lg:order-none">
          <Card className="h-[380px] gap-0 overflow-hidden p-0">
            <PriceChart candles={candles} />
          </Card>
          <TradeHistory symbol={t.symbol} trades={trades} />
        </div>

        {/* Right: trade panel + graduation + trust */}
        <div className="flex flex-col gap-4">
          <TradePanel
            token={t.address as Address}
            pool={t.pool as Address}
            symbol={t.symbol}
            tokenIsToken0={t.tokenIsToken0}
            onTraded={load}
          />
          {t.graduation && <GraduationCard graduation={t.graduation} />}
          <TrustPanel token={t} />
        </div>
      </div>
    </div>
  );
}

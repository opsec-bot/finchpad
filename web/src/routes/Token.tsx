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
import TokenActions from "@/components/TokenActions";
import { change24h as change24hOf } from "@/lib/tokenView";
import { onLive, debounced } from "@/lib/live";

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

  // Live ticks: apply each swap to the screen IMMEDIATELY — price, market cap, chart candle
  // and the trades list all move the moment the event lands — then run a debounced
  // authoritative reload behind it to reconcile with indexed truth.
  useEffect(() => {
    const refresh = debounced(() => void load(), 1200);
    const off = onLive("swap", (s) => {
      if (s.token.toLowerCase() !== address.toLowerCase()) return;

      // Header price + market cap tick in place.
      setT((prev) =>
        prev ? { ...prev, priceWeth: s.priceWeth, marketCapWeth: s.priceWeth * prev.totalSupply } : prev,
      );

      // Merge into the candle series (300s buckets — matches the API's default interval).
      setCandles((prev) => {
        const bucket = Math.floor(s.timestamp / 300) * 300;
        const last = prev[prev.length - 1];
        if (last && last.t === bucket) {
          const updated = {
            ...last,
            h: Math.max(last.h, s.priceWeth),
            l: Math.min(last.l, s.priceWeth),
            c: s.priceWeth,
          };
          return [...prev.slice(0, -1), updated];
        }
        const open = last?.c ?? s.priceWeth;
        return [
          ...prev,
          { t: bucket, o: open, h: Math.max(open, s.priceWeth), l: Math.min(open, s.priceWeth), c: s.priceWeth },
        ];
      });

      // Prepend to recent trades.
      setTrades((prev) => [
        { side: s.side, tokenAmount: s.tokenAmount, wethAmount: s.wethAmount, timestamp: s.timestamp },
        ...prev,
      ]);

      refresh.call();
    });
    return () => {
      refresh.cancel();
      off();
    };
  }, [address, load]);

  if (err) return <Card className="border-destructive/40 p-4 text-sm text-destructive">{err}</Card>;
  if (!t)
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">loading…</div>
    );

  // 24h volume from the indexed window, in ETH; change from the candle series.
  const volumeWeth = trades.reduce((sum, x) => sum + x.wethAmount, 0);
  const change = change24hOf(candles);
  // ATH market cap from the highest candle in the indexed window (price × fixed supply).
  const athPrice = candles.length ? Math.max(...candles.map((c) => c.h)) : null;
  const athMarketCapWeth = athPrice !== null ? athPrice * t.totalSupply : null;

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
      {t.description && (
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">{t.description}</p>
      )}
      <StatRow token={t} volumeWeth={volumeWeth} athMarketCapWeth={athMarketCapWeth} />

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
          <TokenActions token={t} onChanged={load} />
          <TrustPanel token={t} />
        </div>
      </div>
    </div>
  );
}

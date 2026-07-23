import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, ColorType } from "lightweight-charts";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

export interface Candle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * TradingView lightweight-charts. Prices are ETH-per-token and land around 1e-9, well below
 * the default formatter's resolution, so precision and minMove are set explicitly — otherwise
 * every candle renders as 0.0000.
 */
export default function Chart({ candles, height = 320 }: { candles: Candle[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8FA3A6",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: "#222C30" }, horzLines: { color: "#222C30" } },
      rightPriceScale: { borderColor: "#2A363A" },
      timeScale: { borderColor: "#2A363A", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#7CB4B4",
      downColor: "#E5484D",
      borderVisible: false,
      wickUpColor: "#93D0D1",
      wickDownColor: "#E5484D",
      priceFormat: { type: "price", precision: 12, minMove: 1e-12 },
    });

    const data = candles
      .map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c }))
      .sort((a, b) => a.time - b.time);
    series.setData(data);
    chart.timeScale().fitContent();

    const onResize = () => chart.applyOptions({ width: ref.current?.clientWidth ?? 0 });
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, height]);

  if (!candles.length) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No trades yet
      </div>
    );
  }
  // role=img + label so assistive tech announces a (skippable) chart — the numeric data it
  // visualises is already available as text in the stat row and header.
  return <div ref={ref} className="w-full" role="img" aria-label="Price candlestick chart" />;
}

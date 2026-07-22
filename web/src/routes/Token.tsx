import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { api } from "../lib/api";
import type { TokenDetail } from "../lib/api";
import Chart from "../components/Chart";
import type { Candle } from "../components/Chart";
import TradePanel from "../components/TradePanel";
import Transparency from "../components/Transparency";
import { explorerAddress } from "../lib/chain";
import { useEthUsd, usd, amount } from "../lib/money";

const fmt = (n: number, d = 4) => n.toLocaleString(undefined, { maximumFractionDigits: d });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

interface Trade {
  side: "buy" | "sell";
  tokenAmount: number;
  wethAmount: number;
}

export default function Token({ address, onBack }: { address: string; onBack: () => void }) {
  const [t, setT] = useState<TokenDetail | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const ethUsd = useEthUsd();

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
    void load();
  }, [load]);

  if (err) return <div className="panel warn">{err}</div>;
  if (!t) return <div className="panel dim">loading…</div>;

  // 24h volume from the indexed window, in ETH.
  const volume = trades.reduce((sum, x) => sum + x.wethAmount, 0);
  const g = t.graduation;

  return (
    <div className="flex flex-col gap-4 rise">
      <div className="panel token-head">
        <button className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground" onClick={onBack}>
          ← all tokens
        </button>
        <div className="flex flex-wrap items-baseline gap-2 text-base">
          <strong>{t.name}</strong>
          <span className="text-muted-foreground">${t.symbol}</span>
          {t.github?.claimed && <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">github verified</span>}
          {g?.graduated && <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">graduated</span>}
        </div>
        <a className="dim mono addr" href={explorerAddress(t.address)} target="_blank" rel="noreferrer noopener">
          {short(t.address)}
        </a>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="price"
          value={ethUsd ? usd(t.priceWeth * ethUsd) : `${t.priceWeth.toExponential(3)} Ξ`}
          sub={ethUsd ? `${t.priceWeth.toExponential(3)} Ξ` : undefined}
        />
        <Stat
          label="market cap"
          value={ethUsd ? usd(t.marketCapWeth * ethUsd) : `${fmt(t.marketCapWeth, 3)} Ξ`}
          sub={ethUsd ? `${fmt(t.marketCapWeth, 3)} Ξ` : undefined}
        />
        <Stat
          label="volume"
          value={ethUsd ? usd(volume * ethUsd) : `${fmt(volume, 3)} Ξ`}
          sub={ethUsd ? `${fmt(volume, 3)} Ξ` : undefined}
        />
        <Stat label="trades" value={String(trades.length)} />
        <Stat label="supply" value={amount(t.totalSupply)} />
        <Stat label="graduation" value={g ? `${Math.min(100, Math.round(g.progress * 100))}%` : "—"} />
      </div>

      {g && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-muted-foreground">
            graduation — {fmt(g.earnedFeesEth, 4)} / {fmt(g.thresholdEth, 4)} Ξ in fees earned
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary" style={{ marginTop: 6 }}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.min(100, g.progress * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="rounded-xl border border-border bg-card p-4">
            <strong>price</strong>
            <div style={{ marginTop: 8 }}>
              <Chart candles={candles} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <strong>recent trades</strong>
            <div style={{ marginTop: 8 }}>
              {trades.length === 0 && <span className="text-muted-foreground">no trades yet</span>}
              {trades.slice(0, 25).map((x, i) => (
                <div key={i} className="flex justify-between gap-2 border-b border-border/60 py-1.5 text-sm last:border-0">
                  <span className={x.side}>{x.side}</span>
                  <span className="tabular text-muted-foreground">
                    {amount(x.tokenAmount)} {t.symbol} ·{" "}
                    {ethUsd ? usd(x.wethAmount * ethUsd) : `${fmt(x.wethAmount, 5)} Ξ`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <TradePanel
            token={t.address as Address}
            pool={t.pool as Address}
            symbol={t.symbol}
            tokenIsToken0={t.tokenIsToken0}
            onTraded={load}
          />
          <Transparency t={t} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mono stat-v">{value}</div>
      {sub && <div className="mono dim stat-sub">{sub}</div>}
    </div>
  );
}

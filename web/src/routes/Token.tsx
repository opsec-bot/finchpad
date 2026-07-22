import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { api } from "../lib/api";
import type { TokenDetail } from "../lib/api";
import Chart from "../components/Chart";
import type { Candle } from "../components/Chart";
import TradePanel from "../components/TradePanel";
import Transparency from "../components/Transparency";
import { explorerAddress } from "../lib/chain";

const fmt = (n: number, d = 4) => n.toLocaleString(undefined, { maximumFractionDigits: d });
const compact = (n: number) => (n >= 1e6 ? `${fmt(n / 1e6, 2)}M` : n >= 1e3 ? `${fmt(n / 1e3, 2)}k` : fmt(n, 2));
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
    <div className="token-page">
      <div className="panel token-head">
        <button className="back" onClick={onBack}>
          ← all launches
        </button>
        <div className="token-title">
          <strong>{t.name}</strong>
          <span className="dim">${t.symbol}</span>
          {t.github?.claimed && <span className="pill ok">github verified</span>}
          {g?.graduated && <span className="pill ok">graduated</span>}
        </div>
        <a className="dim mono addr" href={explorerAddress(t.address)} target="_blank" rel="noreferrer noopener">
          {short(t.address)}
        </a>
      </div>

      <div className="stats">
        <Stat label="price" value={`${t.priceWeth.toExponential(3)} Ξ`} />
        <Stat label="market cap" value={`${fmt(t.marketCapWeth, 3)} Ξ`} />
        <Stat label="volume" value={`${fmt(volume, 3)} Ξ`} />
        <Stat label="trades" value={String(trades.length)} />
        <Stat label="supply" value={compact(t.totalSupply)} />
        <Stat
          label="graduation"
          value={g ? `${Math.min(100, Math.round(g.progress * 100))}%` : "—"}
        />
      </div>

      {g && (
        <div className="panel">
          <div className="dim">
            graduation — {fmt(g.earnedFeesEth, 4)} / {fmt(g.thresholdEth, 4)} Ξ in fees earned
          </div>
          <div className="bar" style={{ marginTop: 6 }}>
            <i style={{ width: `${Math.min(100, g.progress * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="trade-grid">
        <div>
          <div className="panel">
            <strong>price</strong>
            <div style={{ marginTop: 8 }}>
              <Chart candles={candles} />
            </div>
          </div>

          <div className="panel">
            <strong>recent trades</strong>
            <div style={{ marginTop: 8 }}>
              {trades.length === 0 && <span className="dim">no trades yet</span>}
              {trades.slice(0, 25).map((x, i) => (
                <div key={i} className="row" style={{ cursor: "default" }}>
                  <span className={x.side}>{x.side}</span>
                  <span className="mono dim">
                    {compact(x.tokenAmount)} {t.symbol} · {fmt(x.wethAmount, 5)} Ξ
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="dim">{label}</div>
      <div className="mono stat-v">{value}</div>
    </div>
  );
}

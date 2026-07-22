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
    <div className="token-page">
      <div className="panel token-head">
        <button className="back" onClick={onBack}>
          ← all tokens
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
    <div className="stat">
      <div className="dim">{label}</div>
      <div className="mono stat-v">{value}</div>
      {sub && <div className="mono dim stat-sub">{sub}</div>}
    </div>
  );
}

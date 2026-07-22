import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TokenDetail, TokenSummary } from "../lib/api";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number, d = 4) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

export default function Explore({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (t: string) => void;
}) {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .tokens()
      .then((d) => setTokens(d.tokens))
      .catch((e: Error) => setListErr(e.message));
  }, []);

  return (
    <div className="wrap">
      <div>
        <div className="panel">
          <strong>recent tokens</strong>
          <div style={{ marginTop: 8 }}>
            {listErr && <span className="warn">{listErr}</span>}
            {!tokens && !listErr && <span className="dim">loading</span>}
            {tokens?.length === 0 && <span className="dim">no tokens in range</span>}
            {tokens?.map((l) => (
              <div key={l.txHash} className="row" onClick={() => onSelect(l.token)}>
                <span className="mono">{short(l.token)}</span>
                <span className="dim mono">blk {l.block}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div>{selected ? <TokenPanel address={selected} /> : <div className="panel dim">select a token</div>}</div>
    </div>
  );
}

function TokenPanel({ address }: { address: string }) {
  const [t, setT] = useState<TokenDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setT(null);
    setErr(null);
    api
      .token(address)
      .then(setT)
      .catch((e: Error) => setErr(e.message));
  }, [address]);

  if (err) return <div className="panel warn">{err}</div>;
  if (!t) return <div className="panel dim">loading</div>;

  const g = t.graduation;
  return (
    <div className="panel">
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>
          {t.name} <span className="dim">${t.symbol}</span>
        </strong>
        <span className="pill">{t.knownToFactory ? "known to factory" : "unknown to this factory"}</span>
      </div>

      <div className="kv mono" style={{ marginTop: 10 }}>
        <div>address</div>
        <div>{t.address}</div>
        <div>pool</div>
        <div>{t.pool}</div>
        <div>price</div>
        <div>{t.priceWeth.toExponential(4)} Ξ</div>
        <div>mcap</div>
        <div>{fmt(t.marketCapWeth, 2)} Ξ</div>
        <div>supply</div>
        <div>{fmt(t.totalSupply, 0)}</div>
      </div>

      {g && (
        <div style={{ marginTop: 12 }}>
          <div className="dim">
            graduation {fmt(g.earnedFeesEth, 4)} / {fmt(g.thresholdEth, 4)} Ξ fees earned{" "}
            {g.graduated && <span className="pill ok">graduated</span>}
          </div>
          <div className="bar" style={{ marginTop: 5 }}>
            <i style={{ width: `${Math.min(100, g.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {t.github && (
        <div style={{ marginTop: 12 }}>
          <div className="dim">
            github {t.github.kind} <span className="mono">#{t.github.githubId}</span>{" "}
            {t.github.claimed ? (
              <span className="pill ok">fees claimed</span>
            ) : (
              <span className="pill">unclaimed — fees escrowed</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

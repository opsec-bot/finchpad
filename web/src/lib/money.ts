// USD formatting. Prices here span ~1e-9 ETH per token to millions of dollars of market cap,
// so a single formatter would be useless at one end or the other.

import { useEffect, useState } from "react";
import { api } from "./api";

/** ETH/USD from the API, refreshed every minute. null when unavailable — callers show ETH. */
export function useEthUsd(): number | null {
  const [usd, setUsd] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .health()
        .then((h) => alive && setUsd(h.ethUsd ?? null))
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return usd;
}

/** $1.2M / $12.3K / $1.23 / $0.00001234 — significant digits, not a fixed decimal count. */
export function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  if (abs >= 1) return `$${value.toFixed(2)}`;
  if (abs === 0) return "$0";
  // Sub-dollar: keep four significant figures so a 1e-9 token price stays readable.
  return `$${value.toPrecision(4)}`;
}

/** Compact token counts: 44.4M, 1.2K, 12.34 */
export function amount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

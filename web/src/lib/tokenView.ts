// Derived, presentation-ready numbers computed from the API's raw candles. Keeping this in one
// place means the feed's sparkline / 24h change and the token page agree by construction rather
// than by two hand-written copies drifting apart.

import type { Candle } from "@/components/Chart";
import type { TokenDetail, TokenSummary } from "@/lib/api";

/** Everything the feed needs to render and sort a token card, computed once from the raw API. */
export interface TokenView {
  address: `0x${string}`;
  name: string;
  symbol: string;
  logo: string | null;
  marketCapWeth: number;
  change24h: number;
  sparkline: number[];
  graduated: boolean;
  graduationProgress: number;
  githubVerified: boolean;
  knownToFactory: boolean;
  block: number;
}

/** Fold a token's detail and candles into a single, sortable view-model. */
export function buildTokenView(summary: TokenSummary, detail: TokenDetail, candles: Candle[]): TokenView {
  return {
    address: detail.address,
    name: detail.name,
    symbol: detail.symbol,
    logo: detail.logo,
    marketCapWeth: detail.marketCapWeth,
    change24h: change24h(candles),
    sparkline: sparkline(candles),
    graduated: detail.graduation?.graduated ?? false,
    graduationProgress: detail.graduation?.progress ?? 0,
    githubVerified: Boolean(detail.github?.claimed),
    knownToFactory: detail.knownToFactory,
    block: summary.block,
  };
}

/**
 * 24h price change as a percentage, measured against the candle nearest 24h before the most
 * recent one (not wall-clock now — the indexed window can lag). Returns 0 when there is not
 * enough history to say anything.
 */
export function change24h(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const last = candles[candles.length - 1];
  const cutoff = last.t - 86_400;
  // First candle at or after the cutoff is our ~24h-ago baseline.
  let base = candles[0];
  for (const c of candles) {
    if (c.t >= cutoff) {
      base = c;
      break;
    }
  }
  if (!base.c) return 0;
  return ((last.c - base.c) / base.c) * 100;
}

/** The last `points` closes, for a sparkline. Fewer candles than that just yields a shorter line. */
export function sparkline(candles: Candle[], points = 40): number[] {
  return candles.slice(-points).map((c) => c.c);
}

/** Candles inside a trailing time window (seconds), measured from the latest candle. */
export function candlesInWindow(candles: Candle[], windowSec: number): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const cutoff = last.t - windowSec;
  return candles.filter((c) => c.t >= cutoff);
}

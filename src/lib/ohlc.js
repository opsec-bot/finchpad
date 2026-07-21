/**
 * Bucket normalized trades into OHLCV candles.
 * @param {Array<{timestamp:number, priceWeth:number, tokenAmount:number, wethAmount:number}>} trades
 * @param {number} intervalSeconds candle width (e.g. 60, 300, 3600)
 * @returns {Array<{t:number, o:number, h:number, l:number, c:number, vToken:number, vWeth:number, trades:number}>}
 */
export function toCandles(trades, intervalSeconds = 300) {
  const buckets = new Map();

  for (const t of trades) {
    if (!Number.isFinite(t.timestamp) || !Number.isFinite(t.priceWeth) || t.priceWeth <= 0) continue;
    const key = Math.floor(t.timestamp / intervalSeconds) * intervalSeconds;
    let c = buckets.get(key);
    if (!c) {
      c = { t: key, o: t.priceWeth, h: t.priceWeth, l: t.priceWeth, c: t.priceWeth, vToken: 0, vWeth: 0, trades: 0 };
      buckets.set(key, c);
    }
    c.h = Math.max(c.h, t.priceWeth);
    c.l = Math.min(c.l, t.priceWeth);
    c.c = t.priceWeth; // trades arrive in chronological order
    c.vToken += Math.abs(t.tokenAmount);
    c.vWeth += Math.abs(t.wethAmount);
    c.trades += 1;
  }

  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

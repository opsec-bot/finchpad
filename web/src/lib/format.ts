// Presentational formatting helpers for the redesigned UI. USD/token-count formatting lives in
// money.ts (usd / amount) and is reused everywhere; this file adds the smaller helpers the
// design leans on — signed percentages, ETH amounts, address shortening and relative time.

/** Signed percentage: +1.23% / -4.50%. */
export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** A price with enough significant digits to stay readable below a dollar. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1) return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (value >= 0.001) return "$" + value.toFixed(5);
  if (value === 0) return "$0";
  return "$" + value.toPrecision(3);
}

/** A plain ETH amount with a fixed number of digits. */
export function formatEth(value: number, digits = 4): string {
  return `${value.toFixed(digits)} ETH`;
}

/** 0x1234…abcd — `chars` hex characters on each side. */
/** Set the browser-tab title with the finchpad suffix. Routes call this once their data loads
 *  so the tab reads e.g. "$DEVC · finchpad" rather than the generic route title. */
export function setPageTitle(label: string): void {
  document.title = label ? `${label} · finchpad` : "finchpad";
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/** Compact relative age from a count of seconds: 45s / 12m / 3h / 2d. */
export function timeAgo(secondsAgo: number): string {
  if (!Number.isFinite(secondsAgo) || secondsAgo < 0) return "—";
  if (secondsAgo < 60) return `${Math.floor(secondsAgo)}s`;
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h`;
  return `${Math.floor(secondsAgo / 86400)}d`;
}

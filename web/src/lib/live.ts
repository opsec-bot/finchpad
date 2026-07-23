// Live updates over SSE. One shared EventSource for the whole app (browsers cap concurrent
// connections per origin), opened lazily on first subscriber and closed when the last one
// leaves. EventSource reconnects on its own after drops — no retry code needed here.

export interface LiveSwap {
  token: string;
  symbol: string;
  side: "buy" | "sell";
  tokenAmount: number;
  wethAmount: number;
  priceWeth: number;
  timestamp: number;
  block: number;
  txHash: string;
  /** tx.from — lets the UI react instantly when it's the viewer's own wallet. */
  trader: string | null;
}

export interface LiveLaunch {
  token: string;
  symbol: string;
  name: string;
  block: number;
}

type EventMap = { swap: LiveSwap; launch: LiveLaunch };

let source: EventSource | null = null;
const handlers: { [K in keyof EventMap]: Set<(e: EventMap[K]) => void> } = {
  swap: new Set(),
  launch: new Set(),
};

function ensureSource() {
  if (source) return;
  source = new EventSource("/events");
  for (const type of ["swap", "launch"] as const) {
    source.addEventListener(type, (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        for (const h of handlers[type]) h(data);
      } catch {
        /* malformed frame — skip */
      }
    });
  }
}

function teardownIfIdle() {
  if (source && handlers.swap.size === 0 && handlers.launch.size === 0) {
    source.close();
    source = null;
  }
}

/** Subscribe to a live event; returns the unsubscribe function. */
export function onLive<K extends keyof EventMap>(type: K, handler: (e: EventMap[K]) => void): () => void {
  handlers[type].add(handler as never);
  ensureSource();
  return () => {
    handlers[type].delete(handler as never);
    teardownIfIdle();
  };
}

/** Debounce helper for refetch-on-event patterns — trailing edge, cancellable. */
export function debounced(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  return {
    call: () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn();
      }, ms);
    },
    cancel: () => {
      if (t) clearTimeout(t);
      t = null;
    },
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rocket, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProtocolStats from "@/components/ProtocolStats";
import TokenCard from "@/components/TokenCard";
import TokenCardSkeleton from "@/components/TokenCardSkeleton";
import { api } from "@/lib/api";
import { buildTokenView } from "@/lib/tokenView";
import type { TokenView } from "@/lib/tokenView";
import { onLive, debounced } from "@/lib/live";

type Sort = "trending" | "mcap" | "new" | "oldest" | "graduating";

const SORTS: { value: Sort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "mcap", label: "Top market cap" },
  { value: "new", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "graduating", label: "Graduating" },
];

/**
 * The feed. Each token's detail and candles are folded into one view-model so the list can be
 * sorted by real numbers — 24h change, market cap, graduation — and each card shows a name,
 * sparkline and price rather than a wall of addresses.
 */
export default function Explore({ onSelect }: { onSelect: (address: string) => void }) {
  const [views, setViews] = useState<TokenView[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("trending");
  const [query, setQuery] = useState("");

  // seq guards against a slow reload overwriting a newer one (live events retrigger this).
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const { tokens } = await api.tokens();
      if (mine !== seq.current) return;
      setCount(tokens.length);
      if (tokens.length === 0) {
        setViews([]);
        return;
      }
      const results = await Promise.allSettled(
        tokens.map(async (summary) => {
          const [detail, candles] = await Promise.all([
            api.token(summary.token),
            api.candles(summary.token).catch(() => ({ candles: [] })),
          ]);
          return buildTokenView(summary, detail, candles.candles);
        }),
      );
      if (mine !== seq.current) return;
      const loaded = results
        .filter((r): r is PromiseFulfilledResult<TokenView> => r.status === "fulfilled")
        .map((r) => r.value);
      setViews(loaded);
    } catch (e) {
      if (mine === seq.current) setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      seq.current++; // invalidate in-flight loads on unmount
    };
  }, [load]);

  // New launches appear immediately; trades refresh the feed gently (debounced — the list
  // reload fans out into per-token detail fetches, so bursts must collapse to one).
  useEffect(() => {
    const refresh = debounced(() => void load(), 4000);
    const offLaunch = onLive("launch", () => void load());
    const offSwap = onLive("swap", () => refresh.call());
    return () => {
      refresh.cancel();
      offLaunch();
      offSwap();
    };
  }, [load]);

  const sorted = useMemo(() => {
    if (!views) return [];
    // Search first: name, symbol, or contract address (paste a CA to jump to a token).
    const q = query.trim().toLowerCase();
    let list = q
      ? views.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.symbol.toLowerCase().includes(q) ||
            t.address.toLowerCase().includes(q),
        )
      : [...views];
    switch (sort) {
      case "mcap":
        return list.sort((a, b) => b.marketCapWeth - a.marketCapWeth);
      case "new":
        return list.sort((a, b) => b.block - a.block);
      case "oldest":
        return list.sort((a, b) => a.block - b.block);
      case "graduating":
        return list.filter((t) => !t.graduated).sort((a, b) => b.graduationProgress - a.graduationProgress);
      case "trending":
      default:
        return list.sort((a, b) => b.change24h - a.change24h);
    }
  }, [views, sort, query]);

  const graduated = views?.filter((t) => t.graduated).length ?? 0;
  const verified = views?.filter((t) => t.githubVerified).length ?? 0;

  return (
    <div className="rise">
      {/* Hero strip */}
      <div className="mb-5 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">Discover tokens on finchpad</h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground text-pretty">
          Fixed supply, permanently locked liquidity, and verifiable fees. Every token graduates the same way.
        </p>
      </div>

      <div className="mb-5">
        <ProtocolStats tokens={count ?? 0} graduated={graduated} verified={verified} loading={!views} />
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <TabsList>
            {SORTS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Search tokens"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, symbol, or CA…"
              className="h-9 w-56 pl-8 text-sm md:w-72"
            />
          </div>
          {views && <span className="text-sm text-muted-foreground tnum">{sorted.length}</span>}
        </div>
      </div>

      {err && <Card className="border-destructive/40 p-4 text-sm text-destructive">{err}</Card>}

      {!views && !err && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <TokenCardSkeleton key={i} />
          ))}
        </div>
      )}

      {views && views.length === 0 && (
        <Card className="flex flex-col items-center justify-center gap-4 border-dashed py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Rocket className="size-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold">No tokens yet</p>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground text-pretty">
              Be the first to launch. It takes one transaction, and liquidity is locked forever.
            </p>
          </div>
        </Card>
      )}

      {views && views.length > 0 && (
        <>
          {/* Boosted rail — PAID placement, and it says so. Boosted tokens appear here AND in
              the organic feed below (placement adds, never reorders), so ranking stays honest. */}
          {!query && views.some((t) => t.boosted) && (
            <div className="mb-4">
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold">Boosted</h2>
                <span className="text-[11px] text-muted-foreground">paid placement — not an endorsement</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {views
                  .filter((t) => t.boosted)
                  .map((token) => (
                    <TokenCard key={`b-${token.address}`} token={token} onSelect={onSelect} />
                  ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((token) => (
              <TokenCard key={token.address} token={token} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

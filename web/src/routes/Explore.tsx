import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import TokenAvatar from "@/components/TokenAvatar";
import { api } from "@/lib/api";
import type { TokenDetail, TokenSummary } from "@/lib/api";
import { useEthUsd, usd, amount } from "@/lib/money";

/**
 * The feed. Each row resolves its own detail so the list can show a name, image and price
 * rather than a wall of addresses — an address is not something anyone recognises, and a
 * launchpad whose feed is unreadable has no top of funnel.
 */
export default function Explore({ onSelect }: { onSelect: (t: string) => void }) {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .tokens()
      .then((d) => setTokens(d.tokens))
      .catch((e: Error) => setErr(e.message));
  }, []);

  return (
    <div className="rise">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tokens</h1>
          <p className="text-sm text-muted-foreground">Every token launched on finchpad, newest first.</p>
        </div>
        {tokens && <span className="text-sm text-muted-foreground tabular">{tokens.length}</span>}
      </div>

      {err && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">{err}</Card>
      )}

      {!tokens && !err && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tokens?.length === 0 && (
        <Card className="p-10 text-center">
          <p className="font-medium">No tokens yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Launch the first one.</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tokens?.map((t) => (
          <TokenCard key={t.txHash} summary={t} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function TokenCard({ summary, onSelect }: { summary: TokenSummary; onSelect: (t: string) => void }) {
  const [d, setD] = useState<TokenDetail | null>(null);
  const ethUsd = useEthUsd();

  useEffect(() => {
    let alive = true;
    api
      .token(summary.token)
      .then((x) => alive && setD(x))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [summary.token]);

  return (
    <Card
      onClick={() => onSelect(summary.token)}
      className="lift cursor-pointer p-4 hover:border-primary/50 hover:bg-card/80"
    >
      <div className="flex items-center gap-3">
        <TokenAvatar src={d?.logo} symbol={d?.symbol ?? "?"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{d?.name ?? "…"}</span>
            {d?.github?.claimed && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                verified
              </Badge>
            )}
          </div>
          <div className="truncate text-sm text-muted-foreground">{d ? `$${d.symbol}` : summary.token.slice(0, 10)}</div>
        </div>
        <div className="text-right">
          <div className="tabular text-sm font-medium">
            {d ? (ethUsd ? usd(d.marketCapWeth * ethUsd) : `${d.marketCapWeth.toFixed(3)} Ξ`) : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">market cap</div>
        </div>
      </div>

      {d?.graduation && (
        <div className="mt-3">
          <div className="h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.min(100, d.graduation.progress * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{d.graduation.graduated ? "Graduated" : "Graduation"}</span>
            <span className="tabular">{amount(d.totalSupply)} supply</span>
          </div>
        </div>
      )}
    </Card>
  );
}

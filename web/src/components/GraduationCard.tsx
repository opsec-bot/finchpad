import { GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatEth } from "@/lib/format";

interface Graduation {
  earnedFeesEth: number;
  thresholdEth: number;
  graduated: boolean;
  progress: number;
  claimableFeesEth?: number | null;
}

/**
 * Graduation progress, measured in fees the token has actually earned — the same number that
 * drives the fee discount, so a donation to the pool cannot move it. Fees accrue on the LP
 * position as people trade but only count once collect() banks them, so the pending amount is
 * shown (and drawn as a translucent bar segment) to make trading visibly move the needle.
 */
export default function GraduationCard({
  graduation,
  escrowedWeth,
}: {
  graduation: Graduation;
  /** Unclaimed creator-share WETH held in escrow (GitHub-bound tokens), raw wei string. */
  escrowedWeth?: string | null;
}) {
  const pct = Math.min(100, Math.round(graduation.progress * 100));
  const claimable = graduation.claimableFeesEth ?? 0;
  const escrowEth = (() => {
    try {
      return escrowedWeth ? Number(BigInt(escrowedWeth)) / 1e18 : 0;
    } catch {
      return 0;
    }
  })();
  // Lifetime = everything ever banked plus what's sitting uncollected on the position;
  // distributed = banked minus the slice still held in escrow for an unclaimed identity.
  const totalFees = graduation.earnedFeesEth + claimable;
  const distributed = Math.max(0, graduation.earnedFeesEth - escrowEth);
  // What the bar would read if someone collected right now.
  const pendingPct = graduation.thresholdEth > 0
    ? Math.min(100, Math.round(((graduation.earnedFeesEth + claimable) / graduation.thresholdEth) * 100))
    : pct;
  const showPending = !graduation.graduated && claimable > 0.0005;

  return (
    <Card className="gap-0 p-0">
      <CardHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <GraduationCap className="size-4 text-primary" aria-hidden />
          Graduation
        </CardTitle>
        {graduation.graduated ? (
          <Badge variant="outline" className="border-primary/30 text-primary">
            Graduated
          </Badge>
        ) : (
          <span className="tnum text-sm font-semibold text-primary">{pct}%</span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-4">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
          {/* Pending segment first (wider), banked progress drawn on top of it. */}
          {showPending && (
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary/35 transition-all duration-500"
              style={{ width: `${pendingPct}%` }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Fees earned toward graduation</span>
          <span className="tnum text-sm font-medium">
            {formatEth(graduation.earnedFeesEth, 3)}{" "}
            <span className="text-muted-foreground">/ {graduation.thresholdEth} ETH</span>
          </span>
        </div>
        {showPending && (
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Ready to collect</span>
            <span className="tnum text-sm font-medium text-primary">+{formatEth(claimable, 3)}</span>
          </div>
        )}
        <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Total fees earned</span>
            <span className="tnum text-sm font-medium">{formatEth(totalFees, 4)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Fees distributed</span>
            <span className="tnum text-sm font-medium">{formatEth(distributed, 4)}</span>
          </div>
          {escrowEth > 0 && (
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Held in escrow (unclaimed)</span>
              <span className="tnum text-sm font-medium text-highlight">{formatEth(escrowEth, 4)}</span>
            </div>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {graduation.graduated
            ? "This token has graduated. Its protocol fee share has dropped and the freed bps route to the creator."
            : showPending
              ? "Trading fees accrue on the locked position and count once collected — hit Collect fees below to bank them toward graduation."
              : "When lifetime fees reach the threshold, the token's protocol share drops and the freed bps route to the creator."}
        </p>
      </CardContent>
    </Card>
  );
}

import { GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatEth } from "@/lib/format";

interface Graduation {
  earnedFeesEth: number;
  thresholdEth: number;
  graduated: boolean;
  progress: number;
}

/**
 * Graduation progress, measured in fees the token has actually earned — the same number that
 * drives the fee discount, so a donation to the pool cannot move it.
 */
export default function GraduationCard({ graduation }: { graduation: Graduation }) {
  const pct = Math.min(100, Math.round(graduation.progress * 100));
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
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Fees earned toward graduation</span>
          <span className="tnum text-sm font-medium">
            {formatEth(graduation.earnedFeesEth, 3)}{" "}
            <span className="text-muted-foreground">/ {graduation.thresholdEth} ETH</span>
          </span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {graduation.graduated
            ? "This token has graduated. Its protocol fee share has dropped and the freed bps route to the creator."
            : "When lifetime fees reach the threshold, the token's protocol share drops and the freed bps route to the creator."}
        </p>
      </CardContent>
    </Card>
  );
}

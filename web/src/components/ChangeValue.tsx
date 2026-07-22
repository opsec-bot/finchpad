import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPct } from "@/lib/format";

/** A signed percentage change. Teal for positive, warm red for negative; numbers are tabular. */
export default function ChangeValue({
  value,
  showIcon = false,
  className,
}: {
  value: number;
  showIcon?: boolean;
  className?: string;
}) {
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "tnum inline-flex items-center gap-0.5 font-medium",
        positive ? "text-up" : "text-down",
        className,
      )}
    >
      {showIcon && <Icon className="size-3.5" aria-hidden />}
      {formatPct(value)}
    </span>
  );
}

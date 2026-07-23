import { Check, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { formatEther, zeroAddress } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { shortenAddress } from "@/lib/format";
import type { TokenDetail } from "@/lib/api";

type Fact = { label: string; detail: string; status: "good" | "warn" | "bad" };

function FactRow({ fact }: { fact: Fact }) {
  const Icon = fact.status === "good" ? Check : fact.status === "warn" ? TriangleAlert : X;
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          fact.status === "good" ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive",
        )}
      >
        <Icon className="size-3" aria-hidden />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium leading-tight">{fact.label}</span>
        <span
          className={cn(
            "text-xs leading-relaxed",
            fact.status === "good" ? "text-muted-foreground" : "text-destructive/90",
          )}
        >
          {fact.detail}
        </span>
      </div>
    </div>
  );
}

/**
 * The trust panel. On a pad whose whole pitch is being the anti-scam alternative, the facts a
 * buyer would otherwise have to read the contracts for belong on the page — stated plainly,
 * including the parts that are not reassuring.
 */
export default function TrustPanel({ token }: { token: TokenDetail }) {
  const hasFeeWallet = token.feeWallet && token.feeWallet !== zeroAddress;

  const facts: Fact[] = [
    token.knownToFactory
      ? {
          label: "Launched by the finchpad factory",
          detail: "Deployed by the verified factory contract.",
          status: "good",
        }
      : {
          label: "Not launched by our factory",
          detail: "This contract was not deployed by finchpad. None of the guarantees below are enforced.",
          status: "bad",
        },
    {
      label: "Liquidity permanently locked",
      detail: "The LP position is held by the locker and cannot be pulled.",
      status: "good",
    },
    {
      label: "Fixed supply, no mint function",
      detail: `${token.totalSupply.toLocaleString("en-US")} tokens. The mint function does not exist.`,
      status: "good",
    },
    {
      label: "Fee split 80% creator / 20% protocol",
      detail: hasFeeWallet
        ? `Creator fees route to ${shortenAddress(token.feeWallet as string, 4)}.`
        : "Snapshotted at launch and immutable afterward.",
      status: "good",
    },
  ];

  if (token.github) {
    const escrowEth = (() => {
      try {
        return Number(formatEther(BigInt(token.github.escrowedWeth || "0")));
      } catch {
        return 0;
      }
    })();
    facts.push(
      token.github.claimed
        ? {
            label: `Bound to a GitHub ${token.github.kind} · #${token.github.githubId}`,
            detail: "The GitHub owner has claimed the token and receives the creator fees.",
            status: "good",
          }
        : {
            label: `Fees escrowed for a GitHub ${token.github.kind} · #${token.github.githubId}`,
            detail: `${escrowEth.toFixed(4)} ETH held in escrow until the GitHub owner claims it. The launcher earns nothing until then.`,
            status: "warn",
          },
    );
  }

  const hasWarning = facts.some((f) => f.status !== "good");

  return (
    <Card className={cn("gap-0 p-0", !token.knownToFactory && "border-destructive/40")}>
      <CardHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className={cn("size-4", hasWarning ? "text-destructive" : "text-primary")} aria-hidden />
          Trust facts
        </CardTitle>
        <span className={cn("text-xs font-medium", hasWarning ? "text-destructive" : "text-primary")}>
          {hasWarning ? "Review carefully" : "All verified"}
        </span>
      </CardHeader>
      <CardContent className="px-4 py-1">
        {facts.map((fact, i) => (
          <div key={fact.label}>
            <FactRow fact={fact} />
            {i < facts.length - 1 && <Separator />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

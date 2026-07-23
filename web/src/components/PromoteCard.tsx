import { useEffect, useState } from "react";
import type { Address } from "viem";
import { formatEther } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveWallet } from "@/components/Wallet";
import { getWalletClient, publicClient } from "@/lib/tx";
import { addresses, explorerTx } from "@/lib/chain";
import { featureBoostAbi } from "@/lib/abis";
import { readableError } from "@/lib/trade";
import { useEthUsd, usd } from "@/lib/money";
import type { TokenDetail } from "@/lib/api";

const HOUR_OPTIONS = [6, 12, 24];

/**
 * Paid promotion, one product: boost a token for 6/12/24 hours. Boosted tokens get the ⚡
 * badge, a highlighted card, and the top rail on Explore — while STAYING in the organic feed
 * (placement adds, never reorders). Hours stack: buying while boosted extends the window.
 * Anyone can buy it for any token, so nothing here may read as vetting.
 */
export default function PromoteCard({ token, onChanged }: { token: TokenDetail; onChanged: () => void }) {
  const { authenticated } = usePrivy();
  const wallet = useActiveWallet();
  const [perHour, setPerHour] = useState<bigint | null>(null);
  const [hours, setHours] = useState(12);
  const [busy, setBusy] = useState(false);
  const ethUsd = useEthUsd();

  const fb = addresses.featureBoost;
  const active = token.boostedUntil * 1000 > Date.now();

  useEffect(() => {
    if (!fb) return;
    let alive = true;
    publicClient
      .readContract({ address: fb as Address, abi: featureBoostAbi, functionName: "pricePerHour" })
      .then((p) => alive && setPerHour(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fb]);

  if (!fb || !authenticated || !token.knownToFactory) return null;

  const cost = perHour !== null ? perHour * BigInt(hours) : null;
  const costLabel = (wei: bigint) => {
    const eth = Number(formatEther(wei));
    return ethUsd ? usd(eth * ethUsd) : `${eth} ETH`;
  };

  async function buy() {
    if (!wallet || cost === null) return;
    setBusy(true);
    const id = toast.loading(`Boosting for ${hours}h…`);
    try {
      const client = await getWalletClient(wallet);
      const { request } = await publicClient.simulateContract({
        address: fb as Address,
        abi: featureBoostAbi,
        functionName: "boost",
        args: [token.address, hours],
        value: cost,
        account: wallet.address as Address,
      });
      const hash = await client.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`Boosted for ${hours} hours`, {
        id,
        description: active ? "Added to the existing boost window." : "Badge, highlighted card, and top-rail placement are live.",
        action: { label: "View", onClick: () => window.open(explorerTx(hash), "_blank", "noopener") },
      });
      onChanged();
    } catch (e) {
      toast.error("Boost failed", { id, description: readableError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-0 p-0">
      <CardHeader className="border-b border-border px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Zap className="size-4 text-highlight" aria-hidden />
          Boost
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-4 text-sm">
        {active && (
          <div className="flex items-center justify-between rounded-lg bg-highlight/10 px-3 py-2 text-xs">
            <span className="font-medium text-highlight">Boost active</span>
            <span className="tnum text-muted-foreground">
              until{" "}
              {new Date(token.boostedUntil * 1000).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          ⚡ badge, highlighted card, and top-rail placement on Explore for the hours you buy — the token stays in the
          normal feed too. Hours stack{active ? ": buying now extends the window" : ""}.
        </p>

        <div className="flex items-center gap-1.5">
          {HOUR_OPTIONS.map((h) => (
            <Button
              key={h}
              size="sm"
              variant={hours === h ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={() => setHours(h)}
            >
              {h}h
            </Button>
          ))}
          <Button size="sm" className="ml-auto" disabled={busy || cost === null} onClick={buy}>
            {busy ? "Boosting…" : cost !== null ? `Boost · ${costLabel(cost)}` : "…"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Paid placement — not vetting, not an endorsement. Anyone can buy it for any token.
        </p>
      </CardContent>
    </Card>
  );
}

import { AlertTriangle, BadgeCheck, Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import TokenAvatar from "@/components/TokenAvatar";
import ChangeValue from "@/components/ChangeValue";
import type { TokenDetail } from "@/lib/api";
import { formatPrice, shortenAddress } from "@/lib/format";
import { useEthUsd } from "@/lib/money";

/** Token identity + live price: avatar, name/symbol, trust badges, copyable address, 24h change. */
export default function TokenHeader({ token, change24h }: { token: TokenDetail; change24h: number }) {
  const ethUsd = useEthUsd();
  const priceLabel = ethUsd ? formatPrice(token.priceWeth * ethUsd) : `${token.priceWeth.toExponential(3)} Ξ`;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <TokenAvatar src={token.logo} symbol={token.symbol} size="lg" className="rounded-xl" />
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold leading-none tracking-tight">{token.name}</h1>
            <span className="tnum font-mono text-sm text-muted-foreground">${token.symbol}</span>
            {token.github?.claimed && (
              <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
                <BadgeCheck className="size-3" aria-hidden />
                Verified
              </Badge>
            )}
            {!token.knownToFactory && (
              <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
                <AlertTriangle className="size-3" aria-hidden />
                Unverified factory
              </Badge>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(token.address);
              toast.success("Contract address copied");
            }}
            className="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {shortenAddress(token.address, 6)}
            <Copy className="size-3" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:items-end">
        <span className="tnum text-3xl font-semibold leading-none md:text-4xl">{priceLabel}</span>
        <div className="mt-2 flex items-center gap-2">
          <ChangeValue value={change24h} showIcon className="text-sm" />
          <span className="text-xs text-muted-foreground">24h</span>
        </div>
      </div>
    </div>
  );
}

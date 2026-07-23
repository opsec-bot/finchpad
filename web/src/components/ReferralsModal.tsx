import { useEffect, useState } from "react";
import type { Address } from "viem";
import { Copy, Users } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { useActiveWallet } from "@/components/Wallet";
import { api } from "@/lib/api";
import type { ReferralsResponse } from "@/lib/api";
import { publicClient } from "@/lib/tx";
import { addresses } from "@/lib/chain";
import { finchLockerAbi } from "@/lib/abis";
import { usd, usdExact } from "@/lib/money";
import { Balance } from "@/lib/blurBalances";

/**
 * Referral earnings, fomo-style: headline total, the share you earn, 7d + tokens-referred
 * stats, a copyable link, and a per-token breakdown. All figures come from indexed
 * ReferralPaid events — on-chain payouts, not promises.
 *
 * The link carries the wallet address (?ref=0x…) because referrals are address-bound on-chain
 * (LaunchParams.referrer). It swaps to /r/<handle> once usernames exist.
 */
export function ReferralsModal({
  open,
  onClose,
  username,
}: {
  open: boolean;
  onClose: () => void;
  /** When the user has a claimed handle the link is the friendly /r/<username> form. */
  username?: string;
}) {
  const wallet = useActiveWallet();
  const [data, setData] = useState<ReferralsResponse | null>(null);
  const [shareBps, setShareBps] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !wallet) return;
    let alive = true;
    api
      .referrals(wallet.address)
      .then((r) => alive && (setData(r), setErr(null)))
      .catch((e) => alive && setErr((e as Error).message));
    if (addresses.locker) {
      publicClient
        .readContract({ address: addresses.locker as Address, abi: finchLockerAbi, functionName: "referralShareBps" })
        .then((bps) => alive && setShareBps(Number(bps)))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [open, wallet]);

  const link = username
    ? `${window.location.origin}/r/${username}`
    : wallet
      ? `${window.location.origin}/?ref=${wallet.address}`
      : "";
  const eth = data?.ethUsd ?? null;
  const inUsd = (weth: number) => (eth ? usdExact(weth * eth) : `${weth.toFixed(4)} Ξ`);

  function copy() {
    navigator.clipboard?.writeText(link).then(() => toast("Referral link copied"));
  }

  return (
    <Modal open={open} onClose={onClose} title="Referrals">
      <div className="flex flex-col gap-4">
        {/* Headline */}
        <div className="flex flex-col items-center gap-1 py-2 text-center">
          <Balance className="tnum text-3xl font-semibold">{data ? inUsd(data.totalWeth) : "—"}</Balance>
          <span className="text-xs text-muted-foreground">Total earned rewards</span>
        </div>

        <div className="rounded-lg bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary">
          <Users className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          Earn {shareBps !== null ? `${shareBps / 100}%` : "a share"} of the fees from every token launched through
          your link
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
          <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
            <Balance className="tnum text-lg font-semibold">{data ? inUsd(data.last7dWeth) : "—"}</Balance>
            <span className="text-xs text-muted-foreground">Earned last 7d</span>
          </div>
          <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
            <span className="tnum text-lg font-semibold">{data ? data.tokens.length : "—"}</span>
            <span className="text-xs text-muted-foreground">Tokens referred</span>
          </div>
        </div>

        {/* Link */}
        <button
          onClick={copy}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-xs transition-colors hover:bg-muted"
          title={link}
        >
          <span className="truncate">{link || "connect a wallet"}</span>
          <Copy className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>

        {/* Per-token breakdown */}
        {err && (
          <p className="text-sm text-destructive">
            {err.includes("indexer")
              ? import.meta.env.DEV
                ? "Referral data needs the indexer — start npm run dev."
                : "Referral data is loading — check back shortly."
              : err}
          </p>
        )}
        {data && data.tokens.length > 0 && (
          <div className="flex flex-col">
            <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Token</span>
              <span>Fees earned</span>
            </div>
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {data.tokens.map((t) => (
                <li key={t.token} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-medium">${t.symbol}</span>
                  <span className="flex items-baseline gap-2">
                    <Balance className="tnum font-medium text-primary">+{eth ? usd(t.earnedWeth * eth) : `${t.earnedWeth.toFixed(4)} Ξ`}</Balance>
                    <span className="tnum text-xs text-muted-foreground">{t.payouts} payouts</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data && data.tokens.length === 0 && (
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            No referral earnings yet. Share your link — when someone launches a token through it, you earn a share of
            that token's trading fees automatically, paid on-chain.
          </p>
        )}
      </div>
    </Modal>
  );
}

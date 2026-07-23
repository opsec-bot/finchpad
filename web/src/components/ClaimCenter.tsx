import { useEffect, useState } from "react";
import type { Address } from "viem";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useActiveWallet } from "@/components/Wallet";
import { getWalletClient, publicClient } from "@/lib/tx";
import { addresses, explorerTx } from "@/lib/chain";
import { feeRightsRegistryAbi } from "@/lib/abis";
import { readableError } from "@/lib/trade";
import { navigateTo } from "@/lib/nav";

interface MenuClaim {
  token: string;
  symbol: string;
  name: string;
  claimKind: number;
  githubId: string;
  deadline: string | number;
  signature: string | null;
  signed: boolean;
}

interface MenuResult {
  identity: string;
  githubId: string;
  claimant: string;
  claims: MenuClaim[];
}

/**
 * The creator claim menu: one GitHub sign-in discovers every token bound to that identity —
 * user-bound tokens by id, repo-bound tokens by a live admin check — and returns a signed
 * claim for each. Claims are submitted per token from here; each attestation expires in
 * 15 minutes, so the list states that plainly.
 */
export function ClaimCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wallet = useActiveWallet();
  const [result, setResult] = useState<MenuResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "oauth" or a token address
  const [claimedNow, setClaimedNow] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setClaimedNow(new Set());
  }, [open]);

  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== "finchpad:github-claims") return;
      setBusy(null);
      setResult(e.data.result as MenuResult);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function verify() {
    if (!wallet) return;
    setBusy("oauth");
    const w = window.open(
      `/auth/github/start?mode=menu&claimant=${wallet.address}`,
      "finchpad-github-claims",
      "width=620,height=760",
    );
    if (!w) {
      setBusy(null);
      toast.error("Popup blocked — allow popups for this site and try again.");
    }
  }

  async function claim(c: MenuClaim) {
    if (!wallet || !c.signature) return;
    setBusy(c.token);
    const id = toast.loading(`Claiming $${c.symbol}…`);
    try {
      const client = await getWalletClient(wallet);
      const { request } = await publicClient.simulateContract({
        address: addresses.registry as Address,
        abi: feeRightsRegistryAbi,
        functionName: "claimGithub",
        args: [c.token as Address, c.claimKind, BigInt(c.githubId), BigInt(c.deadline), c.signature as `0x${string}`],
        account: wallet.address as Address,
      });
      const hash = await client.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`Claimed $${c.symbol}`, {
        id,
        description: "Escrowed fees paid out; future creator fees route to your wallet.",
        action: { label: "View", onClick: () => window.open(explorerTx(hash), "_blank", "noopener") },
      });
      setClaimedNow((prev) => new Set(prev).add(c.token));
    } catch (err) {
      toast.error(`Claim failed for $${c.symbol}`, { id, description: readableError(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Claim creator fees">
      <div className="flex flex-col gap-4 text-sm">
        {!result ? (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Tokens on finchpad can be bound to a GitHub user or repository — their creator fees escrow until the
              owner claims them. Verify once with GitHub and we'll find every token that belongs to you.
            </p>
            <Button onClick={verify} disabled={busy !== null || !wallet}>
              <FontAwesomeIcon icon={faGithub} className="size-4" aria-hidden />
              {busy === "oauth" ? "Waiting for GitHub…" : "Verify with GitHub"}
            </Button>
            {!wallet && <p className="text-xs text-muted-foreground">Connect a wallet first — fees pay out to it.</p>}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">Verified as</span>
              <span className="font-medium">
                {result.identity} <span className="tnum text-xs text-muted-foreground">#{result.githubId}</span>
              </span>
            </div>

            {result.claims.length === 0 ? (
              <p className="py-4 text-center text-xs leading-relaxed text-muted-foreground">
                No unclaimed tokens are bound to this GitHub account. Launch one bound to yourself, or ask a launcher
                to bind their token to your user or repo.
              </p>
            ) : (
              <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                {result.claims.map((c) => {
                  const done = claimedNow.has(c.token);
                  return (
                    <li
                      key={c.token}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
                    >
                      <button
                        className="min-w-0 text-left transition-colors hover:text-primary"
                        onClick={() => {
                          onClose();
                          navigateTo(`/tokens/robinhood/${c.token}`);
                        }}
                      >
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          ${c.symbol} · {c.claimKind === 1 ? "repo" : "user"} #{c.githubId}
                        </span>
                      </button>
                      {done ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-primary">
                          <BadgeCheck className="size-4" aria-hidden />
                          Claimed
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy !== null || !c.signed}
                          onClick={() => claim(c)}
                          title={c.signed ? undefined : "Claim signing isn't enabled on this server"}
                        >
                          {busy === c.token ? "Claiming…" : "Claim"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {result.claims.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Each claim is one transaction; attestations expire after 15 minutes — re-verify if they do. Fees pay
                out to {result.claimant.slice(0, 6)}…{result.claimant.slice(-4)}.
              </p>
            )}
            <Button variant="secondary" size="sm" onClick={verify} disabled={busy !== null}>
              Re-verify
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

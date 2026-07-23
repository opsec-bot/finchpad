import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { formatEther } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveWallet } from "@/components/Wallet";
import { getWalletClient, publicClient } from "@/lib/tx";
import { addresses, explorerTx } from "@/lib/chain";
import { feeRightsRegistryAbi } from "@/lib/abis";
import { readableError } from "@/lib/trade";
import { api } from "@/lib/api";
import type { TokenDetail } from "@/lib/api";

interface ClaimPayload {
  token: string;
  claimant: string;
  claimKind: number;
  githubId: string | number;
  identity: string;
  deadline: string | number;
  signature: string | null;
  signed: boolean;
}

/**
 * The claim-fees flow for GitHub-bound tokens: verify the identity with GitHub OAuth in a
 * popup, receive the backend's EIP-712 attestation via postMessage, submit claimGithub() —
 * escrowed fees pay out and the fee wallet becomes the claimant's, permanently.
 *
 * Only rendered while a binding is unclaimed. The contract enforces everything that matters
 * (binding match, deadline, signer, single-use); this surface just makes the errors friendly
 * before gas is spent.
 */
export default function ClaimFees({ token, onClaimed }: { token: TokenDetail; onClaimed: () => void }) {
  const { authenticated, login } = usePrivy();
  const wallet = useActiveWallet();
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState<"oauth" | "submit" | null>(null);
  const popupRef = useRef<Window | null>(null);

  const gh = token.github;
  const isRepo = gh?.kind === "repo";
  const escrowEth = (() => {
    try {
      return Number(formatEther(BigInt(gh?.escrowedWeth || "0")));
    } catch {
      return 0;
    }
  })();

  // Receive the claim payload from the OAuth popup. Origin-checked: only OUR server's pages
  // can deliver a claim.
  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== "finchpad:github-claim") return;
      const claim = e.data.claim as ClaimPayload;
      setBusy(null);

      if (!gh) return;
      if (String(claim.githubId) !== gh.githubId) {
        return toast.error("Wrong GitHub identity", {
          description: `You verified ${claim.identity} (#${claim.githubId}), but this token is bound to #${gh.githubId}.`,
        });
      }
      if (!claim.signed || !claim.signature) {
        return toast.error("Claims aren't enabled on this server", {
          description: "The claim signer isn't provisioned. In local dev, restart npm run dev to get the dev signer.",
        });
      }
      if (!wallet || claim.claimant.toLowerCase() !== wallet.address.toLowerCase()) {
        return toast.error("Wallet changed mid-claim — try again.");
      }

      setBusy("submit");
      const id = toast.loading("Claiming your fees…");
      try {
        const client = await getWalletClient(wallet);
        const { request } = await publicClient.simulateContract({
          address: addresses.registry as Address,
          abi: feeRightsRegistryAbi,
          functionName: "claimGithub",
          args: [
            token.address,
            claim.claimKind,
            BigInt(claim.githubId),
            BigInt(claim.deadline),
            claim.signature as `0x${string}`,
          ],
          account: wallet.address as Address,
        });
        const hash = await client.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
        api.recordAction("claim", hash, token.address).catch(() => {});
        toast.success(`Claimed as ${claim.identity}`, {
          id,
          description:
            escrowEth > 0
              ? `${escrowEth.toFixed(4)} ETH of escrowed fees paid out. Future creator fees route to your wallet.`
              : "Future creator fees route to your wallet.",
          action: { label: "View", onClick: () => window.open(explorerTx(hash), "_blank", "noopener") },
        });
        onClaimed();
      } catch (err) {
        toast.error("Claim failed", { id, description: readableError(err) });
      } finally {
        setBusy(null);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [gh, wallet, token.address, escrowEth, onClaimed]);

  if (!gh || gh.claimed || !addresses.registry) return null;

  function startOauth() {
    if (!wallet) return;
    const params = new URLSearchParams({
      kind: gh!.kind,
      token: token.address,
      claimant: wallet.address,
      mode: "popup",
    });
    if (isRepo) params.set("repo", repo.trim());
    setBusy("oauth");
    popupRef.current = window.open(
      `/auth/github/start?${params}`,
      "finchpad-github-claim",
      "width=620,height=760,noopener=no",
    );
    if (!popupRef.current) {
      setBusy(null);
      toast.error("Popup blocked — allow popups for this site and try again.");
    }
  }

  const repoOk = !isRepo || /^[\w.-]+\/[\w.-]+$/.test(repo.trim());

  return (
    <Card className="gap-0 border-primary/25 p-0">
      <CardHeader className="border-b border-border px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <FontAwesomeIcon icon={faGithub} className="size-4 text-primary" aria-hidden />
          Claim creator fees
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-4 text-sm">
        <p className="text-xs leading-relaxed text-muted-foreground">
          This token is bound to a GitHub {gh.kind} (<span className="tnum">#{gh.githubId}</span>).
          {escrowEth > 0 && (
            <>
              {" "}
              <span className="font-medium text-foreground">{escrowEth.toFixed(4)} ETH</span> in fees is escrowed,
              waiting for the owner.
            </>
          )}{" "}
          If that's you, verify with GitHub and the fees — past and future — are yours.
        </p>

        {isRepo && (
          <Input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repository"
            className="font-mono text-xs"
            disabled={busy !== null}
          />
        )}

        {!authenticated ? (
          <Button size="sm" onClick={login}>
            Connect to claim
          </Button>
        ) : (
          <Button size="sm" onClick={startOauth} disabled={busy !== null || !wallet || !repoOk}>
            {busy === "oauth" ? "Waiting for GitHub…" : busy === "submit" ? "Claiming…" : "Verify with GitHub"}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Fees pay out to the connected wallet{wallet ? ` (${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)})` : ""}.
        </p>
      </CardContent>
    </Card>
  );
}

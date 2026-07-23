import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { formatEther, parseEther } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { Coins, Flame } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useActiveWallet } from "@/components/Wallet";
import { getWalletClient, publicClient } from "@/lib/tx";
import { addresses, explorerTx } from "@/lib/chain";
import { erc20Abi, finchLockerAbi } from "@/lib/abis";
import { readableError } from "@/lib/trade";
import { amount as fmtAmount } from "@/lib/money";
import type { TokenDetail } from "@/lib/api";

/**
 * On-chain actions a holder or creator can take on a token, gated to what actually applies:
 *  - Collect fees: permissionless — banks the pool's accrued fees to the fee wallet and advances
 *    graduation. Shown for any finchpad-launched token when the locker address is known.
 *  - Burn: destroy your own tokens (ERC20Burnable), reducing supply. Shown when you hold some.
 *
 * Both go through the embedded wallet, so with one-click enabled they execute without a
 * confirmation prompt (MFA may still apply once per hour).
 */
export default function TokenActions({ token, onChanged }: { token: TokenDetail; onChanged: () => void }) {
  const { authenticated } = usePrivy();
  const wallet = useActiveWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [burnAmt, setBurnAmt] = useState("");
  const [busy, setBusy] = useState<null | "burn" | "collect">(null);

  const locker = addresses.locker;
  const canCollect = token.knownToFactory && Boolean(locker);

  const refresh = useCallback(async () => {
    if (!wallet) return setBalance(null);
    const b = await publicClient
      .readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address as Address] })
      .catch(() => null);
    setBalance(b as bigint | null);
  }, [wallet, token.address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function collect() {
    if (!wallet || !locker) return;
    setBusy("collect");
    const id = toast.loading("Collecting fees…");
    try {
      const client = await getWalletClient(wallet);
      const { request } = await publicClient.simulateContract({
        address: locker as Address,
        abi: finchLockerAbi,
        functionName: "collect",
        args: [token.address],
        account: wallet.address as Address,
      });
      const hash = await client.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success("Fees collected", {
        id,
        description: "Banked to the fee wallet; graduation progress updated.",
        action: { label: "View", onClick: () => window.open(explorerTx(hash), "_blank", "noopener") },
      });
      onChanged();
    } catch (e) {
      toast.error("Collect failed", { id, description: readableError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function burn() {
    if (!wallet || !burnAmt) return;
    const amt = parseEther(burnAmt);
    if (balance !== null && amt > balance) return toast.error(`Not enough ${token.symbol} to burn.`);
    setBusy("burn");
    const id = toast.loading(`Burning ${token.symbol}…`);
    try {
      const client = await getWalletClient(wallet);
      const { request } = await publicClient.simulateContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "burn",
        args: [amt],
        account: wallet.address as Address,
      });
      const hash = await client.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`Burned ${fmtAmount(Number(formatEther(amt)))} ${token.symbol}`, {
        id,
        action: { label: "View", onClick: () => window.open(explorerTx(hash), "_blank", "noopener") },
      });
      setBurnAmt("");
      await refresh();
      onChanged();
    } catch (e) {
      toast.error("Burn failed", { id, description: readableError(e) });
    } finally {
      setBusy(null);
    }
  }

  const hasBalance = balance !== null && balance > 0n;
  // Nothing to offer: not signed in, or a token this wallet can neither collect for nor burn.
  if (!authenticated || (!hasBalance && !canCollect)) return null;

  return (
    <Card className="gap-0 p-0">
      <CardHeader className="border-b border-border px-4 py-3">
        <CardTitle className="text-sm font-medium">Token actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4 py-4">
        {canCollect && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Coins className="size-4 text-primary" aria-hidden />
              Collect fees
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Bank the pool's accrued fees to the fee wallet and advance graduation. Anyone can poke it.
            </p>
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={collect}>
              {busy === "collect" ? "Collecting…" : "Collect fees"}
            </Button>
          </div>
        )}

        {canCollect && hasBalance && <Separator />}

        {hasBalance && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Flame className="size-4 text-destructive" aria-hidden />
              Burn
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Permanently destroy your {token.symbol}, reducing supply. This cannot be undone.
            </p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Your balance</span>
              <button
                type="button"
                className="tabular transition-colors hover:text-foreground"
                onClick={() => balance && setBurnAmt(formatEther(balance))}
              >
                {fmtAmount(Number(formatEther(balance as bigint)))} {token.symbol}
              </button>
            </div>
            <Input
              inputMode="decimal"
              value={burnAmt}
              onChange={(e) => setBurnAmt(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.0"
              disabled={busy !== null}
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={busy !== null || !burnAmt || !(Number(burnAmt) > 0)}
              onClick={burn}
            >
              {busy === "burn" ? "Burning…" : `Burn ${token.symbol}`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

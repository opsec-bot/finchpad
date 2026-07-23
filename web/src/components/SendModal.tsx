import { useEffect, useState } from "react";
import type { Address } from "viem";
import { formatEther, parseEther } from "viem";
import { ArrowLeftRight, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveWallet } from "@/components/Wallet";
import { getWalletClient, publicClient } from "@/lib/tx";
import { explorerTx } from "@/lib/chain";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/api";
import { readableError } from "@/lib/trade";
import { useEthUsd, usdExact } from "@/lib/money";

type Dest = "user" | "address";

/**
 * Send ETH to another finchpad user by USERNAME (resolved to their wallet, with name+avatar
 * shown before anything moves), or withdraw to any external address. Goes through the
 * embedded wallet, so one-click + MFA apply. Every send is recorded in the activity ledger
 * AFTER the receipt confirms — the server re-reads from/to/value from the chain.
 */
export function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wallet = useActiveWallet();
  const ethUsd = useEthUsd();
  const [dest, setDest] = useState<Dest>("user");
  const [username, setUsername] = useState("");
  const [resolved, setResolved] = useState<Profile | null>(null);
  const [resolving, setResolving] = useState(false);
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [ccy, setCcy] = useState<"ETH" | "USD">("ETH");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setUsername("");
      setResolved(null);
      setAddress("");
      setAmount("");
      return;
    }
    if (wallet) {
      publicClient.getBalance({ address: wallet.address as Address }).then(setBalance).catch(() => {});
    }
  }, [open, wallet]);

  // Resolve the recipient handle as they type — always show WHO before money moves.
  useEffect(() => {
    setResolved(null);
    const u = username.trim().replace(/^@/, "").toLowerCase();
    if (!u || u.length < 3) return;
    setResolving(true);
    const t = setTimeout(() => {
      api
        .profile(u)
        .then((p) => setResolved(p))
        .catch(() => setResolved(null))
        .finally(() => setResolving(false));
    }, 350);
    return () => clearTimeout(t);
  }, [username]);

  const priceReady = ethUsd != null && ethUsd > 0;
  const ethAmountStr = (() => {
    if (ccy === "USD" && priceReady) {
      const eth = Number(amount) / (ethUsd as number);
      return Number.isFinite(eth) && eth > 0 ? eth.toFixed(18) : "";
    }
    return amount;
  })();

  function toggleCcy() {
    if (!priceReady) return;
    const n = Number(amount);
    if (amount && n > 0) {
      setAmount(ccy === "ETH" ? (n * (ethUsd as number)).toFixed(2) : (n / (ethUsd as number)).toFixed(6));
    }
    setCcy((c) => (c === "ETH" ? "USD" : "ETH"));
  }

  const to: Address | null =
    dest === "user"
      ? ((resolved?.address as Address) ?? null)
      : /^0x[a-fA-F0-9]{40}$/.test(address.trim())
        ? (address.trim() as Address)
        : null;

  const sendingToSelf = to && wallet && to.toLowerCase() === wallet.address.toLowerCase();
  const wei = ethAmountStr && Number(ethAmountStr) > 0 ? parseEther(ethAmountStr) : 0n;
  const insufficient = balance !== null && wei > 0n && wei >= balance; // leave dust for gas
  const canSend = Boolean(wallet && to && wei > 0n && !insufficient && !sendingToSelf && !busy);

  async function sendEth() {
    if (!wallet || !to || wei === 0n) return;
    setBusy(true);
    const label = dest === "user" && resolved ? `@${resolved.username}` : `${to.slice(0, 6)}…${to.slice(-4)}`;
    const id = toast.loading(`Sending to ${label}…`);
    try {
      const client = await getWalletClient(wallet);
      const hash = await client.sendTransaction({
        account: wallet.address as Address,
        to,
        value: wei,
        chain: client.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      // Ledger entry — the server verifies from/to/value against the chain before recording.
      api.recordTransfer(hash).catch(() => {});
      toast.success(`Sent to ${label}`, {
        id,
        description: `${Number(formatEther(wei)).toFixed(6)} ETH`,
        action: { label: "View", onClick: () => window.open(explorerTx(hash), "_blank", "noopener") },
      });
      onClose();
    } catch (e) {
      toast.error("Send failed", { id, description: readableError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Send ETH">
      <div className="flex flex-col gap-4 text-sm">
        <Tabs value={dest} onValueChange={(v) => setDest(v as Dest)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="user" disabled={busy}>
              To a finchpad user
            </TabsTrigger>
            <TabsTrigger value="address" disabled={busy}>
              To an address
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {dest === "user" ? (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                className="pl-7 font-mono"
                disabled={busy}
              />
            </div>
            {username.trim().length >= 3 &&
              (resolving ? (
                <p className="text-xs text-muted-foreground">looking up…</p>
              ) : resolved ? (
                <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                  <Avatar className="size-7">
                    {resolved.avatar && <AvatarImage src={resolved.avatar} alt="" className="object-cover" />}
                    <AvatarFallback className="text-xs">{resolved.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-sm font-medium">{resolved.name || `@${resolved.username}`}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      @{resolved.username} · {resolved.address.slice(0, 6)}…{resolved.address.slice(-4)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-destructive">no user with that name</p>
              ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
              placeholder="0x…"
              className="font-mono text-xs"
              disabled={busy}
            />
            {address && !/^0x[a-fA-F0-9]{40}$/.test(address) && (
              <p className="text-xs text-destructive">that's not a valid address</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Amount</span>
            {balance !== null && (
              <button
                className="tnum transition-colors hover:text-primary"
                onClick={() => {
                  const usable = (balance * 99n) / 100n; // keep a sliver for gas
                  const eth = Number(formatEther(usable));
                  setAmount(ccy === "USD" && priceReady ? (eth * (ethUsd as number)).toFixed(2) : String(eth));
                }}
              >
                Balance {Number(formatEther(balance)).toFixed(4)} ETH
              </button>
            )}
          </div>
          <div className="relative">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.0"
              disabled={busy}
              className="tabular h-12 pr-20 text-xl font-semibold"
            />
            <button
              type="button"
              onClick={toggleCcy}
              disabled={busy || !priceReady}
              className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              {ccy}
              <ArrowLeftRight className="size-3" aria-hidden />
            </button>
          </div>
          {priceReady && amount && Number(amount) > 0 && (
            <p className="tnum text-xs text-muted-foreground">
              ≈ {ccy === "USD" ? `${(Number(amount) / (ethUsd as number)).toFixed(6)} ETH` : usdExact(Number(amount) * (ethUsd as number))}
            </p>
          )}
        </div>

        {sendingToSelf && <p className="text-xs text-destructive">That's your own wallet.</p>}
        {insufficient && <p className="text-xs text-destructive">Not enough ETH — leave a little for gas.</p>}

        <Button size="lg" disabled={!canSend} onClick={sendEth}>
          <SendHorizontal className="size-4" aria-hidden />
          {busy ? "Sending…" : dest === "user" && resolved ? `Send to @${resolved.username}` : "Send"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Sends are on-chain and irreversible. Double-check the recipient.
        </p>
      </div>
    </Modal>
  );
}

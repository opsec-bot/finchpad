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
import { erc20Abi } from "@/lib/abis";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/api";
import { readableError } from "@/lib/trade";
import { useEthUsd, usdExact, amount as fmtAmount } from "@/lib/money";

type Dest = "user" | "address";
interface Holding {
  token: string;
  symbol: string;
  balance: string;
}

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
  const [balance, setBalance] = useState<bigint | null>(null); // native ETH balance
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [asset, setAsset] = useState<Holding | null>(null); // null = ETH
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setUsername("");
      setResolved(null);
      setAddress("");
      setAmount("");
      setAsset(null);
      return;
    }
    if (wallet) {
      publicClient.getBalance({ address: wallet.address as Address }).then(setBalance).catch(() => {});
      api.holdings(wallet.address).then((r) => setHoldings(r.holdings)).catch(() => {});
    }
  }, [open, wallet]);

  const isToken = asset !== null;
  // The spendable balance of the SELECTED asset (native ETH, or the token's raw balance).
  const assetBalance = isToken ? BigInt(asset.balance) : balance;

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

  // USD entry is ETH-only; token amounts are always in token units.
  const priceReady = !isToken && ethUsd != null && ethUsd > 0;
  const amountStr = (() => {
    if (!isToken && ccy === "USD" && priceReady) {
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
  const units = amountStr && Number(amountStr) > 0 ? parseEther(amountStr) : 0n; // both ETH & 18-dec tokens
  // ETH: keep dust for gas (>=). Token: gas is paid in ETH, so the whole balance is spendable (>).
  const insufficient =
    assetBalance !== null && units > 0n && (isToken ? units > assetBalance : units >= assetBalance);
  const canSend = Boolean(wallet && to && units > 0n && !insufficient && !sendingToSelf && !busy);

  async function doSend() {
    if (!wallet || !to || units === 0n) return;
    setBusy(true);
    const sym = isToken ? asset.symbol : "ETH";
    const label = dest === "user" && resolved ? `@${resolved.username}` : `${to.slice(0, 6)}…${to.slice(-4)}`;
    const id = toast.loading(`Sending ${sym} to ${label}…`);
    try {
      const client = await getWalletClient(wallet);
      let hash: `0x${string}`;
      if (isToken) {
        const { request } = await publicClient.simulateContract({
          address: asset.token as Address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to, units],
          account: wallet.address as Address,
        });
        hash = await client.writeContract(request);
      } else {
        hash = await client.sendTransaction({ account: wallet.address as Address, to, value: units, chain: client.chain });
      }
      await publicClient.waitForTransactionReceipt({ hash });
      // Ledger — server re-reads the transfer (native value, or the token's Transfer log) from chain.
      api.recordTransfer(hash, isToken ? asset.token : undefined).catch(() => {});
      toast.success(`Sent to ${label}`, {
        id,
        description: `${fmtAmount(Number(formatEther(units)))} ${sym}`,
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
    <Modal open={open} onClose={onClose} title="Send">
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
                aria-label="Recipient username"
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
              aria-label="Recipient address"
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

        {/* Asset selector: ETH + every token this wallet holds. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Asset</span>
          <select
            aria-label="Asset to send"
            value={asset ? asset.token : "eth"}
            onChange={(e) => {
              setAsset(e.target.value === "eth" ? null : holdings.find((h) => h.token === e.target.value) ?? null);
              setAmount("");
              setCcy("ETH");
            }}
            disabled={busy}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="eth">ETH</option>
            {holdings.map((h) => (
              <option key={h.token} value={h.token}>
                {h.symbol}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Amount</span>
            {assetBalance !== null && (
              <button
                className="tnum transition-colors hover:text-primary"
                onClick={() => {
                  // ETH keeps a sliver for gas; a token's full balance is spendable.
                  const usable = isToken ? assetBalance : (assetBalance * 99n) / 100n;
                  const val = Number(formatEther(usable));
                  setAmount(!isToken && ccy === "USD" && priceReady ? (val * (ethUsd as number)).toFixed(2) : String(val));
                }}
              >
                Balance {isToken ? `${fmtAmount(Number(formatEther(assetBalance)))} ${asset.symbol}` : `${Number(formatEther(assetBalance)).toFixed(4)} ETH`}
              </button>
            )}
          </div>
          <div className="relative">
            <Input
              aria-label="Amount to send"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.0"
              disabled={busy}
              className="tabular h-12 pr-20 text-xl font-semibold"
            />
            {isToken ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                {asset.symbol}
              </span>
            ) : (
              <button
                type="button"
                onClick={toggleCcy}
                disabled={busy || !priceReady}
                className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                {ccy}
                <ArrowLeftRight className="size-3" aria-hidden />
              </button>
            )}
          </div>
          {!isToken && priceReady && amount && Number(amount) > 0 && (
            <p className="tnum text-xs text-muted-foreground">
              ≈ {ccy === "USD" ? `${(Number(amount) / (ethUsd as number)).toFixed(6)} ETH` : usdExact(Number(amount) * (ethUsd as number))}
            </p>
          )}
        </div>

        {sendingToSelf && <p className="text-xs text-destructive">That's your own wallet.</p>}
        {insufficient && (
          <p className="text-xs text-destructive">
            {isToken ? `Not enough ${asset.symbol}.` : "Not enough ETH — leave a little for gas."}
          </p>
        )}

        <Button size="lg" disabled={!canSend} onClick={doSend}>
          <SendHorizontal className="size-4" aria-hidden />
          {busy ? "Sending…" : `Send ${isToken ? asset.symbol : "ETH"}${dest === "user" && resolved ? ` to @${resolved.username}` : ""}`}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Sends are on-chain and irreversible. Double-check the recipient.
        </p>
      </div>
    </Modal>
  );
}

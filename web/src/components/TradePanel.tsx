import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEther, parseEther, maxUint256 } from "viem";
import type { Address } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useActiveWallet } from "@/components/Wallet";
import { explorerTx } from "@/lib/chain";
import { erc20Abi } from "@/lib/abis";
import { getWalletClient, publicClient } from "@/lib/tx";
import { approveRouter, quote, readableError, routerAllowance, swap } from "@/lib/trade";
import type { Quote, Side } from "@/lib/trade";
import { useEthUsd, usd, amount as fmtAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

const SLIPPAGE_PRESETS = [50, 100, 300]; // bps
const AUTO_SLIPPAGE = 100;
const QUOTE_DEBOUNCE_MS = 350;
const ETH_PRESETS = [0.01, 0.1, 0.5, 1];
const PCT_PRESETS = [25, 50, 75, 100];

export default function TradePanel({
  token,
  pool,
  symbol,
  tokenIsToken0,
  onTraded,
}: {
  token: Address;
  pool: Address;
  symbol: string;
  tokenIsToken0: boolean;
  onTraded: () => void;
}) {
  const { authenticated, login } = usePrivy();
  const wallet = useActiveWallet();
  const ethUsd = useEthUsd();

  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number | "auto">("auto");
  const [custom, setCustom] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gasEth, setGasEth] = useState<number | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);

  const slippageBps = slippage === "auto" ? AUTO_SLIPPAGE : slippage;

  const refreshBalances = useCallback(async () => {
    if (!wallet) return setEthBalance(null), setTokenBalance(null);
    const addr = wallet.address as Address;
    const [eth, tok] = await Promise.all([
      publicClient.getBalance({ address: addr }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
    ]);
    setEthBalance(eth);
    setTokenBalance(tok as bigint);
  }, [wallet, token]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  // Debounced quoting; the ref stops a slow response overwriting a newer one.
  const seq = useRef(0);
  useEffect(() => {
    if (!amount || !(Number(amount) > 0)) {
      setQ(null);
      setQuoteErr(null);
      setGasEth(null);
      return;
    }
    const mine = ++seq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const result = await quote(publicClient, {
          token,
          pool,
          tokenIsToken0,
          side,
          amountIn: parseEther(amount),
          slippageBps,
        });
        if (mine !== seq.current) return;
        setQ(result);
        setQuoteErr(null);
        const gasPrice = await publicClient.getGasPrice();
        if (mine === seq.current) setGasEth(Number(formatEther(gasPrice * (side === "buy" ? 220_000n : 260_000n))));
      } catch (err) {
        if (mine !== seq.current) return;
        setQ(null);
        setQuoteErr(readableError(err));
      } finally {
        if (mine === seq.current) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [amount, side, slippageBps, token, pool, tokenIsToken0]);

  const balance = side === "buy" ? ethBalance : tokenBalance;

  const problem = useMemo(() => {
    if (!amount || !(Number(amount) > 0)) return null;
    if (balance !== null) {
      const want = parseEther(amount);
      if (side === "buy" && want >= balance) return "Not enough ETH — leave a little for gas.";
      if (side === "sell" && want > balance) return `Not enough ${symbol}.`;
    }
    if (slippage !== "auto" && (slippageBps <= 0 || slippageBps > 5000)) return "Slippage must be between 0% and 50%.";
    return null;
  }, [amount, balance, side, symbol, slippage, slippageBps]);

  const canTrade = authenticated && wallet && q && !problem && !busy && !quoting;
  const impactPct = q ? q.priceImpact * 100 : 0;

  function setPercent(pct: number) {
    if (balance === null) return;
    // Keep a sliver of ETH back for gas rather than handing over a doomed transaction.
    const usable = side === "buy" ? (balance * 99n) / 100n : balance;
    setAmount(formatEther((usable * BigInt(pct)) / 100n));
  }

  async function execute() {
    if (!wallet || !q) return;
    setBusy(true);
    // One-click: the embedded wallet signs without a confirmation prompt (see main.tsx
    // showWalletUIs:false). A second factor may still be requested once per hour (MfaGate).
    const id = toast.loading(side === "buy" ? "Buying…" : "Selling…");
    try {
      const client = await getWalletClient(wallet);
      const amountIn = parseEther(amount);

      if (side === "sell") {
        const allowance = await routerAllowance(publicClient, token, wallet.address as Address);
        if (allowance < amountIn) {
          toast.loading(`Approving ${symbol}…`, { id });
          const approveHash = await approveRouter(client, publicClient, token, maxUint256);
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          toast.loading("Selling…", { id });
        }
      }

      const hash = await swap(client, publicClient, { token, side, amountIn, minOut: q.minReceived });
      toast.loading("Submitted — waiting for confirmation", { id });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");

      toast.success(side === "buy" ? `Bought ${symbol}` : `Sold ${symbol}`, {
        id,
        description:
          side === "buy"
            ? `${fmtAmount(Number(formatEther(q.amountOut)))} ${symbol}`
            : `${Number(formatEther(q.amountOut)).toFixed(6)} ETH`,
        action: { label: "View", onClick: () => window.open(explorerTx(hash), "_blank", "noopener") },
      });
      setAmount("");
      setQ(null);
      await refreshBalances();
      onTraded();
    } catch (err) {
      toast.error("Trade failed", { id, description: readableError(err) });
    } finally {
      setBusy(false);
    }
  }

  const out = q ? Number(formatEther(q.amountOut)) : 0;
  const min = q ? Number(formatEther(q.minReceived)) : 0;

  return (
    <Card className="p-4">
      <Tabs value={side} onValueChange={(v) => (setSide(v as Side), setAmount(""))}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="buy" disabled={busy} className="data-[state=active]:text-primary">
            Buy
          </TabsTrigger>
          <TabsTrigger value="sell" disabled={busy} className="data-[state=active]:text-destructive">
            Sell
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 space-y-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">{side === "buy" ? "You pay" : "You sell"}</span>
          {balance !== null && (
            <button
              className="text-xs text-muted-foreground transition-colors hover:text-primary"
              onClick={() => setPercent(100)}
            >
              Balance {side === "buy" ? Number(formatEther(balance)).toFixed(4) : fmtAmount(Number(formatEther(balance)))}
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
            className="tabular h-14 pr-20 text-2xl font-semibold"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
            {side === "buy" ? "ETH" : symbol}
          </span>
        </div>
        {ethUsd && amount && Number(amount) > 0 && side === "buy" && (
          <div className="text-xs text-muted-foreground tabular">≈ {usd(Number(amount) * ethUsd)}</div>
        )}

        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {(side === "buy" ? ETH_PRESETS : PCT_PRESETS).map((v) => (
            <Button
              key={v}
              variant="secondary"
              size="sm"
              disabled={busy || (side === "sell" && balance === null)}
              onClick={() => (side === "buy" ? setAmount(String(v)) : setPercent(v))}
              className="text-xs"
            >
              {side === "buy" ? (ethUsd ? usd(v * ethUsd) : `${v} ETH`) : `${v}%`}
            </Button>
          ))}
        </div>
      </div>

      <Separator className="my-4" />

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">You receive</span>
          <span className="tabular font-medium">
            {quoting ? "…" : q ? (side === "buy" ? `${fmtAmount(out)} ${symbol}` : `${out.toFixed(6)} ETH`) : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Minimum received</span>
          <span className="tabular text-muted-foreground">
            {q ? (side === "buy" ? `${fmtAmount(min)} ${symbol}` : `${min.toFixed(6)} ETH`) : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Price impact</span>
          <span
            className={cn(
              "tabular",
              impactPct >= 15 ? "text-destructive" : impactPct >= 5 ? "text-highlight" : "text-muted-foreground",
            )}
          >
            {q ? `${impactPct.toFixed(2)}%` : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Network fee</span>
          <span className="tabular text-muted-foreground">
            {gasEth !== null ? (ethUsd ? usd(gasEth * ethUsd) : `${gasEth.toFixed(6)} ETH`) : "—"}
          </span>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-muted-foreground">Slippage</span>
          <div className="flex items-center gap-1">
            <Button
              variant={slippage === "auto" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setSlippage("auto")}
              disabled={busy}
            >
              Auto
            </Button>
            {SLIPPAGE_PRESETS.map((bps) => (
              <Button
                key={bps}
                variant={slippage === bps ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSlippage(bps)}
                disabled={busy}
              >
                {bps / 100}%
              </Button>
            ))}
            <Input
              value={custom}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                setCustom(v);
                if (v) setSlippage(Math.round(Number(v) * 100));
              }}
              placeholder="%"
              disabled={busy}
              className="h-7 w-14 px-2 text-xs"
            />
          </div>
        </div>
      </div>

      {(quoteErr || problem) && <p className="mt-3 text-sm text-destructive">{quoteErr ?? problem}</p>}
      {q && impactPct >= 15 && (
        <p className="mt-3 text-sm text-destructive">
          This moves the price {impactPct.toFixed(1)}%. The pool is thin — try a smaller size.
        </p>
      )}

      {!authenticated ? (
        <Button className="mt-4 w-full" size="lg" onClick={login}>
          Connect wallet
        </Button>
      ) : (
        <Button
          className={cn("mt-4 w-full", side === "sell" && "bg-destructive text-white hover:bg-destructive/90")}
          size="lg"
          disabled={!canTrade}
          onClick={execute}
        >
          {busy ? "Working…" : quoting ? "Quoting…" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
        </Button>
      )}
    </Card>
  );
}

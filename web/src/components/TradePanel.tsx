import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEther, parseEther, maxUint256 } from "viem";
import type { Address } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeftRight } from "lucide-react";
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
const USD_PRESETS = [10, 50, 100, 500];
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
  // Buys can be entered in USD or ETH; this only applies to the "You pay" field on buy.
  const [payCcy, setPayCcy] = useState<"ETH" | "USD">("ETH");
  const [slippage, setSlippage] = useState<number | "auto">("auto");
  const [custom, setCustom] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gasEth, setGasEth] = useState<number | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  // Tracked here, not just inside execute(), because an unapproved sell costs two
  // transactions of gas — the fee estimate and the affordability check both need to know.
  const [allowance, setAllowance] = useState<bigint | null>(null);

  const slippageBps = slippage === "auto" ? AUTO_SLIPPAGE : slippage;
  const priceReady = ethUsd != null && ethUsd > 0;

  // The ETH amount actually traded. On buy, the field may hold USD — convert to ETH for quoting
  // and execution; on sell it is always token units. Empty string when there is nothing to quote.
  const tradeAmountStr = useMemo(() => {
    if (side === "sell") return amount;
    if (payCcy === "USD" && priceReady) {
      const eth = Number(amount) / (ethUsd as number);
      return Number.isFinite(eth) && eth > 0 ? eth.toFixed(18) : "";
    }
    return amount;
  }, [amount, side, payCcy, priceReady, ethUsd]);

  function togglePayCcy() {
    if (!priceReady) return;
    const n = Number(amount);
    if (amount && n > 0) {
      setAmount(payCcy === "ETH" ? (n * (ethUsd as number)).toFixed(2) : (n / (ethUsd as number)).toFixed(6));
    }
    setPayCcy((p) => (p === "ETH" ? "USD" : "ETH"));
  }

  const refreshBalances = useCallback(async () => {
    if (!wallet) return setEthBalance(null), setTokenBalance(null), setAllowance(null);
    const addr = wallet.address as Address;
    const [eth, tok, allow] = await Promise.all([
      publicClient.getBalance({ address: addr }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
      routerAllowance(publicClient, token, addr),
    ]);
    setEthBalance(eth);
    setTokenBalance(tok as bigint);
    setAllowance(allow);
  }, [wallet, token]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  // Debounced quoting; the ref stops a slow response overwriting a newer one.
  const seq = useRef(0);
  useEffect(() => {
    if (!tradeAmountStr || !(Number(tradeAmountStr) > 0)) {
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
          amountIn: parseEther(tradeAmountStr),
          slippageBps,
        });
        if (mine !== seq.current) return;
        setQ(result);
        setQuoteErr(null);
        const gasPrice = await publicClient.getGasPrice();
        // A sell that still needs an ERC-20 approval is two transactions, not one. Quoting
        // only the swap understates the fee and, worse, understates what the wallet must
        // hold — which is the whole point of the affordability check below.
        const needsApproval = side === "sell" && allowance !== null && allowance < parseEther(tradeAmountStr);
        const gasUnits = side === "buy" ? 220_000n : needsApproval ? 320_000n : 260_000n;
        if (mine === seq.current) setGasEth(Number(formatEther(gasPrice * gasUnits)));
      } catch (err) {
        if (mine !== seq.current) return;
        setQ(null);
        setQuoteErr(readableError(err));
      } finally {
        if (mine === seq.current) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [tradeAmountStr, side, slippageBps, token, pool, tokenIsToken0, allowance]);

  const balance = side === "buy" ? ethBalance : tokenBalance;

  const problem = useMemo(() => {
    if (!tradeAmountStr || !(Number(tradeAmountStr) > 0)) return null;
    if (balance !== null) {
      const want = parseEther(tradeAmountStr);
      if (side === "buy" && want >= balance) return "Not enough ETH — leave a little for gas.";
      if (side === "sell" && want > balance) return `Not enough ${symbol}.`;
    }
    if (slippage !== "auto" && (slippageBps <= 0 || slippageBps > 5000)) return "Slippage must be between 0% and 50%.";
    // A sell PAYS OUT ETH but still COSTS ETH to send, so the buy-side check above misses
    // it entirely: a wallet holding only tokens got a green Sell button and found out at
    // signing time, as a bare "execution reverted". Check the gas the trade actually needs
    // against what the wallet actually holds, and say the numbers out loud.
    if (ethBalance !== null && gasEth !== null && gasEth > 0) {
      const gasCost = parseEther(gasEth.toFixed(18));
      const spending = side === "buy" ? parseEther(tradeAmountStr) : 0n;
      if (ethBalance < spending + gasCost) {
        return `Not enough ETH for gas — this needs about ${gasEth.toFixed(6)} ETH and this wallet holds ${Number(formatEther(ethBalance)).toFixed(6)}.`;
      }
    }
    return null;
  }, [tradeAmountStr, balance, side, symbol, slippage, slippageBps, ethBalance, gasEth]);

  const canTrade = authenticated && wallet && q && !problem && !busy && !quoting;
  const impactPct = q ? q.priceImpact * 100 : 0;

  function setPercent(pct: number) {
    if (balance === null) return;
    // Keep a sliver of ETH back for gas rather than handing over a doomed transaction.
    const usable = side === "buy" ? (balance * 99n) / 100n : balance;
    const slice = (usable * BigInt(pct)) / 100n;
    // In USD buy mode the field holds dollars, so convert the ETH slice to its USD value.
    if (side === "buy" && payCcy === "USD" && priceReady) {
      setAmount((Number(formatEther(slice)) * (ethUsd as number)).toFixed(2));
      return;
    }
    // formatEther straight off the bigint. The old Number(...) round-trip here truncated an
    // 18-decimal balance to ~16 significant digits, so "Sell 100%" of a balance with dust
    // could round UP past what you actually hold — and a dust-sized balance came back in
    // exponential notation ("1e-16"), which parseEther cannot read at all.
    setAmount(formatEther(slice));
  }

  async function execute() {
    if (!wallet || !q) return;
    setBusy(true);
    // One-click: the embedded wallet signs without a confirmation prompt (see main.tsx
    // showWalletUIs:false). A second factor may still be requested once per hour (MfaGate).
    const id = toast.loading(side === "buy" ? "Buying…" : "Selling…");
    try {
      const client = await getWalletClient(wallet);
      const amountIn = parseEther(tradeAmountStr);

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
            aria-label={side === "buy" ? "Amount to pay" : `Amount of ${symbol} to sell`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            disabled={busy}
            className="tabular h-14 pr-20 text-2xl font-semibold"
          />
          {side === "buy" ? (
            <button
              type="button"
              onClick={togglePayCcy}
              disabled={busy || !priceReady}
              title="Switch between USD and ETH"
              className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              {payCcy}
              <ArrowLeftRight className="size-3" aria-hidden />
            </button>
          ) : (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
              {symbol}
            </span>
          )}
        </div>
        {side === "buy" && priceReady && amount && Number(amount) > 0 && (
          <div className="text-xs text-muted-foreground tabular">
            ≈{" "}
            {payCcy === "USD"
              ? `${(Number(amount) / (ethUsd as number)).toFixed(6)} ETH`
              : usd(Number(amount) * (ethUsd as number))}
          </div>
        )}

        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {(side === "buy" ? (payCcy === "USD" ? USD_PRESETS : ETH_PRESETS) : PCT_PRESETS).map((v) => (
            <Button
              key={v}
              variant="secondary"
              size="sm"
              disabled={busy || (side === "sell" && balance === null)}
              onClick={() => (side === "buy" ? setAmount(String(v)) : setPercent(v))}
              className="text-xs"
            >
              {side === "buy" ? (payCcy === "USD" ? `$${v}` : ethUsd ? usd(v * ethUsd) : `${v} ETH`) : `${v}%`}
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

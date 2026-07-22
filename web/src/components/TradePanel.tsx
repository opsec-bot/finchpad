import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEther, parseEther, maxUint256 } from "viem";
import type { Address } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { useActiveWallet } from "./Wallet";
import { useToast } from "./Toast";
import { explorerTx } from "../lib/chain";
import { erc20Abi } from "../lib/abis";
import { getWalletClient, publicClient } from "../lib/tx";
import { approveRouter, quote, readableError, routerAllowance, swap } from "../lib/trade";
import type { Quote, Side } from "../lib/trade";

const SLIPPAGE_PRESETS = [50, 100, 300]; // bps
const AUTO_SLIPPAGE = 100; // bps — what "Auto" resolves to for a 1% pool
const QUOTE_DEBOUNCE_MS = 350;

const fmt = (n: number, d = 4) => n.toLocaleString(undefined, { maximumFractionDigits: d });
const compact = (n: number) => (n >= 1e6 ? `${fmt(n / 1e6, 2)}M` : n >= 1e3 ? `${fmt(n / 1e3, 2)}k` : fmt(n, 4));

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
  const toast = useToast();

  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number | "auto">("auto");
  const [customSlippage, setCustomSlippage] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gasEth, setGasEth] = useState<number | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);

  const slippageBps = slippage === "auto" ? AUTO_SLIPPAGE : slippage;

  const refreshBalances = useCallback(async () => {
    if (!wallet) {
      setEthBalance(null);
      setTokenBalance(null);
      return;
    }
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

  // Debounced quoting. A ref guards against a slow response overwriting a newer one.
  const seq = useRef(0);
  useEffect(() => {
    const parsed = Number(amount);
    if (!amount || !(parsed > 0)) {
      setQ(null);
      setQuoteErr(null);
      setGasEth(null);
      return;
    }
    const mine = ++seq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const amountIn = parseEther(amount);
        const result = await quote(publicClient, { token, pool, tokenIsToken0, side, amountIn, slippageBps });
        if (mine !== seq.current) return;
        setQ(result);
        setQuoteErr(null);
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

  // Network fee estimate, refreshed alongside the quote.
  useEffect(() => {
    if (!q || !wallet) return setGasEth(null);
    let cancelled = false;
    (async () => {
      try {
        const gasPrice = await publicClient.getGasPrice();
        // Swaps on a fresh V3 pool land around 150-250k; use a representative figure rather
        // than a full estimateGas, which would need an approval that may not exist yet.
        const units = side === "buy" ? 220_000n : 260_000n;
        if (!cancelled) setGasEth(Number(formatEther(gasPrice * units)));
      } catch {
        if (!cancelled) setGasEth(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q, wallet, side]);

  const balance = side === "buy" ? ethBalance : tokenBalance;
  const balanceLabel = side === "buy" ? "ETH" : symbol;

  const problems = useMemo(() => {
    const p: string[] = [];
    const parsed = Number(amount);
    if (amount && !(parsed > 0)) p.push("Enter an amount greater than zero.");
    if (amount && parsed > 0 && balance !== null) {
      const want = parseEther(amount || "0");
      if (side === "buy" && want >= balance) p.push("Amount exceeds your ETH balance (leave room for gas).");
      if (side === "sell" && want > balance) p.push(`Amount exceeds your ${symbol} balance.`);
    }
    if (slippage !== "auto" && (slippageBps <= 0 || slippageBps > 5000)) p.push("Slippage must be between 0% and 50%.");
    return p;
  }, [amount, balance, side, symbol, slippage, slippageBps]);

  const canTrade = authenticated && wallet && q && problems.length === 0 && !busy && !quoting;

  function setPercent(pct: number) {
    if (balance === null) return;
    // On a buy, keep a little ETH back for gas rather than handing over a doomed transaction.
    const usable = side === "buy" ? (balance * 99n) / 100n : balance;
    setAmount(formatEther((usable * BigInt(pct)) / 100n));
  }

  async function execute() {
    if (!wallet || !q) return;
    setBusy(true);
    const pendingId = toast.push({ kind: "pending", title: side === "buy" ? "Buying" : "Selling", body: "Confirm in your wallet" });
    try {
      const client = await getWalletClient(wallet);
      const amountIn = parseEther(amount);

      if (side === "sell") {
        const allowance = await routerAllowance(publicClient, token, wallet.address as Address);
        if (allowance < amountIn) {
          toast.update(pendingId, { title: "Approval needed", body: `Allow the router to spend ${symbol}` });
          const approveHash = await approveRouter(client, publicClient, token, maxUint256);
          toast.update(pendingId, { title: "Approving", body: "Waiting for confirmation" });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      toast.update(pendingId, { title: side === "buy" ? "Buying" : "Selling", body: "Confirm in your wallet" });
      const hash = await swap(client, publicClient, { token, side, amountIn, minOut: q.minReceived });

      toast.update(pendingId, { title: "Submitted", body: "Waiting for confirmation", href: explorerTx(hash) });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");

      toast.update(pendingId, {
        kind: "success",
        title: side === "buy" ? `Bought ${symbol}` : `Sold ${symbol}`,
        body:
          side === "buy"
            ? `~${compact(Number(formatEther(q.amountOut)))} ${symbol} for ${fmt(Number(amount), 6)} ETH`
            : `~${fmt(Number(formatEther(q.amountOut)), 6)} ETH for ${compact(Number(amount))} ${symbol}`,
        href: explorerTx(hash),
      });
      setAmount("");
      setQ(null);
      await refreshBalances();
      onTraded();
    } catch (err) {
      toast.update(pendingId, { kind: "error", title: "Trade failed", body: readableError(err) });
    } finally {
      setBusy(false);
    }
  }

  const impactPct = q ? q.priceImpact * 100 : 0;
  const impactClass = impactPct >= 15 ? "warn" : impactPct >= 5 ? "caution" : "dim";

  return (
    <div className="panel">
      <div className="tabs">
        <button className={side === "buy" ? "tab active buy" : "tab"} onClick={() => { setSide("buy"); setAmount(""); }} disabled={busy}>
          buy
        </button>
        <button className={side === "sell" ? "tab active sell" : "tab"} onClick={() => { setSide("sell"); setAmount(""); }} disabled={busy}>
          sell
        </button>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>
          {side === "buy" ? "you pay (ETH)" : `you sell (${symbol})`}
          {balance !== null && (
            <span className="spacer-inline dim">
              balance {side === "buy" ? fmt(Number(formatEther(balance)), 4) : compact(Number(formatEther(balance)))}{" "}
              {balanceLabel}
            </span>
          )}
        </label>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0.0"
          disabled={busy}
        />
        <div className="pcts">
          {(side === "buy" ? [0.01, 0.1, 0.5, 1] : [25, 50, 75, 100]).map((v) =>
            side === "buy" ? (
              <button key={v} onClick={() => setAmount(String(v))} disabled={busy}>
                {v} ETH
              </button>
            ) : (
              <button key={v} onClick={() => setPercent(v)} disabled={busy || balance === null}>
                {v}%
              </button>
            ),
          )}
        </div>
      </div>

      <div className="field">
        <label>slippage tolerance</label>
        <div className="pcts">
          <button className={slippage === "auto" ? "sel" : ""} onClick={() => setSlippage("auto")} disabled={busy}>
            auto
          </button>
          {SLIPPAGE_PRESETS.map((bps) => (
            <button key={bps} className={slippage === bps ? "sel" : ""} onClick={() => setSlippage(bps)} disabled={busy}>
              {bps / 100}%
            </button>
          ))}
          <input
            className="slip"
            inputMode="decimal"
            placeholder="custom"
            value={customSlippage}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              setCustomSlippage(v);
              if (v) setSlippage(Math.round(Number(v) * 100));
            }}
            disabled={busy}
          />
        </div>
      </div>

      <div className="review">
        <div className="kv mono">
          <div>you receive</div>
          <div>
            {quoting ? (
              <span className="dim">quoting…</span>
            ) : q ? (
              side === "buy" ? (
                `${compact(Number(formatEther(q.amountOut)))} ${symbol}`
              ) : (
                `${fmt(Number(formatEther(q.amountOut)), 6)} ETH`
              )
            ) : (
              <span className="dim">—</span>
            )}
          </div>
          <div>minimum received</div>
          <div>
            {q ? (
              side === "buy" ? (
                `${compact(Number(formatEther(q.minReceived)))} ${symbol}`
              ) : (
                `${fmt(Number(formatEther(q.minReceived)), 6)} ETH`
              )
            ) : (
              <span className="dim">—</span>
            )}
            {q && <span className="dim"> @ {slippageBps / 100}%</span>}
          </div>
          <div>price impact</div>
          <div className={q ? impactClass : "dim"}>
            {q ? `${fmt(impactPct, 2)}%` : "—"}
            {q && impactPct >= 15 && " — very high"}
          </div>
          <div>network fee</div>
          <div>{gasEth !== null ? `~${fmt(gasEth, 6)} ETH` : <span className="dim">—</span>}</div>
        </div>
      </div>

      {quoteErr && <p className="warn">{quoteErr}</p>}
      {problems.map((p) => (
        <p key={p} className="warn">
          {p}
        </p>
      ))}
      {q && impactPct >= 15 && (
        <p className="warn">
          This trade moves the price by {fmt(impactPct, 1)}%. The pool is thin — consider a smaller size.
        </p>
      )}

      {!authenticated ? (
        <button className="primary wide" onClick={login}>
          connect wallet to trade
        </button>
      ) : (
        <button className={`primary wide ${side}`} disabled={!canTrade} onClick={execute}>
          {busy ? "working…" : quoting ? "quoting…" : side === "buy" ? `buy ${symbol}` : `sell ${symbol}`}
        </button>
      )}
    </div>
  );
}

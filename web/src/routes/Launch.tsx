import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { formatEther, parseEther, zeroAddress } from "viem";
import type { Address } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { useActiveWallet } from "../components/Wallet";
import { addresses, explorerTx } from "../lib/chain";
import { ClaimKind, finchFactoryAbi } from "../lib/abis";
import { getLaunchConfig, CURVE_A } from "../lib/launchCurve";
import { getWalletClient, predictTokenAddress, publicClient } from "../lib/tx";
import { useEthUsd, usd } from "../lib/money";
import GithubBinding from "../components/GithubBinding";
import LogoPicker from "../components/LogoPicker";

const LAUNCH_FEE = parseEther("0.0005");

type Status = { kind: "idle" | "working" | "done" | "error"; msg?: string; hash?: string; token?: string };

export default function Launch({ onLaunched }: { onLaunched: (token: string) => void }) {
  const { authenticated, login } = usePrivy();
  const wallet = useActiveWallet();
  const ethUsd = useEthUsd();
  const [f, setF] = useState({
    name: "",
    symbol: "",
    logo: "",
    description: "",
    twitter: "",
    telegram: "",
    website: "",
    bind: "none" as "none" | "repo" | "user",
    githubHandle: "",
    referrer: "",
    feeWallet: "",
    creatorBuy: "",
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [githubId, setGithubId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const set =
    (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setF((prev) => ({ ...prev, [k]: e.target.value }));

  const configured = addresses.factory !== "";
  // Fixed, not a field. Every launchpad pins the opening curve so tokens are comparable and
  // creators cannot misprice themselves; exposing it was a footgun with no upside.
  const startMcap = CURVE_A.startMcapEth;

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!f.name.trim()) p.push("name is required");
    if (!f.symbol.trim()) p.push("symbol is required");
    if (f.bind !== "none" && !githubId) p.push(f.bind === "repo" ? "enter a repo as owner/name" : "enter a GitHub username");
    if (f.referrer && !/^0x[a-fA-F0-9]{40}$/.test(f.referrer)) p.push("referrer must be a 0x address");
    if (f.referrer && wallet && f.referrer.toLowerCase() === wallet.address.toLowerCase())
      p.push("you cannot refer yourself; the factory rejects it");
    if (f.feeWallet && !/^0x[a-fA-F0-9]{40}$/.test(f.feeWallet)) p.push("fee recipient must be a 0x address");
    if (f.creatorBuy && !(Number(f.creatorBuy) >= 0)) p.push("opening buy must be a positive amount");
    return p;
  }, [f, wallet, githubId]);

  async function onLaunch() {
    if (!wallet) return;
    setStatus({ kind: "working", msg: "preparing" });
    try {
      const factory = addresses.factory as Address;
      // Predicted at submit time, deliberately. See predictTokenAddress() for the race.
      const predicted = await predictTokenAddress(factory);
      const curve = getLaunchConfig({
        tokenAddress: predicted,
        wethAddress: addresses.weth,
        startMcapEth: startMcap,
      });

      const params = {
        name: f.name.trim(),
        symbol: f.symbol.trim().toUpperCase(),
        logo: f.logo.trim(),
        description: f.description.trim(),
        socials: {
          twitter: f.twitter.trim(),
          telegram: f.telegram.trim(),
          discord: "",
          website: f.website.trim(),
          farcaster: "",
        },
        claimKind: f.bind === "none" ? ClaimKind.None : f.bind === "repo" ? ClaimKind.Repo : ClaimKind.User,
        githubId: f.bind === "none" ? 0n : BigInt(githubId!),
        referrer: (f.referrer || zeroAddress) as Address,
        feeWallet: (f.feeWallet || zeroAddress) as Address,
        creatorBuyAmount: f.creatorBuy ? parseEther(f.creatorBuy) : 0n,
        initialSqrtPriceX96: curve.initialSqrtPriceX96,
        tickLower: curve.tickLower,
        tickUpper: curve.tickUpper,
      };

      // Simulate first: a revert here costs nothing and catches the address-prediction race
      // before the user is asked to sign anything.
      setStatus({ kind: "working", msg: "simulating" });
      const { request } = await publicClient.simulateContract({
        address: factory,
        abi: finchFactoryAbi,
        functionName: "launch",
        args: [params],
        value: LAUNCH_FEE + (f.creatorBuy ? parseEther(f.creatorBuy) : 0n),
        account: wallet.address as Address,
      });

      setStatus({ kind: "working", msg: "confirm in your wallet" });
      const client = await getWalletClient(wallet);
      const hash = await client.writeContract(request);

      setStatus({ kind: "working", msg: "waiting for confirmation", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("transaction reverted");

      setStatus({ kind: "done", hash, token: predicted, msg: "launched" });
      onLaunched(predicted);
    } catch (err) {
      const raw =
        (err as { shortMessage?: string }).shortMessage ?? (err as Error).message ?? "failed";
      setStatus({
        kind: "error",
        msg: /NoLiquidityMinted/i.test(raw)
          ? "Another launch landed first, so the predicted token address shifted. Nothing was spent beyond gas. Press launch again."
          : raw,
      });
    }
  }

  if (!configured) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <strong>launch a token</strong>
        <p className="text-muted-foreground">
          No factory address configured. Set <code>VITE_FINCH_FACTORY</code> in{" "}
          <code>web/.env.local</code>. Run <code>npm run dev:fork</code> then{" "}
          <code>npm run dev:seed</code> to get a local deployment to point at.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <strong>launch a token</strong>
      <p className="text-muted-foreground">
        One transaction: deploys the token, creates its Uniswap V3 pool, and deposits the whole
        supply as locked liquidity. Liquidity is locked permanently and cannot be pulled.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="mb-3">
          <label>name</label>
          <input value={f.name} onChange={set("name")} placeholder="Finch Genesis" maxLength={32} />
        </div>
        <div className="mb-3">
          <label>symbol</label>
          <input value={f.symbol} onChange={set("symbol")} placeholder="GENESIS" maxLength={10} />
        </div>
      </div>
      <div className="mb-3">
        <label>
          description
          <span className="float-right text-xs text-muted-foreground">{f.description.length}/256</span>
        </label>
        <input value={f.description} onChange={set("description")} maxLength={256} />
      </div>
      <div className="mb-3">
        <label>token image</label>
        <LogoPicker value={f.logo} onChange={(v) => setF((p) => ({ ...p, logo: v }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="mb-3">
          <label>X profile</label>
          <div className="flex items-center gap-0 rounded-md border border-input bg-transparent pl-3 focus-within:ring-1 focus-within:ring-ring">
            <span className="text-muted-foreground">x.com/</span>
            <input value={f.twitter} onChange={set("twitter")} placeholder="handle" />
          </div>
        </div>
        <div className="mb-3">
          <label>telegram</label>
          <div className="flex items-center gap-0 rounded-md border border-input bg-transparent pl-3 focus-within:ring-1 focus-within:ring-ring">
            <span className="text-muted-foreground">t.me/</span>
            <input value={f.telegram} onChange={set("telegram")} placeholder="community" />
          </div>
        </div>
        <div className="mb-3">
          <label>website</label>
          <input value={f.website} onChange={set("website")} />
        </div>
      </div>

      <button type="button" className="mb-3 w-full rounded-md py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground" onClick={() => setAdvanced((v) => !v)}>
        {advanced ? "▾" : "▸"} advanced
      </button>

      <div style={{ display: advanced ? "block" : "none" }}>
        <div className="mb-3">
          <label>fee rights</label>
          <select value={f.bind} onChange={set("bind")}>
            <option value="none">mine, I keep the fees</option>
            <option value="repo">a GitHub repo, its admin claims</option>
            <option value="user">a GitHub user, that account claims</option>
          </select>
        </div>

      {f.bind !== "none" && (
        <div className="mb-3">
          <label>{f.bind === "repo" ? "repository" : "github username"}</label>
          <div className="flex items-center gap-0 rounded-md border border-input bg-transparent pl-3 focus-within:ring-1 focus-within:ring-ring">
            <span className="text-muted-foreground">github.com/</span>
            <input
              value={f.githubHandle}
              onChange={set("githubHandle")}
              placeholder={f.bind === "repo" ? "owner/name" : "username"}
            />
          </div>
          <GithubBinding kind={f.bind} value={f.githubHandle} onResolved={setGithubId} />
          <p className="text-muted-foreground" style={{ marginTop: 6 }}>
            You earn nothing from this token — fees escrow until that GitHub {f.bind} claims them.
            The token stores the account's permanent numeric id, not the name, so a rename or a
            freed username cannot hand your fees to someone else.
          </p>
        </div>
      )}

      {f.bind === "none" && (
        <div className="mb-3">
          <label>
            fee recipient (optional)
            <span className="float-right text-xs text-muted-foreground">defaults to you</span>
          </label>
          <input value={f.feeWallet} onChange={set("feeWallet")} placeholder="0x — any wallet you choose" />
          <p className="text-muted-foreground" style={{ marginTop: 6 }}>
            Where the creator share of trading fees is paid, fixed at launch. You keep control of
            the token either way.
          </p>
        </div>
      )}

      <div className="mb-3">
        <label>
          opening buy (optional)
          {ethUsd && f.creatorBuy ? (
            <span className="float-right text-xs text-muted-foreground">{usd(Number(f.creatorBuy) * ethUsd)}</span>
          ) : null}
        </label>
        <input value={f.creatorBuy} onChange={set("creatorBuy")} placeholder="0.0 ETH" inputMode="decimal" />
        <p className="text-muted-foreground" style={{ marginTop: 6 }}>
          Buy your own token in the same transaction, at the normal pool price through the public
          router — no discount and no reserved allocation. Without it you cannot be the first
          buyer: a separate transaction lands a block later, where anyone watching can get ahead
          of you.
        </p>
      </div>

        <div className="mb-3">
          <label>referrer (optional)</label>
          <input value={f.referrer} onChange={set("referrer")} placeholder="0x, paid out of the protocol share" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-secondary/40 p-3">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm tabular">
          <div>supply</div>
          <div>{CURVE_A.totalSupply.toLocaleString()} fixed, no mint function</div>
          <div>opening valuation</div>
          <div>{ethUsd ? `${usd(startMcap * ethUsd)} (${startMcap} ETH)` : `${startMcap} ETH`}</div>
          <div>graduation at</div>
          <div>{CURVE_A.graduationEth} Ξ paired</div>
          <div>launch fee</div>
          <div>
            {formatEther(LAUNCH_FEE)} ETH
            {ethUsd ? ` (${usd(Number(formatEther(LAUNCH_FEE)) * ethUsd)})` : ""}
          </div>
          <div>liquidity</div>
          <div>100% locked, permanently</div>
          <div>opening buy</div>
          <div>
            {f.creatorBuy && Number(f.creatorBuy) > 0
              ? `${f.creatorBuy} ETH at pool price${ethUsd ? ` (${usd(Number(f.creatorBuy) * ethUsd)})` : ""}`
              : "none"}
          </div>
          <div>fees paid to</div>
          <div>{f.bind !== "none" ? "escrow, until the GitHub owner claims" : f.feeWallet || "you"}</div>
          <div>your fee share</div>
          <div>{f.bind === "none" ? "80% of trading fees" : "none, escrowed for the GitHub owner"}</div>
        </div>
      </div>

      {problems.length > 0 && (
        <ul className="text-destructive text-sm">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        {!authenticated ? (
          <button className="primary" onClick={login}>
            connect wallet to launch
          </button>
        ) : (
          <button
            className="primary"
            disabled={problems.length > 0 || status.kind === "working"}
            onClick={onLaunch}
          >
            {status.kind === "working" ? "working" : `launch for ${formatEther(LAUNCH_FEE)} ETH`}
          </button>
        )}
        {status.msg && (
          <span className={status.kind === "error" ? "warn" : status.kind === "done" ? "ok" : "dim"}>
            {status.msg}
          </span>
        )}
      </div>

      {status.hash && (
        <p className="text-muted-foreground" style={{ marginTop: 8 }}>
          <a href={explorerTx(status.hash)} target="_blank" rel="noreferrer noopener">
            view transaction
          </a>
          {status.token ? <> · token <span className="tabular">{status.token}</span></> : null}
        </p>
      )}
    </div>
  );
}

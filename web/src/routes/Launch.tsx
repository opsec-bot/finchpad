import { useMemo, useState } from "react";
import { formatEther, parseEther, zeroAddress } from "viem";
import type { Address } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import {
  ChevronLeft,
  ChevronDown,
  Coins,
  GitBranch,
  Info,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useActiveWallet } from "@/components/Wallet";
import { addresses, explorerTx } from "@/lib/chain";
import { ClaimKind, finchFactoryAbi } from "@/lib/abis";
import { getLaunchConfig, CURVE_A } from "@/lib/launchCurve";
import { getWalletClient, predictTokenAddress, publicClient } from "@/lib/tx";
import { useEthUsd, usd } from "@/lib/money";
import GithubBinding from "@/components/GithubBinding";
import LogoPicker from "@/components/LogoPicker";
import LaunchPreview from "@/components/LaunchPreview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const LAUNCH_FEE = parseEther("0.0005");

type Status = { kind: "idle" | "working" | "done" | "error"; msg?: string; hash?: string; token?: string };
type Bind = "none" | "repo" | "user";

const FIXED_FACTS = [
  { icon: Coins, label: `${CURVE_A.totalSupply.toLocaleString()} fixed supply`, detail: "No mint function exists." },
  { icon: Lock, label: "Liquidity permanently locked", detail: "The LP position is held by the locker." },
  { icon: ShieldCheck, label: "Same starting valuation", detail: "Identical for every launch." },
];

export default function Launch({
  onLaunched,
  onCancel,
}: {
  onLaunched: (token: string) => void;
  onCancel: () => void;
}) {
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
    bind: "none" as Bind,
    githubHandle: "",
    referrer: "",
    feeWallet: "",
    creatorBuy: "",
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [githubId, setGithubId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const upd = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const configured = addresses.factory !== "";
  // Fixed, not a field. Every launchpad pins the opening curve so tokens are comparable and
  // creators cannot misprice themselves; exposing it was a footgun with no upside.
  const startMcap = CURVE_A.startMcapEth;
  const opening = Number.parseFloat(f.creatorBuy) || 0;
  const total = Number(formatEther(LAUNCH_FEE)) + opening;
  const githubBound = f.bind !== "none";

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!f.name.trim()) p.push("name is required");
    if (!f.symbol.trim()) p.push("symbol is required");
    if (githubBound && !githubId) p.push(f.bind === "repo" ? "enter a repo as owner/name" : "enter a GitHub username");
    if (f.referrer && !/^0x[a-fA-F0-9]{40}$/.test(f.referrer)) p.push("referrer must be a 0x address");
    if (f.referrer && wallet && f.referrer.toLowerCase() === wallet.address.toLowerCase())
      p.push("you cannot refer yourself; the factory rejects it");
    if (f.feeWallet && !/^0x[a-fA-F0-9]{40}$/.test(f.feeWallet)) p.push("fee recipient must be a 0x address");
    if (f.creatorBuy && !(Number(f.creatorBuy) >= 0)) p.push("opening buy must be a positive amount");
    return p;
  }, [f, wallet, githubId, githubBound]);

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
      const raw = (err as { shortMessage?: string }).shortMessage ?? (err as Error).message ?? "failed";
      setStatus({
        kind: "error",
        msg: /NoLiquidityMinted/i.test(raw)
          ? "Another launch landed first, so the predicted token address shifted. Nothing was spent beyond gas. Press launch again."
          : raw,
      });
    }
  }

  const working = status.kind === "working";
  const canLaunch = authenticated && problems.length === 0 && !working;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <button
        type="button"
        onClick={onCancel}
        className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to explore
      </button>

      <div className="mb-6 flex flex-col gap-1.5">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">Launch a token</h1>
        <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          Every token launches with the same fixed supply, the same starting valuation, and liquidity that locks
          automatically. One transaction deploys the token, creates its Uniswap V3 pool, and deposits the whole
          supply as locked liquidity.
        </p>
      </div>

      {!configured ? (
        <Card className="p-5">
          <CardTitle>Factory not configured</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            No factory address configured. Set <code>VITE_FINCH_FACTORY</code> in <code>web/.env.local</code>. Run{" "}
            <code>npm run dev:fork</code> then <code>npm run dev:seed</code> to get a local deployment to point at.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Form column */}
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Token details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <LogoPicker value={f.logo} onChange={(v) => setF((p) => ({ ...p, logo: v }))} />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    id="name"
                    label="Name"
                    count={`${f.name.length}/32`}
                    value={f.name}
                    onChange={(v) => upd("name", v.slice(0, 32))}
                    placeholder="Finch Genesis"
                  />
                  <Field
                    id="symbol"
                    label="Ticker"
                    count={`${f.symbol.length}/10`}
                    value={f.symbol}
                    onChange={(v) => upd("symbol", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
                    placeholder="GENESIS"
                    prefix="$"
                    mono
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="description">Description</Label>
                    <span className="tnum text-xs text-muted-foreground">{f.description.length}/256</span>
                  </div>
                  <textarea
                    id="description"
                    value={f.description}
                    onChange={(e) => upd("description", e.target.value.slice(0, 256))}
                    placeholder="What is this token about?"
                    rows={3}
                    className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field id="x" label="X" value={f.twitter} onChange={(v) => upd("twitter", v)} placeholder="@handle" optional />
                  <Field
                    id="telegram"
                    label="Telegram"
                    value={f.telegram}
                    onChange={(v) => upd("telegram", v)}
                    placeholder="t.me/…"
                    optional
                  />
                  <Field
                    id="website"
                    label="Website"
                    value={f.website}
                    onChange={(v) => upd("website", v)}
                    placeholder="https://"
                    optional
                  />
                </div>
              </CardContent>
            </Card>

            {/* Advanced */}
            <Card className="p-0">
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex w-full items-center justify-between px-6 py-4 text-left">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold">Advanced</span>
                      <span className="text-xs text-muted-foreground">Fee routing, opening buy, and referral</span>
                    </div>
                    <ChevronDown
                      className={cn("size-4 text-muted-foreground transition-transform", advancedOpen && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-col gap-5 px-6 pb-6">
                    <Separator />
                    {/* Fee recipient */}
                    <div className="flex flex-col gap-2">
                      <Label>Who receives trading fees?</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            { value: "none", label: "Me" },
                            { value: "repo", label: "GitHub repo" },
                            { value: "user", label: "GitHub user" },
                          ] as const
                        ).map((opt) => (
                          <Button
                            key={opt.value}
                            variant={f.bind === opt.value ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => setF((p) => ({ ...p, bind: opt.value, githubHandle: "" }))}
                            className={cn(f.bind === opt.value && "border-primary/40")}
                          >
                            {opt.value !== "none" && <GitBranch className="size-3.5" aria-hidden />}
                            {opt.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {githubBound && (
                      <div className="flex flex-col gap-3">
                        <Field
                          id="github"
                          label={f.bind === "repo" ? "Repository" : "Username"}
                          value={f.githubHandle}
                          onChange={(v) => upd("githubHandle", v)}
                          placeholder={f.bind === "repo" ? "owner/name" : "username"}
                          mono
                        />
                        <GithubBinding kind={f.bind === "repo" ? "repo" : "user"} value={f.githubHandle} onResolved={setGithubId} />
                        <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3">
                          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                          <div className="flex flex-col gap-0.5 text-xs leading-relaxed">
                            <span className="font-medium text-foreground">Fees are assigned to a GitHub account</span>
                            <span className="text-muted-foreground">
                              You earn nothing from this launch. All creator fees are held in escrow until{" "}
                              <span className="font-medium text-foreground">{f.githubHandle || "the account"}</span> verifies
                              ownership and claims them. The token stores the account's permanent numeric id, so a rename
                              cannot hand your fees to someone else.
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {f.bind === "none" && (
                      <Field
                        id="feeWallet"
                        label="Fee-recipient wallet"
                        value={f.feeWallet}
                        onChange={(v) => upd("feeWallet", v)}
                        placeholder="Defaults to your wallet"
                        mono
                        optional
                      />
                    )}

                    <Field
                      id="openingBuy"
                      label="Opening buy"
                      value={f.creatorBuy}
                      onChange={(v) => upd("creatorBuy", v.replace(/[^0-9.]/g, ""))}
                      placeholder="0.0"
                      suffix="ETH"
                      mono
                      optional
                      hint={
                        ethUsd && opening > 0
                          ? `${usd(opening * ethUsd)} · bought at pool price in the same transaction`
                          : "Buy your own token in the same transaction, at the normal pool price — no discount, no reserved allocation."
                      }
                    />
                    <Field
                      id="referrer"
                      label="Referrer"
                      value={f.referrer}
                      onChange={(v) => upd("referrer", v)}
                      placeholder="0x…"
                      mono
                      optional
                      hint="Paid out of the protocol share on every trade. You cannot refer yourself."
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </div>

          {/* Sticky preview + summary */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</span>
              <LaunchPreview name={f.name} ticker={f.symbol} image={f.logo || null} startMcapEth={startMcap} />
            </div>

            <Card className="gap-0 p-0">
              <div className="flex flex-col gap-2.5 px-4 py-4">
                {FIXED_FACTS.map((fact) => (
                  <div key={fact.label} className="flex items-start gap-2.5">
                    <fact.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium leading-tight">{fact.label}</span>
                      <span className="text-[11px] text-muted-foreground">{fact.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="flex flex-col gap-2 px-4 py-4">
                <SummaryLine label="Opening valuation" value={ethUsd ? `${usd(startMcap * ethUsd)} (${startMcap} ETH)` : `${startMcap} ETH`} />
                <SummaryLine label="Graduation at" value={`${CURVE_A.graduationEth} ETH paired`} />
                <SummaryLine label="Launch fee" value={`${formatEther(LAUNCH_FEE)} ETH`} />
                <SummaryLine label="Opening buy" value={opening > 0 ? `${opening} ETH` : "—"} />
                <SummaryLine label="Creator / protocol" value="80% / 20%" />
                <SummaryLine
                  label="Fees paid to"
                  value={githubBound ? "escrow, until claimed" : f.feeWallet ? "custom wallet" : "you"}
                />
                <Separator className="my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">You&apos;ll pay</span>
                  <span className="tnum text-base font-semibold">
                    {total.toFixed(4)} ETH{ethUsd ? ` (${usd(total * ethUsd)})` : ""}
                  </span>
                </div>
              </div>

              {problems.length > 0 && (
                <ul className="mx-4 mb-3 list-inside list-disc rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}

              <div className="px-4 pb-4">
                {!authenticated ? (
                  <Button size="lg" className="h-11 w-full" onClick={login}>
                    Connect wallet to launch
                  </Button>
                ) : (
                  <Button size="lg" className="h-11 w-full" disabled={!canLaunch} onClick={onLaunch}>
                    {working && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {working ? status.msg ?? "Working…" : `Launch for ${formatEther(LAUNCH_FEE)} ETH`}
                  </Button>
                )}
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  One transaction deploys the token, seeds liquidity, and locks it.
                </p>
                {status.msg && status.kind !== "working" && (
                  <p
                    className={cn(
                      "mt-2 text-center text-xs",
                      status.kind === "error" ? "text-destructive" : "text-primary",
                    )}
                  >
                    {status.msg}
                  </p>
                )}
                {status.hash && (
                  <p className="mt-1 text-center text-xs text-muted-foreground">
                    <a
                      href={explorerTx(status.hash)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline-offset-2 hover:text-foreground hover:underline"
                    >
                      view transaction
                    </a>
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum font-medium">{value}</span>
    </div>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  count?: string;
  prefix?: string;
  suffix?: string;
  mono?: boolean;
  optional?: boolean;
  hint?: string;
};

function Field({ id, label, value, onChange, placeholder, count, prefix, suffix, mono, optional, hint }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>
          {label}
          {optional && <span className="ml-1 text-xs font-normal text-muted-foreground">optional</span>}
        </Label>
        {count && <span className="tnum text-xs text-muted-foreground">{count}</span>}
      </div>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>
        )}
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(prefix && "pl-6", suffix && "pr-14", mono && "font-mono tnum")}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{suffix}</span>
        )}
      </div>
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

import { robinhoodChain } from "@/lib/chain";

/**
 * The thin stats strip above the feed. Numbers are real and computed from what the feed loads —
 * tokens in the current window, how many have graduated, and how many have a claimed GitHub
 * binding — rather than vanity figures nobody can check.
 */
export default function ProtocolStats({
  tokens,
  graduated,
  verified,
  loading,
}: {
  tokens: number;
  graduated: number;
  verified: number;
  loading?: boolean;
}) {
  const val = (n: number) => (loading ? "—" : n.toLocaleString("en-US"));
  const stats = [
    { label: "Tokens", value: tokens.toLocaleString("en-US") },
    { label: "Graduated", value: val(graduated) },
    { label: "GitHub-verified", value: val(verified) },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-border bg-card px-5 py-3">
      {stats.map((stat) => (
        <div key={stat.label} className="flex items-baseline gap-2">
          <span className="tnum text-lg font-semibold">{stat.value}</span>
          <span className="text-xs text-muted-foreground">{stat.label}</span>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        Live on {robinhoodChain.name}
      </div>
    </div>
  );
}

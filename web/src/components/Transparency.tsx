import type { TokenDetail } from "../lib/api";
import { explorerAddress } from "../lib/chain";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number, d = 4) => n.toLocaleString(undefined, { maximumFractionDigits: d });

function Row({ ok, label, value }: { ok: boolean | null; label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[14px_112px_1fr] items-baseline gap-2 text-sm">
      <span className={ok === null ? "text-muted-foreground" : ok ? "text-primary" : "text-destructive"}>{ok === null ? "•" : ok ? "✓" : "!"}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

/**
 * The honesty panel. On a pad whose whole pitch is being the anti-scam alternative, the
 * facts a buyer would otherwise have to read the contracts for belong on the page — stated
 * plainly, including the parts that are not reassuring.
 */
export default function Transparency({ t }: { t: TokenDetail }) {
  const g = t.graduation;
  const creatorPct = 80; // snapshotted 80/20 at launch; protocol takes the rest
  const unclaimed = t.github && !t.github.claimed;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="font-semibold">What you are buying</h3>
      <div className="flex flex-col gap-2" style={{ marginTop: 10 }}>
        <Row
          ok={t.knownToFactory}
          label="liquidity"
          value={t.knownToFactory ? "permanently locked, cannot be pulled" : "not launched by this factory"}
        />
        <Row ok={true} label="supply" value={`${fmt(t.totalSupply, 0)}, fixed — no mint function`} />
        <Row
          ok={t.feeWallet ? true : null}
          label="fee wallet"
          value={
            t.feeWallet && t.feeWallet !== "0x0000000000000000000000000000000000000000" ? (
              <a href={explorerAddress(t.feeWallet)} target="_blank" rel="noreferrer noopener">
                {short(t.feeWallet)}
              </a>
            ) : (
              "none yet — fees are escrowed"
            )
          }
        />
        <Row ok={null} label="fee split" value={`${creatorPct}% creator · ${100 - creatorPct}% protocol`} />
        {t.github ? (
          <Row
            ok={t.github.claimed}
            label={`github ${t.github.kind}`}
            value={
              t.github.claimed
                ? `#${t.github.githubId} — claimed by the owner`
                : `#${t.github.githubId} — unclaimed, fees held in escrow`
            }
          />
        ) : (
          <Row ok={null} label="github" value="not bound to a repo or account" />
        )}
        {g && (
          <Row
            ok={g.graduated}
            label="graduation"
            value={`${fmt(g.earnedFeesEth, 4)} / ${fmt(g.thresholdEth, 4)} Ξ in fees earned`}
          />
        )}
      </div>

      {unclaimed && (
        <p className="text-muted-foreground" style={{ marginTop: 10 }}>
          This token was launched for a GitHub {t.github?.kind} that has not claimed it. The launcher earns
          nothing — the creator share accrues in escrow until the real owner claims it.
        </p>
      )}
      {!t.knownToFactory && (
        <p className="text-destructive text-sm" style={{ marginTop: 10 }}>
          This token did not come from the finchpad factory, so none of the guarantees above are enforced.
          Treat it as unverified.
        </p>
      )}
    </div>
  );
}

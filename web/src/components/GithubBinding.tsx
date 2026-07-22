import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Creators type a GitHub username or owner/repo. The CONTRACT still binds the numeric id —
 * names get renamed and freed, and a squatter who picks up an abandoned name would otherwise
 * inherit someone else's fee stream. So this resolves the name to an id and shows the
 * creator exactly what will be written on-chain.
 */
export default function GithubBinding({
  kind,
  value,
  onResolved,
}: {
  kind: "repo" | "user";
  value: string;
  onResolved: (id: string | null) => void;
}) {
  const [state, setState] = useState<
    { s: "idle" } | { s: "looking" } | { s: "ok"; id: string; login: string; avatar?: string } | { s: "err"; msg: string }
  >({ s: "idle" });

  useEffect(() => {
    const q = value.trim().replace(/^@/, "");
    if (!q) {
      setState({ s: "idle" });
      onResolved(null);
      return;
    }
    let alive = true;
    setState({ s: "looking" });
    const t = setTimeout(async () => {
      try {
        const r = await api.resolveGithub(kind, q);
        if (!alive) return;
        setState({ s: "ok", id: r.id, login: r.login, avatar: r.avatar });
        onResolved(r.id);
      } catch (e) {
        if (!alive) return;
        setState({ s: "err", msg: (e as Error).message });
        onResolved(null);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // onResolved is intentionally excluded: parents pass a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, value]);

  if (state.s === "idle") return null;
  if (state.s === "looking") return <p className="dim">checking GitHub…</p>;
  if (state.s === "err") return <p className="warn">{state.msg}</p>;

  return (
    <div className="gh-ok">
      {state.avatar && <img src={state.avatar} alt="" width={20} height={20} />}
      <span className="ok">✓</span>
      <span>{state.login}</span>
      <span className="dim mono">binds to id {state.id}</span>
    </div>
  );
}

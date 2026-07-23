// GitHub OAuth web flow for fee claims. Two claim kinds, matching the contracts:
//
//   repo: GET /auth/github/start?kind=repo&token=0x..&claimant=0x..&repo=owner/name
//         -> requires the OAuth'd user to have ADMIN on the repo; signs over the repo's id
//   user: GET /auth/github/start?kind=user&token=0x..&claimant=0x..
//         -> no permission check needed; signs over the OAuth'd user's own numeric id
//
// GET /auth/github/callback?code=..&state=..
//   -> exchanges the code server-side, verifies the identity, and returns the signed
//      EIP-712 claim for FeeRightsRegistry.claimGithub().
//
// SECURITY:
// - `state` is single-use, unguessable (24 random bytes), and expires after 10 minutes.
//   It carries the claim parameters so the callback cannot be replayed onto a different
//   token/claimant (classic OAuth CSRF).
// - The GitHub access token never leaves this module: not logged, not returned, used for
//   exactly one API lookup.
// - Claims bind numeric GitHub ids (see githubClaim.js) — never repo names or usernames.
// - This module is kept separate from the read API so production can run it network-
//   isolated next to the signer key (HSM/KMS), per the plan. Mounting it in the dev API
//   is a development convenience only.
// - Default scope is "" — enough for user claims and public-repo claims. Set
//   GITHUB_OAUTH_SCOPE=repo only if private-repo claims matter.

import { randomBytes } from "node:crypto";
import { CLAIM_KIND, assertNumericGithubId, claimDigest, signClaim } from "./githubClaim.js";

const STATE_TTL_MS = 10 * 60_000;
const CLAIM_VALIDITY_SEC = 15 * 60; // deadline = now + 15min, per the documented flow
const isAddress = (s) => typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const GH_HEADERS = (ghToken) => ({
  authorization: `Bearer ${ghToken}`,
  accept: "application/vnd.github+json",
  "user-agent": "finchpad-claims",
});

export function createGithubAuth({
  clientId,
  clientSecret,
  redirectUri = "http://localhost:8787/auth/github/callback",
  registry, // FeeRightsRegistry address; digest/signature omitted until configured
  chainId = 4663,
  signerKey, // optional in dev: flow verifies and returns signed:false without it
  scope = "",
  fetchImpl = fetch,
  now = Date.now,
  // Claim-menu support: returns every unclaimed GitHub-bound token
  // [{address, symbol, name, github_kind, github_id}] — supplied by the API from the indexer.
  listBindings = null,
} = {}) {
  const states = new Map();

  const prune = () => {
    for (const [k, v] of states) if (now() - v.at > STATE_TTL_MS) states.delete(k);
  };

  /** Returns {status, body} | {redirect} for /auth/github/* paths, null otherwise. */
  async function handle(url) {
    if (!url.pathname.startsWith("/auth/github/")) return null;
    if (!clientId || !clientSecret) {
      return { status: 503, body: { error: "github oauth not configured (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)" } };
    }
    const q = url.searchParams;

    if (url.pathname === "/auth/github/start") {
      const mode = q.get("mode") || "json"; // json | popup (single token) | menu (all claimable)
      const claimant = q.get("claimant");
      if (!isAddress(claimant)) return { status: 400, body: { error: "claimant must be a 0x address" } };

      let pendingEntry;
      if (mode === "menu") {
        // Claim menu: no specific token — the callback discovers everything claimable.
        pendingEntry = { mode, claimant, popup: true, at: now() };
      } else {
        const kind = q.get("kind") || "repo";
        const token = q.get("token");
        const repo = q.get("repo");
        if (kind !== "repo" && kind !== "user") return { status: 400, body: { error: "kind must be repo or user" } };
        if (!isAddress(token)) return { status: 400, body: { error: "token must be a 0x address" } };
        if (kind === "repo" && (!repo || !REPO_RE.test(repo))) {
          return { status: 400, body: { error: "repo claims need repo=owner/name" } };
        }
        // mode=popup: the callback renders a page that postMessages the claim back to the
        // opener window instead of returning raw JSON — the frontend's claim flow.
        pendingEntry = { mode, kind, token, claimant, repo: kind === "repo" ? repo : null, popup: mode === "popup", at: now() };
      }

      prune();
      const state = randomBytes(24).toString("hex");
      states.set(state, pendingEntry);

      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", clientId);
      authorize.searchParams.set("redirect_uri", redirectUri);
      authorize.searchParams.set("state", state);
      if (scope) authorize.searchParams.set("scope", scope);
      authorize.searchParams.set("allow_signup", "false");
      return { redirect: authorize.href };
    }

    if (url.pathname === "/auth/github/callback") {
      const code = q.get("code");
      const state = q.get("state");
      const pending = state ? states.get(state) : undefined;
      if (state) states.delete(state); // single-use, even on failure
      if (!pending || now() - pending.at > STATE_TTL_MS) {
        return { status: 400, body: { error: "invalid or expired state" } };
      }
      if (!code) return { status: 400, body: { error: "missing code" } };

      const tokenRes = await fetchImpl("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      });
      const tokenJson = await tokenRes.json().catch(() => ({}));
      const ghToken = tokenJson.access_token;
      if (!ghToken) {
        return { status: 502, body: { error: `github token exchange failed: ${tokenJson.error || "no access_token"}` } };
      }

      // Claim menu: verify the identity once, then sign a claim for EVERY bound token this
      // account can take — user-bound tokens by id match, repo-bound tokens by a live admin
      // check on each repo (GitHub resolves numeric ids via /repositories/:id). One OAuth
      // round-trip instead of one per token.
      if (pending.mode === "menu") {
        const userRes = await fetchImpl("https://api.github.com/user", { headers: GH_HEADERS(ghToken) });
        if (!userRes.ok) return { status: 502, body: { error: `github user lookup failed (${userRes.status})` } };
        const user = await userRes.json();
        const userId = assertNumericGithubId(user.id);

        const candidates = listBindings ? await listBindings() : [];
        const claims = [];
        for (const c of candidates) {
          let eligible = false;
          if (Number(c.github_kind) === CLAIM_KIND.USER) {
            eligible = String(c.github_id) === String(userId);
          } else if (Number(c.github_kind) === CLAIM_KIND.REPO) {
            const repoRes = await fetchImpl(`https://api.github.com/repositories/${c.github_id}`, {
              headers: GH_HEADERS(ghToken),
            });
            if (repoRes.ok) {
              const info = await repoRes.json();
              eligible = Boolean(info.permissions?.admin) && String(info.id) === String(c.github_id);
            }
          }
          if (!eligible) continue;

          const deadline = BigInt(Math.floor(now() / 1000) + CLAIM_VALIDITY_SEC);
          const claim = {
            registry,
            chainId,
            token: c.address,
            claimKind: Number(c.github_kind),
            githubId: BigInt(c.github_id),
            claimant: pending.claimant,
            deadline,
          };
          claims.push({
            token: c.address,
            symbol: c.symbol,
            name: c.name,
            claimKind: Number(c.github_kind),
            githubId: String(c.github_id),
            deadline,
            signature: registry && signerKey ? await signClaim(claim, signerKey) : null,
            signed: Boolean(registry && signerKey),
          });
        }

        const payload = { identity: user.login, githubId: String(userId), claimant: pending.claimant, claims };
        // `<` escaped inside string values: this JSON lands in an inline <script>, and token
        // names/symbols are CREATOR-CONTROLLED — "</script>" in a name must never terminate
        // the block (XSS on the signing origin). < is legal JSON and parses identically.
        const json = JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
          .replace(/</g, String.fromCharCode(92) + "u003c");
        const html = `<!doctype html><meta charset="utf-8"><title>finchpad</title>
<body style="background:#131d24;color:#9fb6b6;font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p>GitHub verified — returning to finchpad…</p>
<script>
  try { window.opener && window.opener.postMessage({ type: "finchpad:github-claims", result: ${json} }, window.location.origin); } catch (e) {}
  setTimeout(function () { window.close(); }, 400);
</script></body>`;
        return { status: 200, html };
      }

      let claimKind;
      let githubId;
      let identity; // human-readable, for display only — never what the claim binds
      if (pending.kind === "user") {
        const userRes = await fetchImpl("https://api.github.com/user", { headers: GH_HEADERS(ghToken) });
        if (!userRes.ok) return { status: 502, body: { error: `github user lookup failed (${userRes.status})` } };
        const user = await userRes.json();
        claimKind = CLAIM_KIND.USER;
        githubId = assertNumericGithubId(user.id);
        identity = user.login;
      } else {
        const repoRes = await fetchImpl(`https://api.github.com/repos/${pending.repo}`, { headers: GH_HEADERS(ghToken) });
        if (!repoRes.ok) {
          // GitHub 404s private repos the token can't see (rather than 403), so without
          // "repo" scope a private repo looks nonexistent.
          const hint = repoRes.status === 404 && !scope.includes("repo")
            ? " — private repo? claims on private repos need GITHUB_OAUTH_SCOPE=repo"
            : "";
          return { status: 502, body: { error: `github repo lookup failed (${repoRes.status})${hint}` } };
        }
        const repoInfo = await repoRes.json();
        if (!repoInfo.permissions?.admin) {
          return { status: 403, body: { error: "authorized user is not an admin of that repo" } };
        }
        claimKind = CLAIM_KIND.REPO;
        githubId = assertNumericGithubId(repoInfo.id);
        identity = repoInfo.full_name;
      }

      const deadline = BigInt(Math.floor(now() / 1000) + CLAIM_VALIDITY_SEC);
      const claim = { registry, chainId, token: pending.token, claimKind, githubId, claimant: pending.claimant, deadline };
      const digest = registry ? claimDigest(claim) : null;
      const signature = registry && signerKey ? await signClaim(claim, signerKey) : null;

      const payload = {
        token: pending.token,
        claimant: pending.claimant,
        claimKind,
        githubId,
        identity,
        deadline,
        digest,
        signature,
        signed: signature !== null,
      };

      // Popup flow: hand the claim to the window that opened us, then close. The target
      // origin is OUR origin (opener and popup are served by this same server), so the
      // payload can't be delivered to a foreign window.
      if (pending.popup) {
        // `<` escaped inside string values: this JSON lands in an inline <script>, and token
        // names/symbols are CREATOR-CONTROLLED — "</script>" in a name must never terminate
        // the block (XSS on the signing origin). < is legal JSON and parses identically.
        const json = JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
          .replace(/</g, String.fromCharCode(92) + "u003c");
        const html = `<!doctype html><meta charset="utf-8"><title>finchpad</title>
<body style="background:#131d24;color:#9fb6b6;font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p>GitHub verified — returning to finchpad…</p>
<script>
  try { window.opener && window.opener.postMessage({ type: "finchpad:github-claim", claim: ${json} }, window.location.origin); } catch (e) {}
  setTimeout(function () { window.close(); }, 400);
</script></body>`;
        return { status: 200, html };
      }

      return { status: 200, body: payload };
    }

    return { status: 404, body: { error: "not found" } };
  }

  return { handle };
}

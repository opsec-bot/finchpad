// GitHub OAuth web flow for fee claims.
//
// GET /auth/github/start?token=0x..&claimant=0x..&repo=owner/name
//   -> 302 to github.com/login/oauth/authorize, with the claim bound to a single-use state
// GET /auth/github/callback?code=..&state=..
//   -> exchanges the code server-side, verifies the user has ADMIN on the repo,
//      resolves GitHub's NUMERIC repo id, and returns the signed EIP-712 claim for
//      FeeRightsRegistry.claimGithub().
//
// SECURITY:
// - `state` is single-use, unguessable (24 random bytes), and expires after 10 minutes.
//   It carries the claim parameters so the callback cannot be replayed onto a different
//   token/claimant (classic OAuth CSRF).
// - The GitHub access token never leaves this module: not logged, not returned, used for
//   exactly one repo lookup.
// - The claim binds the numeric repo id (see githubClaim.js) — never owner/name.
// - This module is kept separate from the read API so production can run it network-
//   isolated next to the signer key (HSM/KMS), per the plan. Mounting it in the dev API
//   is a development convenience only.
// - Default scope is "" — enough to identify the user and read their permissions on
//   public repos. Set GITHUB_OAUTH_SCOPE=repo only if private-repo claims matter.

import { randomBytes } from "node:crypto";
import { assertNumericRepoId, claimDigest, signClaim } from "./githubClaim.js";

const STATE_TTL_MS = 10 * 60_000;
const CLAIM_VALIDITY_SEC = 15 * 60; // deadline = now + 15min, per the documented flow
const isAddress = (s) => typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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
      const token = q.get("token");
      const claimant = q.get("claimant");
      const repo = q.get("repo");
      if (!isAddress(token)) return { status: 400, body: { error: "token must be a 0x address" } };
      if (!isAddress(claimant)) return { status: 400, body: { error: "claimant must be a 0x address" } };
      if (!repo || !REPO_RE.test(repo)) return { status: 400, body: { error: "repo must be owner/name" } };

      prune();
      const state = randomBytes(24).toString("hex");
      states.set(state, { token, claimant, repo, at: now() });

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

      const repoRes = await fetchImpl(`https://api.github.com/repos/${pending.repo}`, {
        headers: { authorization: `Bearer ${ghToken}`, accept: "application/vnd.github+json", "user-agent": "finchpad-claims" },
      });
      if (!repoRes.ok) {
        return { status: 502, body: { error: `github repo lookup failed (${repoRes.status})` } };
      }
      const repoInfo = await repoRes.json();
      if (!repoInfo.permissions?.admin) {
        return { status: 403, body: { error: "authorized user is not an admin of that repo" } };
      }

      const repoId = assertNumericRepoId(repoInfo.id);
      const deadline = BigInt(Math.floor(now() / 1000) + CLAIM_VALIDITY_SEC);
      const claim = { registry, chainId, token: pending.token, repoId, claimant: pending.claimant, deadline };
      const digest = registry ? claimDigest(claim) : null;
      const signature = registry && signerKey ? await signClaim(claim, signerKey) : null;

      return {
        status: 200,
        body: {
          token: pending.token,
          claimant: pending.claimant,
          repoId,
          repoFullName: repoInfo.full_name,
          deadline,
          digest,
          signature,
          signed: signature !== null,
        },
      };
    }

    return { status: 404, body: { error: "not found" } };
  }

  return { handle };
}

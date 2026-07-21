// OAuth flow tests with GitHub mocked out. The real GitHub interaction is two calls
// (token exchange, repo lookup); everything security-relevant — state binding, single-use,
// expiry, admin gate, numeric repoId, signature correctness — is exercised here.

import test from "node:test";
import assert from "node:assert/strict";
import { verifyTypedData } from "viem";
import { createGithubAuth } from "../src/backend/githubOauth.js";
import { CLAIM_KIND, buildClaimPayload } from "../src/backend/githubClaim.js";

const REGISTRY = "0x00000000000000000000000000000000000000aa";
const TOKEN = "0x00000000000000000000000000000000000000bb";
const CLAIMANT = "0x00000000000000000000000000000000000000cc";
// Well-known anvil/hardhat dev key #1 — test fixture only, never a real signer.
const SIGNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const SIGNER_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const url = (path) => new URL(`http://localhost:8787${path}`);

function ghFetch({ admin = true, repoId = 123456789, userId = 555777 } = {}) {
  const calls = [];
  const impl = async (target, opts) => {
    calls.push({ target, opts });
    if (target.startsWith("https://github.com/login/oauth/access_token")) {
      return { ok: true, json: async () => ({ access_token: "gho_test" }) };
    }
    if (target.startsWith("https://api.github.com/repos/")) {
      return {
        ok: true,
        json: async () => ({ id: repoId, full_name: "someone/project", permissions: { admin } }),
      };
    }
    if (target === "https://api.github.com/user") {
      return { ok: true, json: async () => ({ id: userId, login: "somedev" }) };
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
  impl.calls = calls;
  return impl;
}

function makeAuth(overrides = {}) {
  return createGithubAuth({
    clientId: "cid",
    clientSecret: "csecret",
    registry: REGISTRY,
    chainId: 4663,
    signerKey: SIGNER_KEY,
    fetchImpl: ghFetch(),
    ...overrides,
  });
}

async function startAndGetState(auth) {
  const res = await auth.handle(url(`/auth/github/start?token=${TOKEN}&claimant=${CLAIMANT}&repo=someone/project`));
  return new URL(res.redirect).searchParams.get("state");
}

test("non-auth paths are ignored", async () => {
  assert.equal(await makeAuth().handle(url("/tokens")), null);
});

test("unconfigured client returns 503", async () => {
  const auth = createGithubAuth({ fetchImpl: ghFetch() });
  const res = await auth.handle(url("/auth/github/start?x=1"));
  assert.equal(res.status, 503);
});

test("start validates inputs and redirects to github with bound state", async () => {
  const auth = makeAuth();
  assert.equal((await auth.handle(url("/auth/github/start?token=nope&claimant=x&repo=a/b"))).status, 400);
  assert.equal((await auth.handle(url(`/auth/github/start?token=${TOKEN}&claimant=${CLAIMANT}&repo=not-a-repo`))).status, 400);

  const res = await auth.handle(url(`/auth/github/start?token=${TOKEN}&claimant=${CLAIMANT}&repo=someone/project`));
  const redirect = new URL(res.redirect);
  assert.equal(redirect.origin + redirect.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(redirect.searchParams.get("client_id"), "cid");
  assert.ok(redirect.searchParams.get("state").length >= 32);
});

test("callback rejects unknown, replayed, and expired state", async () => {
  let t = 1_000_000;
  const auth = makeAuth({ now: () => t });

  assert.equal((await auth.handle(url("/auth/github/callback?code=c&state=bogus"))).status, 400);

  const replayed = await startAndGetState(auth);
  assert.equal((await auth.handle(url(`/auth/github/callback?code=c&state=${replayed}`))).status, 200);
  assert.equal((await auth.handle(url(`/auth/github/callback?code=c&state=${replayed}`))).status, 400);

  const expired = await startAndGetState(auth);
  t += 11 * 60_000;
  assert.equal((await auth.handle(url(`/auth/github/callback?code=c&state=${expired}`))).status, 400);
});

test("callback rejects non-admins", async () => {
  const auth = makeAuth({ fetchImpl: ghFetch({ admin: false }) });
  const state = await startAndGetState(auth);
  const res = await auth.handle(url(`/auth/github/callback?code=c&state=${state}`));
  assert.equal(res.status, 403);
});

test("repo happy path returns a signed claim the registry payload verifies", async () => {
  const now = Date.now();
  const auth = makeAuth({ now: () => now });
  const state = await startAndGetState(auth);
  const res = await auth.handle(url(`/auth/github/callback?code=c&state=${state}`));

  assert.equal(res.status, 200);
  const b = res.body;
  assert.equal(b.claimKind, CLAIM_KIND.REPO);
  assert.equal(b.githubId, 123456789n); // numeric GitHub id, never owner/name
  assert.equal(b.identity, "someone/project");
  assert.equal(b.deadline, BigInt(Math.floor(now / 1000) + 900));
  assert.equal(b.signed, true);

  const payload = buildClaimPayload({
    registry: REGISTRY,
    chainId: 4663,
    token: TOKEN,
    claimKind: b.claimKind,
    githubId: b.githubId,
    claimant: CLAIMANT,
    deadline: b.deadline,
  });
  assert.ok(await verifyTypedData({ ...payload, address: SIGNER_ADDR, signature: b.signature }));
});

test("user claims sign over the OAuth'd account's own id, no repo involved", async () => {
  const now = Date.now();
  const auth = makeAuth({ now: () => now });
  const start = await auth.handle(url(`/auth/github/start?kind=user&token=${TOKEN}&claimant=${CLAIMANT}`));
  const state = new URL(start.redirect).searchParams.get("state");
  const res = await auth.handle(url(`/auth/github/callback?code=c&state=${state}`));

  assert.equal(res.status, 200);
  const b = res.body;
  assert.equal(b.claimKind, CLAIM_KIND.USER);
  assert.equal(b.githubId, 555777n); // the authenticated user's numeric id
  assert.equal(b.identity, "somedev");
  assert.equal(b.signed, true);

  const payload = buildClaimPayload({
    registry: REGISTRY,
    chainId: 4663,
    token: TOKEN,
    claimKind: b.claimKind,
    githubId: b.githubId,
    claimant: CLAIMANT,
    deadline: b.deadline,
  });
  assert.ok(await verifyTypedData({ ...payload, address: SIGNER_ADDR, signature: b.signature }));
});

test("start validates kind and repo requirement", async () => {
  const auth = makeAuth();
  assert.equal((await auth.handle(url(`/auth/github/start?kind=org&token=${TOKEN}&claimant=${CLAIMANT}`))).status, 400);
  // repo kind without a repo param
  assert.equal((await auth.handle(url(`/auth/github/start?kind=repo&token=${TOKEN}&claimant=${CLAIMANT}`))).status, 400);
  // user kind needs no repo param
  const res = await auth.handle(url(`/auth/github/start?kind=user&token=${TOKEN}&claimant=${CLAIMANT}`));
  assert.ok(res.redirect);
});

test("without a signer key the flow still verifies but returns signed:false", async () => {
  const auth = makeAuth({ signerKey: undefined });
  const state = await startAndGetState(auth);
  const res = await auth.handle(url(`/auth/github/callback?code=c&state=${state}`));
  assert.equal(res.status, 200);
  assert.equal(res.body.signed, false);
  assert.equal(res.body.signature, null);
  assert.ok(res.body.digest); // registry configured, so the digest is still computable
});

test("github access token is never echoed back", async () => {
  const auth = makeAuth();
  const state = await startAndGetState(auth);
  const res = await auth.handle(url(`/auth/github/callback?code=c&state=${state}`));
  assert.ok(!JSON.stringify(res.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).includes("gho_test"));
});

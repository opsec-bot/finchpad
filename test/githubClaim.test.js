import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CLAIM_KIND, claimDigest, signClaim, buildClaimPayload, assertNumericGithubId } from "../src/backend/githubClaim.js";

// These EXACT values are mirrored in contracts/test/ClaimDigest.t.sol. The expected digests
// were produced by the deployed FeeRightsRegistry via its claimDigest() view. If either the
// contract's EIP-712 encoding or this signer's drifts, this test fails — which is the point.
const FIXTURE = {
  registry: "0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9",
  chainId: 31337,
  token: "0x1111111111111111111111111111111111111111",
  claimKind: CLAIM_KIND.REPO,
  githubId: 123456789n,
  claimant: "0x2222222222222222222222222222222222222222",
  deadline: 1893456000n,
};
const EXPECTED_REPO_DIGEST = "0xc0f640e58f3aa849fdf0691f455b03534ff136a23ba8e068427855df2b71dfb4";
const EXPECTED_USER_DIGEST = "0xb046256ded07777ae1034150dff61300ffcc7db2485bb60e99f08a54b1cb3419";

test("JS repo-claim digest matches the on-chain FeeRightsRegistry digest", () => {
  assert.equal(claimDigest(FIXTURE), EXPECTED_REPO_DIGEST);
});

test("JS user-claim digest matches the on-chain FeeRightsRegistry digest", () => {
  assert.equal(claimDigest({ ...FIXTURE, claimKind: CLAIM_KIND.USER }), EXPECTED_USER_DIGEST);
});

test("signature recovers to the signing account", async () => {
  const pk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const account = privateKeyToAccount(pk);
  const sig = await signClaim(FIXTURE, pk);

  const recovered = await recoverTypedDataAddress({ ...buildClaimPayload(FIXTURE), signature: sig });
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
});

test("a different claimant produces a different digest (claims are not transferable)", () => {
  const other = claimDigest({ ...FIXTURE, claimant: "0x3333333333333333333333333333333333333333" });
  assert.notEqual(other, EXPECTED_REPO_DIGEST);
});

test("a different githubId produces a different digest", () => {
  const other = claimDigest({ ...FIXTURE, githubId: 987654321n });
  assert.notEqual(other, EXPECTED_REPO_DIGEST);
});

test("repo and user claims over the same id produce different digests", () => {
  assert.notEqual(EXPECTED_REPO_DIGEST, EXPECTED_USER_DIGEST);
});

test("claimKind None or unknown is rejected", () => {
  assert.throws(() => buildClaimPayload({ ...FIXTURE, claimKind: 0 }), /claimKind/);
  assert.throws(() => buildClaimPayload({ ...FIXTURE, claimKind: 3 }), /claimKind/);
});

test("githubId must be numeric, never a name", () => {
  assert.throws(() => assertNumericGithubId("solana-labs/solana"), /numeric id/);
  assert.throws(() => assertNumericGithubId("torvalds"), /numeric id/);
  assert.equal(assertNumericGithubId("123456789"), 123456789n);
});

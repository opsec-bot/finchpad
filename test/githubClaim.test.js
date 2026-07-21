import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { claimDigest, signClaim, buildClaimPayload, assertNumericRepoId } from "../src/backend/githubClaim.js";

// These EXACT values are mirrored in contracts/test/ClaimDigest.t.sol. The expected digest
// was produced by the deployed FeeRightsRegistry via its claimDigest() view. If either the
// contract's EIP-712 encoding or this signer's drifts, this test fails — which is the point.
const FIXTURE = {
  registry: "0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9",
  chainId: 31337,
  token: "0x1111111111111111111111111111111111111111",
  repoId: 123456789n,
  claimant: "0x2222222222222222222222222222222222222222",
  deadline: 1893456000n,
};
const EXPECTED_DIGEST = "0x2f12b6314a59b82a457959104030898ee509fc4cdd0722bb12dad279527dc6bc";

test("JS signer digest matches the on-chain FeeRightsRegistry digest", () => {
  assert.equal(claimDigest(FIXTURE), EXPECTED_DIGEST);
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
  assert.notEqual(other, EXPECTED_DIGEST);
});

test("a different repoId produces a different digest", () => {
  const other = claimDigest({ ...FIXTURE, repoId: 987654321n });
  assert.notEqual(other, EXPECTED_DIGEST);
});

test("repoId must be numeric, never owner/name", () => {
  assert.throws(() => assertNumericRepoId("solana-labs/solana"), /numeric id/);
  assert.equal(assertNumericRepoId("123456789"), 123456789n);
});

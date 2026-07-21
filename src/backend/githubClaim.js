// GitHub-claim signing for finchpad.
//
// A repo owner proves ownership off-chain (GitHub OAuth), then this service signs an
// EIP-712 attestation that FeeRightsRegistry.claimGithub() verifies on-chain.
//
// SECURITY: the signing key is the crown jewel of this whole feature. Anyone holding it can
// claim the fee rights of every repo-launched token. It must live in an HSM/KMS or behind a
// multisig, and this module must run network-isolated from the public API. Never a hot key
// in a .env on the same box that serves user traffic.
//
// The digest is cross-pinned against the contract in test/githubClaim.test.js — if either
// side's domain or type encoding drifts, that test fails.

import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CLAIM_DOMAIN_NAME = "finchpad";
export const CLAIM_DOMAIN_VERSION = "1";

export const CLAIM_TYPES = {
  GithubClaim: [
    { name: "token", type: "address" },
    { name: "repoId", type: "uint256" },
    { name: "claimant", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
};

/** Build the exact EIP-712 payload the registry verifies. */
export function buildClaimPayload({ registry, chainId, token, repoId, claimant, deadline }) {
  return {
    domain: {
      name: CLAIM_DOMAIN_NAME,
      version: CLAIM_DOMAIN_VERSION,
      chainId: Number(chainId),
      verifyingContract: registry,
    },
    types: CLAIM_TYPES,
    primaryType: "GithubClaim",
    message: {
      token,
      repoId: BigInt(repoId),
      claimant,
      deadline: BigInt(deadline),
    },
  };
}

/** The digest the contract's claimDigest() returns. Useful for verifying integration. */
export function claimDigest(params) {
  return hashTypedData(buildClaimPayload(params));
}

/**
 * Sign a GitHub claim.
 * @param {object} params registry, chainId, token, repoId, claimant, deadline
 * @param {`0x${string}`} privateKey signer key (HSM/KMS in production)
 * @returns {Promise<`0x${string}`>} signature for FeeRightsRegistry.claimGithub()
 */
export async function signClaim(params, privateKey) {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData(buildClaimPayload(params));
}

/**
 * Bind claims to GitHub's NUMERIC repo id, never the "owner/name" string.
 * Repos get renamed and transferred constantly, and a deleted name can be re-registered by
 * a squatter who would then hold a valid claim to someone else's fee stream.
 *
 * OAuth is deliberately not implemented here yet: it needs a GitHub OAuth app (client id +
 * secret) that only the project owner can create. The flow, once those exist:
 *   1. user authorizes with scope `repo` (or `read:org` for org repos)
 *   2. GET /repos/{owner}/{name} -> read `id` (numeric) and `permissions.admin`
 *   3. require permissions.admin === true
 *   4. sign (token, repoId=id, claimant=user's wallet, deadline=now+15min)
 */
export function assertNumericRepoId(repoId) {
  if (typeof repoId === "string" && !/^\d+$/.test(repoId)) {
    throw new Error(`repoId must be GitHub's numeric id, got "${repoId}" (never owner/name)`);
  }
  return BigInt(repoId);
}

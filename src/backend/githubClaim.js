// GitHub-claim signing for finchpad.
//
// A GitHub identity proves itself off-chain (OAuth), then this service signs an EIP-712
// attestation that FeeRightsRegistry.claimGithub() verifies on-chain. Two claim kinds,
// matching the on-chain ClaimKind enum:
//   REPO (1): githubId = numeric repo id, claimable by an admin of that repo
//   USER (2): githubId = numeric user id, claimable by that account (bags.fm-style)
//
// SECURITY: the signing key is the crown jewel of this whole feature. Anyone holding it can
// claim the fee rights of every GitHub-launched token. It must live in an HSM/KMS or behind a
// multisig, and this module must run network-isolated from the public API. Never a hot key
// in a .env on the same box that serves user traffic.
//
// The digest is cross-pinned against the contract in test/githubClaim.test.js — if either
// side's domain or type encoding drifts, that test fails.

import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CLAIM_DOMAIN_NAME = "finchpad";
export const CLAIM_DOMAIN_VERSION = "1";

/** Mirrors the on-chain ClaimKind enum (None = 0 never appears in a signed claim). */
export const CLAIM_KIND = { REPO: 1, USER: 2 };

export const CLAIM_TYPES = {
  GithubClaim: [
    { name: "token", type: "address" },
    { name: "claimKind", type: "uint8" },
    { name: "githubId", type: "uint256" },
    { name: "claimant", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
};

/** Build the exact EIP-712 payload the registry verifies. */
export function buildClaimPayload({ registry, chainId, token, claimKind, githubId, claimant, deadline }) {
  if (claimKind !== CLAIM_KIND.REPO && claimKind !== CLAIM_KIND.USER) {
    throw new Error(`claimKind must be ${CLAIM_KIND.REPO} (repo) or ${CLAIM_KIND.USER} (user), got ${claimKind}`);
  }
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
      claimKind,
      githubId: BigInt(githubId),
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
 * @param {object} params registry, chainId, token, claimKind, githubId, claimant, deadline
 * @param {`0x${string}`} privateKey signer key (HSM/KMS in production)
 * @returns {Promise<`0x${string}`>} signature for FeeRightsRegistry.claimGithub()
 */
export async function signClaim(params, privateKey) {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData(buildClaimPayload(params));
}

/**
 * Bind claims to GitHub's NUMERIC ids, never names. Repos get renamed and transferred,
 * usernames get released and re-registered — a squatter re-registering a name would then
 * hold a valid claim to someone else's fee stream. The numeric id is permanent.
 */
export function assertNumericGithubId(githubId) {
  if (typeof githubId === "string" && !/^\d+$/.test(githubId)) {
    throw new Error(`githubId must be GitHub's numeric id, got "${githubId}" (never a name)`);
  }
  return BigInt(githubId);
}

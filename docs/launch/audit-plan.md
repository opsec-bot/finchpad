# Audit plan — what $1,000 actually buys, and the path that de-risks launch anyway

Decision recorded 2026-07-22: no audit firm booked; budget available is **$1,000**; launching
unaudited with audit revisited post-launch.

## Reality check

A professional firm audit for this scope (6 contracts + JS signing backend) runs $15k–$80k.
$1,000 does not buy a smaller version of that — it buys nothing from a firm. Pretending
otherwise (e.g. a $1k "audit" from an unknown Telegram auditor) is worse than launching
openly unaudited, because it manufactures false trust. Don't spend the money there.

## What we do instead (in order)

### 1. Free: exhaust the tooling and the existing review (this week)

- `slither` — config already in `contracts/slither.config.json`; run clean or document
  every triaged finding.
- `aderyn` (Cyfrin's static analyzer) — free, catches a different class than Slither.
- Extend the Foundry fuzz suite (`Fuzz.t.sol`) with invariant tests on the two properties
  that matter most: (a) locker fee accounting never pays out more than collected, and
  (b) escrow can only ever settle to a claimant carrying a valid signature.
- The internal reviews already exist (`docs/security-audit.md`,
  `docs/security-adoption-report.md`, findings F1/F2 fixed). Keep them public and current —
  they are part of the trust story.

### 2. Free: structural de-risking — launch with the riskiest surface OFF

The genuinely novel (and therefore riskiest) surface is the GitHub claim flow: signer key,
EIP-712 verification, escrow settlement. Everything else (factory / locker / fee split) is
the battle-tested pons model.

Deploy with `FINCH_GITHUB_SIGNER=address(0)`: GitHub claims are dead on arrival at the
contract level, core launchpad works fully. Enable claims only after (a) the signer key is
in KMS per `docs/security/signer-key-runbook.md` and (b) the claim flow has had outside
eyes (step 3/4 below). This converts "unaudited launch" into "unaudited launch of a proven
model, with the novel part gated."

### 3. Free: competitive/community review of the claim flow

- Submit the contracts to **CodeHawks First Flights** (free community audit competitions
  for exactly this size of codebase) or apply to a Code4rena/Cantina community round.
  Timeline is not guaranteed — apply now, don't block launch on acceptance.
- Ask for review in the Foundry/Solidity dev communities with a pointed scope ("break
  `claimGithub` + `FinchLocker.settleGithubClaim`, ~400 lines"). Small, specific asks get
  real responses; "please audit my launchpad" does not.

### 4. The $1,000: public bug bounty, not a fake audit

Post a standing bounty — up to $1,000 for a critical (theft of escrow or fee streams,
forged claims), scaled down for lower severities — via a `SECURITY.md` in the repo and a
pinned tweet. A public bounty:

- is worth more per dollar than any $1k "audit" (it pays only on results),
- is itself a marketing/trust signal ("we pay people to break us and publish the results"),
- stays live forever, not for one engagement.

### 5. Post-launch: protocol fees fund the real audit

Commit publicly to booking a professional audit (target scope: contracts + claim backend)
once cumulative protocol revenue crosses a threshold (suggest: first $10k of protocol fees,
or month 3, whichever comes first). Publishing the report when it lands. Saying this out
loud before launch turns the gap into a roadmap item instead of a discovered omission.

## Honesty requirement

Every public surface (site footer, launch announcement, docs) states plainly: contracts are
open source, internally reviewed, fuzz-tested, **not yet third-party audited**; deploy
scripts (`Deploy.s.sol`, `SeedLocal.s.sol`) are published so anyone can reproduce and verify
the deployment. Users on a memecoin launchpad accept risk; they don't accept being lied to
about it.

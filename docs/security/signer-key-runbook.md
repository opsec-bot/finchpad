# Signer key runbook — provisioning, rotation, compromise response

The GitHub-claim signer key is the highest-value secret in finchpad. Anyone holding it can
forge an EIP-712 attestation and claim the fee rights **and the entire escrow backlog** of
every GitHub-bound token (`FeeRightsRegistry.claimGithub`). This runbook covers the full key
lifecycle for a single-operator team.

Status at writing (2026-07-22): **the key does not exist yet.** That is the best possible
starting point — provision it directly into managed key infrastructure and a raw private key
never has to exist on any laptop.

## The two keys this runbook covers

| Key | Held where | Can do |
| --- | --- | --- |
| **Claim signer** (`trustedSigner` in `FeeRightsRegistry`) | AWS KMS (see below) | Sign GitHub-claim attestations |
| **Registry admin** (`Ownable` owner of `FeeRightsRegistry`) | Hardware wallet | Rotate/disable the signer (`setTrustedSigner`), execute CTOs |

The admin key is the recovery mechanism for the signer key. If **both** leak there is no
recovery, so they must never live in the same place. Admin on a hardware wallet (Ledger or
similar), used only for `setTrustedSigner` and `approveCTO`; signer in KMS, never exportable.

## 1. Provisioning (before enabling GitHub claims)

Recommended: **AWS KMS asymmetric key, spec `ECC_SECG_P256K1`, usage `SIGN_VERIFY`.**

- The private key is generated inside AWS's HSM fleet and is **not exportable** — there is
  nothing to leak from a laptop, a `.env`, or a backup.
- Cost is ~$1/month + $0.03 per 10k signing operations. Fits a solo budget.
- The backend calls `kms:Sign` with the EIP-712 digest (`claimDigest()` already produces it);
  a small adapter converts the DER signature to Ethereum's r/s/v. Libraries exist for this
  (e.g. `@rumblefishdev/eth-signer-kms`, or ~50 lines against the AWS SDK). This replaces the
  `privateKeyToAccount(privateKey)` path in `src/backend/githubClaim.js` — `signClaim` grows a
  KMS-backed variant; `FINCH_CLAIM_SIGNER_KEY` as a raw hex key is **dev-only** and must never
  be set in production.

Provisioning steps:

1. Create the KMS key in a dedicated AWS account (not shared with anything else). Enable
   CloudTrail on it — every `kms:Sign` call is then an audit log entry.
2. IAM: exactly one role may call `kms:Sign`, and only the claim-signing service runs under
   it. Root account protected with a hardware MFA key. No human principal gets `Sign`.
3. Derive the Ethereum address from the KMS public key (`kms:GetPublicKey` → keccak).
4. Deploy/point the contract: `FINCH_GITHUB_SIGNER=<address>` at deploy time, or
   `setTrustedSigner(<address>)` from the admin wallet afterwards.
5. Verify end-to-end on testnet: run one full OAuth → sign → `claimGithub()` claim before
   any mainnet token binds to GitHub.

**Launch sequencing note:** `Deploy.s.sol` already supports deploying with
`FINCH_GITHUB_SIGNER=address(0)`, which leaves GitHub claims disabled (`claimGithub` reverts
`BadSignature` for every signature). Core launches, trading, referrals, and graduation are
unaffected. This means mainnet launch is **not blocked** on KMS being ready — GitHub-bound
launches can be enabled later with a single `setTrustedSigner` call once this runbook's
provisioning steps are done. Do not enable GitHub-bound launches in the UI until the signer
is provisioned, or escrow will accrue toward claims that cannot settle.

## 2. Routine rotation

Rotate on a schedule (every 6–12 months) and after any personnel/infra change. Rotation is
cheap, so when in doubt, rotate.

1. Create a new KMS key (same spec) and derive its address.
2. From the admin hardware wallet: `setTrustedSigner(<newAddress>)`.
3. Point the backend at the new KMS key id; restart the signing service.
4. Disable (do not delete) the old KMS key. Keep it disabled for 30 days, then schedule
   deletion.

Side effect: any claim signature issued but not yet submitted becomes invalid the moment
step 2 lands. Signatures live 15 minutes (`CLAIM_VALIDITY_SEC`), so the worst case is a
handful of users re-running the OAuth flow. Acceptable; no coordination needed.

```sh
# rotation / kill-switch call (admin wallet via cast + Ledger)
cast send $REGISTRY "setTrustedSigner(address)" $NEW_SIGNER \
  --ledger --rpc-url $ROBINHOOD_RPC
```

## 3. Compromise response (target: contained in < 1 hour, recovered in < 24)

### Detection

The backend must log every signature it issues (digest, token, githubId, claimant,
timestamp). A watcher compares on-chain `GithubClaimed` events against that log:

> **Any `GithubClaimed` event with no matching backend log entry = the key is compromised.
> No further diagnosis needed. Go to containment immediately.**

Secondary signals: unexpected `kms:Sign` CloudTrail entries, AWS account anomaly alerts,
backend host compromise indicators.

### Containment (minutes, not hours)

From the admin hardware wallet:

```sh
cast send $REGISTRY "setTrustedSigner(address)" 0x0000000000000000000000000000000000000000 \
  --ledger --rpc-url $ROBINHOOD_RPC
```

`trustedSigner = address(0)` is a **kill switch**: `ECDSA.recover` can never return the zero
address, so every claim reverts `BadSignature`. Escrowed funds stay locked in the locker and
keep accruing — nothing is lost while claims are paused.

Keep this command written down (paper + password manager) with the registry address filled
in, so containment is copy-paste under stress, not archaeology.

Then: revoke the compromised KMS key's IAM access and disable the key; take the signing
service offline until the intrusion path is understood.

### Damage assessment & remediation

For each fraudulent `GithubClaimed` event:

- **Fee-rights control is recoverable.** The admin can run `approveCTO(token,
  rightfulController)` to restore control of the fee stream to the legitimate owner.
- **Already-paid escrow is NOT recoverable.** `settleGithubClaim` pays the escrow backlog to
  the claimant at claim time; that transfer is final. This is the true blast radius of a
  leak: the sum of all unclaimed escrows at the moment of compromise, plus future fees for
  however long detection takes. This is why detection latency matters more than anything
  else in this runbook — keep the watcher running from day one of GitHub claims being live.

### Recovery

1. Provision a fresh KMS key per section 1 (new key, new IAM role, rebuilt signing host).
2. `setTrustedSigner(<newAddress>)` from the admin wallet.
3. Publish a short public incident note (what happened, which tokens affected, remediation).
   Silence costs more trust than the incident.

## 4. Single-operator risks (accepted, documented)

- Only one person can execute this runbook. If they are unreachable, claims cannot be
  paused. Mitigation to consider post-launch: move the registry admin to a 2-of-3 Safe with
  trusted parties, which also removes the admin key as a single point of failure for CTOs.
- There is no on-call rotation; detection relies on automated alerting (CloudTrail alarms +
  the event watcher pushing to phone). Set both up before enabling claims — a watcher that
  emails a dashboard nobody reads is not detection.

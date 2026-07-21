# finchpad — Security Audit & Adoption Report

Date: 2026-07-21 · Branch: `claude/security-audit-adoption-twk0ef` (ported to master; PR #1 closed) · Reviewer: automated + manual (Claude)

> **Port note (2026-07-21):** the branch conflicted with the OAuth/claim-kind work that
> landed on master the same day, so F1/F2 were re-applied on master directly, plus two
> extras found during the port: `esc(e.message)` in all four frontend error catches (viem
> surfaces revert strings, which are attacker-controlled bytes) and escaping in the
> token-list renderer. Counts below reflect the branch as reviewed.

> Companion to [`docs/security-audit.md`](./security-audit.md), the Phase 5 contract review.
> That document covers the Solidity layer in depth. **This pass focused on the parts that
> review explicitly excluded — the frontend and backend** ("Frontend/backend pentest" is
> listed there under *Not covered*) — and then answers the second half of the brief: what it
> actually takes to get users onto the platform. The short version of both halves is the same
> sentence: **for a launchpad, security *is* the growth strategy.** Nobody launches a token or
> parks liquidity somewhere they expect to get drained.

---

## Part 1 — Security audit

### Scope of this pass

| Layer | Status |
|---|---|
| Contracts (`contracts/`) | Already reviewed in `security-audit.md` (Slither, 54 Foundry tests, 6 fuzz properties). Re-read here; no new contract findings. Third-party audit still a hard prerequisite. |
| Backend read API (`src/backend/api.js`) | **Reviewed here — 1 finding fixed.** |
| Frontend (`web/index.html`) | **Reviewed here — 1 finding fixed.** |
| Signer service (`src/backend/githubClaim.js`) | Reviewed; design is sound (numeric repo id, EIP-712 cross-pinned). Key-custody risk is the open item, already flagged. |
| GitHub OAuth flow | Not built yet — recommendations below for when it is. |

### Findings

#### F1 — Stored XSS via on-chain token metadata (High) — **FIXED**

`web/index.html` rendered a token's `name` and `symbol` straight into `innerHTML` with no
escaping (in `select()` and `loadTrades()`). Those strings are **attacker-controlled**: anyone
can launch a token by passing arbitrary `name`/`symbol` calldata to `FinchToken.initialize`,
with no on-chain sanitization. A token named

```
<img src=x onerror="/* attacker JS */">
```

executes in the session of **every user who views that token** in the finchpad UI. This is the
most dangerous class of bug a launchpad frontend can ship, because the roadmap (Phase 3) puts
wallet-connect and transaction-signing on this same origin. XSS on a page that also prompts
`eth_sendTransaction` / token approvals is a direct path to draining visitors — an attacker
lists a token, waits for people to click it, and scripts a malicious approval prompt.

*Fix:* added an `esc()` HTML-escaping helper and applied it to every chain-derived string
before it enters `innerHTML` (`name`, `symbol`, and the address fields defensively). Numeric
and boolean fields are untouched.

*Residual:* the current page has no wallet integration, so today the blast radius is
session-scoped script execution. Before Phase 3 ships signing flows, add a **Content-Security-
Policy** (see F3) so that even a missed escape can't load remote script or exfiltrate.

#### F2 — Unauthenticated resource-exhaustion / RPC-quota DoS (Medium) — **FIXED**

`api.js` accepted `blocks`, `limit`, and `interval` query params with **no upper bound**.
`blocks` drives `getLogsChunked`, which scans the chain in 1000-block chunks from
`latest - blocks`. A single unauthenticated request like

```
GET /tokens?blocks=100000000
```

forces a scan from block 0 — thousands of sequential `eth_getLogs` calls per request. Worse,
the TTL cache is keyed on `blocks`, so an attacker who varies the value bypasses the cache
entirely and hits the RPC on every request. This cheaply exhausts the Alchemy/public-RPC quota
and takes the API (and therefore the whole site, which is served from the same process) down.

*Fix:* clamp every caller-supplied bound — `MAX_BLOCKS = 50_000`, `MAX_LIMIT = 200`,
`MAX_INTERVAL = 86_400` — with garbage-input fallbacks, in `boundedBlocks()` / `boundedInt()`.
Both are unit-tested (`test/api.test.js`).

*Residual:* clamping caps per-request cost but is **not a rate limiter**. Before the service
faces real traffic, put it behind a reverse proxy (nginx/Cloudflare) with per-IP rate limiting;
a determined attacker can still send many capped requests.

### Recommendations (not code-changed in this pass)

| # | Sev | Item | Note |
|---|---|---|---|
| F3 | Low | **No security headers.** The HTML is served with no CSP, `X-Content-Type-Options: nosniff`, or `Referrer-Policy`. Add these in the `server` response, and adopt a CSP before wallet flows ship. The current inline `<script>` will need a nonce or a move to an external file to allow a strict CSP. | Defense-in-depth behind F1. |
| F4 | Low | **Error-message passthrough.** The 500 handler returns `err.shortMessage \|\| err.message` to the client, which can leak RPC/provider internals. Return a generic string; log the detail server-side. | Info disclosure. |
| F5 | — | **OAuth flow (when built).** The signer path is designed correctly (numeric repo id, `permissions.admin === true`, short deadline). When the OAuth front half lands, it **must** use the `state` parameter (CSRF) and PKCE, keep the client secret server-side only, and never expose the signer key to the API process. | Pre-req, already on the Phase 5 checklist. |
| F6 | — | **Centralization (unchanged, by design).** `approveCTO` lets the admin reassign any token's fee stream, and the signer key can claim any repo-launched token. Both are documented trust assumptions. Put `admin` behind a multisig + timelock and the signer in an HSM/KMS before mainnet. | This is also the #1 *adoption* barrier — see Part 2. |

### Test status

`npm test` — **17/17 passing** (was 15; +2 for the input-bounding). Contract suite unchanged
(54 Foundry tests per `security-audit.md`). `npm audit` — 0 vulnerabilities.

---

## Part 2 — How we get users onto the platform

The honest framing: finchpad is a launchpad that takes a fee cut and holds other people's
liquidity and fee rights. Users are not choosing a UI; they are choosing whom to trust with
money. Every adoption lever below is downstream of that. The work in Part 1 isn't a tax on
growth — it *is* the growth work.

### 1. Ship the trust primitives as the headline, not the footnote

finchpad already has features most launchpad clones don't. They only drive adoption if users
can *see* them:

- **Locked liquidity by construction.** The LP NFT goes straight to the locker at launch —
  liquidity can't be pulled. This is the single biggest anti-rug signal in the space; it should
  be a badge on every token page, not buried in the README.
- **`FinchLock` vesting** lets a creator publicly lock their own allocation — a verifiable
  "I can't dump on you." Surface a "creator locked X% for Y months" badge; it's the strongest
  organic trust signal a creator can send, and it costs us nothing to display.
- **Holder-concentration guard.** The indexer already refuses to show concentration numbers
  when discovery is partial (`complete: false`) rather than showing a wrong one. Lean into
  "we show you the rug risk, and we tell you when we can't" — honesty is a differentiator here.

**Action:** a token page that leads with three green/red badges — *liquidity locked*,
*creator allocation vested*, *holder concentration* — is a better growth asset than any
marketing copy.

### 2. GitHub-verified fee claims are the actual wedge

The CTO / redirect / GitHub-claim registry is what makes finchpad different from a pump.fun
clone. The GitHub claim in particular is a genuinely novel hook: **a real open-source project
can claim the fee stream of a token launched in its name.** That's a distribution story —
every meaningful repo is a potential creator, and the claim flow is a reason for them to show
up. Prioritize finishing the OAuth half (it's the one user-blocked item) because it unlocks
the one feature competitors can't trivially copy.

### 3. Remove the first-launch friction

- **Curve A is a fair-launch default** (~1 ETH start, no bonding-curve migration). Market it as
  "one transaction, liquidity locked, no migration, no graduation gate." Simplicity is the
  pitch against bonding-curve fatigue.
- **Launch fee is 0.0005 ETH** and overpayment is now refunded (per the contract review). Keep
  it visibly low; the barrier to a first launch should be trivial.
- Ship the **anvil mainnet-fork rehearsal env** (open TODO) so creators — and we — can dry-run
  a launch. A "try it on a fork first" path lowers the fear of a one-shot mainnet launch, which
  matters *a lot* given there's no live testnet with Uniswap.

### 4. Earn trust you can point to before asking for money

The contract review is blunt that going live *is* mainnet (no Uniswap on RH testnet). That's a
risk, so front-load credibility:

- **Independent third-party audit**, published. For a launchpad this is table stakes, not
  optional; put the report link in the footer.
- **`admin` behind a multisig + timelock**, address public. "Here's our multisig, here's the
  timelock delay" converts skeptics better than any promise.
- **Bug-bounty window** on the non-pool contracts (`FinchLock`, `FeeRightsRegistry`) — those
  *can* be exercised on RH testnet even without Uniswap.
- **Legal review** (securities / money-transmitter) before real funds. Getting shut down is the
  ultimate churn event.

### 5. Growth loops, once the trust base is real

- **Creators bring their audience.** Every launch is a creator with a Discord/Telegram/farcaster
  (the token already stores these socials). Make sharing a launch — with the trust badges baked
  into the preview — one click.
- **The buyback-burn is a narrative.** The FINCH buyback-and-burn is public and on-chain; a live
  "burned to date" counter is a recurring reason to come back. (Note the legal flag: buyback-burn
  can read as a dividend — clear it in review first.)
- **Discovery that's actually useful.** The API already serves live price/candles/trades. A
  "new & trending, filtered by liquidity-locked and low-concentration" feed makes finchpad the
  place to find *survivable* launches, not just the newest ones.

### Priority order

1. **Fix trust-breaking bugs first** (F1/F2 done; F3–F5 before wallet flows ship). One XSS
   incident on a finance site ends the adoption conversation permanently.
2. **Finish GitHub OAuth** — the differentiating wedge, and the only user-blocked item.
3. **Publish the audit + multisig/timelock** — the credibility you point at.
4. **Surface the trust badges** — turn features you already built into visible reasons to trust.
5. **Then** open the growth loops (creator sharing, trending feed, burn counter).

Growth spend before step 1 is spend on a leaky bucket. The security posture and the adoption
strategy are the same roadmap.

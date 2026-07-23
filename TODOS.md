# finchpad TODOS

## LAUNCH DECISIONS (user calls, 2026-07-22, from the launch-readiness review)

Two calls made after the readiness questionnaire. Execution is the user's (provisioning
work, no code): scheduled for tomorrow.

- [ ] **Audit: post-launch, not before.** The $1,000 budget doesn't buy a firm audit, so the
      first mainnet deploy will NOT wait on one. Mitigation per `docs/launch/audit-plan.md`:
      deploy with `FINCH_GITHUB_SIGNER=address(0)` so the novel claim/escrow surface is dead
      at the contract level on day one, run the free tooling pass (slither/aderyn/invariants),
      apply for a community round (CodeHawks First Flights), stand up the $1,000 public bounty
      (SECURITY.md drafted), and commit publicly to a professional audit from protocol fees.
      This supersedes the "audit gates the first deploy" hard gate below — the gate becomes
      "GitHub claims stay disabled until the claim flow has had outside eyes".
- [ ] **Registry admin goes behind a Gnosis Safe.** The `Ownable` admin of FeeRightsRegistry
      (rotates/kills the signer via `setTrustedSigner`, executes CTOs) will be a Safe, not an
      EOA — closes the "one key can redirect any token's fee stream" gate and gives the
      signer-key runbook a recovery path that survives one lost device.
      - [x] **Safe IS deployable on chain 4663 — VERIFIED 2026-07-23.** Queried the canonical
            addresses against the RH-mainnet fork: Safe singleton v1.4.1
            (0x41675C…461a, 23.6KB) + SafeProxyFactory v1.4.1 (0x4e1DCf…ec67), AND the v1.3.0
            pair, MultiSend, and the fallback handler all have bytecode on 4663. So a Safe can
            be created normally. Remaining unknown: whether the Safe **UI/transaction-service**
            (app.safe.global) lists 4663 — if not, create via safe-cli or the Safe SDK against
            these on-chain contracts. Contracts were the blocker; that's cleared.
      - [ ] Create the Safe (solo founder: 2-of-3 with keys on separate devices/locations
            beats 1-of-1, which is just an EOA with extra steps).
      - [ ] Pass the Safe address as `admin` in `Deploy.s.sol`.
      - [ ] Update `docs/security/signer-key-runbook.md`: the containment/rotation `cast send`
            commands become Safe transactions (Safe UI or safe-cli) — re-time the "<1 hour
            containment" target against how fast a 2-of-3 can actually sign.

## Website redesign — clean, fomo.family-inspired (added 2026-07-22)

Direction call (user): make finchpad clean like fomo.family (dark trader-terminal, dense but
tidy). Dropped the AI-generated cartoon finch mascot as "corny" — reverted to the simple
`web/public/logo.svg` finch; token/user avatars carry personality instead. The Higgsfield
mascot/hero/placeholder assets were removed.

- [x] **Top bar + account menu — SHIPPED.** fomo-style top-right: wallet cash in USD (ETH in
      title), a **Deposit** action (`useFundWallet`), and an avatar dropdown — Your profile /
      Manage account / **Blur balances** (a working privacy toggle, persisted) / Referrals /
      Log out. Blur balances hides only the viewer's own figures, never public market data
      (`web/src/lib/blurBalances.tsx`). Manage account modal shows the wallet address (copy),
      linked accounts, and link-email / link-wallet / export-wallet (`AccountMenu.tsx`,
      `AccountArea.tsx`, minimal `ui/modal.tsx`). Replaces the old `WalletButton`.
- [x] **Login = email + Google only (app side).** Privy `loginMethods` trimmed to
      `["email","google"]` (was wallet/email/google/github); external-wallet + GitHub login
      removed. Signup creates an embedded wallet — consistent with the embedded-wallet-only
      direction. **Dashboard hardening (set by user 2026-07-22, server-side):** email login
      blocks `+`-addresses and known temporary-email domains; SMS blocks VoIP numbers; automatic
      embedded-wallet creation on login is on (EVM). These are enforced in the Privy dashboard,
      not in our code — keep the app `loginMethods` and the dashboard's allowed methods in sync.
- [x] **MFA on transactions (Privy) — SHIPPED + live-tested 2026-07-22 (works).** Dashboard has MFA-
      for-transactions ON (all factors, 1-hour cache). Built: (1) enrollment in the Manage-account
      modal — "Set up two-factor auth" via `useMfaEnrollment().showMfaEnrollmentModal`
      (`AccountMenu.tsx`); (2) `MfaGate` (`web/src/components/MfaGate.tsx`, mounted in `App`)
      registers `useRegisterMfaListener` and completes the challenge with `useMfa` (`init` +
      `promptMfa`, Privy's default verification UI) — needed because `showWalletUIs:false`
      (one-click) means Privy no longer auto-shows the MFA prompt. **Not yet E2E-tested**: needs a
      user with an enrolled factor to do a live trade (TOTP enrollment needs an authenticator
      app). **Coupling to watch:** with MFA-for-transactions ON, every user must enroll a factor
      before their FIRST trade (first trade/hour prompts MFA; the rest of the hour is true
      one-click). If that first-trade friction isn't wanted, turn MFA-for-transactions OFF in the
      dashboard and one-click works with zero prompt.
- [ ] **SMS login — MAYBE (user undecided).** Dashboard supports it (VoIP blocked). If we want
      it, add `"sms"` to app `loginMethods`. Tradeoff: lowers signup friction and gives an MFA/
      recovery factor, but adds a phone-number PII surface and SMS cost. Decision pending; not
      added to `loginMethods` yet.
- [x] **Profiles + usernames — SHIPPED 2026-07-23.**
      - **Backend** (`src/backend/users.js`, own `data/users.db` so the indexer daemon keeps
        its single-writer lock): users table keyed by wallet address; **username UNIQUE**
        (URL identity) + **name** freeform + bio (280) + avatar (≤64KB data URI, client-
        downscaled via LogoPicker — no upload service next to the signing key). Username
        rules enforced server-side: ASCII-only pre-check + NFKC-must-be-noop + regex
        `^[a-z0-9]+(?:_[a-z0-9]+)*$` + 3–20 + reserved list — unicode "fonts", homoglyphs
        and zero-width chars can never enter a handle (7 tests pin this, incl. 𝓯𝓲𝓷𝓬𝓱/ｆｉｎｃｈ/
        cyrillic/zero-width rejections).
      - **Auth = wallet signature, no sessions**: updates signed over a payload hash +
        timestamp (10-min freshness), verified with viem `verifyMessage`. Zero new deps.
      - **API**: GET `/users/:username` (public profile + positions), `/users/by-address/:a`,
        `/users/check` (live availability), POST `/users` (the API's only write endpoint,
        JSON body capped). E2E-verified: signed create, read-back, taken-check, unicode
        rejection.
      - **Frontend**: `/profile/<username>` page — avatar/name/@username/bio/joined, portfolio
        value + total PnL, positions table (holding/value/invested/PnL per token, priced at
        last trade) derived from the indexer's per-trader swaps; Edit profile for the owner.
        `ProfileSetup` modal auto-prompts once per session after signup (default suggestion
        `user_<addr6>`, skippable), live availability check, pfp picker. Account-menu avatar
        shows the pfp; "Your profile" navigates or opens setup.
      - **Referral links upgraded**: `/r/<username>` resolves handle → wallet and lands on
        Launch with the referrer bound; ReferralsModal shows the friendly link when a handle
        exists (raw `/?ref=0x…` remains the fallback).
      - Follow-ups: positions ignore transfers outside finchpad pools (stated on the page);
        display-name homoglyph abuse is allowed by design (only usernames are strict);
        migrate users table to Postgres alongside the indexer when that migration happens.
- [x] **Referrals modal — SHIPPED 2026-07-23** (`web/src/components/ReferralsModal.tsx`, opened
      from the account menu). fomo layout: headline total earned (USD), "Earn {referralShareBps}%
      of the fees from every token launched through your link" banner (share read live off the
      locker), earned-last-7d + tokens-referred stats, copyable link, per-token earnings table.
      Data = indexed on-chain `ReferralPaid` events via `/referrals/:address`. The link is
      `/?ref=0x…` and is FUNCTIONAL: the Launch form reads `?ref=` and pre-binds it as
      `LaunchParams.referrer` (overridable in advanced). Swap to `/r/<handle>` once usernames
      exist. Figures respect Blur balances.
- [x] **SSE live updates — SHIPPED 2026-07-23** (decided over WebSockets: one-directional
      flow, zero-dep `node:http`, native EventSource reconnect). `/events` on the API emits
      `swap` and `launch` events by watching the indexer cursor (2s SQLite poll, diff-forward);
      client cap + heartbeat + `x-accel-buffering: no`. Frontend: shared EventSource singleton
      (`web/src/lib/live.ts`, lazy open / idle close) — token page reloads on its own swaps
      (800ms debounce), Explore reloads on launches instantly + swaps at 4s debounce (list
      reload fans out into detail fetches), Analytics nudges stats at 2s debounce between its
      30s ticks. E2E-verified: real fork swap → daemon → cursor → SSE frame in ~5s.
      Indexer→RPC stays polling by design (cursor+reorg is the reliable core; Alchemy WS is a
      prod latency optimization to revisit).
- [ ] **Profiles (fomo-style).** Profile page: avatar/banner/bio, following/followers,
      portfolio value + PnL chart (24H/7D/30D/ALL), positions table (avg entry/exit/PnL,
      open/closed), swaps table. Needs wallet identity + the R2 persistence layer (per-user
      holdings/positions), so it's the most blocked. Portfolio value in the top bar is deferred
      for the same reason (top bar shows spendable ETH as cash for now, no holdings valuation).
- [ ] **Deposit / funding on chain 4663 — the biggest unbuilt onboarding step (elevated
      2026-07-23, research deferred by user).** Chain economics, settled: Robinhood Chain is
      an Arbitrum Orbit L2 whose NATIVE gas currency is ETH — no separate gas token. Gas,
      trading, launch fees, fee splits, escrow, graduation thresholds, boost/feature prices
      are ALL ETH/WETH. Users don't "swap to Robinhood Chain" — they **bridge ETH from L1**
      and it arrives as native ETH. finchpad currently gives a real user zero guidance for
      that middle step, and for an embedded-wallet keep-volume-in-app product, funding is the
      make-or-break onboarding moment.
      Research list (in rough order of payoff):
      1. What Privy's `useFundWallet` modal ACTUALLY offers on 4663 — card on-ramps probably
         unsupported, but transfer-from-external-wallet may already work.
      2. The recommended bridge route: Robinhood Chain's canonical Orbit bridge (URL, UX,
         time-to-arrive), and — potentially the killer path — whether the **Robinhood app
         itself can withdraw ETH directly to a chain address**, which would let their retail
         users fund finchpad from their brokerage in one step.
      3. Third-party fast bridges / on-ramp partners supporting 4663, if any.
      Then design the Deposit flow around the findings: at minimum a "How to fund" panel with
      the bridge link; at best an embedded bridge/on-ramp in the Deposit modal.
- [x] **First-visit disclaimer gate — SHIPPED 2026-07-23** (`DisclaimerGate.tsx`): "Before you
      continue" overlay — unaudited/third-party-tokens/at-your-own-risk copy, checkbox with a
      hyperlink to `/terms`, Continue disabled until checked. Not dismissible any other way;
      localStorage-versioned key so a changed disclaimer re-prompts. `/terms` page shipped too
      (`routes/Terms.tsx`) — **content pending real legal review** (Phase 5 legal gate).
- [x] **Search + Oldest filter — SHIPPED** (Explore): search box filters by name, symbol, or
      contract address; "Oldest" added to the sort tabs.
- [x] **Footer — SHIPPED** (`Footer.tsx`): FontAwesome brand icons — X + Telegram (both
      @finchpad) + GitHub — plus a Terms link and the standing risk note.
- [x] **New fonts — SHIPPED**: Geist for UI text (replacing Inter), Space Grotesk for display
      headings/brand (h1s + `.display`).
- [x] **Real URLs — SHIPPED**: history-API routing without a router dep. Token pages live at
      **`/tokens/robinhood/<address>`** (user call, DexScreener-style chain-scoped), plus
      `/launch`, `/analytics`, `/terms`; API serves the app shell for these paths (SPA
      fallback) so deep links and refreshes work. `?ref=` survives navigation.

## Send / Withdraw + platform transaction ledger — SHIPPED 2026-07-23

- [x] **SendModal** ("Deposit · Send" in the top bar): send to a platform user by USERNAME
      (live-resolved with name+avatar shown before money moves), or withdraw to any pasted
      0x address. USD⇄ETH amount toggle, balance max-fill (keeps gas dust), self-send and
      insufficient-balance guards, embedded wallet → one-click + MFA apply.
- [x] **Trustless ledger recording**: after receipt, the client POSTs only the TX HASH; the
      server reads from/to/value FROM THE CHAIN (mined, successful, value>0) before inserting
      into a `transfers` table in users.db — a spoofed post can at worst record a real
      transaction. E2E-verified incl. spoof rejection.
- [x] **Activity page** (`/activity`, account menu → Activity): merged newest-first ledger of
      platform actions — buys/sells (indexer swaps by trader), launches (by deployer),
      referral payouts, sends (with @username counterparty links) / withdrawals / receives.
      Live-refreshes when your own swaps index. Scope per user call: platform activity only;
      header links to Blockscout for the full on-chain history. `GET /ledger/:address`.
- [x] **Ledger coverage for burns/collects/claims/boosts — SHIPPED 2026-07-23.** Each write
      component posts {type, token, txHash} to `POST /actions`; the server verifies the tx
      succeeded and was SENT BY the attributed actor (tx.from) before inserting into an
      `actions` table — self-attested but chain-verified, so nobody can claim another's action.
      Merged into `/ledger` and rendered on the Activity page with per-type icons.
- [x] **Per-token sends — SHIPPED 2026-07-23.** SendModal gained an asset selector (ETH +
      every indexed token the wallet holds, from `GET /holdings/:address`). ETH keeps the
      USD⇄ETH toggle; tokens send via `erc20.transfer` in token units. Ledger records token
      sends trustlessly: client posts {txHash, token}, server decodes the token's ERC-20
      Transfer log where `from == tx.from` and stores to/amount (transfers table gained
      nullable token/token_amount columns). Activity renders "Sent $SYM to @user · N SYM".
      Fixed a migration bug on the way (ALTER used `db.exec` instead of `_db.exec`, silently
      swallowed — existing users.db self-heals on next restart).
- [ ] Later: lock (separate FinchLock product, deferred). CTO backlogged — see the dedicated
      section below.

## Social-link domain validation on the launch form (idea 2026-07-23 — TODO, not built)

User idea: force the X field to be an x.com link and the Telegram field to be a t.me link.
**Verdict: mildly smart as a UX guardrail, low priority.** It's client-side cosmetic — the
socials are stored on-chain and a scammer can still paste a REAL t.me link to a fake group, so
this prevents wrong-field mistakes and obvious junk, not scams. Worth doing cheaply:
- [ ] X field: accept only `x.com` / `twitter.com` (both are Twitter) URLs or a bare `@handle`
      (normalize `@handle` → `https://x.com/handle`). Telegram: accept only `t.me` URLs or a
      bare `@handle`. Website: require `https://`. All fields stay OPTIONAL (empty is valid).
      Validate on the launch form only (`web/src/routes/Launch.tsx` Field/validate), reject with
      an inline message before signing. Don't over-engineer — a simple hostname check.

## Burn engine + live burn dashboard (idea 2026-07-23, ref PONS — folds into buyback-burn)

User shared how $PONS does it: fees accumulate → swap → burn every ~15 min, so burn rate tracks
trading volume in real time ("a live revenue meter" — you can watch US hours wake up in the
bars). They built a public dashboard reading burn txns live off Robinhood Chain, refreshing
~90s (stateofblocks.com/dashboards/pons-burn-monitor). 204M / 20.4% of supply burned.

**Verdict: yes, and it's already half-planned.** Two parts:
- [ ] **The burn engine = the deferred FINCH buyback-burn keeper** (see "Also still missing").
      Swap accumulated protocol fees → buy FINCH → burn, on a keeper (~15 min like PONS).
      GATED: FINCH must be launched through finchpad first to have a market; keeper is downstream
      of fee collection. This is the mechanic — build it before the dashboard has anything to show.
- [x] **Protocol burn metric — SHIPPED 2026-07-23**: "Value burned" tile on Analytics =
      Σ (initial SUPPLY − current supply) × price across all tokens. Works today (tokens are
      burnable now via the Burn action). This is the protocol-wide slice that doesn't need FINCH.
- [ ] **FINCH-specific live burn monitor** — the full PONS-style "live revenue meter": index
      the FINCH buyback-burn txns, show cumulative FINCH burned, % of FINCH supply, real-time
      burn rate, and a live txn feed via the SSE stream we already have. GATED on the keeper +
      FINCH being launched (nothing to show until then). Framing: burn rate = trading-volume
      proxy; watch US hours wake up in the bars.

## Skills available in ~/.agents/skills (noted 2026-07-23 — I'd missed these)

The Skill TOOL only lists higgsfield/privy/artifact skills, but `~/.agents/skills/` has a large
set NOT surfaced there — read them directly and follow when relevant. Polish-relevant ones:
- **accessibility** (WCAG 2.2) — APPLIED 2026-07-23 (two passes): accessible modals (focus
  trap/restore, scroll lock, aria-labelledby); aria-labels on all placeholder-only inputs;
  **contrast audit PASSED** (oklch→sRGB→WCAG computed: fg/bg 16.8:1, muted/bg 6.8:1,
  muted/card 6.3:1, primary/bg 8.3:1 — all above AA 4.5); **AccountMenu keyboard nav** (focus
  first item on open, arrows/Home/End, Escape returns focus to trigger); **chart text alt**
  (role=img label; Sparkline stays aria-hidden — decorative, data is text elsewhere).
  Still open: a live axe/Lighthouse run once the browser reconnects (catches things static
  review can't — reflow at 320px, focus-obscured 2.4.11, live-region announcements).
- **frontend-design** — APPLIED 2026-07-23: replaced the skill-flagged Space Grotesk display
  font with **Bricolage Grotesque** (characterful optical-size grotesque, distinctive without
  breaking the clean trader-terminal feel). Body stays Geist. Further ideas from the skill if
  we want more (all optional, keep restraint per the clean direction): one orchestrated
  staggered-reveal on the explore grid load; more atmospheric depth (subtle grain/noise);
  a signature hover micro-interaction.
- **gstack-design-review** — a full visual-QA skill (needs the gstack browser tooling + a live
  URL; screenshots before/after). Worth running once the Chrome extension is reconnected for a
  real rendered-pixel pass (spacing, hierarchy, mobile).
- Others present: gstack-* suite (design-consultation/html/review/shotgun, devex-review),
  context7-mcp, find-skills, etc.

## DEPLOY SEQUENCE (admin hand-off, finalized 2026-07-23)

Admin-power model, traced during the gate review:
- **FeeRightsRegistry** — `Ownable`. Powers: `setTrustedSigner` (rotate/kill signer),
  `approveCTO`. Transfers to the Safe (1-step) — the main launch-decision concern.
- **FinchLocker** — now `Ownable2Step` (made transferable this session; was immutable and would
  have stranded `setProtocolFeeRecipient` on the deployer EOA). Transfers to the Safe, Safe must
  `acceptOwnership()`.
- **FinchFactory** — `admin` immutable, but only does the one-time `setLocker`; harmless to
  leave on the deployer.

Deploy steps (`Deploy.s.sol` now automates the transfers when `FINCH_SAFE` is set):
1. Set env: `FINCH_ADMIN` = deployer (required for one-shot wiring), `FINCH_SAFE` = the 2-of-3
   Safe, `FINCH_GITHUB_SIGNER` = address(0) (claims disabled day one), plus the immutable args.
2. Run `Deploy.s.sol` — deploys, wires (setLocker/setRegistry), then transfers registry (done)
   + locker (pending) ownership to the Safe. Script prints the final step.
3. **From the Safe, call `FinchLocker.acceptOwnership()`** — completes the locker hand-off.
   Verify: `registry.owner()` == Safe and `locker.owner()` == Safe.
4. Verify contracts on Blockscout; point frontend/API env at the live addresses; smoke-test.
Covered by `test_admin_isOwnableTwoStepTransferToSafe` (2-step transfer, non-owner blocked,
old admin loses power). Before deploy: raise the Safe to 2-of-3 (currently 1-of-1).

## Partial open-source — decision + honest analysis (added 2026-07-23)

User idea: partially open-source finchpad for credibility, but not expose vulns — proposed
copying the same files into a separate public repo under an org.

**The copy-the-same-files approach does NOT work — flag before doing it.** A public repo with
identical source hands an attacker the exact code the live site runs; every vuln in the copy
IS a production vuln, and reading it there is as good as reading the private repo. It's all the
downside of open-sourcing (free auditing by attackers) with none of the protection. "Separate
repo" is not a security boundary — the code is the code. And the highest-value target, the
smart contracts, are ALREADY fully public + immutable on-chain (decompilable from bytecode,
and we'll likely verify them on Blockscout) — contract logic can't be hidden regardless.

**What actually achieves the goal (credibility without a drainer map):**
- [ ] **Split by sensitivity, not by copy.** Open-source the safe-to-expose parts, keep the
      sensitive parts private:
      - OPEN: `contracts/` (already public + on-chain), the frontend (`web/`), the read-only
        API surface. No secrets; attacking these still needs on-chain funds.
      - PRIVATE: the signer service (`src/backend/githubOauth.js` + `githubClaim.js` claim
        signing), key custody / `docs/security/signer-key-runbook.md`, anything touching
        `FINCH_CLAIM_SIGNER_KEY`. This is the "network-isolated signer next to the key" the
        plan already calls for — so the split is architectural, not cosmetic.
      Mechanically: either a public mirror that excludes the private paths (git filter/subtree,
      NOT a full copy), or physically move the signer service into its own private repo/service
      and open the rest. The latter matches the production deploy topology anyway.
- [ ] **Remember the real protections live elsewhere** (all already in deploy-prep gates):
      signer key in HSM/KMS, admin behind a Gnosis Safe, the external audit. Source obscurity
      is a distant, mostly-illusory fourth — do the split for CREDIBILITY, not as a security
      control, and don't let it create a false sense of safety.
- [ ] Decide license (MIT is already declared in package.json) and what "partial" means
      publicly — a clear README on the public repo about what's open and why the signer path
      isn't.

## CTO — Community Take Over (BACKLOGGED 2026-07-23, not built)

**What it is:** when a token's creator abandons it, the community can take over its fee
rights. On-chain this is `FeeRightsRegistry.approveCTO(token, newController)` — **admin-only**
(`onlyOwner`) — which calls `locker.setControl(token, newController, newController)`, moving
both the controller and the fee wallet to the new steward, and emits `CTOApproved`. It's
blocked while a GitHub binding is unclaimed and still in-window (the fee right belongs to the
identity, not the admin), allowed after expiry. So CTO is a HUMAN-REVIEWED admin action, not a
permissionless call — which is exactly why it needs a request+review pipeline, not just a button.

**Why it's bigger than the other write flows:** every other creator action (burn, collect,
redirect, claim, boost) is either permissionless or gated to an address the contract already
checks. CTO needs (a) a public REQUEST form, (b) an off-chain REVIEW queue, and (c) an admin
who executes the on-chain call — three surfaces, plus a trust/anti-abuse story.

**Build plan when picked up:**
1. **Data** — `cto_requests` already specified in `src/backend/schema.sql` (token, requester,
   proposed_controller, evidence, status pending/approved/rejected, reviewed_by/at). Mirror it
   into the SQLite users.db (the live store) with the same idempotent-migration pattern.
2. **Request API** — `POST /cto` authorized by a WALLET SIGNATURE over {token, proposedController,
   evidence, timestamp} (reuse the profile-signature pattern in users.js — no sessions). Rate-
   limit per address; validate the token is finchpad-launched, is NOT an in-window unclaimed
   GitHub binding (those can't be CTO'd yet — surface why), and proposedController is a real 0x.
   `GET /cto/:token` lists a token's requests; `GET /cto?status=pending` for the admin queue.
3. **Request UI** — a "Request take-over" entry on the token page, shown when the token looks
   abandoned (no recent activity / creator silent) — a modal collecting the proposed controller
   (default: connected wallet) + an evidence text field (links to the abandoned socials, etc.).
4. **Admin review surface** — a gated `/admin` route (allowlist by address, or a signed admin
   check) listing pending requests with approve/reject. **Approve does NOT auto-execute** —
   admin is a Gnosis Safe per the launch decision (see top of file), so the UI should PREPARE
   the `approveCTO` Safe transaction (or show the exact `cast send`/Safe payload) rather than
   sending from a hot key. Reject just updates status + reviewer.
5. **Anti-abuse / trust** — CTO reassigns a real fee stream, so: evidence is mandatory, requests
   are public (visible on the token page so the incumbent can contest), and the admin/Safe is
   the backstop. Note in the UI that CTO is discretionary and human-reviewed, never automatic.

**Gates:** depends on the admin Safe existing on chain 4663 (see LAUNCH DECISIONS) for the
execute step; the request+queue half can be built and tested before that.

## Token display — show liquidity (added 2026-07-22)

- [ ] **Show pool liquidity.** Surface each token's Uniswap V3 pool liquidity/depth on the token
      cards (Explore) and the token page — the on-chain liquidity is already readable
      (`pool.liquidity()` / `slot0`, see `poolAbi` in `web/src/lib/trade.ts`; backend can derive
      a WETH-denominated TVL from the pool's WETH balance + price). Traders read liquidity as the
      key "can I actually get in/out" signal, so it belongs next to market cap. Decide the metric:
      WETH/USD value locked in the pool (simplest, intuitive) vs raw V3 `liquidity`. Note finch
      liquidity is **permanently locked** (that's a selling point) — label it so, and it pairs
      well with the existing graduation/locked-liquidity trust framing.

## Token page polish (2026-07-23)

- [x] **Total fees on the token page — SHIPPED**: GraduationCard now shows **Total fees
      earned** (lifetime banked + uncollected pending), **Fees distributed** (banked minus
      escrow), and **Held in escrow** when a GitHub binding is unclaimed.
- [x] **Graduation updates live — FIXED**: two causes — the server cached token detail for
      10s (now 3s), and swaps only move the PENDING slice. Buys now tick
      `claimableFeesEth` client-side in real time (+1% of the WETH in — the pool fee lands on
      the input side, so sell fees accrue token-side and don't tick), with the debounced
      authoritative reload reconciling behind it.
- [x] **Profile "Set up" flash on fresh tabs — FIXED**: the auto-prompt fired off a single
      transient null during wallet init. Now it (1) confirms with a second fetch 800ms later
      before ever opening, (2) self-closes if a profile materialises while an auto-opened
      modal is up, and (3) `/users/by-address` is `cache-control: no-store` so a cached
      "no profile" can never outlive profile creation. Root cause of the transient null not
      pinned (suspect Privy wallet init ordering) — the triple guard makes it moot.
- [x] **Feature vs Boost copy clarified** (user asked the difference): Feature = temporary
      paid placement in Explore's Featured rail, per-day, expires, stacking extends. Boost =
      permanent one-time ⚡ cosmetic badge, no placement change. Card copy now states both.

## Trading UX — one-click buy/sell without signing every trade (added 2026-07-22)

**Scope call (user 2026-07-22): one-click is EMBEDDED-WALLET ONLY.** The goal is to keep volume
in-app — nudge people onto the finchpad embedded wallet (Privy) rather than supporting session
keys for external wallets like MetaMask. So the ERC-4337/EIP-7702 external-wallet path below is
explicitly DEFERRED; external-wallet users keep signing per trade (and that's the incentive to
move funds into the app wallet). Verify with the installed **`privy` skill** (and Context7) before
building.

**Privy levers already configured in the dashboard (user 2026-07-22) — these ARE the one-click
mechanism for embedded wallets:**
- **"Disable confirmation modals (react-auth only)"** — turns off Privy's default review-before-
  sign UI for embedded-wallet transactions. This is the switch that removes the per-trade popup;
  pair it with finchpad's own clear pre-trade review in `TradePanel` so we don't lose the
  what-am-I-signing surface entirely.
- **MFA-for-transactions ON, 1-hour cache** — so the flow is: user verifies MFA once, then trades
  freely (no modal) for an hour. That's the real "click buy/sell and it goes" behaviour, without
  raw session keys. Session duration 30d, access-token 1h, signing-key 60min are also set.
- Net: for embedded wallets, one-click may not even need custom session signers — disable-confirm-
  modals + cached MFA gets most of the way. Session signers / `delegated-actions` remain the
  option if we want fully headless (server-signed) trading later. Confirm exact behaviour against
  the `privy` skill before wiring `TradePanel`.


User pain: having to confirm in MetaMask on every single buy/sell is annoying — wants to just
click Buy / Sell and have it go through.

Reality check before anyone chases "make MetaMask stop prompting": an external EOA (MetaMask,
Rabby, hardware) confirms **every** transaction by design — the wallet, not finchpad, owns that
prompt, and there is no API to suppress it. So this is not a bug to fix in `trade.ts`; it needs
a different signing model. What we can actually do, cheapest first:

- [ ] **Collapse the two-prompt sell into one (EIP-5792 `wallet_sendCalls`).** First sell of a
      token is approve + swap = 2 prompts; subsequent sells are already 1 (we approve
      `maxUint256`, `TradePanel.tsx:144`, and skip when allowance is set, `:141`). Batching the
      first sell's approve+swap into a single `wallet_sendCalls` makes it one confirmation on
      wallets that support 5792. Does NOT remove the per-trade prompt — just halves the worst case.
- [ ] **Permit2 instead of a separate approve** — same idea from the allowance angle; a signed
      permit rather than an on-chain approve tx. Still a signature per trade, so low payoff on
      its own; only worth it bundled with the above.
- [x] **Buy in USD or ETH — SHIPPED.** The buy "You pay" field has a USD⇄ETH toggle
      (`TradePanel.tsx`): enter a fiat amount and it converts to ETH (via `ethUsd`) for quoting +
      execution, with the ETH equivalent shown beneath and `$10/$50/$100/$500` presets. Sell
      stays in token units. Falls back to ETH-only when the price feed is down.
- [x] **One-click for embedded wallets — SHIPPED via `showWalletUIs:false`.** Set in
      `main.tsx` PrivyProvider config: embedded-wallet transactions no longer show Privy's
      confirmation modal, so buys/sells go through on one click. Our own `TradePanel` review +
      launch review remain the "what am I signing" surface; MFA (MfaGate) still gates txns. Trade
      toasts updated (no more "confirm in your wallet"). Turned out NOT to need custom session
      signers — disable-confirm-modals + cached MFA is the mechanism, exactly as the dashboard
      config predicted. Session signers / `delegated-actions` remain available if we ever want
      fully headless/server-signed trading.
- [ ] **The real fix — session keys / delegated signing (one click, no popup).** Requires a
      smart-account wallet, not a bare EOA:
      - Privy embedded wallets (already our default for `users-without-wallets`,
        `web/src/main.tsx:39`) support **session signers / delegated actions**: the user grants
        finchpad a scoped session once ("trade up to X ETH for the next N minutes/on this token"),
        after which buys/sells execute with no per-tx prompt. This is the flow that feels like
        pump.fun / a CEX.
      - For users on **external** wallets (MetaMask et al.), the equivalent is an ERC-4337 smart
        account with a session key, or EIP-7702 to give their EOA smart-account powers. Bigger
        lift; decide whether we support it or just nudge external-wallet users that one-click
        needs the embedded wallet.
      - Security must be explicit and bounded: per-session spend cap, expiry, revoke-anytime,
        and it only ever authorizes swaps on finchpad pools — never arbitrary transfers. This is
        new drainer surface, so it goes through `/security-review` (see the Phase 5 gate) before
        shipping. Blind-signing rule still holds: the *grant* screen must show exactly what the
        session can do.
- [ ] **Gas sponsorship (optional, stacks on session keys).** A paymaster can cover gas so a
      buy needs no ETH-for-gas at all — removes the other reason a trade stalls. Only meaningful
      once smart accounts are in; note it, don't build it yet.

Decision needed from user before building: is one-click **embedded-wallet only** (simplest,
covers the onboarding-a-new-user case), or do we also invest in session keys for external
wallets? Recommend embedded-only first.

## Marketing / distribution — GeckoTerminal DEX/chain listing (added 2026-07-22)

Surfaced via a Discord DM (a launchpad-partnerships contact, "Tim", asked what finchpad offers
and what would help him decide — reply was to send docs + socials; ~2 weeks old project).
Separately worth doing regardless of that thread: apply at
https://about.geckoterminal.com/dex-chain-listing to get finchpad pools discoverable
(price/chart aggregators are a standard discovery channel for new launchpads, same as
DexScreener-style indexing the contracts already emit events for).

**Socials/contact (for the listing form and any partnership DMs):**
- Twitter/X: `@finchpad`
- Telegram channel: `@finchpad`
- Telegram support (personal): `@pickledev`

- [ ] **Submit the GeckoTerminal listing form** (Google Form via the page's "Get Listed"
      button). Choose **Express Listing** (~7 days) over Regular (~3 months) given the launch
      timeline.
- [ ] **Check whether Robinhood Chain (4663) + its Uniswap V3 deployment are already listed**
      before assuming this is a from-scratch chain application — finchpad launches trade
      through the SAME shared Uniswap V3 factory/router pons already uses on this chain
      (`PONS.v3Factory` / `swapRouter` in `src/lib/contracts.js`:
      `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` / `0xCaf681a66D020601342297493863E78C959E5cb2`,
      WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`). If pons already has GeckoTerminal
      volume, the chain/DEX pairing may already exist and this is just adding finchpad as
      another project trading through it, not a new listing.
- [ ] **Blocked on mainnet deploy** — no live finchpad pools exist yet (see "Mainnet deploy"
      gate above); the form needs a real deployed factory/pool to point at, so this can't
      actually be submitted until after Phase 5 + the mainnet launch.
- [ ] Have docs + socials ready to send when asked (partnership DMs are already asking for
      this): README, PLAN.md, `@finchpad` on Twitter/Telegram, `@pickledev` for support
      contact, docs/ folder.

## "Claim fees" flow — token-page claim SHIPPED 2026-07-23 (creator menu still later)

The token-page half is built and wired end to end:
- **Popup OAuth**: `/auth/github/start?…&mode=popup` → GitHub → callback renders a page that
  postMessages the signed claim to the opener (origin-locked) and closes. JSON mode unchanged
  (existing oauth tests untouched).
- **ClaimFees card** (`web/src/components/ClaimFees.tsx`, token page, shown only while a
  binding is unclaimed): explains the escrow (amount shown), repo input for repo-bound tokens,
  "Verify with GitHub" popup, then submits `registry.claimGithub()` from the connected wallet.
  Friendly pre-checks before gas: verified identity must match the BOUND numeric id, payload
  must be signed, claimant must equal the connected wallet.
- **Dev signer provisioned on the fork**: `npm run dev` now deploys the registry with anvil
  account #9 as `trustedSigner` and gives the API the matching `FINCH_CLAIM_SIGNER_KEY`
  (publicly-known anvil key, meaningless off-fork; production uses HSM/KMS per the runbook).
  Also writes `FINCH_CHAIN_ID=<fork id>` so the EIP-712 domain matches the fork.
- **E2E note**: seeded tokens bind FAKE github ids, so the real browser test is: launch a
  token bound to YOUR GitHub user via the launch form (resolves the real id), then claim it
  on the token page. Needs a fresh `npm run dev` (re-seed deploys the signer-enabled registry).

Still later (the creator-facing menu): sign in with GitHub → list every token bound to that
account (`GithubBound` indexed by githubId + `escrowOf()`) → claim each / redirect fee wallet.
Production gate unchanged: real signer key in HSM/KMS, signer service isolated from the
public API, GitHub claims disabled at mainnet deploy until the claim flow has outside eyes.

## ROADMAP (set 2026-07-22, after PR #8 merged)

Five priorities, in the only order the dependencies allow. The sequencing matters more than
the list: items 1/3 are blocked on write flows that do not exist, 2 is blocked on
persistence, and 5 is blocked on being live.

**R1. Frontend — build the write flows (this is not "polish").** The UI is 100% read-only
today: list, token detail, chart, trades, featured rail, and a GitHub-claim button that only
opens an OAuth URL. There is **no wallet connection anywhere** (zero references to
ethereum/walletconnect/sendTransaction in web/index.html), so no user can launch, trade,
lock, burn, claim, boost, or request a CTO from the site. Polish comes after these exist.
  - [x] **Wallet connect — DONE (Privy).** `web/` is now a Vite+React app (Privy's web SDK is
        React-only). Kept as its own package so the backend stays zero-dependency next to the
        signing key. Chain 4663 via viem `defineChain`; embedded wallets on login so someone
        with no wallet can still launch. Only the PUBLIC app id ships — the Privy app secret
        is unused by finchpad and should be deleted in the dashboard (it transited chat).
  - [x] **Launch flow — DONE.** Full LaunchParams incl. claimKind/githubId/referrer, curve
        math ported to TS, simulate-before-sign, plain-language review block (fixed supply,
        locked liquidity, who gets the fees) instead of blind signing. Token address is
        predicted from the factory nonce (address ordering picks the tick side); if another
        launch lands first the simulate fails and the UI offers a retry instead of burning a
        signature.
  - [x] API serves `web/dist` with an extension-allowlisted, traversal-checked asset handler
        plus CSP / nosniff / referrer-policy (closes F3 from the adoption report).
  - [x] CI: frontend job (typecheck + build + `npm audit --audit-level=high`). Privy 3.35.1
        arrived with 32 advisories incl. 2 high (viem 2.52.0, ws, axios, uuid); pinned
        patched versions via `overrides` -> audit reports 0. Revisit when Privy bumps.
  - [x] **Trade flow — DONE.** Buy/sell with live QuoterV2 quotes (debounced, stale-response
        guarded), slippage selector (auto/0.5/1/3%/custom), price impact with escalating
        warnings, minimum received, network fee estimate, transaction progress toasts, and
        readable revert decoding. Buys spend native ETH in ONE transaction (SwapRouter02
        wraps it); sells approve then swap+unwrap in a multicall so the seller receives ETH,
        not WETH. Verified against live Uniswap on a fork: buy 44.39M tokens for 0.05 ETH at
        149,903 gas; sell returned native ETH with a WETH delta of exactly 0.
  - [x] **Token page**: TradingView lightweight-charts candles, recent trades, market cap,
        volume, supply, graduation progress, plus a transparency panel stating locked
        liquidity, fixed supply, fee wallet, fee split, GitHub binding and escrow state —
        including the unflattering cases (unclaimed escrow, not-from-this-factory).
  - [x] **USD everywhere** — price, market cap, volume and trades show USD with ETH beneath.
        ETH/USD is fetched server-side and cached 60s, deliberately: doing it in the browser
        would add a CSP origin to the page that prompts signing, and rate-limit per visitor.
        Falls back to ETH-only if the feed is unavailable.
  - [x] Removed the farcaster field; "start market cap (ETH)" is now "starting valuation"
        with USD presets and an explanation of what it actually sets.
  - [x] **Content moderation: NOT doing it.** Decided against — the pad is decentralized and
        name filtering is not its job. The injection half (esc()) stays, since that is an
        XSS defence, not a content policy.

## Anti-snipe protection removed 2026-07-22

Launch protection is gone from FinchToken: no `restrictionsEndBlock`, no wallet/buy caps, no
launch-block-creator-only rule, and the `_update` override is deleted entirely. The token is
now a plain ERC20Burnable. `launchBlock` stays as an informational birth block.

Rationale (user call): the caps punished real buyers as often as bots, and their reverts
surfaced through Uniswap as an opaque "TF" that is indistinguishable from a broken pool —
it cost real debugging time twice in one day.

- [x] **R2 SHIPPED — atomic creator buy + fee wallet at launch.**
      `LaunchParams` gains `creatorBuyAmount` and `feeWallet`. The opening buy is an ordinary
      swap through the public router at AMM price — no minted allocation, no discount, no
      privileged path — and is atomic, so nobody can position ahead of it. `feeWallet` is set
      at registration, so fees never briefly point at the launcher first. Factory takes the
      router as a constructor arg (`FINCH_SWAP_ROUTER`).
      Tests (90 green): buy executes inside launch, creator receives the tokens, **the creator
      pays exactly what an external first buyer pays for the same size** (asserted by pricing
      an identical no-buy launch through the router and comparing), underfunded buy reverts,
      zero-buy launch works, fee wallet routes fees from block one, zero fee wallet defaults
      to the creator.
- [x] **GitHub binding takes a username / owner-repo, not a numeric id.** The UI resolves it
      through `/github/resolve` (server-side: unauthenticated GitHub is 60/hr per IP, and
      doing it in the browser would burn the visitor's quota and add a CSP origin to the
      signing page) and shows the creator exactly which numeric id will be written on-chain.
      The contract still binds the id — that is the rename/squat protection.
- [x] **Launch form restructured**: advanced menu hides fee rights, fee recipient, opening buy
      and referrer; the opening-price line is gone entirely; token image is now a file picker
      that centre-crops and downscales to 128px in the browser rather than a pasted URL.
- [ ] **Decide where token images live.** The picker currently emits a data URI: self-contained
      and cannot rot, but it is stored on-chain with the token and costs real gas (capped at
      ~24KB). The alternatives are an IPFS pin (needs a pinning service) or a finchpad upload
      endpoint (needs a POST route on a service that will sit next to the signing key). This
      is the only part of the image change that is not finished.
- [ ] **OPEN — fee wallet immutability conflicts with the fee-rights layer.** The review asks
      that the fee recipient only ever be settable at launch. That cannot hold as written:
      GitHub claims move the fee wallet from escrow to the claimant (the whole feature), and
      admin CTO reassigns abandoned tokens. Making it immutable deletes both. Options: keep it
      mutable but fully evented and surfaced (current), OR make it immutable only for
      non-GitHub launches. Needs a call.
- [x] ~~CONSEQUENCE — R2 is now urgent~~ (done above). Original note: With no protection, the first buyer
      in the launch block wins, and a creator has no way to be that buyer: `launch()` does
      not buy, and a follow-up transaction lands a block later. Anyone watching the mempool
      can take the opening size. An atomic initial buy inside `launch()` is now the ONLY way
      a creator gets a fair entry into their own token.
- [ ] Re-run the Phase 5 pass over the modified token/factory before mainnet — the transfer
      hook was on the money path.
  - [x] Submit `claimGithub()` — SHIPPED (token-page ClaimFees + account-menu ClaimCenter)
  - [x] Burn — SHIPPED (TokenActions); **Boost purchase — SHIPPED 2026-07-23, REDESIGNED same
        day (user call): ONE product, time-based stacking boosts.** v1 briefly sold day-based
        "featuring" + a permanent badge; both collapsed into a single hour-based Boost BEFORE
        any deployment. `FeatureBoost.sol` rewritten (name/envs kept to avoid tooling churn):
        `boost(token, numHours)` payable at `pricePerHour` (default 0.001 ether/h), stacks —
        active window extends, lapsed restarts from now — `boostedUntil` mapping,
        `Boosted(token,payer,until,paid)` event, 720h cap, 11 tests incl. stacking/expiry
        semantics; Deploy env is now `FINCH_BOOST_PRICE_PER_HOUR` (old FINCH_FEATURE_PRICE /
        FINCH_BOOST_PRICE gone). UI: PromoteCard sells 6h/12h/24h with active-until shown;
        boosted tokens get the ⚡ badge, a **highlighted card** (tinted surface, bright border,
        glow) and the **top "Boosted" rail** on Explore while STAYING in the organic feed
        (placement adds, never reorders — user's explicit call). Paid-placement labeling kept
        everywhere: paid ≠ vetted.
  - [x] Redirect fee wallet — SHIPPED (controller-gated card in TokenActions). Lock (FinchLock,
        deferred) and CTO-request (backlogged, own section) remain.
  - [ ] No blind-signing anywhere: show exactly what is being signed
  - Build against the local anvil fork — `npm run dev:fork` + `npm run dev:seed` already
    stand up a real chain seeded with 4 tokens (plain, referred, repo-bound, user-bound)
    plus a featured and a boosted one. There is no live testnet (no Uniswap on RH testnet).

**R2. Persistence — SHIPPED 2026-07-23 (SQLite; Postgres later).** Indexer daemon
(`src/indexer/daemon.js`) tails launches (both event shapes), swaps (normalized, with
`trader` = tx.from for real trader counts) and `ReferralPaid` payouts into SQLite
(`src/indexer/db.js`, `data/finchpad.db`) via Node's built-in `node:sqlite` — chosen over
Postgres to keep the backend zero-dependency next to the signing key.
**User call 2026-07-23: migrate to Postgres later** (multi-service/scale); `schema.sql`
remains the target shape for that migration — keep it in sync when the SQLite schema changes.
  - [x] Daemon: resumable cursor, 30-block reorg overlap with prune+reinsert (PK-deduped),
        atomic per-pass transactions, `--once` mode, spawned by `npm run dev` (DB wiped on
        re-seed so a fresh deployment never serves stale rows). `npm run index:daemon` alone.
  - [x] API switched to DB-backed reads with live fallback when no DB exists: `/tokens` is
        now ALL-TIME (not block-windowed), `/tokens/:a/trades` + `/candles` from swaps.
        Response shapes unchanged. New: **`/stats`** (all-time + 24h volume/trades/traders,
        tokens launched, combined mcap + locked liquidity cached 2min) and
        **`/referrals/:address`** (total/7d WETH + per-token earnings — the referrals modal's
        data source, ready to build on).
  - [x] **Analytics page shipped** (`web/src/routes/Analytics.tsx`, nav tab): 7 tiles modeled
        on the PotatoPad reference — volume all-time/24h, tokens launched (+traded 24h),
        trades all-time, traders 24h, combined market cap, liquidity locked — all from our
        own indexer, no GeckoTerminal dependency. Auto-refreshes every 30s.
  - [ ] Holders/concentration + fee_claims tables (schema.sql has the shapes; not wired yet)
  - [ ] Postgres migration when scaling beyond one service (user call, see above)

**R3. Analytics dashboard.** Depends on R2. The events to build on already exist and are
indexed by design: `Launched`, `Swap`, `FeesCollected`, `ReferralPaid`, `Graduated`,
`GithubBound`/`GithubClaimSettled`/`EscrowAccrued`/`EscrowSwept`, `Featured`/`Boosted`.
  - [ ] Protocol: launches/day, volume, fees earned + split, referral payouts, graduation rate
  - [ ] Per-token: holders, concentration (rug-risk, already self-validating), fee history
  - [ ] Per-creator: tokens by githubId, claimed vs escrowed
  - [ ] Revenue: launch fees, protocol share, FeatureBoost sales

**R4. Creator onboarding.** Depends on R1.
  - [ ] Launch wizard with sane curve defaults (do not make people pick ticks)
  - [ ] GitHub-bound launch as a first-class path (claim your repo's/your own token)
  - [ ] Post-launch: share card, fee-claim explainer, lock-your-allocation prompt
  - [ ] Docs: what fees you earn, what graduation does, what locking signals

**R5. Threshold calibration — only possible once live.** `FINCH_GRAD_FEE_THRESHOLD`
currently defaults to 0.25 ether (~25 ETH of buy volume at the 1% tier); the referral bps and
graduation bonus bps are likewise guesses. Needs real launch data from R2's tables.
  - [ ] Instrument, observe, then retune. **All three are immutable constructor args**, so
        retuning means deploying a new factory/locker set — decide the numbers before the
        deploy that takes real liquidity, not after.

---

## SEQUENCING WARNING — "security review before significant TVL" is too late

Contracts are immutable and ship as new addresses. The locker holds each launch's LP NFT
**permanently**, so tokens launched on v1 can never migrate to a fixed v2 — their liquidity
and fee rights stay on the buggy version forever. A bug found after launch #1 is not "lose a
little TVL", it is "every early creator is permanently stranded on a version we cannot
patch". The review therefore has to gate the **first mainnet deploy that accepts real
liquidity**, not a TVL number.

Hard gates before that deploy (from docs/security-audit.md + PLAN.md Phase 5):
- [ ] **Independent third-party audit** (internal review found 2 Highs; assume more exist)
      — **user call 2026-07-22: moved post-launch** (see LAUNCH DECISIONS at top +
      `docs/launch/audit-plan.md`); replacement gate: GitHub claims disabled at deploy
- [ ] **Legal review** — US securities / money-transmitter; buyback-burn can read as a dividend
- [ ] **`admin` behind a multisig + timelock** — today one key can redirect any token's fee
      stream via `approveCTO` — **user call 2026-07-22: Gnosis Safe, decided** (see LAUNCH
      DECISIONS at top; still unchecked until the Safe exists and is the deployed admin)
- [ ] **GitHub signer key in HSM/KMS**, signer service network-isolated from the public API —
      a hot key next to the web server is the single worst deployment mistake available
- [ ] **Rotate the OAuth client secret** (it transited a chat during setup; still not done)
- [ ] Echidna / formal pass on the locker's fee accounting
- [ ] `/security-review` on the frontend+backend diff once R1 exists (wallet flows are new
      drainer surface; the XSS fix already shipped, but signing UX has not been reviewed)
- [ ] Deploy with a small treasury first; do not seed large liquidity on day one

## Also still missing, not in the five (each blocks "done")

- [ ] **FINCH buyback-burn keeper.** The burn mechanic does not exist. Protocol fees just
      accumulate at `protocolFeeRecipient`. FINCH itself must also be launched through
      finchpad to give the buyback a market.
- [ ] **Mainnet deploy** — needs a funded deployer key (you run `Deploy.s.sol`, I never touch
      it). No testnet rehearsal is possible: RH testnet has no Uniswap V3.
- [ ] **`block.number` semantics on Arbitrum** — decide keep (recommended) vs `ArbSys`.
- [ ] Frontend CSP + security headers, and generic 500s (F3/F4 in the adoption report).

## PR #8 review (monetization: referral / graduation rewards / featured) — 2026-07-22

Reviewed locally with a real Foundry+Slither toolchain (cloud CI couldn't run them).
CI now green on all 4 jobs. Fixed on the branch: SeedLocal stack-too-deep at
`forge build --sizes` (run() held 6 contracts + 4 tokens live through the console.log
block; now state vars), and 2 Slither Medium false positives (uninitialized-local on
the referrer amounts, unused-return in markGraduated).

- [x] **FIXED: graduation now uses protocol-controlled accounting.** The spot
      `IERC20(weth).balanceOf(pool)` read is gone from the money path. `collect()` banks the
      WETH fees the locker actually pays out (`lifetimeWethFees`) and derives graduation from
      that total; monotonic by construction, so `markGraduated()`, the `graduated` flag, the
      AlreadyGraduated/NotGraduated errors and the IFinchFactoryGraduation interface were all
      deleted. Original PoC re-run against the new code: 10 ETH donated, zero trades, fee
      bonus does NOT move. Threshold is an immutable ctor arg (default 0.25 ether via
      FINCH_GRAD_FEE_THRESHOLD ~= 25 ETH of buy volume at the 1% tier; uint256.max disables).
      `Graduated(token, lifetimeWethFees)` still fires once for chart markers. 87 Foundry +
      35 JS green, incl. a fuzz property that the accumulator advances by exactly the
      collected WETH and never by donations or token-side fees.
- [x] **Progress bar and fee bonus now use ONE metric.** `FinchFactory.graduationStatus()`
      no longer reads the pool balance — it delegates to the locker's accounting, so a
      donation moves neither the money path nor the visible bar (which could otherwise fake
      traction to lure buyers). `GRADUATION_THRESHOLD` (4.2 ether) deleted from the factory;
      the threshold lives in the locker, one source of truth. API/UI follow
      (`graduation.earnedFeesEth`, bar labelled "fees earned"); the redundant `traction`
      field is gone; the pons factory ABI is untouched. Fork-verified against live Uniswap:
      a 0.05 WETH buy alone moves progress 0, then collect() steps it to 0.0005 WETH
      (exactly the 1% fee), with factory and locker asserted equal.
      Tradeoff: the bar steps on each collect() rather than sliding per trade. collect() is
      permissionless so the UI or a keeper can poke it, and creators call it to get paid.
- [x] **Renamed the paid badge to "boosted"** (your call, done on the branch). Anyone can
      buy it for any token including their own scam, so "verified" would have read as
      "vetted by finchpad" — the exact false assurance an anti-scam-spam pad must not sell.
      `verify()`->`boost()`, `verified`->`boosted`, `verifyPrice`->`boostPrice`,
      `Verified`->`Boosted`, `AlreadyVerified`->`AlreadyBoosted`,
      `FINCH_VERIFY_PRICE`->`FINCH_BOOST_PRICE`; ABI/seed/README follow. Nothing rendered
      it yet, so there was no migration. CI green on all 4 jobs.

## Stale branches cleaned 2026-07-22

- Deleted `claude/readme-update-vt2fpj` (fully merged into master) and
  `claude/security-audit-adoption-twk0ef` (PR #1 closed; content ported to master in
  04e1a1d, verified present before deleting).
- `ALCHEMY_RH_MAINNET` set as a repo secret: the public RH RPC now serves Cloudflare bot
  challenges to GitHub runners (13x HTTP 403, reproduced twice), so fork tests in CI need
  it. Fork job green with it set.

## Contract revision 2026-07-21 (user + repo claims, pre-claim escrow)

- [x] **ClaimKind {None, Repo, User}** replaces bare repoId across factory/locker/registry.
      User claims (bags.fm-style) sign over the OAuth'd account's own numeric id — no repo,
      no scopes, no admin check. EIP-712 struct is now
      `GithubClaim(address token,uint8 claimKind,uint256 githubId,address claimant,uint256 deadline)`;
      JS/contract digests re-cross-pinned for BOTH kinds.
- [x] **Pre-claim escrow** (closes the plan-vs-code gap): GitHub launches give the launcher
      no fee rights; creator share escrows in the locker until the identity claims (backlog
      paid on claim). 365-day expiry → `sweepEscrow()` by anyone → protocol recipient
      (buyback path); post-expiry unclaimed creator share follows it. Admin CTO is blocked
      while a binding is unclaimed and in-window (fee right belongs to the identity, not
      the admin), allowed after expiry.
- [x] **Observability for charts/DexScreener-style indexers**: indexed events
      `GithubBound(token, kind, githubId)`, `EscrowAccrued`, `GithubClaimSettled(token,
      claimant, amounts)` (the chart-bubble event), `EscrowSwept`; views `escrowOf()`,
      `githubBindingOf()`; API token detail now returns a `github{kind, githubId, claimed,
      escrow…}` object.
- [x] 97 tests green (64 unit/fuzz Foundry incl. new escrow-conservation property, 5 fork
      against live Uniswap, 28 JS). Sizes fine (max 8.4KB vs 96KB).
- [ ] Re-run the full Phase 5 pass (slither/manual) over the revision before audit —
      escrow is new money-holding surface. Self-review pass done 2026-07-21: found + fixed
      FeesCollected under-reporting the creator payout in the post-expiry-CTO branch
      (event-accuracy bug, indexers bill off that event); EscrowAccrued no longer emits
      zero-amount noise. CI Slither (fail-on: medium) green over the revision.

## Phase 3 website — started 2026-07-21

- [x] Token page GitHub surface: binding (kind + id), claimed pill, live escrow balance
      ("unclaimed creator fees"), claim-by deadline, and a claim button that launches the
      OAuth flow (typed-in payout wallet until wallet-connect lands).
- [x] PR #1 security fixes ported to master (XSS escapes incl. error messages, API param
      clamps); PR closed. Dependabot #2/#4/#5 merged, #3 applied manually (conflict).
- [x] Wallet connect (Privy), launch flow, and the full trading experience — all shipped.
- [x] **Burn + Collect fees — SHIPPED** (`web/src/components/TokenActions.tsx`, on the token
      page). Burn: any holder destroys their own tokens (`erc20.burn`), gated to when you hold a
      balance. Collect fees: permissionless `locker.collect(token)` — banks accrued fees to the
      fee wallet and advances graduation, shown for finchpad-launched tokens. Both go through the
      embedded wallet (one-click + MFA). UI/gating/build verified; execution pending a user test
      (MFA blocks automated testing).
- [ ] Remaining write flows: **claim-fees menu**, **redirect fee wallet**, lock, CTO request.
      - Claim-fees is more blocked than it looked: the `/auth/github/callback` returns raw JSON,
        so a popup flow needs postMessage/redirect-back wiring, AND `FINCH_CLAIM_SIGNER_KEY` is
        unprovisioned (`signed:false` in dev) so `claimGithub()` can't be submitted for real yet.
        Contract call + ABI (`feeRightsRegistry.claimGithub`) are ready; blocked on those two.
      - Redirect fee wallet (`redirectFees(token, newFeeWallet)`) is controller-only and
        unblocked — a good next addition to TokenActions once we read `controllerOf`.

## Needs the user (blocking next steps)

- [x] **Launch-curve economics: A (degen/fair-launch) CONFIRMED + IMPLEMENTED.** ~1 ETH
      implied start mcap, 4.2 ETH graduation marker. `src/lib/launchCurve.js` computes exact
      `initialSqrtPriceX96` + single-sided tick range per token (4/4 unit tests). Fork test
      now launches a real ~1 ETH-start token against live Uniswap and asserts the pool
      initializes at the curve-A price. Factory sweeps single-sided-mint dust to the creator.
- [ ] **Mainnet deploy (later, after Phase 5 audit).** Needs a funded deployer key (you run
      `Deploy.s.sol`, I never touch the key) + small real ETH on chain 4663.

## Contract follow-ups

- [x] **graduationStatus(token)** on the factory: returns (pairedPrincipal, threshold,
      graduated). Threshold 4.2 ETH. Fork-tested with a REAL buy through the live Uniswap
      router (0.05 WETH → 46.08M tokens, ~1.09 ETH implied mcap — curve A confirmed working).
- [x] **Anvil mainnet-fork rehearsal env — DONE.** `npm run dev` boots the fork, seeds it,
      writes .env, builds the frontend and starts the API in one command.


## Phase 2 infra progress

- [x] **Swap indexing + OHLC** (`src/indexer/swaps.js`, `src/lib/ohlc.js`). Indexes V3 Swap
      events per pool, derives buy/sell from token ordering, prices from sqrtPriceX96,
      aggregates OHLCV candles. Validated on the live PONS pool: 112 real trades, 40 buys /
      72 sells, 47.85 WETH volume. Last candle close matched the pool's live slot0 price
      exactly (independent cross-check).
- [x] **RPC architecture split** (measured, not assumed): Alchemy free tier caps `eth_getLogs`
      at 10 blocks; the public RPC serves 500+ block spans. So `publicClient` (Alchemy) does
      contract reads/blocks and `logsClient` (public RPC) does log scanning. See
      `src/lib/chain.js`. Override via FINCHPAD_RPC_URL / FINCHPAD_LOGS_RPC_URL.
- [x] **Holder balances + concentration** (`src/indexer/holders.js`). Two-step for exactness:
      discover candidates from Transfer logs, then read balances via Multicall3 (verified
      deployed on 4663 at the canonical address). Reports burn amounts and top-N concentration
      as a rug-risk signal. **Self-validating**: computes supply coverage and refuses to
      present concentration as reliable when discovery is partial (`complete: false` flag for
      the frontend to gate on) — a wrong rug-risk number is worse than none. Complete data
      requires scanning from the token's TokenLaunched block.
- [x] **GitHub claim signer** (`src/backend/githubClaim.js`). Produces the EIP-712 attestation
      `FeeRightsRegistry.claimGithub()` verifies. **Cross-pinned**: the contract exposes
      `claimDigest()`, a Foundry test computes it for fixed fixtures, and a JS test asserts
      the signer produces the identical digest — so a domain/type drift between backend and
      contract fails a test instead of silently breaking claims in production. Also guards
      that repoId is GitHub's numeric id, never owner/name.
- [x] **GitHub OAuth built** (`src/backend/githubOauth.js`, mounted at `/auth/github/*`).
      User created the OAuth app (id+secret in `.env`); flow: single-use 10-min `state`
      binding token/claimant/repo → GitHub authorize → server-side code exchange → require
      `permissions.admin` → sign EIP-712 over the numeric repo id. 8 tests (mocked GitHub)
      cover state replay/expiry, admin gate, signature verification, and that the GitHub
      access token is never echoed. Works unsigned in dev (`signed:false`) until
      `FINCH_CLAIM_SIGNER_KEY` + `FINCH_REGISTRY` are provisioned. Module stays separate
      from the read API so production can run it isolated next to the signer key.
      - [ ] **Rotate the OAuth client secret** (it transited chat during setup) — flow is
            confirmed, rotation is now unblocked. One click in the OAuth app settings,
            then swap `GITHUB_CLIENT_SECRET` in `.env`.
      - [x] End-to-end browser test 2026-07-21: authorized on github.com, admin verified,
            numeric repoId 1307535933 returned, `signed:false` as designed (no signer key
            provisioned). Private repo required `GITHUB_OAUTH_SCOPE=repo`; public repos
            need no scope.
- [x] **Backend REST API** (`src/backend/api.js`, `npm run api`). Zero HTTP deps (this service
      sits next to a signing key; every dep is attack surface). Endpoints: `/health`,
      `/tokens`, `/tokens/:address`, `/tokens/:address/candles`, `/tokens/:address/trades`.
      Reads live off-chain with a TTL cache, so it runs today with no database. Verified
      against the live pons pool.
      - Fixed: `getLaunchedToken` returns a ZERO-FILLED struct for tokens not from that
        factory instead of reverting; the API was reporting `deployer: 0x0` / `poolFee: 0` as
        real. Now gated on `exists` and surfaced as `knownToFactory`.
- [x] **Postgres schema** (`src/backend/schema.sql`) for the persistent indexer. Response
      shapes stay identical when handlers switch from live reads to SQL.
- [x] **Alchemy: both RH networks enabled** (mainnet + testnet). Key in `.env` (gitignored).
      Indexer reads wired to Alchemy (`src/lib/chain.js`), 9/9 reference checks pass through it.
      Note: free-tier getLogs capped at 10 blocks → use Transfers API / Blockscout PRO for
      wide scans. See docs/robinhood-chain-reference.md (Alchemy support).

## Contract-design decisions from the Arbitrum/Robinhood findings

- [x] **block.number semantics — MOOT.** Launch protection was removed entirely, so nothing
      depends on block.number any more. It survives only as an informational `launchBlock`.


## Resolved

- **Testnet: no live rehearsal exists.** Robinhood testnet (chain 46630, RPC
  `https://rpc.testnet.chain.robinhood.com`, faucet `faucet.testnet.chain.robinhood.com`)
  is reachable but **Uniswap V3 is NOT deployed there** (verified: no code at the mainnet
  factory/position-manager/WETH addresses on testnet). The launch flow needs Uniswap, so:
  - Integration/QA = local **anvil fork of mainnet 4663** (real periphery, fake ETH, free).
  - First live deploy = **mainnet 4663**, gated behind the security audit. No cheap live
    test, so Phase 5 must be thorough.
- **GitHub escrow: expiry, unclaimed routes to FINCH buyback-burn.** After ~12 months
  unclaimed, escrowed fees feed the FINCH buyback-burn (not a treasury). Reuses the existing
  buyback path, transparent (public burn), on-theme.

## Deferred (tracked, not now)

- [x] **Initial buy in the launch tx — SHIPPED (R2).** `creatorBuyAmount` in LaunchParams,
      routed through the public router at AMM price.

- [ ] **FINCH buyback-burn keeper.** Locker routes protocol fees to `protocolFeeRecipient`;
      the buyback+burn runs downstream (TWAP keeper/contract), not in fee collection. Build
      the keeper. Launch FINCH through finchpad itself to give the buyback a market.
- [ ] **FinchLock streaming payments + airdrop tooling.** The rest of Streamflow. Separate
      product, not now.

## Squeeze GitHub for everything free (revisit before web dev)

Worth doing because it's free infrastructure we're currently not using at all.

**Highest value first:**
- [x] **CI on every push** (`.github/workflows/ci.yml`) — 4 jobs: JS tests, Foundry tests
      (non-fork), fork tests against live RPC, Slither. Fork tests use the `ALCHEMY_RH_MAINNET`
      repo secret via `FORK_RPC_URL` when set, else fall back to the public RPC (works today
      with zero secrets — verified locally, 5/5 fork tests pass through the fallback).
- [x] **Slither in CI** (`crytic/slither-action`, `fail-on: medium`) — safe to enforce now:
      the Phase 5 audit left zero High/Medium findings (17 remaining are all Low/Info/accepted).
      Config at `contracts/slither.config.json` filters lib/test/script.
- [ ] **Secret scanning + push protection — BLOCKED: paid on private repos.** API returns
      "Secret scanning is not available for this repository" (it's GitHub Secret Protection,
      paid for private repos; free only if the repo goes public). Ties into the visibility
      decision below. Meanwhile: keys stay in gitignored `.env` only.
- [x] **Dependabot** — vuln alerts + automated security fixes enabled via API;
      `.github/dependabot.yml` adds weekly npm + github-actions version PRs.
      Noise caveat: most alerts (48 on day one) come from the vendored
      `contracts/lib/openzeppelin-contracts` devDependency lockfile — dev tooling of a
      pinned library, not our attack surface. Closed its two auto-PRs; dismiss those
      alerts in bulk on the security tab if the count bothers you. Our own deps: viem
      only, clean.
- [ ] **Branch protection on master — BLOCKED: needs GitHub Pro or a public repo** (403
      "Upgrade to GitHub Pro or make this repository public"). Also a visibility-decision item.

**Free only if the repo goes PUBLIC** (ties back to the visibility decision):
- [ ] **CodeQL** — free for public repos; private needs paid GitHub Advanced Security.
- [ ] **GitHub Pages** — free static hosting for public repos. Our frontend is a single static
      HTML file, so Pages could host the read-only UI for nothing. Private repos need Pro/Team.

**Also free, lower priority:**
- [ ] Codespaces (60 core-hours/month free) — a ready dev env without local setup.
- [ ] Releases + tags for versioned contract deployments (which address ran which commit).
- [ ] Issues/Projects instead of this markdown file, once there's more than one person.

## Phase 3 website (not started)

- [x] Launch, token page and trading shipped. Remaining: lock, burn, claim, CTO.

## Phase 5 security gate (before mainnet)

- [ ] Contracts: slither, solhint, Foundry invariant + echidna fuzz, external audit.
      Focus: reentrancy on `collect()`, registry authorizer access control, EIP-712 replay,
      signer-key custody, launch/graduation front-run.
- [ ] Website/backend: `/security-review` on the diff, OAuth (state+PKCE), signer isolation,
      dependency scan, no secrets in frontend.
- [ ] Lint note to check: `forge lint` flagged `erc20-unchecked-transfer` at
      FeeRightsRegistry.sol:102 (likely false positive — the registry does no token transfers;
      confirm during the audit pass).
- [ ] Legal: US securities / money-transmitter review before mainnet with real funds.

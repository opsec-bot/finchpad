# Social calendar — launch week ±7 days

Pre-drafted X/Twitter posts for the week before and the week after launch, per the launch
readiness plan. All posts are written to be scheduled in advance (Typefully/Buffer/X native
scheduler); placeholders in [BRACKETS]. Telegram: mirror each day's post with a one-line
lead-in, no need for separate copy.

Rules of thumb baked into these drafts:

- Every claim is verifiable in the contracts — no APY promises, no "guaranteed" anything,
  no revenue-share language (tokenless by design; see README).
- One idea per post. Threads only on launch day and the week-one recap.
- Post at a consistent time ([PICK ONE, e.g. 15:00 UTC]) so the countdown reads as a countdown.

---

## Pre-launch week

### T-7 — teaser / thesis

> Every launchpad says "we're anti-rug."
>
> Next week we launch one where that claim is enforced by the contracts, not the roadmap.
>
> Robinhood Chain. 7 days. 🐦

### T-6 — anti-rug by construction

> Sneak peek at launch feature #1:
>
> Liquidity locked at birth — the LP position goes straight into the locker, permanently.
> No migration event, no moment where the deployer holds the pool. Fixed supply, no
> transfer hooks, fee split immutable from block one.
>
> That's not a promise. That's a contract. 6 days.

### T-5 — creator economics

> Launch feature #2: creators keep 80% of trading fees.
>
> The industry standard is 70/30. We take 20 — and when your token graduates (real earned
> fees, not donatable pool balances), our cut drops to 15.
>
> The better your token does, the less we take. 5 days.

### T-4 — referrals

> Launch feature #3: referrals that pay forever.
>
> Tag a referrer on a launch → they earn 10% of the protocol's cut on every trade of that
> token, for the life of the token. Funded from our side, never the creator's.
>
> Know creators? That's an income stream. 4 days.

### T-3 — transparency / trust post

> We're launching open-book:
>
> — contracts open source
> — the exact deploy scripts we'll run, published
> — verified on the Robinhood Chain explorer at launch
> — internal security reviews public in the repo
> — standing bug bounty
>
> Not yet third-party audited. We say that out loud. Repo: [REPO LINK]

### T-2 — graduation mechanics deep-dive

> How graduation works:
>
> Your token's progress is measured in trading fees it has ACTUALLY earned — not pool
> balances someone can donate into. Cross the threshold and our cut drops 20% → 15%,
> automatically, forever. The progress bar and the payout math read the same number, so
> neither can be faked.
>
> The better your token does, the less we take. 2 days.

### T-1 — logistics

> Tomorrow. [TIME] UTC. Robinhood Chain.
>
> — Launch fee: 0.0005 ETH
> — Fixed 1e9 supply, liquidity locked at birth, no bonding curve, no migration
> — 80/20 creator split
>
> App link drops here at go-time. Set the bell. 🔔

---

## Launch day (T-0)

Post the 7-tweet thread from `docs/launch/announcement.md`, then quote-tweet it with:

> LIVE: [APP LINK]
>
> First launches get me personally on Telegram for anything they need: [TELEGRAM LINK]

---

## Post-launch week

### T+1 — first launches recap (fill numbers from indexer)

> Day one: [N] tokens launched, [$X] volume, [N] referred launches.
>
> Favorite so far: [TOKEN + one human sentence about it].
>
> Launch yours: [APP LINK]

### T+2 — how-to tutorial (short thread, 3–4 posts)

> How to launch a token on finchpad in ~2 minutes, one transaction, no code 🧵
>
> [1: connect wallet — embedded wallets supported, you don't even need one]
> [2: name, symbol, optional referrer, optional GitHub binding]
> [3: review screen shows exactly who gets which fees — then sign once]
> [4: done — pool live, liquidity locked, link to your token page]

### T+3 — feature tour

> Everything in the finchpad toolbox, 60 seconds:
>
> — launch in one transaction, liquidity locked at birth
> — keep 80% of trading fees (85% after graduation)
> — tag a referrer, they earn on every trade forever
> — lock your own allocation on-chain to prove you can't dump
> — paid featured slots, community takeovers, GitHub-bound launches
>
> [DOCS LINK]

### T+4 — referral CTA

> Reminder that the referral program is live: bring a creator, earn 10% of the protocol cut
> on every trade of their token. Forever. On-chain, per-token, snapshotted at launch.
>
> [N] referred launches so far. [APP LINK]

### T+5 — stats + graduation tracker

> [DAY 5]: [N] launches · [$X] total volume · [N] unique traders.
>
> Closest token to graduation: [TOKEN] at [X]% — when it crosses, the protocol cut on it
> drops 20% → 15% automatically. Real earned fees only; the bar can't be bought.

### T+6 — creator spotlight

> Creator spotlight: [CREATOR / TOKEN].
>
> [2–3 human sentences: who they are, why they launched, one number.]
>
> This is who the 80/20 split is for.

### T+7 — week-one recap thread (3–4 posts)

> Week one of finchpad, in numbers 🧵
>
> [1: launches, volume, unique users, referral %, tokens closest to graduation]
> [2: what worked / one thing we shipped or fixed during the week — honesty compounds]
> [3: what's next week: [e.g. GitHub claims enabling, first graduation watch, creator
> guide]]
> [4: CTA + thank-you + Telegram link]

---

## Backlog / evergreen (use when a slot needs filling)

- Quote any organic launch tweet with one supportive sentence. Highest-value post type; do
  this daily if material exists.
- "How graduation math works" mini-explainer with a screenshot of a real progress bar.
- Bug bounty reminder linking SECURITY.md.
- Poll: "What should the first featured-placement slot cost?" (engagement + price
  discovery for FeatureBoost).

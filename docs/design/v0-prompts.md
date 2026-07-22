# v0 prompts — finchpad

v0 is used here as a **design tool, not a code source**. Generate a look, screenshot it, and
the design gets implemented against the real contract logic. Do not paste v0 output into
`web/` — the frontend is wired into viem, Privy, contract ABIs, a QuoterV2 quote path and a
multicall swap; generated components know none of that, and replacing them wholesale is how
the write paths break.

What makes these prompts worth using instead of writing your own: they carry the **actual
theme tokens** and the **actual data available on each screen**. v0 invents plausible fields
otherwise, and you end up with a design showing metrics we cannot compute.

---

## Paste this preamble before every prompt

```
Design a screen for finchpad, a token launchpad on an L2. Dark, restrained, high contrast —
closer to Linear or a professional trading terminal than a crypto casino. No purple gradients,
no glassmorphism, no neon.

Stack constraints (must be respected):
- React + Tailwind CSS v4 + shadcn/ui, "new-york" style
- Only these shadcn components exist: button, card, input, label, tabs, badge, separator,
  collapsible, sonner, skeleton, avatar, progress
- Dark theme only. No light mode.

Exact palette (OKLCH, do not substitute):
  background   oklch(0.16 0.014 210)   near-black with a teal cast
  card         oklch(0.20 0.018 210)
  foreground   oklch(0.95 0.006 200)
  muted-fg     oklch(0.68 0.015 205)
  border       oklch(0.29 0.020 210)
  primary      oklch(0.73 0.055 195)   desaturated teal — the brand accent
  highlight    oklch(0.83 0.050 194)   lighter teal, for emphasis only
  destructive  oklch(0.62 0.190 25)    warm red, negative price only

Colour discipline: teal is reserved for interactive elements, positive price movement, the
graduation progress bar, and primary CTAs. Everything else is greyscale on the dark surfaces.
If teal appears in more than about 10% of the screen, it has stopped meaning anything.

Typography: Inter. Tabular-lining numerals for every number. Numbers are the content — they
should be the largest and most confident thing in any data view.

Motion: subtle only. ~200ms ease-out. Hover lift of 1px, soft fades. Nothing that animates
layout or bounces.

Radius: 0.65rem base.
```

---

## 1. Explore feed — the front page

```
[PREAMBLE]

Screen: the token discovery feed, which is the landing page.

Real data available per token (do not invent others):
- name, symbol, logo image (square, may be missing)
- market cap in USD
- 24h price change as a percentage (positive or negative)
- total supply
- graduation progress, 0 to 1, plus a boolean "graduated"
- whether the token is bound to a verified GitHub account
- a sparkline of recent prices

Design:
- A responsive card grid, 1/2/3 columns
- Each card: square token image, name, $SYMBOL, market cap as the dominant number,
  24h change in teal or red, a small sparkline, and a thin graduation progress bar
- A compact header strip above the grid with protocol totals: tokens launched, 24h volume
- Loading state using skeletons that match the card layout exactly
- Empty state that invites launching the first token

Emphasis: someone scanning this should be able to rank tokens at a glance. Market cap and
24h change carry the most weight; everything else is supporting detail.
```

## 2. Token page — the trading screen

```
[PREAMBLE]

Screen: a single token's page, where people trade it.

Real data available:
- name, symbol, square logo, contract address
- price in USD, market cap in USD, 24h change %, 24h volume, total supply
- OHLC candles for a price chart (TradingView lightweight-charts renders it)
- recent trades: side (buy/sell), token amount, ETH value
- graduation: fees earned so far, threshold, progress 0-1, graduated boolean
- trust facts: liquidity permanently locked, fixed supply with no mint function,
  fee wallet address, fee split (80% creator / 20% protocol), GitHub binding and
  whether it has been claimed, escrowed fees if unclaimed

Design:
- Two columns on desktop: chart and trade history on the left, trade panel and a trust
  panel on the right. Single column stacked on mobile, trade panel first.
- A token header with image, name, price, and 24h change — price should be the largest
  number on the page
- A compact stat row: market cap, 24h volume, supply, graduation percentage
- The trust panel is a checklist of verifiable facts, and must be able to show BAD news
  legibly (unclaimed escrow, or a token not launched by our factory) — design the warning
  state, not just the happy path

Emphasis: this competes with DexScreener. Dense, fast to read, no wasted vertical space
above the chart.
```

## 3. Trade panel — the buy/sell widget

```
[PREAMBLE]

Component: the buy/sell panel on a token page. Roughly 380px wide in a sidebar.

Real behaviour (design around this, do not change it):
- Segmented Buy / Sell control at the top
- One amount input. Buying spends ETH; selling spends the token
- Quick-size buttons: fixed ETH amounts when buying, 25/50/75/100% when selling
- A live quote appears as you type: amount received, minimum received after slippage,
  price impact percentage, estimated network fee
- Slippage control: Auto / 0.5% / 1% / 3% / custom
- One primary action button, which shows progress states: quoting, awaiting wallet
  confirmation, submitted, confirmed
- Price impact above 15% needs a visible warning treatment

Design:
- The amount input is the hero: large, with the unit inline on the right and the USD
  equivalent beneath it
- Quote details are a quiet summary — present but not competing with the input
- Buy uses teal; sell uses the warm red
- Show the wallet balance, tappable to fill the max

Emphasis: this should feel like a real exchange widget. Familiar, fast, no surprises.
```

## 4. Launch flow — creating a token

```
[PREAMBLE]

Screen: the form for launching a new token. One transaction does everything.

Required fields: name (32 chars), ticker (10 chars), description (256 chars), token image
(uploaded file, cropped square in-browser), and optional X / Telegram / website links.

Behind an "advanced" disclosure: who receives the trading fees (me, a GitHub repo, or a
GitHub user), an optional different fee-recipient wallet, an optional opening buy in ETH,
and an optional referrer address.

Fixed facts to display, not inputs: 1,000,000,000 fixed supply with no mint function,
liquidity permanently locked, the same starting valuation for every finchpad token, a
0.0005 ETH launch fee, and an 80/20 creator/protocol fee split.

Design:
- Simple by default. A first-time creator should see roughly five fields, not twenty
- A live preview card of the token being created, showing how it will appear in the feed
  once launched — image, name, $TICKER
- A clear pre-signature summary of what is about to happen and what it costs
- Design the GitHub-bound state: when fees are assigned to a GitHub account, the creator
  earns nothing and fees are held in escrow until that account claims them. This needs to
  read as a deliberate choice, not a warning

Emphasis: confidence. Launching should feel considered and safe, not like filling in a form.
```

---

## Working loop

1. Paste preamble + one screen prompt into v0
2. Iterate there until the direction feels right — that is what v0 is good at
3. Screenshot it (or copy the layout notes) and bring it back
4. Implementation happens against the real API shapes and contract calls

Two fields in these prompts do not exist in the API yet — **24h price change** and
**sparklines**. Both are computable from candle data we already fetch, and both should be
built regardless of what v0 returns, since a trading site without price movement is the
biggest gap in the current UI.

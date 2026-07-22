# Security policy

Finchpad's contracts are open source, internally reviewed (see `docs/security-audit.md` and
`docs/security-adoption-report.md`), fuzz-tested, and **not yet third-party audited**. A
professional audit is committed once protocol revenue funds it (see
`docs/launch/audit-plan.md`).

## Reporting a vulnerability

Email **[SECURITY EMAIL]** or DM **[@TWITTER / TELEGRAM]**. Please do not open a public
issue for anything exploitable. You'll get an acknowledgment within 48 hours.

Include: affected contract/module, a reproduction (PoC or Foundry test preferred), and
impact.

## Bounty

Standing bounty, paid in ETH on Robinhood Chain, at the maintainer's severity judgment:

| Severity | Example | Reward |
| --- | --- | --- |
| Critical | Theft of escrowed fees, forged GitHub claims, theft/redirect of fee streams or locked LP | up to $1,000 |
| High | Freezing funds, breaking graduation/referral accounting in someone's favor | up to $400 |
| Medium | Griefing, DoS of claim or fee flows | up to $150 |

Out of scope: issues already documented as accepted risks in `docs/security-audit.md`,
frontend-only issues with no fund impact, gas golfing, and findings on contracts not
deployed by us.

First valid report wins. Public disclosure is welcome **after** a fix is deployed —
coordinated timing via the report thread.

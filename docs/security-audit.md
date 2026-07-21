# finchpad — Phase 5 internal security review

Date: 2026-07-21 · Commit: pre-mainnet · Reviewer: automated + manual (Claude)

> **Read this first.** This is an *internal* review, not a professional audit. It was done by
> the same agent that wrote the code, which is a real conflict: I am least likely to spot the
> flaws in my own mental model. It raises the floor; it does not clear these contracts for
> mainnet with real money. An independent third-party audit remains a hard prerequisite —
> and it matters more here than usual because **Robinhood Chain's testnet has no Uniswap V3
> deployed**, so there is no cheap live-fire rehearsal. Going live *is* mainnet.

## Scope

| Contract | Holds funds? | Risk |
|---|---|---|
| `FinchToken` | no | launch protection bypass |
| `FinchFactory` | transiently (supply + launch fee) | launch integrity, fee handling |
| `FinchLocker` | **yes** (LP position + collected fees) | **highest** — fee theft, stuck funds |
| `FeeRightsRegistry` | no (but authorizes who gets paid) | **highest** — fee-rights hijack |
| `FinchLock` | **yes** (user vesting deposits) | over-release, stuck funds |

Out of scope: Uniswap V3 periphery (audited upstream), OpenZeppelin 5.6.1 (audited upstream).

## Tooling

- **Slither 0.11.5** — static analysis, deps filtered out
- **Foundry** — 54 tests: unit, fork-against-live-Uniswap, and 6 fuzz properties (256 runs each)
- **npm audit** — JS dependencies: **0 vulnerabilities**
- Not run: Echidna, Certora, MythX (recommended for the external audit)

## Results

**Slither: 24 → 17 findings. Both High-severity findings resolved. Zero High remaining.**

### Fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | **High** | `unchecked-transfer` — `launch()` ignored the return of `IERC20.transfer` for the dust sweep | `SafeERC20.safeTransfer` / `forceApprove` |
| 2 | **High** | `arbitrary-send-eth` — slither could not prove the launch-fee destination was constant | `feeRecipient` made `immutable` |
| 3 | **High (manual)** | **Overpayment silently pocketed.** `launch()` forwarded the entire `msg.value`. A user sending 1 ETH for a 0.0005 ETH fee lost the difference permanently. | Forward exactly `LAUNCH_FEE`, refund the remainder. Regression test on a mainnet fork. |
| 4 | **Medium (manual)** | **Zero-liquidity launch.** `mint()`'s `liquidity` return was ignored, so bad tick params could produce a "successful" launch with an empty pool and nothing to trade against. | `if (liquidity == 0) revert NoLiquidityMinted();` |
| 5 | Medium | Launch protection could be silently disabled — `setLiquidityPool(address(0))` leaves `liquidityPool == 0`, which `_update` reads as "protection inactive" | zero-check + regression test |
| 6 | Informational | `FinchLocker` did not implement `IFinchLockerControl`; the registry called it through a duplicated local interface, so a signature drift would only fail at runtime — on the path that moves who gets paid | shared `IFinchLockerControl`, locker now `is` it, `override` enforced |
| 7 | Low | `setRegistry` (privileged wiring) emitted no event | `RegistrySet` event |
| 8 | Low | `TrustedSignerUpdated` had no indexed params | indexed |
| 9 | Optimization | `admin` mutable in locker | `immutable` |

Defense in depth added: `launch()` is now `nonReentrant`.

### Accepted (documented, not fixed)

| Finding | Why accepted |
|---|---|
| `incorrect-equality` ×4 | All four are exact-zero or exact-block comparisons where `==` is the correct semantics: `received == 0`, `amount == 0`, `liquidity == 0`, and `block.number == launchBlock` (the launch-block-only rule). The detector targets `==` on balances where `>=` is safer; that does not apply. |
| `unused-return` ×1 | `mint()` returns `(tokenId, liquidity, amount0, amount1)`. We use `tokenId` and now check `liquidity`. The deposited amounts are intentionally ignored — any shortfall is swept as dust. |
| `reentrancy-events` ×4 | Events emitted after calls into our own trusted locker. No state corruption is reachable; the locker cannot call back into the registry. |
| `timestamp` ×4 | Vesting schedules and signature deadlines legitimately use `block.timestamp`. Sequencer drift is seconds against schedules measured in days. |
| `missing-zero-check` ×3 | `creator_` and `signer_` are deliberate: the factory always passes `msg.sender` for creator, and `trustedSigner` may be zero before the signer service is provisioned. **`claimGithub` explicitly rejects a recovered `address(0)`**, so a zero signer cannot be exploited to forge a claim. |
| `low-level-calls` ×1 | The fee forward. Return value *is* checked (`if (!ok) revert`). |

## Fuzz properties (256 runs each, all passing)

- **Fee splitting conserves every wei** — creator + protocol always equals the exact amount collected; nothing created, destroyed, or stranded in the locker. Fuzzed across the full `uint128` fee range and all 0–10000 bps splits.
- **Protocol can never exceed its snapshotted share.**
- **Vested never exceeds locked** — at any timestamp, for any schedule.
- **Nothing releases before the cliff.**
- **Vesting is monotonic** — time moving forward can never reduce the vested amount.
- **Fully vested releases exactly the locked amount** — no dust retained.

## Centralization risk (unmitigated, by design)

Stated plainly because it is the largest non-code risk:

- **The admin can redirect any token's fee stream** via `approveCTO`. This is the CTO feature working as designed (and matches pons, whose CTO approval is also administrative). It is a trust assumption users are taking on. Expect disputes and accusations of favoritism.
- **The GitHub signer key can claim any repo-launched token's fees.** It must live in an HSM/KMS or behind a multisig, on a host isolated from the public API. A hot key in a `.env` next to the web server would be the single worst deployment mistake available.
- Mitigation for both: put `admin` behind a multisig with a timelock before mainnet.

## Not covered by this review

- **Economic / MEV analysis** of the launch curve. Arbitrum's first-come-first-served sequencing removes priority-gas sniping, but sandwich and just-in-time-liquidity dynamics on the single-sided position were not modeled.
- **Uniswap V3 tick-math edge cases** at extreme prices. The curve helper's tick placement is validated on a fork at ~1 ETH start mcap, not across the full tick range.
- **Frontend/backend pentest** (OAuth flow is not built; the signer service is unwired).
- **Legal review.** Taking a fee cut on token launches raises US securities and money-transmitter questions, and buyback-and-burn can read as a dividend. Required before mainnet.

## Pre-mainnet checklist

- [ ] Independent third-party audit
- [ ] `admin` behind a multisig + timelock
- [ ] Signer key in HSM/KMS, signer service network-isolated
- [ ] Echidna / formal verification pass on the locker's fee accounting
- [ ] Legal review
- [ ] Testnet bug-bounty window (note: no Uniswap on RH testnet, so scope is limited to
      non-pool contracts — `FinchLock` and `FeeRightsRegistry` can be exercised there)
- [ ] Deploy with a small treasury first; do not seed large liquidity on day one

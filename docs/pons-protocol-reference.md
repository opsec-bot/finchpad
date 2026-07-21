# pons protocol reference

Scraped from https://docs.ponsfamily.com/ on 2026-07-21. Chain: Robinhood Chain (4663).

## Architecture: no bonding curve

Creating a launch deploys the token **and its Uniswap V3 pool in a single transaction**, with
liquidity locked automatically. Every token trades against WETH in its own pool.

> "There is no bonding curve and no migration later. Buys and sells happen in that same pool
> from the moment it launches."

**Graduation is cosmetic.** It fires when paired WETH hits the threshold (default 4.2 ETH).
Trading continues in the *same* pool — nothing migrates, and there is no migration event.
Poll `graduationStatus(token)`.

| Parameter | Value |
|---|---|
| Supply | 1,000,000,000 (fixed, 1e9 × 1e18) |
| Pool fee | 10000 (1%) |
| Launch fee | 0.0005 ETH |
| Graduation threshold | 4.2 ETH (default) |
| Quote asset | WETH only |

### Launch protection
- Launch block: **only the creator's initial buy** can execute
- Next 2 blocks: max 5% of supply held per wallet, max 5.5% of supply bought
- Sells and wallet-to-wallet transfers are **never** restricted
- All limits end when `restrictionsEndBlock` passes

## Fees

LP fees accrue in **both** the token and WETH. Split is **snapshotted at launch and never changes**.

| Cohort | Split | From block |
|---|---|---|
| Current (active factory) | creator 70% / protocol 30% | 8991118 |
| Legacy factory | creator 90% / protocol 10% | 8600612 |

Creator rewards accrue in the token's locked position; creator claims any time. If unclaimed,
"pons automation may claim and route them to the creator payout wallet."

## Burns / protocol revenue

- **80%** of protocol fees → automated TWAP buyback of PONS → burn address
- **20%** → infrastructure and team
- Explicitly *not yet immutable*: "will be immutable, decentralized, and automated in a future release"
- Burn-adjusted market cap = `price × (totalSupply − burnedSupply)`

## Community takeovers (CTO) — **manual, off-chain**

> "Takeovers are requested through the pons CTO form and reviewed by the team."

- Transfers **social presence** and, where applicable, **the creator fee payout**
- Token, pool, and locked liquidity are **unaffected** — only the creator payout wallet and
  creator-facing surfaces change
- "Approval is administrative and depends on what the token's contracts allow"
- Explicitly not an endorsement or safety signal
- Intended only when a token is "clearly abandoned by its original creator"

**Implementation:** an admin calls `setFeeRedirect(token, newFeeWallet)` on the locker.
No on-chain governance, no vote, no inactivity timer.

## Contracts (chain 4663)

| Role | Address |
|---|---|
| Active factory (block 8991118+) | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` |
| Active locker | `0x736D76699C26D0d966744cAe304C000d471f7F35` |
| Legacy factory (block 8600612+) | `0x0c37a24F5D23A486FA692d1500881d698B1F77a4` |
| Legacy locker | `0x31ca5E101941A93A7DD6d0497928700625CF54B5` |
| Uniswap V3 factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |
| Position manager | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` |
| Swap router | `0xCaf681a66D020601342297493863E78C959E5cb2` |
| Quoter V2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` |
| WETH (quote token) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

Deployed contracts are **immutable**. New versions ship as new factory/locker addresses.

Network: RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `robinhoodchain.blockscout.com`.

## Events

```
TokenLaunched topic0: 0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a
Swap          topic0: 0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67
```

```solidity
event TokenLaunched(
  address indexed token, address indexed deployer, address indexed dexFactory,
  address pairToken, address pool, uint256 dexId, uint256 launchConfigId,
  uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount
)
```

Trade direction:
```
tokenIsToken0 = token < pairToken
pairSigned    = tokenIsToken0 ? amount1 : amount0
side          = pairSigned > 0 ? "buy" : "sell"
```

> "The public RPC times out on wide eth_getLogs ranges. Backfill in bounded block chunks
> from each contract's start block."

## Key read ABIs

```solidity
// Token is self-describing onchain
function logo() view returns (string)
function description() view returns (string)
function liquidityPool() view returns (address)
function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)

// Factory
function getLaunchedToken(address token) view returns ((address token, address deployer,
  address pairedToken, address positionManager, uint256 positionId, uint256 dexId,
  uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0,
  uint24 poolFee, bool exists, uint256 initialBuyAmount))
function graduationStatus(address token) view returns (uint256 pairedPrincipal, uint256 threshold, bool graduated)
function locker() view returns (address)

// Locker
function tokenProtocolFeeShares(address token) view returns (uint256)
function feeRedirects(address token) view returns (address)   // zeroAddress => payout is deployer
function protocolFeeRecipient() view returns (address)
```

Pricing from `slot0()`:
```
ratio           = sqrtPriceX96 / 2**96
token1PerToken0 = ratio * ratio
priceInWeth     = isToken0 ? token1PerToken0 : 1 / token1PerToken0
```
Token and WETH are both 18 decimals, so no decimal scaling needed.

## Reference token (for indexer validation)

| | |
|---|---|
| Token | `0x39dBED3a2bd333467115dE45665cC57F813C4571` |
| Pool | `0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA` |
| Launch tx | `0x1f54f25fec2d963dcb338ecb8b46a6eb123198a5c7a746d34cb2dbe78d074af8` |

Graduated, launched through the **legacy** factory (so 90/10 split).

## Attribution terms

Write "pons" lowercase, link back to the app, don't imply partnership or endorsement.

---
name: Privy
description: Use when building wallet infrastructure, authentication systems, or transaction management for crypto applications. Reach for this skill when implementing embedded wallets, managing user authentication, enforcing transaction policies, or integrating blockchain signing into web, mobile, or backend applications.
metadata:
    mintlify-proj: privy
    version: "1.0"
---

# Privy Skill Reference

## Product summary

Privy is a programmable wallet infrastructure platform that provides secure, high-performance wallet management, authentication, and transaction execution across 50+ blockchains. Use Privy to embed wallets directly into applications, authenticate users with multiple login methods, manage wallet ownership and permissions, and enforce transaction policies.

**Key files and configuration:**
- Dashboard: https://dashboard.privy.io (manage apps, wallets, users, policies)
- App credentials: App ID and App Secret (found in Dashboard > App settings > Basics)
- Client SDKs: React (`@privy-io/react-auth`), React Native, Swift, Android, Flutter, Unity
- Server SDKs: Node.js, Java, Go, Rust, Ruby
- REST API: Base URL `https://api.privy.io/v1`
- Authentication: Basic Auth (app ID as username, app secret as password) + `privy-app-id` header

**Primary docs:** https://docs.privy.io

## When to use

Reach for this skill when:
- Building embedded wallets for users (self-custodial or custodial)
- Implementing user authentication with email, social, passkeys, or wallet login
- Creating wallets for organizations, treasuries, or AI agents
- Managing wallet permissions, signers, and approval workflows
- Enforcing transaction policies (spending limits, allowlisted addresses, contract restrictions)
- Signing transactions or messages on Ethereum, Solana, Bitcoin, or other chains
- Handling wallet funding, transfers, swaps, or yield integrations
- Building multi-chain applications with consistent wallet UX
- Migrating users from other wallet providers to Privy

## Quick reference

### SDK Installation

| Platform | Command |
|----------|---------|
| React | `npm install @privy-io/react-auth@latest` |
| React Native | `npm install @privy-io/expo@latest` |
| Node.js | `npm install @privy-io/server-auth@latest` |
| Java | Maven/Gradle dependency from Privy docs |
| Go | `go get github.com/privy-io/privy-go` |

### React Setup (PrivyProvider)

```tsx
<PrivyProvider
  appId="your-privy-app-id"
  clientId="your-app-client-id"
  config={{
    embeddedWallets: {
      ethereum: { createOnLogin: 'users-without-wallets' }
    }
  }}
>
  {children}
</PrivyProvider>
```

### REST API Authentication

```bash
curl -u "app-id:app-secret" \
  -H "privy-app-id: app-id" \
  -H "Content-Type: application/json" \
  https://api.privy.io/v1/wallets
```

### Core Concepts

| Concept | Definition |
|---------|-----------|
| **Embedded wallet** | Wallet created and managed by Privy, secured by key sharding in TEEs |
| **Owner** | Entity with full control (user ID, authorization key, or key quorum) |
| **Signer** | Additional party with scoped permissions, cannot modify policies |
| **Policy** | Rules that constrain what actions a wallet can perform |
| **Key quorum** | Multi-signature threshold requiring N of M signatures |
| **Authorization key** | Public key for server-side wallet control |

### Common Wallet Creation Patterns

| Pattern | Use case | Owner |
|---------|----------|-------|
| User-owned | Self-custodial consumer wallets | User ID |
| User + server | Automated trading, limit orders | User ID + authorization key |
| Application-owned | Treasury, agents, bots | Authorization key |
| Custodial | FBO banking model | Licensed custodian |

## Decision guidance

### When to use Privy authentication vs. JWT-based auth

| Scenario | Use Privy auth | Use JWT-based auth |
|----------|---|---|
| New app, no existing auth | ✓ | |
| App has Auth0/Firebase/Cognito | | ✓ |
| Need email + social + passkey | ✓ | |
| Integrating with existing system | | ✓ |
| Want Privy to manage everything | ✓ | |

### When to use embedded vs. external wallets

| Scenario | Embedded | External |
|----------|----------|----------|
| New users, seamless onboarding | ✓ | |
| Users bring existing wallets | | ✓ |
| Need non-custodial control | ✓ | ✓ |
| Want to manage keys | ✓ | |
| Power users with MetaMask | | ✓ |

### When to use policies vs. signers

| Scenario | Use policies | Use signers |
|----------|---|---|
| Enforce spending limits | ✓ | |
| Restrict contract interactions | ✓ | |
| Delegate scoped permissions | | ✓ |
| Require multi-signature approval | | ✓ |
| Time-based restrictions | ✓ | |

## Workflow

### 1. Set up your Privy app

1. Visit https://dashboard.privy.io and create an organization
2. Create a new app and note the **App ID** and **App Secret**
3. Configure login methods (email, social, wallet, passkey, etc.)
4. Set up app clients for different environments if needed
5. Enable webhooks if you need real-time event notifications

### 2. Integrate client-side authentication and wallets

1. Install the appropriate SDK (`@privy-io/react-auth`, `@privy-io/expo`, etc.)
2. Wrap your app with `PrivyProvider` using your App ID
3. Configure embedded wallet creation (automatic on login or on-demand)
4. Use `usePrivy()` hook to access authentication state and methods
5. Use `useWallets()` or chain-specific hooks to access wallet instances
6. Wait for `ready` flag before consuming Privy state

### 3. Create wallets programmatically

1. For client-side: Use `useCreateWallet()` hook to create user wallets
2. For server-side: Use server SDK or REST API with user ID or authorization key as owner
3. Optionally assign signers and policies at creation time
4. Store wallet ID (not address) for future reference
5. Use external IDs for mapping to your system

### 4. Implement transaction signing

1. Get the wallet instance from `useWallets()` or API
2. For Ethereum: Use `sendTransaction()`, `signMessage()`, or `signTypedData()` methods
3. For Solana: Use `signTransaction()` or `signMessage()` methods
4. Provide transaction parameters (to, value, data, etc.)
5. Handle user confirmation prompts in UI
6. Catch policy violations and other errors

### 5. Set up policies (if needed)

1. Define policy rules in Dashboard or via API
2. Specify RPC methods to restrict (e.g., `eth_sendTransaction`)
3. Add conditions (recipient allowlist, amount limits, contract restrictions)
4. Attach policy to wallet at creation or via update
5. Test policy enforcement with sample transactions

### 6. Monitor with webhooks

1. Register webhook endpoint in Dashboard > Configuration > Webhooks
2. Subscribe to relevant events (user.created, wallet.funds_deposited, transaction.confirmed, etc.)
3. Verify webhook signatures using Privy's public key
4. Handle retries and idempotency in your endpoint
5. Log events for audit and debugging

## Common gotchas

- **Forgetting to wait for `ready` flag**: Always check `usePrivy().ready` before consuming Privy state. Accessing state before initialization can return stale data.
- **Policy denies all by default**: If a wallet has a policy, it must explicitly allow each RPC method. Missing rules default to DENY.
- **Wallet address vs. ID**: Use wallet ID (not address) for API calls. Addresses can change; IDs are permanent.
- **Missing authorization signatures**: Server-side wallet operations require proper authorization signatures. Use `AuthorizationContext` in server SDKs to handle this automatically.
- **Expired user session keys**: User signing keys are time-bound. Request fresh keys before making API calls; server SDKs handle this automatically.
- **Insufficient gas credits**: Gas sponsorship requires active credits. Monitor balance in Dashboard > Billing > Gas Sponsorship.
- **Policy evaluation is strict for Solana**: Every instruction in a Solana transaction must evaluate to ALLOW. One failing instruction blocks the entire transaction.
- **Confusing owner and signer**: Owners have full control and can modify policies. Signers have scoped permissions only. Don't mix these roles.
- **Not handling policy violations**: Catch `policy_violation` errors and inform users why their transaction was blocked.
- **Forgetting idempotency keys**: Use idempotency keys for critical operations (wallet creation, transfers) to prevent duplicate requests.

## Verification checklist

Before submitting work with Privy:

- [ ] App ID and App Secret are correctly configured (not hardcoded in client code)
- [ ] `PrivyProvider` wraps the entire app and `ready` flag is checked before using Privy
- [ ] Wallets are created with appropriate owners (user ID for user wallets, auth key for server wallets)
- [ ] Policies are attached if transaction restrictions are needed
- [ ] All RPC methods used by wallets are explicitly allowed in policies
- [ ] Error handling covers `policy_violation`, `insufficient_funds`, and authorization errors
- [ ] Webhook endpoints verify signatures and handle retries idempotently
- [ ] Authorization signatures are properly constructed for server-side operations
- [ ] Gas sponsorship credits are monitored if using gas sponsorship
- [ ] External IDs are set for wallets if mapping to your system
- [ ] Sensitive operations (exports, policy changes) require user confirmation
- [ ] Tests cover both happy path and policy violation scenarios

## Resources

**Comprehensive navigation:** https://docs.privy.io/llms.txt

**Critical documentation pages:**
1. [Key Concepts](https://docs.privy.io/basics/key-concepts) — Understand authentication, wallets, controls, and ownership models
2. [Wallets Overview](https://docs.privy.io/wallets/overview) — Learn embedded vs. external wallets and wallet types
3. [Policies Overview](https://docs.privy.io/controls/policies/overview) — Master policy rules, conditions, and enforcement
4. [API Error Codes](https://docs.privy.io/basics/troubleshooting/error-handling/api-errors) — Troubleshoot common errors and their solutions

---

> For additional documentation and navigation, see: https://docs.privy.io/llms.txt
#!/usr/bin/env bash
# Deploy finchpad onto the local anvil fork and seed it with real launches + trades.
# Requires ./scripts/dev-fork.sh to already be running.
#
# NO PRIVATE KEY IS USED. We impersonate a clean address via anvil and let forge broadcast
# unlocked, so nothing secret lives in this repo.
#
# Why not anvil's default accounts: all five of them carry EIP-7702 delegations on Robinhood
# Chain mainnet pointing at a sweeper contract. A mainnet fork inherits that state, so paying
# them the launch fee triggers the delegate and sweeps the balance (this actually happened —
# the seed ran out of funds mid-run). Their private keys are public, so someone set that up
# on purpose. Never send real funds to a default dev address on this chain.
set -euo pipefail

export PATH="$HOME/.foundry/bin:$PATH"
RPC="http://localhost:8545"

# Verified to have no code on Robinhood Chain mainnet (so the fork inherits nothing).
DEV_ADDR="${DEV_ADDR:-0xC97df7BE376BAf3EdC44110e232aeCEa881AEA1e}"

if ! cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  echo "anvil not reachable on :8545 — start ./scripts/dev-fork.sh first" >&2
  exit 1
fi

# Guard: if the chosen address somehow has code on the fork, bail loudly rather than
# produce a confusing OutOfFunds halfway through.
CODE=$(cast code "$DEV_ADDR" --rpc-url "$RPC")
if [ -n "$CODE" ] && [ "$CODE" != "0x" ]; then
  echo "ERROR: $DEV_ADDR has code on the fork (likely a 7702 delegation). Pick another." >&2
  exit 1
fi

echo "funding + impersonating $DEV_ADDR"
cast rpc anvil_setBalance "$DEV_ADDR" 0x21e19e0c9bab2400000 --rpc-url "$RPC" >/dev/null  # 10,000 ETH
cast rpc anvil_impersonateAccount "$DEV_ADDR" --rpc-url "$RPC" >/dev/null

cd "$(dirname "$0")/../contracts"
forge script script/SeedLocal.s.sol \
  --rpc-url "$RPC" \
  --broadcast \
  --unlocked \
  --sender "$DEV_ADDR"

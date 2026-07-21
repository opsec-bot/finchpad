#!/usr/bin/env bash
# Boot a local anvil forking Robinhood Chain mainnet.
#
# Why a fork and not the testnet: Robinhood's testnet (46630) has NO Uniswap V3 deployed, so
# the launch flow cannot run there at all. Forking mainnet gives us the real Uniswap
# periphery with fake money.
#
# Usage: ./scripts/dev-fork.sh    (leave it running; seed in another terminal)
set -euo pipefail

export PATH="$HOME/.foundry/bin:$PATH"

# Prefer Alchemy if configured (the public RPC rate-limits under a fork's request volume).
if [ -f .env ]; then set -a; . ./.env; set +a; fi
FORK_RPC="${ALCHEMY_RH_MAINNET:-https://rpc.mainnet.chain.robinhood.com}"

echo "forking Robinhood Chain mainnet (4663) -> http://localhost:8545"
echo "rpc: ${FORK_RPC%%/v2/*}${ALCHEMY_RH_MAINNET:+/v2/***}"

exec anvil \
  --fork-url "$FORK_RPC" \
  --chain-id 4663 \
  --port 8545 \
  --accounts 5 \
  --balance 10000

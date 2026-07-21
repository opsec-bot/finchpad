-- finchpad indexer schema (Postgres).
--
-- The API currently reads live off-chain so it runs with no database. This is the target
-- shape for the persistent indexer: swap the API handlers to query these tables, keeping
-- the same response shapes (those are the contract with the frontend).
--
-- Addresses are stored lowercase text (not bytea) for readable joins/debugging.
-- Token amounts are numeric(78,0) — big enough for uint256 in raw wei.

CREATE TABLE IF NOT EXISTS tokens (
    address           text PRIMARY KEY,
    symbol            text        NOT NULL,
    name              text        NOT NULL,
    decimals          smallint    NOT NULL DEFAULT 18,
    total_supply      numeric(78,0) NOT NULL,
    pool              text        NOT NULL,
    token_is_token0   boolean     NOT NULL,
    deployer          text        NOT NULL,
    factory           text        NOT NULL,
    repo_id           bigint,                       -- GitHub numeric repo id, null if not a repo launch
    logo              text,
    description       text,
    socials           jsonb,
    launch_block      bigint      NOT NULL,
    launch_tx         text        NOT NULL,
    restrictions_end_block bigint,
    protocol_share_bps smallint   NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tokens_launch_block_idx ON tokens (launch_block DESC);
CREATE INDEX IF NOT EXISTS tokens_repo_id_idx ON tokens (repo_id) WHERE repo_id IS NOT NULL;

-- Every Swap on a launched token's pool, normalized to buy/sell.
CREATE TABLE IF NOT EXISTS swaps (
    token         text        NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
    block_number  bigint      NOT NULL,
    log_index     integer     NOT NULL,
    tx_hash       text        NOT NULL,
    ts            timestamptz NOT NULL,
    side          text        NOT NULL CHECK (side IN ('buy','sell')),
    token_amount  numeric(78,0) NOT NULL,
    weth_amount   numeric(78,0) NOT NULL,
    price_weth    double precision NOT NULL,
    trader        text,
    PRIMARY KEY (block_number, log_index)          -- natural dedupe across re-indexing
);
CREATE INDEX IF NOT EXISTS swaps_token_ts_idx ON swaps (token, ts DESC);

-- Current balances, refreshed from Transfer discovery + Multicall3 reads.
-- `complete` mirrors the indexer's self-check: false means discovery was partial and
-- concentration numbers must NOT be shown as reliable.
CREATE TABLE IF NOT EXISTS holders (
    token       text NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
    address     text NOT NULL,
    balance     numeric(78,0) NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (token, address)
);
CREATE INDEX IF NOT EXISTS holders_token_balance_idx ON holders (token, balance DESC);

CREATE TABLE IF NOT EXISTS holder_snapshots (
    token                 text PRIMARY KEY REFERENCES tokens(address) ON DELETE CASCADE,
    complete              boolean NOT NULL,
    supply_coverage_pct   double precision NOT NULL,
    holder_count          integer NOT NULL,
    top10_pct_of_supply   double precision NOT NULL,
    scanned_from_block    bigint NOT NULL,
    scanned_to_block      bigint NOT NULL,
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Fee-rights state mirrored from FinchLocker/FeeRightsRegistry events.
CREATE TABLE IF NOT EXISTS fee_rights (
    token       text PRIMARY KEY REFERENCES tokens(address) ON DELETE CASCADE,
    controller  text NOT NULL,
    fee_wallet  text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fee_rights_events (
    id          bigserial PRIMARY KEY,
    token       text NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN ('redirect','handoff','cto','github_claim')),
    actor       text NOT NULL,
    controller  text NOT NULL,
    fee_wallet  text NOT NULL,
    block_number bigint NOT NULL,
    tx_hash     text NOT NULL,
    ts          timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS fee_rights_events_token_idx ON fee_rights_events (token, ts DESC);

-- FinchLock vesting positions (any ERC-20, not just finchpad tokens).
CREATE TABLE IF NOT EXISTS locks (
    lock_id      bigint PRIMARY KEY,
    token        text        NOT NULL,
    beneficiary  text        NOT NULL,
    amount       numeric(78,0) NOT NULL,
    released     numeric(78,0) NOT NULL DEFAULT 0,
    start_ts     timestamptz NOT NULL,
    cliff_seconds bigint     NOT NULL,
    duration_seconds bigint  NOT NULL,
    created_block bigint     NOT NULL
);
CREATE INDEX IF NOT EXISTS locks_token_idx ON locks (token);
CREATE INDEX IF NOT EXISTS locks_beneficiary_idx ON locks (beneficiary);

-- Manual CTO requests (reviewed off-chain, executed via FeeRightsRegistry.approveCTO).
CREATE TABLE IF NOT EXISTS cto_requests (
    id           bigserial PRIMARY KEY,
    token        text NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
    requester    text NOT NULL,
    proposed_controller text NOT NULL,
    evidence     text,
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reviewed_by  text,
    reviewed_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cto_requests_status_idx ON cto_requests (status, created_at DESC);

-- Indexer cursor so restarts resume instead of re-scanning.
CREATE TABLE IF NOT EXISTS indexer_state (
    name              text PRIMARY KEY,
    last_block        bigint NOT NULL,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

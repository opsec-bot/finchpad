// Read API client. Same-origin in production (the backend serves the built assets); in dev
// vite proxies these paths to the API on :8787.

export interface TokenSummary {
  token: `0x${string}`;
  deployer: `0x${string}`;
  pool: `0x${string}`;
  block: number;
  txHash: `0x${string}`;
  initialBuyEth: number;
}

export interface GithubBinding {
  kind: "repo" | "user";
  githubId: string;
  claimed: boolean;
  escrowDeadline: number | null;
  escrowedToken: string;
  escrowedWeth: string;
}

export interface TokenDetail {
  address: `0x${string}`;
  name: string;
  symbol: string;
  logo: string | null;
  description: string | null;
  decimals: number;
  totalSupply: number;
  /** Initial supply minus current — tokens destroyed via burn(). null for foreign tokens. */
  burnedTokens: number | null;
  pool: `0x${string}`;
  tokenIsToken0: boolean;
  priceWeth: number;
  marketCapWeth: number;
  liquidityWeth: number;
  /** Paid placement — purchased, time-boxed, stacking. Not vetting; label as paid. */
  boosted: boolean;
  /** Unix seconds until which the token is boosted; 0/past = not boosted. */
  boostedUntil: number;
  knownToFactory: boolean;
  deployer: `0x${string}` | null;
  feeWallet: `0x${string}` | null;
  /** Current fee-rights controller — only they can redirect fees. Null for foreign tokens. */
  controller: `0x${string}` | null;
  github: GithubBinding | null;
  graduation: {
    earnedFeesEth: number;
    thresholdEth: number;
    graduated: boolean;
    progress: number;
    /** Fees earned by trading but not yet banked by collect(). null when unreadable. */
    claimableFeesEth: number | null;
  } | null;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `${r.status} ${r.statusText}`);
  }
  return r.json() as Promise<T>;
}

export interface ProtocolStatsResponse {
  allTime: { volumeWeth: number; trades: number };
  last24h: { volumeWeth: number; trades: number; traders: number; tokensTraded: number };
  tokensLaunched: number;
  combined: { marketCapWeth: number; liquidityWeth: number };
  ethUsd: number | null;
}

export interface ReferralsResponse {
  referrer: string;
  totalWeth: number;
  last7dWeth: number;
  tokens: { token: string; symbol: string; earnedWeth: number; payouts: number; lastTs: number }[];
  ethUsd: number | null;
}

export interface Profile {
  address: string;
  username: string;
  name: string;
  bio: string;
  avatar: string;
  joinedTs: number;
}

export interface Position {
  token: string;
  symbol: string;
  investedWeth: number;
  receivedWeth: number;
  netTokens: number;
  valueWeth: number;
  pnlWeth: number;
  trades: number;
  lastTs: number;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(json.error || `${r.status} ${r.statusText}`);
  return json;
}

export type ActionType = "burn" | "collect" | "claim" | "boost";

export interface LedgerRow {
  type: "buy" | "sell" | "launch" | "referral" | "send" | "withdraw" | "receive" | ActionType;
  token?: string;
  symbol?: string;
  tokenAmount?: number;
  amountEth?: number;
  counterparty?: string;
  counterpartyUsername?: string | null;
  ts: number;
  txHash: string;
}

export const api = {
  ledger: (address: string) =>
    get<{ address: string; count: number; activity: LedgerRow[]; ethUsd: number | null }>(`/ledger/${address}`),
  holdings: (address: string) =>
    get<{ holdings: { token: string; symbol: string; balance: string }[] }>(`/holdings/${address}`),
  launched: (address: string) =>
    get<{
      launched: {
        token: string;
        symbol: string;
        name: string;
        claimableFeesEth: number;
        feeWallet: string | null;
        githubBound: boolean;
        githubClaimed: boolean;
      }[];
      ethUsd: number | null;
    }>(`/launched/${address}`),
  recordTransfer: (txHash: string, token?: string) => post<{ ok: boolean }>("/transfers", { txHash, token }),
  recordAction: (type: ActionType, txHash: string, token?: string) =>
    post<{ ok: boolean }>("/actions", { type, txHash, token }),
  stats: () => get<ProtocolStatsResponse>("/stats"),
  referrals: (address: string) => get<ReferralsResponse>(`/referrals/${address}`),
  profileByAddress: (address: string) => get<{ profile: Profile | null }>(`/users/by-address/${address}`),
  profile: (username: string) =>
    get<Profile & { positions: Position[]; ethBalance: number; ethUsd: number | null }>(`/users/${username}`),
  usernameCheck: (u: string, address?: string) =>
    get<{ available: boolean; reason?: string }>(
      `/users/check?u=${encodeURIComponent(u)}${address ? `&address=${address}` : ""}`,
    ),
  saveProfile: (body: {
    address: string;
    payload: { username: string; name: string; bio: string; avatar: string };
    timestamp: number;
    signature: string;
  }) => post<{ ok: boolean }>("/users", body),
  health: () => get<{ ok: boolean; factory: string; featureBoost: string | null; ethUsd: number | null }>("/health"),
  tokens: (blocks = 3000, limit = 25) =>
    get<{ factory: string; count: number; tokens: TokenSummary[] }>(`/tokens?blocks=${blocks}&limit=${limit}`),
  token: (addr: string) => get<TokenDetail>(`/tokens/${addr}`),
  candles: (addr: string, interval = 300, blocks = 3000) =>
    get<{ symbol: string; interval: number; trades: number; candles: { t: number; o: number; h: number; l: number; c: number }[] }>(
      `/tokens/${addr}/candles?interval=${interval}&blocks=${blocks}`,
    ),
  trades: (addr: string, blocks = 3000) =>
    get<{
      symbol: string;
      count: number;
      trades: {
        side: "buy" | "sell";
        tokenAmount: number;
        wethAmount: number;
        timestamp: number;
        block: number;
        txHash: `0x${string}`;
        priceWeth: number;
      }[];
    }>(`/tokens/${addr}/trades?blocks=${blocks}`),
  resolveGithub: (kind: "user" | "repo", q: string) =>
    get<{ kind: string; id: string; login: string; avatar?: string }>(
      `/github/resolve?kind=${kind}&q=${encodeURIComponent(q)}`,
    ),
  featured: () => get<{ count: number; featured: { token: string; until: number }[] }>("/featured"),
};

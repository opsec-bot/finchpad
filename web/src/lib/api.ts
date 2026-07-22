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
  decimals: number;
  totalSupply: number;
  pool: `0x${string}`;
  tokenIsToken0: boolean;
  priceWeth: number;
  marketCapWeth: number;
  knownToFactory: boolean;
  deployer: `0x${string}` | null;
  feeWallet: `0x${string}` | null;
  github: GithubBinding | null;
  graduation: { earnedFeesEth: number; thresholdEth: number; graduated: boolean; progress: number } | null;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `${r.status} ${r.statusText}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  health: () => get<{ ok: boolean; factory: string; featureBoost: string | null; ethUsd: number | null }>("/health"),
  tokens: (blocks = 3000, limit = 25) =>
    get<{ factory: string; count: number; tokens: TokenSummary[] }>(`/tokens?blocks=${blocks}&limit=${limit}`),
  token: (addr: string) => get<TokenDetail>(`/tokens/${addr}`),
  candles: (addr: string, interval = 300, blocks = 3000) =>
    get<{ symbol: string; interval: number; trades: number; candles: { t: number; o: number; h: number; l: number; c: number }[] }>(
      `/tokens/${addr}/candles?interval=${interval}&blocks=${blocks}`,
    ),
  trades: (addr: string, blocks = 3000) =>
    get<{ symbol: string; count: number; trades: { side: "buy" | "sell"; tokenAmount: number; wethAmount: number }[] }>(
      `/tokens/${addr}/trades?blocks=${blocks}`,
    ),
  resolveGithub: (kind: "user" | "repo", q: string) =>
    get<{ kind: string; id: string; login: string; avatar?: string }>(
      `/github/resolve?kind=${kind}&q=${encodeURIComponent(q)}`,
    ),
  featured: () => get<{ count: number; featured: { token: string; until: number }[] }>("/featured"),
};

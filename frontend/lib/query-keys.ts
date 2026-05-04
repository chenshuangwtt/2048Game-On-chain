// Subgraph endpoint 也进入 key，便于切环境时自动隔离缓存。
export const leaderboardKey = (contract: string, subgraphUrl?: string) =>
  ["leaderboard", contract, subgraphUrl ?? ""] as const;

// 玩家历史缓存粒度：合约地址 + 玩家地址。
export const historyKey = (contract: string, player?: string, subgraphUrl?: string) =>
  ["history", contract, player ?? "", subgraphUrl ?? ""] as const;

export const historyCountKey = (contract: string, player?: string, subgraphUrl?: string) =>
  ["history-count", contract, player ?? "", subgraphUrl ?? ""] as const;

// 基础 key 用于批量失效（例如一笔成绩上链后刷新全部历史分页）。
export const historyBaseKey = (contract: string) =>
  ["history", contract] as const;

export const historyCountBaseKey = (contract: string) =>
  ["history-count", contract] as const;

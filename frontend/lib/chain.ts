export const TARGET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337"
);
export const SEED_MODE =
  process.env.NEXT_PUBLIC_SEED_MODE === "vrf" ? "vrf" : "backend";
export const DEFAULT_SEPOLIA_RPC_URLS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.org",
];

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (TARGET_CHAIN_ID === 11155111
    ? DEFAULT_SEPOLIA_RPC_URLS[0]
    : "http://127.0.0.1:8545");

// Sepolia 读链请求优先使用环境变量指定节点，失败时退回公共 RPC，
// 避免单个提供方短暂波动就让前端直接报错。
export const SEPOLIA_RPC_URLS = Array.from(
  new Set(
    [process.env.NEXT_PUBLIC_RPC_URL, ...DEFAULT_SEPOLIA_RPC_URLS].filter(
      (value): value is string => Boolean(value)
    )
  )
);
export const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ??
  "https://api.studio.thegraph.com/query/1747522/2048/version/latest";

export function getChainLabel(chainId: number) {
  if (chainId === 11155111) {
    return "Sepolia";
  }
  if (chainId === 31337) {
    return "Anvil";
  }
  return `Chain ${chainId}`;
}

export function getTargetChainLabel() {
  return getChainLabel(TARGET_CHAIN_ID);
}

export function getSeedModeLabel() {
  return SEED_MODE === "vrf" ? "VRF" : "Backend";
}

// 仅为具备公共浏览器的链生成交易跳转链接；本地 Anvil 默认返回 null。
const EXPLORER_BASE_URLS: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
};

export function getExplorerTxUrl(
  chainId: number | undefined,
  hash: string
) {
  if (!chainId) {
    return null;
  }
  const baseUrl = EXPLORER_BASE_URLS[chainId];
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl}/tx/${hash}`;
}

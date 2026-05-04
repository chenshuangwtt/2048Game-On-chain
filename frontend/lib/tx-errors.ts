import { TARGET_CHAIN_ID, getTargetChainLabel } from "@/lib/chain";

export function formatTxError(error: unknown) {
  const fallback = "交易失败，请稍后重试或检查钱包提示。";
  if (typeof error !== "object" || error === null) {
    return fallback;
  }

  const name =
    "name" in error && typeof error.name === "string" ? error.name : "";
  const shortMessage =
    "shortMessage" in error && typeof error.shortMessage === "string"
      ? error.shortMessage
      : "";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  const text = `${shortMessage} ${message}`.toLowerCase();

  if (
    name.includes("UserRejected") ||
    text.includes("user rejected") ||
    text.includes("user denied") ||
    text.includes("用户拒绝")
  ) {
    return "你已取消签名，未发送交易。";
  }
  if (
    text.includes("already connected") ||
    text.includes("connector already connected")
  ) {
    return "钱包已连接，正在恢复当前连接状态。";
  }
  if (
    text.includes("insufficient funds") ||
    text.includes("insufficient balance") ||
    text.includes("gas required exceeds allowance")
  ) {
    return "余额不足，无法支付 gas。";
  }
  if (
    text.includes("gas limit too high") ||
    text.includes("transaction gas limit too high")
  ) {
    return "钱包提交的 gas limit 过高，已超过当前 RPC 节点允许的上限。请重试；如果问题持续，通常是钱包估算异常。";
  }
  if (
    name.includes("ChainMismatch") ||
    text.includes("chain") ||
    text.includes("network")
  ) {
    return `网络不匹配，请切换到 ${getTargetChainLabel()}（Chain ID ${TARGET_CHAIN_ID}）。`;
  }
  if (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("econnrefused")
  ) {
    if (TARGET_CHAIN_ID === 31337) {
      return "无法连接本地 RPC，请确认 Anvil 正在运行。";
    }
    return `无法连接 ${getTargetChainLabel()} RPC。请检查 frontend/.env.local 里的 RPC 地址、当前网络连接，或稍后重试。`;
  }
  if (
    text.includes("requestgameseed") &&
    (text.includes("reverted") || text.includes("execution reverted"))
  ) {
    return "VRF 请求被合约拒绝。请优先检查 3 项：1. 当前合约地址是否已加入 Chainlink VRF subscription consumer；2. 该 subscription 是否还有足够的测试 LINK；3. frontend/.env.local 里的 Sepolia 合约地址是否就是最新部署地址。";
  }
  if (text.includes("0x8baa579f")) {
    return "链上验签失败（InvalidSignature）。通常说明 backend 使用的签名摘要、私钥，或 SCORE_CONTRACT_ADDRESS / CHAIN_ID 与链上合约配置不一致。";
  }
  if (text.includes("score=0")) {
    return "分数为 0，无法提交。";
  }

  return shortMessage || message || fallback;
}

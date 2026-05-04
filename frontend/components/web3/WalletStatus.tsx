"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";
import {
  TARGET_CHAIN_ID,
  getTargetChainLabel,
} from "@/lib/chain";
import { shortenAddress } from "@/lib/format";
import { pickPreferredWalletConnector } from "@/lib/wallet";

export default function WalletStatus() {
  const [mounted, setMounted] = useState(false);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect, isPending: isDisconnectPending } = useDisconnect();

  useEffect(() => {
    setMounted(true);
  }, []);

  const preferredConnector = useMemo(
    () => pickPreferredWalletConnector(connectors),
    [connectors]
  );

  const hasProvider =
    typeof window !== "undefined" &&
    Boolean((window as Window & { ethereum?: unknown }).ethereum);

  const isSupportedChain = isConnected && chainId === TARGET_CHAIN_ID;
  const isPending = isConnectPending || isDisconnectPending;

  const label = isConnected
    ? isDisconnectPending
      ? "断开中..."
      : shortenAddress(address ?? "")
    : isConnectPending
    ? "连接钱包中..."
    : "连接钱包";

  return (
    <div className="flex flex-col items-end gap-2 text-xs text-right">
      <button
        type="button"
        onClick={() => {
          if (!mounted || isPending) return;
          if (isConnected) {
            disconnect();
            return;
          }
          if (!preferredConnector) return;
          connect({ connector: preferredConnector });
        }}
        disabled={
          !mounted ||
          isPending ||
          (!isConnected && (!hasProvider || !preferredConnector))
        }
        className="rounded bg-[var(--button-background)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--secondary-text-color)] disabled:cursor-not-allowed disabled:opacity-60"
        title={isConnected ? "点击断开钱包连接" : "点击连接钱包（优先使用 MetaMask）"}
      >
        {mounted ? label : "连接钱包"}
      </button>
      <div className="text-[var(--primary-text-color)]">
        {mounted && isConnected
          ? `网络 ${chainId}`
          : "未连接网络（请连接钱包）"}
        {mounted && isConnected
          ? isSupportedChain
            ? `（${getTargetChainLabel()}）`
            : `（请切换到 ${TARGET_CHAIN_ID} / ${getTargetChainLabel()}）`
          : ""}
      </div>
      {!isConnected && preferredConnector && (
        <div className="text-[10px] text-[var(--primary-text-color)] opacity-70">
          将优先使用 {preferredConnector.name}
        </div>
      )}
    </div>
  );
}

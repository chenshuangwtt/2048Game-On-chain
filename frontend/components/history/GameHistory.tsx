"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { SUBGRAPH_URL } from "@/lib/chain";
import { SCORE_CONTRACT_ADDRESS, isZeroAddress } from "@/lib/contract";
import { historyKey } from "@/lib/query-keys";
import { fetchPlayerHistory } from "@/lib/subgraph";
import { formatGameId, formatTimestamp, formatUpdatedAt } from "@/lib/format";

type GameHistoryProps = {
  onClose?: () => void;
};

export default function GameHistory({ onClose }: GameHistoryProps) {
  const { address, isConnected } = useAccount();
  const playerAddress = address as `0x${string}` | undefined;
  const hasContract = !isZeroAddress(SCORE_CONTRACT_ADDRESS);
  const enabled = hasContract && Boolean(SUBGRAPH_URL) && isConnected && !!playerAddress;

  const historyQuery = useQuery({
    queryKey: historyKey(SCORE_CONTRACT_ADDRESS, playerAddress, SUBGRAPH_URL),
    enabled,
    queryFn: async () => {
      if (!playerAddress) {
        throw new Error("请先连接钱包查看链上记录。");
      }
      return fetchPlayerHistory(playerAddress, 50);
    },
    staleTime: 5000,
    gcTime: 60_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const entries = useMemo(() => historyQuery.data?.results ?? [], [historyQuery.data]);
  const totalCount = historyQuery.data?.gamesPlayed ?? 0;
  const isLoading = historyQuery.isLoading;
  const lastUpdated = historyQuery.dataUpdatedAt;

  const errorMessage = !hasContract
    ? "未读取到合约地址，请检查 frontend/.env.local 并重启前端。"
    : !SUBGRAPH_URL
      ? "未配置 Subgraph 地址，请检查 NEXT_PUBLIC_SUBGRAPH_URL。"
    : !isConnected || !address
      ? "请先连接钱包查看链上记录。"
      : historyQuery.error instanceof Error
        ? `Subgraph 记录加载失败：${historyQuery.error.message}`
        : historyQuery.error
            ? "Subgraph 记录加载失败，请稍后重试。"
            : null;

  const rows = useMemo(() => {
    if (entries.length === 0) {
      return (
        <div className="text-xs text-[var(--primary-text-color)]">
          暂无链上记录，完成一局并提交后会显示。
        </div>
      );
    }

    return (
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {entries.map((entry, index) => (
          <div
            key={`${entry.timestamp}-${index}`}
            className="flex items-start justify-between rounded bg-[var(--primary-background)] px-3 py-2 text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold">#{index + 1}</span>
              <span className="text-[var(--primary-text-color)]">
                得分 {entry.score}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[var(--primary-text-color)]">
                {formatGameId(entry.gameId)}
              </span>
              <span className="text-[10px] text-[var(--primary-text-color)]">
                {formatTimestamp(entry.timestamp)}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }, [entries]);

  const skeletonRows = (
    <div className="flex flex-col gap-2 animate-pulse">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`skeleton-${index}`}
          className="flex items-center justify-between rounded bg-[var(--primary-background)] px-3 py-2"
        >
          <div className="h-3 w-20 rounded bg-[var(--secondary-background)]" />
          <div className="h-3 w-16 rounded bg-[var(--secondary-background)]" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="text-lg font-semibold">链上记录</div>
          <div className="text-[10px] text-[var(--primary-text-color)] opacity-70">
            更新时间：{formatUpdatedAt(lastUpdated)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void historyQuery.refetch();
            }}
            disabled={isLoading || !enabled}
            className="text-xs font-semibold uppercase tracking-wide text-[var(--button-background)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            刷新链上记录
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold uppercase tracking-wide text-[var(--button-background)]"
            >
              关闭
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-[var(--primary-text-color)]">
            正在加载 Subgraph 记录...
          </div>
          {skeletonRows}
        </div>
      )}

      {errorMessage && (
        <div className="rounded bg-red-50 p-2 text-xs text-red-600">
          {errorMessage}
        </div>
      )}

      {!isLoading && !errorMessage && rows}
      {!isLoading && !errorMessage && entries.length > 0 && (
        <div className="self-center text-xs text-[var(--primary-text-color)] opacity-70">
          已加载最近 {entries.length} 条，共 {totalCount} 局
        </div>
      )}
    </div>
  );
}

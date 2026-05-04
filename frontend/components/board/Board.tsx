"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { GameContext } from "@/context/game-context";
import { SEED_MODE, getSeedModeLabel } from "@/lib/chain";
import { parseDirectionKey } from "@/lib/game";
import type { Tile as TileModel } from "@/models/tile";
import Splash from "./splash";
import Tile from "./tile";

const GRID_SIZE = 4;

export default function Board() {
  const {
    getTiles,
    moveTiles,
    startGame,
    status,
    submissionRequired,
    isReady,
    sessionError,
    sessionState,
  } = useContext(GameContext);
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // 仅在“钱包已连接 + 对局已开始”时响应键盘输入。
      if (!isConnected || !isReady) {
        return;
      }
      const direction = parseDirectionKey(event.key);
      if (!direction) {
        return;
      }

      event.preventDefault();

      moveTiles(direction);
    },
    [isConnected, isReady, moveTiles]
  );

  const handleGoHome = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  }, []);

  useEffect(() => {
    if (!initialized.current && mounted && isConnected) {
      initialized.current = true;
    }
  }, [isConnected, mounted, startGame]);

  useEffect(() => {
    // 统一在 window 级别监听方向键，保证焦点不在棋盘上时也能操作。
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  const tiles = getTiles();
  const tilesByPosition = new Map<string, TileModel>();
  tiles.forEach((tile) => {
    tilesByPosition.set(`${tile.row}-${tile.col}`, tile);
  });

  const renderGrid = () =>
    Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => (
      <div
        key={`grid-${index}`}
        className="w-full h-full rounded bg-[var(--cell-background)]"
      />
    ));

  const renderTiles = () =>
    Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => {
      const row = Math.floor(index / GRID_SIZE);
      const col = index % GRID_SIZE;
      const tile = tilesByPosition.get(`${row}-${col}`);

      return (
        <div key={`tile-${row}-${col}`} className="h-full w-full">
          {tile ? <Tile key={`tile-${row}-${col}-${tile.value}`} tile={tile} /> : null}
        </div>
      );
    });

  return (
    <div className="relative w-[296px] h-[296px] md:w-[480px] md:h-[480px]">
      <div className="absolute -top-9 right-0 z-[4] rounded-full border border-[var(--foreground)]/15 bg-[var(--background)]/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--foreground)]/70 shadow-sm backdrop-blur md:text-xs">
        Mode: {getSeedModeLabel()}
      </div>
      {/* 覆盖层用于承载“未连接 / 准备开始 / 通关 / 失败”等业务状态提示。 */}
      {mounted && !isConnected && (
        <Splash
          heading="请连接钱包"
          subtext="连接后即可开始游戏并体验链上提交"
          actionLabel="等待钱包连接"
          actionDisabled
        />
      )}
      {mounted && isConnected && !isReady && (
        <Splash
          heading={
            sessionState === "requesting_seed"
              ? "正在获取种子"
              : sessionState === "awaiting_seed"
                ? "等待随机数回填"
                : sessionState === "error"
                  ? "无法开始"
                  : "准备就绪"
          }
          subtext={
            sessionError ??
            (sessionState === "requesting_seed"
              ? SEED_MODE === "vrf"
                ? "正在向链上请求 VRF 随机数"
                : "正在向 backend 申请一局新的签名 seed"
              : sessionState === "awaiting_seed"
                ? SEED_MODE === "vrf"
                  ? "VRF 请求已发送，正在等待 Chainlink coordinator 回填随机数"
                  : "当前模式已不再使用实时 VRF，这里仅保留给 legacy 流程"
                : "点击开始进入游戏")
          }
          actionLabel={
            sessionState === "requesting_seed" || sessionState === "awaiting_seed"
              ? "等待种子"
              : "开始游戏"
          }
          actionDisabled={
            sessionState === "requesting_seed" || sessionState === "awaiting_seed"
          }
          onAction={startGame}
        />
      )}
      {status === "won" && (
        <Splash
          heading="游戏通关"
          type="won"
          subtext={
            submissionRequired
              ? "正在请求签名并提交成绩"
              : "记录已成功上链"
          }
          actionLabel={submissionRequired ? "请在钱包中确认签名" : undefined}
          actionDisabled={submissionRequired}
          secondaryActionLabel="返回初始界面"
          secondaryActionDisabled={submissionRequired}
          onSecondaryAction={handleGoHome}
        />
      )}
      {status === "lost" && (
        <Splash
          heading="游戏结束"
          subtext={
            submissionRequired
              ? "正在请求签名并提交成绩"
              : "记录已成功上链"
          }
          actionLabel={submissionRequired ? "请在钱包中确认签名" : undefined}
          actionDisabled={submissionRequired}
          secondaryActionLabel="返回初始界面"
          secondaryActionDisabled={submissionRequired}
          onSecondaryAction={handleGoHome}
        />
      )}

      <div className="absolute inset-0 z-[2] grid grid-cols-4 grid-rows-4 gap-1 p-1 md:gap-2 md:p-2">
        {renderTiles()}
      </div>

      <div className="w-full h-full grid grid-cols-4 grid-rows-4 gap-1 md:gap-2 bg-[var(--secondary-background)] p-1 md:p-2 border border-[var(--secondary-background)] rounded-lg">
        {renderGrid()}
      </div>
    </div>
  );
}

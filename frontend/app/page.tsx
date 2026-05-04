"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Board from "@/components/board/Board";
import AudioManager from "@/components/audio/AudioManager";
import Header from "@/components/header/Header";
import GameHistory from "@/components/history/GameHistory";
import Leaderboard from "@/components/leaderboard/Leaderboard";
import AutoSubmitter from "@/components/onchain/AutoSubmitter";
import ScoreEventWatcher from "@/components/onchain/ScoreEventWatcher";
import Modal from "@/components/ui/Modal";
import AudioSettingsPanel from "@/components/settings/AudioSettingsPanel";
import WalletStatus from "@/components/web3/WalletStatus";
import { AudioSettingsProvider } from "@/context/audio-context";
import { GameProvider } from "@/context/game-context";
import { Web3Provider } from "@/context/web3-context";
import { SCORE_CONTRACT_ADDRESS } from "@/lib/contract";
import {
  historyBaseKey,
  historyCountBaseKey,
  leaderboardKey,
} from "@/lib/query-keys";

function HomeContent() {
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const queryClient = useQueryClient();

  const refreshOnchainData = useCallback(() => {
    // 成绩提交后同时失效排行榜、历史列表与历史总数缓存，保证弹窗读取到最新链上状态。
    queryClient.invalidateQueries({
      queryKey: leaderboardKey(SCORE_CONTRACT_ADDRESS),
    });
    queryClient.invalidateQueries({
      queryKey: historyBaseKey(SCORE_CONTRACT_ADDRESS),
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: historyCountBaseKey(SCORE_CONTRACT_ADDRESS),
      exact: false,
    });
  }, [queryClient]);

  return (
    <GameProvider>
      <AudioSettingsProvider>
        <AudioManager />
        {/* 监听链上 ScoreSubmitted 事件，其他地址提交后也能实时刷新本地视图。 */}
        <ScoreEventWatcher onScoreSubmitted={refreshOnchainData} />
        <div className="min-h-screen w-full flex flex-col items-center pb-12">
          <div className="w-[296px] md:w-[480px] relative flex flex-col items-center">
            <div className="absolute -right-[360px] top-1/2 hidden -translate-y-1/2 lg:block">
              <WalletStatus />
            </div>
            <Header />
          </div>
          <div className="mt-6 w-[296px] md:w-[480px] flex justify-center">
            <Board />
          </div>
          {/* 游戏结束后自动触发成绩提交流程，成功后刷新链上数据缓存。 */}
          <AutoSubmitter onSubmitted={refreshOnchainData} />
          <div className="mt-6 w-[296px] md:w-[480px] flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowLeaderboard(true)}
              className="flex-1 rounded border border-[var(--secondary-background)] bg-white px-4 py-3 text-sm font-semibold text-[var(--primary-text-color)] shadow-sm"
            >
              查看链上排行榜
            </button>
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="flex-1 rounded border border-[var(--secondary-background)] bg-white px-4 py-3 text-sm font-semibold text-[var(--primary-text-color)] shadow-sm"
            >
              链上记录
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="flex-1 rounded border border-[var(--secondary-background)] bg-white px-4 py-3 text-sm font-semibold text-[var(--primary-text-color)] shadow-sm"
            >
              设置
            </button>
          </div>
        </div>

        <Modal
          open={showLeaderboard}
          title="链上排行榜"
          onClose={() => setShowLeaderboard(false)}
          hideHeader
        >
          <Leaderboard
            variant="plain"
            onClose={() => setShowLeaderboard(false)}
          />
        </Modal>

        <Modal
          open={showSettings}
          title="声音设置"
          onClose={() => setShowSettings(false)}
        >
          <AudioSettingsPanel />
        </Modal>

        <Modal
          open={showHistory}
          title="链上记录"
          onClose={() => setShowHistory(false)}
          hideHeader
        >
          <GameHistory onClose={() => setShowHistory(false)} />
        </Modal>
      </AudioSettingsProvider>
    </GameProvider>
  );
}

export default function Home() {
  return (
    <Web3Provider>
      <HomeContent />
    </Web3Provider>
  );
}

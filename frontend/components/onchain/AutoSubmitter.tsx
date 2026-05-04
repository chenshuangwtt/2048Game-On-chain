"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { GameContext } from "@/context/game-context";
import {
  SEED_MODE,
  TARGET_CHAIN_ID,
  getExplorerTxUrl,
  getSeedModeLabel,
  getTargetChainLabel,
} from "@/lib/chain";
import {
  SCORE_CONTRACT_ABI,
  SCORE_CONTRACT_ADDRESS,
  isZeroAddress,
} from "@/lib/contract";
import { shortenAddress } from "@/lib/format";
import { formatTxError } from "@/lib/tx-errors";
import { verifyGame } from "@/lib/backend";
import {
  isAlreadyConnectedError,
  pickPreferredWalletConnector,
} from "@/lib/wallet";
import { flattenBoard, parseMoveSequence, replayGame } from "@/lib/game";

type AutoSubmitterProps = {
  onSubmitted?: () => void;
};

type SubmitStage =
  | "idle"
  | "verifying"
  | "awaiting_signature"
  | "broadcasted"
  | "confirming"
  | "success"
  | "error";

const MAX_SUBMIT_GAS = BigInt(1_000_000);

export default function AutoSubmitter({ onSubmitted }: AutoSubmitterProps) {
  const {
    score,
    status,
    submissionRequired,
    markScoreSubmitted,
    resetGame,
    gameId,
    seed,
    moveSequence,
  } = useContext(GameContext);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });

  const [mounted, setMounted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stage, setStage] = useState<SubmitStage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attemptedRef = useRef(false);
  const preferredConnector = useMemo(
    () => pickPreferredWalletConnector(connectors),
    [connectors]
  );

  const hasContract = !isZeroAddress(SCORE_CONTRACT_ADDRESS);
  const canAutoSubmit =
    submissionRequired &&
    status !== "playing" &&
    score > 0 &&
    gameId !== null &&
    Boolean(seed) &&
    Boolean(address);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (status === "playing" && !submissionRequired) {
      attemptedRef.current = false;
      setError(null);
      setIsSubmitting(false);
      setStage("idle");
      setTxHash(null);
    }
  }, [status, submissionRequired]);

  const submitScore = useCallback(async () => {
    if (!hasContract) {
      setError("未读取到合约地址，请检查 frontend/.env.local 并重启前端。");
      return;
    }
    if (!preferredConnector) {
      setError("未检测到浏览器钱包，请安装 MetaMask 等扩展。");
      return;
    }
    if (!address || gameId === null || !seed) {
      setError("本局缺少链上 seed 或 gameId，无法提交。");
      return;
    }

    if (!isConnected) {
      try {
        await connectAsync({ connector: preferredConnector });
      } catch (connectError) {
        if (!isAlreadyConnectedError(connectError)) {
          setError(formatTxError(connectError));
          return;
        }
      }
    }

    if (chainId !== TARGET_CHAIN_ID) {
      setError(
        `请将钱包切换到 ${getTargetChainLabel()} 网络（Chain ID ${TARGET_CHAIN_ID}）。`
      );
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      setStage("verifying");
      const localReplay = replayGame(seed, parseMoveSequence(moveSequence));
      const canonicalBoard = flattenBoard(localReplay.board);
      const verified = await verifyGame({
        player: address,
        game_id: gameId,
        seed,
        seed_mode: SEED_MODE,
        moves: moveSequence,
        claimed_score: localReplay.score,
        final_board: canonicalBoard,
      });

      if (
        !verified.valid
      ) {
        setError(verified.reason ?? "后端校验失败，成绩未通过验证。");
        setStage("error");
        return;
      }
      if (!verified.game_hash) {
        setError("后端未返回 game hash，请检查 backend 日志。");
        setStage("error");
        return;
      }
      if (!verified.verifier_signature) {
        setError(
          "后端验证通过，但没有返回 verifier 签名。请确认启动 backend 时配置了 VERIFIER_PRIVATE_KEY，并且该私钥对应链上合约里的 verifier 地址。"
        );
        setStage("error");
        return;
      }

      const contractArgs =
        SEED_MODE === "vrf"
          ? ([
              BigInt(gameId),
              BigInt(localReplay.score),
              verified.game_hash as `0x${string}`,
              verified.verifier_signature as `0x${string}`,
            ] as const)
          : ([
              BigInt(gameId),
              seed,
              BigInt(localReplay.score),
              verified.game_hash as `0x${string}`,
              verified.verifier_signature as `0x${string}`,
            ] as const);

      let gas: bigint | undefined;
      if (publicClient) {
        const estimatedGas = await publicClient.estimateContractGas({
          address: SCORE_CONTRACT_ADDRESS as `0x${string}`,
          abi: SCORE_CONTRACT_ABI,
          functionName:
            SEED_MODE === "vrf"
              ? "submitVerifiedScore"
              : "submitVerifiedScoreWithSeed",
          account: address,
          args: contractArgs,
        });
        const bufferedGas = (estimatedGas * BigInt(12)) / BigInt(10);
        gas = bufferedGas > MAX_SUBMIT_GAS ? MAX_SUBMIT_GAS : bufferedGas;
      }

      setStage("awaiting_signature");
      const hash = await writeContractAsync({
        address: SCORE_CONTRACT_ADDRESS as `0x${string}`,
        abi: SCORE_CONTRACT_ABI,
        functionName:
          SEED_MODE === "vrf"
            ? "submitVerifiedScore"
            : "submitVerifiedScoreWithSeed",
        args: contractArgs,
        gas,
      });

      setTxHash(hash);
      setStage("broadcasted");

      if (publicClient) {
        setStage("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const receiptStatus = receipt.status;
        const reverted =
          (typeof receiptStatus === "string" && receiptStatus === "reverted") ||
          (typeof receiptStatus === "number" && receiptStatus === 0) ||
          (typeof receiptStatus === "bigint" && receiptStatus === BigInt(0));
        if (reverted) {
          setError("交易已回滚，请检查 verifier 签名、gameHash 或合约地址。");
          setStage("error");
          return;
        }
      }

      markScoreSubmitted();
      setStage("success");
      onSubmitted?.();
    } catch (submitError) {
      setError(formatTxError(submitError));
      setStage("error");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    address,
    chainId,
    connectAsync,
    gameId,
    hasContract,
    preferredConnector,
    isConnected,
    markScoreSubmitted,
    moveSequence,
    onSubmitted,
    publicClient,
    seed,
    writeContractAsync,
  ]);

  useEffect(() => {
    if (!mounted || !canAutoSubmit || attemptedRef.current) {
      return;
    }
    attemptedRef.current = true;
    setError(null);
    void submitScore();
  }, [mounted, canAutoSubmit, submitScore]);

  if (!mounted) {
    return null;
  }

  if (
    !canAutoSubmit &&
    !error &&
    !isSubmitting &&
    !isConnecting &&
    stage === "idle"
  ) {
    return null;
  }

  const explorerUrl = txHash ? getExplorerTxUrl(chainId, txHash) : null;

  const handleCopy = async () => {
    if (!txHash || typeof navigator === "undefined") {
      return;
    }
    await navigator.clipboard?.writeText(txHash);
  };

  const statusMessage = isConnecting
    ? "正在连接钱包..."
    : stage === "verifying"
      ? "正在调用 backend 重放并校验本局..."
      : stage === "awaiting_signature"
        ? `校验通过，等待钱包签名并以 ${getSeedModeLabel()} 模式上链...`
        : stage === "broadcasted"
          ? "交易已发送，等待打包..."
          : stage === "confirming"
            ? "区块确认中..."
            : stage === "success"
              ? "交易已打包，验证后的成绩已成功上链。"
              : "请在钱包中确认交易以提交成绩。";

  return (
    <div className="mt-4 w-[296px] md:w-[480px]">
      <div className="rounded-md border border-[var(--secondary-background)] bg-white px-4 py-3 text-sm text-[var(--primary-text-color)]">
        {error ? (
          <div className="flex flex-col gap-2">
            <div className="text-red-600">提交失败：{error}</div>
            <button
              type="button"
              onClick={() => {
                attemptedRef.current = false;
                setError(null);
                void submitScore();
              }}
              className="self-start rounded bg-[var(--button-background)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--secondary-text-color)]"
            >
              重新尝试提交
            </button>
            <button
              type="button"
              onClick={() => {
                attemptedRef.current = false;
                setError(null);
                setStage("idle");
                setTxHash(null);
                resetGame();
              }}
              className="self-start rounded border border-[var(--secondary-background)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--primary-text-color)]"
            >
              清空本局状态
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div>{statusMessage}</div>
            {txHash && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[var(--primary-text-color)]/80">
                  交易哈希：
                </span>
                {explorerUrl ? (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-[var(--button-background)]"
                    title={txHash}
                  >
                    {shortenAddress(txHash, 6)}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="font-semibold text-[var(--button-background)]"
                    title={txHash}
                  >
                    {shortenAddress(txHash, 6)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded border border-[var(--secondary-background)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--primary-text-color)]"
                >
                  复制
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

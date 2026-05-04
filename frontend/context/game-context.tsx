"use client";

import React, {
  createContext,
  useCallback,
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
import type { Tile } from "@/models/tile";
import {
  SEED_MODE,
  TARGET_CHAIN_ID,
  getSeedModeLabel,
  getTargetChainLabel,
} from "@/lib/chain";
import {
  SCORE_CONTRACT_ABI,
  SCORE_CONTRACT_ADDRESS,
  isZeroAddress,
} from "@/lib/contract";
import { requestSeed } from "@/lib/backend";
import { formatTxError } from "@/lib/tx-errors";
import {
  isAlreadyConnectedError,
  pickPreferredWalletConnector,
} from "@/lib/wallet";
import {
  addSeededRandomTile,
  applyMove,
  createEmptyBoard,
  createSeedRng,
  encodeDirection,
  flattenBoard,
  hasMoves,
  hasWon,
  isValidBoard,
  parseMoveSequence,
  replayGame,
  type Direction,
} from "@/lib/game";

type Status = "playing" | "won" | "lost";
type SessionState =
  | "idle"
  | "requesting_seed"
  | "awaiting_seed"
  | "ready"
  | "error";

type GameContextValue = {
  getTiles: () => Tile[];
  moveTiles: (direction: Direction) => void;
  startGame: () => Promise<void>;
  markScoreSubmitted: () => void;
  resetGame: () => void;
  isReady: boolean;
  status: Status;
  score: number;
  durationSeconds: number;
  submissionRequired: boolean;
  moveSequence: string;
  gameId: number | null;
  seed: `0x${string}` | null;
  finalBoard: number[];
  sessionState: SessionState;
  sessionError: string | null;
};

const PERSIST_KEY = "onchain2048:state";
const PERSIST_VERSION = 2;
const VRF_POLL_ATTEMPTS = 45;
const VRF_POLL_INTERVAL_MS = 2000;
const MAX_VRF_REQUEST_GAS = BigInt(500_000);

type PersistedState = {
  version: number;
  board: number[][];
  score: number;
  status: Status;
  isReady: boolean;
  submissionRequired: boolean;
  durationSeconds: number;
  startedAt: number | null;
  updatedAt: number;
  moveSequence: string;
  gameId: number | null;
  seed: `0x${string}` | null;
  rngCounter: number;
  sessionState: SessionState;
  sessionError: string | null;
};

function loadPersistedState(): PersistedState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== PERSIST_VERSION) {
      return null;
    }
    if (!isValidBoard(parsed.board)) {
      return null;
    }
    if (!Number.isFinite(parsed.score) || parsed.score < 0) {
      return null;
    }

    // 这些状态是瞬时流程，不适合跨刷新恢复。
    // 否则页面重新打开后，即使用户还没重新点击开始，也会看到“正在申请种子 / 等待回填”的假状态。
    if (
      parsed.sessionState === "requesting_seed" ||
      parsed.sessionState === "awaiting_seed"
    ) {
      parsed.sessionState = "idle";
      parsed.sessionError = null;
      parsed.gameId = null;
      parsed.seed = null;
      parsed.rngCounter = 0;
      parsed.moveSequence = "";
    }

    return parsed;
  } catch {
    return null;
  }
}

export const GameContext = createContext<GameContextValue>({
  getTiles: () => [],
  moveTiles: () => {},
  startGame: async () => {},
  markScoreSubmitted: () => {},
  resetGame: () => {},
  isReady: false,
  status: "playing",
  score: 0,
  durationSeconds: 0,
  submissionRequired: false,
  moveSequence: "",
  gameId: null,
  seed: null,
  finalBoard: [],
  sessionState: "idle",
  sessionError: null,
});

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [board, setBoard] = useState<number[][]>(() => createEmptyBoard());
  const [status, setStatus] = useState<Status>("playing");
  const [score, setScore] = useState(0);
  const [submissionRequired, setSubmissionRequired] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [moveSequence, setMoveSequence] = useState("");
  const [gameId, setGameId] = useState<number | null>(null);
  const [seed, setSeed] = useState<`0x${string}` | null>(null);
  const [rngCounter, setRngCounter] = useState(0);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const statusRef = useRef<Status>("playing");
  const seedRef = useRef<`0x${string}` | null>(null);
  const rngCounterRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const moveSequenceRef = useRef("");

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const finalBoard = useMemo(() => flattenBoard(board), [board]);

  useEffect(() => {
    const persisted = loadPersistedState();
    if (!persisted) {
      return;
    }
    setBoard(persisted.board);
    setScore(persisted.score);
    setStatus(persisted.status);
    setIsReady(persisted.isReady);
    setSubmissionRequired(persisted.submissionRequired);
    setDurationSeconds(persisted.durationSeconds);
    setStartedAt(persisted.startedAt);
    setMoveSequence(persisted.moveSequence);
    setGameId(persisted.gameId);
    setSeed(persisted.seed);
    setRngCounter(persisted.rngCounter);
    setSessionState(persisted.sessionState);
    setSessionError(persisted.sessionError);
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    seedRef.current = seed;
  }, [seed]);

  useEffect(() => {
    rngCounterRef.current = rngCounter;
  }, [rngCounter]);

  useEffect(() => {
    startedAtRef.current = startedAt;
  }, [startedAt]);

  useEffect(() => {
    moveSequenceRef.current = moveSequence;
  }, [moveSequence]);

  const resetGameState = useCallback(() => {
    setBoard(createEmptyBoard());
    setScore(0);
    setStatus("playing");
    setSubmissionRequired(false);
    setIsReady(false);
    setDurationSeconds(0);
    setStartedAt(null);
    setMoveSequence("");
    setGameId(null);
    setSeed(null);
    setRngCounter(0);
    statusRef.current = "playing";
    seedRef.current = null;
    rngCounterRef.current = 0;
    startedAtRef.current = null;
    moveSequenceRef.current = "";
  }, []);

  const resetGame = useCallback(() => {
    resetGameState();
    setSessionState("idle");
    setSessionError(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PERSIST_KEY);
    }
  }, [resetGameState]);

  const delay = useCallback(
    (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    []
  );

  const markScoreSubmitted = useCallback(() => {
    setSubmissionRequired(false);
  }, []);

  const finalizeDuration = useCallback(() => {
    if (startedAt === null) {
      return;
    }
    const finalSeconds = Math.floor((Date.now() - startedAt) / 1000);
    setDurationSeconds(finalSeconds);
  }, [startedAt]);

  useEffect(() => {
    if (!isReady || status !== "playing" || startedAt === null) {
      return;
    }

    const timer = window.setInterval(() => {
      const nextSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setDurationSeconds(nextSeconds);
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isReady, startedAt, status]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const shouldPersist =
      isReady || submissionRequired;
    if (!shouldPersist) {
      window.localStorage.removeItem(PERSIST_KEY);
      return;
    }
    const payload: PersistedState = {
      version: PERSIST_VERSION,
      board,
      score,
      status,
      isReady,
      submissionRequired,
      durationSeconds,
      startedAt,
      updatedAt: Date.now(),
      moveSequence,
      gameId,
      seed,
      rngCounter,
      sessionState,
      sessionError,
    };
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
    } catch {}
  }, [
    board,
    durationSeconds,
    gameId,
    isReady,
    moveSequence,
    rngCounter,
    score,
    seed,
    sessionError,
    sessionState,
    startedAt,
    status,
    submissionRequired,
  ]);

  const startGame = useCallback(async () => {
    if (submissionRequired || sessionState === "requesting_seed") {
      return;
    }

    const preferredConnector = pickPreferredWalletConnector(connectors);
    const hasContract = !isZeroAddress(SCORE_CONTRACT_ADDRESS);

    resetGameState();
    setSessionError(null);

    if (!hasContract) {
      setSessionState("error");
      setSessionError("未读取到合约地址，请检查 frontend/.env.local。");
      return;
    }
    if (!preferredConnector) {
      setSessionState("error");
      setSessionError("未检测到可用浏览器钱包，请安装 MetaMask。");
      return;
    }

    try {
      setSessionState("requesting_seed");
      let playerAddress = address as `0x${string}` | undefined;

      if (!isConnected) {
        try {
          const connected = await connectAsync({ connector: preferredConnector });
          playerAddress = connected.accounts[0];
        } catch (connectError) {
          if (!isAlreadyConnectedError(connectError)) {
            throw connectError;
          }
        }
      }

      if (chainId !== TARGET_CHAIN_ID) {
        throw new Error(
          `请将钱包切换到 ${getTargetChainLabel()} 网络（Chain ID ${TARGET_CHAIN_ID}）。`
        );
      }

      if (!playerAddress) {
        throw new Error("钱包地址不可用，请重新连接。");
      }

      let nextGameId: number;
      let sessionSeed: `0x${string}`;

      if (SEED_MODE === "vrf") {
        if (!publicClient) {
          throw new Error("当前读链客户端不可用，无法请求 VRF 随机数。");
        }
        setSessionState("requesting_seed");
        let gas: bigint | undefined;
        if (playerAddress) {
          const estimatedGas = await publicClient.estimateContractGas({
            address: SCORE_CONTRACT_ADDRESS as `0x${string}`,
            abi: SCORE_CONTRACT_ABI,
            functionName: "requestGameSeed",
            account: playerAddress,
          });
          const bufferedGas = (estimatedGas * BigInt(12)) / BigInt(10);
          gas =
            bufferedGas > MAX_VRF_REQUEST_GAS
              ? MAX_VRF_REQUEST_GAS
              : bufferedGas;
        }
        const hash = await writeContractAsync({
          address: SCORE_CONTRACT_ADDRESS as `0x${string}`,
          abi: SCORE_CONTRACT_ABI,
          functionName: "requestGameSeed",
          gas,
        });
        await publicClient.waitForTransactionReceipt({ hash });

        const requestedGameId = await publicClient.readContract({
          address: SCORE_CONTRACT_ADDRESS as `0x${string}`,
          abi: SCORE_CONTRACT_ABI,
          functionName: "nextGameId",
        });
        nextGameId = Number(requestedGameId) - 1;
        setSessionState("awaiting_seed");

        let resolvedSeed: `0x${string}` | null = null;
        for (let index = 0; index < VRF_POLL_ATTEMPTS; index += 1) {
          const session = await publicClient.readContract({
            address: SCORE_CONTRACT_ADDRESS as `0x${string}`,
            abi: SCORE_CONTRACT_ABI,
            functionName: "games",
            args: [BigInt(nextGameId)],
          });
          if (session[4]) {
            resolvedSeed = session[1];
            break;
          }
          await delay(VRF_POLL_INTERVAL_MS);
        }

        if (!resolvedSeed) {
          throw new Error(
            "VRF 随机数仍未回填，请确认 subscription 已添加 consumer 且已充值 LINK。"
          );
        }

        sessionSeed = resolvedSeed;
      } else {
        const issuedGame = await requestSeed({
          player: playerAddress,
        });

        nextGameId = issuedGame.game_id;
        sessionSeed = issuedGame.seed;
      }

      const startTimestamp = Date.now();
      setGameId(nextGameId);

      let fresh = createEmptyBoard();
      const rng = createSeedRng(sessionSeed);
      fresh = addSeededRandomTile(fresh, rng);
      fresh = addSeededRandomTile(fresh, rng);

      setSeed(sessionSeed);
      setBoard(fresh);
      setScore(0);
      setStatus("playing");
      setSubmissionRequired(false);
      setIsReady(true);
      setDurationSeconds(0);
      setStartedAt(startTimestamp);
      setMoveSequence("");
      setRngCounter(rng.snapshot());
      seedRef.current = sessionSeed;
      rngCounterRef.current = rng.snapshot();
      statusRef.current = "playing";
      startedAtRef.current = startTimestamp;
      moveSequenceRef.current = "";
      setSessionState("ready");

      /*
      Legacy VRF start flow retained for reference:
      1. writeContractAsync({ functionName: "requestGameSeed" })
      2. wait for GameSeedRequested
      3. poll games(gameId) until seedReady

      Current mode is controlled by NEXT_PUBLIC_SEED_MODE:
      - backend: immediate start via backend-issued seed
      - vrf: request on-chain randomness and wait for fulfill
      */
    } catch (error) {
      setSessionState("error");
      setSessionError(formatTxError(error));
    }
  }, [
    chainId,
    connectAsync,
    connectors,
    delay,
    address,
    isConnected,
    publicClient,
    resetGameState,
    sessionState,
    submissionRequired,
    writeContractAsync,
  ]);

  const moveTiles = useCallback(
    (direction: Direction) => {
      setBoard((prev) => {
        const activeStatus = statusRef.current;
        const activeSeed = seedRef.current;
        if (activeStatus !== "playing" || !activeSeed) {
          return prev;
        }

        const replay = applyMove(prev, direction);
        if (!replay.moved) {
          if (!hasMoves(prev)) {
            setStatus("lost");
            setSubmissionRequired(true);
            finalizeDuration();
            statusRef.current = "lost";
          }
          return prev;
        }

        const rng = createSeedRng(activeSeed, rngCounterRef.current);
        addSeededRandomTile(replay.board, rng);
        const nextCounter = rng.snapshot();
        const nextMoveSequence = `${moveSequenceRef.current}${encodeDirection(direction)}`;
        const canonicalReplay = replayGame(
          activeSeed,
          parseMoveSequence(nextMoveSequence)
        );
        rngCounterRef.current = nextCounter;
        setRngCounter(nextCounter);
        moveSequenceRef.current = nextMoveSequence;
        setMoveSequence(nextMoveSequence);
        setScore(canonicalReplay.score);

        if (hasWon(canonicalReplay.board)) {
          setStatus("won");
          setSubmissionRequired(true);
          finalizeDuration();
          statusRef.current = "won";
        } else if (!hasMoves(canonicalReplay.board)) {
          setStatus("lost");
          setSubmissionRequired(true);
          finalizeDuration();
          statusRef.current = "lost";
        }

        return canonicalReplay.board;
      });
    },
    [finalizeDuration]
  );

  const tiles = useMemo<Tile[]>(() => {
    const result: Tile[] = [];
    let id = 0;
    for (let row = 0; row < board.length; row += 1) {
      for (let col = 0; col < board[row].length; col += 1) {
        const value = board[row][col];
        if (value !== 0) {
          result.push({
            id,
            value,
            row,
            col,
          });
        }
        id += 1;
      }
    }
    return result;
  }, [board]);

  const getTiles = useCallback(() => tiles, [tiles]);

  const value = useMemo(
    () => ({
      getTiles,
      moveTiles,
      startGame,
      markScoreSubmitted,
      resetGame,
      isReady,
      status,
      score,
      durationSeconds,
      submissionRequired,
      moveSequence,
      gameId,
      seed,
      finalBoard,
      sessionState,
      sessionError,
    }),
    [
      durationSeconds,
      finalBoard,
      gameId,
      getTiles,
      isReady,
      markScoreSubmitted,
      moveSequence,
      moveTiles,
      resetGame,
      score,
      seed,
      sessionError,
      sessionState,
      startGame,
      status,
      submissionRequired,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

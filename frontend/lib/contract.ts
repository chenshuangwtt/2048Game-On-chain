export const SCORE_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS ??
  "0x0000000000000000000000000000000000000000";

export const SCORE_CONTRACT_ABI = [
  {
    type: "function",
    name: "requestGameSeed",
    inputs: [],
    outputs: [{ name: "gameId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "nextGameId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "submitVerifiedScore",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "score", type: "uint64" },
      { name: "gameHash", type: "bytes32" },
      { name: "verifierSignature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitVerifiedScoreWithSeed",
    inputs: [
      { name: "gameId", type: "uint256" },
      { name: "seed", type: "bytes32" },
      { name: "score", type: "uint64" },
      { name: "gameHash", type: "bytes32" },
      { name: "verifierSignature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "games",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "player", type: "address" },
      { name: "seed", type: "bytes32" },
      { name: "requestedAt", type: "uint64" },
      { name: "fulfilledAt", type: "uint64" },
      { name: "seedReady", type: "bool" },
      { name: "consumed", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getLeaderboard",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "player", type: "address" },
          { name: "gameId", type: "uint256" },
          { name: "score", type: "uint64" },
          { name: "gameHash", type: "bytes32" },
          { name: "timestamp", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPlayerHistory",
    inputs: [
      { name: "player", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "player", type: "address" },
          { name: "gameId", type: "uint256" },
          { name: "score", type: "uint64" },
          { name: "gameHash", type: "bytes32" },
          { name: "timestamp", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPlayerHistoryCount",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "bestScores",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "leaderboardLength",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_LEADERBOARD",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "GameSeedRequested",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "gameId", type: "uint256", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GameSeedFulfilled",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "gameId", type: "uint256", indexed: true },
      { name: "seed", type: "bytes32", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ScoreSubmitted",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "gameId", type: "uint256", indexed: true },
      { name: "score", type: "uint64", indexed: false },
      { name: "gameHash", type: "bytes32", indexed: false },
      { name: "timestamp", type: "uint64", indexed: false },
      { name: "isNewBest", type: "bool", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export function isZeroAddress(address: string) {
  return /^0x0{40}$/.test(address);
}

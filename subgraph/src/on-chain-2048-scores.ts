import { BigInt } from "@graphprotocol/graph-ts";
import {
  GameSeedFulfilled,
  GameSeedRequested,
  ScoreSubmitted,
} from "../generated/OnChain2048Scores/OnChain2048Scores";
import { GameSession, Player, ScoreEntry } from "../generated/schema";

// Player 是聚合实体，不是单次事件的快照。
// 所以每次事件进来时，都要先确保这个玩家实体存在。
function getOrCreatePlayer(address: string, timestamp: BigInt): Player {
  let player = Player.load(address);
  if (player == null) {
    player = new Player(address);
    player.bestScore = BigInt.zero();
    player.gamesPlayed = BigInt.zero();
    player.totalScore = BigInt.zero();
    player.createdAt = timestamp;
  }

  player.updatedAt = timestamp;
  return player;
}

function getSessionId(gameId: BigInt): string {
  return gameId.toString();
}

export function handleGameSeedRequested(event: GameSeedRequested): void {
  let player = getOrCreatePlayer(event.params.player.toHexString(), event.block.timestamp);
  player.save();

  // 一局游戏的 session 以 gameId 为主键。
  // 这里先落一个“待 fulfill”的会话，后面再由 VRF 回填补齐。
  let session = new GameSession(getSessionId(event.params.gameId));
  session.gameId = event.params.gameId;
  session.requestId = event.params.requestId;
  session.player = player.id;
  session.requestedAt = event.block.timestamp;
  session.fulfilledAt = null;
  session.seed = null;
  session.seedReady = false;
  session.consumed = false;
  session.requestTxHash = event.transaction.hash;
  session.requestBlockNumber = event.block.number;
  session.fulfillTxHash = null;
  session.fulfillBlockNumber = null;
  session.scoreEntry = null;
  session.save();
}

export function handleGameSeedFulfilled(event: GameSeedFulfilled): void {
  let session = GameSession.load(getSessionId(event.params.gameId));
  if (session == null) {
    // 理论上不该发生；如果发生，说明索引顺序或历史数据不完整。
    return;
  }

  session.seed = event.params.seed;
  session.seedReady = true;
  session.fulfilledAt = event.block.timestamp;
  session.fulfillTxHash = event.transaction.hash;
  session.fulfillBlockNumber = event.block.number;
  session.save();

  let player = Player.load(session.player);
  if (player != null) {
    player.lastPlayedAt = event.block.timestamp;
    player.updatedAt = event.block.timestamp;
    player.save();
  }
}

export function handleScoreSubmitted(event: ScoreSubmitted): void {
  let player = getOrCreatePlayer(event.params.player.toHexString(), event.block.timestamp);
  let session = GameSession.load(getSessionId(event.params.gameId));

  if (session == null) {
    // 兜底逻辑：
    // 如果某些旧数据或异常情况下没有索引到建局事件，仍然补出一个最小 session，
    // 避免最终成绩变成孤儿记录。
    session = new GameSession(getSessionId(event.params.gameId));
    session.gameId = event.params.gameId;
    session.requestId = BigInt.zero();
    session.player = player.id;
    session.requestedAt = event.block.timestamp;
    session.fulfilledAt = null;
    session.seed = null;
    session.seedReady = false;
    session.consumed = false;
    session.requestTxHash = event.transaction.hash;
    session.requestBlockNumber = event.block.number;
    session.fulfillTxHash = null;
    session.fulfillBlockNumber = null;
    session.scoreEntry = null;
  }

  // ScoreEntry 以 gameHash 为主键，因为它天然代表一局验证后的唯一证明包。
  let entry = new ScoreEntry(event.params.gameHash.toHexString());
  entry.gameHash = event.params.gameHash;
  entry.player = player.id;
  entry.session = session.id;
  entry.gameId = event.params.gameId;
  entry.score = BigInt.fromString(event.params.score.toString());
  entry.timestamp = BigInt.fromString(event.params.timestamp.toString());
  entry.isNewBest = event.params.isNewBest;
  entry.txHash = event.transaction.hash;
  entry.blockNumber = event.block.number;
  entry.save();

  session.consumed = true;
  session.scoreEntry = entry.id;
  session.save();

  // 这里维护玩家聚合字段，前端就不必每次自己在客户端遍历历史记录。
  player.gamesPlayed = player.gamesPlayed.plus(BigInt.fromI32(1));
  player.totalScore = player.totalScore.plus(BigInt.fromString(event.params.score.toString()));
  player.lastPlayedAt = BigInt.fromString(event.params.timestamp.toString());
  if (event.params.isNewBest || BigInt.fromString(event.params.score.toString()).gt(player.bestScore)) {
    player.bestScore = BigInt.fromString(event.params.score.toString());
  }
  player.updatedAt = event.block.timestamp;
  player.save();
}

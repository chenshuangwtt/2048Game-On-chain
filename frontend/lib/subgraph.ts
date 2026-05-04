import { SUBGRAPH_URL } from "@/lib/chain";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type TopPlayersResponse = {
  players: Array<{
    id: string;
    bestScore: string;
    gamesPlayed: string;
    totalScore: string;
    lastPlayedAt: string | null;
  }>;
};

type PlayerHistoryResponse = {
  player: null | {
    id: string;
    bestScore: string;
    gamesPlayed: string;
    totalScore: string;
    results: Array<{
      id: string;
      gameId: string;
      score: string;
      timestamp: string;
      isNewBest: boolean;
    }>;
  };
};

const TOP_PLAYERS_QUERY = `
  query TopPlayers($limit: Int!) {
    players(first: $limit, orderBy: bestScore, orderDirection: desc) {
      id
      bestScore
      gamesPlayed
      totalScore
      lastPlayedAt
    }
  }
`;

const PLAYER_HISTORY_QUERY = `
  query PlayerHistory($player: ID!, $limit: Int!) {
    player(id: $player) {
      id
      bestScore
      gamesPlayed
      totalScore
      results(orderBy: timestamp, orderDirection: desc, first: $limit) {
        id
        gameId
        score
        timestamp
        isNewBest
      }
    }
  }
`;

async function fetchSubgraph<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Subgraph request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as GraphQLResponse<T>;
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message ?? "Subgraph query failed.");
  }
  if (!payload.data) {
    throw new Error("Subgraph returned an empty response.");
  }

  return payload.data;
}

export async function fetchTopPlayers(limit = 10) {
  const data = await fetchSubgraph<TopPlayersResponse>(TOP_PLAYERS_QUERY, {
    limit,
  });

  return data.players.map((player, index) => ({
    rank: index + 1,
    player: player.id as `0x${string}`,
    score: Number(player.bestScore),
    gamesPlayed: Number(player.gamesPlayed),
    totalScore: Number(player.totalScore),
    lastPlayedAt: player.lastPlayedAt ? Number(player.lastPlayedAt) : 0,
  }));
}

export async function fetchPlayerHistory(player: `0x${string}`, limit = 50) {
  const data = await fetchSubgraph<PlayerHistoryResponse>(PLAYER_HISTORY_QUERY, {
    player: player.toLowerCase(),
    limit,
  });

  return {
    bestScore: data.player ? Number(data.player.bestScore) : 0,
    gamesPlayed: data.player ? Number(data.player.gamesPlayed) : 0,
    totalScore: data.player ? Number(data.player.totalScore) : 0,
    results:
      data.player?.results.map((entry) => ({
        id: entry.id,
        gameId: Number(entry.gameId),
        score: Number(entry.score),
        timestamp: Number(entry.timestamp),
        isNewBest: entry.isNewBest,
      })) ?? [],
  };
}

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:18080";

export type IssueSeedPayload = {
  player: `0x${string}`;
};

export type IssueSeedResponse = {
  game_id: number;
  seed: `0x${string}`;
  mode: string;
};

export type VerifyGamePayload = {
  player: `0x${string}`;
  game_id: number;
  seed: `0x${string}`;
  seed_mode?: "backend" | "vrf";
  moves: string;
  claimed_score: number;
  final_board: number[];
};

export type VerifyGameResponse = {
  valid: boolean;
  reason: string | null;
  game_hash: string | null;
  verifier_signature: string | null;
  canonical_score: number;
  canonical_board: number[];
  max_tile: number;
  move_count: number;
};

export async function requestSeed(payload: IssueSeedPayload) {
  const response = await fetch(`${BACKEND_URL}/api/v1/seed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`后端发 seed 服务不可用（${response.status}）`);
  }

  const result = (await response.json()) as IssueSeedResponse;
  if (!result.seed.startsWith("0x")) {
    throw new Error(result.seed);
  }
  return result;
}

export async function verifyGame(payload: VerifyGamePayload) {
  const response = await fetch(`${BACKEND_URL}/api/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`后端校验服务不可用（${response.status}）`);
  }

  return (await response.json()) as VerifyGameResponse;
}

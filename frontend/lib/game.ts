export type Direction = "up" | "down" | "left" | "right";

export const BOARD_SIZE = 4;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;

export type ReplayState = {
  board: number[][];
  score: number;
  moved: boolean;
};

export type CanonicalReplay = {
  board: number[][];
  score: number;
  maxTile: number;
};

export function createEmptyBoard(): number[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => 0)
  );
}

export function isValidBoard(board: unknown): board is number[][] {
  if (!Array.isArray(board) || board.length !== BOARD_SIZE) {
    return false;
  }
  return board.every(
    (row) =>
      Array.isArray(row) &&
      row.length === BOARD_SIZE &&
      row.every((value) => Number.isFinite(value) && value >= 0)
  );
}

export function flattenBoard(board: number[][]): number[] {
  return board.flatMap((row) => row);
}

export function expandBoard(flatBoard: number[]): number[][] {
  if (flatBoard.length !== BOARD_CELLS) {
    return createEmptyBoard();
  }

  const board = createEmptyBoard();
  for (let index = 0; index < flatBoard.length; index += 1) {
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    board[row][col] = flatBoard[index];
  }
  return board;
}

export function parseDirectionKey(key: string): Direction | null {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return null;
}

export function encodeDirection(direction: Direction): string {
  if (direction === "up") return "U";
  if (direction === "down") return "D";
  if (direction === "left") return "L";
  return "R";
}

export function hasWon(board: number[][]) {
  return board.some((row) => row.some((value) => value >= 2048));
}

export function hasMoves(board: number[][]) {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const value = board[row][col];
      if (value === 0) {
        return true;
      }
      if (row < BOARD_SIZE - 1 && board[row + 1][col] === value) {
        return true;
      }
      if (col < BOARD_SIZE - 1 && board[row][col + 1] === value) {
        return true;
      }
    }
  }
  return false;
}

export function applyMove(board: number[][], direction: Direction): ReplayState {
  const next = createEmptyBoard();
  let moved = false;
  let score = 0;

  if (direction === "left" || direction === "right") {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      const line = direction === "left" ? board[row] : [...board[row]].reverse();
      const merged = mergeLine(line);
      const finalLine =
        direction === "left" ? merged.line : [...merged.line].reverse();

      next[row] = finalLine;
      moved = moved || merged.moved;
      score += merged.score;
    }
  } else {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const column = board.map((row) => row[col]);
      const line = direction === "up" ? column : [...column].reverse();
      const merged = mergeLine(line);
      const finalLine =
        direction === "up" ? merged.line : [...merged.line].reverse();

      for (let row = 0; row < BOARD_SIZE; row += 1) {
        next[row][col] = finalLine[row];
      }

      moved = moved || merged.moved;
      score += merged.score;
    }
  }

  return { board: next, moved, score };
}

export function replayGame(seedHex: string, directions: Direction[]): CanonicalReplay {
  let board = createEmptyBoard();
  let score = 0;
  const rng = createSeedRng(seedHex);

  board = addSeededRandomTile(board, rng);
  board = addSeededRandomTile(board, rng);

  for (const direction of directions) {
    const replay = applyMove(board, direction);
    if (!replay.moved) {
      continue;
    }

    board = addSeededRandomTile(replay.board, rng);
    score += replay.score;
  }

  const maxTile = board.reduce(
    (current, row) => Math.max(current, ...row),
    0
  );

  return {
    board,
    score,
    maxTile,
  };
}

export function parseMoveSequence(moves: string): Direction[] {
  return moves
    .split("")
    .map((value) => {
      if (value === "U") return "up";
      if (value === "D") return "down";
      if (value === "L") return "left";
      if (value === "R") return "right";
      return null;
    })
    .filter((value): value is Direction => value !== null);
}

export function addSeededRandomTile(board: number[][], rng: SeedRng): number[][] {
  const empty: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] === 0) {
        empty.push({ row, col });
      }
    }
  }

  if (empty.length === 0) {
    return board;
  }

  const choice = empty[rng.nextIndex(empty.length)];
  const value = rng.nextPercent() < 90 ? 2 : 4;
  const next = board.map((row) => [...row]);
  next[choice.row][choice.col] = value;
  return next;
}

export function createSeedRng(seedHex: string, counter = 0) {
  return new SeedRng(normalizeSeed(seedHex), counter);
}

function normalizeSeed(seedHex: string) {
  const normalized = seedHex.trim().replace(/^0x/, "").toLowerCase();
  if (normalized.length !== 64 || !/^[0-9a-f]+$/.test(normalized)) {
    throw new Error("invalid seed");
  }
  return normalized;
}

class SeedRng {
  private readonly seed: string;
  private counter: number;

  constructor(seed: string, counter = 0) {
    this.seed = seed;
    this.counter = counter;
  }

  snapshot() {
    return this.counter;
  }

  nextIndex(modulo: number) {
    if (modulo <= 0) {
      return 0;
    }
    const word = this.nextWord();
    return Number.parseInt(word.slice(0, 8), 16) % modulo;
  }

  nextPercent() {
    const word = this.nextWord();
    return Number.parseInt(word.slice(0, 2), 16) % 100;
  }

  private nextWord() {
    const payload = `${this.seed}:${this.counter}`;
    const word = simpleHash(payload);
    this.counter += 1;
    return word;
  }
}

function mergeLine(line: number[]) {
  const filtered = line.filter((value) => value !== 0);
  const merged: number[] = [];
  let score = 0;

  for (let index = 0; index < filtered.length; index += 1) {
    if (filtered[index] === filtered[index + 1]) {
      const value = filtered[index] * 2;
      merged.push(value);
      score += value;
      index += 1;
    } else {
      merged.push(filtered[index]);
    }
  }

  while (merged.length < BOARD_SIZE) {
    merged.push(0);
  }

  const moved = !line.every((value, idx) => value === merged[idx]);
  return { line: merged, score, moved };
}

// 保持前后端都使用“seed + counter -> 32 bytes”派生随机字。
function simpleHash(input: string) {
  let h1 = 0x243f6a88;
  let h2 = 0x85a308d3;
  let h3 = 0x13198a2e;
  let h4 = 0x03707344;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 597399067) >>> 0;
    h2 = Math.imul(h2 ^ code, 2869860233) >>> 0;
    h3 = Math.imul(h3 ^ code, 951274213) >>> 0;
    h4 = Math.imul(h4 ^ code, 2716044179) >>> 0;
  }

  const parts: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909) >>> 0;
    h3 = Math.imul(h3 ^ (h3 >>> 16), 668265263) >>> 0;
    h4 = Math.imul(h4 ^ (h4 >>> 13), 374761393) >>> 0;
    parts.push((h1 ^ h2 ^ h3 ^ h4) >>> 0);
    h1 = (h1 + 0x9e3779b9) >>> 0;
    h2 = (h2 + 0x7f4a7c15) >>> 0;
    h3 = (h3 + 0x94d049bb) >>> 0;
    h4 = (h4 + 0x5bd1e995) >>> 0;
  }

  return parts.map((value) => value.toString(16).padStart(8, "0")).join("");
}

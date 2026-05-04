# backend

Rust verifier service for the 2048 seed-based anti-cheat flow.

## Responsibilities

- Accept `seed + move sequence + claimed final result`
- Replay the entire 2048 game deterministically
- Reject invalid results
- Return a canonical `game_hash`
- Optionally return a verifier signature when `VERIFIER_PRIVATE_KEY` is configured

## Run

```bash
cd backend
cargo run
```

Optional environment variables:

- `BACKEND_BIND_ADDR=127.0.0.1:18080`
- `VERIFIER_PRIVATE_KEY=0x...`

## API

`POST /api/v1/verify`

Example request body:

```json
{
  "player": "0x1111111111111111111111111111111111111111",
  "game_id": 1,
  "seed": "0x0101010101010101010101010101010101010101010101010101010101010101",
  "moves": "ULLDRR",
  "claimed_score": 128,
  "final_board": [0, 2, 4, 8, 0, 0, 16, 32, 0, 0, 0, 64, 0, 0, 0, 128]
}
```

Notes:

- `moves` currently uses `U/D/L/R`
- `final_board` is a flattened 4x4 board in row-major order
- `game_hash` is derived from `player + game_id + seed + moves + score + final_board`
- current contract version expects the backend-produced `game_hash` to be passed on-chain

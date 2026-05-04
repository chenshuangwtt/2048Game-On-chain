use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use anyhow::{Result, anyhow, bail};
use k256::ecdsa::{RecoveryId, Signature, SigningKey};
use k256::elliptic_curve::rand_core::{OsRng, RngCore};
use sha3::{Digest, Keccak256};

use crate::models::{
    Direction, IssueSeedRequest, IssueSeedResponse, VerifyGameRequest, VerifyGameResponse,
};

const BOARD_SIZE: usize = 4;
const BOARD_CELLS: usize = BOARD_SIZE * BOARD_SIZE;

/// 后端核心领域对象。
/// 它负责两件事：
/// 1. 用 seed 重放整局 2048，判断前端提交的结果是否真实。
/// 2. 在配置了私钥时，对通过验证的结果生成链上 verifier 签名。
#[derive(Clone)]
pub struct GameVerifier {
    signer: Option<SigningKey>,
    next_game_id: Arc<AtomicU64>,
    issued_games: Arc<Mutex<HashMap<String, IssuedGame>>>,
    issued_games_store_path: PathBuf,
    score_contract_address: [u8; 20],
    chain_id: u64,
}

impl GameVerifier {
    pub fn new(
        signer: Option<SigningKey>,
        issued_games_store_path: impl Into<PathBuf>,
        score_contract_address: impl AsRef<str>,
        chain_id: u64,
    ) -> Self {
        let issued_games_store_path = issued_games_store_path.into();
        let issued_games = load_issued_games(&issued_games_store_path);
        let next_game_id = issued_games
            .values()
            .map(|game| game.game_id)
            .max()
            .unwrap_or(0)
            + 1;
        let score_contract_address =
            parse_address(score_contract_address.as_ref()).unwrap_or([0u8; 20]);

        Self {
            signer,
            next_game_id: Arc::new(AtomicU64::new(next_game_id)),
            issued_games: Arc::new(Mutex::new(issued_games)),
            issued_games_store_path,
            score_contract_address,
            chain_id,
        }
    }

    /// 申请一局新的后端 seed。
    /// 当前生产模式下，seed 由 backend 发放并记账，避免等待 VRF callback。
    pub fn issue_seed(&self, request: IssueSeedRequest) -> Result<IssueSeedResponse> {
        validate_player(&request.player)?;
        let player = normalize_player(&request.player);
        let game_id = self.next_game_id.fetch_add(1, Ordering::SeqCst);

        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let seed_hex = to_hex(&seed);

        let key = issued_game_key(&player, game_id);
        let mut issued_games = self
            .issued_games
            .lock()
            .map_err(|_| anyhow!("issued game store poisoned"))?;
        issued_games.insert(
            key,
            IssuedGame {
                player,
                game_id,
                seed_hex: seed_hex.clone(),
            },
        );
        persist_issued_games(&self.issued_games_store_path, &issued_games)?;

        Ok(IssueSeedResponse {
            game_id,
            seed: seed_hex,
            mode: "backend-signed-seed".to_owned(),
        })
    }

    /// 对外统一入口。
    /// 失败时不抛 HTTP 错，而是返回结构化的 `valid=false` 响应，方便前端直接展示。
    pub fn verify(&self, request: VerifyGameRequest) -> VerifyGameResponse {
        match self.verify_inner(request) {
            Ok(response) => response,
            Err(error) => VerifyGameResponse {
                valid: false,
                reason: Some(error.to_string()),
                game_hash: None,
                verifier_signature: None,
                canonical_score: 0,
                canonical_board: Vec::new(),
                max_tile: 0,
                move_count: 0,
            },
        }
    }

    /// 实际验证逻辑。
    /// 顺序是：
    /// 1. 校验输入格式
    /// 2. 解析 moves / seed
    /// 3. 完整重放游戏
    /// 4. 对比得分和最终棋盘
    /// 5. 生成 game_hash
    /// 6. 可选生成 verifier signature
    fn verify_inner(&self, request: VerifyGameRequest) -> Result<VerifyGameResponse> {
        validate_player(&request.player)?;
        if request
            .seed_mode
            .as_deref()
            .unwrap_or("backend")
            .eq_ignore_ascii_case("backend")
        {
            self.ensure_issued_game(&request)?;
        }
        let seed = parse_seed(&request.seed)?;
        let expected_board = normalize_board(request.final_board)?;
        let directions = parse_moves(&request.moves)?;

        let replay = replay_game(&seed, &directions);
        if replay.score != request.claimed_score {
            bail!(
                "score mismatch: claimed={}, canonical={}",
                request.claimed_score,
                replay.score
            );
        }
        if replay.board != expected_board {
            bail!("final board mismatch");
        }

        let game_hash = compute_game_hash(
            &request.player,
            request.game_id,
            seed.bytes,
            &request.moves,
            replay.score,
            &replay.board,
        );
        let verifier_signature = self
            .signer
            .as_ref()
            .map(|signer| {
                sign_score_digest(
                    signer,
                    self.score_contract_address,
                    self.chain_id,
                    &request.player,
                    request.game_id,
                    seed.bytes,
                    replay.score,
                    game_hash,
                )
            })
            .transpose()?;

        Ok(VerifyGameResponse {
            valid: true,
            reason: None,
            game_hash: Some(to_hex(&game_hash)),
            verifier_signature,
            canonical_score: replay.score,
            canonical_board: replay.board.to_vec(),
            max_tile: replay.max_tile,
            move_count: directions.len(),
        })
    }

    /// 防止玩家自己伪造“好 seed”。
    /// 只有后端实际签发过的 `(player, game_id, seed)` 组合才允许进入重放验证。
    fn ensure_issued_game(&self, request: &VerifyGameRequest) -> Result<()> {
        let player = normalize_player(&request.player);
        let key = issued_game_key(&player, request.game_id);
        let issued_games = self
            .issued_games
            .lock()
            .map_err(|_| anyhow!("issued game store poisoned"))?;
        let issued = issued_games
            .get(&key)
            .ok_or_else(|| anyhow!("game seed was not issued by backend"))?;

        if issued.player != player || issued.game_id != request.game_id {
            bail!("issued game metadata mismatch");
        }
        if issued.seed_hex.to_lowercase() != request.seed.to_lowercase() {
            bail!("seed does not match the backend-issued game");
        }

        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct IssuedGame {
    player: String,
    game_id: u64,
    seed_hex: String,
}

fn load_issued_games(path: &PathBuf) -> HashMap<String, IssuedGame> {
    let Ok(raw) = fs::read_to_string(path) else {
        return HashMap::new();
    };

    serde_json::from_str(&raw).unwrap_or_default()
}

fn persist_issued_games(path: &PathBuf, issued_games: &HashMap<String, IssuedGame>) -> Result<()> {
    let raw = serde_json::to_string_pretty(issued_games)?;
    fs::write(path, raw)?;
    Ok(())
}

/// 重放后的规范结果。
/// 这里的值代表“同一 seed 和 moves 下唯一正确的答案”。
#[derive(Debug, Clone)]
struct ReplayResult {
    board: [u16; BOARD_CELLS],
    score: u64,
    max_tile: u16,
}

/// 用 seed 驱动整局 2048 演化。
/// 这套逻辑必须和前端保持一致，否则验证会出现误判。
fn replay_game(seed: &ParsedSeed, directions: &[Direction]) -> ReplayResult {
    let mut board = [0u16; BOARD_CELLS];
    let mut score = 0u64;
    let mut rng = SeedRng::new(seed.hex.clone());

    spawn_tile(&mut board, &mut rng);
    spawn_tile(&mut board, &mut rng);

    for direction in directions {
        let (moved, gained) = apply_move(&mut board, *direction);
        score += gained;

        if moved {
            spawn_tile(&mut board, &mut rng);
        }
    }

    let max_tile = board.iter().copied().max().unwrap_or(0);
    ReplayResult {
        board,
        score,
        max_tile,
    }
}

/// 对单次方向移动做纯逻辑重放，不在这里生成新块。
fn apply_move(board: &mut [u16; BOARD_CELLS], direction: Direction) -> (bool, u64) {
    let mut moved = false;
    let mut score = 0u64;

    match direction {
        Direction::Left | Direction::Right => {
            for row in 0..BOARD_SIZE {
                let mut line = [0u16; BOARD_SIZE];
                for col in 0..BOARD_SIZE {
                    let source_col = if matches!(direction, Direction::Left) {
                        col
                    } else {
                        BOARD_SIZE - 1 - col
                    };
                    line[col] = board[row * BOARD_SIZE + source_col];
                }

                let (merged, line_score, line_moved) = merge_line(line);
                score += line_score;
                moved |= line_moved;

                for col in 0..BOARD_SIZE {
                    let target_col = if matches!(direction, Direction::Left) {
                        col
                    } else {
                        BOARD_SIZE - 1 - col
                    };
                    board[row * BOARD_SIZE + target_col] = merged[col];
                }
            }
        }
        Direction::Up | Direction::Down => {
            for col in 0..BOARD_SIZE {
                let mut line = [0u16; BOARD_SIZE];
                for row in 0..BOARD_SIZE {
                    let source_row = if matches!(direction, Direction::Up) {
                        row
                    } else {
                        BOARD_SIZE - 1 - row
                    };
                    line[row] = board[source_row * BOARD_SIZE + col];
                }

                let (merged, line_score, line_moved) = merge_line(line);
                score += line_score;
                moved |= line_moved;

                for row in 0..BOARD_SIZE {
                    let target_row = if matches!(direction, Direction::Up) {
                        row
                    } else {
                        BOARD_SIZE - 1 - row
                    };
                    board[target_row * BOARD_SIZE + col] = merged[row];
                }
            }
        }
    }

    (moved, score)
}

/// 合并一行/一列。
/// 规则与标准 2048 一致：同一块每次移动最多参与一次合并。
fn merge_line(line: [u16; BOARD_SIZE]) -> ([u16; BOARD_SIZE], u64, bool) {
    let compacted = line
        .into_iter()
        .filter(|value| *value != 0)
        .collect::<Vec<_>>();
    let mut merged = Vec::with_capacity(BOARD_SIZE);
    let mut score = 0u64;
    let mut index = 0usize;

    while index < compacted.len() {
        let current = compacted[index];
        if index + 1 < compacted.len() && compacted[index + 1] == current {
            let next = current * 2;
            merged.push(next);
            score += next as u64;
            index += 2;
        } else {
            merged.push(current);
            index += 1;
        }
    }

    while merged.len() < BOARD_SIZE {
        merged.push(0);
    }

    let mut merged_line = [0u16; BOARD_SIZE];
    merged_line.copy_from_slice(&merged);
    let moved = merged_line != line;

    (merged_line, score, moved)
}

/// 从当前空位中生成一个新块。
/// 随机位置和 2/4 的出现都由 seed 派生，不依赖运行时随机源。
fn spawn_tile(board: &mut [u16; BOARD_CELLS], rng: &mut SeedRng) {
    let empty_positions = board
        .iter()
        .enumerate()
        .filter_map(|(index, value)| (*value == 0).then_some(index))
        .collect::<Vec<_>>();

    if empty_positions.is_empty() {
        return;
    }

    let chosen_index = rng.next_index(empty_positions.len());
    let tile_value = if rng.next_percent() < 90 { 2 } else { 4 };
    board[empty_positions[chosen_index]] = tile_value;
}

/// 生成这局游戏的唯一摘要。
/// 这个 hash 后续会被前端带到链上，合约用它防止重复提交。
fn compute_game_hash(
    player: &str,
    game_id: u64,
    seed: [u8; 32],
    moves: &str,
    score: u64,
    final_board: &[u16; BOARD_CELLS],
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(player.as_bytes());
    hasher.update(game_id.to_be_bytes());
    hasher.update(seed);
    hasher.update(moves.as_bytes());
    hasher.update(score.to_be_bytes());
    for tile in final_board {
        hasher.update(tile.to_be_bytes());
    }

    hasher.finalize().into()
}

/// 用 verifier 私钥对 game_hash 做 EIP-191 风格签名。
/// 合约侧会用同样的消息前缀做 ecrecover。
fn sign_score_digest(
    signer: &SigningKey,
    contract_address: [u8; 20],
    chain_id: u64,
    player: &str,
    game_id: u64,
    seed: [u8; 32],
    score: u64,
    game_hash: [u8; 32],
) -> Result<String> {
    let digest = score_digest(
        contract_address,
        chain_id,
        parse_address(player)?,
        game_id,
        seed,
        score,
        game_hash,
    );
    let mut hasher = Keccak256::new();
    hasher.update(b"\x19Ethereum Signed Message:\n32");
    hasher.update(digest);

    let (signature, recovery_id) = signer
        .sign_digest_recoverable(hasher)
        .map_err(|error| anyhow!("failed to sign verifier payload: {error}"))?;

    Ok(encode_signature(signature, recovery_id))
}

fn score_digest(
    contract_address: [u8; 20],
    chain_id: u64,
    player: [u8; 20],
    game_id: u64,
    seed: [u8; 32],
    score: u64,
    game_hash: [u8; 32],
) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(32 * 7);
    encoded.extend_from_slice(&left_pad_32(&contract_address));
    encoded.extend_from_slice(&u256_word(chain_id));
    encoded.extend_from_slice(&left_pad_32(&player));
    encoded.extend_from_slice(&u256_word(game_id));
    encoded.extend_from_slice(&seed);
    encoded.extend_from_slice(&u256_word(score));
    encoded.extend_from_slice(&game_hash);
    Keccak256::digest(encoded).into()
}

fn left_pad_32(value: &[u8]) -> [u8; 32] {
    let mut padded = [0u8; 32];
    padded[32 - value.len()..].copy_from_slice(value);
    padded
}

fn u256_word(value: u64) -> [u8; 32] {
    let mut padded = [0u8; 32];
    padded[24..].copy_from_slice(&value.to_be_bytes());
    padded
}

/// 把 Rust `Signature + RecoveryId` 编码成链上常用的 65 字节十六进制串。
fn encode_signature(signature: Signature, recovery_id: RecoveryId) -> String {
    let mut encoded = [0u8; 65];
    encoded[..64].copy_from_slice(&signature.to_bytes());
    encoded[64] = recovery_id.to_byte() + 27;
    format!("0x{}", hex::encode(encoded))
}

/// 把前端的 `UDLR` 操作串解析成方向数组。
fn parse_moves(raw: &str) -> Result<Vec<Direction>> {
    raw.chars()
        .filter(|value| !value.is_whitespace())
        .map(|value| Direction::try_from(value).map_err(anyhow::Error::msg))
        .collect()
}

/// 解析十六进制 seed，同时保留：
/// - 原始 hex 字符串：给自定义 RNG 使用
/// - 32 字节数组：给 game_hash 计算使用
fn parse_seed(raw: &str) -> Result<ParsedSeed> {
    let normalized = raw.trim().trim_start_matches("0x");
    let bytes = hex::decode(normalized).map_err(|_| anyhow!("seed must be hex"))?;
    let array: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow!("seed must be exactly 32 bytes"))?;
    Ok(ParsedSeed {
        hex: normalized.to_owned(),
        bytes: array,
    })
}

/// 把前端传来的一维棋盘数组校正成固定 16 格。
fn normalize_board(board: Vec<u16>) -> Result<[u16; BOARD_CELLS]> {
    if board.len() != BOARD_CELLS {
        bail!("final_board must contain exactly {BOARD_CELLS} cells");
    }

    let mut normalized = [0u16; BOARD_CELLS];
    normalized.copy_from_slice(&board);
    Ok(normalized)
}

/// 对玩家地址做最基础的格式校验。
fn validate_player(player: &str) -> Result<()> {
    let normalized = player.trim().trim_start_matches("0x");
    if normalized.len() != 40 || !normalized.chars().all(|value| value.is_ascii_hexdigit()) {
        bail!("player must be a 20-byte hex address");
    }
    Ok(())
}

fn normalize_player(player: &str) -> String {
    format!("0x{}", player.trim().trim_start_matches("0x").to_lowercase())
}

fn parse_address(value: &str) -> Result<[u8; 20]> {
    let normalized = value.trim().trim_start_matches("0x");
    let bytes = hex::decode(normalized).map_err(|_| anyhow!("address must be hex"))?;
    bytes
        .try_into()
        .map_err(|_| anyhow!("address must be exactly 20 bytes"))
}

fn issued_game_key(player: &str, game_id: u64) -> String {
    format!("{player}:{game_id}")
}

/// 统一输出 0x 前缀的十六进制字符串。
fn to_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

/// 确定性随机数生成器。
/// 它不是密码学安全 RNG，而是“同样的 seed + counter 必然产出同样结果”的可重放 RNG。
struct SeedRng {
    seed_hex: String,
    counter: u64,
}

impl SeedRng {
    fn new(seed_hex: String) -> Self {
        Self {
            seed_hex,
            counter: 0,
        }
    }

    /// 派生 32 字节随机字。
    fn next_word(&mut self) -> [u8; 32] {
        let payload = format!("{}:{}", self.seed_hex, self.counter);
        self.counter += 1;
        simple_hash(&payload)
    }

    /// 从随机字中选一个位置索引。
    fn next_index(&mut self, modulo: usize) -> usize {
        let word = self.next_word();
        // 前端 JS 取的是 `word.slice(0, 8)`，也就是前 8 个十六进制字符 = 4 字节。
        // 这里必须保持完全一致，否则同一 seed 会落在不同空位上。
        let mut value = [0u8; 4];
        value.copy_from_slice(&word[..4]);
        u32::from_be_bytes(value) as usize % modulo
    }

    /// 生成 0-99 的概率值，用来决定出 2 还是 4。
    fn next_percent(&mut self) -> u8 {
        self.next_word()[0] % 100
    }
}

/// 解析后的 seed。
/// `hex` 用于 RNG，`bytes` 用于 game_hash 和签名绑定。
struct ParsedSeed {
    hex: String,
    bytes: [u8; 32],
}

/// 项目自定义的轻量哈希函数。
/// 目标不是密码学强度，而是让前后端都能稳定、便宜地得到同一串伪随机字节。
fn simple_hash(input: &str) -> [u8; 32] {
    let mut h1 = 0x243f6a88u32;
    let mut h2 = 0x85a308d3u32;
    let mut h3 = 0x13198a2eu32;
    let mut h4 = 0x03707344u32;

    for byte in input.bytes() {
        h1 = (h1 ^ byte as u32).wrapping_mul(597_399_067);
        h2 = (h2 ^ byte as u32).wrapping_mul(2_869_860_233);
        h3 = (h3 ^ byte as u32).wrapping_mul(951_274_213);
        h4 = (h4 ^ byte as u32).wrapping_mul(2_716_044_179);
    }

    let mut output = [0u8; 32];
    for chunk_index in 0..8 {
        h1 = (h1 ^ (h1 >> 16)).wrapping_mul(2_246_822_507);
        h2 = (h2 ^ (h2 >> 13)).wrapping_mul(3_266_489_909);
        h3 = (h3 ^ (h3 >> 16)).wrapping_mul(668_265_263);
        h4 = (h4 ^ (h4 >> 13)).wrapping_mul(374_761_393);

        let value = h1 ^ h2 ^ h3 ^ h4;
        output[chunk_index * 4..(chunk_index + 1) * 4].copy_from_slice(&value.to_be_bytes());

        h1 = h1.wrapping_add(0x9e37_79b9);
        h2 = h2.wrapping_add(0x7f4a_7c15);
        h3 = h3.wrapping_add(0x94d0_49bb);
        h4 = h4.wrapping_add(0x5bd1_e995);
    }

    output
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{GameVerifier, ParsedSeed, replay_game};
    use crate::models::{IssueSeedRequest, VerifyGameRequest};

    const TEST_CONTRACT: &str = "0x5B788710133bA6785C0798561aA8546108006Af7";
    const TEST_CHAIN_ID: u64 = 11155111;

    fn temp_store_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        std::env::temp_dir().join(format!("onchain2048-{name}-{nonce}.json"))
    }

    #[test]
    /// 同样的 seed 重放两次，结果必须一致。
    fn replay_is_deterministic() {
        let seed = [7u8; 32];
        let parsed = ParsedSeed {
            hex: hex::encode(seed),
            bytes: seed,
        };
        let first = replay_game(&parsed, &[]);
        let second = replay_game(&parsed, &[]);
        assert_eq!(first.board, second.board);
        assert_eq!(first.score, second.score);
    }

    #[test]
    /// 构造一份“由重放结果反推出来”的请求，验证应当通过。
    fn verify_round_trip_passes() {
        let player = "0x1111111111111111111111111111111111111111".to_owned();
        let verifier = GameVerifier::new(
            None,
            temp_store_path("verify-round-trip"),
            TEST_CONTRACT,
            TEST_CHAIN_ID,
        );
        let issued = verifier
            .issue_seed(IssueSeedRequest {
                player: player.clone(),
            })
            .expect("seed should be issued");
        let parsed = super::parse_seed(&issued.seed).expect("issued seed should parse");
        let replay = replay_game(&parsed, &[]);
        let response = verifier.verify(VerifyGameRequest {
            player,
            game_id: issued.game_id,
            seed: issued.seed,
            seed_mode: Some("backend".to_owned()),
            moves: String::new(),
            claimed_score: replay.score,
            final_board: replay.board.to_vec(),
        });

        assert!(response.valid);
        assert_eq!(response.canonical_score, replay.score);
    }

    #[test]
    /// 对齐前端实现的回归用例：
    /// 这个分数来自同一套 JS `simpleHash + nextIndex(slice(0, 8))` 规则。
    fn replay_matches_frontend_rng_indexing() {
        let parsed = super::parse_seed(
            "0x1111111111111111111111111111111111111111111111111111111111111111",
        )
        .expect("seed should parse");
        let replay = replay_game(
            &parsed,
            &[
                crate::models::Direction::Right,
                crate::models::Direction::Down,
                crate::models::Direction::Left,
                crate::models::Direction::Up,
                crate::models::Direction::Right,
            ],
        );

        assert_eq!(replay.score, 16);
        assert_eq!(
            replay.board,
            [2, 0, 8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4]
        );
    }

    #[test]
    /// backend 重启后，已签发的 seed 仍然应该能继续验证提交。
    fn issued_games_survive_restart() {
        let store_path = temp_store_path("persist-issued-games");
        let player = "0x1111111111111111111111111111111111111111".to_owned();

        let verifier = GameVerifier::new(None, &store_path, TEST_CONTRACT, TEST_CHAIN_ID);
        let issued = verifier
            .issue_seed(IssueSeedRequest {
                player: player.clone(),
            })
            .expect("seed should be issued");

        let restarted = GameVerifier::new(None, &store_path, TEST_CONTRACT, TEST_CHAIN_ID);
        let parsed = super::parse_seed(&issued.seed).expect("issued seed should parse");
        let replay = replay_game(&parsed, &[]);
        let response = restarted.verify(VerifyGameRequest {
            player,
            game_id: issued.game_id,
            seed: issued.seed,
            seed_mode: Some("backend".to_owned()),
            moves: String::new(),
            claimed_score: replay.score,
            final_board: replay.board.to_vec(),
        });

        assert!(response.valid);

        let _ = std::fs::remove_file(store_path);
    }

    #[test]
    /// VRF 模式不依赖 backend 发 seed，因此不应命中 issued-game 校验。
    fn vrf_mode_skips_backend_issued_seed_check() {
        let verifier = GameVerifier::new(
            None,
            temp_store_path("vrf-skip-issued-check"),
            TEST_CONTRACT,
            TEST_CHAIN_ID,
        );
        let seed =
            "0x1111111111111111111111111111111111111111111111111111111111111111".to_owned();
        let parsed = super::parse_seed(&seed).expect("seed should parse");
        let replay = replay_game(&parsed, &[]);

        let response = verifier.verify(VerifyGameRequest {
            player: "0x1111111111111111111111111111111111111111".to_owned(),
            game_id: 999,
            seed,
            seed_mode: Some("vrf".to_owned()),
            moves: String::new(),
            claimed_score: replay.score,
            final_board: replay.board.to_vec(),
        });

        assert!(response.valid);
    }
}

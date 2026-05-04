use serde::{Deserialize, Serialize};

/// 前端操作序列使用的方向枚举。
/// API 层传的是 `U/D/L/R`，解析后转成这个内部类型参与重放。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

impl TryFrom<char> for Direction {
    type Error = String;

    fn try_from(value: char) -> Result<Self, Self::Error> {
        match value {
            'U' | 'u' => Ok(Self::Up),
            'D' | 'd' => Ok(Self::Down),
            'L' | 'l' => Ok(Self::Left),
            'R' | 'r' => Ok(Self::Right),
            _ => Err(format!("unsupported move: {value}")),
        }
    }
}

/// 前端开局时向后端申请一局 seed。
/// 当前模式下，seed 由 backend 生成并登记，替代实时 VRF 回调等待。
#[derive(Debug, Clone, Deserialize)]
pub struct IssueSeedRequest {
    pub player: String,
}

/// 后端返回给前端的新对局 seed。
#[derive(Debug, Clone, Serialize)]
pub struct IssueSeedResponse {
    pub game_id: u64,
    pub seed: String,
    pub mode: String,
}

/// 前端提交给后端的“证明包”。
/// 后端会使用这里的 seed、moves、claimed_score、final_board 做完整重放验证。
#[derive(Debug, Clone, Deserialize)]
pub struct VerifyGameRequest {
    pub player: String,
    pub game_id: u64,
    pub seed: String,
    /// seed 来源：
    /// - `backend`：必须命中后端已签发记录
    /// - `vrf`：允许直接使用链上 VRF 回填的 seed
    #[serde(default)]
    pub seed_mode: Option<String>,
    pub moves: String,
    pub claimed_score: u64,
    pub final_board: Vec<u16>,
}

/// 后端返回给前端的标准响应。
/// `valid=true` 时，前端可继续把 `game_hash + verifier_signature` 送到链上结算。
#[derive(Debug, Clone, Serialize)]
pub struct VerifyGameResponse {
    pub valid: bool,
    pub reason: Option<String>,
    pub game_hash: Option<String>,
    pub verifier_signature: Option<String>,
    pub canonical_score: u64,
    pub canonical_board: Vec<u16>,
    pub max_tile: u16,
    pub move_count: usize,
}

use anyhow::{Context, Result};
use k256::ecdsa::SigningKey;

/// 运行时配置：
/// - `bind_addr` 决定 HTTP 服务监听地址
/// - `verifier_private_key` 决定后端是否会对通过验证的结果签名
#[derive(Clone)]
pub struct Config {
    pub bind_addr: String,
    pub verifier_private_key: Option<SigningKey>,
    pub issued_games_store_path: String,
    pub score_contract_address: String,
    pub chain_id: u64,
}

impl Config {
    /// 从环境变量加载配置。
    /// 不提供 `VERIFIER_PRIVATE_KEY` 时，后端仍可做“只验证不签名”的模式。
    pub fn from_env() -> Result<Self> {
        let bind_addr =
            std::env::var("BACKEND_BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:18080".to_owned());
        let verifier_private_key = std::env::var("VERIFIER_PRIVATE_KEY")
            .ok()
            .map(|value| parse_signing_key(&value))
            .transpose()?;
        let issued_games_store_path = std::env::var("ISSUED_GAMES_STORE_PATH")
            .unwrap_or_else(|_| "./issued-games.json".to_owned());
        let score_contract_address = std::env::var("SCORE_CONTRACT_ADDRESS").unwrap_or_else(|_| {
            "0x5B788710133bA6785C0798561aA8546108006Af7".to_owned()
        });
        let chain_id = std::env::var("CHAIN_ID")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(11155111);

        Ok(Self {
            bind_addr,
            verifier_private_key,
            issued_games_store_path,
            score_contract_address,
            chain_id,
        })
    }
}

/// 解析 secp256k1 私钥，供链上 verifier 签名使用。
fn parse_signing_key(value: &str) -> Result<SigningKey> {
    let normalized = value.trim().trim_start_matches("0x");
    let secret = hex::decode(normalized).context("VERIFIER_PRIVATE_KEY is not valid hex")?;
    SigningKey::from_slice(&secret).context("VERIFIER_PRIVATE_KEY must be a 32-byte secp256k1 key")
}

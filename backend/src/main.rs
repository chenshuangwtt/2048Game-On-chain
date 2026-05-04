mod config;
mod game;
mod models;

use std::{net::SocketAddr, sync::Arc};

use anyhow::Result;
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use axum::http::{
    HeaderValue, Method,
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
};
use config::Config;
use game::GameVerifier;
use models::{IssueSeedRequest, IssueSeedResponse, VerifyGameRequest, VerifyGameResponse};
use tower_http::cors::CorsLayer;
use tracing::info;

/// 共享应用状态。
/// 当前只有一个 verifier；后续如果接数据库或缓存，也可以继续挂在这里。
#[derive(Clone)]
struct AppState {
    verifier: Arc<GameVerifier>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // 允许从 backend/.env 或工作目录 .env 自动加载本地配置。
    let _ = dotenvy::dotenv();

    // 统一初始化 tracing，方便后续接部署环境时直接看日志。
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend=info,axum=info".into()),
        )
        .init();

    let config = Config::from_env()?;
    let verifier = Arc::new(GameVerifier::new(
        config.verifier_private_key,
        &config.issued_games_store_path,
        &config.score_contract_address,
        config.chain_id,
    ));
    // 只对白名单内的本地前端开放跨域，避免浏览器在开发模式下拦截
    // `/api/v1/seed` 和 `/api/v1/verify` 的预检请求。
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:3000".parse::<HeaderValue>()?,
            "http://127.0.0.1:3000".parse::<HeaderValue>()?,
        ])
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([ACCEPT, AUTHORIZATION, CONTENT_TYPE]);
    // 当前后端只暴露两个接口：
    // - `healthz` 用于健康检查
    // - `issue-seed` 用于给前端发放一局新的 backend seed
    // - `verify` 用于接收前端证明包并重放验证
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/v1/seed", post(issue_seed))
        .route("/api/v1/verify", post(verify_game))
        .layer(cors)
        .with_state(AppState { verifier });

    let addr: SocketAddr = config.bind_addr.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("backend listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

/// 最简健康检查接口。
async fn healthz() -> &'static str {
    "ok"
}

/// 核心验证入口：
/// 前端把一局游戏的证明包 POST 过来，后端返回验证结果与可选签名。
async fn verify_game(
    State(state): State<AppState>,
    Json(request): Json<VerifyGameRequest>,
) -> Json<VerifyGameResponse> {
    Json(state.verifier.verify(request))
}

/// 新对局 seed 发放入口。
/// 这是当前默认模式：backend 先发放 seed，用户立即开局，不再阻塞等待 VRF fulfill。
async fn issue_seed(
    State(state): State<AppState>,
    Json(request): Json<IssueSeedRequest>,
) -> Json<IssueSeedResponse> {
    Json(
        state
            .verifier
            .issue_seed(request)
            .unwrap_or_else(|error| IssueSeedResponse {
                game_id: 0,
                seed: format!("error:{error}"),
                mode: "error".to_owned(),
            }),
    )
}

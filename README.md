# 2048 Game On-chain

一个可验证、可演示的链游版 2048。

这个项目不是把 2048 的每一步都搬到链上执行，而是采用更适合真实产品的三段式架构：

- 前端负责交互和展示
- Rust backend 负责 seed 发放、整局重放验证、verifier 签名
- Solidity 合约只负责最终成绩验签结算、历史记录和 Top10

项目同时支持两种随机模式：

- `backend`：默认模式，后端直接签发 seed，立即开局，体验更好
- `vrf`：接入 Chainlink VRF v2.5，真实链上随机，更适合公平性演示

排行榜和历史查询通过 `Subgraph Studio` 提供。

## Features

- Seed 驱动的确定性 2048 逻辑
- Rust verifier 重放验证 `seed + moves + final_board + score`
- Solidity 合约验签结算最终成绩
- 支持 `backend | vrf` 两种模式切换
- Sepolia 部署脚本
- Subgraph 排行榜和个人历史查询

## Architecture

| Module | Responsibility |
| --- | --- |
| `contracts/` | 最终成绩结算、玩家历史、最佳分、Top10、可选 VRF seed 流程 |
| `frontend/` | 钱包连接、开局、游戏交互、结果提交、排行榜与历史展示 |
| `backend/` | 发放 seed、重放验证、生成 verifier 签名 |
| `subgraph/` | 索引 `GameSeedRequested / GameSeedFulfilled / ScoreSubmitted` |

## Game Flow

### Backend mode

1. 玩家连接钱包
2. 前端调用 backend 申请 `seed + gameId`
3. 前端基于该 seed 本地运行 2048，并记录完整操作序列
4. 游戏结束后，前端提交 `player + gameId + seed + moves + claimed_score + final_board`
5. backend 重放整局游戏并返回：
   - `game_hash`
   - `verifier_signature`
   - `canonical_score`
   - `canonical_board`
6. 前端调用合约 `submitVerifiedScoreWithSeed(...)`
7. 合约验签成功后更新链上历史、最佳分和 Top10

### VRF mode

1. 前端调用合约 `requestGameSeed()`
2. Chainlink VRF 回调 `fulfillRandomWords()`
3. 前端读取链上 seed 开始游戏
4. 结束后仍然由 backend 重放验证
5. 前端调用合约 `submitVerifiedScore(...)`

说明：

- 日常开发、演示、联调建议优先使用 `backend`
- `vrf` 模式依赖 subscription、consumer、LINK 余额和回调延迟，更适合做公平性展示

## Seed Modes

前端通过 `frontend/.env.local` 中的 `NEXT_PUBLIC_SEED_MODE` 切换模式：

```env
NEXT_PUBLIC_SEED_MODE=backend
```

可选值：

- `backend`
- `vrf`

页面右上角会显示当前模式，避免调试时混淆。

## Repository Layout

```text
.
├─ backend/
│  ├─ src/
│  ├─ .env.example
│  └─ .env.sepolia.example
├─ contracts/
│  ├─ script/
│  ├─ src/
│  └─ test/
├─ docs/
├─ docs-assets/
├─ frontend/
│  ├─ app/
│  ├─ components/
│  ├─ context/
│  ├─ lib/
│  └─ .env.local.example
├─ subgraph/
├─ .env.example
├─ .gitignore
├─ Makefile
└─ README.md
```

## Environment Files

这个仓库发布到 GitHub 时，不应提交任何真实环境文件、私钥或本地运行态数据。

已忽略：

- root `.env`
- `backend/.env`
- `frontend/.env.local`
- `backend/issued-games.json`

应保留并提交的示例文件：

- [`.env.example`](./.env.example)
- [`backend/.env.example`](./backend/.env.example)
- [`backend/.env.sepolia.example`](./backend/.env.sepolia.example)
- [`frontend/.env.local.example`](./frontend/.env.local.example)

初始化方式：

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

然后再按本地或 Sepolia 场景填值。

## Local Development

### 1. Contract tests

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge install smartcontractkit/chainlink-brownie-contracts --no-git
forge test
```

### 2. Start backend

```bash
cd backend
cargo run
```

### 3. Start frontend

```bash
cd frontend
npm install
npm run dev
```

### 4. Build frontend

```bash
cd frontend
npm run build
```

## Makefile Shortcuts

```bash
make backend
make frontend
make deploy-local
make deploy-sepolia SEED_MODE=backend
make update-sepolia-vrf
```

`deploy-local` 和 `deploy-sepolia` 会自动重写 `frontend/.env.local`，并写入：

- `NEXT_PUBLIC_SEED_MODE`
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_SUBGRAPH_URL`

## Sepolia

当前仓库内的默认示例配置基于下面这组公开可见部署信息：

- Chain: `Sepolia`
- Contract: `0x5B788710133bA6785C0798561aA8546108006Af7`
- Verifier: `0xf03A925C2311a12a43C77782e89761fFB2E03F5F`
- VRF Coordinator: `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`

更完整的 Sepolia 操作清单见 [docs/SEPOLIA.md](./docs/SEPOLIA.md)。

## Subgraph

当前 subgraph 已接入：

- `GameSeedRequested`
- `GameSeedFulfilled`
- `ScoreSubmitted`

前端目前通过 subgraph 查询：

- 排行榜
- 玩家历史

相关文件：

- [`subgraph/subgraph.yaml`](./subgraph/subgraph.yaml)
- [`subgraph/schema.graphql`](./subgraph/schema.graphql)
- [`subgraph/src/on-chain-2048-scores.ts`](./subgraph/src/on-chain-2048-scores.ts)
- [`subgraph/queries.graphql`](./subgraph/queries.graphql)

## Why This Project Is Interesting

- 不是教学性质的“前端提交一个分数”，而是完整的可验证链游架构
- 兼顾可信性、成本和游戏体验
- Rust + Solidity + Next.js + The Graph 的多端协作项目
- 支持真实 VRF，也支持更适合演示的 backend seed 模式

## Interview Notes

项目面试材料见：

- [docs/INTERVIEW_QA.md](./docs/INTERVIEW_QA.md)

## GitHub Readiness Check

当前仓库适合上传 GitHub，但发布前仍建议你再确认一次：

1. `git status` 中没有 `.env`、`backend/.env`、`frontend/.env.local`
2. 没有把测试私钥、RPC key、真实 API key 写死到源码
3. 只提交 `.example` 配置模板
4. 如仓库曾经追踪过真实环境文件，先执行：

```bash
git rm --cached .env backend/.env frontend/.env.local backend/issued-games.json
```

## License

This project is licensed under the [MIT License](./LICENSE).

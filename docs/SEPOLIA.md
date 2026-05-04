# Sepolia Checklist

当前 Sepolia 合约：

- `OnChain2048Scores`: `0x5B788710133bA6785C0798561aA8546108006Af7`
- `Verifier`: `0xf03A925C2311a12a43C77782e89761fFB2E03F5F`
- `VRF Coordinator`: `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`
- `Subscription ID`: `25826793730078314328366205526030404877246361242830098906909790120706324144546`

建议：

- 正常演示优先用 `backend` 模式
- 只有在你确认 VRF subscription 已加 consumer 且已充 LINK 时，再切 `vrf`

## 1. 根目录 `.env`

先准备根目录环境变量，供部署脚本和 VRF 配置更新脚本读取。

```env
SEPOLIA_RPC_URL=
DEPLOYER_PRIVATE_KEY=
VERIFIER_ADDRESS=0xf03A925C2311a12a43C77782e89761fFB2E03F5F

SCORE_CONTRACT_ADDRESS=0x5B788710133bA6785C0798561aA8546108006Af7
CHAIN_ID=11155111

VRF_SUBSCRIPTION_ID=25826793730078314328366205526030404877246361242830098906909790120706324144546
VRF_COORDINATOR_ADDRESS=0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B
VRF_KEY_HASH=0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae
VRF_CALLBACK_GAS_LIMIT=200000
VRF_REQUEST_CONFIRMATIONS=3
VRF_USE_NATIVE_PAYMENT=false
```

## 2. 更新 VRF 配置

如果你更换了 subscription，或者要重新测试 VRF，先更新当前合约的 VRF 配置：

```bash
cd contracts
forge script script/UpdateSepoliaVrfConfig.s.sol:UpdateSepoliaVrfConfig --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

只有在你改了合约逻辑本身时，才需要整份重新部署。

## 3. Chainlink VRF 后台

更新配置后，再去 `vrf.chain.link` 检查：

1. subscription 存在
2. consumer 列表里包含 `0x5B788710133bA6785C0798561aA8546108006Af7`
3. subscription 已充值测试 `LINK`

顺序建议固定为：

1. 更新配置
2. 添加 consumer
3. fund LINK
4. 再测试前端 `vrf` 模式

如果漏了第 2 步，`requestGameSeed()` 会被 coordinator 拒绝。  
如果漏了第 3 步，请求通常会一直 `pending` 或因余额不足失败。

如果 VRF 后台显示 `Failed: Invalid key hash`，说明合约当前 `keyHash` 配错了。  
Sepolia 正确值是：

- `0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae`

## 4. Backend

创建 `backend/.env`：

```env
BACKEND_BIND_ADDR=127.0.0.1:18080
VERIFIER_PRIVATE_KEY=0xYOUR_VERIFIER_PRIVATE_KEY
ISSUED_GAMES_STORE_PATH=./issued-games.json
SCORE_CONTRACT_ADDRESS=0x5B788710133bA6785C0798561aA8546108006Af7
CHAIN_ID=11155111
```

启动：

```bash
cd backend
cargo run
```

健康检查：

```bash
curl http://127.0.0.1:18080/healthz
```

期望返回：

```text
ok
```

## 5. Frontend

确认 `frontend/.env.local` 至少包含：

```env
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_SEED_MODE=backend
NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS=0x5B788710133bA6785C0798561aA8546108006Af7
NEXT_PUBLIC_RPC_URL=https://sepolia.infura.io/v3/your-key
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:18080
NEXT_PUBLIC_SUBGRAPH_URL=https://api.studio.thegraph.com/query/1747522/2048/version/latest
```

启动：

```bash
cd frontend
npm run dev
```

模式说明：

- `NEXT_PUBLIC_SEED_MODE=backend`：默认模式，立即开局
- `NEXT_PUBLIC_SEED_MODE=vrf`：真实 VRF 模式，需要 subscription 配置正确

前端页面右上角会显示当前模式，避免误把 `backend` 当成 `vrf` 测试。

## 6. 钱包与链路确认

进入页面后检查：

1. 钱包网络为 `Sepolia`
2. backend 模式下，开始游戏能立即拿到 seed
3. vrf 模式下，合约能发出 `GameSeedRequested`
4. vrf 模式下，后续能收到 `GameSeedFulfilled`
5. 游戏结束后 backend 返回签名，前端能成功提交 `ScoreSubmitted`

## 7. Subgraph

当前前端使用的 Graph endpoint：

```text
https://api.studio.thegraph.com/query/1747522/2048/version/latest
```

如果更换了 Sepolia 合约地址，记得同步更新 `subgraph/subgraph.yaml` 并重新部署。

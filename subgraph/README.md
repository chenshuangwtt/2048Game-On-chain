# Subgraph

这个目录用于把 `OnChain2048Scores` 接到 `The Graph Studio`。

当前已经预填：

- network: `sepolia`
- contract: `0xCa4fDCc64878CFd8040c2747150d157C213C4c77`
- startBlock: `10600680`

## 索引的事件

- `GameSeedRequested`
- `GameSeedFulfilled`
- `ScoreSubmitted`

## 实体设计

- `Player`
- `GameSession`
- `ScoreEntry`

## 本地命令

```bash
cd subgraph
npm install
npm run codegen
npm run build
```

## 部署到 Studio

先登录并授权：

```bash
graph auth --studio <DEPLOY_KEY>
```

然后把 `package.json` 里的 deploy script 里的 slug 改成你的实际 slug，或直接执行：

```bash
graph deploy --studio <YOUR_SUBGRAPH_SLUG>
```

如果你的 slug 不是 `onchain2048-sepolia`，只需要改这一处。

## 前端后续切换

当前前端排行榜和历史仍然直读合约。
接完 Studio 后，下一步就是：

1. 增加 GraphQL client
2. 把排行榜和历史查询切到 subgraph
3. 保留链上直读作为 fallback 或移除

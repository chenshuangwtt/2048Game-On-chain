# **The Graph Subgraph 操作文档**

## **目标**

本文档提供如何使用 **The Graph** 构建、配置、发布并查询一个 Subgraph 的详细步骤。通过这个过程，我们可以从智能合约中捕获事件，存储数据并通过 GraphQL 查询接口进行访问。

------

## **前提条件**

1. **已部署智能合约**：你需要一个已部署的合约，确保合约中有相关的事件（如 `GameSeedRequested`、`GameSeedFulfilled`、`ScoreSubmitted` 等）。

2. 安装必备工具

   - **Node.js**：需要安装 [Node.js](https://nodejs.org/)。

   - **Graph CLI**：使用 `graph-cli` 工具来初始化、构建和发布 Subgraph。可以通过以下命令安装：

     ```
     npm install -g @graphprotocol/graph-cli
     ```

3. **准备 ABI 文件**：获取已部署合约的 ABI 文件，这通常由 Remix、Truffle 或 Hardhat 提供。

------

## **步骤 1：初始化 Subgraph 项目**

### 1.1 使用 `graph-cli` 初始化 Subgraph 项目

首先，通过 `graph init` 命令来初始化一个新的 Subgraph 项目：

```
graph init --from-contract <合约地址> --network <网络名称> --abi <ABI文件路径> <Subgraph名称>
```

其中：

- `<合约地址>`：填写你已部署合约的地址（例如：`0x5B788710133bA6785C0798561aA8546108006Af7`）。
- `<网络名称>`：指定网络，如 `sepolia`、`mainnet` 等。
- `<ABI文件路径>`：指定你的 ABI 文件路径。
- `<Subgraph名称>`：你为 Subgraph 取一个名字。

这个命令会自动生成一个 Subgraph 项目，并为你生成相关文件：

- `subgraph.yaml`
- `schema.graphql`
- `mappings.ts`

### 1.2 修改 `subgraph.yaml` 文件

在 `subgraph.yaml` 文件中，确认数据源、ABI 和事件配置是否正确。例如：

```
specVersion: 1.0.0
description: 2048 Game Subgraph

schema:
  file: ./schema.graphql

dataSources:
  - kind: ethereum/contract
    name: OnChain2048Scores
    network: sepolia
    source:
      address: "0x5B788710133bA6785C0798561aA8546108006Af7"
      abi: OnChain2048Scores
      startBlock: 10601641
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      file: ./src/mappings.ts
      eventHandlers:
        - event: GameSeedRequested(indexed address,indexed uint256,indexed uint256)
          handler: handleGameSeedRequested
        - event: GameSeedFulfilled(indexed address,indexed uint256,bytes32)
          handler: handleGameSeedFulfilled
        - event: ScoreSubmitted(indexed address,indexed uint256,uint64,bytes32,uint64,bool)
          handler: handleScoreSubmitted
```

### 1.3 编写 `schema.graphql` 文件

在 `schema.graphql` 文件中，定义你需要存储的数据模型。例如：

```
type Player @entity {
  id: ID!
  bestScore: BigInt!
  gamesPlayed: BigInt!
  totalScore: BigInt!
  createdAt: BigInt!
  updatedAt: BigInt!
  lastPlayedAt: BigInt!
}

type GameSession @entity {
  id: ID!
  gameId: BigInt!
  requestId: BigInt!
  player: Player!
  requestedAt: BigInt!
  fulfilledAt: BigInt
  seed: Bytes
  seedReady: Boolean!
  consumed: Boolean!
  requestTxHash: Bytes!
  requestBlockNumber: BigInt!
  fulfillTxHash: Bytes
  fulfillBlockNumber: BigInt
  scoreEntry: ScoreEntry
}

type ScoreEntry @entity {
  id: ID!
  gameHash: Bytes!
  player: Player!
  session: GameSession!
  gameId: BigInt!
  score: BigInt!
  timestamp: BigInt!
  isNewBest: Boolean!
  txHash: Bytes!
  blockNumber: BigInt!
}
```

### 1.4 编写事件处理函数

在 `mappings.ts` 文件中，编写事件处理函数。每个事件都会有一个对应的处理函数，例如：

```
export function handleGameSeedRequested(event: GameSeedRequested): void {
  let player = getOrCreatePlayer(event.params.player.toHexString(), event.block.timestamp);
  let session = new GameSession(getSessionId(event.params.gameId));
  session.gameId = event.params.gameId;
  session.requestId = event.params.requestId;
  session.player = player.id;
  session.save();
}
```

在这个文件中，你需要根据事件的数据来创建或更新实体（例如：`Player`、`GameSession`、`ScoreEntry`）。

------

## **步骤 2：构建和发布 Subgraph**

### 2.1 构建 Subgraph

在完成代码编写后，使用以下命令来构建 Subgraph：

```
graph build
```

这会根据你编写的配置文件（`subgraph.yaml`）和事件处理逻辑，生成对应的 Graph Node 配置文件。

### 2.2 发布 Subgraph

使用以下命令来将 Subgraph 发布到 **The Graph** 网络：

```
graph publish --node https://api.thegraph.com --ipfs https://ipfs.io
```

如果你希望将 Subgraph 部署到自己搭建的 **Graph Node**，需要使用你自己的 **Graph Node** 地址。

### 2.3 获取 Subgraph 地址

发布成功后，你会在 **The Graph Explorer** 上看到你的 Subgraph，并获得一个 Subgraph 地址。这个地址是你在 The Graph 上的唯一标识。

- 访问 [The Graph Explorer](https://thegraph.com/explorer/)
- 输入你的 Subgraph 名称，找到你的 Subgraph 地址。

------

## **步骤 3：查询数据**

### 3.1 配置前端应用

通过 Subgraph 地址，你可以在前端应用中访问 Subgraph 数据。例如，在你的前端应用中可以使用 GraphQL 查询来获取数据：

```
query {
  player(id: "0x...") {
    bestScore
    gamesPlayed
  }
}
```

这样，你就可以通过 GraphQL 查询接口访问从区块链事件中提取的数据。

------

## **总结**

1. 初始化 Subgraph 项目
   - 使用 `graph-cli` 初始化 Subgraph 项目，配置合约 ABI 和地址。
2. 编写 `schema.graphql` 和 `mappings.ts`
   - 定义数据模型（`Player`、`GameSession`、`ScoreEntry`）以及事件处理函数。
3. 构建并发布 Subgraph
   - 使用 `graph build` 构建项目，然后使用 `graph publish` 发布到 **The Graph** 网络。
4. 查询数据
   - 使用 GraphQL 查询接口访问 Subgraph 数据。

这就是将 **The Graph Subgraph** 部署到 **Sepolia 网络**（或其他网络）并查询数据的完整流程。
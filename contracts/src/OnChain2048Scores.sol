// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title OnChain2048Scores
/// @notice 记录验证后的成绩与简易排行榜。
/// @dev 读懂这个合约需要的技能点：
/// 1. Solidity 基础：struct、mapping、event、custom error、权限控制。
/// 2. EVM / 合约工程：链上状态机设计、事件驱动索引、gas 成本意识。
/// 3. Chainlink VRF：subscription、requestRandomWords、fulfillRandomWords 回调模型。
/// 4. 签名验证：EIP-191 风格消息摘要、ecrecover、后端 verifier 模式。
/// 5. 链游架构：链上负责最终结算，链下负责 seed 发放、重放验证和 UI 体验。
///
/// 当前默认流程：
/// - backend 直接签发 seed，前端立即开局；
/// - 游戏结束后 backend 再对最终结果签名，链上只做验签结算。
///
/// VRF 代码没有删除，而是作为 legacy 方案继续保留在合约里：
/// - 方便后续重新切回“链上发 seed”
/// - 也保留给面试 / 文档说明使用
contract OnChain2048Scores is VRFConsumerBaseV2Plus {
    /// @dev 一局游戏的链上会话。
    /// `seedReady=false` 表示 VRF 还没回调；
    /// `consumed=true` 表示这局已经完成成绩提交，不能重复结算。
    struct GameSession {
        address player;
        bytes32 seed;
        uint64 requestedAt;
        uint64 fulfilledAt;
        bool seedReady;
        bool consumed;
    }

    /// @dev 最终上链的成绩条目。
    /// 合约只存“验证通过后的结果”，不存完整棋盘过程。
    struct ScoreEntry {
        address player;
        uint256 gameId;
        uint64 score;
        bytes32 gameHash;
        uint64 timestamp;
    }

    uint8 public constant MAX_LEADERBOARD = 10;
    /// @dev 2048 每局只需要一个基础随机种子，所以请求 1 个随机 word 即可。
    uint32 public constant VRF_NUM_WORDS = 1;

    /// @dev 后端 verifier 地址。只有它签出来的成绩证明才会被接受。
    address public verifier;
    /// @dev Chainlink VRF subscription id，consumer 通过它扣费。
    uint256 public subscriptionId;
    /// @dev Chainlink VRF gas lane / key hash。
    bytes32 public keyHash;
    /// @dev fulfillRandomWords 回调可用 gas。
    uint32 public callbackGasLimit;
    /// @dev 请求确认块数。越大越稳，但响应越慢。
    uint16 public requestConfirmations;
    /// @dev 是否用原生代币支付 VRF 费用；Sepolia 上通常先用 false + LINK subscription。
    bool public useNativePayment;
    /// @dev 项目自己的连续 gameId，便于前后端和 Subgraph 对齐同一局游戏。
    uint256 public nextGameId = 1;

    /// @dev gameId -> session。玩家开始一局后先写入这里，等待 VRF 回调补全 seed。
    mapping(uint256 => GameSession) public games;
    /// @dev gameId -> requestId，方便前端或索引器把业务局号映射到 VRF 请求号。
    mapping(uint256 => uint256) public requestIds;
    /// @dev requestId -> gameId，供 Chainlink 回调时反查到底是哪一局。
    mapping(uint256 => uint256) public requestIdToGameId;
    /// @dev 玩家历史最高分。
    mapping(address => uint64) public bestScores;
    /// @dev 玩家历史成绩列表，按提交顺序追加。
    mapping(address => ScoreEntry[]) private playerHistory;
    /// @dev 防止相同证明包重复上链。
    mapping(bytes32 => bool) public submittedGameHashes;

    /// @dev 简单 Top N 排行榜。规模很小，直接链上排序即可。
    ScoreEntry[] private leaderboard;

    event VerifierUpdated(address indexed previous, address indexed current);
    event VrfConfigUpdated(
        uint256 subscriptionId,
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        bool useNativePayment
    );
    event GameSeedRequested(
        address indexed player,
        uint256 indexed gameId,
        uint256 indexed requestId
    );
    event GameSeedFulfilled(
        address indexed player,
        uint256 indexed gameId,
        bytes32 seed
    );
    event ScoreSubmitted(
        address indexed player,
        uint256 indexed gameId,
        uint64 score,
        bytes32 gameHash,
        uint64 timestamp,
        bool isNewBest
    );

    error InvalidAddress();
    error InvalidSubscriptionId();
    error InvalidCallbackGasLimit();
    error InvalidRequestConfirmations();
    error GameNotFound();
    error NotGameOwner();
    error SeedNotReady();
    error GameAlreadyConsumed();
    error ScoreZero();
    error GameHashAlreadyUsed();
    error InvalidSignature();
    error RequestNotFound();

    constructor(
        address vrfCoordinator,
        address initialVerifier,
        uint256 initialSubscriptionId,
        bytes32 initialKeyHash,
        uint32 initialCallbackGasLimit,
        uint16 initialRequestConfirmations
    ) VRFConsumerBaseV2Plus(vrfCoordinator) {
        if (initialVerifier == address(0)) revert InvalidAddress();
        _setVrfConfig(
            initialSubscriptionId,
            initialKeyHash,
            initialCallbackGasLimit,
            initialRequestConfirmations,
            false
        );
        verifier = initialVerifier;
        emit VerifierUpdated(address(0), initialVerifier);
    }

    /// @notice 更新后端 verifier 地址
    /// @dev verifier 负责对“seed + moves + result”验证通过后的结果签名。
    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert InvalidAddress();

        address previous = verifier;
        verifier = newVerifier;

        emit VerifierUpdated(previous, newVerifier);
    }

    /// @notice 更新 VRF 参数
    /// @dev 真正上 Sepolia 时，一般需要把这里配置成官方 coordinator + 你的 subscription 参数。
    function setVrfConfig(
        uint256 newSubscriptionId,
        bytes32 newKeyHash,
        uint32 newCallbackGasLimit,
        uint16 newRequestConfirmations,
        bool newUseNativePayment
    ) external onlyOwner {
        _setVrfConfig(
            newSubscriptionId,
            newKeyHash,
            newCallbackGasLimit,
            newRequestConfirmations,
            newUseNativePayment
        );
    }

    /// @notice 申请一局新的随机种子
    /// @dev 先生成项目自己的 gameId，再向 Chainlink 发起 requestRandomWords。
    /// `gameId` 和 `requestId` 不是一回事：前者服务业务，后者服务 VRF 回调。
    /// @return gameId 本局的唯一编号
    function requestGameSeed() external returns (uint256 gameId) {
        gameId = nextGameId;
        nextGameId += 1;

        // 这里是真正调用 Chainlink VRF 的地方。
        // 请求发出后不会立刻拿到随机数，后续会由 coordinator 异步回调 fulfillRandomWords。
        uint256 requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: VRF_NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({
                        nativePayment: useNativePayment
                    })
                )
            })
        );

        // 先把“待完成的会话”写入链上；seed 初始为空，等待 VRF 回调补全。
        games[gameId] = GameSession({
            player: msg.sender,
            seed: bytes32(0),
            requestedAt: uint64(block.timestamp),
            fulfilledAt: 0,
            seedReady: false,
            consumed: false
        });
        requestIds[gameId] = requestId;
        requestIdToGameId[requestId] = gameId;

        emit GameSeedRequested(msg.sender, gameId, requestId);
    }

    /// @notice 提交经后端 verifier 签名确认的成绩
    /// @dev 这一步不在链上重放游戏，而是验证：
    /// 1. 这局确实属于 msg.sender；
    /// 2. 这一局的 seed 已经由 VRF 产生；
    /// 3. gameHash 没被重复使用；
    /// 4. verifier 对这份结果签了名。
    function submitVerifiedScore(
        uint256 gameId,
        uint64 score,
        bytes32 gameHash,
        bytes calldata verifierSignature
    ) external {
        GameSession storage game = games[gameId];
        if (game.player == address(0)) revert GameNotFound();
        if (game.player != msg.sender) revert NotGameOwner();
        if (!game.seedReady) revert SeedNotReady();
        if (game.consumed) revert GameAlreadyConsumed();

        game.consumed = true;
        _settleVerifiedScore(
            msg.sender,
            gameId,
            game.seed,
            score,
            gameHash,
            verifierSignature
        );
    }

    /// @notice 当前默认的结算入口：seed 由 backend 发放，不要求链上先存在 VRF session。
    /// @dev verifier 会同时对 `seed + score + gameHash` 做签名，因此链上无需自己保存 seed。
    function submitVerifiedScoreWithSeed(
        uint256 gameId,
        bytes32 seed,
        uint64 score,
        bytes32 gameHash,
        bytes calldata verifierSignature
    ) external {
        _settleVerifiedScore(
            msg.sender,
            gameId,
            seed,
            score,
            gameHash,
            verifierSignature
        );
    }

    function getLeaderboard() external view returns (ScoreEntry[] memory) {
        return leaderboard;
    }

    function leaderboardLength() external view returns (uint256) {
        return leaderboard.length;
    }

    function getPlayerHistoryCount(
        address player
    ) external view returns (uint256) {
        return playerHistory[player].length;
    }

    function getPlayerHistory(
        address player,
        uint256 offset,
        uint256 limit
    ) external view returns (ScoreEntry[] memory) {
        ScoreEntry[] storage entries = playerHistory[player];
        uint256 count = entries.length;
        if (offset >= count || limit == 0) {
            return new ScoreEntry[](0);
        }

        uint256 remaining = count - offset;
        uint256 size = limit < remaining ? limit : remaining;
        ScoreEntry[] memory result = new ScoreEntry[](size);

        for (uint256 i = 0; i < size; i++) {
            result[i] = entries[count - 1 - offset - i];
        }

        return result;
    }

    function getScoreDigest(
        address player,
        uint256 gameId,
        bytes32 seed,
        uint64 score,
        bytes32 gameHash
    ) external view returns (bytes32) {
        // 暴露给后端或测试使用，保证链下生成的 digest 与链上验证逻辑完全一致。
        return _scoreDigest(player, gameId, seed, score, gameHash);
    }

    /// @dev Chainlink VRF 异步回调入口。
    /// coordinator 会把 requestId 对应的随机数送回来，这里再反查 gameId 完成 seed 落库。
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        uint256 gameId = requestIdToGameId[requestId];
        if (gameId == 0) revert RequestNotFound();

        GameSession storage game = games[gameId];
        if (game.player == address(0)) revert GameNotFound();
        if (game.seedReady) revert SeedNotReady();

        // 本项目只请求一个随机 word，把它直接压成 bytes32 当作整局游戏的基础 seed。
        bytes32 seed = bytes32(randomWords[0]);
        game.seed = seed;
        game.fulfilledAt = uint64(block.timestamp);
        game.seedReady = true;

        emit GameSeedFulfilled(game.player, gameId, seed);
    }

    function _setVrfConfig(
        uint256 newSubscriptionId,
        bytes32 newKeyHash,
        uint32 newCallbackGasLimit,
        uint16 newRequestConfirmations,
        bool newUseNativePayment
    ) internal {
        if (newSubscriptionId == 0) revert InvalidSubscriptionId();
        if (newKeyHash == bytes32(0)) revert InvalidAddress();
        if (newCallbackGasLimit == 0) revert InvalidCallbackGasLimit();
        if (newRequestConfirmations == 0) revert InvalidRequestConfirmations();

        // 这几个参数决定了 VRF 请求如何计费、走哪条 gas lane、以及回调时能消耗多少 gas。
        subscriptionId = newSubscriptionId;
        keyHash = newKeyHash;
        callbackGasLimit = newCallbackGasLimit;
        requestConfirmations = newRequestConfirmations;
        useNativePayment = newUseNativePayment;

        emit VrfConfigUpdated(
            newSubscriptionId,
            newKeyHash,
            newCallbackGasLimit,
            newRequestConfirmations,
            newUseNativePayment
        );
    }

    function _settleVerifiedScore(
        address player,
        uint256 gameId,
        bytes32 seed,
        uint64 score,
        bytes32 gameHash,
        bytes calldata verifierSignature
    ) internal {
        if (score == 0) revert ScoreZero();
        if (submittedGameHashes[gameHash]) revert GameHashAlreadyUsed();

        // 摘要里绑定了：合约地址、链 ID、玩家、gameId、seed、score、gameHash。
        // 这样不同链、不同合约、不同局之间的签名不能混用。
        bytes32 digest = _scoreDigest(player, gameId, seed, score, gameHash);
        address recovered = _recoverSigner(digest, verifierSignature);
        if (recovered != verifier) revert InvalidSignature();

        submittedGameHashes[gameHash] = true;

        uint64 previousBest = bestScores[player];
        bool isNewBest = score > previousBest;
        if (isNewBest) {
            bestScores[player] = score;
        }

        ScoreEntry memory entry = ScoreEntry({
            player: player,
            gameId: gameId,
            score: score,
            gameHash: gameHash,
            timestamp: uint64(block.timestamp)
        });

        playerHistory[player].push(entry);
        _upsertLeaderboard(entry);

        emit ScoreSubmitted(
            player,
            gameId,
            score,
            gameHash,
            uint64(block.timestamp),
            isNewBest
        );
    }

    function _scoreDigest(
        address player,
        uint256 gameId,
        bytes32 seed,
        uint64 score,
        bytes32 gameHash
    ) internal view returns (bytes32) {
        // 这里故意把 address(this) 和 block.chainid 也编码进去，避免跨链/跨合约重放签名。
        return
            keccak256(
                abi.encode(
                    address(this),
                    block.chainid,
                    player,
                    gameId,
                    seed,
                    score,
                    gameHash
                )
            );
    }

    /// @dev Top N 很小，所以直接“替换最低分 + O(n^2) 排序”就够了。
    function _upsertLeaderboard(ScoreEntry memory entry) internal {
        uint256 length = leaderboard.length;

        if (length < MAX_LEADERBOARD) {
            leaderboard.push(entry);
            _sortLeaderboard();
            return;
        }

        uint256 lowestIndex = 0;
        uint64 lowestScore = leaderboard[0].score;
        for (uint256 i = 1; i < length; i++) {
            if (leaderboard[i].score < lowestScore) {
                lowestScore = leaderboard[i].score;
                lowestIndex = i;
            }
        }

        if (entry.score <= lowestScore) {
            return;
        }

        leaderboard[lowestIndex] = entry;
        _sortLeaderboard();
    }

    /// @dev 排序规则：分数高的优先；同分时更早提交的优先。
    function _sortLeaderboard() internal {
        uint256 length = leaderboard.length;
        for (uint256 i = 0; i < length; i++) {
            for (uint256 j = i + 1; j < length; j++) {
                if (
                    leaderboard[j].score > leaderboard[i].score ||
                    (leaderboard[j].score == leaderboard[i].score &&
                        leaderboard[j].timestamp < leaderboard[i].timestamp)
                ) {
                    ScoreEntry memory temp = leaderboard[i];
                    leaderboard[i] = leaderboard[j];
                    leaderboard[j] = temp;
                }
            }
        }
    }

    /// @dev 从 verifier 提供的 65 字节签名中恢复 signer。
    /// 这里采用的是常见的 EIP-191 personal_sign / eth_sign 消息前缀。
    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        if (signature.length != 65) {
            return address(0);
        }

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (v < 27) {
            v += 27;
        }

        if (v != 27 && v != 28) {
            return address(0);
        }

        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );

        return ecrecover(ethSignedMessageHash, v, r, s);
    }
}

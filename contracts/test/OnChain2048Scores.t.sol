// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OnChain2048Scores} from "../src/OnChain2048Scores.sol";
import {VRFCoordinatorV2_5Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address newSender) external;
    function expectRevert(bytes4 reason) external;
    function expectRevert(bytes calldata reason) external;
    function sign(
        uint256 privateKey,
        bytes32 digest
    ) external returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 privateKey) external returns (address);
}

contract OnChain2048ScoresTest {
    Vm private constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant VERIFIER_PK = 0xA11CE;
    bytes32 private constant GAS_LANE =
        hex"1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be";

    VRFCoordinatorV2_5Mock private coordinator;
    OnChain2048Scores private scores;
    uint256 private subscriptionId;
    address private verifier;

    function setUp() public {
        verifier = vm.addr(VERIFIER_PK);
        coordinator = new VRFCoordinatorV2_5Mock(0.1 ether, 1e9, 4e15);
        subscriptionId = coordinator.createSubscription();
        coordinator.fundSubscription(subscriptionId, 10_000 ether);

        scores = new OnChain2048Scores(
            address(coordinator),
            verifier,
            subscriptionId,
            GAS_LANE,
            500_000,
            3
        );

        coordinator.addConsumer(subscriptionId, address(scores));
    }

    function testRequestGameSeedCreatesPendingSession() public {
        uint256 gameId = scores.requestGameSeed();

        (
            address player,
            bytes32 seed,
            uint64 requestedAt,
            uint64 fulfilledAt,
            bool seedReady,
            bool consumed
        ) = scores.games(gameId);

        assertEq(gameId, uint256(1), "game id");
        assertEq(player, address(this), "player");
        assertEq(seed, bytes32(0), "seed");
        assertEq(uint256(requestedAt), block.timestamp, "requestedAt");
        assertEq(uint256(fulfilledAt), uint256(0), "fulfilledAt");
        assertEq(seedReady, false, "seedReady");
        assertEq(consumed, false, "consumed");
        require(scores.requestIds(gameId) != 0, "requestId missing");
    }

    function testOnlyCoordinatorCanFulfillSeed() public {
        uint256 gameId = scores.requestGameSeed();
        uint256 requestId = scores.requestIds(gameId);
        uint256[] memory words = new uint256[](1);
        words[0] = 11;

        vm.prank(address(0xBEEF));
        vm.expectRevert(
            abi.encodeWithSelector(
                VRFConsumerBaseV2Plus.OnlyCoordinatorCanFulfill.selector,
                address(0xBEEF),
                address(coordinator)
            )
        );
        scores.rawFulfillRandomWords(requestId, words);
    }

    function testSubmitRequiresReadySeed() public {
        uint256 gameId = scores.requestGameSeed();

        vm.expectRevert(OnChain2048Scores.SeedNotReady.selector);
        scores.submitVerifiedScore(gameId, 100, keccak256("game"), hex"");
    }

    function testSubmitVerifiedScoreRecordsHistoryAndBest() public {
        uint256 gameId = _prepareGame(address(this), bytes32(uint256(11)));
        bytes32 gameHash = keccak256("game-1");
        bytes memory signature = _signFor(
            address(this),
            gameId,
            bytes32(uint256(11)),
            120,
            gameHash
        );

        scores.submitVerifiedScore(gameId, 120, gameHash, signature);

        assertEq(
            uint256(scores.bestScores(address(this))),
            uint256(120),
            "best"
        );
        assertEq(
            scores.getPlayerHistoryCount(address(this)),
            uint256(1),
            "history count"
        );
        assertEq(scores.submittedGameHashes(gameHash), true, "game hash used");

        OnChain2048Scores.ScoreEntry[] memory history = scores.getPlayerHistory(
            address(this),
            0,
            10
        );
        assertEq(history.length, uint256(1), "history length");
        assertEq(history[0].gameId, gameId, "history game id");
        assertEq(uint256(history[0].score), uint256(120), "history score");
        assertEq(history[0].gameHash, gameHash, "history game hash");

        (
            ,
            ,
            ,
            ,
            bool seedReady,
            bool consumed
        ) = scores.games(gameId);
        assertEq(seedReady, true, "ready");
        assertEq(consumed, true, "consumed");
    }

    function testRejectsWrongSigner() public {
        uint256 gameId = _prepareGame(address(this), bytes32(uint256(22)));
        bytes32 gameHash = keccak256("game-2");

        vm.expectRevert(OnChain2048Scores.InvalidSignature.selector);
        scores.submitVerifiedScore(gameId, 180, gameHash, hex"1234");
    }

    function testPlayerCannotSubmitAnotherPlayersGame() public {
        address player = address(0x100);
        uint256 gameId = _prepareGame(player, bytes32(uint256(33)));
        bytes32 gameHash = keccak256("game-3");
        bytes memory signature = _signFor(
            player,
            gameId,
            bytes32(uint256(33)),
            240,
            gameHash
        );

        vm.expectRevert(OnChain2048Scores.NotGameOwner.selector);
        scores.submitVerifiedScore(gameId, 240, gameHash, signature);
    }

    function testGameCannotBeSubmittedTwice() public {
        uint256 gameId = _prepareGame(address(this), bytes32(uint256(44)));
        bytes32 gameHash = keccak256("game-4");
        bytes memory signature = _signFor(
            address(this),
            gameId,
            bytes32(uint256(44)),
            512,
            gameHash
        );

        scores.submitVerifiedScore(gameId, 512, gameHash, signature);

        vm.expectRevert(OnChain2048Scores.GameAlreadyConsumed.selector);
        scores.submitVerifiedScore(gameId, 512, gameHash, signature);
    }

    function testHistoryPaginationReturnsLatestFirst() public {
        uint256 firstGameId = _prepareGame(address(this), bytes32(uint256(101)));
        uint256 secondGameId = _prepareGame(
            address(this),
            bytes32(uint256(102))
        );
        uint256 thirdGameId = _prepareGame(address(this), bytes32(uint256(103)));

        scores.submitVerifiedScore(
            firstGameId,
            100,
            keccak256("first"),
            _signFor(
                address(this),
                firstGameId,
                bytes32(uint256(101)),
                100,
                keccak256("first")
            )
        );
        scores.submitVerifiedScore(
            secondGameId,
            200,
            keccak256("second"),
            _signFor(
                address(this),
                secondGameId,
                bytes32(uint256(102)),
                200,
                keccak256("second")
            )
        );
        scores.submitVerifiedScore(
            thirdGameId,
            300,
            keccak256("third"),
            _signFor(
                address(this),
                thirdGameId,
                bytes32(uint256(103)),
                300,
                keccak256("third")
            )
        );

        OnChain2048Scores.ScoreEntry[] memory latest = scores.getPlayerHistory(
            address(this),
            0,
            2
        );
        assertEq(latest.length, uint256(2), "latest length");
        assertEq(uint256(latest[0].score), uint256(300), "latest first");
        assertEq(uint256(latest[1].score), uint256(200), "latest second");

        OnChain2048Scores.ScoreEntry[] memory oldest = scores.getPlayerHistory(
            address(this),
            2,
            2
        );
        assertEq(oldest.length, uint256(1), "oldest length");
        assertEq(uint256(oldest[0].score), uint256(100), "oldest score");
    }

    function testLeaderboardSortedByScoreAndTimestamp() public {
        _submitAs(address(0x1), 100, bytes32(uint256(201)), keccak256("a"));
        vm.warp(2);
        _submitAs(address(0x2), 300, bytes32(uint256(202)), keccak256("b"));
        vm.warp(1);
        _submitAs(address(0x3), 300, bytes32(uint256(203)), keccak256("c"));

        OnChain2048Scores.ScoreEntry[] memory board = scores.getLeaderboard();
        assertEq(board.length, uint256(3), "length");
        assertEq(board[0].player, address(0x3), "earlier tie first");
        assertEq(board[1].player, address(0x2), "later tie second");
        assertEq(board[2].player, address(0x1), "third");
    }

    function testLeaderboardMaxSizeAndReplacement() public {
        for (uint256 i = 0; i < 10; i++) {
            _submitAs(
                address(uint160(0x100 + i)),
                uint64(100 + i),
                bytes32(uint256(500 + i)),
                keccak256(abi.encodePacked("seed", i))
            );
        }

        _submitAs(address(0xABC), 50, bytes32(uint256(9991)), keccak256("low"));
        OnChain2048Scores.ScoreEntry[] memory board = scores.getLeaderboard();
        assertEq(board.length, uint256(10), "leaderboard capped");
        require(!_contains(board, address(0xABC)), "low score should not enter");

        _submitAs(
            address(0xDEF),
            999,
            bytes32(uint256(9992)),
            keccak256("high")
        );
        board = scores.getLeaderboard();
        assertEq(board.length, uint256(10), "leaderboard still capped");
        require(_contains(board, address(0xDEF)), "high score should enter");
    }

    function _prepareGame(
        address player,
        bytes32 seed
    ) internal returns (uint256 gameId) {
        vm.prank(player);
        gameId = scores.requestGameSeed();

        uint256 requestId = scores.requestIds(gameId);
        uint256[] memory words = new uint256[](1);
        words[0] = uint256(seed);
        coordinator.fulfillRandomWordsWithOverride(
            requestId,
            address(scores),
            words
        );
    }

    function _submitAs(
        address player,
        uint64 score,
        bytes32 seed,
        bytes32 gameHash
    ) internal {
        uint256 gameId = _prepareGame(player, seed);
        bytes memory signature = _signFor(player, gameId, seed, score, gameHash);
        vm.prank(player);
        scores.submitVerifiedScore(gameId, score, gameHash, signature);
    }

    function _signFor(
        address player,
        uint256 gameId,
        bytes32 seed,
        uint64 score,
        bytes32 gameHash
    ) internal returns (bytes memory) {
        bytes32 digest = scores.getScoreDigest(
            player,
            gameId,
            seed,
            score,
            gameHash
        );
        bytes32 ethSignedDigest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_PK, ethSignedDigest);
        return abi.encodePacked(r, s, v);
    }

    function _contains(
        OnChain2048Scores.ScoreEntry[] memory entries,
        address player
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].player == player) {
                return true;
            }
        }
        return false;
    }

    function assertEq(uint256 a, uint256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(address a, address b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(bytes32 a, bytes32 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(bool a, bool b, string memory message) internal pure {
        require(a == b, message);
    }
}

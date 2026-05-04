// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {OnChain2048Scores} from "../src/OnChain2048Scores.sol";

/// @notice Sepolia 部署脚本。
/// 依赖你事先准备好的：
/// - Chainlink VRF subscription
/// - verifier 地址
/// - 部署账户私钥
contract DeploySepolia is Script {
    address internal constant SEPOLIA_VRF_COORDINATOR =
        0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B;
    bytes32 internal constant SEPOLIA_GAS_LANE =
        hex"787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae";
    uint32 internal constant DEFAULT_CALLBACK_GAS_LIMIT = 200_000;
    uint16 internal constant DEFAULT_REQUEST_CONFIRMATIONS = 3;

    function run() external returns (OnChain2048Scores deployed) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");
        uint256 subscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID");
        address vrfCoordinator = vm.envOr(
            "VRF_COORDINATOR_ADDRESS",
            SEPOLIA_VRF_COORDINATOR
        );
        bytes32 keyHash = vm.envOr("VRF_KEY_HASH", SEPOLIA_GAS_LANE);
        uint32 callbackGasLimit = uint32(
            vm.envOr(
                "VRF_CALLBACK_GAS_LIMIT",
                uint256(DEFAULT_CALLBACK_GAS_LIMIT)
            )
        );
        uint16 requestConfirmations = uint16(
            vm.envOr(
                "VRF_REQUEST_CONFIRMATIONS",
                uint256(DEFAULT_REQUEST_CONFIRMATIONS)
            )
        );

        vm.startBroadcast(deployerPrivateKey);

        deployed = new OnChain2048Scores(
            vrfCoordinator,
            verifier,
            subscriptionId,
            keyHash,
            callbackGasLimit,
            requestConfirmations
        );

        vm.stopBroadcast();

        console2.log("SEPOLIA_VRF_COORDINATOR=", vrfCoordinator);
        console2.log("SEPOLIA_VRF_SUBSCRIPTION_ID=", subscriptionId);
        console2.logBytes32(keyHash);
        console2.log("ONCHAIN2048_ADDRESS=", address(deployed));
        console2.log("VERIFIER_ADDRESS=", verifier);
        console2.log(
            "IMPORTANT: add this contract as a consumer in your Chainlink VRF subscription."
        );
    }
}

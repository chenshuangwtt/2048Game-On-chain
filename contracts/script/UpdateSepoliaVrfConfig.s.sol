// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {OnChain2048Scores} from "../src/OnChain2048Scores.sol";

/// @notice Updates the VRF config on an already deployed Sepolia contract.
/// Use this when the consumer contract address is already live, but the VRF
/// keyHash / gas lane or other config needs to be corrected.
contract UpdateSepoliaVrfConfig is Script {
    bytes32 internal constant SEPOLIA_GAS_LANE =
        hex"787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae";
    uint32 internal constant DEFAULT_CALLBACK_GAS_LIMIT = 200_000;
    uint16 internal constant DEFAULT_REQUEST_CONFIRMATIONS = 3;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address contractAddress = vm.envAddress("SCORE_CONTRACT_ADDRESS");
        uint256 subscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID");
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
        bool useNativePayment = vm.envOr("VRF_USE_NATIVE_PAYMENT", false);

        vm.startBroadcast(deployerPrivateKey);

        OnChain2048Scores(contractAddress).setVrfConfig(
            subscriptionId,
            keyHash,
            callbackGasLimit,
            requestConfirmations,
            useNativePayment
        );

        vm.stopBroadcast();

        console2.log("UPDATED_CONTRACT=", contractAddress);
        console2.log("UPDATED_SUBSCRIPTION_ID=", subscriptionId);
        console2.logBytes32(keyHash);
    }
}

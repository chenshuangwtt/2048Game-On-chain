// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {OnChain2048Scores} from "../src/OnChain2048Scores.sol";
import {VRFCoordinatorV2_5Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";

/// @notice 本地开发部署脚本：
/// 1. 部署 VRF mock
/// 2. 创建并充值 subscription
/// 3. 部署主合约
/// 4. 把主合约加入 subscription consumer
contract DeployLocal is Script {
    bytes32 internal constant DEFAULT_GAS_LANE =
        hex"1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be";
    uint32 internal constant DEFAULT_CALLBACK_GAS_LIMIT = 500_000;
    uint16 internal constant DEFAULT_REQUEST_CONFIRMATIONS = 3;

    function run() external returns (OnChain2048Scores deployed) {
        uint256 deployerPrivateKey = vm.envUint("ANVIL_PRIVATE_KEY");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");
        uint256 mockFundingAmount = vm.envOr(
            "LOCAL_VRF_SUB_FUNDING",
            uint256(10_000 ether)
        );

        vm.startBroadcast(deployerPrivateKey);

        VRFCoordinatorV2_5Mock coordinator = new VRFCoordinatorV2_5Mock(
            0.1 ether,
            1e9,
            4e15
        );
        uint256 subscriptionId = coordinator.createSubscription();
        coordinator.fundSubscription(subscriptionId, mockFundingAmount);

        deployed = new OnChain2048Scores(
            address(coordinator),
            verifier,
            subscriptionId,
            DEFAULT_GAS_LANE,
            DEFAULT_CALLBACK_GAS_LIMIT,
            DEFAULT_REQUEST_CONFIRMATIONS
        );

        coordinator.addConsumer(subscriptionId, address(deployed));

        vm.stopBroadcast();

        console2.log("LOCAL_VRF_COORDINATOR=", address(coordinator));
        console2.log("LOCAL_VRF_SUBSCRIPTION_ID=", subscriptionId);
        console2.log("ONCHAIN2048_ADDRESS=", address(deployed));
        console2.log("VERIFIER_ADDRESS=", verifier);
    }
}

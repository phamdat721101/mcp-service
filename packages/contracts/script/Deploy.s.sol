// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Script, console2} from "forge-std/Script.sol";
import {X402FeeSplitFacilitator} from "../src/X402FeeSplitFacilitator.sol";

/**
 * @notice One-shot deploy script for X402FeeSplitFacilitator.
 *
 *         Run per chain:
 *           forge script script/Deploy.s.sol:Deploy \
 *             --rpc-url $BASE_SEPOLIA_RPC \
 *             --broadcast --verify
 *
 *         The deployer address picks fee receiver via $FEE_RECEIVER env. The
 *         deployed contract address is logged; copy it into
 *         packages/shared/src/contracts.ts.
 */
contract Deploy is Script {
    function run() external returns (address facilitator) {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        vm.startBroadcast(pk);

        X402FeeSplitFacilitator x = new X402FeeSplitFacilitator();
        facilitator = address(x);

        vm.stopBroadcast();
        console2.log("X402FeeSplitFacilitator deployed:", facilitator);
        console2.log("MAX_FEE_BPS:", x.MAX_FEE_BPS());
    }
}

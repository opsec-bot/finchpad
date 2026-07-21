// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {FinchToken} from "../src/FinchToken.sol";
import {FinchFactory} from "../src/FinchFactory.sol";
import {FinchLocker} from "../src/FinchLocker.sol";
import {FeeRightsRegistry} from "../src/FeeRightsRegistry.sol";
import {FinchLock} from "../src/FinchLock.sol";

/**
 * @notice Deploys the finchpad contract suite and wires it up.
 *
 * Run (testnet first):
 *   forge script script/Deploy.s.sol --rpc-url rh_testnet --broadcast --private-key $PRIVATE_KEY
 *
 * Required env:
 *   PRIVATE_KEY               deployer key (never committed; passed at runtime)
 *   FINCH_POSITION_MANAGER    Uniswap V3 NonfungiblePositionManager for the target chain
 *   FINCH_WETH                WETH (quote token) for the target chain
 * Optional env (default in parens):
 *   FINCH_ADMIN               admin/owner (deployer)
 *   FINCH_PROTOCOL_RECIPIENT  protocol fee recipient (deployer)
 *   FINCH_FEE_RECIPIENT       launch-fee recipient (deployer)
 *   FINCH_GITHUB_SIGNER       EIP-712 signer for GitHub claims (address(0) until provisioned)
 *   FINCH_PROTOCOL_BPS        protocol fee share in bps (2000 = 80/20)
 *
 * Mainnet periphery (from docs, chain 4663):
 *   position manager 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3
 *   WETH             0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
 */
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address positionManager = vm.envAddress("FINCH_POSITION_MANAGER");
        address weth = vm.envAddress("FINCH_WETH");
        address admin = vm.envOr("FINCH_ADMIN", deployer);
        address protocolRecipient = vm.envOr("FINCH_PROTOCOL_RECIPIENT", deployer);
        address feeRecipient = vm.envOr("FINCH_FEE_RECIPIENT", deployer);
        address githubSigner = vm.envOr("FINCH_GITHUB_SIGNER", address(0));
        uint16 protocolBps = uint16(vm.envOr("FINCH_PROTOCOL_BPS", uint256(2000)));

        vm.startBroadcast(pk);

        FinchToken impl = new FinchToken();
        FinchFactory factory =
            new FinchFactory(address(impl), positionManager, weth, protocolBps, feeRecipient, admin);
        FinchLocker locker = new FinchLocker(address(factory), positionManager, weth, protocolRecipient, admin);
        FeeRightsRegistry registry = new FeeRightsRegistry(address(locker), githubSigner, admin);
        FinchLock lockVault = new FinchLock();

        // Wiring (requires admin == deployer; hand off admin afterward if desired).
        require(admin == deployer, "set FINCH_ADMIN to the deployer for one-shot wiring, or wire manually");
        factory.setLocker(address(locker));
        locker.setRegistry(address(registry));

        vm.stopBroadcast();

        console.log("FinchToken impl:   ", address(impl));
        console.log("FinchFactory:      ", address(factory));
        console.log("FinchLocker:       ", address(locker));
        console.log("FeeRightsRegistry: ", address(registry));
        console.log("FinchLock:         ", address(lockVault));
    }
}

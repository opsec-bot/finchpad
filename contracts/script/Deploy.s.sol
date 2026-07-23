// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {FinchToken} from "../src/FinchToken.sol";
import {FinchFactory} from "../src/FinchFactory.sol";
import {FinchLocker} from "../src/FinchLocker.sol";
import {FeeRightsRegistry} from "../src/FeeRightsRegistry.sol";
import {FinchLock} from "../src/FinchLock.sol";
import {FeatureBoost} from "../src/FeatureBoost.sol";

/**
 * @notice Deploys the finchpad contract suite and wires it up.
 *
 * PREFERRED — sign with a Ledger, so no private key ever exists in plaintext:
 *   export FINCH_DEPLOYER=0xYourLedgerAddress
 *   forge script script/Deploy.s.sol --rpc-url rh_mainnet \
 *     --ledger --sender $FINCH_DEPLOYER --broadcast
 *
 *   The Ledger only needs the Ethereum app. Chain id is just a transaction field (EIP-155),
 *   so there is no "Robinhood app" to install. Enable Blind signing in the Ethereum app
 *   settings — contract deployments cannot be decoded into human-readable text on-device.
 *
 * Alternative (testing only — puts a raw key in your environment):
 *   forge script script/Deploy.s.sol --rpc-url rh_testnet --broadcast --private-key $PRIVATE_KEY
 *
 * Required env:
 *   FINCH_DEPLOYER            deployer address (Ledger path). Or PRIVATE_KEY for the raw-key path.
 *   FINCH_POSITION_MANAGER    Uniswap V3 NonfungiblePositionManager for the target chain
 *   FINCH_SWAP_ROUTER         Uniswap SwapRouter02 (the optional creator buy routes through it)
 *   FINCH_WETH                WETH (quote token) for the target chain
 * Optional env (default in parens):
 *   FINCH_ADMIN               admin/owner for one-shot wiring (MUST equal the deployer)
 *   FINCH_SAFE                protocol Safe to receive ongoing admin (registry now, locker
 *                             pending its acceptOwnership); unset = admin stays on deployer
 *   FINCH_PROTOCOL_RECIPIENT  protocol fee recipient (deployer)
 *   FINCH_FEE_RECIPIENT       launch-fee recipient (deployer)
 *   FINCH_GITHUB_SIGNER       EIP-712 signer for GitHub claims (address(0) until provisioned)
 *   FINCH_PROTOCOL_BPS        protocol fee share in bps (2000 = 80/20)
 *   FINCH_REFERRAL_BPS        referral commission, in bps of the protocol share (1000 = 10%)
 *   FINCH_GRAD_BONUS_BPS      bps shifted protocol->creator once graduated (500 = 20%->15%)
 *   FINCH_GRAD_FEE_THRESHOLD  lifetime collected WETH fees that count as graduated, wei
 *                             (default 0.25 ether ~= 25 ETH of cumulative buy volume at the
 *                             1% tier). Set very high to disable the graduation discount.
 *   FINCH_BOOST_PRICE_PER_HOUR FeatureBoost price per boost-hour, wei (default 0.001 ether)
 *
 * Mainnet periphery (from docs, chain 4663):
 *   position manager 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3
 *   WETH             0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
 */
contract Deploy is Script {
    function run() external {
        // Ledger path (preferred): PRIVATE_KEY unset, deployer comes from FINCH_DEPLOYER and
        // forge signs via --ledger. Raw-key path is kept only for local/testnet convenience.
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = pk != 0 ? vm.addr(pk) : vm.envAddress("FINCH_DEPLOYER");

        address positionManager = vm.envAddress("FINCH_POSITION_MANAGER");
        address swapRouter = vm.envAddress("FINCH_SWAP_ROUTER");
        address weth = vm.envAddress("FINCH_WETH");
        address admin = vm.envOr("FINCH_ADMIN", deployer);
        address protocolRecipient = vm.envOr("FINCH_PROTOCOL_RECIPIENT", deployer);
        address feeRecipient = vm.envOr("FINCH_FEE_RECIPIENT", deployer);
        address githubSigner = vm.envOr("FINCH_GITHUB_SIGNER", address(0));
        uint16 protocolBps = uint16(vm.envOr("FINCH_PROTOCOL_BPS", uint256(2000)));
        uint16 referralBps = uint16(vm.envOr("FINCH_REFERRAL_BPS", uint256(1000)));
        uint16 gradBonusBps = uint16(vm.envOr("FINCH_GRAD_BONUS_BPS", uint256(500)));
        uint256 gradFeeThreshold = vm.envOr("FINCH_GRAD_FEE_THRESHOLD", uint256(0.25 ether));

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast(deployer); // forge routes signing to the Ledger for this address

        FinchToken impl = new FinchToken();
        FinchFactory factory =
            new FinchFactory(address(impl), positionManager, weth, protocolBps, feeRecipient, admin, swapRouter);
        FinchLocker locker =
            new FinchLocker(address(factory), positionManager, weth, protocolRecipient, admin, referralBps, gradBonusBps, gradFeeThreshold);
        FeeRightsRegistry registry = new FeeRightsRegistry(address(locker), githubSigner, admin);
        FinchLock lockVault = new FinchLock();
        // Env read inlined: one more live local here tips via-IR into stack-too-deep.
        FeatureBoost featureBoost =
            new FeatureBoost(feeRecipient, admin, vm.envOr("FINCH_BOOST_PRICE_PER_HOUR", uint256(0.001 ether)));

        // One-shot wiring needs admin == deployer (setLocker/setRegistry are owner-gated).
        // Ongoing admin then hands off to the Safe below.
        require(admin == deployer, "set FINCH_ADMIN to the deployer for one-shot wiring, or wire manually");
        factory.setLocker(address(locker));
        locker.setRegistry(address(registry));

        // Hand ONGOING admin to the protocol Safe, if FINCH_SAFE is set. The two transferable
        // admin roles both move:
        //   - FeeRightsRegistry (Ownable): setTrustedSigner + approveCTO — 1-step, moves now.
        //   - FinchLocker (Ownable2Step): setProtocolFeeRecipient — the Safe must ACCEPT to
        //     finish (call locker.acceptOwnership() from the Safe afterward).
        // FinchFactory.admin is immutable but only does the one-time setLocker above, so it
        // stays as the deployer harmlessly.
        address safe = vm.envOr("FINCH_SAFE", address(0));
        if (safe != address(0)) {
            registry.transferOwnership(safe); // immediate
            locker.transferOwnership(safe); // pending until the Safe calls acceptOwnership()
        }

        vm.stopBroadcast();

        console.log("FinchToken impl:   ", address(impl));
        console.log("FinchFactory:      ", address(factory));
        console.log("FinchLocker:       ", address(locker));
        console.log("FeeRightsRegistry: ", address(registry));
        console.log("FinchLock:         ", address(lockVault));
        console.log("FeatureBoost:      ", address(featureBoost));
        if (safe != address(0)) {
            console.log("--- admin hand-off ---");
            console.log("registry owner -> Safe (done). locker owner -> Safe PENDING.");
            console.log("FINAL STEP: from the Safe, call FinchLocker.acceptOwnership():", address(locker));
        } else {
            console.log("--- WARNING: FINCH_SAFE unset - admin stayed on the deployer EOA ---");
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {FinchFactory} from "../src/FinchFactory.sol";
import {FinchToken} from "../src/FinchToken.sol";
import {ClaimKind} from "../src/interfaces/IFinchLockerControl.sol";

/**
 * Launch the FINCH protocol token through a live finchpad factory — from the deployer Ledger,
 * no frontend needed. Fee wallet points at the protocol Safe; an opening buy (atomic inside
 * launch()) seeds the initial market and lands the bought FINCH in the launcher's wallet.
 *
 * Curve A is fixed (~1 ETH implied start mcap), so the sqrt price + tick range are the same
 * precomputed constants every token uses; only the token/WETH ordering flips the side.
 *
 * Env:
 *   FINCH_FACTORY       deployed factory (from Deploy.s.sol output)
 *   FINCH_SAFE          fee wallet for FINCH — the protocol Safe
 *   FINCH_OPENING_BUY   opening buy in wei (default 0.04 ether)
 *   FINCH_NAME/SYMBOL   defaults "Finch" / "FINCH"
 *   PRIVATE_KEY or FINCH_DEPLOYER (+ --ledger) — the launcher
 */
contract LaunchFinch is Script {
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    // Curve A start price, precomputed (matches web/src/lib/launchCurve.ts CURVE_A).
    uint160 constant SQRT_A_TOKEN0 = 2505414483750479311864138;
    uint160 constant SQRT_A_TOKEN1 = 2505414483750479311864138015696063;

    function run() external {
        FinchFactory factory = FinchFactory(vm.envAddress("FINCH_FACTORY"));
        address safe = vm.envAddress("FINCH_SAFE");
        uint256 openingBuy = vm.envOr("FINCH_OPENING_BUY", uint256(0.04 ether));
        string memory name = vm.envOr("FINCH_NAME", string("Finch"));
        string memory symbol = vm.envOr("FINCH_SYMBOL", string("FINCH"));

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast(vm.envAddress("FINCH_DEPLOYER"));

        // Predict the clone address to pick the single-sided tick side.
        uint64 nonce = vm.getNonce(address(factory));
        address predicted = vm.computeCreateAddress(address(factory), nonce);
        bool isToken0 = predicted < WETH;
        (uint160 sqrtP, int24 lower, int24 upper) =
            isToken0 ? (SQRT_A_TOKEN0, int24(-207000), int24(887200)) : (SQRT_A_TOKEN1, int24(-887200), int24(207000));

        uint256 fee = factory.LAUNCH_FEE();
        (address token,,,) = factory.launch{value: fee + openingBuy}(
            FinchFactory.LaunchParams({
                name: name,
                symbol: symbol,
                logo: "",
                description: "The finchpad protocol token.",
                socials: FinchToken.Socials("@finchpad", "t.me/finchpad", "", "finchpad.xyz", ""),
                claimKind: ClaimKind.None,
                githubId: 0,
                initialSqrtPriceX96: sqrtP,
                tickLower: lower,
                tickUpper: upper,
                referrer: address(0),
                feeWallet: safe,
                creatorBuyAmount: openingBuy
            })
        );
        require(token == predicted, "FINCH address prediction drifted");
        vm.stopBroadcast();

        console.log("FINCH launched:   ", token);
        console.log("fee wallet (Safe):", safe);
        console.log("opening buy (wei):", openingBuy);
        console.log("NEXT (optional): from the Safe, handoff() FINCH control to the Safe too.");
    }
}

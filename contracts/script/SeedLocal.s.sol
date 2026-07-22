// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FinchToken} from "../src/FinchToken.sol";
import {FinchFactory} from "../src/FinchFactory.sol";
import {FinchLocker} from "../src/FinchLocker.sol";
import {FeeRightsRegistry} from "../src/FeeRightsRegistry.sol";
import {FinchLock} from "../src/FinchLock.sol";
import {FeatureBoost} from "../src/FeatureBoost.sol";
import {ClaimKind} from "../src/interfaces/IFinchLockerControl.sol";
import {ISwapRouter02, IWETH} from "../src/interfaces/IUniswapV3.sol";

/**
 * @notice Deploys finchpad onto a LOCAL ANVIL FORK of Robinhood Chain mainnet and seeds it
 *         with real launches and real trades.
 *
 * Robinhood's testnet has no Uniswap V3, so a mainnet fork is the only environment where the
 * launch flow actually works. This gives the frontend a real finchpad backend to build
 * against: launch a token, watch it hit a real pool, trade it, collect fees — locally, free,
 * with no mainnet risk.
 *
 * Run via `npm run dev:seed` (boots against http://localhost:8545).
 */
contract SeedLocal is Script {
    address constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    // Curve A (~1 ETH implied start mcap), per src/lib/launchCurve.js.
    uint160 constant SQRT_A_TOKEN0 = 2505414483750479311864138;
    uint160 constant SQRT_A_TOKEN1 = 2505414483750479311864138015696063;

    // Held as state, not locals: run() deploys six contracts and four tokens, and keeping
    // them all live on the stack through the closing console.log block overflows solc's
    // stack limit (even under via_ir). Scripts are not gas-sensitive, so storage is free here.
    FinchFactory factory;
    FinchLocker locker;
    FeeRightsRegistry registry;
    FinchLock lockVault;
    FeatureBoost featureBoost;

    /**
     * @dev No private key anywhere. The runner impersonates a clean address on anvil
     *      (`anvil_impersonateAccount` + `--unlocked`), so nothing secret lives in this repo.
     *
     *      This is not just tidiness: anvil's DEFAULT accounts cannot be used here. All five
     *      of them carry EIP-7702 delegations on Robinhood Chain mainnet pointing at a
     *      sweeper contract, so a mainnet fork inherits that state and any ETH paid to them
     *      is instantly swept. Those dev keys are public, so someone set this up deliberately.
     */
    function run() external {
        address me = msg.sender;

        vm.startBroadcast();

        FinchToken impl = new FinchToken();
        factory = new FinchFactory(address(impl), POSITION_MANAGER, WETH, 2000, me, me);
        // referral: 10% of the protocol share; graduation: 20%->15% once graduated.
        locker = new FinchLocker(address(factory), POSITION_MANAGER, WETH, me, me, 1000, 500, 0.25 ether);
        registry = new FeeRightsRegistry(address(locker), me, me);
        lockVault = new FinchLock();
        featureBoost = new FeatureBoost(me, me, 0.01 ether, 0.05 ether);
        factory.setLocker(address(locker));
        locker.setRegistry(address(registry));

        // Wrap ETH once so we can actually trade the launches.
        IWETH(WETH).deposit{value: 3 ether}();
        IWETH(WETH).approve(SWAP_ROUTER, type(uint256).max);

        address referrer = address(0xBEEF); // demo referrer wallet for one launch
        address a = _launch("Finch Genesis", "GENESIS", "the first one", ClaimKind.None, 0, address(0));
        address b = _launch("Doge Finch", "DFINCH", "much launch", ClaimKind.None, 0, referrer);
        address c = _launch("Repo Coin", "REPO", "launched for a github repo", ClaimKind.Repo, 123456789, address(0));
        address d = _launch("Dev Coin", "DEVC", "launched for a github user", ClaimKind.User, 987654321, address(0));

        _buy(a, 0.4 ether);
        _buy(b, 0.15 ether); // referred launch: collect() will pay 0xBEEF a slice of protocol fees
        _buy(c, 0.05 ether);
        _buy(d, 0.02 ether);
        _buy(a, 0.25 ether); // second trade so charts have more than one candle point

        // Advertising: feature GENESIS for 7 days and buy DFINCH a "boosted" badge.
        featureBoost.feature{value: 0.07 ether}(a, 7);
        featureBoost.boost{value: 0.05 ether}(b);

        vm.stopBroadcast();

        console.log("");
        console.log("=== finchpad seeded on local fork ===");
        console.log("FinchFactory:      ", address(factory));
        console.log("FinchLocker:       ", address(locker));
        console.log("FeeRightsRegistry: ", address(registry));
        console.log("FinchLock:         ", address(lockVault));
        console.log("FeatureBoost:      ", address(featureBoost));
        console.log("token GENESIS:     ", a, "(featured 7d)");
        console.log("token DFINCH:      ", b, "(referred by 0xBEEF, boosted badge)");
        console.log("token REPO:        ", c, "(repo id 123456789, fees escrow until claim)");
        console.log("token DEVC:        ", d, "(user id 987654321, fees escrow until claim)");
        console.log("");
        console.log("Point the API at it:");
        console.log("  FINCHPAD_RPC_URL=http://localhost:8545 npm run api -- --factory <FinchFactory>");

        // Machine-readable line for scripts/dev.mjs, which rewrites .env from it. Parsing
        // forge's broadcast JSON is not an option: it mislabels contract names when
        // transactions are batched (it reported buys as "FinchLock" and "approve").
        console.log(
            string.concat(
                "FINCHPAD_DEPLOY factory=",
                vm.toString(address(factory)),
                " locker=",
                vm.toString(address(locker)),
                " registry=",
                vm.toString(address(registry)),
                " lockVault=",
                vm.toString(address(lockVault)),
                " featureBoost=",
                vm.toString(address(featureBoost))
            )
        );
    }

    function _launch(
        string memory name,
        string memory symbol,
        string memory desc,
        ClaimKind kind,
        uint256 githubId,
        address referrer
    ) internal returns (address token) {
        // The clone lands at the factory's next CREATE nonce; ordering vs WETH decides the
        // single-sided side, so we must know the address before choosing tick params.
        uint64 nonce = vm.getNonce(address(factory));
        address predicted = vm.computeCreateAddress(address(factory), nonce);
        bool isToken0 = predicted < WETH;

        (uint160 sqrtP, int24 lower, int24 upper) = isToken0
            ? (SQRT_A_TOKEN0, int24(-207000), int24(887200))
            : (SQRT_A_TOKEN1, int24(-887200), int24(207000));

        (token,,) = factory.launch{value: 0.0005 ether}(
            FinchFactory.LaunchParams({
                name: name,
                symbol: symbol,
                logo: "",
                description: desc,
                socials: FinchToken.Socials("@finchpad", "t.me/finchpad", "", "finchpad.xyz", ""),
                claimKind: kind,
                githubId: githubId,
                initialSqrtPriceX96: sqrtP,
                tickLower: lower,
                tickUpper: upper,
                referrer: referrer
            })
        );
        require(token == predicted, "clone address prediction drifted");
    }

    function _buy(address token, uint256 amountIn) internal {
        ISwapRouter02(SWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: token,
                fee: 10000,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IUniswapV3Factory, IUniswapV3Pool} from "../src/interfaces/IUniswapV3.sol";

/// @notice Confirms Foundry can fork Robinhood Chain mainnet and read the real Uniswap V3
/// periphery, using the known PONS reference token/pool from the docs.
contract ForkSmokeTest is Test {
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant REF_TOKEN = 0x39dBED3a2bd333467115dE45665cC57F813C4571;
    address constant REF_POOL = 0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA;

    function test_fork_readsRealPool() public {
        // FORK_RPC_URL (CI secret) overrides the public rh_mainnet alias when set.
        vm.createSelectFork(vm.envOr("FORK_RPC_URL", string("rh_mainnet")));

        address pool = IUniswapV3Factory(V3_FACTORY).getPool(REF_TOKEN, WETH, 10000);
        assertEq(pool, REF_POOL, "v3 factory should return the known reference pool");

        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        assertGt(sqrtPriceX96, 0, "pool should have a live price");
        emit log_named_uint("reference pool sqrtPriceX96", sqrtPriceX96);
    }
}

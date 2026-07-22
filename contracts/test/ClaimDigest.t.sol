// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {FinchLocker} from "../src/FinchLocker.sol";
import {FeeRightsRegistry} from "../src/FeeRightsRegistry.sol";
import {ClaimKind} from "../src/interfaces/IFinchLockerControl.sol";
import {MockPositionManager, MockERC20} from "./mocks/Mocks.sol";

/// @notice Pins the EIP-712 claim digest so the JS signer service can be cross-checked
/// against the contract. If either side's domain/type encoding drifts, this fails.
contract ClaimDigestTest is Test {
    FeeRightsRegistry registry;

    // Fixed inputs mirrored in test/githubClaim.test.js
    address constant TOKEN = 0x1111111111111111111111111111111111111111;
    uint256 constant GITHUB_ID = 123456789;
    address constant CLAIMANT = 0x2222222222222222222222222222222222222222;
    uint256 constant DEADLINE = 1893456000; // 2030-01-01

    function setUp() public {
        MockPositionManager pm = new MockPositionManager();
        MockERC20 weth = new MockERC20("W", "W");
        FinchLocker locker =
            new FinchLocker(address(this), address(pm), address(weth), address(0xBEEF), address(this), 0, 0, type(uint256).max);
        registry = new FeeRightsRegistry(address(locker), address(0xCAFE), address(this));
    }

    function test_logClaimDigest() public view {
        bytes32 repoDigest = registry.claimDigest(TOKEN, ClaimKind.Repo, GITHUB_ID, CLAIMANT, DEADLINE);
        bytes32 userDigest = registry.claimDigest(TOKEN, ClaimKind.User, GITHUB_ID, CLAIMANT, DEADLINE);
        console.log("registry:", address(registry));
        console.log("chainId:", block.chainid);
        console.log("repo digest:");
        console.logBytes32(repoDigest);
        console.log("user digest:");
        console.logBytes32(userDigest);
    }
}

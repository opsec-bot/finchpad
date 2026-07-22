// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {INonfungiblePositionManager} from "../../src/interfaces/IUniswapV3.sol";

contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// @notice ERC20 that burns a fixed bps on every transfer, to test received-amount accounting.
contract FeeOnTransferERC20 is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 feeBps_) ERC20("FeeToken", "FEE") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @notice Minimal position manager stub: `collect` pays out preconfigured amounts of
/// token0/token1 from its own balance to the recipient and returns them.
contract MockPositionManager is INonfungiblePositionManager {
    address public token0;
    address public token1;
    uint256 public amount0;
    uint256 public amount1;

    function setCollectReturns(address t0, address t1, uint256 a0, uint256 a1) external {
        token0 = t0;
        token1 = t1;
        amount0 = a0;
        amount1 = a1;
    }

    function collect(CollectParams calldata params) external payable returns (uint256, uint256) {
        if (amount0 > 0) MockERC20(token0).transfer(params.recipient, amount0);
        if (amount1 > 0) MockERC20(token1).transfer(params.recipient, amount1);
        return (amount0, amount1);
    }

    function createAndInitializePoolIfNecessary(address, address, uint24, uint160)
        external
        payable
        returns (address)
    {
        return address(0);
    }

    function mint(MintParams calldata) external payable returns (uint256, uint128, uint256, uint256) {
        return (1, 0, 0, 0);
    }

    function ownerOf(uint256) external pure returns (address) {
        return address(0);
    }
}


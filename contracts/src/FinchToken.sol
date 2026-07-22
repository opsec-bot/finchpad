// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title FinchToken
 * @notice Fixed-supply (1e9) launch token for finchpad. Self-describing on-chain,
 *         holder-burnable (pump.fun style), with pons-style anti-snipe launch protection.
 *
 * Clone-compatible: deployed as an EIP-1167 minimal proxy and configured via initialize().
 * OpenZeppelin's ERC20 sets name/symbol in its constructor, which a clone never runs, so
 * name()/symbol() are overridden to read initialize()-set storage instead.
 */
contract FinchToken is ERC20, ERC20Burnable, Initializable {
    uint256 public constant SUPPLY = 1_000_000_000e18;

    // --- self-describing metadata ---
    string private _tokenName;
    string private _tokenSymbol;
    string public logo;
    string public description;
    address public liquidityPool;
    address public creator;
    address public factory;

    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    Socials public socials;

    /// @notice Block the token launched in. Informational only — kept because indexers and
    ///         the UI use it as the token's birth block; it gates nothing.
    uint256 public launchBlock;

    error NotFactory();
    error PoolAlreadySet();
    error ZeroAddress();

    /// @dev The implementation contract must never be initializable directly.
    constructor() ERC20("", "") {
        _disableInitializers();
    }

    /**
     * @param name_ token name
     * @param symbol_ token symbol
     * @param logo_ image URI
     * @param description_ freeform description
     * @param socials_ social links
     * @param creator_ launch creator
     * @param initialHolder_ receives the full mint (the factory/locker seeds liquidity + initial buy)
     */
    function initialize(
        string calldata name_,
        string calldata symbol_,
        string calldata logo_,
        string calldata description_,
        Socials calldata socials_,
        address creator_,
        address initialHolder_
    ) external initializer {
        _tokenName = name_;
        _tokenSymbol = symbol_;
        logo = logo_;
        description = description_;
        socials = socials_;
        creator = creator_;
        factory = msg.sender;

        launchBlock = block.number;

        _mint(initialHolder_, SUPPLY);
    }

    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    /// @notice The factory sets the pool once, after it creates the Uniswap V3 pool.
    function setLiquidityPool(address pool) external {
        if (msg.sender != factory) revert NotFactory();
        if (liquidityPool != address(0)) revert PoolAlreadySet();
        // The pool address is what indexers and the UI resolve trades against; a zero here
        // would produce a token that looks launched but has no discoverable market.
        if (pool == address(0)) revert ZeroAddress();
        liquidityPool = pool;
    }
}

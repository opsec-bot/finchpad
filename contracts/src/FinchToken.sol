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

    // --- launch protection ---
    uint256 public launchBlock;
    uint256 public restrictionsEndBlock;
    uint256 public maxWalletAmount; // 5% of supply
    uint256 public maxBuyAmount; // 5.5% of supply

    error NotFactory();
    error PoolAlreadySet();
    error ZeroAddress();
    error LaunchBlockCreatorOnly();
    error MaxWalletExceeded();
    error MaxBuyExceeded();

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
     * @param creator_ launch creator (only buyer allowed on the launch block)
     * @param initialHolder_ receives the full mint (the factory/locker seeds liquidity + initial buy)
     * @param restrictionBlocks_ how many blocks after launch the anti-snipe limits apply
     */
    function initialize(
        string calldata name_,
        string calldata symbol_,
        string calldata logo_,
        string calldata description_,
        Socials calldata socials_,
        address creator_,
        address initialHolder_,
        uint256 restrictionBlocks_
    ) external initializer {
        _tokenName = name_;
        _tokenSymbol = symbol_;
        logo = logo_;
        description = description_;
        socials = socials_;
        creator = creator_;
        factory = msg.sender;

        launchBlock = block.number;
        restrictionsEndBlock = block.number + restrictionBlocks_;
        maxWalletAmount = (SUPPLY * 5) / 100;
        maxBuyAmount = (SUPPLY * 55) / 1000;

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
        // A zero pool would leave `liquidityPool == address(0)`, which the _update hook
        // treats as "protection inactive" — silently disabling the whole anti-snipe window.
        if (pool == address(0)) revert ZeroAddress();
        liquidityPool = pool;
    }

    /**
     * @dev Anti-snipe launch protection. Restrictions apply ONLY to buys (tokens leaving
     * the pool). Mints, burns (to address(0)), sells (to the pool), and wallet-to-wallet
     * transfers are never restricted, matching pons behavior.
     */
    function _update(address from, address to, uint256 value) internal override {
        bool active = block.number <= restrictionsEndBlock && liquidityPool != address(0);
        bool isBuy = from == liquidityPool;

        if (active && isBuy && to != factory) {
            // slither-disable-next-line incorrect-equality
            if (block.number == launchBlock) {
                // Launch block: only the creator's initial buy can execute.
                if (to != creator) revert LaunchBlockCreatorOnly();
            } else {
                if (value > maxBuyAmount) revert MaxBuyExceeded();
                if (balanceOf(to) + value > maxWalletAmount) revert MaxWalletExceeded();
            }
        }

        super._update(from, to, value);
    }
}

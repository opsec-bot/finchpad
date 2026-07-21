// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @notice The fee-rights surface the FeeRightsRegistry drives on the locker.
 *
 * Declared as a shared interface (rather than duplicated inside the registry) so the
 * compiler enforces that FinchLocker actually implements what the registry calls. A
 * signature drift between the two would otherwise only surface at runtime, on the exact
 * path that moves who gets paid.
 */
interface IFinchLockerControl {
    function setControl(address token, address controller, address feeWallet) external;
    function controllerOf(address token) external view returns (address);
    function feeWalletOf(address token) external view returns (address);
    function repoIdOf(address token) external view returns (uint256);
}

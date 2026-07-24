# Verify the finchpad contracts on Robinhood Chain's Blockscout (Foundry method).
# Run FROM the contracts/ directory:  .\verify-mainnet.ps1
#
# forge reads the compiler settings from foundry.toml automatically (solc 0.8.30, optimizer
# 300 runs, via-ir, evm cancun) — they must match the on-chain bytecode, and they do.
# Blockscout verification does not require an API key. If an instance ever demands one, add:
#   --etherscan-api-key $env:BLOCKSCOUT_PRO_API_KEY

$ErrorActionPreference = "Stop"
$VerifierUrl = "https://robinhoodchain.blockscout.com/api/"

# foundry.toml's [etherscan] entry for chain 4663 references ${BLOCKSCOUT_PRO_API_KEY}, so forge
# requires the var to be set even though Blockscout verification accepts any value.
if (-not $env:BLOCKSCOUT_PRO_API_KEY) { $env:BLOCKSCOUT_PRO_API_KEY = "placeholder" }

# Blockscout occasionally returns a transient "Failed to obtain contract ABI" when several
# verifications land in quick succession; re-run this script and any stragglers go through.

function Verify-Contract {
    param([string]$Address, [string]$Name, [string]$CtorArgs)
    Write-Host "`n=== Verifying $Name  ($Address) ===" -ForegroundColor Cyan
    $cargs = @(
        "verify-contract", $Address, $Name,
        "--chain", "4663",
        "--verifier", "blockscout",
        "--verifier-url", $VerifierUrl,
        "--watch"
    )
    if ($CtorArgs) { $cargs += @("--constructor-args", $CtorArgs) }
    & forge @cargs
}

# No constructor args:
Verify-Contract "0x58433Fe8C7cE793Baa6424d34B6ec4022762380B" "src/FinchToken.sol:FinchToken" ""
Verify-Contract "0x4Be5E41fB8F00E7b951097b0d45639018d867178" "src/FinchLock.sol:FinchLock" ""

# With constructor args (ABI-encoded, matching the mainnet deploy):
Verify-Contract "0x499A91F0FD04843f11700067D973D6117d224931" "src/FinchFactory.sol:FinchFactory" `
  "0x00000000000000000000000058433fe8c7ce793baa6424d34b6ec4022762380b00000000000000000000000073991a25c818bf1f1128deaab1492d45638de0d30000000000000000000000000bd7d308f8e1639fab988df18a8011f41eacad7300000000000000000000000000000000000000000000000000000000000007d00000000000000000000000002df0041d26dd201f2a249d553720ab65cc98b4620000000000000000000000002df0041d26dd201f2a249d553720ab65cc98b462000000000000000000000000caf681a66d020601342297493863e78c959e5cb2"

Verify-Contract "0x9650049064fb049eb40707FA94751C5BaC0043A9" "src/FinchLocker.sol:FinchLocker" `
  "0x000000000000000000000000499a91f0fd04843f11700067d973d6117d22493100000000000000000000000073991a25c818bf1f1128deaab1492d45638de0d30000000000000000000000000bd7d308f8e1639fab988df18a8011f41eacad730000000000000000000000002df0041d26dd201f2a249d553720ab65cc98b4620000000000000000000000002df0041d26dd201f2a249d553720ab65cc98b46200000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000003782dace9d90000"

Verify-Contract "0xcD0993812aa63da0FaA44cCA87a78AD8f8F223A6" "src/FeeRightsRegistry.sol:FeeRightsRegistry" `
  "0x0000000000000000000000009650049064fb049eb40707fa94751c5bac0043a900000000000000000000000000000000000000000000000000000000000000000000000000000000000000002df0041d26dd201f2a249d553720ab65cc98b462"

Verify-Contract "0x1f528017dbD7D92C50c374e0BA087a3643BdcBea" "src/FeatureBoost.sol:FeatureBoost" `
  "0x0000000000000000000000002df0041d26dd201f2a249d553720ab65cc98b4620000000000000000000000002df0041d26dd201f2a249d553720ab65cc98b46200000000000000000000000000000000000000000000000000038d7ea4c68000"

Write-Host "`nAll six contracts submitted for verification." -ForegroundColor Green

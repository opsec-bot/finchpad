#!/usr/bin/env node
// Give an address ETH on the local anvil fork, so a browser wallet can actually transact.
//
// A wallet you connect in the UI (Privy embedded or MetaMask) starts with zero balance on
// the fork and cannot pay the launch fee or gas. This tops it up.
//
// Usage: npm run dev:fund -- 0xYourWalletAddress [amountEth]

const RPC = process.env.FORK_RPC || "http://localhost:8545";
const [addr, amountArg] = process.argv.slice(2);
const amountEth = Number(amountArg ?? 100);

if (!/^0x[a-fA-F0-9]{40}$/.test(addr ?? "")) {
  console.error("Usage: npm run dev:fund -- 0xYourWalletAddress [amountEth]");
  console.error("Copy the address from the wallet chip in the finchpad header.");
  process.exit(1);
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

try {
  await rpc("eth_chainId");
} catch {
  console.error(`anvil not reachable on ${RPC} — start \`npm run dev:fork\` first`);
  process.exit(1);
}

const wei = BigInt(Math.round(amountEth * 1e6)) * 10n ** 12n;
await rpc("anvil_setBalance", [addr, `0x${wei.toString(16)}`]);
const balance = BigInt(await rpc("eth_getBalance", [addr, "latest"]));
console.log(`funded ${addr} -> ${balance / 10n ** 18n} ETH on the fork`);

// Pin the frontend's hand-written ABIs against the compiled contracts.
//
// A struct field in the wrong order changes the function selector, so the call matches no
// function and reverts with EMPTY data — no reason string, no custom error, no failing
// sub-call in a trace. That is close to undebuggable from the UI, and it shipped once:
// `referrer` was written after `githubId` instead of last in LaunchParams, and every launch
// from the browser reverted.
//
// Requires the Foundry artifacts (`forge build` in contracts/). Skips loudly without them.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseAbiItem, toFunctionSelector } from "viem";

const OUT = "contracts/out";
const FRONTEND_ABIS = "web/src/lib/abis.ts";

// frontend export name -> compiled artifact
const PAIRS = {
  finchFactoryAbi: "FinchFactory.sol/FinchFactory.json",
  finchLockerAbi: "FinchLocker.sol/FinchLocker.json",
  feeRightsRegistryAbi: "FeeRightsRegistry.sol/FeeRightsRegistry.json",
};

/** Pull the string literals out of `export const <name> = parseAbi([ ... ])`. */
function extractSignatures(source, exportName) {
  const start = source.indexOf(`export const ${exportName} = parseAbi([`);
  if (start === -1) throw new Error(`${exportName} not found in ${FRONTEND_ABIS}`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("]);", open);
  const block = source.slice(open, close);
  return [...block.matchAll(/"((?:function|event)[^"]+)"/g)].map((m) => m[1]);
}

function artifactSelectors(file) {
  const abi = JSON.parse(readFileSync(`${OUT}/${file}`, "utf8")).abi;
  const map = new Map();
  for (const item of abi) {
    if (item.type !== "function") continue;
    map.set(toFunctionSelector(item), item.name);
  }
  return map;
}

describe("frontend ABIs match the compiled contracts", () => {
  const haveArtifacts = existsSync(OUT) && existsSync(`${OUT}/${PAIRS.finchFactoryAbi}`);

  for (const [exportName, artifact] of Object.entries(PAIRS)) {
    test(`${exportName} selectors exist in ${artifact.split("/")[1]}`, { skip: !haveArtifacts && "run `forge build` in contracts/ first" }, () => {
      const source = readFileSync(FRONTEND_ABIS, "utf8");
      const onChain = artifactSelectors(artifact);

      for (const sig of extractSignatures(source, exportName)) {
        if (sig.startsWith("event")) continue; // events are matched by topic, covered elsewhere
        const item = parseAbiItem(sig);
        const selector = toFunctionSelector(item);
        assert.ok(
          onChain.has(selector),
          `${exportName}: "${item.name}" has selector ${selector}, which the contract does not expose.\n` +
            `  The signature drifted from the contract — most likely a struct field is in the wrong order.\n` +
            `  Full signature: ${sig}`,
        );
      }
    });
  }

  test("launch() specifically — the one that broke", { skip: !haveArtifacts && "run `forge build` in contracts/ first" }, () => {
    const source = readFileSync(FRONTEND_ABIS, "utf8");
    const sig = extractSignatures(source, "finchFactoryAbi").find((s) => s.includes("function launch("));
    assert.ok(sig, "launch() missing from the frontend ABI");
    const selector = toFunctionSelector(parseAbiItem(sig));
    assert.equal(
      artifactSelectors(PAIRS.finchFactoryAbi).get(selector),
      "launch",
      `launch() selector ${selector} does not match the deployed factory`,
    );
  });
});

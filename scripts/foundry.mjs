// Shared helpers for the dev scripts. Deliberately side-effect free: dev-seed imports from
// here, and importing a module that spawns anvil would start a second one.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Resolve a foundry binary, preferring ~/.foundry/bin over whatever is on PATH. */
export function foundryBin(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const local = join(homedir(), ".foundry", "bin", exe);
  return existsSync(local) ? local : name; // else fall back to PATH
}

/** Load the repo-root .env if present. Absent is fine — callers have defaults. */
export function loadEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* no .env */
  }
}

/** Report a missing-binary spawn error usefully, else rethrow-ish. */
export function onSpawnError(bin) {
  return (err) => {
    if (err.code === "ENOENT") {
      console.error(`\n${bin} not found (looked for "${foundryBin(bin)}").`);
      console.error("Install Foundry: https://getfoundry.sh  then run  foundryup");
    } else {
      console.error(err);
    }
    process.exit(1);
  };
}

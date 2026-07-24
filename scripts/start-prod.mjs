// Production entrypoint: run the indexer daemon and the API in one container, sharing the
// sqlite DB on the mounted volume. sqlite can't be shared across machines, so both processes
// MUST live on the same machine (fly.toml keeps it to a single always-on VM).
//
// No --env-file here: on Fly, config arrives as real environment variables (fly.toml [env]
// for public values, `fly secrets` for the GitHub OAuth secret), so process.env is already set.
import { spawn } from "node:child_process";

const services = [
  { name: "indexer", args: ["src/indexer/daemon.js"] },
  { name: "api", args: ["src/backend/api.js"] },
];

const children = [];
let shuttingDown = false;

function shutdown(signal, code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill(signal || "SIGTERM");
  }
  // Give children a moment to exit cleanly, then hard-exit.
  setTimeout(() => process.exit(code ?? 0), 3000).unref();
}

for (const svc of services) {
  const child = spawn(process.execPath, svc.args, { stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    console.error(`[start-prod] ${svc.name} exited (code=${code} signal=${signal}) — stopping container`);
    // If either process dies, bring the whole container down so Fly restarts it fresh.
    shutdown("SIGTERM", code === 0 ? 1 : (code ?? 1));
  });
  children.push(child);
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => shutdown(sig, 0));
}

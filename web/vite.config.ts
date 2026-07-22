import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The API (src/backend/api.js) serves the built assets from web/dist, so dev points API
// calls at the running API on :8787 and production is same-origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // One env file for the whole repo: the root .env, same one the API and Foundry scripts read.
  // Vite only ever inlines VITE_-prefixed vars into the browser bundle, so the secrets that
  // live alongside them (GITHUB_CLIENT_SECRET, ALCHEMY_*, PRIVATE_KEY) are never exposed.
  // The corollary is the rule to remember: anything you name VITE_* is PUBLIC.
  envDir: "..",
  build: { outDir: "dist", sourcemap: true },
  server: {
    port: 5173,
    proxy: {
      "/tokens": "http://localhost:8787",
      "/featured": "http://localhost:8787",
      "/health": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/github": "http://localhost:8787",
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API (src/backend/api.js) serves the built assets from web/dist and proxies nothing,
// so dev points API calls at the running API on :8787 and prod is same-origin.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: true },
  server: {
    port: 5173,
    proxy: {
      "/tokens": "http://localhost:8787",
      "/featured": "http://localhost:8787",
      "/health": "http://localhost:8787",
      "/auth": "http://localhost:8787",
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// map/data/ is the contract folder; serve it as static root so the agent can write it directly.
export default defineConfig({
  plugins: [react()],
  publicDir: "data",
  // pre-bundling moves maplibre away from its worker file (dist/maplibre-gl-worker.mjs)
  optimizeDeps: { exclude: ["maplibre-gl"] },
  server: {
    proxy: {
      "/api": {
        target: process.env.AGENT_URL ?? "http://localhost:8787",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});

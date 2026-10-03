import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5178,
    // The methodology and API pages import their Markdown from docs/ at the repository root.
    fs: { allow: [repoRoot] },
    proxy: { "/api": "http://127.0.0.1:8740" },
  },
  build: { outDir: "dist", sourcemap: true },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("apps/frontend"),
  plugins: [react(), tailwind()],
  build: { outDir: resolve("dist-ui"), emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:3000" } },
});

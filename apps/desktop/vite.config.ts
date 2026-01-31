import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, "../..");
const sharedSrc = path.resolve(repoRoot, "packages/shared/src");

export default defineConfig({
  clearScreen: false,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(rootDir, ".."), repoRoot, sharedSrc]
    }
  },
  resolve: {
    alias: {
      "@codelegate/shared": sharedSrc,
      "@codelegate/shared/icons": path.resolve(sharedSrc, "icons/index.ts")
    }
  },
  build: {
    target: "es2022",
    outDir: "dist"
  }
});

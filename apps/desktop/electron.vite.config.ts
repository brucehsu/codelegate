import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, "../..");
const sharedSrc = path.resolve(repoRoot, "packages/shared/src");

// Everything the app needs at runtime lives in devDependencies, so
// externalizeDepsPlugin() externalizes nothing but Node/Electron builtins and
// electron-builder ships no node_modules. The only real external is the
// prebuilt .node addon, which is asarUnpacked and loaded via createRequire.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      target: "node22",
      rollupOptions: {
        input: path.resolve(rootDir, "electron/main/index.ts"),
        external: [/\.node$/],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      target: "node22",
      rollupOptions: {
        input: path.resolve(rootDir, "electron/preload/index.ts"),
        // sandbox: true preloads must be CommonJS.
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
  },
  renderer: {
    root: ".",
    clearScreen: false,
    plugins: [react()],
    resolve: {
      alias: {
        "@codelegate/shared/icons": path.resolve(sharedSrc, "icons/index.ts"),
        "@codelegate/shared": sharedSrc,
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      fs: {
        allow: [path.resolve(rootDir, ".."), repoRoot, sharedSrc],
      },
    },
    build: {
      target: "es2022",
      outDir: "out/renderer",
      rollupOptions: {
        input: path.resolve(rootDir, "index.html"),
      },
    },
  },
});

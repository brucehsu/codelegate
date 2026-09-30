import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const sharedSrc = path.resolve(rootDir, "../../packages/shared/src");

// Node environment on purpose: main-process suites must not import electron,
// and the renderer units under test (terminal retention, git diff helpers) are
// pure functions.
export default defineConfig({
  resolve: {
    alias: {
      "@codelegate/shared/icons": path.resolve(sharedSrc, "icons/index.ts"),
      "@codelegate/shared": sharedSrc,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "electron/**/*.test.ts"],
  },
});

/**
 * Loader for the `codelegate-native` N-API addon (PTY + git).
 *
 * The addon is a prebuilt `.node` per platform/arch, shipped under `native/`
 * and `asarUnpack`ed by electron-builder, so it is loaded by absolute path
 * through `createRequire` rather than by bare specifier: there is no
 * `node_modules` entry for it in a packaged app, and bundlers must not try to
 * resolve it (`external: [/\.node$/]` in `electron.vite.config.ts`).
 *
 * Types come from the checked-in `native/index.d.ts`, so main typechecks
 * without the crate being built.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "electron";

export type NativeAddon = typeof import("../../native/index");

// Deliberately not named `require`: electron-vite appends its own
// `const require = createRequire(...)` CommonJS shim to any ESM chunk whose
// source contains `require(`, and a second top-level binding would be a
// SyntaxError.
const requireAddon = createRequire(import.meta.url);

let cached: NativeAddon | null = null;

/** `napi build --platform` names the artifact after the target triple. */
export function nativeBinaryName(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  if (platform === "darwin" && arch === "arm64") return "codelegate-native.darwin-arm64.node";
  if (platform === "darwin" && arch === "x64") return "codelegate-native.darwin-x64.node";
  if (platform === "linux" && arch === "x64") return "codelegate-native.linux-x64-gnu.node";
  throw new Error(`Unsupported platform for codelegate-native: ${platform}-${arch}`);
}

export function nativeDirectory(): string {
  if (app.isPackaged) {
    return path.join(app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"), "native");
  }
  // out/main/index.js -> apps/desktop/native
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../native");
}

export function nativeBinaryPath(): string {
  return path.join(nativeDirectory(), nativeBinaryName());
}

export function loadNative(): NativeAddon {
  if (cached) return cached;
  const binary = nativeBinaryPath();
  try {
    cached = requireAddon(binary) as NativeAddon;
  } catch (error) {
    throw new Error(
      `Failed to load the codelegate-native addon at ${binary}. ` +
        `Build it with \`pnpm --filter @codelegate/desktop native:build\`. ` +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return cached;
}

/** The already-loaded addon, or null. Used on the exit path, which must not load anything. */
export function loadedNative(): NativeAddon | null {
  return cached;
}

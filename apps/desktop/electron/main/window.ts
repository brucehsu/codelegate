/**
 * The single application window.
 *
 * Notes on the less obvious options:
 *  - `backgroundColor` is the `--bg` token from `src/styles/tokens.css`, so the
 *    frame that appears before the first paint is the app canvas rather than a
 *    white flash.
 *  - `show: false` plus `ready-to-show` avoids showing an empty window at all.
 *  - `backgroundThrottling: false` is load bearing, not a nicety: the xterm
 *    write queue and the PTY ack flush both run on renderer timers, and a
 *    throttled background window would stall the 256 KiB credit window in the
 *    addon until the user came back to it.
 *  - `page-title-updated` is prevented so the renderer cannot rename the window.
 *  - navigation is pinned to the renderer origin. The preload runs in whatever
 *    document this `webContents` ends up showing, so a stray top-level
 *    navigation (a dropped file, a `window.location` assignment, a redirect)
 *    would hand `window.codelegate` - `spawnPty` included - to foreign content.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, type Event, app } from "electron";

import { APP_INDEX_URL } from "./protocol";

/** `--bg` in `src/styles/tokens.css`. */
export const APP_BACKGROUND_COLOR = "#080c14";

export const WINDOW_TITLE = "Codelegate";

export interface CreateWindowOptions {
  /** Smoke runs keep the window hidden. */
  autoShow?: boolean;
}

export function preloadPath(): string {
  // out/main/index.js -> out/preload/index.cjs (electron-vite emits CJS there;
  // a sandboxed preload cannot be ESM).
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../preload/index.cjs");
}

/**
 * The app version the renderer displays.
 *
 * `app.getVersion()` is only right in a packaged build. Unpackaged runs
 * (electron-vite dev, `pnpm smoke`) launch Electron with the entry FILE rather
 * than the project directory, so Electron never finds `package.json` and hands
 * back its own version instead. Fall back to reading the version out of
 * `apps/desktop/package.json`, two levels up from `out/main`.
 */
export function resolveAppVersion(): string {
  const reported = app.getVersion();
  if (app.isPackaged || reported !== process.versions.electron) return reported;
  try {
    const packageFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const parsed = JSON.parse(readFileSync(packageFile, "utf8")) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
  } catch {
    // Fall through to whatever Electron reported.
  }
  return reported;
}

/**
 * The PNG electron-builder uses as the application icon.
 *
 * Only needed when unpackaged: a packaged build takes its icon from the bundle
 * itself. Unpackaged runs launch Electron with the entry FILE, so the process
 * carries Electron's own icon and name unless they are set explicitly.
 */
export function appIconPath(): string {
  // out/main/index.js -> apps/desktop/build/icon.png
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../build/icon.png");
}

/**
 * Dev server when electron-vite provides one, the packaged bundle otherwise.
 *
 * `ELECTRON_RENDERER_URL` is only honored in an unpackaged run. It is the
 * trusted origin `isRendererUrl` compares against, so honoring it in a packaged
 * build would let a tampered environment point the window at a remote page and
 * get the preload - `window.codelegate`, `spawnPty` included - attached to it.
 * A packaged build always loads its own bundle.
 */
export function rendererEntryUrl(): string {
  if (!app.isPackaged) {
    const fromEnv = process.env.ELECTRON_RENDERER_URL;
    if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  }
  return APP_INDEX_URL;
}

/**
 * Whether `target` (a URL or a serialized origin) belongs to the renderer
 * itself: the `app://codelegate` bundle in production, the electron-vite dev
 * server in dev. `origin` is useless here (both `app:` and `file:` are
 * non-special schemes to Node's URL parser and serialize to "null"), hence the
 * protocol/host comparison.
 */
export function isRendererUrl(target: string): boolean {
  try {
    const entry = new URL(rendererEntryUrl());
    const parsed = new URL(target);
    return parsed.protocol === entry.protocol && parsed.host === entry.host;
  } catch {
    return false;
  }
}

export function createMainWindow(options: CreateWindowOptions = {}): BrowserWindow {
  const autoShow = options.autoShow ?? true;

  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 640,
    minHeight: 400,
    title: WINDOW_TITLE,
    show: false,
    backgroundColor: APP_BACKGROUND_COLOR,
    autoHideMenuBar: process.platform !== "darwin",
    // Linux has no dock API; the window icon is the only way to give an
    // unpackaged dev run the real app icon.
    ...(!app.isPackaged && process.platform === "linux" ? { icon: appIconPath() } : {}),
    webPreferences: {
      preload: preloadPath(),
      // The preload reads the app version off the renderer command line rather
      // than paying for a synchronous IPC round trip at init.
      additionalArguments: [`--codelegate-app-version=${resolveAppVersion()}`],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      v8CacheOptions: "bypassHeatCheck",
    },
  });

  window.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  // The app never opens secondary windows; links go through `openExternal`.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // The renderer is a single document that never navigates away from its own
  // origin, so anything else is either a bug or an attack.
  const blockForeignNavigation = (event: Event, target: string): void => {
    if (isRendererUrl(target)) return;
    event.preventDefault();
    console.warn(`[window] blocked navigation to ${target}`);
  };

  window.webContents.on("will-navigate", (details) => {
    blockForeignNavigation(details, details.url);
  });
  window.webContents.on("will-frame-navigate", (details) => {
    blockForeignNavigation(details, details.url);
  });

  if (autoShow) {
    window.once("ready-to-show", () => {
      window.show();
    });
  }

  const url = rendererEntryUrl();
  window.loadURL(url).catch((error: unknown) => {
    console.error(`[window] failed to load ${url}`, error);
  });

  return window;
}

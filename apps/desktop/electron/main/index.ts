/**
 * Main process entry point.
 *
 * Order matters at the top of this file: the compile cache has to be enabled
 * before much of anything is required, and a privileged scheme has to be
 * registered before `app` is ready, so both happen at module scope rather than
 * inside `bootstrap()`.
 *
 * `--smoke` runs the whole startup path headlessly (protocol, preload, addon,
 * a real PTY round trip), prints one JSON line and exits. CI uses it as the
 * cheap end-to-end check that a packaged build actually works.
 */
import os from "node:os";
import * as nodeModule from "node:module";

import { MessageChannelMain, app, session } from "electron";
import type { BrowserWindow } from "electron";

import { registerIpc } from "./ipc/register";
import { PtyHub, attachPtyPort } from "./ipc/pty";
import { getDefaultShell } from "./ipc/system";
import { forceExit, registerLifecycle } from "./lifecycle";
import { applyApplicationMenu } from "./menu";
import { loadNative } from "./native";
import type { NativeAddon } from "./native";
import { registerAppProtocol, registerAppScheme } from "./protocol";
import { appIconPath, createMainWindow, isRendererUrl, rendererEntryUrl, resolveAppVersion } from "./window";

/** Node 22.1+; a no-op on anything older. */
(nodeModule as unknown as { enableCompileCache?: () => unknown }).enableCompileCache?.();

const SMOKE = process.argv.includes("--smoke");
const SMOKE_LOAD_TIMEOUT_MS = 20_000;
const SMOKE_PTY_TIMEOUT_MS = 10_000;

registerAppScheme();

// Unpackaged runs (electron-vite dev, `pnpm smoke`) launch Electron with the
// entry FILE, so it never picks up this package's name and macOS labels the
// Dock tile and the menu bar "Electron". Packaged builds get the name from
// electron-builder, so only fix it up in dev. This also moves the dev userData
// directory to "Codelegate"; nothing in the app stores anything there.
if (!app.isPackaged) {
  app.setName("Codelegate");
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  restrictRendererPermissions();
  registerAppProtocol();
  applyApplicationMenu();
  applyDevDockIcon();

  const native = loadNative();
  const hub = new PtyHub(native);
  registerIpc({ native, hub, exitApp: forceExit });

  const window = createMainWindow({ autoShow: !SMOKE });
  attachPtyPort(window, hub, () => new MessageChannelMain());
  registerLifecycle(window);

  if (SMOKE) {
    await runSmoke(window, native);
  }
}

/**
 * Give an unpackaged macOS run the real app icon instead of Electron's. The
 * dock API only exists on macOS; Linux gets the icon through the window
 * options in `createMainWindow`, and a packaged build already has its own.
 */
function applyDevDockIcon(): void {
  if (app.isPackaged || process.platform !== "darwin") return;
  try {
    app.dock?.setIcon(appIconPath());
  } catch (error) {
    console.warn(`[main] failed to set the dock icon: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The renderer only ever shows local application content, and nothing in the
 * app asks for camera, microphone, geolocation, MIDI or any of the other
 * powerful web permissions. The one exception is the clipboard: copying from
 * the terminal (Cmd+C and OSC 52) and the copy buttons in the UI all go through
 * `navigator.clipboard`, which Chromium gates behind `clipboard-sanitized-write`
 * and `clipboard-read`. Grant exactly those two, and only to the app's own
 * renderer origin; deny everything else, both for requests and for the
 * synchronous checks, so a compromised renderer cannot obtain one silently.
 *
 * Desktop notifications are unaffected: they are raised from the main process
 * with Electron's `Notification` class (see `ipc/notification.ts`), which does
 * not go through the renderer permission system at all.
 */
const ALLOWED_RENDERER_PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write"]);

function restrictRendererPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(ALLOWED_RENDERER_PERMISSIONS.has(permission) && isRendererUrl(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return ALLOWED_RENDERER_PERMISSIONS.has(permission) && isRendererUrl(requestingOrigin);
  });
}

function waitForLoad(window: BrowserWindow): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const contents = window.webContents;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Renderer did not finish loading within ${SMOKE_LOAD_TIMEOUT_MS} ms`));
    }, SMOKE_LOAD_TIMEOUT_MS);

    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onFail = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) return;
      cleanup();
      reject(new Error(`Renderer failed to load ${validatedUrl}: ${errorDescription} (${errorCode})`));
    };
    function cleanup() {
      clearTimeout(timer);
      contents.off("did-finish-load", onFinish);
      contents.off("did-fail-load", onFail);
    }

    contents.on("did-finish-load", onFinish);
    contents.on("did-fail-load", onFail);
  });
}

function runSmokePty(native: NativeAddon, shell: string): Promise<{ sessionId: number; output: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let sessionId = 0;

    const timer = setTimeout(() => {
      reject(new Error(`PTY did not exit within ${SMOKE_PTY_TIMEOUT_MS} ms`));
    }, SMOKE_PTY_TIMEOUT_MS);

    try {
      sessionId = native.spawnPty(
        {
          shell,
          args: ["-c", "printf ok"],
          cwd: os.homedir(),
          env: {},
          cols: 80,
          rows: 24,
        },
        (chunk) => {
          chunks.push(Buffer.from(chunk.data));
          // No renderer is attached in smoke mode, so ack for it: otherwise the
          // credit window would never reopen.
          native.ackPtyOutput(chunk.sessionId, chunk.endOffset);
        },
        () => {
          clearTimeout(timer);
          resolve({ sessionId, output: Buffer.concat(chunks).toString("utf8") });
        },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Renderer complaints worth failing on. A CSP violation never surfaces as a
 * failed load (the page renders, the blocked asset just never arrives), so the
 * console is the only place it shows up.
 */
function isCspViolation(message: string): boolean {
  // Chromium is not consistent about the casing: blocked subresources say
  // "Content Security Policy", while a blocked `WebAssembly.instantiate` says
  // "Content Security policy". Match case-insensitively so neither slips past.
  return message.startsWith("Refused to") || /content security policy/i.test(message);
}

async function runSmoke(window: BrowserWindow, native: NativeAddon): Promise<void> {
  const startedAt = Date.now();

  const rendererErrors: string[] = [];
  window.webContents.on("console-message", (details) => {
    if (details.level !== "error" && details.level !== "warning") return;
    if (rendererErrors.length < 20) {
      rendererErrors.push(`${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });

  await waitForLoad(window);

  const violations = rendererErrors.filter(isCspViolation);
  if (violations.length > 0) {
    throw new Error(`Content Security Policy violations in the renderer:\n${violations.join("\n")}`);
  }

  const shell = getDefaultShell();
  const { sessionId, output } = await runSmokePty(native, shell);
  if (!output.includes("ok")) {
    throw new Error(`Unexpected PTY output: ${JSON.stringify(output)}`);
  }

  native.shutdownAllPty();

  const report = {
    smoke: "ok",
    version: resolveAppVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    renderer: rendererEntryUrl(),
    shell,
    sessionId,
    output: output.trim(),
    rendererErrors,
    durationMs: Date.now() - startedAt,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  app.exit(0);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  if (SMOKE) {
    process.stdout.write(`${JSON.stringify({ smoke: "fail", error: error instanceof Error ? error.message : String(error) })}\n`);
  }
  app.exit(1);
});

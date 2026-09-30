/**
 * Quit interception.
 *
 * Exactly one policy question drives all of this, and it is the same one the
 * Rust `should_override_close_flow` asked: does `~/.codelegate/config.json`
 * exist and parse? If it does the app is past onboarding and may have live
 * sessions, so every exit path bounces to the renderer's CloseDialog first. If
 * it does not (first run, or a corrupt file) the app quits immediately, because
 * a user who cannot get past onboarding must still be able to close the window.
 *
 * All four exit paths funnel through `requestExit`: the red traffic light
 * (`close`), Cmd+Q (the custom menu item), Dock quit (`before-quit`), and the
 * renderer's own `exitApp()` once its dialog resolves (which goes straight to
 * `forceExit`).
 */
import { app } from "electron";
import type { BrowserWindow } from "electron";

import { IPC } from "../shared/channels";
import { configExistsAndParses } from "./ipc/config";
import { loadedNative } from "./native";

let exiting = false;
let mainWindow: BrowserWindow | null = null;

export function isExiting(): boolean {
  return exiting;
}

export function shouldInterceptClose(): boolean {
  return configExistsAndParses();
}

/** Kill every PTY, then leave. Never returns in practice. */
export function forceExit(): void {
  if (exiting) return;
  exiting = true;
  try {
    loadedNative()?.shutdownAllPty();
  } catch (error) {
    console.error("[lifecycle] shutdownAllPty failed during exit", error);
  }
  app.exit(0);
}

/** Ask the renderer to run its close flow, or quit outright if it has none. */
export function requestExit(): void {
  if (exiting) return;

  const window = mainWindow;
  const canAsk = Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
  if (!canAsk || !shouldInterceptClose()) {
    forceExit();
    return;
  }

  const target = window as BrowserWindow;
  try {
    if (target.isMinimized()) target.restore();
    if (!target.isVisible()) target.show();
    target.focus();
    target.webContents.send(IPC.APP_EXIT_REQUESTED);
  } catch (error) {
    // The renderer can be gone while `webContents` still reports itself alive
    // (a crashed or SIGTERM-ed render process disposes the frame first), and
    // `send` then throws "Render frame was disposed". There is nobody left to
    // run the close dialog, so the only correct answer is to quit rather than
    // leave the app unquittable.
    console.error("[lifecycle] could not reach the renderer, exiting", error);
    forceExit();
  }
}

export function registerLifecycle(window: BrowserWindow): void {
  mainWindow = window;

  window.on("close", (event) => {
    if (exiting) return;
    if (!shouldInterceptClose()) return;
    event.preventDefault();
    requestExit();
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  app.on("before-quit", (event) => {
    if (exiting) return;
    if (shouldInterceptClose() && mainWindow && !mainWindow.isDestroyed()) {
      event.preventDefault();
      requestExit();
      return;
    }
    forceExit();
  });

  app.on("window-all-closed", () => {
    forceExit();
  });
}

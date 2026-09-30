/**
 * The one place `ipcMain.handle` is called.
 *
 * Every channel answers with the `IpcResult` envelope: `{ ok: true, value }` or
 * `{ ok: false, error }`. A thrown error never crosses the boundary as an
 * Electron error (which would prefix the renderer's message with
 * "Error invoking remote method ..."); the preload rejects with the plain
 * string instead, so the existing `String(error)` toasts read exactly like the
 * Tauri ones did.
 */
import { ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";

import type { IpcResult } from "../../shared/channels";
import type { NativeAddon } from "../native";
import { registerConfigIpc } from "./config";
import { registerDialogIpc } from "./dialog";
import { registerGitIpc } from "./git";
import { registerNotificationIpc } from "./notification";
import { PtyHub, registerPtyIpc } from "./pty";
import { registerSessionsIpc } from "./sessions";
import { registerShellIpc } from "./shell";
import { registerSystemIpc } from "./system";

/* eslint-disable @typescript-eslint/no-explicit-any -- channel payloads are per-channel; each handler declares its own. */
export type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;
export type IpcHandle = (channel: string, handler: IpcHandler) => void;

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return String(error);
  } catch {
    return "Unknown error";
  }
}

export const handle: IpcHandle = (channel, handler) => {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
    try {
      return { ok: true, value: await handler(event, ...args) };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  });
};

export interface RegisterIpcDeps {
  native: NativeAddon;
  hub: PtyHub;
  /** `forceExit` from `lifecycle.ts`; kept as a dep so this module stays free of lifecycle state. */
  exitApp: () => void;
}

export function registerIpc({ native, hub, exitApp }: RegisterIpcDeps): void {
  registerSystemIpc(handle, { exitApp });
  registerGitIpc(handle, native);
  registerConfigIpc(handle);
  registerSessionsIpc(handle);
  registerPtyIpc(handle, hub);
  registerDialogIpc(handle);
  registerNotificationIpc(handle);
  registerShellIpc(handle, (url) => shell.openExternal(url));
}

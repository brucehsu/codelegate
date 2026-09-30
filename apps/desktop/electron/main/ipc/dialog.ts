/**
 * Native directory picker and confirm sheet, replacing the Tauri dialog
 * plugin. Both are parented to the requesting window so they show as sheets on
 * macOS instead of free-floating panels.
 */
import { BrowserWindow, dialog } from "electron";
import type { IpcMainInvokeEvent } from "electron";

import { IPC } from "../../shared/channels";
import type { ConfirmOptions } from "../../shared/types";
import type { IpcHandle } from "./register";

function windowFor(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export async function openDirectoryDialog(parent: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = { properties: ["openDirectory", "createDirectory"] };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
}

export async function confirmDialog(
  parent: BrowserWindow | null,
  message: string,
  options?: ConfirmOptions,
): Promise<boolean> {
  const boxOptions: Electron.MessageBoxOptions = {
    type: options?.kind ?? "info",
    title: options?.title,
    message,
    buttons: ["Cancel", "OK"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  };
  const result = parent
    ? await dialog.showMessageBox(parent, boxOptions)
    : await dialog.showMessageBox(boxOptions);
  return result.response === 1;
}

export function registerDialogIpc(handle: IpcHandle): void {
  handle(IPC.OPEN_DIRECTORY_DIALOG, (event) => openDirectoryDialog(windowFor(event)));
  handle(IPC.CONFIRM_DIALOG, (event, message: string, options?: ConfirmOptions) =>
    confirmDialog(windowFor(event), message, options),
  );
}

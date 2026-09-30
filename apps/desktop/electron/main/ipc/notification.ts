/**
 * Desktop notifications, replacing the Tauri notification plugin.
 *
 * Electron has no permission prompt: the OS grants or denies at the app level,
 * so `isPermissionGranted` and `requestPermission` collapse to "is the platform
 * able to show notifications at all". The renderer's existing
 * request-then-notify flow keeps working unchanged.
 */
import { Notification } from "electron";

import { IPC } from "../../shared/channels";
import type { NotificationOptions, NotificationPermission } from "../../shared/types";
import type { IpcHandle } from "./register";

export function isNotificationPermissionGranted(): boolean | null {
  return Notification.isSupported();
}

export function requestNotificationPermission(): NotificationPermission {
  return Notification.isSupported() ? "granted" : "denied";
}

export function showNotification(options: NotificationOptions): void {
  if (!Notification.isSupported()) return;
  new Notification({ title: options.title, body: options.body }).show();
}

export function registerNotificationIpc(handle: IpcHandle): void {
  handle(IPC.IS_NOTIFICATION_PERMISSION_GRANTED, () => isNotificationPermissionGranted());
  handle(IPC.REQUEST_NOTIFICATION_PERMISSION, () => requestNotificationPermission());
  handle(IPC.SHOW_NOTIFICATION, (_event, options: NotificationOptions) => {
    showNotification(options);
  });
}

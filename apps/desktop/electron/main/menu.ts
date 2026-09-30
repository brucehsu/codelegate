/**
 * Application menu.
 *
 * macOS needs a real menu bar for the standard Cmd+C/V/A and window shortcuts
 * to exist at all, so the template mirrors the Tauri one item for item. The one
 * custom entry is Quit, which routes through `requestExit` so Cmd+Q gets the
 * same close-confirmation flow as the red traffic light.
 *
 * Linux has no menu bar in this app (Tauri shipped none either).
 */
import { Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { requestExit } from "./lifecycle";

export function buildMacMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: "Codelegate",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          label: "Quit Codelegate",
          accelerator: "Command+Q",
          click: () => {
            requestExit();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "close" },
      ],
    },
  ];
}

export function applyApplicationMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMacMenuTemplate()));
}

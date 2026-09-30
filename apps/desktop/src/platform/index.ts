/**
 * The renderer's only door to the host process.
 *
 * `window.codelegate` carries the `ipcRenderer.invoke` half of the contract
 * (see `electron/shared/api.d.ts`); the PTY data plane rides a MessagePort and
 * is supplied by `ptyStream.ts`. This module composes both into the single
 * `api: CodelegateApi` object every call site imports.
 *
 * Renderer code must never touch `window.codelegate` or import `electron`.
 */
import type { CodelegateApi } from "../../electron/shared/api";
import { ackPtyOutput, onPtyExit, onPtyOutput, writePty } from "./ptyStream";

/** The methods `ptyStream.ts` supplies; the preload does not expose these. */
type PtyDataPlane = "writePty" | "ackPtyOutput" | "onPtyOutput" | "onPtyExit";

const bridge = (typeof window === "undefined" ? undefined : window.codelegate) as
  | Omit<CodelegateApi, PtyDataPlane>
  | undefined;

if (!bridge) {
  throw new Error(
    "window.codelegate is missing. The Electron preload bridge did not load; " +
      "the renderer cannot reach the main process."
  );
}

export const api: CodelegateApi = Object.freeze({
  ...bridge,
  writePty,
  ackPtyOutput,
  onPtyOutput,
  onPtyExit,
});

/** Static host platform check, replacing the old `navigator.platform` sniffing. */
export const isMac = api.platform === "darwin";

export type { CodelegateApi };

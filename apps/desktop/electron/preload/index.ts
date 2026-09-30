/**
 * Sandboxed preload bridge.
 *
 * Runs with `sandbox: true` and `contextIsolation: true`, so this file may only
 * import `electron` and the shared contract modules; there is no Node API here.
 * It exposes the invoke half of `CodelegateApi` on `window.codelegate` and hands
 * the PTY `MessagePort` into the page's main world.
 *
 * The PTY data plane (`writePty`, `ackPtyOutput`, `onPtyOutput`, `onPtyExit`) is
 * NOT part of the exposed object: it rides the MessagePort and is composed onto
 * the bridge by `src/platform/index.ts`.
 */
/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type IpcResult } from "../shared/channels";
import type { CodelegateApi } from "../shared/api";
import type {
  AgentCommandCheck,
  AppConfig,
  CommitGitChangesArgs,
  ConfirmOptions,
  GitFileDiffArgs,
  NotificationOptions,
  PreviousSessionsPayload,
  RemoveSessionWorktreeArgs,
  SpawnPtyArgs,
} from "../shared/types";

/** The half of `CodelegateApi` that actually travels over `ipcRenderer`. */
type InvokeBridge = Omit<
  CodelegateApi,
  "writePty" | "ackPtyOutput" | "onPtyOutput" | "onPtyExit"
>;

/**
 * `{ ok: true, value }` unwraps to the value; `{ ok: false, error }` throws the
 * plain error string (not an `Error`) so renderer `String(error)` toasts keep
 * printing the original backend message, exactly as Tauri's `invoke` did.
 */
function unwrap<T>(result: IpcResult<T>): T {
  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok) {
      return result.value;
    }
    throw typeof result.error === "string" ? result.error : "Unknown IPC error";
  }
  throw "Malformed IPC response";
}

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).then((result: IpcResult<T>) => unwrap(result));
}

/* ------------------------------------------------------------------ *
 * Static values
 * ------------------------------------------------------------------ */

/**
 * Main appends `--codelegate-app-version=<version>` to the renderer command
 * line through `webPreferences.additionalArguments`. Reading it here avoids a
 * synchronous IPC round trip at preload init.
 */
const APP_VERSION_SWITCH = "--codelegate-app-version=";

function readAppVersion(): string {
  const argv = Array.isArray(process.argv) ? process.argv : [];
  for (const arg of argv) {
    if (typeof arg === "string" && arg.startsWith(APP_VERSION_SWITCH)) {
      return arg.slice(APP_VERSION_SWITCH.length);
    }
  }
  return "";
}

const platform = (process.platform === "darwin" ? "darwin" : "linux") as "darwin" | "linux";

/* ------------------------------------------------------------------ *
 * PTY MessagePort handoff
 * ------------------------------------------------------------------ */

/** Sent by `src/platform/ptyStream.ts` once, at module init. */
const PORT_REQUEST = "codelegate:pty-port-request";
/** Sent back into the main world carrying the transferred port. */
const PORT_DELIVERY = "codelegate:pty-port";

let heldPort: MessagePort | null = null;
let portRequested = false;

function deliverPortIfPossible() {
  if (!heldPort || !portRequested) {
    return;
  }
  const port = heldPort;
  heldPort = null;
  portRequested = false;
  // Transferring a MessagePort from the isolated world into the main world is
  // the documented Electron handoff; the page listens for this on `window`.
  window.postMessage({ type: PORT_DELIVERY }, "*", [port]);
}

ipcRenderer.on(IPC.PTY_PORT, (event) => {
  const port = event.ports[0];
  if (!port) {
    return;
  }
  // A replacement port (reload, renderer restart) supersedes any stale one.
  heldPort?.close();
  heldPort = port;
  deliverPortIfPossible();
});

window.addEventListener("message", (event) => {
  // Same-window only. A cross-frame source is a different WindowProxy and is
  // rejected; a null source (no frame) is tolerated so the handshake cannot be
  // broken by a world-wrapper identity quirk.
  if (event.source && event.source !== window) {
    return;
  }
  const data = event.data as { type?: unknown } | null;
  if (!data || typeof data !== "object" || data.type !== PORT_REQUEST) {
    return;
  }
  portRequested = true;
  deliverPortIfPossible();
});

/* ------------------------------------------------------------------ *
 * Bridge
 * ------------------------------------------------------------------ */

const bridge: InvokeBridge = {
  platform,
  arch: process.arch,
  appVersion: readAppVersion(),

  /* system */
  getDefaultShell: () => call<string>(IPC.GET_DEFAULT_SHELL),
  checkAgentCommands: (checks: AgentCommandCheck[]) =>
    call<Record<string, boolean>>(IPC.CHECK_AGENT_COMMANDS, checks),
  getHomeDir: () => call<string>(IPC.GET_HOME_DIR),
  pathExists: (path: string) => call<boolean>(IPC.PATH_EXISTS, path),
  exitApp: () => call<void>(IPC.EXIT_APP),

  /* git */
  getGitBranch: (path: string) => call(IPC.GET_GIT_BRANCH, path),
  listGitBranches: (path: string) => call(IPC.LIST_GIT_BRANCHES, path),
  renameGitBranch: (path: string, name: string) => call(IPC.RENAME_GIT_BRANCH, path, name),
  getGitChangeSummary: (path: string) => call(IPC.GET_GIT_CHANGE_SUMMARY, path),
  getGitFileDiff: (args: GitFileDiffArgs) => call(IPC.GET_GIT_FILE_DIFF, args),
  stageAllChanges: (path: string) => call<void>(IPC.STAGE_ALL_CHANGES, path),
  unstageAllChanges: (path: string) => call<void>(IPC.UNSTAGE_ALL_CHANGES, path),
  discardAllChanges: (path: string) => call<void>(IPC.DISCARD_ALL_CHANGES, path),
  stageFileChange: (path: string, filePath: string) =>
    call(IPC.STAGE_FILE_CHANGE, path, filePath),
  unstageFileChange: (path: string, filePath: string) =>
    call(IPC.UNSTAGE_FILE_CHANGE, path, filePath),
  commitGitChanges: (args: CommitGitChangesArgs) => call<void>(IPC.COMMIT_GIT_CHANGES, args),
  getLastCommitMessage: (path: string) => call<string>(IPC.GET_LAST_COMMIT_MESSAGE, path),
  removeSessionWorktree: (args: RemoveSessionWorktreeArgs) =>
    call<void>(IPC.REMOVE_SESSION_WORKTREE, args),

  /* config */
  loadConfig: () => call(IPC.LOAD_CONFIG),
  hasSavedConfig: () => call<boolean>(IPC.HAS_SAVED_CONFIG),
  saveConfig: (config: AppConfig) => call<void>(IPC.SAVE_CONFIG, config),

  /* session restore */
  loadPreviousSessions: () => call(IPC.LOAD_PREVIOUS_SESSIONS),
  savePreviousSessions: (payload: PreviousSessionsPayload) =>
    call<void>(IPC.SAVE_PREVIOUS_SESSIONS, payload),
  savePreviousSessionsSnapshot: (payload: PreviousSessionsPayload) =>
    call<void>(IPC.SAVE_PREVIOUS_SESSIONS_SNAPSHOT, payload),
  clearPreviousSessions: () => call<void>(IPC.CLEAR_PREVIOUS_SESSIONS),

  /* pty control plane */
  spawnPty: (args: SpawnPtyArgs) => call<number>(IPC.SPAWN_PTY, args),
  resizePty: (sessionId: number, cols: number, rows: number) =>
    call<void>(IPC.RESIZE_PTY, sessionId, cols, rows),
  killPty: (sessionId: number) => call<void>(IPC.KILL_PTY, sessionId),

  /* lifecycle */
  onAppExitRequested: (callback: () => void) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on(IPC.APP_EXIT_REQUESTED, listener);
    return () => {
      ipcRenderer.removeListener(IPC.APP_EXIT_REQUESTED, listener);
    };
  },

  /* dialogs */
  openDirectoryDialog: () => call<string | null>(IPC.OPEN_DIRECTORY_DIALOG),
  confirmDialog: (message: string, options?: ConfirmOptions) =>
    call<boolean>(IPC.CONFIRM_DIALOG, message, options),

  /* shell */
  openExternal: (url: string) => call<void>(IPC.OPEN_EXTERNAL, url),

  /* notifications */
  isNotificationPermissionGranted: () =>
    call<boolean | null>(IPC.IS_NOTIFICATION_PERMISSION_GRANTED),
  requestNotificationPermission: () => call(IPC.REQUEST_NOTIFICATION_PERMISSION),
  showNotification: (options: NotificationOptions) => call<void>(IPC.SHOW_NOTIFICATION, options),
};

contextBridge.exposeInMainWorld("codelegate", bridge);

/**
 * The `window.codelegate` surface exposed by `electron/preload/index.ts`
 * through `contextBridge`, and re-exported to the renderer as `api` from
 * `src/platform/index.ts`.
 *
 * Method names are the camelCase form of the old Tauri command names, so the
 * call sites are a mechanical `invoke("x", {...})` -> `api.x(...)` swap.
 *
 * Transport split: everything here is an `ipcRenderer.invoke` channel from
 * `channels.ts` EXCEPT `writePty`, `ackPtyOutput`, `onPtyOutput` and
 * `onPtyExit`, which ride the PTY `MessagePort` (see
 * `src/platform/ptyStream.ts`). `Window.codelegate` is declared as the whole
 * `CodelegateApi` because that is the fixed contract, but the preload only
 * puts the invoke half plus the port handshake on it; `src/platform/index.ts`
 * composes that object with the `ptyStream.ts` helpers and exports the result
 * as `api`. Renderer code must import `api` from `src/platform`, never touch
 * `window.codelegate` directly.
 */
import type {
  AgentCommandCheck,
  AppConfig,
  CommitGitChangesArgs,
  ConfirmOptions,
  GitBranchInfo,
  GitChangeSummaryPayload,
  GitFileDiffArgs,
  GitFileDiffPayload,
  NotificationOptions,
  NotificationPermission,
  PreviousSessionsPayload,
  PtyExitEvent,
  PtyOutputEvent,
  RemoveSessionWorktreeArgs,
  SpawnPtyArgs,
} from "./types";

export type {
  AgentCommandCheck,
  CommitGitChangesArgs,
  ConfirmOptions,
  GitFileDiffArgs,
  NotificationOptions,
  NotificationPermission,
  PtyExitEvent,
  PtyOutputEvent,
  RemoveSessionWorktreeArgs,
  SpawnPtyArgs,
};

/** Unsubscribe handle returned by every `on*` listener. */
export type Unsubscribe = () => void;

export interface CodelegateApi {
  /* ---- static values, read once at preload time ---- */
  readonly platform: "darwin" | "linux";
  readonly arch: string;
  readonly appVersion: string;

  /* ---- system ---- */
  getDefaultShell(): Promise<string>;
  checkAgentCommands(checks: AgentCommandCheck[]): Promise<Record<string, boolean>>;
  getHomeDir(): Promise<string>;
  pathExists(path: string): Promise<boolean>;
  exitApp(): Promise<void>;

  /* ---- git ---- */
  getGitBranch(path: string): Promise<string>;
  listGitBranches(path: string): Promise<GitBranchInfo[]>;
  renameGitBranch(path: string, name: string): Promise<string>;
  getGitChangeSummary(path: string): Promise<GitChangeSummaryPayload>;
  getGitFileDiff(args: GitFileDiffArgs): Promise<GitFileDiffPayload>;
  stageAllChanges(path: string): Promise<void>;
  unstageAllChanges(path: string): Promise<void>;
  discardAllChanges(path: string): Promise<void>;
  stageFileChange(path: string, filePath: string): Promise<GitChangeSummaryPayload>;
  unstageFileChange(path: string, filePath: string): Promise<GitChangeSummaryPayload>;
  commitGitChanges(args: CommitGitChangesArgs): Promise<void>;
  getLastCommitMessage(path: string): Promise<string>;
  removeSessionWorktree(args: RemoveSessionWorktreeArgs): Promise<void>;

  /* ---- config ---- */
  loadConfig(): Promise<AppConfig>;
  hasSavedConfig(): Promise<boolean>;
  saveConfig(config: AppConfig): Promise<void>;

  /* ---- session restore ---- */
  loadPreviousSessions(): Promise<PreviousSessionsPayload | null>;
  savePreviousSessions(payload: PreviousSessionsPayload): Promise<void>;
  savePreviousSessionsSnapshot(payload: PreviousSessionsPayload): Promise<void>;
  clearPreviousSessions(): Promise<void>;

  /* ---- pty control plane (ipcRenderer.invoke) ---- */
  spawnPty(args: SpawnPtyArgs): Promise<number>;
  resizePty(sessionId: number, cols: number, rows: number): Promise<void>;
  killPty(sessionId: number): Promise<void>;

  /* ---- pty data plane (MessagePort, fire and forget) ---- */
  writePty(sessionId: number, data: string): void;
  ackPtyOutput(sessionId: number, throughOffset: number): void;
  onPtyOutput(callback: (event: PtyOutputEvent) => void): Unsubscribe;
  onPtyExit(callback: (event: PtyExitEvent) => void): Unsubscribe;

  /* ---- lifecycle ---- */
  onAppExitRequested(callback: () => void): Unsubscribe;

  /* ---- dialogs ---- */
  openDirectoryDialog(): Promise<string | null>;
  confirmDialog(message: string, options?: ConfirmOptions): Promise<boolean>;

  /* ---- shell ---- */
  openExternal(url: string): Promise<void>;

  /* ---- notifications ---- */
  isNotificationPermissionGranted(): Promise<boolean | null>;
  requestNotificationPermission(): Promise<NotificationPermission>;
  showNotification(options: NotificationOptions): Promise<void>;
}

declare global {
  interface Window {
    readonly codelegate: CodelegateApi;
  }
}

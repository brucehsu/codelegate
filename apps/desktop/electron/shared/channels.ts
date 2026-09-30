/**
 * IPC channel names.
 *
 * Every entry except `PTY_PORT` and `APP_EXIT_REQUESTED` is an
 * `ipcRenderer.invoke` / `ipcMain.handle` control-plane channel. Handlers
 * answer with `{ ok: true, value } | { ok: false, error: string }` and the
 * preload bridge rejects with the plain `error` string, so renderer
 * `String(error)` toasts keep reading the original message.
 *
 * NOT listed here on purpose: `writePty`, `ackPtyOutput`, `onPtyOutput` and
 * `onPtyExit`. Those are part of the `CodelegateApi` surface the renderer
 * imports, but they do not travel over `ipcRenderer`: they ride the
 * `MessageChannelMain` port handed to the page main world (see
 * `src/platform/ptyStream.ts` and the port protocol in the plan). Only the
 * one-time port handoff (`PTY_PORT`) is an Electron channel, and it is a
 * `webContents.postMessage` channel rather than an invoke channel.
 */
export const IPC = {
  /* system */
  GET_DEFAULT_SHELL: "system:getDefaultShell",
  CHECK_AGENT_COMMANDS: "system:checkAgentCommands",
  GET_HOME_DIR: "system:getHomeDir",
  PATH_EXISTS: "system:pathExists",
  EXIT_APP: "system:exitApp",

  /* git */
  GET_GIT_BRANCH: "git:getGitBranch",
  LIST_GIT_BRANCHES: "git:listGitBranches",
  RENAME_GIT_BRANCH: "git:renameGitBranch",
  GET_GIT_CHANGE_SUMMARY: "git:getGitChangeSummary",
  GET_GIT_FILE_DIFF: "git:getGitFileDiff",
  STAGE_ALL_CHANGES: "git:stageAllChanges",
  UNSTAGE_ALL_CHANGES: "git:unstageAllChanges",
  DISCARD_ALL_CHANGES: "git:discardAllChanges",
  STAGE_FILE_CHANGE: "git:stageFileChange",
  UNSTAGE_FILE_CHANGE: "git:unstageFileChange",
  COMMIT_GIT_CHANGES: "git:commitGitChanges",
  GET_LAST_COMMIT_MESSAGE: "git:getLastCommitMessage",
  REMOVE_SESSION_WORKTREE: "git:removeSessionWorktree",

  /* config */
  LOAD_CONFIG: "config:loadConfig",
  HAS_SAVED_CONFIG: "config:hasSavedConfig",
  SAVE_CONFIG: "config:saveConfig",

  /* sessions */
  LOAD_PREVIOUS_SESSIONS: "sessions:loadPreviousSessions",
  SAVE_PREVIOUS_SESSIONS: "sessions:savePreviousSessions",
  SAVE_PREVIOUS_SESSIONS_SNAPSHOT: "sessions:savePreviousSessionsSnapshot",
  CLEAR_PREVIOUS_SESSIONS: "sessions:clearPreviousSessions",

  /* pty control plane (data plane is the MessagePort) */
  SPAWN_PTY: "pty:spawnPty",
  RESIZE_PTY: "pty:resizePty",
  KILL_PTY: "pty:killPty",

  /* dialog */
  OPEN_DIRECTORY_DIALOG: "dialog:openDirectoryDialog",
  CONFIRM_DIALOG: "dialog:confirmDialog",

  /* shell */
  OPEN_EXTERNAL: "shell:openExternal",

  /* notification */
  IS_NOTIFICATION_PERMISSION_GRANTED: "notification:isPermissionGranted",
  REQUEST_NOTIFICATION_PERMISSION: "notification:requestPermission",
  SHOW_NOTIFICATION: "notification:show",

  /* main -> renderer, not invoke */
  /** `webContents.postMessage` handoff of the PTY MessagePort, on `did-finish-load`. */
  PTY_PORT: "pty:port",
  /** Main asks the renderer to run its CloseDialog flow before quitting. */
  APP_EXIT_REQUESTED: "app-exit-requested",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** Envelope every `ipcMain.handle` returns; the preload unwraps it. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

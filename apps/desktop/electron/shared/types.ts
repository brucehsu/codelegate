/**
 * Domain and IPC payload types shared by the main process, the preload bridge
 * and the renderer.
 *
 * These shapes are byte-identical to the JSON the previous Tauri/serde backend
 * produced (camelCase keys, `type` field on diff cells, lowercase `section`),
 * so persisted `~/.codelegate/*.json` files stay readable across the migration.
 *
 * `src/types.ts` and `src/utils/gitDiff.ts` re-export everything here so
 * existing renderer imports keep working.
 */

/* ------------------------------------------------------------------ *
 * Agents / repositories
 * ------------------------------------------------------------------ */

export type AgentId = "claude" | "codex";

export interface EnvVar {
  key: string;
  value: string;
}

export interface RepoSessionDefaults {
  env: EnvVar[];
  preCommands: string;
}

export interface WorktreeConfig {
  enabled: boolean;
  /** Existing local branch checked out directly in the worktree. Absent means git auto-creates a branch. */
  branch?: string;
}

export interface RepoConfig {
  repoPath: string;
  agent: AgentId;
  env: EnvVar[];
  preCommands: string;
  worktree?: WorktreeConfig;
}

/** Probe request for `checkAgentCommands`. */
export interface AgentCommandCheck {
  agent: string;
  commands: string[];
  customCommand?: string;
}

/* ------------------------------------------------------------------ *
 * Config (~/.codelegate/config.json)
 * ------------------------------------------------------------------ */

export interface AppSettings {
  /** Kept only for config-file shape compatibility with the previous backend; no frontend consumer. */
  theme: "dark" | "light";
  recentDirs: string[];
  terminalFontFamily: string;
  terminalFontSize: number;
  shortcutModifier: string;
  repoDefaults?: Record<string, RepoSessionDefaults>;
  agentArgs?: Record<string, string>;
  agentCommands?: Record<string, string>;
  sidebarCollapsed?: boolean;
}

export interface AppConfig {
  version: number;
  settings: AppSettings;
}

/* ------------------------------------------------------------------ *
 * Session restore (~/.codelegate/previous_sessions.json)
 * ------------------------------------------------------------------ */

export interface PreviousSessionEntry {
  repo: RepoConfig;
  cwd?: string;
}

export interface PreviousSessionsPayload {
  sessions: PreviousSessionEntry[];
  activeIndex: number;
}

/* ------------------------------------------------------------------ *
 * Git
 * ------------------------------------------------------------------ */

export interface GitBranchInfo {
  name: string;
  /** Set when the branch is checked out in a worktree (including the primary checkout). */
  worktreePath?: string | null;
}

export type DiffLineType = "context" | "add" | "del" | "empty" | "meta";
export type GitDiffSection = "staged" | "unstaged";
export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface DiffCell {
  text: string;
  type: DiffLineType;
}

export interface DiffRow {
  left: DiffCell;
  right: DiffCell;
  leftLine: number | null;
  rightLine: number | null;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  newPath?: string;
  rows: DiffRow[];
  additions: number;
  deletions: number;
  language: string;
  isBinary: boolean;
  isDirectory: boolean;
  isUntracked: boolean;
  status: GitFileStatus;
  truncated: boolean;
}

export interface GitChangeSummary {
  path: string;
  oldPath?: string;
  newPath?: string;
  additions: number;
  deletions: number;
  changedLineCount: number;
  isBinary: boolean;
  isDirectory: boolean;
  isUntracked: boolean;
  fromUntrackedDir: boolean;
  status: GitFileStatus;
}

export interface GitChangeSummaryPayload {
  staged: GitChangeSummary[];
  unstaged: GitChangeSummary[];
}

export interface GitFileDiffPayload extends GitChangeSummary {
  rows: DiffRow[];
  truncated: boolean;
}

export interface GitFileDiffArgs {
  path: string;
  section: GitDiffSection;
  filePath: string;
  oldPath?: string | null;
}

export interface CommitGitChangesArgs {
  path: string;
  message: string;
  amend: boolean;
}

export interface RemoveSessionWorktreeArgs {
  repoPath: string;
  worktreePath: string;
  branch?: string;
}

/* ------------------------------------------------------------------ *
 * PTY
 * ------------------------------------------------------------------ */

export interface SpawnPtyArgs {
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

/** Batched PTY output delivered over the MessagePort. `endOffset` is cumulative. */
export interface PtyOutputEvent {
  sessionId: number;
  data: Uint8Array;
  endOffset: number;
}

export interface PtyExitEvent {
  sessionId: number;
}

/* ------------------------------------------------------------------ *
 * Dialogs / notifications
 * ------------------------------------------------------------------ */

export interface ConfirmOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
}

export interface NotificationOptions {
  title: string;
  body: string;
}

export type NotificationPermission = "granted" | "denied";

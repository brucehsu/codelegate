export type AgentId = "claude" | "codex";
export type AgentAvailability = Partial<Record<AgentId, boolean>>;
export type PaneKind = "agent" | "git" | "terminal";

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

export interface GitBranchInfo {
  name: string;
  /** Set when the branch is checked out in a worktree (including the primary checkout). */
  worktreePath?: string | null;
}

export interface RepoConfig {
  repoPath: string;
  agent: AgentId;
  env: EnvVar[];
  preCommands: string;
  worktree?: WorktreeConfig;
}

export interface AppSettings {
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

export type SessionStatus = "running" | "stopped" | "error";

export interface AgentProcessState {
  status: SessionStatus;
  ptyId?: number;
  startedAt?: number;
  lastError?: string;
}

export interface Session {
  id: string;
  repo: RepoConfig;
  cwd?: string;
  branch?: string;
  lastActivePaneKind: PaneKind;
  /** Agent currently visible in the session. Set at creation (from repo.agent). */
  activeAgent: AgentId;
  /** Per-agent process state. Session-level status mirrors the active agent. */
  agentStates: Partial<Record<AgentId, AgentProcessState>>;
  status: SessionStatus;
  isTabClosed?: boolean;
}

export interface PreviousSessionEntry {
  repo: RepoConfig;
  cwd?: string;
}

export interface PreviousSessionsPayload {
  sessions: PreviousSessionEntry[];
  activeIndex: number;
}

export interface CloseConfirmPayload {
  hasRunning: boolean;
  sessionCount: number;
}

export interface CloseConfirmResult {
  confirmed: boolean;
  remember: boolean;
}

export interface PtyOutput {
  session_id: number;
  data_base64: string;
  end_offset: number;
}

export interface PtyExit {
  session_id: number;
}

export interface ToastMessage {
  id: string;
  message: string;
  tone: "error" | "info" | "success";
  exiting?: boolean;
}

export interface ToastInput {
  message: string;
  tone?: "error" | "info" | "success";
}

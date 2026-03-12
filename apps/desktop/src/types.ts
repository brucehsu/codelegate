export type AgentId = "claude" | "codex";
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
}

export interface AppConfig {
  version: number;
  settings: AppSettings;
}

export type SessionStatus = "running" | "stopped" | "error";

export interface Session {
  id: string;
  repo: RepoConfig;
  cwd?: string;
  branch?: string;
  status: SessionStatus;
  ptyId?: number;
  lastError?: string;
  startedAt?: number;
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

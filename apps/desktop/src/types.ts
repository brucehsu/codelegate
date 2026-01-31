export type AgentId = "claude" | "codex";

export interface EnvVar {
  key: string;
  value: string;
}

export interface WorktreeConfig {
  enabled: boolean;
  path: string;
  branch: string;
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
}

export interface AppConfig {
  version: number;
  settings: AppSettings;
}

export type SessionStatus = "running" | "stopped" | "error";

export interface Session {
  id: string;
  repo: RepoConfig;
  status: SessionStatus;
  ptyId?: number;
  lastError?: string;
  startedAt?: number;
}

export interface PtyOutput {
  session_id: number;
  data: string;
}

export interface PtyExit {
  session_id: number;
}

export interface ToastMessage {
  id: string;
  message: string;
  tone: "error" | "info";
}

export interface ToastInput {
  message: string;
  tone?: "error" | "info";
}

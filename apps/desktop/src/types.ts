/**
 * Renderer-only types. Everything shared with the main process now lives in
 * `electron/shared/types.ts`; it is re-exported here so existing
 * `from "../types"` imports keep working.
 */
export type {
  AgentCommandCheck,
  AgentId,
  AppConfig,
  AppSettings,
  EnvVar,
  GitBranchInfo,
  PreviousSessionEntry,
  PreviousSessionsPayload,
  RepoConfig,
  RepoSessionDefaults,
  WorktreeConfig,
} from "../electron/shared/types";

import type { AgentId, RepoConfig } from "../electron/shared/types";

export type AgentAvailability = Partial<Record<AgentId, boolean>>;
export type PaneKind = "agent" | "git" | "terminal";

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

export interface CloseConfirmPayload {
  hasRunning: boolean;
  sessionCount: number;
}

export interface CloseConfirmResult {
  confirmed: boolean;
  remember: boolean;
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

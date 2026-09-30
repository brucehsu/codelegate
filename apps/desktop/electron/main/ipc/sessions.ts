/**
 * `~/.codelegate/previous_sessions.json` (and its `.json.tmp` snapshot twin)
 * reading and writing.
 *
 * The snapshot file name is `previous_sessions.json.tmp`, exactly what Rust's
 * `PathBuf::with_extension("json.tmp")` produced. It is a real file the app
 * reads back, not a scratch file, so the name has to be preserved.
 *
 * No `electron` import at runtime: the unit suite loads this module directly.
 */
import fsp from "node:fs/promises";
import path from "node:path";

import { IPC } from "../../shared/channels";
import type {
  AgentId,
  PreviousSessionEntry,
  PreviousSessionsPayload,
  RepoConfig,
  WorktreeConfig,
} from "../../shared/types";
import { codelegateDir, normalizeEnv, writeJsonFileAtomic } from "./config";
import type { IpcHandle } from "./register";

const AGENT_IDS: readonly AgentId[] = ["claude", "codex"];

export function previousSessionsFile(homeDir?: string): string {
  return path.join(codelegateDir(homeDir), "previous_sessions.json");
}

export function previousSessionsSnapshotFile(homeDir?: string): string {
  return `${previousSessionsFile(homeDir)}.tmp`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Absent or malformed means "no worktree", which is what an absent field meant to serde. */
function normalizeWorktree(raw: unknown): WorktreeConfig | undefined {
  if (!isRecord(raw) || typeof raw.enabled !== "boolean") return undefined;
  return typeof raw.branch === "string" ? { enabled: raw.enabled, branch: raw.branch } : { enabled: raw.enabled };
}

/** The required fields have no serde default: an entry missing one is not a session. */
function normalizeRepo(raw: unknown): RepoConfig | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.repoPath !== "string" || raw.repoPath.length === 0) return null;
  if (!AGENT_IDS.includes(raw.agent as AgentId)) return null;

  const repo: RepoConfig = {
    repoPath: raw.repoPath,
    agent: raw.agent as AgentId,
    env: normalizeEnv(raw.env),
    preCommands: typeof raw.preCommands === "string" ? raw.preCommands : "",
  };
  const worktree = normalizeWorktree(raw.worktree);
  if (worktree) repo.worktree = worktree;
  return repo;
}

function normalizeEntry(raw: unknown): PreviousSessionEntry | null {
  if (!isRecord(raw)) return null;
  const repo = normalizeRepo(raw.repo);
  if (!repo) return null;
  return typeof raw.cwd === "string" ? { repo, cwd: raw.cwd } : { repo };
}

/**
 * Stand-in for serde on `PreviousSessionsPayload`: field defaults (`env: []`,
 * `preCommands: ""`, optional `worktree` and `cwd`) plus the strictness that
 * came free with the Rust types. A file whose top level is not the expected
 * object is rejected outright (`null`, restoring nothing) rather than silently
 * turned into an empty session list; individual entries that cannot be trusted
 * are dropped, and `activeIndex` is clamped to whatever survived.
 */
export function normalizePreviousSessions(raw: unknown): PreviousSessionsPayload | null {
  if (!isRecord(raw)) return null;
  if (raw.sessions !== undefined && !Array.isArray(raw.sessions)) return null;

  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.map(normalizeEntry).filter((entry): entry is PreviousSessionEntry => entry !== null)
    : [];

  let activeIndex = 0;
  if (typeof raw.activeIndex === "number" && Number.isInteger(raw.activeIndex) && raw.activeIndex > 0) {
    activeIndex = Math.min(raw.activeIndex, Math.max(sessions.length - 1, 0));
  }

  return { sessions, activeIndex };
}

export async function loadPreviousSessions(homeDir?: string): Promise<PreviousSessionsPayload | null> {
  const file = previousSessionsFile(homeDir);
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Failed to read previous sessions: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse previous sessions: ${(error as Error).message}`);
  }
  // `null` here is a file that parsed but is not a session payload: restore
  // nothing, exactly as if none had been saved.
  return normalizePreviousSessions(parsed);
}

async function write(file: string, payload: PreviousSessionsPayload): Promise<void> {
  try {
    await writeJsonFileAtomic(file, payload);
  } catch (error) {
    throw new Error(`Failed to write previous sessions: ${(error as Error).message}`);
  }
}

export async function savePreviousSessions(payload: PreviousSessionsPayload, homeDir?: string): Promise<void> {
  await write(previousSessionsFile(homeDir), payload);
}

export async function savePreviousSessionsSnapshot(
  payload: PreviousSessionsPayload,
  homeDir?: string,
): Promise<void> {
  await write(previousSessionsSnapshotFile(homeDir), payload);
}

export async function clearPreviousSessions(homeDir?: string): Promise<void> {
  try {
    await fsp.rm(previousSessionsFile(homeDir), { force: true });
  } catch (error) {
    throw new Error(`Failed to remove previous sessions: ${(error as Error).message}`);
  }
}

export function registerSessionsIpc(handle: IpcHandle): void {
  handle(IPC.LOAD_PREVIOUS_SESSIONS, () => loadPreviousSessions());
  handle(IPC.SAVE_PREVIOUS_SESSIONS, (_event, payload: PreviousSessionsPayload) => savePreviousSessions(payload));
  handle(IPC.SAVE_PREVIOUS_SESSIONS_SNAPSHOT, (_event, payload: PreviousSessionsPayload) =>
    savePreviousSessionsSnapshot(payload),
  );
  handle(IPC.CLEAR_PREVIOUS_SESSIONS, () => clearPreviousSessions());
}

import type { EnvVar, Session } from "../types";

export function getRepoName(path: string) {
  const cleaned = path.replace(/\/+$/, "");
  const parts = cleaned.split("/");
  return parts[parts.length - 1] || cleaned;
}

export interface SessionGroup {
  key: string;
  name: string;
  sessions: Session[];
}

export function groupSessionsByRepo(sessions: Session[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  const groupMap = new Map<string, SessionGroup>();
  sessions.forEach((session) => {
    const key = session.repo.repoPath;
    const name = getRepoName(key);
    let group = groupMap.get(key);
    if (!group) {
      group = { key, name, sessions: [] };
      groupMap.set(key, group);
      groups.push(group);
    }
    group.sessions.push(session);
  });
  return groups;
}

export function createSessionId(repoPath: string) {
  return `${repoPath}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`;
}

export function envListToMap(env: EnvVar[]) {
  const map: Record<string, string> = {};
  env.forEach((entry) => {
    const key = entry.key.trim();
    const value = (entry.value ?? "").trim();
    if (key && value) {
      map[key] = value;
    }
  });
  return map;
}

export function validateEnvVars(env: EnvVar[]) {
  const invalid = env.find((entry) => {
    const key = entry.key.trim();
    const value = (entry.value ?? "").trim();
    if (!key || !value) {
      return false;
    }
    return !/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(key);
  });
  if (invalid) {
    return `Invalid environment variable name: ${invalid.key}`;
  }
  return "";
}

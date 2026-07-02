import type { AgentId } from "./types";

export const agentCatalog: Array<{ id: AgentId; label: string; commands: string[] }> = [
  { id: "claude", label: "Claude Code", commands: ["claude", "claude-code"] },
  { id: "codex", label: "Codex CLI", commands: ["codex", "codex-cli"] },
];

export const agentCommandById: Record<AgentId, string> = {
  claude:
    'if command -v claude >/dev/null 2>&1; then exec claude; elif command -v claude-code >/dev/null 2>&1; then exec claude-code; else echo "Claude Code not found in PATH"; fi',
  codex:
    'if command -v codex >/dev/null 2>&1; then exec codex; elif command -v codex-cli >/dev/null 2>&1; then exec codex-cli; else echo "Codex CLI not found in PATH"; fi',
};

export function isSupportedAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && agentCatalog.some((agent) => agent.id === value);
}

export function normalizeAgentId(value: unknown): AgentId {
  return isSupportedAgentId(value) ? value : "claude";
}

import type { AgentId } from "./types";

export const agentCatalog: Array<{ id: AgentId; label: string; commands: string[] }> = [
  { id: "claude", label: "Claude Code", commands: ["claude", "claude-code"] },
  { id: "codex", label: "Codex CLI", commands: ["codex", "codex-cli"] },
  { id: "droid", label: "Droid CLI", commands: ["droid"] },
];

export const agentCommandById: Record<string, string> = {
  claude:
    'if command -v claude >/dev/null 2>&1; then exec claude; elif command -v claude-code >/dev/null 2>&1; then exec claude-code; else echo "Claude Code not found in PATH"; fi',
  codex:
    'if command -v codex >/dev/null 2>&1; then exec codex; elif command -v codex-cli >/dev/null 2>&1; then exec codex-cli; else echo "Codex CLI not found in PATH"; fi',
  droid:
    'if command -v droid >/dev/null 2>&1; then exec droid; else echo "Droid CLI not found in PATH"; fi',
};

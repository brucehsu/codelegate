import type { AgentId } from "./types";

export const agentCatalog: Array<{ id: AgentId; label: string }> = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex CLI" },
];

export const agentCommandById: Record<AgentId, string> = {
  claude:
    'if command -v claude >/dev/null 2>&1; then exec claude; elif command -v claude-code >/dev/null 2>&1; then exec claude-code; else echo "Claude Code not found in PATH"; fi',
  codex:
    'if command -v codex >/dev/null 2>&1; then exec codex; elif command -v codex-cli >/dev/null 2>&1; then exec codex-cli; else echo "Codex CLI not found in PATH"; fi',
};

export const darkTerminalTheme = {
  background: "#0b0e14",
  foreground: "#e7ecf3",
  cursor: "#4fd1c5",
  selectionForeground: "#e7ecf3",
  selectionBackground: "#2a3550",
};

export const lightTerminalTheme = {
  background: "#f8f9fb",
  foreground: "#10131a",
  cursor: "#0a7c6f",
  selectionForeground: "#10131a",
  selectionBackground: "#c8d2ea",
};

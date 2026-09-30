/**
 * Git diff payload types moved to `electron/shared/types.ts` and re-exported
 * here so existing `from "../utils/gitDiff"` imports keep working. The helpers
 * below stay renderer-side.
 */
export type {
  DiffCell,
  DiffLineType,
  DiffRow,
  FileDiff,
  GitChangeSummary,
  GitChangeSummaryPayload,
  GitDiffSection,
  GitFileDiffPayload,
  GitFileStatus,
} from "../../electron/shared/types";

const plainTextExtensions = new Set([
  "txt",
  "csv",
  "tsv",
  "log",
]);

const SYNTAX_HIGHLIGHT_THRESHOLD = 5000;

const extensionToLanguage: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  css: "css",
  md: "markdown",
  html: "markup",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  rs: "rust",
  go: "go",
  py: "python",
  sh: "bash",
  zsh: "bash",
  bash: "bash",
};

export function getLanguageFromPath(path: string) {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
  return extensionToLanguage[ext] ?? "text";
}

export function shouldHighlightDiff(path: string, changedLineCount: number) {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
  if (changedLineCount > SYNTAX_HIGHLIGHT_THRESHOLD) {
    return false;
  }
  if (plainTextExtensions.has(ext)) {
    return false;
  }
  return getLanguageFromPath(path) !== "text";
}

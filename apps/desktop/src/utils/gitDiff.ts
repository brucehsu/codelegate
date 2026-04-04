export type DiffLineType = "context" | "add" | "del" | "empty" | "meta";
export type GitDiffSection = "staged" | "unstaged";
export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface DiffCell {
  text: string;
  type: DiffLineType;
}

export interface DiffRow {
  left: DiffCell;
  right: DiffCell;
  leftLine: number | null;
  rightLine: number | null;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  newPath?: string;
  rows: DiffRow[];
  additions: number;
  deletions: number;
  language: string;
  isBinary: boolean;
  isUntracked: boolean;
  status: GitFileStatus;
}

export interface GitChangeSummary {
  path: string;
  oldPath?: string;
  newPath?: string;
  additions: number;
  deletions: number;
  changedLineCount: number;
  isBinary: boolean;
  isUntracked: boolean;
  status: GitFileStatus;
}

export interface GitChangeSummaryPayload {
  staged: GitChangeSummary[];
  unstaged: GitChangeSummary[];
}

export interface GitFileDiffPayload extends GitChangeSummary {
  rows: DiffRow[];
}

const plainTextExtensions = new Set([
  "txt",
  "csv",
  "tsv",
  "log",
  "sql",
]);

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
  if (changedLineCount > 100) {
    return false;
  }
  if (plainTextExtensions.has(ext)) {
    return false;
  }
  return getLanguageFromPath(path) !== "text";
}

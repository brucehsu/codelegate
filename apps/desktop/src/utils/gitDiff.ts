export type DiffLineType = "context" | "add" | "del" | "empty" | "meta";

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
  rows: DiffRow[];
  additions: number;
  deletions: number;
  language: string;
  isBinary: boolean;
  isUntracked: boolean;
}

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

export function parseGitDiff(diffText: string, options?: { isUntracked?: boolean }): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diffText.split(/\r?\n/);
  let current: FileDiff | null = null;
  let leftCursor: number | null = null;
  let rightCursor: number | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) {
        files.push(current);
      }
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      const path = match?.[2] ?? line.split(" ").slice(-1)[0]?.replace(/^b\//, "") ?? "unknown";
      current = {
        path,
        rows: [],
        additions: 0,
        deletions: 0,
        language: getLanguageFromPath(path),
        isBinary: false,
        isUntracked: options?.isUntracked ?? false,
      };
      leftCursor = null;
      rightCursor = null;
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.isBinary = true;
      continue;
    }

    if (
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from") ||
      line.startsWith("rename to")
    ) {
      continue;
    }

    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }

    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        leftCursor = Number(match[1]);
        rightCursor = Number(match[2]);
      }
      current.rows.push({
        left: { text: line, type: "meta" },
        right: { text: line, type: "meta" },
        leftLine: null,
        rightLine: null,
      });
      continue;
    }

    if (line.startsWith("\\ No newline")) {
      continue;
    }

    if (line.startsWith("+")) {
      current.additions += 1;
      const lineNumber = rightCursor;
      if (rightCursor !== null) {
        rightCursor += 1;
      }
      current.rows.push({
        left: { text: "", type: "empty" },
        right: { text: line.slice(1), type: "add" },
        leftLine: null,
        rightLine: lineNumber,
      });
      continue;
    }

    if (line.startsWith("-")) {
      current.deletions += 1;
      const lineNumber = leftCursor;
      if (leftCursor !== null) {
        leftCursor += 1;
      }
      current.rows.push({
        left: { text: line.slice(1), type: "del" },
        right: { text: "", type: "empty" },
        leftLine: lineNumber,
        rightLine: null,
      });
      continue;
    }

    if (line.startsWith(" ")) {
      const text = line.slice(1);
      const leftLine = leftCursor;
      const rightLine = rightCursor;
      if (leftCursor !== null) {
        leftCursor += 1;
      }
      if (rightCursor !== null) {
        rightCursor += 1;
      }
      current.rows.push({
        left: { text, type: "context" },
        right: { text, type: "context" },
        leftLine,
        rightLine,
      });
    }
  }

  if (current) {
    files.push(current);
  }

  return files;
}

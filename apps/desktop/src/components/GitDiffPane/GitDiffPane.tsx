import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-css";
import "prismjs/components/prism-go";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import type { Session } from "../../types";
import { getLanguageFromPath, parseGitDiff, type DiffLineType } from "../../utils/gitDiff";
import styles from "./GitDiffPane.module.css";

interface GitDiffPaneProps {
  session?: Session | null;
  isActive: boolean;
}

interface GitDiffPayload {
  diff: string;
  untracked: Array<{ path: string; diff: string }>;
}

const emptyCell = { __html: "&nbsp;" };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getLineHtml(text: string, language: string, plain = false) {
  if (!text) {
    return emptyCell;
  }
  if (plain) {
    return { __html: escapeHtml(text) };
  }
  const grammar = Prism.languages[language];
  if (grammar) {
    return { __html: Prism.highlight(text, grammar, language) };
  }
  return { __html: escapeHtml(text) };
}

function getCellClass(type: DiffLineType) {
  switch (type) {
    case "add":
      return styles.diffCellAdd;
    case "del":
      return styles.diffCellDel;
    case "meta":
      return styles.diffCellMeta;
    case "empty":
      return styles.diffCellEmpty;
    default:
      return "";
  }
}

function getGutterClass(type: DiffLineType) {
  switch (type) {
    case "add":
      return styles.diffGutterAdd;
    case "del":
      return styles.diffGutterDel;
    case "meta":
      return styles.diffGutterMeta;
    default:
      return "";
  }
}

export default function GitDiffPane({ session, isActive }: GitDiffPaneProps) {
  const [payload, setPayload] = useState<GitDiffPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState(true);
  const [fileOpenMap, setFileOpenMap] = useState<Record<string, boolean>>({});

  const repoPath = session?.cwd ?? session?.repo.repoPath ?? "";

  const loadDiffs = useCallback(async () => {
    if (!repoPath) {
      setPayload(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const output = await invoke<GitDiffPayload>("get_git_diff", { path: repoPath });
      setPayload(output ?? { diff: "", untracked: [] });
    } catch (err) {
      setPayload(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void loadDiffs();
  }, [isActive, loadDiffs]);

  const files = useMemo(() => {
    const tracked = parseGitDiff(payload?.diff ?? "");
    const untracked = (payload?.untracked ?? []).flatMap((entry) => {
      const parsed = parseGitDiff(entry.diff, { isUntracked: true });
      if (parsed.length === 0) {
        return [
          {
            path: entry.path,
            rows: [],
            additions: 0,
            deletions: 0,
            language: getLanguageFromPath(entry.path),
            isBinary: false,
            isUntracked: true,
          },
        ];
      }
      return parsed.map((file) => ({
        ...file,
        path: entry.path,
        language: getLanguageFromPath(entry.path),
        isUntracked: true,
      }));
    });
    return [...tracked, ...untracked];
  }, [payload]);
  const summary = useMemo(() => {
    const additions = files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    return {
      additions,
      deletions,
      files: files.length,
    };
  }, [files]);

  const showEmptyState = !isLoading && !error && files.length === 0;

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const file of files) {
      next[file.path] = file.isUntracked ? false : true;
    }
    setFileOpenMap(next);
  }, [files]);

  const handleRefreshClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void loadDiffs();
  };

  return (
    <div className={styles.container}>
      <div className={styles.diffSection}>
        <div className={styles.diffSummary}>
          <button
            type="button"
            className={styles.diffSummaryToggle}
            onClick={() => setSectionOpen((prev) => !prev)}
            aria-expanded={sectionOpen}
          >
            <span className={styles.diffSummaryTitle}>Diffs</span>
            <span className={styles.diffSummaryStats}>
              <span className={styles.diffSummaryFiles}>{summary.files} files</span>
              <span className={styles.diffSummaryDot}>•</span>
              <span className={styles.diffSummaryAdd}>+{summary.additions}</span>
              <span className={styles.diffSummarySlash}>/</span>
              <span className={styles.diffSummaryDel}>-{summary.deletions}</span>
            </span>
          </button>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={handleRefreshClick}
            disabled={!repoPath || isLoading}
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            className={styles.diffSummaryChevron}
            onClick={() => setSectionOpen((prev) => !prev)}
            aria-expanded={sectionOpen}
          >
            {sectionOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </button>
        </div>

        {sectionOpen ? (
          <>
            {isLoading ? <div className={styles.state}>Loading diffs…</div> : null}
            {error ? <div className={`${styles.state} ${styles.stateError}`}>{error}</div> : null}
            {showEmptyState ? <div className={styles.state}>No local changes found.</div> : null}

            {!showEmptyState && !isLoading && !error ? (
              <div className={styles.diffList}>
                {files.map((file) => {
                  const isOpen = fileOpenMap[file.path] ?? true;
                  return (
                    <div key={file.path} className={styles.diffFile}>
                      <button
                        type="button"
                        className={`${styles.diffFileHeader} ${file.isUntracked ? styles.diffFileHeaderUntracked : ""}`}
                        onClick={() =>
                          setFileOpenMap((prev) => ({ ...prev, [file.path]: !(prev[file.path] ?? true) }))
                        }
                        aria-expanded={isOpen}
                      >
                        <span className={styles.diffFileName}>{file.path}</span>
                        {file.isUntracked ? <span className={styles.diffBadge}>untracked</span> : null}
                        <span className={styles.diffFileStats}>
                          <span className={styles.diffStatAdd}>+{file.additions}</span>
                          <span className={styles.diffStatDel}>-{file.deletions}</span>
                        </span>
                        <span className={styles.diffFileIcon}>
                          {isOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                        </span>
                      </button>
                      {isOpen ? (
                        <div className={styles.diffGrid}>
                          {file.isBinary ? (
                            <div className={styles.diffRow}>
                              <div className={styles.diffGutter} />
                              <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                                <code className={styles.diffCode}>Binary file changed</code>
                              </div>
                              <div className={styles.diffGutter} />
                              <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                                <code className={styles.diffCode}>Binary file changed</code>
                              </div>
                            </div>
                          ) : file.rows.length === 0 ? (
                            <div className={styles.diffRow}>
                              <div className={styles.diffGutter} />
                              <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                                <code className={styles.diffCode}>No textual diff available</code>
                              </div>
                              <div className={styles.diffGutter} />
                              <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                                <code className={styles.diffCode}>No textual diff available</code>
                              </div>
                            </div>
                          ) : (
                            file.rows.map((row, index) => {
                              const leftClass = `${styles.diffCell} ${getCellClass(row.left.type)}`;
                              const rightClass = `${styles.diffCell} ${getCellClass(row.right.type)}`;
                              const leftGutterClass = `${styles.diffGutter} ${getGutterClass(row.left.type)}`;
                              const rightGutterClass = `${styles.diffGutter} ${getGutterClass(row.right.type)}`;
                              const isMeta = row.left.type === "meta" || row.right.type === "meta";
                              return (
                                <div key={`${file.path}-${index}`} className={styles.diffRow}>
                                  <div className={leftGutterClass}>
                                    {row.leftLine !== null ? row.leftLine : ""}
                                  </div>
                                  <div className={leftClass}>
                                    <code
                                      className={styles.diffCode}
                                      dangerouslySetInnerHTML={getLineHtml(row.left.text, file.language, isMeta)}
                                    />
                                  </div>
                                  <div className={rightGutterClass}>
                                    {row.rightLine !== null ? row.rightLine : ""}
                                  </div>
                                  <div className={rightClass}>
                                    <code
                                      className={styles.diffCode}
                                      dangerouslySetInnerHTML={getLineHtml(row.right.text, file.language, isMeta)}
                                    />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

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
import { getLanguageFromPath, parseGitDiff, type DiffLineType } from "../../../../utils/gitDiff";
import styles from "./GitDiff.module.css";

interface GitDiffProps {
  session?: Session | null;
  isActive: boolean;
}

interface GitDiffPayload {
  staged: string;
  unstaged: string;
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

export default function GitDiff({ session, isActive }: GitDiffProps) {
  const [payload, setPayload] = useState<GitDiffPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
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

  const stagedFiles = useMemo(() => parseGitDiff(payload?.staged ?? ""), [payload]);
  const unstagedTrackedFiles = useMemo(() => parseGitDiff(payload?.unstaged ?? ""), [payload]);
  const untrackedFiles = useMemo(
    () =>
      (payload?.untracked ?? []).flatMap((entry) => {
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
      }),
    [payload]
  );

  const unstagedFiles = useMemo(
    () => [...unstagedTrackedFiles, ...untrackedFiles],
    [unstagedTrackedFiles, untrackedFiles]
  );

  const sections = useMemo(
    () => [
      { key: "staged", title: "Staged Diff", files: stagedFiles },
      { key: "unstaged", title: "Unstaged Diff", files: unstagedFiles },
    ],
    [stagedFiles, unstagedFiles]
  );

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const section of sections) {
      for (const file of section.files) {
        const key = `${section.key}:${file.path}`;
        next[key] = file.isUntracked ? false : true;
      }
    }
    setFileOpenMap(next);
  }, [sections]);

  const handleRefreshClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void loadDiffs();
  };

  return (
    <div className={styles.container}>
      {sections.map((section) => {
        const additions = section.files.reduce((sum, file) => sum + file.additions, 0);
        const deletions = section.files.reduce((sum, file) => sum + file.deletions, 0);
        const isOpen = section.key === "staged" ? stagedOpen : unstagedOpen;
        const setOpen = section.key === "staged" ? setStagedOpen : setUnstagedOpen;
        return (
          <div key={section.key} className={styles.diffSection}>
            <div className={styles.diffSummary}>
              <button
                type="button"
                className={styles.diffSummaryToggle}
                onClick={() => setOpen((prev) => !prev)}
                aria-expanded={isOpen}
              >
                <span className={styles.diffSummaryTitle}>{section.title}</span>
                <span className={styles.diffSummaryStats}>
                  <span className={styles.diffSummaryFiles}>{section.files.length} files</span>
                  <span className={styles.diffSummaryDot}>•</span>
                  <span className={styles.diffSummaryAdd}>+{additions}</span>
                  <span className={styles.diffSummarySlash}>/</span>
                  <span className={styles.diffSummaryDel}>-{deletions}</span>
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
                onClick={() => setOpen((prev) => !prev)}
                aria-expanded={isOpen}
              >
                {isOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </button>
            </div>

            {isOpen ? (
              <>
                {isLoading ? <div className={styles.state}>Loading diffs…</div> : null}
                {error ? <div className={`${styles.state} ${styles.stateError}`}>{error}</div> : null}

                {!isLoading && !error ? (
                  <div className={styles.diffList}>
                    {section.files.length === 0 ? (
                      <div className={styles.state}>No changes.</div>
                    ) : (
                      section.files.map((file) => {
                        const fileKey = `${section.key}:${file.path}`;
                        const isFileOpen = fileOpenMap[fileKey] ?? true;
                        return (
                          <div key={fileKey} className={styles.diffFile}>
                            <button
                              type="button"
                              className={`${styles.diffFileHeader} ${
                                file.isUntracked ? styles.diffFileHeaderUntracked : ""
                              }`}
                              onClick={() =>
                                setFileOpenMap((prev) => ({ ...prev, [fileKey]: !(prev[fileKey] ?? true) }))
                              }
                              aria-expanded={isFileOpen}
                            >
                              <span className={styles.diffFileName}>{file.path}</span>
                              {file.isUntracked ? <span className={styles.diffBadge}>untracked</span> : null}
                              <span className={styles.diffFileStats}>
                                <span className={styles.diffStatAdd}>+{file.additions}</span>
                                <span className={styles.diffStatDel}>-{file.deletions}</span>
                              </span>
                              <span className={styles.diffFileIcon}>
                                {isFileOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                              </span>
                            </button>
                            {isFileOpen ? (
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
                                      <div key={`${fileKey}-${index}`} className={styles.diffRow}>
                                        <div className={leftGutterClass}>
                                          {row.leftLine !== null ? row.leftLine : ""}
                                        </div>
                                        <div className={leftClass}>
                                          <code
                                            className={styles.diffCode}
                                            dangerouslySetInnerHTML={getLineHtml(
                                              row.left.text,
                                              file.language,
                                              isMeta
                                            )}
                                          />
                                        </div>
                                        <div className={rightGutterClass}>
                                          {row.rightLine !== null ? row.rightLine : ""}
                                        </div>
                                        <div className={rightClass}>
                                          <code
                                            className={styles.diffCode}
                                            dangerouslySetInnerHTML={getLineHtml(
                                              row.right.text,
                                              file.language,
                                              isMeta
                                            )}
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
                      })
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

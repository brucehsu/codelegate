import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  getLanguageFromPath,
  shouldHighlightDiff,
  type DiffLineType,
  type FileDiff,
  type GitChangeSummary,
  type GitFileDiffPayload,
} from "../../../../utils/gitDiff";
import CollapsibleSection from "../../../ui/CollapsibleSection/CollapsibleSection";
import styles from "./GitDiff.module.css";

export interface GitFileCardDetailState {
  status: "idle" | "loading" | "ready" | "error";
  data?: GitFileDiffPayload;
  error?: string;
}

interface GitFileCardProps {
  summary: GitChangeSummary;
  fileKey: string;
  isOpen: boolean;
  detailState?: GitFileCardDetailState;
  onToggle: () => void;
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

function getFileLabel(file: Pick<FileDiff, "path" | "oldPath" | "newPath" | "status">) {
  if (file.status === "renamed" && file.oldPath && file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.path;
}

function buildFileDiff(detail?: GitFileDiffPayload): FileDiff | null {
  if (!detail) {
    return null;
  }

  return {
    path: detail.path,
    oldPath: detail.oldPath,
    newPath: detail.newPath,
    rows: detail.rows,
    additions: detail.additions,
    deletions: detail.deletions,
    language: getLanguageFromPath(detail.path),
    isBinary: detail.isBinary,
    isUntracked: detail.isUntracked,
    status: detail.status,
  };
}

export default function GitFileCard({ summary, fileKey, isOpen, detailState, onToggle }: GitFileCardProps) {
  const [selectionColumn, setSelectionColumn] = useState<"left" | "right" | null>(null);

  const clearSelectionColumn = useCallback(() => {
    setSelectionColumn(null);
  }, []);

  useEffect(() => {
    if (!selectionColumn) {
      return;
    }
    window.addEventListener("pointerup", clearSelectionColumn);
    window.addEventListener("blur", clearSelectionColumn);
    return () => {
      window.removeEventListener("pointerup", clearSelectionColumn);
      window.removeEventListener("blur", clearSelectionColumn);
    };
  }, [clearSelectionColumn, selectionColumn]);

  const handleColumnPointerDown = useCallback((column: "left" | "right") => {
    setSelectionColumn(column);
  }, []);

  const diffGridClass = [
    styles.diffGrid,
    selectionColumn === "left" ? styles.diffGridSelectingLeft : "",
    selectionColumn === "right" ? styles.diffGridSelectingRight : "",
  ]
    .filter(Boolean)
    .join(" ");

  const file = useMemo(() => buildFileDiff(detailState?.data), [detailState?.data]);
  const shouldHighlight = useMemo(
    () => shouldHighlightDiff(summary.path, summary.changedLineCount),
    [summary.changedLineCount, summary.path]
  );
  const displayFile = file ?? {
    path: summary.path,
    oldPath: summary.oldPath,
    newPath: summary.newPath,
    status: summary.status,
  };

  return (
    <div className={styles.diffFile}>
      <CollapsibleSection
        className={styles.diffFileSection}
        title={
          <>
            <span className={styles.diffFileName}>{getFileLabel(displayFile)}</span>
            {summary.isUntracked ? <span className={styles.diffBadge}>untracked</span> : null}
            {!summary.isUntracked && summary.status === "deleted" ? (
              <span className={`${styles.diffBadge} ${styles.diffBadgeDeleted}`}>deleted</span>
            ) : null}
            {!summary.isUntracked && summary.status === "renamed" ? (
              <span className={`${styles.diffBadge} ${styles.diffBadgeRenamed}`}>renamed</span>
            ) : null}
            <span className={styles.diffFileStats}>
              <span className={styles.diffStatAdd}>+{summary.additions}</span>
              <span className={styles.diffStatDel}>-{summary.deletions}</span>
            </span>
          </>
        }
        isOpen={isOpen}
        onToggle={onToggle}
        headerClassName={`${styles.diffFileHeader} ${summary.isUntracked ? styles.diffFileHeaderUntracked : ""}`}
        toggleClassName={styles.diffFileToggle}
        titleClassName={styles.diffFileTitle}
        chevronClassName={styles.diffFileIcon}
        bodyClassName={diffGridClass}
      >
        {detailState?.status === "loading" ? (
          <div className={styles.state}>Loading diff…</div>
        ) : detailState?.status === "error" ? (
          <div className={`${styles.state} ${styles.stateError}`}>{detailState.error ?? "Unable to load diff."}</div>
        ) : file?.isBinary ? (
          <>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnLeft}`}
              onPointerDownCapture={() => handleColumnPointerDown("left")}
            >
              <div className={styles.diffColumnBody}>
                <div className={styles.diffColumnRow}>
                  <div className={styles.diffGutter} />
                  <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                    <code className={styles.diffCode}>Binary file changed</code>
                  </div>
                </div>
              </div>
            </div>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnRight}`}
              onPointerDownCapture={() => handleColumnPointerDown("right")}
            >
              <div className={styles.diffColumnBody}>
                <div className={styles.diffColumnRow}>
                  <div className={styles.diffGutter} />
                  <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                    <code className={styles.diffCode}>Binary file changed</code>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : file && file.rows.length === 0 ? (
          <>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnLeft}`}
              onPointerDownCapture={() => handleColumnPointerDown("left")}
            >
              <div className={styles.diffColumnBody}>
                <div className={styles.diffColumnRow}>
                  <div className={styles.diffGutter} />
                  <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                    <code className={styles.diffCode}>No textual diff available</code>
                  </div>
                </div>
              </div>
            </div>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnRight}`}
              onPointerDownCapture={() => handleColumnPointerDown("right")}
            >
              <div className={styles.diffColumnBody}>
                <div className={styles.diffColumnRow}>
                  <div className={styles.diffGutter} />
                  <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                    <code className={styles.diffCode}>No textual diff available</code>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : file ? (
          <>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnLeft}`}
              onPointerDownCapture={() => handleColumnPointerDown("left")}
            >
              <div className={styles.diffColumnBody}>
                {file.rows.map((row, index) => {
                  const cellClass = `${styles.diffCell} ${getCellClass(row.left.type)}`;
                  const gutterClass = `${styles.diffGutter} ${getGutterClass(row.left.type)}`;
                  const usePlainText =
                    row.left.type === "meta" || row.right.type === "meta" || !shouldHighlight;
                  return (
                    <div key={`${fileKey}-left-${index}`} className={styles.diffColumnRow}>
                      <div className={gutterClass}>{row.leftLine !== null ? row.leftLine : ""}</div>
                      <div className={cellClass}>
                        <code
                          className={styles.diffCode}
                          dangerouslySetInnerHTML={getLineHtml(row.left.text, file.language, usePlainText)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnRight}`}
              onPointerDownCapture={() => handleColumnPointerDown("right")}
            >
              <div className={styles.diffColumnBody}>
                {file.rows.map((row, index) => {
                  const cellClass = `${styles.diffCell} ${getCellClass(row.right.type)}`;
                  const gutterClass = `${styles.diffGutter} ${getGutterClass(row.right.type)}`;
                  const usePlainText =
                    row.left.type === "meta" || row.right.type === "meta" || !shouldHighlight;
                  return (
                    <div key={`${fileKey}-right-${index}`} className={styles.diffColumnRow}>
                      <div className={gutterClass}>{row.rightLine !== null ? row.rightLine : ""}</div>
                      <div className={cellClass}>
                        <code
                          className={styles.diffCode}
                          dangerouslySetInnerHTML={getLineHtml(row.right.text, file.language, usePlainText)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className={styles.state}>Diff will load when expanded.</div>
        )}
      </CollapsibleSection>
    </div>
  );
}

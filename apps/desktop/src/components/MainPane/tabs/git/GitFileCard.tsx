import { useCallback, useEffect, useState } from "react";
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
import type { DiffLineType, FileDiff } from "../../../../utils/gitDiff";
import CollapsibleSection from "../../../ui/CollapsibleSection/CollapsibleSection";
import styles from "./GitDiff.module.css";

interface GitFileCardProps {
  file: FileDiff;
  fileKey: string;
  isOpen: boolean;
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

function getFileLabel(file: FileDiff) {
  if (file.status === "renamed" && file.oldPath && file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.path;
}

export default function GitFileCard({ file, fileKey, isOpen, onToggle }: GitFileCardProps) {
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

  return (
    <div className={styles.diffFile}>
      <CollapsibleSection
        className={styles.diffFileSection}
        title={
          <>
            <span className={styles.diffFileName}>{getFileLabel(file)}</span>
            {file.isUntracked ? <span className={styles.diffBadge}>untracked</span> : null}
            {!file.isUntracked && file.status === "deleted" ? (
              <span className={`${styles.diffBadge} ${styles.diffBadgeDeleted}`}>deleted</span>
            ) : null}
            {!file.isUntracked && file.status === "renamed" ? (
              <span className={`${styles.diffBadge} ${styles.diffBadgeRenamed}`}>renamed</span>
            ) : null}
            <span className={styles.diffFileStats}>
              <span className={styles.diffStatAdd}>+{file.additions}</span>
              <span className={styles.diffStatDel}>-{file.deletions}</span>
            </span>
          </>
        }
        isOpen={isOpen}
        onToggle={onToggle}
        headerClassName={`${styles.diffFileHeader} ${file.isUntracked ? styles.diffFileHeaderUntracked : ""}`}
        toggleClassName={styles.diffFileToggle}
        titleClassName={styles.diffFileTitle}
        chevronClassName={styles.diffFileIcon}
        bodyClassName={diffGridClass}
      >
        {file.isBinary ? (
          <>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnLeft}`}
              onPointerDownCapture={() => handleColumnPointerDown("left")}
            >
              <div className={styles.diffColumnRow}>
                <div className={styles.diffGutter} />
                <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                  <code className={styles.diffCode}>Binary file changed</code>
                </div>
              </div>
            </div>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnRight}`}
              onPointerDownCapture={() => handleColumnPointerDown("right")}
            >
              <div className={styles.diffColumnRow}>
                <div className={styles.diffGutter} />
                <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                  <code className={styles.diffCode}>Binary file changed</code>
                </div>
              </div>
            </div>
          </>
        ) : file.rows.length === 0 ? (
          <>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnLeft}`}
              onPointerDownCapture={() => handleColumnPointerDown("left")}
            >
              <div className={styles.diffColumnRow}>
                <div className={styles.diffGutter} />
                <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                  <code className={styles.diffCode}>No textual diff available</code>
                </div>
              </div>
            </div>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnRight}`}
              onPointerDownCapture={() => handleColumnPointerDown("right")}
            >
              <div className={styles.diffColumnRow}>
                <div className={styles.diffGutter} />
                <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                  <code className={styles.diffCode}>No textual diff available</code>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnLeft}`}
              onPointerDownCapture={() => handleColumnPointerDown("left")}
            >
              {file.rows.map((row, index) => {
                const cellClass = `${styles.diffCell} ${getCellClass(row.left.type)}`;
                const gutterClass = `${styles.diffGutter} ${getGutterClass(row.left.type)}`;
                const isMeta = row.left.type === "meta" || row.right.type === "meta";
                return (
                  <div key={`${fileKey}-left-${index}`} className={styles.diffColumnRow}>
                    <div className={gutterClass}>{row.leftLine !== null ? row.leftLine : ""}</div>
                    <div className={cellClass}>
                      <code
                        className={styles.diffCode}
                        dangerouslySetInnerHTML={getLineHtml(row.left.text, file.language, isMeta)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              className={`${styles.diffColumn} ${styles.diffColumnRight}`}
              onPointerDownCapture={() => handleColumnPointerDown("right")}
            >
              {file.rows.map((row, index) => {
                const cellClass = `${styles.diffCell} ${getCellClass(row.right.type)}`;
                const gutterClass = `${styles.diffGutter} ${getGutterClass(row.right.type)}`;
                const isMeta = row.left.type === "meta" || row.right.type === "meta";
                return (
                  <div key={`${fileKey}-right-${index}`} className={styles.diffColumnRow}>
                    <div className={gutterClass}>{row.rightLine !== null ? row.rightLine : ""}</div>
                    <div className={cellClass}>
                      <code
                        className={styles.diffCode}
                        dangerouslySetInnerHTML={getLineHtml(row.right.text, file.language, isMeta)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CollapsibleSection>
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { flushSync } from "react-dom";
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
  type DiffCell,
  type DiffLineType,
  type FileDiff,
  type GitChangeSummary,
  type GitDiffSection,
  type GitFileDiffPayload,
} from "../../../../utils/gitDiff";
import ActionButton from "../../../ui/ActionButton/ActionButton";
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
  section: GitDiffSection;
  viewMode?: "split" | "unified";
  actionDisabled?: boolean;
  actionLoading?: boolean;
  isSelected?: boolean;
  getScrollElement?: () => HTMLElement | null;
  onFileAction: () => void;
}

const emptyCell = { __html: "&nbsp;" };
const DIFF_ROW_HEIGHT = 30;
const DIFF_ROW_OVERSCAN = 12;
const DIFF_VIRTUALIZE_THRESHOLD = 120;

interface UnifiedDiffRow {
  oldLine: number | null;
  newLine: number | null;
  cell: DiffCell;
}

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
    isDirectory: detail.isDirectory,
    isUntracked: detail.isUntracked,
    status: detail.status,
    truncated: detail.truncated,
  };
}

function isRenderableDiffCell(cell: DiffCell) {
  return cell.type !== "empty" || cell.text.length > 0;
}

function buildUnifiedDiffRows(rows: FileDiff["rows"]) {
  const unifiedRows: UnifiedDiffRow[] = [];

  for (const row of rows) {
    const leftRenderable = isRenderableDiffCell(row.left);
    const rightRenderable = isRenderableDiffCell(row.right);

    if (!leftRenderable && !rightRenderable) {
      continue;
    }

    if (leftRenderable && rightRenderable && row.left.type === row.right.type && row.left.text === row.right.text) {
      unifiedRows.push({
        oldLine: row.leftLine,
        newLine: row.rightLine,
        cell: row.left,
      });
      continue;
    }

    if (leftRenderable) {
      unifiedRows.push({
        oldLine: row.leftLine,
        newLine: row.left.type === "context" ? row.rightLine : null,
        cell: row.left,
      });
    }

    if (rightRenderable) {
      unifiedRows.push({
        oldLine: row.right.type === "context" ? row.leftLine : null,
        newLine: row.rightLine,
        cell: row.right,
      });
    }
  }

  return unifiedRows;
}

export default function GitFileCard({
  summary,
  fileKey,
  isOpen,
  detailState,
  onToggle,
  section,
  viewMode = "split",
  actionDisabled = false,
  actionLoading = false,
  isSelected = false,
  getScrollElement,
  onFileAction,
}: GitFileCardProps) {
  const [selectionColumn, setSelectionColumn] = useState<"left" | "right" | null>(null);
  const [selectionFullRender, setSelectionFullRender] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const rowsSurfaceRef = useRef<HTMLDivElement | null>(null);
  const lineHtmlCacheRef = useRef<Map<string, { __html: string }>>(new Map());

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

  useEffect(() => {
    lineHtmlCacheRef.current.clear();
  }, [detailState?.data?.path, detailState?.data?.rows, summary.path, summary.changedLineCount]);

  useEffect(() => {
    if (!isOpen) {
      setSelectionFullRender(false);
    }
  }, [isOpen, detailState?.data?.path, detailState?.data?.rows]);

  useEffect(() => {
    setSelectionColumn(null);
  }, [viewMode]);

  const handleColumnPointerDown = useCallback((column: "left" | "right") => {
    setSelectionColumn(column);
  }, []);

  const enableSelectionFullRender = useCallback(() => {
    flushSync(() => {
      setSelectionFullRender(true);
    });
  }, []);

  const selectionClass =
    selectionColumn === "left"
      ? styles.diffGridSelectingLeft
      : selectionColumn === "right"
        ? styles.diffGridSelectingRight
        : "";

  const file = useMemo(() => buildFileDiff(detailState?.data), [detailState?.data]);
  const unifiedRows = useMemo(() => (file ? buildUnifiedDiffRows(file.rows) : []), [file]);
  const renderedRowCount = viewMode === "unified" ? unifiedRows.length : (file?.rows.length ?? 0);
  const shouldHighlight = useMemo(
    () => shouldHighlightDiff(summary.path, summary.changedLineCount),
    [summary.changedLineCount, summary.path]
  );
  const shouldVirtualize = Boolean(
    file && !file.isBinary && renderedRowCount > DIFF_VIRTUALIZE_THRESHOLD && !selectionFullRender
  );
  const rowVirtualizer = useVirtualizer({
    count: renderedRowCount,
    getScrollElement: () => getScrollElement?.() ?? rowsSurfaceRef.current,
    estimateSize: () => DIFF_ROW_HEIGHT,
    overscan: DIFF_ROW_OVERSCAN,
    scrollMargin,
  });
  const virtualRows = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];
  const displayFile = file ?? {
    path: summary.path,
    oldPath: summary.oldPath,
    newPath: summary.newPath,
    status: summary.status,
  };

  useLayoutEffect(() => {
    if (!shouldVirtualize || !getScrollElement) {
      setScrollMargin(0);
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    let frameId: number | null = null;

    const updateScrollMargin = () => {
      const surface = rowsSurfaceRef.current;
      const scrollElement = getScrollElement();
      if (!surface || !scrollElement) {
        return;
      }
      const nextMargin =
        surface.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
      setScrollMargin(nextMargin);
    };

    updateScrollMargin();
    frameId = window.requestAnimationFrame(updateScrollMargin);
    window.addEventListener("resize", updateScrollMargin);

    if (typeof ResizeObserver !== "undefined") {
      const surface = rowsSurfaceRef.current;
      const scrollElement = getScrollElement();
      resizeObserver = new ResizeObserver(updateScrollMargin);
      if (surface) {
        resizeObserver.observe(surface);
      }
      if (scrollElement) {
        resizeObserver.observe(scrollElement);
        if (scrollElement.firstElementChild) {
          resizeObserver.observe(scrollElement.firstElementChild);
        }
      }
    }

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScrollMargin);
    };
  }, [getScrollElement, shouldVirtualize]);

  const renderColumnRow = useCallback(
    (
      row: FileDiff["rows"][number],
      index: number,
      side: "left" | "right",
      style?: CSSProperties
    ) => {
      const isLeft = side === "left";
      const cell = isLeft ? row.left : row.right;
      const lineNumber = isLeft ? row.leftLine : row.rightLine;
      const usePlainText = row.left.type === "meta" || row.right.type === "meta" || !shouldHighlight;
      const cellClass = `${styles.diffCell} ${getCellClass(cell.type)}`;
      const gutterClass = `${styles.diffGutter} ${getGutterClass(cell.type)}`;
      const cacheKey = `${file?.language ?? "text"}:${usePlainText ? "plain" : "highlight"}:${cell.text}`;
      let lineHtml = lineHtmlCacheRef.current.get(cacheKey);
      if (!lineHtml) {
        lineHtml = getLineHtml(cell.text, file?.language ?? "text", usePlainText);
        lineHtmlCacheRef.current.set(cacheKey, lineHtml);
      }

      return (
        <div key={`${fileKey}-${side}-${index}`} className={styles.diffColumnRow} style={style}>
          <div className={gutterClass} onPointerDownCapture={() => handleColumnPointerDown(side)}>
            {lineNumber !== null ? lineNumber : ""}
          </div>
          <div className={cellClass} onPointerDownCapture={() => handleColumnPointerDown(side)}>
            <code
              className={`${styles.diffCode} ${isLeft ? styles.diffCodeLeft : styles.diffCodeRight}`}
              dangerouslySetInnerHTML={lineHtml}
            />
          </div>
        </div>
      );
    },
    [file?.language, fileKey, handleColumnPointerDown, shouldHighlight]
  );

  const renderUnifiedRow = useCallback(
    (row: UnifiedDiffRow, index: number, style?: CSSProperties) => {
      const usePlainText = row.cell.type === "meta" || !shouldHighlight;
      const cellClass = `${styles.diffCell} ${styles.diffUnifiedCell} ${getCellClass(row.cell.type)}`;
      const gutterClass = `${styles.diffGutter} ${styles.diffUnifiedGutter} ${getGutterClass(row.cell.type)}`;
      const cacheKey = `${file?.language ?? "text"}:${usePlainText ? "plain" : "highlight"}:${row.cell.text}`;
      let lineHtml = lineHtmlCacheRef.current.get(cacheKey);
      if (!lineHtml) {
        lineHtml = getLineHtml(row.cell.text, file?.language ?? "text", usePlainText);
        lineHtmlCacheRef.current.set(cacheKey, lineHtml);
      }

      return (
        <div key={`${fileKey}-unified-${index}`} className={styles.diffUnifiedRow} style={style}>
          <div className={gutterClass}>{row.oldLine !== null ? row.oldLine : ""}</div>
          <div className={gutterClass}>{row.newLine !== null ? row.newLine : ""}</div>
          <div className={cellClass}>
            <code
              className={`${styles.diffCode} ${styles.diffCodeUnified}`}
              dangerouslySetInnerHTML={lineHtml}
            />
          </div>
        </div>
      );
    },
    [file?.language, fileKey, shouldHighlight]
  );

  const renderPlaceholderDiff = (message: string) => {
    if (viewMode === "unified") {
      return (
        <div className={styles.diffUnifiedGrid}>
          <div className={styles.diffUnifiedBody}>
            <div className={styles.diffUnifiedRow}>
              <div className={`${styles.diffGutter} ${styles.diffUnifiedGutter}`} />
              <div className={`${styles.diffGutter} ${styles.diffUnifiedGutter}`} />
              <div className={`${styles.diffCell} ${styles.diffCellMeta} ${styles.diffUnifiedCell}`}>
                <code className={styles.diffCode}>{message}</code>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={[styles.diffGrid, selectionClass].filter(Boolean).join(" ")}>
        <div
          className={`${styles.diffColumn} ${styles.diffColumnLeft}`}
          onPointerDownCapture={() => handleColumnPointerDown("left")}
        >
          <div className={styles.diffColumnBody}>
            <div className={styles.diffColumnRow}>
              <div className={styles.diffGutter} />
              <div className={`${styles.diffCell} ${styles.diffCellMeta}`}>
                <code className={styles.diffCode}>{message}</code>
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
                <code className={styles.diffCode}>{message}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`${styles.diffFile} ${isSelected ? styles.diffFileSelected : ""}`}>
      <CollapsibleSection
        className={styles.diffFileSection}
        title={
          <>
            <span className={styles.diffFileName}>{getFileLabel(displayFile)}</span>
            {summary.isUntracked ? <span className={styles.diffBadge}>untracked</span> : null}
            {summary.isDirectory ? <span className={styles.diffBadge}>directory</span> : null}
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
        bodyClassName={styles.diffBody}
        actionsClassName={styles.diffFileActions}
        actions={
          <ActionButton
            className={styles.diffFileActionButton}
            onClick={(event) => {
              event.stopPropagation();
              onFileAction();
            }}
            disabled={actionDisabled || actionLoading}
          >
            {actionLoading ? "Working..." : section === "staged" ? "Unstage" : "Stage"}
          </ActionButton>
        }
      >
        {detailState?.status === "loading" ? (
          <div className={styles.state}>Loading diff…</div>
        ) : detailState?.status === "error" ? (
          <div className={`${styles.state} ${styles.stateError}`}>{detailState.error ?? "Unable to load diff."}</div>
        ) : file?.isDirectory ? (
          renderPlaceholderDiff("Directory preview is not available")
        ) : file?.isBinary ? (
          renderPlaceholderDiff("Binary file changed")
        ) : file && file.rows.length === 0 ? (
          renderPlaceholderDiff("No textual diff available")
        ) : file ? (
          <div
            ref={rowsSurfaceRef}
            tabIndex={0}
            className={[styles.diffRowsSurface, selectionClass].filter(Boolean).join(" ")}
            onPointerDownCapture={() => {
              if (shouldVirtualize) {
                enableSelectionFullRender();
              }
            }}
            onKeyDownCapture={(event) => {
              if (shouldVirtualize && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
                enableSelectionFullRender();
              }
            }}
          >
            {shouldVirtualize ? (
              viewMode === "unified" ? (
                <div className={styles.diffUnifiedGrid}>
                  <div
                    className={styles.diffVirtualInner}
                    style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                  >
                    {virtualRows.map((virtualRow) => {
                      const row = unifiedRows[virtualRow.index];
                      return row
                        ? renderUnifiedRow(row, virtualRow.index, {
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                          })
                        : null;
                    })}
                  </div>
                </div>
              ) : (
                <div className={styles.diffGrid}>
                  <div className={`${styles.diffColumn} ${styles.diffColumnLeft}`}>
                    <div
                      className={styles.diffVirtualInner}
                      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                    >
                      {virtualRows.map((virtualRow) =>
                        renderColumnRow(file.rows[virtualRow.index], virtualRow.index, "left", {
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                        })
                      )}
                    </div>
                  </div>
                  <div className={`${styles.diffColumn} ${styles.diffColumnRight}`}>
                    <div
                      className={styles.diffVirtualInner}
                      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                    >
                      {virtualRows.map((virtualRow) =>
                        renderColumnRow(file.rows[virtualRow.index], virtualRow.index, "right", {
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                        })
                      )}
                    </div>
                  </div>
                </div>
              )
            ) : (
              viewMode === "unified" ? (
                <div className={styles.diffUnifiedGrid}>
                  <div className={styles.diffUnifiedBody}>
                    {unifiedRows.map((row, index) => renderUnifiedRow(row, index))}
                  </div>
                </div>
              ) : (
                <div className={styles.diffGrid}>
                  <div className={`${styles.diffColumn} ${styles.diffColumnLeft}`}>
                    <div className={styles.diffColumnBody}>
                      {file.rows.map((row, index) => renderColumnRow(row, index, "left"))}
                    </div>
                  </div>
                  <div className={`${styles.diffColumn} ${styles.diffColumnRight}`}>
                    <div className={styles.diffColumnBody}>
                      {file.rows.map((row, index) => renderColumnRow(row, index, "right"))}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <div className={styles.state}>Diff will load when expanded.</div>
        )}
        {file?.truncated ? (
          <div className={styles.diffTruncatedNotice}>
            Diff truncated. Showing the first {file.rows.length} rows.
          </div>
        ) : null}
      </CollapsibleSection>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { ChevronDown, RefreshCw } from "lucide-react";
import Button from "../../../ui/Button/Button";
import ActionButton from "../../../ui/ActionButton/ActionButton";
import type { Session, ToastInput } from "../../../../types";
import {
  type GitChangeSummary,
  type GitChangeSummaryPayload,
  type GitDiffSection,
  type GitFileDiffPayload,
} from "../../../../utils/gitDiff";
import { defineHotkey, runHotkeys } from "../../../../utils/hotkeys";
import { buildShortcutCombo } from "../../../../utils/shortcutModifier";
import GitFileCard, { type GitFileCardDetailState } from "./GitFileCard";
import styles from "./GitDiff.module.css";

const nonTextInputTypes = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const EMPTY_SUMMARY: GitChangeSummaryPayload = { staged: [], unstaged: [] };
const AUTO_OPEN_LIMIT = 10;
const LARGE_DIFF_THRESHOLD = 250;
const CHANGE_TREE_MIN_WIDTH = 250;
const CHANGE_TREE_DEFAULT_WIDTH = 320;
const CHANGE_TREE_MAX_WIDTH_RATIO = 0.4;
const DIFF_PANEL_MIN_WIDTH = 320;
const CHANGE_TREE_RESIZE_HANDLE_WIDTH = 8;
const CHANGE_TREE_UNSAFE_CSS = `
  :host,
  [data-file-tree-virtualized-wrapper='true'],
  [data-file-tree-virtualized-root='true'],
  [data-file-tree-virtualized-scroll='true'] {
    background: var(--trees-bg);
    color: var(--trees-fg);
    font-family: var(--trees-font-family);
  }

  [data-file-tree-search-container] {
    box-sizing: border-box;
    padding: 12px 12px 4px;
    margin-bottom: 4px;
    background: var(--trees-bg);
  }

  [data-file-tree-search-input] {
    box-sizing: border-box;
    height: 34px;
    padding-inline: 12px;
    line-height: 32px;
    border-color: var(--trees-border-color);
    border-radius: 10px;
    background: var(--trees-search-bg);
    color: var(--trees-search-fg);
    font-weight: var(--trees-font-weight-regular);
  }

  [data-file-tree-search-input]:focus-visible,
  [data-file-tree-search-input][data-file-tree-search-input-fake-focus='true'] {
    outline: none;
    border-color: var(--trees-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--trees-accent) 18%, transparent);
  }

  [role='tree'] {
    background: var(--trees-bg);
    color: var(--trees-fg);
    padding-bottom: 8px;
  }

  [data-type='item'] {
    background: transparent;
    color: var(--trees-fg);
    font-weight: var(--trees-font-weight-regular);
  }

  [data-type='item']:hover,
  [data-type='item'][data-item-context-hover='true'] {
    background: var(--trees-bg-muted);
  }

  [data-type='item'][data-item-selected='true'] {
    background: var(--trees-selected-bg);
    color: var(--trees-selected-fg);
  }

  [data-item-section='icon'] {
    color: var(--trees-fg-muted);
  }
`;
const CHANGE_TREE_STYLE: CSSProperties & Record<string, string | number> = {
  backgroundColor: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--text)",
  colorScheme: "inherit",
  font: "inherit",
  "--trees-bg-override": "var(--surface)",
  "--trees-fg-override": "var(--text)",
  "--trees-fg-muted-override": "var(--muted)",
  "--trees-bg-muted-override": "color-mix(in srgb, var(--surface-2) 72%, var(--surface))",
  "--trees-border-color-override": "var(--border)",
  "--trees-accent-override": "var(--accent)",
  "--trees-focus-ring-color-override": "var(--accent)",
  "--trees-focus-ring-offset-override": 0,
  "--trees-input-bg-override": "var(--bg-soft)",
  "--trees-selected-bg-override": "color-mix(in srgb, var(--accent) 14%, var(--surface-2))",
  "--trees-selected-fg-override": "var(--text)",
  "--trees-selected-focused-border-color-override": "var(--accent)",
  "--trees-scrollbar-thumb-override": "color-mix(in srgb, var(--muted) 28%, var(--surface))",
  "--trees-indent-guide-bg-override": "color-mix(in srgb, var(--muted) 20%, transparent)",
  "--trees-status-added-override": "#22c55e",
  "--trees-status-untracked-override": "#22c55e",
  "--trees-status-modified-override": "#3b82f6",
  "--trees-status-deleted-override": "#ef4444",
  "--trees-git-added-color-override": "#22c55e",
  "--trees-git-untracked-color-override": "#22c55e",
  "--trees-git-modified-color-override": "#3b82f6",
  "--trees-git-deleted-color-override": "#ef4444",
  "--trees-search-bg-override": "var(--bg-soft)",
  "--trees-search-fg-override": "var(--text)",
  "--trees-search-font-weight-override": 400,
  "--trees-file-icon-color": "var(--muted)",
  "--trees-border-radius-override": "10px",
  "--trees-font-family-override": '"Space Grotesk", "Avenir Next", "Segoe UI", sans-serif',
  "--trees-font-size-override": "0.85rem",
  "--trees-font-weight-regular-override": 400,
  "--trees-font-weight-semibold-override": 600,
  "--trees-item-margin-x-override": "6px",
  "--trees-padding-inline-override": "10px",
};

function isTextInputElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target.closest("[contenteditable]:not([contenteditable='false'])")) {
    return true;
  }
  const formField = target.closest("input, textarea, select, [role='textbox'], [role='searchbox']");
  if (!(formField instanceof HTMLElement)) {
    return false;
  }
  if (formField instanceof HTMLInputElement) {
    return !nonTextInputTypes.has((formField.type || "text").toLowerCase());
  }
  return true;
}

function isTextInputEvent(event: KeyboardEvent) {
  if (isTextInputElement(event.target)) {
    return true;
  }
  return event.composedPath().some((target) => isTextInputElement(target));
}

function buildInitialFileOpenMap(summary: GitChangeSummaryPayload) {
  const next: Record<string, boolean> = {};
  const sections: Array<{ key: GitDiffSection; files: GitChangeSummary[] }> = [
    { key: "staged", files: summary.staged },
    { key: "unstaged", files: summary.unstaged },
  ];

  for (const section of sections) {
    let autoOpened = 0;
    for (const file of section.files) {
      const key = `${section.key}:${file.path}`;
      const shouldAutoOpen =
        autoOpened < AUTO_OPEN_LIMIT &&
        file.changedLineCount <= LARGE_DIFF_THRESHOLD &&
        !file.isBinary &&
        !file.isDirectory;
      next[key] = shouldAutoOpen;
      if (shouldAutoOpen) {
        autoOpened += 1;
      }
    }
  }

  return next;
}

function mapGitStatus(file: GitChangeSummary): GitStatusEntry["status"] {
  if (file.isUntracked) {
    return "untracked";
  }
  return file.status;
}

function summaryEntryKey(section: GitDiffSection, file: GitChangeSummary) {
  return `${section}:${file.path}`;
}

function buildSummaryEntryMap(summary: GitChangeSummaryPayload) {
  const entries = new Map<string, GitChangeSummary>();
  for (const file of summary.staged) {
    entries.set(summaryEntryKey("staged", file), file);
  }
  for (const file of summary.unstaged) {
    entries.set(summaryEntryKey("unstaged", file), file);
  }
  return entries;
}

function summariesMatch(left: GitChangeSummary, right: GitChangeSummary) {
  return (
    left.path === right.path &&
    left.oldPath === right.oldPath &&
    left.newPath === right.newPath &&
    left.additions === right.additions &&
    left.deletions === right.deletions &&
    left.changedLineCount === right.changedLineCount &&
    left.isBinary === right.isBinary &&
    left.isDirectory === right.isDirectory &&
    left.isUntracked === right.isUntracked &&
    left.status === right.status
  );
}

function collectChangedSummaryKeys(previous: GitChangeSummaryPayload, next: GitChangeSummaryPayload) {
  const previousEntries = buildSummaryEntryMap(previous);
  const nextEntries = buildSummaryEntryMap(next);
  const changedKeys = new Set<string>();

  for (const [key, previousFile] of previousEntries) {
    const nextFile = nextEntries.get(key);
    if (!nextFile || !summariesMatch(previousFile, nextFile)) {
      changedKeys.add(key);
    }
  }

  for (const [key, nextFile] of nextEntries) {
    const previousFile = previousEntries.get(key);
    if (!previousFile || !summariesMatch(previousFile, nextFile)) {
      changedKeys.add(key);
    }
  }

  return changedKeys;
}

function collectSummaryKeys(summary: GitChangeSummaryPayload) {
  return new Set(buildSummaryEntryMap(summary).keys());
}

interface ScrollSnapshot {
  top: number;
  anchorKey: string | null;
  anchorOffset: number;
}

function captureScrollSnapshot(scrollElement: HTMLElement | null): ScrollSnapshot | null {
  if (!scrollElement) {
    return null;
  }

  const scrollRect = scrollElement.getBoundingClientRect();
  const anchors = scrollElement.querySelectorAll<HTMLElement>("[data-file-key]");
  for (const anchor of anchors) {
    const anchorRect = anchor.getBoundingClientRect();
    if (anchorRect.bottom > scrollRect.top && anchorRect.top < scrollRect.bottom) {
      return {
        top: scrollElement.scrollTop,
        anchorKey: anchor.dataset.fileKey ?? null,
        anchorOffset: anchorRect.top - scrollRect.top,
      };
    }
  }

  return { top: scrollElement.scrollTop, anchorKey: null, anchorOffset: 0 };
}

function restoreScrollSnapshot(scrollElement: HTMLElement | null, snapshot: ScrollSnapshot | null) {
  if (!scrollElement || !snapshot) {
    return;
  }

  if (snapshot.anchorKey) {
    const anchor = Array.from(scrollElement.querySelectorAll<HTMLElement>("[data-file-key]")).find(
      (element) => element.dataset.fileKey === snapshot.anchorKey
    );
    if (anchor) {
      const scrollRect = scrollElement.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      scrollElement.scrollTop += anchorRect.top - scrollRect.top - snapshot.anchorOffset;
      return;
    }
  }

  scrollElement.scrollTop = snapshot.top;
}

function getSectionStats(files: GitChangeSummary[]) {
  return files.reduce(
    (stats, file) => ({
      additions: stats.additions + file.additions,
      deletions: stats.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 }
  );
}

function isDigitCode(code: number) {
  return code >= 48 && code <= 57;
}

function splitNaturalTokens(value: string) {
  const tokens: Array<string | number> = [];
  let tokenStart = 0;
  let index = 0;
  while (index < value.length) {
    while (index < value.length && !isDigitCode(value.charCodeAt(index))) {
      index += 1;
    }
    if (index >= value.length) {
      break;
    }
    if (index > tokenStart) {
      tokens.push(value.slice(tokenStart, index));
    }
    let numericValue = 0;
    while (index < value.length && isDigitCode(value.charCodeAt(index))) {
      numericValue = numericValue * 10 + (value.charCodeAt(index) - 48);
      index += 1;
    }
    tokens.push(numericValue);
    tokenStart = index;
  }
  if (tokenStart < value.length || tokens.length === 0) {
    tokens.push(value.slice(tokenStart));
  }
  return tokens;
}

function compareNaturalValues(left: string, right: string) {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  const leftTokens = splitNaturalTokens(leftLower);
  const rightTokens = splitNaturalTokens(rightLower);
  const tokenCount = Math.min(leftTokens.length, rightTokens.length);

  for (let index = 0; index < tokenCount; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken === rightToken) {
      continue;
    }
    if (typeof leftToken === "number" && typeof rightToken === "number") {
      return leftToken < rightToken ? -1 : 1;
    }
    const leftString = String(leftToken);
    const rightString = String(rightToken);
    if (leftString !== rightString) {
      return leftString < rightString ? -1 : 1;
    }
  }

  if (leftTokens.length !== rightTokens.length) {
    return leftTokens.length < rightTokens.length ? -1 : 1;
  }
  if (leftLower !== rightLower) {
    return leftLower < rightLower ? -1 : 1;
  }
  if (left !== right) {
    return left < right ? -1 : 1;
  }
  return 0;
}

function getTreeSortEntry(file: GitChangeSummary) {
  return {
    file,
    isDirectory: file.isDirectory,
    segments: file.path.split("/").filter(Boolean),
  };
}

function getTreeKindAtDepth(entry: ReturnType<typeof getTreeSortEntry>, depth: number) {
  if (depth !== entry.segments.length - 1) {
    return "directory";
  }
  return entry.isDirectory ? "directory" : "file";
}

function compareFilesByTreeOrder(leftFile: GitChangeSummary, rightFile: GitChangeSummary) {
  const left = getTreeSortEntry(leftFile);
  const right = getTreeSortEntry(rightFile);
  const sharedDepth = Math.min(left.segments.length, right.segments.length);

  for (let depth = 0; depth < sharedDepth; depth += 1) {
    const leftSegment = left.segments[depth];
    const rightSegment = right.segments[depth];
    if (leftSegment === rightSegment) {
      continue;
    }
    const leftKind = getTreeKindAtDepth(left, depth);
    const rightKind = getTreeKindAtDepth(right, depth);
    if (leftKind !== rightKind) {
      return leftKind === "directory" ? -1 : 1;
    }
    return compareNaturalValues(leftSegment, rightSegment);
  }

  if (left.segments.length !== right.segments.length) {
    return left.segments.length < right.segments.length ? -1 : 1;
  }
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }
  return compareNaturalValues(left.file.path, right.file.path);
}

interface GitChangeTreeProps {
  files: GitChangeSummary[];
  selectedPath: string | null;
  onSelectFile: (filePath: string) => void;
}

function GitChangeTree({ files, selectedPath, onSelectFile }: GitChangeTreeProps) {
  const filePaths = useMemo(() => files.map((file) => file.path), [files]);
  const filePathSet = useMemo(() => new Set(filePaths), [filePaths]);
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => files.map((file) => ({ path: file.path, status: mapGitStatus(file) })),
    [files]
  );
  const onSelectFileRef = useRef(onSelectFile);
  const filePathSetRef = useRef(filePathSet);
  const selectedPathRef = useRef<string | null>(null);
  const { model } = useFileTree({
    paths: filePaths,
    gitStatus,
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    icons: "standard",
    density: "compact",
    search: true,
    unsafeCSS: CHANGE_TREE_UNSAFE_CSS,
    fileTreeSearchMode: "hide-non-matches",
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    onSelectionChange: (selectedPaths) => {
      const filePath = selectedPaths.find((path) => filePathSetRef.current.has(path));
      if (filePath) {
        onSelectFileRef.current(filePath);
      }
    },
  });

  useEffect(() => {
    onSelectFileRef.current = onSelectFile;
  }, [onSelectFile]);

  useEffect(() => {
    filePathSetRef.current = filePathSet;
  }, [filePathSet]);

  useEffect(() => {
    model.resetPaths(filePaths);
  }, [filePaths, model]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  useEffect(() => {
    const previousPath = selectedPathRef.current;
    if (previousPath && previousPath !== selectedPath) {
      model.getItem(previousPath)?.deselect();
    }
    if (selectedPath) {
      const item = model.getItem(selectedPath);
      item?.select();
      item?.focus();
    }
    selectedPathRef.current = selectedPath;
  }, [model, selectedPath]);

  return <FileTree aria-label="Changed files" className={styles.changeTree} model={model} style={CHANGE_TREE_STYLE} />;
}

interface GitDiffProps {
  session?: Session | null;
  isActive: boolean;
  onNotify: (toast: ToastInput) => void;
  shortcutModifier: string;
  showShortcutHints?: boolean;
  onRefreshBranch?: () => Promise<void>;
}

const COMMIT_MODE_OPTIONS: Array<"commit" | "amend"> = ["commit", "amend"];

export default function GitDiff({
  session,
  isActive,
  onNotify,
  shortcutModifier,
  showShortcutHints = false,
  onRefreshBranch,
}: GitDiffProps) {
  const [summary, setSummary] = useState<GitChangeSummaryPayload>(EMPTY_SUMMARY);
  const [detailMap, setDetailMap] = useState<Record<string, GitFileCardDetailState>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [actionTarget, setActionTarget] = useState<"stageAll" | "unstageAll" | "discardAll" | null>(null);
  const [fileActionTarget, setFileActionTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<GitDiffSection>("unstaged");
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  const [fileOpenMap, setFileOpenMap] = useState<Record<string, boolean>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [commitMode, setCommitMode] = useState<"commit" | "amend">("commit");
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitMessageInvalid, setCommitMessageInvalid] = useState(false);
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [changeTreeWidth, setChangeTreeWidth] = useState(CHANGE_TREE_DEFAULT_WIDTH);
  const [isResizingChangeTree, setIsResizingChangeTree] = useState(false);
  const commitMenuRef = useRef<HTMLDivElement | null>(null);
  const commitMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const commitMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const commitMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);
  const summaryRef = useRef<GitChangeSummaryPayload>(EMPTY_SUMMARY);
  const detailMapRef = useRef<Record<string, GitFileCardDetailState>>({});
  const summaryRequestVersionRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const detailRequestTokensRef = useRef<Record<string, number>>({});
  const loadedRepoPathRef = useRef("");
  const changeTreeResizeRef = useRef({ startX: 0, startWidth: CHANGE_TREE_DEFAULT_WIDTH });
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const diffWorkbenchBodyRef = useRef<HTMLDivElement | null>(null);
  const diffListRef = useRef<HTMLDivElement | null>(null);

  const repoPath = session?.cwd ?? session?.repo.repoPath ?? "";
  const getDiffScrollElement = useCallback(() => diffListRef.current, []);
  const clampChangeTreeWidth = useCallback((width: number) => {
    const body = diffWorkbenchBodyRef.current;
    if (!body) {
      return Math.max(CHANGE_TREE_MIN_WIDTH, width);
    }
    const bodyWidth = body.getBoundingClientRect().width;
    if (bodyWidth <= 0) {
      return Math.max(CHANGE_TREE_MIN_WIDTH, width);
    }
    const maxWidth = Math.max(
      CHANGE_TREE_MIN_WIDTH,
      Math.min(
        bodyWidth * CHANGE_TREE_MAX_WIDTH_RATIO,
        bodyWidth - DIFF_PANEL_MIN_WIDTH - CHANGE_TREE_RESIZE_HANDLE_WIDTH
      )
    );
    return Math.min(maxWidth, Math.max(CHANGE_TREE_MIN_WIDTH, width));
  }, []);

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  useEffect(() => {
    detailMapRef.current = detailMap;
  }, [detailMap]);

  const focusCommitInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = commitInputRef.current;
      if (!input || input.disabled) {
        return;
      }
      input.focus();
      const cursor = input.value.length;
      input.setSelectionRange(cursor, cursor);
    });
  }, []);

  const loadSummary = useCallback(async () => {
    if (!repoPath) {
      summaryRequestVersionRef.current += 1;
      detailGenerationRef.current += 1;
      detailRequestTokensRef.current = {};
      loadedRepoPathRef.current = "";
      summaryRef.current = EMPTY_SUMMARY;
      setSummary(EMPTY_SUMMARY);
      setDetailMap({});
      setFileOpenMap({});
      setActiveSection("unstaged");
      setSelectedFileKey(null);
      setError(null);
      return;
    }

    const shouldResetActiveSection = loadedRepoPathRef.current !== repoPath;
    loadedRepoPathRef.current = repoPath;
    const requestVersion = summaryRequestVersionRef.current + 1;
    summaryRequestVersionRef.current = requestVersion;
    setIsLoading(true);
    setError(null);

    try {
      const output = await invoke<GitChangeSummaryPayload>("get_git_change_summary", { path: repoPath });
      if (summaryRequestVersionRef.current !== requestVersion) {
        return;
      }
      const nextSummary = output ?? EMPTY_SUMMARY;
      detailGenerationRef.current += 1;
      detailRequestTokensRef.current = {};
      summaryRef.current = nextSummary;
      setSummary(nextSummary);
      setDetailMap({});
      setFileOpenMap(buildInitialFileOpenMap(nextSummary));
      setSelectedFileKey(null);
      if (shouldResetActiveSection) {
        setActiveSection(nextSummary.unstaged.length > 0 || nextSummary.staged.length === 0 ? "unstaged" : "staged");
      }
    } catch (err) {
      if (summaryRequestVersionRef.current !== requestVersion) {
        return;
      }
      detailGenerationRef.current += 1;
      detailRequestTokensRef.current = {};
      summaryRef.current = EMPTY_SUMMARY;
      setSummary(EMPTY_SUMMARY);
      setDetailMap({});
      setFileOpenMap({});
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (summaryRequestVersionRef.current === requestVersion) {
        setIsLoading(false);
      }
    }
  }, [repoPath]);

  const fetchFileDetail = useCallback(
    async (section: GitDiffSection, filePath: string) => {
      if (!repoPath) {
        return;
      }
      const fileKey = `${section}:${filePath}`;
      const currentStatus = detailMapRef.current[fileKey]?.status;
      if (currentStatus === "loading" || currentStatus === "ready") {
        return;
      }

      const requestGeneration = detailGenerationRef.current;
      const token = (detailRequestTokensRef.current[fileKey] ?? 0) + 1;
      detailRequestTokensRef.current[fileKey] = token;
      setDetailMap((prev) => ({ ...prev, [fileKey]: { status: "loading" } }));

      try {
        const detail = await invoke<GitFileDiffPayload>("get_git_file_diff", {
          path: repoPath,
          section,
          filePath,
        });
        if (
          detailGenerationRef.current !== requestGeneration ||
          detailRequestTokensRef.current[fileKey] !== token
        ) {
          return;
        }
        setDetailMap((prev) => ({ ...prev, [fileKey]: { status: "ready", data: detail } }));
      } catch (err) {
        if (
          detailGenerationRef.current !== requestGeneration ||
          detailRequestTokensRef.current[fileKey] !== token
        ) {
          return;
        }
        setDetailMap((prev) => ({
          ...prev,
          [fileKey]: {
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [repoPath]
  );

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void loadSummary();
  }, [isActive, loadSummary]);

  const sections = useMemo<{ key: GitDiffSection; title: string; files: GitChangeSummary[] }[]>(
    () => [
      {
        key: "staged",
        title: "Staged",
        files: summary.staged,
      },
      {
        key: "unstaged",
        title: "Unstaged",
        files: summary.unstaged,
      },
    ],
    [summary]
  );
  const activeSectionData = sections.find((section) => section.key === activeSection) ?? sections[0];
  const activeTreeOrderedFiles = useMemo(
    () => [...activeSectionData.files].sort(compareFilesByTreeOrder),
    [activeSectionData.files]
  );
  const activeStats = useMemo(() => getSectionStats(activeSectionData.files), [activeSectionData.files]);
  const hasStagedChanges = summary.staged.length > 0;
  const commitAmend = commitMode === "amend";
  const commitActionDisabled = !repoPath || isLoading || isCommitting;
  const refreshDisabled = !repoPath || isLoading;
  const bulkActionDisabled = !repoPath || isLoading || actionTarget !== null || fileActionTarget !== null;
  const isMac = useMemo(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform), []);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    for (const file of activeTreeOrderedFiles) {
      const fileKey = `${activeSectionData.key}:${file.path}`;
      if (fileOpenMap[fileKey]) {
        void fetchFileDetail(activeSectionData.key, file.path);
      }
    }
  }, [activeSectionData.key, activeTreeOrderedFiles, fetchFileDetail, fileOpenMap, isActive]);

  useEffect(() => {
    setCommitMessage("");
    setCommitMode("commit");
    setCommitMessageInvalid(false);
    setCommitMenuOpen(false);
  }, [repoPath]);

  useEffect(() => {
    if (!commitMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!commitMenuRef.current?.contains(target)) {
        setCommitMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommitMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [commitMenuOpen]);

  useEffect(() => {
    if (!isResizingChangeTree) {
      return;
    }
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handlePointerMove = (event: PointerEvent) => {
      const delta = event.clientX - changeTreeResizeRef.current.startX;
      setChangeTreeWidth(clampChangeTreeWidth(changeTreeResizeRef.current.startWidth + delta));
    };

    const handlePointerUp = () => {
      setIsResizingChangeTree(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [clampChangeTreeWidth, isResizingChangeTree]);

  const handleRefresh = useCallback(async () => {
    try {
      await Promise.all([loadSummary(), onRefreshBranch ? onRefreshBranch() : Promise.resolve()]);
    } catch {
      // loadSummary already populates UI error state; keep shortcut flow stable.
    }
  }, [loadSummary, onRefreshBranch]);

  const runBulkAction = useCallback(
    async (target: "stageAll" | "unstageAll" | "discardAll") => {
      if (bulkActionDisabled) {
        return;
      }
      if (target === "discardAll") {
        const confirmed = await confirm(
          "Discard all unstaged changes? This removes unstaged edits and untracked files.",
          { title: "Codelegate", kind: "warning" }
        );
        if (!confirmed) {
          return;
        }
      }
      setActionTarget(target);
      setError(null);
      try {
        if (target === "unstageAll") {
          await invoke("unstage_all_changes", { path: repoPath });
        } else if (target === "stageAll") {
          await invoke("stage_all_changes", { path: repoPath });
        } else {
          await invoke("discard_all_changes", { path: repoPath });
        }
        await loadSummary();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionTarget((current) => (current === target ? null : current));
      }
    },
    [bulkActionDisabled, loadSummary, repoPath]
  );

  const handleCommit = useCallback(async () => {
    if (!repoPath) {
      return;
    }
    const message = commitMessage.trim();
    if (!message) {
      setCommitMessageInvalid(true);
      onNotify({ tone: "error", message: "Commit message should not be empty." });
      return;
    }
    if (!commitAmend && !hasStagedChanges) {
      onNotify({ tone: "error", message: "No staged changes to commit." });
      return;
    }
    setCommitMessageInvalid(false);
    setIsCommitting(true);
    setError(null);
    try {
      await invoke("commit_git_changes", {
        path: repoPath,
        message,
        amend: commitAmend,
      });
      setCommitMessage("");
      setCommitMode("commit");
      onNotify({ tone: "success", message: commitAmend ? "Amended." : "Committed." });
      await loadSummary();
    } catch (err) {
      onNotify({ tone: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsCommitting(false);
    }
  }, [commitAmend, commitMessage, hasStagedChanges, loadSummary, onNotify, repoPath]);

  const handleCommitShortcut = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key !== "Enter") {
        return;
      }
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (!modifierPressed) {
        return;
      }
      event.preventDefault();
      if (!commitActionDisabled) {
        void handleCommit();
      }
    },
    [commitActionDisabled, handleCommit, isMac]
  );

  const gitHotkeys = useMemo(() => {
    return [
      defineHotkey({
        id: "git-focus-commit-message",
        combo: buildShortcutCombo(shortcutModifier, "KeyM"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => {
          if (!repoPath || isCommitting) {
            return;
          }
          focusCommitInput();
        },
      }),
      defineHotkey({
        id: "git-refresh-status",
        combo: buildShortcutCombo(shortcutModifier, "KeyR"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => {
          if (!refreshDisabled) {
            void handleRefresh();
          }
        },
      }),
      defineHotkey({
        id: "git-show-staged-tab",
        combo: buildShortcutCombo(shortcutModifier, "KeyY"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => {
          setActiveSection("staged");
          setSelectedFileKey(null);
        },
      }),
      defineHotkey({
        id: "git-show-unstaged-tab",
        combo: buildShortcutCombo(shortcutModifier, "KeyU"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => {
          setActiveSection("unstaged");
          setSelectedFileKey(null);
        },
      }),
      defineHotkey({
        id: "git-discard-all",
        combo: buildShortcutCombo(shortcutModifier, "KeyD"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => {
          if (bulkActionDisabled || summary.unstaged.length === 0) {
            return;
          }
          void runBulkAction("discardAll");
        },
      }),
      defineHotkey({
        id: "git-unstage-all",
        combo: buildShortcutCombo(shortcutModifier, "KeyZ"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => {
          if (bulkActionDisabled || summary.staged.length === 0) {
            return;
          }
          void runBulkAction("unstageAll");
        },
      }),
      defineHotkey({
        id: "git-stage-all",
        combo: buildShortcutCombo(shortcutModifier, "KeyX"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => {
          if (bulkActionDisabled || summary.unstaged.length === 0) {
            return;
          }
          void runBulkAction("stageAll");
        },
      }),
    ];
  }, [
    actionTarget,
    bulkActionDisabled,
    focusCommitInput,
    handleRefresh,
    isCommitting,
    isLoading,
    refreshDisabled,
    repoPath,
    runBulkAction,
    shortcutModifier,
    summary.staged.length,
    summary.unstaged.length,
  ]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isTextInputEvent(event)) {
        return;
      }
      runHotkeys(event, gitHotkeys);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [gitHotkeys, isActive]);

  const handleSelectCommitMode = useCallback(
    async (mode: "commit" | "amend") => {
      setCommitMode(mode);
      setCommitMenuOpen(false);
      if (mode !== "amend" || !repoPath || isCommitting) {
        return;
      }
      try {
        const previousMessage = await invoke<string>("get_last_commit_message", { path: repoPath });
        setCommitMessage(previousMessage);
        setCommitMessageInvalid(previousMessage.trim().length === 0);
      } catch (err) {
        onNotify({ tone: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [isCommitting, onNotify, repoPath]
  );

  const focusCommitMenuItem = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(COMMIT_MODE_OPTIONS.length - 1, index));
    requestAnimationFrame(() => {
      commitMenuItemRefs.current[bounded]?.focus();
    });
  }, []);

  const handleCommitMenuGroupKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (commitActionDisabled) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const target = event.target instanceof HTMLButtonElement ? event.target : null;
        const activeItemIndex = target ? commitMenuItemRefs.current.findIndex((item) => item === target) : -1;
        if (target && activeItemIndex < 0) {
          commitMenuTriggerRef.current = target;
        }
        setCommitMenuOpen(true);
        if (activeItemIndex >= 0) {
          const nextIndex = (activeItemIndex + direction + COMMIT_MODE_OPTIONS.length) % COMMIT_MODE_OPTIONS.length;
          focusCommitMenuItem(nextIndex);
          return;
        }
        focusCommitMenuItem(direction > 0 ? 0 : COMMIT_MODE_OPTIONS.length - 1);
        return;
      }

      if (event.key === "Escape" && commitMenuOpen) {
        event.preventDefault();
        setCommitMenuOpen(false);
        requestAnimationFrame(() => {
          (commitMenuTriggerRef.current ?? commitMenuButtonRef.current)?.focus();
        });
      }
    },
    [commitActionDisabled, commitMenuOpen, focusCommitMenuItem]
  );

  const toggleFile = useCallback((section: GitDiffSection, filePath: string) => {
    const fileKey = `${section}:${filePath}`;
    setFileOpenMap((prev) => ({ ...prev, [fileKey]: !(prev[fileKey] ?? false) }));
  }, []);

  const focusFileDiff = useCallback(
    (section: GitDiffSection, filePath: string) => {
      const fileKey = `${section}:${filePath}`;
      setSelectedFileKey(fileKey);
      setFileOpenMap((prev) => ({ ...prev, [fileKey]: true }));
      void fetchFileDetail(section, filePath);
      requestAnimationFrame(() => {
        cardRefs.current[fileKey]?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    },
    [fetchFileDetail]
  );

  const handleTreeSelect = useCallback(
    (filePath: string) => {
      focusFileDiff(activeSection, filePath);
    },
    [activeSection, focusFileDiff]
  );

  const applyActionSummary = useCallback(
    (section: GitDiffSection, filePath: string, nextSummary: GitChangeSummaryPayload) => {
      const sourceKey = `${section}:${filePath}`;
      const scrollElement = diffListRef.current;
      const scrollSnapshot = captureScrollSnapshot(scrollElement);
      const changedKeys = collectChangedSummaryKeys(summaryRef.current, nextSummary);
      const nextKeys = collectSummaryKeys(nextSummary);

      summaryRequestVersionRef.current += 1;
      detailGenerationRef.current += 1;
      detailRequestTokensRef.current = {};
      setIsLoading(false);
      summaryRef.current = nextSummary;
      setSummary(nextSummary);
      // Summary counts are display metadata, not a content identity. Clear cached diffs so open files refetch.
      setDetailMap({});
      setFileOpenMap((current) => {
        const next = { ...current };
        const wasOpen = next[sourceKey] ?? false;
        for (const key of Object.keys(next)) {
          if (!nextKeys.has(key) || changedKeys.has(key)) {
            delete next[key];
          }
        }
        if (wasOpen) {
          for (const key of changedKeys) {
            if (nextKeys.has(key)) {
              next[key] = true;
            }
          }
        }
        return next;
      });
      setSelectedFileKey((current) => (current && (!nextKeys.has(current) || changedKeys.has(current)) ? null : current));
      requestAnimationFrame(() => {
        restoreScrollSnapshot(scrollElement, scrollSnapshot);
        requestAnimationFrame(() => restoreScrollSnapshot(scrollElement, scrollSnapshot));
      });
    },
    []
  );

  const handleChangeTreeResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    changeTreeResizeRef.current = {
      startX: event.clientX,
      startWidth: changeTreeWidth,
    };
    setIsResizingChangeTree(true);
    event.preventDefault();
  }, [changeTreeWidth]);

  const handleChangeTreeResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setChangeTreeWidth((current) => clampChangeTreeWidth(current + direction * 16));
  }, [clampChangeTreeWidth]);

  const runFileAction = useCallback(
    async (section: GitDiffSection, filePath: string) => {
      if (!repoPath) {
        return;
      }
      const fileKey = `${section}:${filePath}`;
      setFileActionTarget(fileKey);
      setError(null);
      try {
        if (section === "staged") {
          const nextSummary = await invoke<GitChangeSummaryPayload>("unstage_file_change", {
            path: repoPath,
            filePath,
          });
          applyActionSummary(section, filePath, nextSummary);
          onNotify({ tone: "success", message: "Unstaged." });
        } else {
          const nextSummary = await invoke<GitChangeSummaryPayload>("stage_file_change", {
            path: repoPath,
            filePath,
          });
          applyActionSummary(section, filePath, nextSummary);
          onNotify({ tone: "success", message: "Staged." });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        onNotify({ tone: "error", message });
      } finally {
        setFileActionTarget((current) => (current === fileKey ? null : current));
      }
    },
    [applyActionSummary, onNotify, repoPath]
  );

  useEffect(() => {
    if (!isActive || activeTreeOrderedFiles.length === 0) {
      return;
    }
    const root = diffListRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const element = entry.target as HTMLElement;
          const fileKey = element.dataset.fileKey;
          const section = element.dataset.diffSection as GitDiffSection | undefined;
          const filePath = element.dataset.filePath;
          if (fileKey && fileOpenMap[fileKey] && section && filePath) {
            void fetchFileDetail(section, filePath);
          }
        }
      },
      { root, rootMargin: "180px 0px", threshold: 0.01 }
    );
    const observed = root?.querySelectorAll<HTMLElement>("[data-file-key]") ?? [];
    observed.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
    };
  }, [activeSectionData.key, activeTreeOrderedFiles, fetchFileDetail, fileOpenMap, isActive]);

  return (
    <div className={styles.container}>
      <section className={styles.commitSection}>
        <div className={styles.commitHeader}>
          <h3 className={styles.commitTitle}>Commit</h3>
          <span className={styles.commitMeta}>
            {summary.staged.length} staged {summary.staged.length === 1 ? "file" : "files"}
          </span>
        </div>
        <div className={styles.commitBody}>
          <div className={styles.commitInputWrap}>
            <textarea
              ref={commitInputRef}
              className={`${styles.commitInput} ${commitMessageInvalid ? styles.commitInputInvalid : ""}`}
              rows={3}
              placeholder="Write commit message"
              value={commitMessage}
              onChange={(event) => {
                setCommitMessage(event.target.value);
                if (commitMessageInvalid) {
                  setCommitMessageInvalid(false);
                }
              }}
              onKeyDown={handleCommitShortcut}
              disabled={!repoPath || isCommitting}
            />
            {showShortcutHints ? (
              <span className={`${styles.shortcutBadge} ${styles.commitInputShortcutBadge}`} aria-hidden="true">
                M
              </span>
            ) : null}
          </div>
          <div className={styles.commitActions}>
            <span className={styles.shortcutBadgeWrap}>
              <ActionButton
                icon={<RefreshCw size={16} aria-hidden="true" />}
                onClick={handleRefresh}
                disabled={refreshDisabled}
                className={styles.commitRefreshButton}
                aria-label="Refresh diffs"
              />
              {showShortcutHints ? (
                <span className={styles.shortcutBadge} aria-hidden="true">
                  R
                </span>
              ) : null}
            </span>
            <div
              className={`${styles.commitButtonGroup} ${commitActionDisabled ? styles.commitButtonGroupDisabled : ""}`}
              ref={commitMenuRef}
              onKeyDown={handleCommitMenuGroupKeyDown}
            >
              <Button
                variant="primary"
                className={styles.commitSplitButton}
                onClick={() => void handleCommit()}
                disabled={commitActionDisabled}
              >
                {isCommitting ? "Committing..." : commitAmend ? "Amend" : "Commit"}
              </Button>
              <button
                type="button"
                ref={commitMenuButtonRef}
                className={styles.commitDropdownButton}
                aria-label="Select commit mode"
                aria-expanded={commitMenuOpen}
                onClick={(event) => {
                  commitMenuTriggerRef.current = event.currentTarget;
                  setCommitMenuOpen((prev) => !prev);
                }}
                disabled={commitActionDisabled}
              >
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              {commitMenuOpen ? (
                <div className={styles.commitMenu}>
                  <button
                    type="button"
                    className={`${styles.commitMenuItem} ${!commitAmend ? styles.commitMenuItemActive : ""}`}
                    ref={(element) => {
                      commitMenuItemRefs.current[0] = element;
                    }}
                    onClick={() => void handleSelectCommitMode("commit")}
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    className={`${styles.commitMenuItem} ${commitAmend ? styles.commitMenuItemActive : ""}`}
                    ref={(element) => {
                      commitMenuItemRefs.current[1] = element;
                    }}
                    onClick={() => void handleSelectCommitMode("amend")}
                  >
                    Amend
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <section className={styles.diffWorkbench}>
        <div className={styles.diffWorkbenchHeader}>
          <div className={styles.diffTabsMeta}>
            <div className={styles.diffTabs} role="tablist" aria-label="Git change sections">
              {sections.map((section) => (
                <span key={section.key} className={styles.diffTabWrap} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeSection === section.key}
                    className={`${styles.diffTab} ${activeSection === section.key ? styles.diffTabActive : ""}`}
                    onClick={() => {
                      setActiveSection(section.key);
                      setSelectedFileKey(null);
                    }}
                  >
                    <span>{section.title}</span>
                    <span className={styles.diffTabCount}>{section.files.length}</span>
                  </button>
                  {showShortcutHints ? (
                    <span className={styles.shortcutBadge} aria-hidden="true">
                      {section.key === "staged" ? "Y" : "U"}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
            <div className={styles.diffSummaryStats}>
              <span className={styles.diffSummaryFiles}>{activeSectionData.files.length} files</span>
              <span className={styles.diffSummaryDot}>•</span>
              <span className={styles.diffSummaryAdd}>+{activeStats.additions}</span>
              <span className={styles.diffSummarySlash}>/</span>
              <span className={styles.diffSummaryDel}>-{activeStats.deletions}</span>
            </div>
          </div>
          <div className={styles.diffSummaryActions}>
            {activeSectionData.key === "unstaged" ? (
              <>
                <span className={styles.shortcutBadgeWrap}>
                  <ActionButton
                    onClick={() => void runBulkAction("discardAll")}
                    className={[styles.diffSummaryActionButton, styles.discardAction].join(" ")}
                    disabled={bulkActionDisabled || activeSectionData.files.length === 0}
                  >
                    Discard All
                  </ActionButton>
                  {showShortcutHints ? (
                    <span className={styles.shortcutBadge} aria-hidden="true">
                      D
                    </span>
                  ) : null}
                </span>
                <span className={styles.shortcutBadgeWrap}>
                  <ActionButton
                    onClick={() => void runBulkAction("stageAll")}
                    className={styles.diffSummaryActionButton}
                    disabled={bulkActionDisabled || activeSectionData.files.length === 0}
                  >
                    Stage All
                  </ActionButton>
                  {showShortcutHints ? (
                    <span className={styles.shortcutBadge} aria-hidden="true">
                      X
                    </span>
                  ) : null}
                </span>
              </>
            ) : (
              <span className={styles.shortcutBadgeWrap}>
                <ActionButton
                  onClick={() => void runBulkAction("unstageAll")}
                  className={styles.diffSummaryActionButton}
                  disabled={bulkActionDisabled || activeSectionData.files.length === 0}
                >
                  Unstage All
                </ActionButton>
                {showShortcutHints ? (
                  <span className={styles.shortcutBadge} aria-hidden="true">
                    Z
                  </span>
                ) : null}
              </span>
            )}
          </div>
        </div>

        {isLoading ? <div className={styles.state}>Loading diffs…</div> : null}
        {error ? <div className={`${styles.state} ${styles.stateError}`}>{error}</div> : null}

        {!isLoading && !error ? (
          activeSectionData.files.length === 0 ? (
            <div className={styles.diffWorkbenchEmpty}>
              <div className={styles.state}>No changes.</div>
            </div>
          ) : (
            <div
              ref={diffWorkbenchBodyRef}
              className={styles.diffWorkbenchBody}
              style={{ "--diff-tree-width": `${changeTreeWidth}px` } as CSSProperties}
            >
              <aside className={styles.diffTreePane}>
                <GitChangeTree
                  files={activeSectionData.files}
                  selectedPath={
                    selectedFileKey?.startsWith(`${activeSectionData.key}:`)
                      ? selectedFileKey.slice(activeSectionData.key.length + 1)
                      : null
                  }
                  onSelectFile={handleTreeSelect}
                />
              </aside>
              <div
                className={`${styles.diffTreeResizeHandle} ${
                  isResizingChangeTree ? styles.diffTreeResizeHandleActive : ""
                }`}
                role="separator"
                aria-label="Resize changed files tree"
                aria-orientation="vertical"
                aria-valuemin={CHANGE_TREE_MIN_WIDTH}
                aria-valuenow={Math.round(changeTreeWidth)}
                tabIndex={0}
                onPointerDown={handleChangeTreeResizeStart}
                onKeyDown={handleChangeTreeResizeKeyDown}
              />
              <div ref={diffListRef} className={styles.diffPanel}>
                <div className={styles.diffList}>
                  {activeTreeOrderedFiles.map((file) => {
                    const fileKey = `${activeSectionData.key}:${file.path}`;
                    return (
                      <div
                        key={fileKey}
                        ref={(element) => {
                          cardRefs.current[fileKey] = element;
                        }}
                        data-file-key={fileKey}
                        data-diff-section={activeSectionData.key}
                        data-file-path={file.path}
                      >
                        <GitFileCard
                          fileKey={fileKey}
                          summary={file}
                          detailState={detailMap[fileKey]}
                          isOpen={fileOpenMap[fileKey] ?? false}
                          onToggle={() => toggleFile(activeSectionData.key, file.path)}
                          section={activeSectionData.key}
                          isSelected={selectedFileKey === fileKey}
                          actionDisabled={!repoPath || isLoading || actionTarget !== null || fileActionTarget !== null}
                          actionLoading={fileActionTarget === fileKey}
                          getScrollElement={getDiffScrollElement}
                          onFileAction={() => void runFileAction(activeSectionData.key, file.path)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}

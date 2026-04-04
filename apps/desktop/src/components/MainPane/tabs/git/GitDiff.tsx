import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
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
import GitDiffsHeader from "./GitDiffsHeader";
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
const LARGE_DIFF_THRESHOLD = 100;

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
        !file.isBinary;
      next[key] = shouldAutoOpen;
      if (shouldAutoOpen) {
        autoOpened += 1;
      }
    }
  }

  return next;
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
  const [error, setError] = useState<string | null>(null);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [fileOpenMap, setFileOpenMap] = useState<Record<string, boolean>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [commitMode, setCommitMode] = useState<"commit" | "amend">("commit");
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitMessageInvalid, setCommitMessageInvalid] = useState(false);
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const commitMenuRef = useRef<HTMLDivElement | null>(null);
  const commitMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const commitMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const commitMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);
  const detailMapRef = useRef<Record<string, GitFileCardDetailState>>({});
  const summaryVersionRef = useRef(0);
  const detailRequestTokensRef = useRef<Record<string, number>>({});

  const repoPath = session?.cwd ?? session?.repo.repoPath ?? "";

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
      summaryVersionRef.current += 1;
      detailRequestTokensRef.current = {};
      setSummary(EMPTY_SUMMARY);
      setDetailMap({});
      setFileOpenMap({});
      setError(null);
      return;
    }

    const requestVersion = summaryVersionRef.current + 1;
    summaryVersionRef.current = requestVersion;
    detailRequestTokensRef.current = {};
    setIsLoading(true);
    setError(null);

    try {
      const output = await invoke<GitChangeSummaryPayload>("get_git_change_summary", { path: repoPath });
      if (summaryVersionRef.current !== requestVersion) {
        return;
      }
      const nextSummary = output ?? EMPTY_SUMMARY;
      setSummary(nextSummary);
      setDetailMap({});
      setFileOpenMap(buildInitialFileOpenMap(nextSummary));
    } catch (err) {
      if (summaryVersionRef.current !== requestVersion) {
        return;
      }
      setSummary(EMPTY_SUMMARY);
      setDetailMap({});
      setFileOpenMap({});
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (summaryVersionRef.current === requestVersion) {
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

      const requestVersion = summaryVersionRef.current;
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
          summaryVersionRef.current !== requestVersion ||
          detailRequestTokensRef.current[fileKey] !== token
        ) {
          return;
        }
        setDetailMap((prev) => ({ ...prev, [fileKey]: { status: "ready", data: detail } }));
      } catch (err) {
        if (
          summaryVersionRef.current !== requestVersion ||
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
        title: "Staged Diffs",
        files: summary.staged,
      },
      {
        key: "unstaged",
        title: "Unstaged Diffs",
        files: summary.unstaged,
      },
    ],
    [summary]
  );
  const hasStagedChanges = summary.staged.length > 0;
  const commitAmend = commitMode === "amend";
  const commitActionDisabled = !repoPath || isLoading || isCommitting;
  const refreshDisabled = !repoPath || isLoading;
  const isMac = useMemo(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform), []);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    for (const section of sections) {
      const sectionIsOpen = section.key === "staged" ? stagedOpen : unstagedOpen;
      if (!sectionIsOpen) {
        continue;
      }
      for (const file of section.files) {
        const fileKey = `${section.key}:${file.path}`;
        if (fileOpenMap[fileKey]) {
          void fetchFileDetail(section.key, file.path);
        }
      }
    }
  }, [fetchFileDetail, fileOpenMap, isActive, sections, stagedOpen, unstagedOpen]);

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

  const handleRefresh = useCallback(async () => {
    try {
      await Promise.all([loadSummary(), onRefreshBranch ? onRefreshBranch() : Promise.resolve()]);
    } catch {
      // loadSummary already populates UI error state; keep shortcut flow stable.
    }
  }, [loadSummary, onRefreshBranch]);

  const runBulkAction = useCallback(
    async (target: "stageAll" | "unstageAll" | "discardAll") => {
      if (!repoPath) {
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
    [loadSummary, repoPath]
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
        id: "git-discard-all",
        combo: buildShortcutCombo(shortcutModifier, "KeyD"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => {
          if (!repoPath || isLoading || actionTarget !== null || summary.unstaged.length === 0) {
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
          if (!repoPath || isLoading || actionTarget !== null || summary.staged.length === 0) {
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
          if (!repoPath || isLoading || actionTarget !== null || summary.unstaged.length === 0) {
            return;
          }
          void runBulkAction("stageAll");
        },
      }),
    ];
  }, [
    actionTarget,
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
      if (event.defaultPrevented || event.repeat || isTextInputElement(event.target)) {
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
      {sections.map((section) => {
        const additions = section.files.reduce((sum, file) => sum + file.additions, 0);
        const deletions = section.files.reduce((sum, file) => sum + file.deletions, 0);
        const isOpen = section.key === "staged" ? stagedOpen : unstagedOpen;
        const setOpen = section.key === "staged" ? setStagedOpen : setUnstagedOpen;
        const hasFiles = section.files.length > 0;
        const actionsDisabled = !repoPath || isLoading || actionTarget !== null || !hasFiles;
        const sectionActions =
          section.key === "staged"
            ? [
                {
                  key: "unstage-all",
                  label: "Unstage All",
                  onClick: () => void runBulkAction("unstageAll"),
                  disabled: actionsDisabled,
                  shortcutHint: "Z",
                  showShortcutHint: showShortcutHints,
                },
              ]
            : [
                {
                  key: "discard-all",
                  label: "Discard All",
                  onClick: () => void runBulkAction("discardAll"),
                  className: styles.discardAction,
                  disabled: actionsDisabled,
                  shortcutHint: "D",
                  showShortcutHint: showShortcutHints,
                },
                {
                  key: "stage-all",
                  label: "Stage All",
                  onClick: () => void runBulkAction("stageAll"),
                  disabled: actionsDisabled,
                  shortcutHint: "X",
                  showShortcutHint: showShortcutHints,
                },
              ];

        return (
          <div key={section.key} className={styles.diffSection}>
            <GitDiffsHeader
              title={section.title}
              fileCount={section.files.length}
              additions={additions}
              deletions={deletions}
              isOpen={isOpen}
              onToggle={() => setOpen((prev) => !prev)}
              showRefresh={false}
              sectionActions={sectionActions}
            />

            {isOpen ? (
              <>
                {isLoading ? <div className={styles.state}>Loading diffs…</div> : null}
                {error ? <div className={`${styles.state} ${styles.stateError}`}>{error}</div> : null}

                {!isLoading && !error ? (
                  <div className={styles.diffList}>
                    {!hasFiles ? (
                      <div className={styles.state}>No changes.</div>
                    ) : (
                      section.files.map((file) => {
                        const fileKey = `${section.key}:${file.path}`;
                        return (
                          <GitFileCard
                            key={fileKey}
                            fileKey={fileKey}
                            summary={file}
                            detailState={detailMap[fileKey]}
                            isOpen={fileOpenMap[fileKey] ?? false}
                            onToggle={() => toggleFile(section.key, file.path)}
                          />
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

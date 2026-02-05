import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { ChevronDown } from "lucide-react";
import Button from "../../../ui/Button/Button";
import type { Session, ToastInput } from "../../../../types";
import { getLanguageFromPath, parseGitDiff, type FileDiff } from "../../../../utils/gitDiff";
import GitDiffsHeader from "./GitDiffsHeader";
import GitFileCard from "./GitFileCard";
import styles from "./GitDiff.module.css";

interface GitDiffProps {
  session?: Session | null;
  isActive: boolean;
  onNotify: (toast: ToastInput) => void;
}

interface GitDiffPayload {
  staged: string;
  unstaged: string;
  untracked: Array<{ path: string; diff: string }>;
}

export default function GitDiff({ session, isActive, onNotify }: GitDiffProps) {
  const [payload, setPayload] = useState<GitDiffPayload | null>(null);
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
      setPayload(output ?? { staged: "", unstaged: "", untracked: [] });
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
  const untrackedFiles = useMemo<FileDiff[]>(
    () =>
      (payload?.untracked ?? []).flatMap<FileDiff>((entry) => {
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
              status: "untracked",
            },
          ];
        }
        return parsed.map((file) => ({
          ...file,
          path: entry.path,
          language: getLanguageFromPath(entry.path),
          isUntracked: true,
          status: "untracked",
        }));
      }),
    [payload]
  );

  const unstagedFiles = useMemo(
    () => [...unstagedTrackedFiles, ...untrackedFiles],
    [unstagedTrackedFiles, untrackedFiles]
  );

  const sections = useMemo<{ key: "staged" | "unstaged"; title: string; files: FileDiff[] }[]>(
    () => [
      { key: "staged", title: "Staged Diffs", files: stagedFiles },
      { key: "unstaged", title: "Unstaged Diffs", files: unstagedFiles },
    ],
    [stagedFiles, unstagedFiles]
  );
  const hasStagedChanges = stagedFiles.length > 0;
  const trimmedCommitMessage = commitMessage.trim();
  const commitAmend = commitMode === "amend";
  const commitActionDisabled = !repoPath || isLoading || isCommitting;

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const section of sections) {
      for (const file of section.files) {
        const key = `${section.key}:${file.path}`;
        next[key] = file.isUntracked || file.status === "deleted" ? false : true;
      }
    }
    setFileOpenMap(next);
  }, [sections]);

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

  const handleRefresh = useCallback(() => {
    void loadDiffs();
  }, [loadDiffs]);

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
        await loadDiffs();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionTarget((current) => (current === target ? null : current));
      }
    },
    [loadDiffs, repoPath]
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
      await loadDiffs();
    } catch (err) {
      onNotify({ tone: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsCommitting(false);
    }
  }, [commitAmend, commitMessage, hasStagedChanges, loadDiffs, onNotify, repoPath]);

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

  return (
    <div className={styles.container}>
      <section className={styles.commitSection}>
        <div className={styles.commitHeader}>
          <h3 className={styles.commitTitle}>Commit</h3>
          <span className={styles.commitMeta}>
            {stagedFiles.length} staged {stagedFiles.length === 1 ? "file" : "files"}
          </span>
        </div>
        <div className={styles.commitBody}>
          <textarea
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
            disabled={!repoPath || isCommitting}
          />
          <div className={styles.commitActions}>
            <div
              className={`${styles.commitButtonGroup} ${commitActionDisabled ? styles.commitButtonGroupDisabled : ""}`}
              ref={commitMenuRef}
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
                className={styles.commitDropdownButton}
                aria-label="Select commit mode"
                aria-expanded={commitMenuOpen}
                onClick={() => setCommitMenuOpen((prev) => !prev)}
                disabled={commitActionDisabled}
              >
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              {commitMenuOpen ? (
                <div className={styles.commitMenu}>
                  <button
                    type="button"
                    className={`${styles.commitMenuItem} ${!commitAmend ? styles.commitMenuItemActive : ""}`}
                    onClick={() => void handleSelectCommitMode("commit")}
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    className={`${styles.commitMenuItem} ${commitAmend ? styles.commitMenuItemActive : ""}`}
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
                },
              ]
            : [
                {
                  key: "discard-all",
                  label: "Discard All",
                  onClick: () => void runBulkAction("discardAll"),
                  className: styles.discardAction,
                  disabled: actionsDisabled,
                },
                {
                  key: "stage-all",
                  label: "Stage All",
                  onClick: () => void runBulkAction("stageAll"),
                  disabled: actionsDisabled,
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
              onRefresh={handleRefresh}
              refreshDisabled={!repoPath || isLoading}
              sectionActions={sectionActions}
            />

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
                          <GitFileCard
                            key={fileKey}
                            fileKey={fileKey}
                            file={file}
                            isOpen={isFileOpen}
                            onToggle={() =>
                              setFileOpenMap((prev) => ({ ...prev, [fileKey]: !(prev[fileKey] ?? true) }))
                            }
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

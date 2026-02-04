import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../../../../types";
import { getLanguageFromPath, parseGitDiff, type FileDiff } from "../../../../utils/gitDiff";
import GitDiffsHeader from "./GitDiffsHeader";
import GitFileCard from "./GitFileCard";
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

export default function GitDiff({ session, isActive }: GitDiffProps) {
  const [payload, setPayload] = useState<GitDiffPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionTarget, setActionTarget] = useState<"staged" | "unstaged" | null>(null);
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

  const handleRefresh = useCallback(() => {
    void loadDiffs();
  }, [loadDiffs]);

  const handleSectionAction = useCallback(
    async (key: "staged" | "unstaged") => {
      if (!repoPath) {
        return;
      }
      setActionTarget(key);
      setError(null);
      try {
        if (key === "staged") {
          await invoke("unstage_all_changes", { path: repoPath });
        } else {
          await invoke("stage_all_changes", { path: repoPath });
        }
        await loadDiffs();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionTarget((current) => (current === key ? null : current));
      }
    },
    [loadDiffs, repoPath]
  );

  return (
    <div className={styles.container}>
      {sections.map((section) => {
        const additions = section.files.reduce((sum, file) => sum + file.additions, 0);
        const deletions = section.files.reduce((sum, file) => sum + file.deletions, 0);
        const isOpen = section.key === "staged" ? stagedOpen : unstagedOpen;
        const setOpen = section.key === "staged" ? setStagedOpen : setUnstagedOpen;
        const sectionActionLabel = section.key === "staged" ? "Unstage All" : "Stage All";
        const sectionActionPending = actionTarget === section.key;
        const sectionActionDisabled =
          !repoPath || isLoading || actionTarget !== null || sectionActionPending || section.files.length === 0;
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
              sectionActionLabel={sectionActionLabel}
              onSectionAction={() => void handleSectionAction(section.key)}
              sectionActionDisabled={sectionActionDisabled}
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

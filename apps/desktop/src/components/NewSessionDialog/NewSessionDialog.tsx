import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import type { AgentAvailability, AgentId, EnvVar, GitBranchInfo } from "../../types";
import AgentPicker from "../AgentPicker/AgentPicker";
import RepoPicker from "../RepoPicker/RepoPicker";
import EnvList from "../EnvList/EnvList";
import BranchPicker from "../BranchPicker/BranchPicker";
import Button from "../ui/Button/Button";
import IconButton from "../ui/IconButton/IconButton";
import styles from "./NewSessionDialog.module.css";

interface NewSessionDialogProps {
  open: boolean;
  selectedAgent: AgentId;
  agentAvailability: AgentAvailability;
  onSelectAgent: (agent: AgentId) => void;
  repoPath: string;
  recentDirs: string[];
  onSelectRepo: (path: string) => void;
  onBrowseRepo: () => void;
  repoHint?: string;
  worktreeEnabled: boolean;
  onToggleWorktree: (next: boolean) => void;
  worktreeBranch: string | null;
  onSelectWorktreeBranch: (branch: string | null) => void;
  envVars: EnvVar[];
  onEnvChange: (vars: EnvVar[]) => void;
  preCommands: string;
  onPreCommandsChange: (value: string) => void;
  onClearPreCommands: () => void;
  startEnabled: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

const EMPTY_BRANCHES: GitBranchInfo[] = [];

export default function NewSessionDialog({
  open,
  selectedAgent,
  agentAvailability,
  onSelectAgent,
  repoPath,
  recentDirs,
  onSelectRepo,
  onBrowseRepo,
  repoHint,
  worktreeEnabled,
  onToggleWorktree,
  worktreeBranch,
  onSelectWorktreeBranch,
  envVars,
  onEnvChange,
  preCommands,
  onPreCommandsChange,
  onClearPreCommands,
  startEnabled,
  onClose,
  onSubmit,
}: NewSessionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isMac = useMemo(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform), []);
  const [branchList, setBranchList] = useState<GitBranchInfo[]>(EMPTY_BRANCHES);
  const [branchListLoading, setBranchListLoading] = useState(false);
  const [branchListError, setBranchListError] = useState<string | null>(null);

  const trimmedRepoPath = repoPath.trim();

  useEffect(() => {
    if (!open || !trimmedRepoPath) {
      setBranchList(EMPTY_BRANCHES);
      setBranchListError(null);
      setBranchListLoading(false);
      return;
    }
    let cancelled = false;
    setBranchListLoading(true);
    setBranchListError(null);
    invoke<GitBranchInfo[]>("list_git_branches", { path: trimmedRepoPath })
      .then((branches) => {
        if (!cancelled) {
          setBranchList(branches);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBranchList(EMPTY_BRANCHES);
          setBranchListError(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBranchListLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, trimmedRepoPath]);

  const handleSubmitShortcut = (event: React.KeyboardEvent) => {
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
    if (startEnabled) {
      onSubmit();
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    let rafId: number | null = null;
    if (open && !dialog.open) {
      dialog.showModal();
      rafId = requestAnimationFrame(() => {
        const trigger = dialog.querySelector<HTMLButtonElement>("[data-repo-picker-trigger]");
        trigger?.focus();
      });
    }
    if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onKeyDown={handleSubmitShortcut}
      >
        <div className={styles.header}>
          <div>
            <h2>New Session</h2>
          </div>
          <IconButton
            aria-label="Close"
            variant="raised"
            shape="circle"
            size="lg"
            tone="danger"
            iconSize={16}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>

        <div className={styles.grid}>
          <div className={styles.fieldFull}>
            <span>Agent CLI</span>
            <AgentPicker selected={selectedAgent} availability={agentAvailability} onSelect={onSelectAgent} />
          </div>

          <label className={styles.fieldFull}>
            <span>Repository path</span>
            <RepoPicker
              value={repoPath}
              recentDirs={recentDirs}
              onSelect={onSelectRepo}
              onBrowse={onBrowseRepo}
              worktreeEnabled={worktreeEnabled}
              onToggleWorktree={onToggleWorktree}
            />
            {repoHint ? <span className={styles.hint}>{repoHint}</span> : null}
          </label>

          {worktreeEnabled && repoPath.trim() ? (
            <div className={styles.fieldFull}>
              <span>Worktree branch (optional)</span>
              <BranchPicker
                branches={branchList}
                loading={branchListLoading}
                error={branchListError}
                value={worktreeBranch}
                onSelect={onSelectWorktreeBranch}
              />
            </div>
          ) : null}

          <div className={styles.fieldFull}>
            <span>Environment variables (optional)</span>
            <EnvList envVars={envVars} onChange={onEnvChange} />
          </div>

          <label className={styles.fieldFull}>
            <span className={styles.fieldHeader}>
              <span>Commands to run before agent (optional)</span>
              <Button
                variant="ghost"
                type="button"
                className={styles.clearButton}
                onClick={onClearPreCommands}
                disabled={preCommands.trim().length === 0}
              >
                Clear
              </Button>
            </span>
            <textarea
              className={styles.input}
              rows={3}
              placeholder="# e.g. setup commands\nnpm install"
              value={preCommands}
              onChange={(event) => onPreCommandsChange(event.target.value)}
            />
          </label>
        </div>

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!startEnabled}>
            Start
          </Button>
        </div>
      </form>
    </dialog>
  );
}

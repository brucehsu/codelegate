import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { AgentId, EnvVar } from "../../types";
import AgentPicker from "../AgentPicker/AgentPicker";
import RepoPicker from "../RepoPicker/RepoPicker";
import EnvList from "../EnvList/EnvList";
import Button from "../Button/Button";
import IconButton from "../IconButton/IconButton";
import styles from "./NewSessionDialog.module.css";

interface NewSessionDialogProps {
  open: boolean;
  selectedAgent: AgentId;
  onSelectAgent: (agent: AgentId) => void;
  repoPath: string;
  recentDirs: string[];
  onSelectRepo: (path: string) => void;
  onBrowseRepo: () => void;
  repoHint?: string;
  worktreeEnabled: boolean;
  onToggleWorktree: (next: boolean) => void;
  worktreePath: string;
  onWorktreePathChange: (value: string) => void;
  worktreeBranch: string;
  onWorktreeBranchChange: (value: string) => void;
  envVars: EnvVar[];
  onEnvChange: (vars: EnvVar[]) => void;
  preCommands: string;
  onPreCommandsChange: (value: string) => void;
  startEnabled: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

export default function NewSessionDialog({
  open,
  selectedAgent,
  onSelectAgent,
  repoPath,
  recentDirs,
  onSelectRepo,
  onBrowseRepo,
  repoHint,
  worktreeEnabled,
  onToggleWorktree,
  worktreePath,
  onWorktreePathChange,
  worktreeBranch,
  onWorktreeBranchChange,
  envVars,
  onEnvChange,
  preCommands,
  onPreCommandsChange,
  startEnabled,
  onClose,
  onSubmit,
}: NewSessionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
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
      >
        <div className={styles.header}>
          <div>
            <h3>New Session</h3>
            <p>Launch a local agent session for a repository.</p>
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
            <AgentPicker selected={selectedAgent} onSelect={onSelectAgent} />
          </div>

          <label className={styles.fieldFull}>
            <span>Repository path</span>
            <RepoPicker
              value={repoPath}
              recentDirs={recentDirs}
              onSelect={onSelectRepo}
              onBrowse={onBrowseRepo}
            />
            {repoHint ? <span className={styles.hint}>{repoHint}</span> : null}
          </label>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={worktreeEnabled}
              onChange={(event) => onToggleWorktree(event.target.checked)}
            />
            <span>Create git worktree</span>
          </label>

          <div className={`${styles.worktreeFields} ${worktreeEnabled ? "" : styles.hidden}`}>
            <label className={styles.field}>
              <span>Worktree path</span>
              <input
                className={styles.input}
                placeholder="/path/to/worktree"
                value={worktreePath}
                onChange={(event) => onWorktreePathChange(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Branch (optional)</span>
              <input
                className={styles.input}
                placeholder="feature/my-branch"
                value={worktreeBranch}
                onChange={(event) => onWorktreeBranchChange(event.target.value)}
              />
            </label>
          </div>

          <div className={styles.fieldFull}>
            <span>Environment variables (optional)</span>
            <EnvList envVars={envVars} onChange={onEnvChange} />
          </div>

          <label className={styles.fieldFull}>
            <span>Commands to run before agent (optional)</span>
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

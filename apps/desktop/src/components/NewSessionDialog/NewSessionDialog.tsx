import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { AgentId, EnvVar } from "../../types";
import AgentPicker from "../AgentPicker/AgentPicker";
import RepoPicker from "../RepoPicker/RepoPicker";
import EnvList from "../EnvList/EnvList";
import Button from "../ui/Button/Button";
import IconButton from "../ui/IconButton/IconButton";
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
  envVars: EnvVar[];
  onEnvChange: (vars: EnvVar[]) => void;
  preCommands: string;
  onPreCommandsChange: (value: string) => void;
  onClearPreCommands: () => void;
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
            <AgentPicker selected={selectedAgent} onSelect={onSelectAgent} />
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

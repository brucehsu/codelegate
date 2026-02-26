import { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import Button from "../ui/Button/Button";
import IconButton from "../ui/IconButton/IconButton";
import styles from "./TerminateSessionDialog.module.css";

interface TerminateSessionDialogProps {
  open: boolean;
  sessionLabel?: string;
  canDeleteWorktree: boolean;
  deleteWorktree: boolean;
  onDeleteWorktreeChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export default function TerminateSessionDialog({
  open,
  sessionLabel,
  canDeleteWorktree,
  deleteWorktree,
  onDeleteWorktreeChange,
  onClose,
  onConfirm,
}: TerminateSessionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isMac = useMemo(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform), []);

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
    onConfirm();
  };

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

  const title = sessionLabel ? `Terminate session \"${sessionLabel}\"?` : "Terminate this session?";

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
          onConfirm();
        }}
        onKeyDown={handleSubmitShortcut}
      >
        <div className={styles.header}>
          <div>
            <h3>{title}</h3>
            <p className={styles.subtitle}>This will close the tab and stop ongoing shell sessions.</p>
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

        {canDeleteWorktree ? (
          <div className={styles.body}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={deleteWorktree}
                onChange={(event) => onDeleteWorktreeChange(event.target.checked)}
              />
              <span className={styles.checkboxLabel}>Delete worktree branch and directory.</span>
            </label>
          </div>
        ) : null}

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Terminate
          </Button>
        </div>
      </form>
    </dialog>
  );
}

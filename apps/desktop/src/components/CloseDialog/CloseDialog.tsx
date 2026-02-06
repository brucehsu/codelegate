import { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import Button from "../ui/Button/Button";
import IconButton from "../ui/IconButton/IconButton";
import styles from "./CloseDialog.module.css";

interface CloseDialogProps {
  open: boolean;
  hasRunning: boolean;
  sessionCount: number;
  remember: boolean;
  onRememberChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export default function CloseDialog({
  open,
  hasRunning,
  sessionCount,
  remember,
  onRememberChange,
  onClose,
  onConfirm,
}: CloseDialogProps) {
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

  const sessionLabel = sessionCount === 1 ? "1 session" : `${sessionCount} sessions`;
  const checkboxLabel = sessionCount > 0 ? `Remember ${sessionLabel}.` : "Remember sessions.";
  const description = hasRunning
    ? "Active sessions are still running. Closing will stop them."
    : "This will close Codelegate.";

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
            <h3>Close Codelegate?</h3>
            <p className={styles.subtitle}>{description}</p>
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

        <div className={styles.body}>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={remember}
              onChange={(event) => onRememberChange(event.target.checked)}
            />
            <span className={styles.checkboxLabel}>{checkboxLabel}</span>
          </label>
        </div>

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Close
          </Button>
        </div>
      </form>
    </dialog>
  );
}

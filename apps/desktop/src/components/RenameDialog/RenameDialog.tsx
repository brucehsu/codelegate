import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import IconButton from "../IconButton/IconButton";
import Button from "../Button/Button";
import styles from "./RenameDialog.module.css";

interface RenameDialogProps {
  open: boolean;
  title?: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function RenameDialog({
  open,
  title,
  value,
  onChange,
  onClose,
  onSave,
}: RenameDialogProps) {
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
          onSave();
        }}
      >
        <div className={styles.header}>
          <div>
            <h3>{title ?? "Rename Branch"}</h3>
          
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
          <label className={styles.field}>
            <input
              className={styles.input}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="feature/my-branch"
              autoFocus
            />
          </label>
        </div>

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Rename
          </Button>
        </div>
      </form>
    </dialog>
  );
}

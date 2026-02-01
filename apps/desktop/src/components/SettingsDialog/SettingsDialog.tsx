import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import IconButton from "../IconButton/IconButton";
import Button from "../Button/Button";
import styles from "./SettingsDialog.module.css";

interface SettingsDialogProps {
  open: boolean;
  fontFamily: string;
  fontSize: number;
  onChangeFontFamily: (value: string) => void;
  onChangeFontSize: (value: number) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function SettingsDialog({
  open,
  fontFamily,
  fontSize,
  onChangeFontFamily,
  onChangeFontSize,
  onClose,
  onSave,
}: SettingsDialogProps) {
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
            <h3>Settings</h3>
            <p>Customize your terminal experience.</p>
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
            <span>Terminal font family</span>
            <input
              className={styles.input}
              value={fontFamily}
              onChange={(event) => onChangeFontFamily(event.target.value)}
              placeholder='"JetBrains Mono", monospace'
            />
          </label>
          <label className={styles.field}>
            <span>Terminal font size</span>
            <input
              className={styles.input}
              type="number"
              min={10}
              max={32}
              value={fontSize}
              onChange={(event) => onChangeFontSize(Number(event.target.value))}
            />
          </label>
        </div>

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </dialog>
  );
}

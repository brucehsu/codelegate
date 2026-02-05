import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import IconButton from "../ui/IconButton/IconButton";
import Button from "../ui/Button/Button";
import {
  formatShortcutModifier,
  modifierFromKeyboardEvent,
  normalizeShortcutModifier,
} from "../../utils/shortcutModifier";
import styles from "./SettingsDialog.module.css";

interface SettingsDialogProps {
  open: boolean;
  fontFamily: string;
  fontSize: number;
  batterySaver: boolean;
  shortcutModifier: string;
  onChangeFontFamily: (value: string) => void;
  onChangeFontSize: (value: number) => void;
  onToggleBatterySaver: (value: boolean) => void;
  onCommitShortcutModifier: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function SettingsDialog({
  open,
  fontFamily,
  fontSize,
  batterySaver,
  shortcutModifier,
  onChangeFontFamily,
  onChangeFontSize,
  onToggleBatterySaver,
  onCommitShortcutModifier,
  onClose,
  onSave,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fontFamilyInputRef = useRef<HTMLInputElement>(null);
  const shortcutModifierInputRef = useRef<HTMLInputElement>(null);
  const shortcutModifierRef = useRef(normalizeShortcutModifier(shortcutModifier));
  const shortcutModifierDraftRef = useRef(normalizeShortcutModifier(shortcutModifier));

  useEffect(() => {
    const normalized = normalizeShortcutModifier(shortcutModifier);
    shortcutModifierRef.current = normalized;
    shortcutModifierDraftRef.current = normalized;
    const input = shortcutModifierInputRef.current;
    if (input) {
      input.value = formatShortcutModifier(normalized);
    }
  }, [shortcutModifier]);

  const updateShortcutModifierInput = (modifier: string) => {
    const input = shortcutModifierInputRef.current;
    if (input) {
      input.value = formatShortcutModifier(modifier);
    }
  };

  const handleShortcutModifierCancel = () => {
    const fallback = shortcutModifierRef.current;
    shortcutModifierDraftRef.current = fallback;
    updateShortcutModifierInput(fallback);
  };

  const handleShortcutModifierCommit = () => {
    const normalized = normalizeShortcutModifier(shortcutModifierDraftRef.current);
    shortcutModifierDraftRef.current = normalized;
    shortcutModifierRef.current = normalized;
    updateShortcutModifierInput(normalized);
    onCommitShortcutModifier(normalized);
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
        fontFamilyInputRef.current?.focus();
        fontFamilyInputRef.current?.select();
        updateShortcutModifierInput(shortcutModifierRef.current);
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
              ref={fontFamilyInputRef}
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
          <label className={styles.field}>
            <span>Shortcut modifier</span>
            <input
              ref={shortcutModifierInputRef}
              className={styles.input}
              defaultValue={formatShortcutModifier(shortcutModifierRef.current)}
              readOnly
              onFocus={() => {
                updateShortcutModifierInput(shortcutModifierDraftRef.current);
              }}
              onBlur={() => {
                handleShortcutModifierCancel();
              }}
              onKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Escape") {
                  handleShortcutModifierCancel();
                  shortcutModifierInputRef.current?.blur();
                  return;
                }
                if (event.key === "Enter") {
                  handleShortcutModifierCommit();
                  shortcutModifierInputRef.current?.blur();
                  return;
                }
                const captured = modifierFromKeyboardEvent(event);
                if (!captured) {
                  return;
                }
                const normalized = normalizeShortcutModifier(captured);
                shortcutModifierDraftRef.current = normalized;
                updateShortcutModifierInput(normalized);
              }}
              onKeyUp={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const captured = modifierFromKeyboardEvent(event);
                if (!captured) {
                  return;
                }
                const normalized = normalizeShortcutModifier(captured);
                shortcutModifierDraftRef.current = normalized;
                updateShortcutModifierInput(normalized);
              }}
            />
            <p className={styles.fieldHint}>Click and press modifiers. Enter to save, Esc to cancel.</p>
          </label>
          <div className={styles.toggleRow}>
            <div>
              <span>Battery saver</span>
              <p className={styles.toggleHint}>Disable animated background to save battery.</p>
            </div>
            <button
              type="button"
              className={`${styles.toggle} ${batterySaver ? styles.toggleActive : ""}`}
              aria-pressed={batterySaver}
              onClick={() => onToggleBatterySaver(!batterySaver)}
            >
              <span className={styles.toggleKnob} />
            </button>
          </div>
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

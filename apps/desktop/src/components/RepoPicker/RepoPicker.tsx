import { useEffect, useRef, useState } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import styles from "./RepoPicker.module.css";
import Button from "../Button/Button";

interface RepoPickerProps {
  value: string;
  recentDirs: string[];
  onSelect: (path: string) => void;
  onBrowse: () => void;
  worktreeEnabled: boolean;
  onToggleWorktree: (next: boolean) => void;
}

export default function RepoPicker({
  value,
  recentDirs,
  onSelect,
  onBrowse,
  worktreeEnabled,
  onToggleWorktree,
}: RepoPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const placeholder = value ? value : "Select a directory";

  return (
    <div className={styles.row}>
      <div className={`${styles.selectField} ${open ? styles.open : ""}`} ref={rootRef}>
        <button
          type="button"
          className={`${styles.trigger} ${value ? "" : styles.placeholder}`}
          onClick={() => setOpen((prev) => !prev)}
        >
          <span>{placeholder}</span>
          <ChevronDown className={styles.icon} aria-hidden="true" />
        </button>
        <div className={styles.menu}>
          {recentDirs.length === 0 ? (
            <div className={`${styles.item} ${styles.disabled}`}>No recent directories</div>
          ) : (
            recentDirs.map((dir) => (
              <button
                key={dir}
                type="button"
                className={styles.item}
                onClick={() => {
                  onSelect(dir);
                  setOpen(false);
                }}
              >
                {dir}
              </button>
            ))
          )}
        </div>
      </div>
      <Button variant="ghost" onClick={onBrowse}>
        Browse
      </Button>
      <button
        type="button"
        className={`${styles.toggle} ${worktreeEnabled ? styles.toggleActive : ""}`}
        onClick={() => onToggleWorktree(!worktreeEnabled)}
        aria-pressed={worktreeEnabled}
      >
        <GitBranch className={styles.toggleIcon} aria-hidden="true" />
        <span>Git Worktree</span>
      </button>
    </div>
  );
}

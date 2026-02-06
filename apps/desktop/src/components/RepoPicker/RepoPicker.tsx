import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import styles from "./RepoPicker.module.css";
import Button from "../ui/Button/Button";

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
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedIndex = recentDirs.indexOf(value);

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

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return;
    }
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function selectByIndex(nextIndex: number) {
    const dir = recentDirs[nextIndex];
    if (!dir) {
      return;
    }
    setActiveIndex(nextIndex);
    onSelect(dir);
  }

  function getNextIndex(step: -1 | 1) {
    if (recentDirs.length === 0) {
      return -1;
    }

    const baseIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
    if (baseIndex < 0) {
      return step > 0 ? 0 : recentDirs.length - 1;
    }

    return Math.max(0, Math.min(recentDirs.length - 1, baseIndex + step));
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && recentDirs.length > 0) {
      event.preventDefault();
      setOpen(true);
      const nextIndex = getNextIndex(event.key === "ArrowDown" ? 1 : -1);
      if (nextIndex >= 0) {
        selectByIndex(nextIndex);
      }
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && !open) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const placeholder = value ? value : "Select a directory";

  return (
    <div className={styles.row}>
      <div className={`${styles.selectField} ${open ? styles.open : ""}`} ref={rootRef}>
        <button
          type="button"
          className={`${styles.trigger} ${value ? "" : styles.placeholder}`}
          onClick={() => setOpen((prev) => !prev)}
          onKeyDown={handleTriggerKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={menuId}
          data-repo-picker-trigger
        >
          <span>{placeholder}</span>
          <ChevronDown className={styles.icon} aria-hidden="true" />
        </button>
        <div className={styles.menu} id={menuId} role="listbox" aria-label="Recent directories">
          {recentDirs.length === 0 ? (
            <div className={`${styles.item} ${styles.disabled}`}>No recent directories</div>
          ) : (
            recentDirs.map((dir, index) => (
              <button
                key={dir}
                type="button"
                className={`${styles.item} ${activeIndex === index ? styles.itemActive : ""}`}
                role="option"
                aria-selected={value === dir}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                onClick={() => {
                  onSelect(dir);
                  setActiveIndex(index);
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

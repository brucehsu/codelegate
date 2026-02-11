import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const filteredDirs = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) {
      return recentDirs;
    }
    return recentDirs.filter((dir) => dir.toLowerCase().includes(needle));
  }, [recentDirs, searchQuery]);
  const selectedIndex = filteredDirs.indexOf(value);

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
      setSearchQuery("");
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return;
    }
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (filteredDirs.length === 0) {
      setActiveIndex(-1);
      return;
    }
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
      return;
    }
    setActiveIndex(0);
  }, [open, filteredDirs, selectedIndex]);

  function selectByIndex(nextIndex: number) {
    const dir = filteredDirs[nextIndex];
    if (!dir) {
      return;
    }
    setActiveIndex(nextIndex);
    onSelect(dir);
  }

  function getNextIndex(step: -1 | 1) {
    if (filteredDirs.length === 0) {
      return -1;
    }

    const baseIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
    if (baseIndex < 0) {
      return step > 0 ? 0 : filteredDirs.length - 1;
    }

    return Math.max(0, Math.min(filteredDirs.length - 1, baseIndex + step));
  }

  function isTypeaheadKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
  }

  function applyTypeaheadKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!isTypeaheadKey(event)) {
      return false;
    }

    event.preventDefault();
    setOpen(true);
    if (event.key === " ") {
      return true;
    }

    setSearchQuery((prev) => `${prev}${event.key}`);
    return true;
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (applyTypeaheadKey(event)) {
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      setOpen(true);
      setSearchQuery((prev) => prev.slice(0, -1));
      return;
    }

    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && filteredDirs.length > 0) {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
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

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = getNextIndex(event.key === "ArrowDown" ? 1 : -1);
      if (nextIndex >= 0) {
        selectByIndex(nextIndex);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0) {
        const dir = filteredDirs[activeIndex];
        if (dir) {
          onSelect(dir);
          setOpen(false);
        }
      }
      return;
    }

    if (event.key === "Escape") {
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
        <div className={styles.menuPanel}>
          <input
            ref={searchInputRef}
            type="text"
            className={styles.searchInput}
            placeholder="Search recent directories"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            aria-label="Search recent directories"
          />
          <div className={styles.menu} id={menuId} role="listbox" aria-label="Recent directories">
            {recentDirs.length === 0 ? (
              <div className={`${styles.item} ${styles.disabled}`}>No recent directories</div>
            ) : filteredDirs.length === 0 ? (
              <div className={`${styles.item} ${styles.disabled}`}>No matching directories</div>
            ) : (
              filteredDirs.map((dir, index) => (
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

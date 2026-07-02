import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./BranchPicker.module.css";
import type { GitBranchInfo } from "../../types";

interface BranchPickerProps {
  branches: GitBranchInfo[];
  loading: boolean;
  error: string | null;
  value: string | null; // null = auto-create a new branch (the default)
  onSelect: (branch: string | null) => void;
}

interface BranchRow {
  value: string | null;
  label: string;
  worktreePath?: string | null;
}

const AUTO_LABEL = "New branch (auto)";

function isDisabledRow(row: BranchRow): boolean {
  return Boolean(row.worktreePath);
}

export default function BranchPicker({ branches, loading, error, value, onSelect }: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const filteredBranches = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) {
      return branches;
    }
    return branches.filter((branch) => branch.name.toLowerCase().includes(needle));
  }, [branches, searchQuery]);

  const statusMessage = loading
    ? "Loading branches…"
    : error
      ? "Branches unavailable"
      : branches.length === 0
        ? "No local branches"
        : filteredBranches.length === 0
          ? "No matching branches"
          : null;

  // Row 0 is always the auto option; branch rows follow unless a status row replaces them.
  const rows = useMemo<BranchRow[]>(() => {
    const items: BranchRow[] = [{ value: null, label: AUTO_LABEL }];
    if (!statusMessage) {
      filteredBranches.forEach((branch) => {
        items.push({ value: branch.name, label: branch.name, worktreePath: branch.worktreePath });
      });
    }
    return items;
  }, [filteredBranches, statusMessage]);

  const selectedIndex = useMemo(
    () => rows.findIndex((row) => row.value === value && !isDisabledRow(row)),
    [rows, value]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
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
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setActiveIndex(-1);
      return;
    }
    // The auto row at index 0 is always enabled, so there is always a fallback.
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return;
    }
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function nextEnabledIndex(step: 1 | -1): number {
    const start = activeIndex >= 0 ? activeIndex : selectedIndex;
    for (let index = start + step; index >= 0 && index < rows.length; index += step) {
      if (!isDisabledRow(rows[index])) {
        return index;
      }
    }
    return -1;
  }

  function selectRow(index: number, close: boolean) {
    const row = rows[index];
    if (!row || isDisabledRow(row)) {
      return;
    }
    setActiveIndex(index);
    onSelect(row.value);
    if (close) {
      setOpen(false);
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const nextIndex = nextEnabledIndex(event.key === "ArrowDown" ? 1 : -1);
      if (nextIndex >= 0) {
        selectRow(nextIndex, false);
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
      const nextIndex = nextEnabledIndex(event.key === "ArrowDown" ? 1 : -1);
      if (nextIndex >= 0) {
        selectRow(nextIndex, false);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0) {
        selectRow(activeIndex, true);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`${styles.selectField} ${open ? styles.open : ""}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`${styles.trigger} ${value === null ? styles.placeholder : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <span>{value ?? AUTO_LABEL}</span>
        <ChevronDown className={styles.icon} aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.menuPanel}>
          <input
            ref={searchInputRef}
            type="text"
            className={styles.searchInput}
            placeholder="Search branches"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            aria-label="Search branches"
          />
          <div className={styles.menu} id={menuId} role="listbox" aria-label="Branches">
            {rows.map((row, index) =>
              isDisabledRow(row) ? (
                <div
                  key={row.value ?? "__auto__"}
                  className={`${styles.item} ${styles.branchRow} ${styles.disabled}`}
                  role="option"
                  aria-disabled="true"
                >
                  <span className={styles.branchName}>{row.label}</span>
                  <span className={styles.branchPath} title={row.worktreePath ?? undefined}>
                    {row.worktreePath}
                  </span>
                </div>
              ) : (
                <button
                  key={row.value ?? "__auto__"}
                  type="button"
                  className={`${styles.item} ${styles.branchRow} ${activeIndex === index ? styles.itemActive : ""}`}
                  role="option"
                  aria-selected={value === row.value}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  onClick={() => selectRow(index, true)}
                >
                  <span className={styles.branchName}>{row.label}</span>
                </button>
              )
            )}
            {statusMessage ? (
              <div
                className={`${styles.item} ${styles.disabled}`}
                role="option"
                aria-disabled="true"
                title={error ?? undefined}
              >
                {statusMessage}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

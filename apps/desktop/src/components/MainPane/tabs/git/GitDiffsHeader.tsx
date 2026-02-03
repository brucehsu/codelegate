import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import ActionButton from "../../../ui/ActionButton/ActionButton";
import styles from "./GitDiff.module.css";

interface GitDiffsHeaderProps {
  title: string;
  fileCount: number;
  additions: number;
  deletions: number;
  isOpen: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  refreshDisabled?: boolean;
}

export default function GitDiffsHeader({
  title,
  fileCount,
  additions,
  deletions,
  isOpen,
  onToggle,
  onRefresh,
  refreshDisabled = false,
}: GitDiffsHeaderProps) {
  return (
    <div className={styles.diffSummary}>
      <button type="button" className={styles.diffSummaryToggle} onClick={onToggle} aria-expanded={isOpen}>
        <span className={styles.diffSummaryTitle}>{title}</span>
        <span className={styles.diffSummaryStats}>
          <span className={styles.diffSummaryFiles}>{fileCount} files</span>
          <span className={styles.diffSummaryDot}>•</span>
          <span className={styles.diffSummaryAdd}>+{additions}</span>
          <span className={styles.diffSummarySlash}>/</span>
          <span className={styles.diffSummaryDel}>-{deletions}</span>
        </span>
      </button>
      <ActionButton icon={<RefreshCw size={16} aria-hidden="true" />} onClick={onRefresh} disabled={refreshDisabled}>
        Refresh
      </ActionButton>
      <ActionButton
        variant="ghost"
        aria-label={isOpen ? "Collapse section" : "Expand section"}
        onClick={onToggle}
        icon={isOpen ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
      />
    </div>
  );
}

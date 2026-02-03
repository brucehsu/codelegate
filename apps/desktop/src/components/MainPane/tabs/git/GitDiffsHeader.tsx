import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import ActionButton from "../../../ui/ActionButton/ActionButton";
import CollapsibleSection from "../../../ui/CollapsibleSection/CollapsibleSection";
import styles from "./GitDiff.module.css";

interface GitDiffsHeaderProps {
  title: ReactNode;
  fileCount?: number;
  additions?: number;
  deletions?: number;
  isOpen: boolean;
  onToggle: () => void;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  showStats?: boolean;
  showRefresh?: boolean;
  children?: ReactNode;
  bodyClassName?: string;
}

export default function GitDiffsHeader({
  title,
  fileCount = 0,
  additions = 0,
  deletions = 0,
  isOpen,
  onToggle,
  onRefresh,
  refreshDisabled = false,
  showStats = true,
  showRefresh = true,
  children,
  bodyClassName,
}: GitDiffsHeaderProps) {
  const shouldShowStats = showStats;
  const shouldShowRefresh = showRefresh && Boolean(onRefresh);
  return (
    <CollapsibleSection
      title={
        <>
          <span className={styles.diffSummaryTitle}>{title}</span>
          {shouldShowStats ? (
            <span className={styles.diffSummaryStats}>
              <span className={styles.diffSummaryFiles}>{fileCount} files</span>
              <span className={styles.diffSummaryDot}>•</span>
              <span className={styles.diffSummaryAdd}>+{additions}</span>
              <span className={styles.diffSummarySlash}>/</span>
              <span className={styles.diffSummaryDel}>-{deletions}</span>
            </span>
          ) : null}
        </>
      }
      isOpen={isOpen}
      onToggle={onToggle}
      showChevron={false}
      headerClassName={styles.diffSummary}
      toggleClassName={styles.diffSummaryToggle}
      titleClassName={styles.diffSummaryTitleWrap}
      actionsClassName={styles.diffSummaryActions}
      bodyClassName={bodyClassName}
      actions={
        <>
          {shouldShowRefresh ? (
            <ActionButton
              icon={<RefreshCw size={16} aria-hidden="true" />}
              onClick={onRefresh}
              disabled={refreshDisabled}
            >
              Refresh
            </ActionButton>
          ) : null}
          <ActionButton
            variant="ghost"
            aria-label={isOpen ? "Collapse section" : "Expand section"}
            onClick={onToggle}
            icon={isOpen ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
          />
        </>
      }
    >
      {children}
    </CollapsibleSection>
  );
}

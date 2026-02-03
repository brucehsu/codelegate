import type { Session } from "../../../types";
import GitDiffPane from "../../GitDiffPane/GitDiffPane";
import styles from "../MainPane.module.css";

interface GitTabProps {
  session?: Session;
  isActive: boolean;
}

export default function GitTab({ session, isActive }: GitTabProps) {
  return (
    <div className={`${styles.gitPane} ${isActive ? "" : styles.terminalHidden}`}>
      <GitDiffPane session={session} isActive={isActive} />
    </div>
  );
}

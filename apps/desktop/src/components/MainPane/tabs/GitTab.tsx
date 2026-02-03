import type { Session } from "../../../types";
import GitDiff from "./git/GitDiff";
import styles from "../MainPane.module.css";

interface GitTabProps {
  session?: Session;
  isActive: boolean;
}

export default function GitTab({ session, isActive }: GitTabProps) {
  return (
    <div className={`${styles.gitPane} ${isActive ? "" : styles.terminalHidden}`}>
      <GitDiff session={session} isActive={isActive} />
    </div>
  );
}

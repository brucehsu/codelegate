import type { Session, ToastInput } from "../../../types";
import GitDiff from "./git/GitDiff";
import styles from "../MainPane.module.css";

interface GitTabProps {
  session?: Session;
  isActive: boolean;
  onNotify: (toast: ToastInput) => void;
  onRefreshBranch?: () => Promise<void>;
}

export default function GitTab({ session, isActive, onNotify, onRefreshBranch }: GitTabProps) {
  return (
    <div className={`${styles.gitPane} ${isActive ? "" : styles.terminalHidden}`}>
      <GitDiff session={session} isActive={isActive} onNotify={onNotify} onRefreshBranch={onRefreshBranch} />
    </div>
  );
}

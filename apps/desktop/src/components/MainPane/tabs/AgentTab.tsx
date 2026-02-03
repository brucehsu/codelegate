import { ChevronDown } from "lucide-react";
import type { PaneKind, Session } from "../../../types";
import styles from "../MainPane.module.css";

interface AgentTabProps {
  sessions: Session[];
  activeSessionId: string | null;
  isActive: boolean;
  onRegisterTerminal: (sessionId: string, kind: PaneKind, element: HTMLDivElement | null) => void;
  showUpdates: boolean;
  onJumpToBottom: (sessionId: string, kind: PaneKind) => void;
}

export default function AgentTab({
  sessions,
  activeSessionId,
  isActive,
  onRegisterTerminal,
  showUpdates,
  onJumpToBottom,
}: AgentTabProps) {
  return (
    <div className={`${styles.terminalStack} ${isActive ? "" : styles.terminalHidden}`}>
      {sessions.map((session) => (
        <div
          key={session.id}
          ref={(el) => onRegisterTerminal(session.id, "agent", el)}
          className={`${styles.terminalSession} ${activeSessionId === session.id ? "" : styles.terminalHidden}`}
        />
      ))}
      {showUpdates && activeSessionId ? (
        <button type="button" className={styles.newUpdates} onClick={() => onJumpToBottom(activeSessionId, "agent")}>
          <span>Jump to latest</span>
          <ChevronDown aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

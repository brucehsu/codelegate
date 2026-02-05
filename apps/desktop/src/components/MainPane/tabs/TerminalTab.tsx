import { useCallback, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import type { PaneKind, Session } from "../../../types";
import styles from "../MainPane.module.css";

interface TerminalTabProps {
  sessions: Session[];
  activeSessionId: string | null;
  isActive: boolean;
  onRegisterTerminal: (sessionId: string, kind: PaneKind, element: HTMLDivElement | null) => void;
  showUpdates: boolean;
  onJumpToBottom: (sessionId: string, kind: PaneKind) => void;
}

export default function TerminalTab({
  sessions,
  activeSessionId,
  isActive,
  onRegisterTerminal,
  showUpdates,
  onJumpToBottom,
}: TerminalTabProps) {
  const refCallbacksRef = useRef(new Map<string, (element: HTMLDivElement | null) => void>());

  useEffect(() => {
    refCallbacksRef.current.clear();
  }, [onRegisterTerminal]);

  useEffect(() => {
    const activeIds = new Set(sessions.map((session) => session.id));
    refCallbacksRef.current.forEach((_callback, sessionId) => {
      if (!activeIds.has(sessionId)) {
        refCallbacksRef.current.delete(sessionId);
      }
    });
  }, [sessions]);

  const getSessionRef = useCallback(
    (sessionId: string) => {
      const existing = refCallbacksRef.current.get(sessionId);
      if (existing) {
        return existing;
      }
      const callback = (element: HTMLDivElement | null) => {
        onRegisterTerminal(sessionId, "terminal", element);
      };
      refCallbacksRef.current.set(sessionId, callback);
      return callback;
    },
    [onRegisterTerminal]
  );

  return (
    <div className={`${styles.terminalStack} ${isActive ? "" : styles.terminalHidden}`}>
      {sessions.map((session) => (
        <div
          key={session.id}
          ref={getSessionRef(session.id)}
          className={`${styles.terminalSession} ${activeSessionId === session.id ? "" : styles.terminalHidden}`}
        />
      ))}
      {showUpdates && activeSessionId ? (
        <button
          type="button"
          className={styles.newUpdates}
          onClick={() => onJumpToBottom(activeSessionId, "terminal")}
        >
          <span>Jump to latest</span>
          <ChevronDown aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

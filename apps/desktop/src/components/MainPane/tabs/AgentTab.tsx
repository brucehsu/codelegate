import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import type { PaneKind, Session } from "../../../types";
import styles from "../MainPane.module.css";

interface AgentTabProps {
  sessions: Session[];
  activeSessionId: string | null;
  isActive: boolean;
  onRegisterTerminal: (sessionId: string, kind: PaneKind, element: HTMLDivElement | null) => void;
  showUpdates: boolean;
  showShortcutHints?: boolean;
  onJumpToBottom: (sessionId: string, kind: PaneKind) => void;
  showRestart: boolean;
  onRestart: () => Promise<boolean>;
}

export default function AgentTab({
  sessions,
  activeSessionId,
  isActive,
  onRegisterTerminal,
  showUpdates,
  showShortcutHints = false,
  onJumpToBottom,
  showRestart,
  onRestart,
}: AgentTabProps) {
  const refCallbacksRef = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
  const [isRestarting, setIsRestarting] = useState(false);

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
        onRegisterTerminal(sessionId, "agent", element);
      };
      refCallbacksRef.current.set(sessionId, callback);
      return callback;
    },
    [onRegisterTerminal]
  );

  useEffect(() => {
    if (!showRestart && isRestarting) {
      setIsRestarting(false);
    }
  }, [isRestarting, showRestart]);

  const handleRestart = useCallback(() => {
    if (isRestarting) {
      return;
    }
    setIsRestarting(true);
    void onRestart()
      .catch(() => {})
      .finally(() => {
        setIsRestarting(false);
      });
  }, [isRestarting, onRestart]);

  return (
    <div className={`${styles.terminalStack} ${isActive ? "" : styles.terminalHidden}`}>
      {sessions.map((session) => (
        <div
          key={session.id}
          ref={getSessionRef(session.id)}
          className={`${styles.terminalSession} ${activeSessionId === session.id ? "" : styles.terminalHidden}`}
        />
      ))}
      {showRestart ? (
        <span className={styles.agentRestartHotkeyWrap}>
          <button
            type="button"
            className={styles.agentRestartButton}
            onClick={handleRestart}
            disabled={isRestarting}
            aria-label="Restart agent process"
          >
            <RefreshCw
              aria-hidden="true"
              className={`${styles.agentRestartIcon} ${isRestarting ? styles.agentRestartIconSpinning : ""}`}
            />
            <span>{isRestarting ? "Restarting..." : "Refresh"}</span>
          </button>
          {showShortcutHints ? (
            <span className={styles.shortcutBadge} aria-hidden="true">
              R
            </span>
          ) : null}
        </span>
      ) : null}
      {showUpdates && activeSessionId && !showRestart ? (
        <button type="button" className={styles.newUpdates} onClick={() => onJumpToBottom(activeSessionId, "agent")}>
          <span>Jump to latest</span>
          <ChevronDown aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

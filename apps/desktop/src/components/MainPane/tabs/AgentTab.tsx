import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import type { AgentId, PaneKind, Session } from "../../../types";
import { agentCatalog } from "../../../constants";
import styles from "../MainPane.module.css";

// Agents that render a terminal div for a session: the active agent plus any
// agent that has ever spawned (so its scrollback survives while backgrounded).
function sessionAgentIds(session: Session): AgentId[] {
  return agentCatalog
    .filter((agent) => agent.id === session.activeAgent || session.agentStates[agent.id])
    .map((agent) => agent.id);
}

function terminalKey(sessionId: string, agentId: AgentId) {
  return `${sessionId}:${agentId}`;
}

interface AgentTabProps {
  sessions: Session[];
  activeSessionId: string | null;
  isActive: boolean;
  onRegisterTerminal: (
    sessionId: string,
    kind: PaneKind,
    element: HTMLDivElement | null,
    agentId?: AgentId
  ) => void;
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
    const activeKeys = new Set<string>();
    sessions.forEach((session) => {
      sessionAgentIds(session).forEach((agentId) => {
        activeKeys.add(terminalKey(session.id, agentId));
      });
    });
    refCallbacksRef.current.forEach((_callback, key) => {
      if (!activeKeys.has(key)) {
        refCallbacksRef.current.delete(key);
      }
    });
  }, [sessions]);

  const getSessionRef = useCallback(
    (sessionId: string, agentId: AgentId) => {
      const key = terminalKey(sessionId, agentId);
      const existing = refCallbacksRef.current.get(key);
      if (existing) {
        return existing;
      }
      const callback = (element: HTMLDivElement | null) => {
        onRegisterTerminal(sessionId, "agent", element, agentId);
      };
      refCallbacksRef.current.set(key, callback);
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
      {sessions.flatMap((session) =>
        sessionAgentIds(session).map((agentId) => {
          const isVisible = activeSessionId === session.id && agentId === session.activeAgent;
          return (
            <div
              key={terminalKey(session.id, agentId)}
              ref={getSessionRef(session.id, agentId)}
              className={`${styles.terminalSession} ${isVisible ? "" : styles.terminalHidden}`}
            />
          );
        })
      )}
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

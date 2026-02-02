import type { Session, TerminalKind } from "../../types";
import styles from "./MainPane.module.css";
import { ChevronDown, Command, Copy } from "lucide-react";

interface MainPaneProps {
  sessions: Session[];
  activeSessionId: string | null;
  activeTerminalKind: TerminalKind;
  onSelectTerminalKind: (kind: TerminalKind) => void;
  onRegisterTerminal: (sessionId: string, kind: TerminalKind, element: HTMLDivElement | null) => void;
  unreadOutput: Record<string, boolean>;
  onJumpToBottom: (sessionId: string, kind: TerminalKind) => void;
}

export default function MainPane({
  sessions,
  activeSessionId,
  activeTerminalKind,
  onSelectTerminalKind,
  onRegisterTerminal,
  unreadOutput,
  onJumpToBottom,
}: MainPaneProps) {
  const showTabPane = Boolean(activeSessionId);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeAgentKey = activeSessionId ? `${activeSessionId}:agent` : null;
  const activeTerminalKey = activeSessionId ? `${activeSessionId}:terminal` : null;
  const showAgentUpdates =
    activeTerminalKind === "agent" && activeAgentKey ? Boolean(unreadOutput[activeAgentKey]) : false;
  const showTerminalUpdates =
    activeTerminalKind === "terminal" && activeTerminalKey ? Boolean(unreadOutput[activeTerminalKey]) : false;

  return (
    <main className={styles.main}>
      <div className={`${styles.tabPane} ${showTabPane ? "" : styles.hidden}`}>
        <div className={styles.tabStrip}>
          <button
            className={`${styles.tab} ${activeTerminalKind === "agent" ? styles.tabActive : ""}`}
            type="button"
            onClick={() => onSelectTerminalKind("agent")}
          >
            Agent
          </button>
          <button
            className={`${styles.tab} ${activeTerminalKind === "terminal" ? styles.tabActive : ""}`}
            type="button"
            onClick={() => onSelectTerminalKind("terminal")}
          >
            Terminal
          </button>
        </div>
        <div className={styles.tabBody}>
          <div className={`${styles.terminalStack} ${activeTerminalKind === "agent" ? "" : styles.terminalHidden}`}>
            {sessions.map((session) => (
              <div
                key={session.id}
                ref={(el) => onRegisterTerminal(session.id, "agent", el)}
                className={`${
                  styles.terminalSession
                } ${activeSessionId === session.id ? "" : styles.terminalHidden}`}
              />
            ))}
            {showAgentUpdates && activeSessionId ? (
              <button
                type="button"
                className={styles.newUpdates}
                onClick={() => onJumpToBottom(activeSessionId, "agent")}
              >
                <span>Jump to latest</span>
                <ChevronDown aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className={`${styles.terminalStack} ${activeTerminalKind === "terminal" ? "" : styles.terminalHidden}`}>
            {sessions.map((session) => (
              <div
                key={session.id}
                ref={(el) => onRegisterTerminal(session.id, "terminal", el)}
                className={`${
                  styles.terminalSession
                } ${activeSessionId === session.id ? "" : styles.terminalHidden}`}
              />
            ))}
            {showTerminalUpdates && activeSessionId ? (
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
        </div>
        <div className={styles.sessionFooter}>
          <span className={styles.sessionPath}>{activeSession?.cwd ?? activeSession?.repo.repoPath ?? ""}</span>
          <button
            type="button"
            className={styles.copyButton}
            aria-label="Copy path"
            onClick={() => {
              const path = activeSession?.cwd ?? activeSession?.repo.repoPath;
              if (path) {
                navigator.clipboard.writeText(path).catch(() => {});
              }
            }}
          >
            <Copy aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={`${styles.emptyState} ${showTabPane ? styles.hidden : ""}`}>
        <div className={styles.emptyLogo}>
          <Command aria-hidden="true" />
        </div>
        <h1>Codelegate</h1>
      </div>
    </main>
  );
}

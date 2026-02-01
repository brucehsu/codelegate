import type { Session, TerminalKind } from "../../types";
import styles from "./MainPane.module.css";
import { Command, Copy } from "lucide-react";

interface MainPaneProps {
  sessions: Session[];
  activeSessionId: string | null;
  activeTerminalKind: TerminalKind;
  onSelectTerminalKind: (kind: TerminalKind) => void;
  onRegisterTerminal: (sessionId: string, kind: TerminalKind, element: HTMLDivElement | null) => void;
}

export default function MainPane({
  sessions,
  activeSessionId,
  activeTerminalKind,
  onSelectTerminalKind,
  onRegisterTerminal,
}: MainPaneProps) {
  const showTabPane = Boolean(activeSessionId);
  const activeSession = sessions.find((session) => session.id === activeSessionId);

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

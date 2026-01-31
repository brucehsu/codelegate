import type { Session } from "../../types";
import styles from "./MainPane.module.css";
import { Command } from "lucide-react";

interface MainPaneProps {
  sessions: Session[];
  activeSessionId: string | null;
  onRegisterTerminal: (sessionId: string, element: HTMLDivElement | null) => void;
}

export default function MainPane({ sessions, activeSessionId, onRegisterTerminal }: MainPaneProps) {
  const showTabPane = Boolean(activeSessionId);

  return (
    <main className={styles.main}>
      <div className={`${styles.tabPane} ${showTabPane ? "" : styles.hidden}`}>
        <div className={styles.tabStrip}>
          <button className={`${styles.tab} ${styles.tabActive}`} type="button" disabled>
            Agent
          </button>
        </div>
        <div className={styles.tabBody}>
          <div className={styles.terminalStack}>
            {sessions.map((session) => (
              <div
                key={session.id}
                ref={(el) => onRegisterTerminal(session.id, el)}
                className={`${
                  styles.terminalSession
                } ${activeSessionId === session.id ? "" : styles.terminalHidden}`}
              />
            ))}
          </div>
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

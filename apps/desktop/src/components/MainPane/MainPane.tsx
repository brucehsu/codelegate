import type { Session, PaneKind } from "../../types";
import AgentTab from "./tabs/AgentTab";
import GitTab from "./tabs/GitTab";
import TerminalTab from "./tabs/TerminalTab";
import styles from "./MainPane.module.css";
import { Command, Copy } from "lucide-react";

interface TabDefinition {
  kind: PaneKind;
  name: string;
  navigationHotKey: string;
}

interface MainPaneProps {
  sessions: Session[];
  activeSessionId: string | null;
  activePaneKind: PaneKind;
  onSelectPaneKind: (kind: PaneKind) => void;
  onRegisterTerminal: (sessionId: string, kind: PaneKind, element: HTMLDivElement | null) => void;
  unreadOutput: Record<string, boolean>;
  onJumpToBottom: (sessionId: string, kind: PaneKind) => void;
  showShortcutHints?: boolean;
}

export default function MainPane({
  sessions,
  activeSessionId,
  activePaneKind,
  onSelectPaneKind,
  onRegisterTerminal,
  unreadOutput,
  onJumpToBottom,
  showShortcutHints = false,
}: MainPaneProps) {
  const showTabPane = Boolean(activeSessionId);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeAgentKey = activeSessionId ? `${activeSessionId}:agent` : null;
  const activeTerminalKey = activeSessionId ? `${activeSessionId}:terminal` : null;
  const showAgentUpdates =
    activePaneKind === "agent" && activeAgentKey ? Boolean(unreadOutput[activeAgentKey]) : false;
  const showTerminalUpdates =
    activePaneKind === "terminal" && activeTerminalKey ? Boolean(unreadOutput[activeTerminalKey]) : false;
  const tabs: TabDefinition[] = [
    { kind: "agent", name: "Agent", navigationHotKey: "A" },
    { kind: "git", name: "Git", navigationHotKey: "G" },
    { kind: "terminal", name: "Terminal", navigationHotKey: "T" },
  ];

  return (
    <main className={styles.main}>
      <div className={`${styles.tabPane} ${showTabPane ? "" : styles.hidden}`}>
        <div className={styles.tabStrip}>
          {tabs.map((tab) => (
            <button
              key={tab.kind}
              className={`${styles.tab} ${activePaneKind === tab.kind ? styles.tabActive : ""}`}
              type="button"
              onClick={() => onSelectPaneKind(tab.kind)}
            >
              {tab.name}
              {showShortcutHints ? (
                <span className={styles.tabHint} aria-hidden="true">
                  {tab.navigationHotKey}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className={styles.tabBody}>
          <AgentTab
            sessions={sessions}
            activeSessionId={activeSessionId}
            isActive={activePaneKind === "agent"}
            onRegisterTerminal={onRegisterTerminal}
            showUpdates={showAgentUpdates}
            onJumpToBottom={onJumpToBottom}
          />
          <TerminalTab
            sessions={sessions}
            activeSessionId={activeSessionId}
            isActive={activePaneKind === "terminal"}
            onRegisterTerminal={onRegisterTerminal}
            showUpdates={showTerminalUpdates}
            onJumpToBottom={onJumpToBottom}
          />
          <GitTab session={activeSession} isActive={activePaneKind === "git"} />
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

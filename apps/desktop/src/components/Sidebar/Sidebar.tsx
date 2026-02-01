import { Plus, Settings } from "lucide-react";
import type { Session } from "../../types";
import { ClaudeIconIcon, OpenaiIconIcon } from "@codelegate/shared/icons";
import { getRepoName } from "../../utils/session";
import IconButton from "../IconButton/IconButton";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  filter: string;
  sessions: Session[];
  activeSessionId: string | null;
  onFilterChange: (value: string) => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
}

export default function Sidebar({
  filter,
  sessions,
  activeSessionId,
  onFilterChange,
  onSelectSession,
  onNewSession,
  onOpenSettings,
}: SidebarProps) {
  const iconById = {
    claude: <ClaudeIconIcon color="currentColor" strokeWidth={0} />,
    codex: <OpenaiIconIcon color="currentColor" strokeWidth={3.5} />,
  } as const;

  const classById = {
    claude: styles.agentClaude,
    codex: styles.agentCodex,
  } as const;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.controls}>
        <input
          className={styles.searchInput}
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Search sessions"
        />
      </div>
      <div className={styles.sessionList}>
        {sessions.map((session) => {
          const agentId = session.repo.agent;
          return (
            <button
              key={session.id}
              className={`${styles.sessionItem} ${
                activeSessionId === session.id ? styles.sessionItemActive : ""
              }`}
              type="button"
              onClick={() => onSelectSession(session.id)}
            >
              <span className={`${styles.agentIcon} ${classById[agentId]}`}>
                {iconById[agentId]}
              </span>
              <div className={styles.sessionLabel}>{getRepoName(session.repo.repoPath)}</div>
              <span
                className={`${styles.status} ${
                  session.status === "running"
                    ? styles.statusRunning
                    : session.status === "error"
                      ? styles.statusError
                      : ""
                }`}
              />
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        <IconButton
          aria-label="New session"
          variant="fab"
          shape="circle"
          size="lg"
          iconSize={18}
          onClick={onNewSession}
        >
          <Plus aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label="Settings"
          variant="fab"
          shape="circle"
          size="lg"
          iconSize={18}
          onClick={onOpenSettings}
        >
          <Settings aria-hidden="true" />
        </IconButton>
      </div>
    </aside>
  );
}

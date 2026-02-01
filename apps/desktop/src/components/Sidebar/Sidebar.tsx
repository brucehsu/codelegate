import { Plus, Settings } from "lucide-react";
import type { Session } from "../../types";
import { agentCatalog } from "../../constants";
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
          const agent = agentCatalog.find((item) => item.id === session.repo.agent);
          return (
            <button
              key={session.id}
              className={`${styles.sessionItem} ${
                activeSessionId === session.id ? styles.sessionItemActive : ""
              }`}
              type="button"
              onClick={() => onSelectSession(session.id)}
            >
              <div className={styles.sessionLabel}>{getRepoName(session.repo.repoPath)}</div>
              <div className={styles.sessionRight}>
                <span
                  className={`${styles.status} ${
                    session.status === "running"
                      ? styles.statusRunning
                      : session.status === "error"
                        ? styles.statusError
                        : ""
                  }`}
                />
                <div className={styles.sessionMeta}>{agent?.label ?? session.repo.agent}</div>
              </div>
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

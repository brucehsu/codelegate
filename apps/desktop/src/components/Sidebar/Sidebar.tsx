import { MoreHorizontal, Plus, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { Session } from "../../types";
import { ClaudeIconIcon, OpenaiIconIcon } from "@codelegate/shared/icons";
import { getRepoName } from "../../utils/session";
import IconButton from "../ui/IconButton/IconButton";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  filter: string;
  sessions: Session[];
  activeSessionId: string | null;
  onFilterChange: (value: string) => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onRenameSession: (sessionId: string) => void;
  searchRef?: React.RefObject<HTMLInputElement>;
  showShortcutHints?: boolean;
}

export default function Sidebar({
  filter,
  sessions,
  activeSessionId,
  onFilterChange,
  onSelectSession,
  onNewSession,
  onOpenSettings,
  onRenameSession,
  searchRef,
  showShortcutHints = false,
}: SidebarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const iconById = {
    claude: <ClaudeIconIcon color="currentColor" strokeWidth={0} />,
    codex: <OpenaiIconIcon color="currentColor" strokeWidth={3.5} />,
  } as const;

  const classById = {
    claude: styles.agentClaude,
    codex: styles.agentCodex,
  } as const;

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-session-menu]")) {
        setOpenMenuId(null);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.controls}>
        <input
          className={styles.searchInput}
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Search sessions"
          ref={searchRef}
        />
      </div>
      <div className={styles.sessionList}>
        {sessions.map((session, index) => {
          const agentId = session.repo.agent;
          const shortcut = index < 9 ? String(index + 1) : null;
          return (
            <div
              key={session.id}
              className={`${styles.sessionItem} ${
                activeSessionId === session.id ? styles.sessionItemActive : ""
              }`}
            >
              <button
                className={styles.sessionButton}
                type="button"
                onClick={() => onSelectSession(session.id)}
              >
                <span className={`${styles.agentIcon} ${classById[agentId]}`}>
                  {iconById[agentId]}
                </span>
                <div className={styles.sessionText}>
                  <div className={styles.sessionLabel}>{getRepoName(session.repo.repoPath)}</div>
                  {session.branch ? <div className={styles.sessionBranch}>{session.branch}</div> : null}
                </div>
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
              <div className={styles.sessionMenu} data-session-menu>
                <button
                  type="button"
                  className={styles.menuTrigger}
                  aria-label="Session menu"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenuId((prev) => (prev === session.id ? null : session.id));
                  }}
                >
                  <MoreHorizontal aria-hidden="true" />
                </button>
                {openMenuId === session.id ? (
                  <div className={styles.menu}>
                    <button
                      type="button"
                      className={styles.menuItem}
                      onClick={() => {
                        setOpenMenuId(null);
                        onRenameSession(session.id);
                      }}
                    >
                      Rename Branch
                    </button>
                  </div>
                ) : null}
              </div>
              {showShortcutHints && shortcut ? (
                <span className={styles.sessionShortcut} aria-hidden="true">
                  {shortcut}
                </span>
              ) : null}
            </div>
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

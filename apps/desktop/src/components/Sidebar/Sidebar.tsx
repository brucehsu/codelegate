import { MoreHorizontal, Plus, Settings } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import type { SessionGroup } from "../../utils/session";
import { ClaudeIconIcon, OpenaiIconIcon } from "@codelegate/shared/icons";
import IconButton from "../ui/IconButton/IconButton";
import CollapsibleSection from "../ui/CollapsibleSection/CollapsibleSection";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  filter: string;
  sessionGroups: SessionGroup[];
  activeSessionId: string | null;
  onFilterChange: (value: string) => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onRenameSession: (sessionId: string) => void;
  onTerminateSession: (sessionId: string) => void;
  agentOutputting: Record<string, boolean>;
  sessionShortcuts: Record<string, string>;
  collapsedRepoGroups: Record<string, boolean>;
  onToggleRepoGroup: (repoPath: string) => void;
  searchRef?: React.RefObject<HTMLInputElement>;
  showShortcutHints?: boolean;
}

export default function Sidebar({
  filter,
  sessionGroups,
  activeSessionId,
  onFilterChange,
  onSelectSession,
  onNewSession,
  onOpenSettings,
  onRenameSession,
  onTerminateSession,
  agentOutputting,
  sessionShortcuts,
  collapsedRepoGroups,
  onToggleRepoGroup,
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
        <div className={styles.searchField}>
          <input
            className={styles.searchInput}
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Search sessions"
            ref={searchRef}
          />
          {showShortcutHints ? (
            <span className={styles.searchShortcut} aria-hidden="true">
              S
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles.sessionList}>
        {sessionGroups.map((group) => {
          const isOpen = !collapsedRepoGroups[group.key];
          return (
            <CollapsibleSection
              key={group.key}
              title={group.name}
              isOpen={isOpen}
              onToggle={() => onToggleRepoGroup(group.key)}
              className={styles.repoSection}
              headerClassName={styles.repoHeader}
              toggleClassName={styles.repoToggle}
              titleClassName={styles.repoTitle}
              chevronClassName={styles.repoChevron}
              bodyClassName={styles.repoBody}
            >
              {group.sessions.map((session) => {
                const agentId = session.repo.agent;
                const shortcut = sessionShortcuts[session.id] ?? null;
                const isOutputting = Boolean(agentOutputting[session.id]);
                const isRunning = session.status === "running";
                const branchTitle = session.branch?.trim() || "Loading branch...";
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
                        <div className={styles.sessionLabel}>{branchTitle}</div>
                      </div>
                      <span
                        className={[
                          styles.status,
                          isRunning ? styles.statusRunning : "",
                          isRunning && isOutputting ? styles.statusOutputting : "",
                          session.status === "error" ? styles.statusError : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
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
                            className={`${styles.menuItem} ${styles.menuItemWithShortcut}`}
                            onClick={() => {
                              setOpenMenuId(null);
                              onRenameSession(session.id);
                            }}
                          >
                            <span>Rename Branch</span>
                            <span className={styles.menuShortcut} aria-hidden="true">
                              <span className={styles.menuShortcutPill}>Alt</span>
                              <span className={styles.menuShortcutPlus}>+</span>
                              <span className={styles.menuShortcutPill}>R</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            className={`${styles.menuItem} ${styles.menuItemWithShortcut} ${styles.menuItemDanger}`}
                            onClick={async () => {
                              const confirmed = await confirm(
                                "Terminate this session? This will close the tab and stop ongoing shell sessions.",
                                { title: "Codelegate", kind: "warning" }
                              );
                              if (!confirmed) {
                                return;
                              }
                              setOpenMenuId(null);
                              onTerminateSession(session.id);
                            }}
                          >
                            <span>Terminate Session</span>
                            <span className={styles.menuShortcut} aria-hidden="true">
                              <span className={styles.menuShortcutPill}>Alt</span>
                              <span className={styles.menuShortcutPlus}>+</span>
                              <span className={styles.menuShortcutPill}>W</span>
                            </span>
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
            </CollapsibleSection>
          );
        })}
      </div>
      <div className={styles.actions}>
        <div className={styles.actionButton}>
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
          {showShortcutHints ? (
            <span className={styles.actionShortcut} aria-hidden="true">
              N
            </span>
          ) : null}
        </div>
        <div className={styles.actionButton}>
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
          {showShortcutHints ? (
            <span className={styles.actionShortcut} aria-hidden="true">
              P
            </span>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

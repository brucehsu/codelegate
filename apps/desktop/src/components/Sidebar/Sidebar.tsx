import { ChevronsLeft, ChevronsRight, MoreHorizontal, Plus, Settings } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { SessionGroup } from "../../utils/session";
import type { Session } from "../../types";
import AgentIconStack from "../ui/AgentIconStack/AgentIconStack";
import IconButton from "../ui/IconButton/IconButton";
import CollapsibleSection from "../ui/CollapsibleSection/CollapsibleSection";
import { useStatusPopouts } from "./useStatusPopouts";
import styles from "./Sidebar.module.css";

const POPOUT_CLOSE_MS = 180;

interface SidebarProps {
  filter: string;
  sessionGroups: SessionGroup[];
  activeSessionId: string | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onFilterChange: (value: string) => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onRenameSession: (sessionId: string) => void;
  onTerminateSession: (sessionId: string) => void;
  agentOutputting: Record<string, boolean>;
  unreadSessions?: Record<string, boolean>;
  sessionShortcuts: Record<string, string>;
  collapsedRepoGroups: Record<string, boolean>;
  onToggleRepoGroup: (repoPath: string) => void;
  searchRef?: React.RefObject<HTMLInputElement>;
  showShortcutHints?: boolean;
  shortcutModifierTokens: string[];
  showSearchInput?: boolean;
  showFooterActions?: boolean;
}

function resolveStatusClass(session: Session, isOutputting: boolean, isUnread: boolean) {
  const isRunning = session.status === "running";
  const showOutputting = isRunning && isOutputting;
  const showUnread = isRunning && !showOutputting && isUnread;
  return [
    styles.status,
    isRunning ? styles.statusRunning : "",
    showUnread ? styles.statusUnread : "",
    showOutputting ? styles.statusOutputting : "",
    session.status === "error" ? styles.statusError : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export default function Sidebar({
  filter,
  sessionGroups,
  activeSessionId,
  collapsed = false,
  onToggleCollapsed,
  onFilterChange,
  onSelectSession,
  onNewSession,
  onOpenSettings,
  onRenameSession,
  onTerminateSession,
  agentOutputting,
  unreadSessions = {},
  sessionShortcuts,
  collapsedRepoGroups,
  onToggleRepoGroup,
  searchRef,
  showShortcutHints = false,
  shortcutModifierTokens,
  showSearchInput = true,
  showFooterActions = true,
}: SidebarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const asideRef = useRef<HTMLElement | null>(null);
  const [scrollTick, setScrollTick] = useState(0);

  const flattenedSessions = useMemo(
    () =>
      sessionGroups.flatMap((group) =>
        group.sessions.map((session) => ({ session, groupName: group.name }))
      ),
    [sessionGroups]
  );

  const sessionLookup = useMemo(() => {
    const map = new Map<string, { session: Session; groupName: string }>();
    for (const entry of flattenedSessions) {
      map.set(entry.session.id, entry);
    }
    return map;
  }, [flattenedSessions]);

  const popoutSessions = useMemo(
    () => flattenedSessions.map((entry) => entry.session),
    [flattenedSessions]
  );

  const { popouts, dismiss } = useStatusPopouts({
    sessions: popoutSessions,
    agentOutputting,
    enabled: collapsed,
  });

  const visibleIds = useMemo(() => {
    const ids = new Set<string>(popouts.keys());
    if (hoveredSessionId) {
      ids.add(hoveredSessionId);
    }
    if (collapsed && showShortcutHints) {
      for (const entry of flattenedSessions) {
        ids.add(entry.session.id);
      }
    }
    return ids;
  }, [popouts, hoveredSessionId, collapsed, showShortcutHints, flattenedSessions]);

  const popoutPositions = useMemo(() => {
    const map = new Map<string, number>();
    const asideEl = asideRef.current;
    if (!asideEl) {
      return map;
    }
    const asideTop = asideEl.getBoundingClientRect().top;
    visibleIds.forEach((sessionId) => {
      const rowEl = rowRefs.current.get(sessionId);
      if (!rowEl) {
        return;
      }
      const rect = rowEl.getBoundingClientRect();
      map.set(sessionId, rect.top - asideTop + rect.height / 2);
    });
    return map;
  }, [visibleIds, scrollTick]);

  const popoutPositionsRef = useRef(popoutPositions);

  const [closingPopouts, setClosingPopouts] = useState<Map<string, number>>(new Map());
  const closingTimersRef = useRef<Map<string, number>>(new Map());
  const prevVisibleRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timers = closingTimersRef.current;
    const prevVisible = prevVisibleRef.current;
    const positions = popoutPositionsRef.current;
    const newlyClosing: Array<[string, number]> = [];

    visibleIds.forEach((sessionId) => {
      const timer = timers.get(sessionId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timers.delete(sessionId);
      }
    });

    prevVisible.forEach((sessionId) => {
      if (visibleIds.has(sessionId) || timers.has(sessionId)) {
        return;
      }
      const top = positions.get(sessionId);
      if (top === undefined) {
        return;
      }
      newlyClosing.push([sessionId, top]);
      const timer = window.setTimeout(() => {
        timers.delete(sessionId);
        setClosingPopouts((prev) => {
          if (!prev.has(sessionId)) {
            return prev;
          }
          const next = new Map(prev);
          next.delete(sessionId);
          return next;
        });
      }, POPOUT_CLOSE_MS);
      timers.set(sessionId, timer);
    });

    setClosingPopouts((prev) => {
      let changed = false;
      const next = new Map(prev);
      visibleIds.forEach((sessionId) => {
        if (next.delete(sessionId)) {
          changed = true;
        }
      });
      for (const [sessionId, top] of newlyClosing) {
        next.set(sessionId, top);
        changed = true;
      }
      return changed ? next : prev;
    });

    prevVisibleRef.current = new Set(visibleIds);
  }, [visibleIds]);

  useEffect(() => {
    popoutPositionsRef.current = popoutPositions;
  }, [popoutPositions]);

  const renderMenuShortcut = (key: string) => (
    <span className={styles.menuShortcut} aria-hidden="true">
      {shortcutModifierTokens.map((token, index) => (
        <Fragment key={token}>
          {index > 0 ? <span className={styles.menuShortcutPlus}>+</span> : null}
          <span className={styles.menuShortcutPill}>{token}</span>
        </Fragment>
      ))}
      <span className={styles.menuShortcutPlus}>+</span>
      <span className={styles.menuShortcutPill}>{key}</span>
    </span>
  );
  const sidebarToggleKeyShortcut = [...shortcutModifierTokens, "C"].join("+");

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

  useEffect(() => {
    setHoveredSessionId(null);
  }, [collapsed]);

  useEffect(() => {
    const timers = closingTimersRef.current;
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const handleRowHoverEnter = (sessionId: string) => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHoveredSessionId(sessionId);
  };

  const handleRowHoverLeave = () => {
    if (closeTimerRef.current === null) {
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setHoveredSessionId(null);
      }, 150);
    }
  };

  const renderExpandedBody = () => (
    <>
      {showSearchInput ? (
        <div className={styles.controls}>
          <div className={styles.controlsRow}>
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
            {onToggleCollapsed ? (
              <div className={styles.collapseToggleWrap}>
                <button
                  type="button"
                  className={styles.collapseToggle}
                  onClick={onToggleCollapsed}
                  aria-label="Collapse sidebar"
                  aria-expanded={!collapsed}
                  aria-keyshortcuts={sidebarToggleKeyShortcut}
                >
                  <ChevronsLeft aria-hidden="true" />
                </button>
                {showShortcutHints ? (
                  <span className={styles.collapseShortcut} aria-hidden="true">
                    C
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
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
                const agentId = session.activeAgent;
                const shortcut = sessionShortcuts[session.id] ?? null;
                const isOutputting = Boolean(agentOutputting[session.id]);
                const isUnread = Boolean(unreadSessions[session.id]);
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
                      <AgentIconStack activeAgent={agentId} size="list" />
                      <div className={styles.sessionText}>
                        <div className={styles.sessionLabel}>{branchTitle}</div>
                      </div>
                      <span className={resolveStatusClass(session, isOutputting, isUnread)} />
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
                            <span className={styles.menuItemLabel}>Rename Branch</span>
                            {renderMenuShortcut("B")}
                          </button>
                          <button
                            type="button"
                            className={`${styles.menuItem} ${styles.menuItemWithShortcut} ${styles.menuItemDanger}`}
                            onClick={() => {
                              setOpenMenuId(null);
                              onTerminateSession(session.id);
                            }}
                          >
                            <span className={styles.menuItemLabel}>Terminate Session</span>
                            {renderMenuShortcut("W")}
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
      {showFooterActions ? (
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
      ) : null}
    </>
  );

  if (collapsed) {
    const drawers: Array<{ sessionId: string; top: number; closing: boolean }> = [];
    visibleIds.forEach((sessionId) => {
      const top = popoutPositions.get(sessionId);
      if (top !== undefined) {
        drawers.push({ sessionId, top, closing: false });
      }
    });
    closingPopouts.forEach((top, sessionId) => {
      if (!visibleIds.has(sessionId)) {
        drawers.push({ sessionId, top, closing: true });
      }
    });
    return (
      <aside
        ref={asideRef}
        className={`${styles.sidebar} ${styles.sidebarCollapsed}`}
      >
        <div className={styles.railHeader}>
          {onToggleCollapsed ? (
            <div className={styles.collapseToggleWrap}>
              <button
                type="button"
                className={`${styles.collapseToggle} ${styles.railExpandToggle}`}
                onClick={onToggleCollapsed}
                aria-label="Expand sidebar"
                aria-expanded={false}
                aria-keyshortcuts={sidebarToggleKeyShortcut}
              >
                <ChevronsRight aria-hidden="true" />
              </button>
              {showShortcutHints ? (
                <span className={styles.collapseShortcut} aria-hidden="true">
                  C
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div
          className={styles.railList}
          onScroll={() => {
            if (visibleIds.size > 0 || closingPopouts.size > 0) {
              setScrollTick((tick) => tick + 1);
            }
          }}
        >
          {sessionGroups.map((group) => (
            <div key={group.key} className={styles.railGroup}>
              {group.sessions.map((session) => {
                const agentId = session.activeAgent;
                const isOutputting = Boolean(agentOutputting[session.id]);
                const isUnread = Boolean(unreadSessions[session.id]);
                const branchTitle = session.branch?.trim() || "Loading branch...";
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`${styles.railItem} ${
                      activeSessionId === session.id ? styles.railItemActive : ""
                    }`}
                    aria-label={`${group.name}: ${branchTitle} (${session.status})`}
                    onClick={() => onSelectSession(session.id)}
                    onMouseEnter={() => handleRowHoverEnter(session.id)}
                    onMouseLeave={handleRowHoverLeave}
                    onFocus={() => handleRowHoverEnter(session.id)}
                    onBlur={handleRowHoverLeave}
                    ref={(el) => {
                      if (el) {
                        rowRefs.current.set(session.id, el);
                      } else {
                        rowRefs.current.delete(session.id);
                      }
                    }}
                  >
                    <AgentIconStack activeAgent={agentId} size="rail" />
                    <span className={`${resolveStatusClass(session, isOutputting, isUnread)} ${styles.railStatusBadge}`} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className={styles.railFooter}>
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
        </div>
        <div className={styles.popoutLayer}>
          {drawers.map(({ sessionId, top, closing }) => {
            const info = sessionLookup.get(sessionId);
            if (!info) {
              return null;
            }
            const { session, groupName } = info;
            const agentId = session.activeAgent;
            const isOutputting = Boolean(agentOutputting[session.id]);
            const isUnread = Boolean(unreadSessions[session.id]);
            const branchTitle = session.branch?.trim() || "Loading branch...";
            const isError = session.status === "error";
            const shortcut = sessionShortcuts[session.id] ?? null;
            return (
              <div
                key={sessionId}
                className={styles.popoutRow}
                style={{ top, pointerEvents: closing ? "none" : undefined }}
                onMouseEnter={closing ? undefined : () => handleRowHoverEnter(session.id)}
                onMouseLeave={closing ? undefined : handleRowHoverLeave}
              >
                <button
                  type="button"
                  className={`${styles.popoutCard} ${isError ? styles.popoutError : ""} ${
                    closing ? styles.popoutClosing : ""
                  }`}
                  onClick={() => {
                    dismiss(session.id);
                    onSelectSession(session.id);
                  }}
                >
                  {showShortcutHints && shortcut ? (
                    <span className={styles.popoutShortcut} aria-hidden="true">
                      {shortcut}
                    </span>
                  ) : null}
                  <AgentIconStack activeAgent={agentId} size="list" />
                  <span className={styles.popoutRepo}>{groupName}</span>
                  <span className={styles.popoutBranch}>{branchTitle}</span>
                  <span className={resolveStatusClass(session, isOutputting, isUnread)} />
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar}>
      {renderExpandedBody()}
    </aside>
  );
}

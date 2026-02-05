import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import styles from "./App.module.css";
import Sidebar from "./components/Sidebar/Sidebar";
import MainPane from "./components/MainPane/MainPane";
import NewSessionDialog from "./components/NewSessionDialog/NewSessionDialog";
import SettingsDialog from "./components/SettingsDialog/SettingsDialog";
import RenameDialog from "./components/RenameDialog/RenameDialog";
import { useAppState } from "./hooks/useAppState";
import { useToasts } from "./hooks/useToasts";
import Toasts from "./components/Toasts/Toasts";
import type { AgentId, EnvVar, RepoConfig, PaneKind } from "./types";
import { getRepoName, groupSessionsByRepo, validateEnvVars } from "./utils/session";

const emptyEnv: EnvVar[] = [{ key: "", value: "" }];

export default function App() {
  const { toasts, pushToast, removeToast } = useToasts();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const sidebarPaneRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef({ startX: 0, startWidth: 360 });
  const terminalResizeRafRef = useRef<number | null>(null);

  function focusSearch() {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }

  const {
    config,
    sessions,
    activeSessionId,
    filter,
    setFilter,
    setActiveSessionId,
    updateRecentDirs,
    updateTerminalSettings,
    updateBatterySaver,
    updateRepoDefaults,
    startSession,
    registerTerminal,
    setActivePaneKind,
    renameBranch,
    terminateSession,
    agentOutputting,
    focusActiveSession,
    unreadOutput,
    jumpToBottom,
  } = useAppState(pushToast, handleOpenDialog, focusSearch);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("claude");
  const [repoPath, setRepoPath] = useState("");
  const [repoHint, setRepoHint] = useState("");
  const [worktreeEnabled, setWorktreeEnabled] = useState(false);
  const [envVars, setEnvVars] = useState<EnvVar[]>(emptyEnv);
  const [preCommands, setPreCommands] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontFamily, setFontFamily] = useState(config.settings.terminalFontFamily);
  const [fontSize, setFontSize] = useState(config.settings.terminalFontSize);
  const [batterySaver, setBatterySaver] = useState(config.settings.batterySaver);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [activePaneKind, setActivePaneKindState] = useState<PaneKind>("agent");
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [showShortcutHints, setShowShortcutHints] = useState(false);
  const [collapsedRepoGroups, setCollapsedRepoGroups] = useState<Record<string, boolean>>({});
  const [sessionHotkeyPage, setSessionHotkeyPage] = useState(0);

  const requestTerminalResize = useCallback(() => {
    if (terminalResizeRafRef.current !== null) {
      return;
    }
    terminalResizeRafRef.current = window.requestAnimationFrame(() => {
      terminalResizeRafRef.current = null;
      window.dispatchEvent(new Event("resize"));
    });
  }, []);

  useEffect(() => {
    setFontFamily(config.settings.terminalFontFamily);
    setFontSize(config.settings.terminalFontSize);
    setBatterySaver(config.settings.batterySaver);
  }, [
    config.settings.terminalFontFamily,
    config.settings.terminalFontSize,
    config.settings.batterySaver,
  ]);

  useEffect(() => {
    if (!isResizingSidebar) {
      return;
    }
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handlePointerMove = (event: PointerEvent) => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }
      const shellWidth = shell.getBoundingClientRect().width;
      if (shellWidth <= 0) {
        return;
      }
      const maxWidth = Math.floor(shellWidth * 0.8);
      const minWidth = Math.min(320, maxWidth);
      const delta = event.clientX - resizeStateRef.current.startX;
      const nextWidth = Math.min(
        maxWidth,
        Math.max(minWidth, resizeStateRef.current.startWidth + delta),
      );
      setSidebarWidth(nextWidth);
      requestTerminalResize();
    };

    const handlePointerUp = () => {
      setIsResizingSidebar(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizingSidebar, requestTerminalResize]);

  useEffect(() => {
    return () => {
      if (terminalResizeRafRef.current !== null) {
        window.cancelAnimationFrame(terminalResizeRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleWindowResize = () => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }
      const shellWidth = shell.getBoundingClientRect().width;
      if (shellWidth <= 0) {
        return;
      }
      const maxWidth = Math.floor(shellWidth * 0.8);
      setSidebarWidth((current) => Math.min(current, maxWidth));
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  const visibleSessions = useMemo(() => sessions.filter((session) => !session.isTabClosed), [sessions]);

  const filteredSessions = useMemo(() => {
    const needle = filter.toLowerCase();
    return visibleSessions.filter((session) => {
      const repoName = getRepoName(session.repo.repoPath).toLowerCase();
      const branchName = (session.branch ?? "").toLowerCase();
      return repoName.includes(needle) || branchName.includes(needle);
    });
  }, [visibleSessions, filter]);

  const sessionGroups = useMemo(() => groupSessionsByRepo(filteredSessions), [filteredSessions]);

  const visualSessions = useMemo(() => {
    const ordered: typeof filteredSessions = [];
    sessionGroups.forEach((group) => {
      if (collapsedRepoGroups[group.key]) {
        return;
      }
      ordered.push(...group.sessions);
    });
    return ordered;
  }, [sessionGroups, collapsedRepoGroups]);

  const hotkeyPageCount = useMemo(
    () => Math.max(1, Math.ceil(visualSessions.length / 9)),
    [visualSessions.length]
  );

  useEffect(() => {
    if (sessionHotkeyPage >= hotkeyPageCount) {
      setSessionHotkeyPage(0);
    }
  }, [hotkeyPageCount, sessionHotkeyPage]);

  const sessionShortcuts = useMemo(() => {
    const shortcuts: Record<string, string> = {};
    const start = sessionHotkeyPage * 9;
    const slice = visualSessions.slice(start, start + 9);
    slice.forEach((session, index) => {
      if (index < 9) {
        shortcuts[session.id] = String(index + 1);
      }
    });
    return shortcuts;
  }, [sessionHotkeyPage, visualSessions]);

  function resetForm() {
    setSelectedAgent("claude");
    setRepoPath("");
    setRepoHint("");
    setWorktreeEnabled(false);
    setEnvVars(emptyEnv);
    setPreCommands("");
  }

  const openSettings = () => {
    setFontFamily(config.settings.terminalFontFamily);
    setFontSize(config.settings.terminalFontSize);
    setBatterySaver(config.settings.batterySaver);
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => focusActiveSession());
  };

  const saveSettings = () => {
    updateTerminalSettings({
      terminalFontFamily: fontFamily.trim() || config.settings.terminalFontFamily,
      terminalFontSize: Number.isNaN(fontSize) ? config.settings.terminalFontSize : fontSize,
    });
    updateBatterySaver(batterySaver);
    setSettingsOpen(false);
    requestAnimationFrame(() => focusActiveSession());
  };

  function handleOpenDialog() {
    resetForm();
    setDialogOpen(true);
  }

  const handleCloseDialog = () => {
    setDialogOpen(false);
    requestAnimationFrame(() => focusActiveSession());
  };

  const openRename = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    setRenameSessionId(sessionId);
    setRenameValue(session?.branch ?? "");
    setRenameOpen(true);
  };

  const applyRepoDefaults = useCallback(
    (path: string) => {
      const trimmed = path.trim();
      if (!trimmed) {
        setEnvVars(emptyEnv);
        setPreCommands("");
        return;
      }
      const defaults = config.settings.repoDefaults?.[trimmed];
      if (!defaults) {
        setEnvVars(emptyEnv);
        setPreCommands("");
        return;
      }
      setEnvVars(defaults.env.length > 0 ? defaults.env : emptyEnv);
      setPreCommands(defaults.preCommands ?? "");
    },
    [config.settings.repoDefaults]
  );

  const closeRename = () => {
    setRenameOpen(false);
    setRenameSessionId(null);
    requestAnimationFrame(() => focusActiveSession());
  };

  const saveRename = async () => {
    if (!renameSessionId) {
      return;
    }
    const ok = await renameBranch(renameSessionId, renameValue);
    if (ok) {
      setRenameOpen(false);
      setRenameSessionId(null);
      requestAnimationFrame(() => focusActiveSession());
    }
  };

  const handleSelectRepo = (path: string) => {
    const trimmedPath = path.trim();
    setRepoPath(trimmedPath);
    setRepoHint("");
    updateRecentDirs(trimmedPath);
    applyRepoDefaults(trimmedPath);
  };

  const handleBrowseRepo = async () => {
    const selection = await open({ directory: true, multiple: false });
    if (typeof selection === "string") {
      handleSelectRepo(selection);
    }
  };

  const handleSubmit = async () => {
    setRepoHint("");
    const trimmedPath = repoPath.trim();
    if (!trimmedPath) {
      setRepoHint("Select a repository path.");
      return;
    }

    const envError = validateEnvVars(envVars);
    if (envError) {
      pushToast({ message: envError, tone: "error" });
      return;
    }

    setActivePaneKindState("agent");
    setActivePaneKind("agent");

    const repoConfig: RepoConfig = {
      repoPath: trimmedPath,
      agent: selectedAgent,
      env: envVars,
      preCommands,
      worktree: worktreeEnabled
        ? {
            enabled: true,
          }
        : undefined,
    };

    updateRepoDefaults(trimmedPath, envVars, preCommands);
    setDialogOpen(false);
    await startSession(repoConfig);
  };

  const startEnabled = repoPath.trim().length > 0 && Boolean(selectedAgent);
  const handleSelectPaneKind = useCallback((kind: PaneKind) => {
    setActivePaneKindState(kind);
    setActivePaneKind(kind);
  }, [setActivePaneKind]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt" || event.altKey) {
        setShowShortcutHints(true);
      }
      if (!event.altKey || event.repeat) {
        return;
      }
      let handled = false;
      if (event.code === "KeyA") {
        handleSelectPaneKind("agent");
        handled = true;
      } else if (event.code === "KeyG") {
        handleSelectPaneKind("git");
        handled = true;
      } else if (event.code === "KeyT") {
        handleSelectPaneKind("terminal");
        handled = true;
      } else if (event.code === "Digit0" || event.code === "Numpad0") {
        if (hotkeyPageCount > 1) {
          setSessionHotkeyPage((prev) => (prev + 1) % hotkeyPageCount);
        }
        handled = true;
      } else {
        const match = /^(Digit|Numpad)([1-9])$/.exec(event.code);
        if (match) {
          const index = Number(match[2]) - 1;
          const target = visualSessions[sessionHotkeyPage * 9 + index];
          if (target) {
            setActiveSessionId(target.id);
            handled = true;
          }
        }
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setShowShortcutHints(false);
        setSessionHotkeyPage(0);
      }
    };

    const handleBlur = () => {
      setShowShortcutHints(false);
      setSessionHotkeyPage(0);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [handleSelectPaneKind, hotkeyPageCount, setActiveSessionId, sessionHotkeyPage, visualSessions]);

  const handleSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const sidebarPane = sidebarPaneRef.current;
    if (!sidebarPane) {
      return;
    }
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarPane.getBoundingClientRect().width,
    };
    setIsResizingSidebar(true);
    event.preventDefault();
  };

  return (
    <div
      className={styles.shell}
      ref={shellRef}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <div className={styles.sidebarPane} ref={sidebarPaneRef}>
        <Sidebar
          filter={filter}
          sessionGroups={sessionGroups}
          collapsedRepoGroups={collapsedRepoGroups}
          onToggleRepoGroup={(repoPath) =>
            setCollapsedRepoGroups((prev) => ({ ...prev, [repoPath]: !prev[repoPath] }))
          }
          sessionShortcuts={sessionShortcuts}
          activeSessionId={activeSessionId}
          onFilterChange={setFilter}
          onSelectSession={setActiveSessionId}
          onNewSession={handleOpenDialog}
          onOpenSettings={openSettings}
          onRenameSession={openRename}
          onTerminateSession={terminateSession}
          agentOutputting={agentOutputting}
          searchRef={searchInputRef}
          showShortcutHints={showShortcutHints}
        />
        <div
          className={styles.sidebarResizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={handleSidebarResizeStart}
        />
      </div>
      <MainPane
        sessions={visibleSessions}
        activeSessionId={activeSessionId}
        activePaneKind={activePaneKind}
        onSelectPaneKind={handleSelectPaneKind}
        onRegisterTerminal={registerTerminal}
        unreadOutput={unreadOutput}
        onJumpToBottom={jumpToBottom}
        showShortcutHints={showShortcutHints}
      />
      <NewSessionDialog
        open={dialogOpen}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        repoPath={repoPath}
        recentDirs={config.settings.recentDirs}
        onSelectRepo={handleSelectRepo}
        onBrowseRepo={handleBrowseRepo}
        repoHint={repoHint}
        worktreeEnabled={worktreeEnabled}
        onToggleWorktree={setWorktreeEnabled}
        envVars={envVars}
        onEnvChange={setEnvVars}
        preCommands={preCommands}
        onPreCommandsChange={setPreCommands}
        onClearPreCommands={() => setPreCommands("")}
        startEnabled={startEnabled}
        onClose={handleCloseDialog}
        onSubmit={handleSubmit}
      />
      <SettingsDialog
        open={settingsOpen}
        fontFamily={fontFamily}
        fontSize={fontSize}
        batterySaver={batterySaver}
        onChangeFontFamily={setFontFamily}
        onChangeFontSize={setFontSize}
        onToggleBatterySaver={setBatterySaver}
        onClose={closeSettings}
        onSave={saveSettings}
      />
      <RenameDialog
        open={renameOpen}
        title={
          renameSessionId
            ? `Rename branch for ${getRepoName(
                sessions.find((item) => item.id === renameSessionId)?.repo.repoPath ?? ""
              )}`
            : undefined
        }
        value={renameValue}
        onChange={setRenameValue}
        onClose={closeRename}
        onSave={saveRename}
      />
      <Toasts toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}

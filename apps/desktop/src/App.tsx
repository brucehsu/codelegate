import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
import type { AgentId, EnvVar, RepoConfig, TerminalKind } from "./types";
import { getRepoName, validateEnvVars } from "./utils/session";

const emptyEnv: EnvVar[] = [{ key: "", value: "" }];

export default function App() {
  const { toasts, pushToast, removeToast } = useToasts();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const sidebarPaneRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef({ startX: 0, startWidth: 360 });

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
    startSession,
    registerTerminal,
    setActiveTerminalKind,
    renameBranch,
    focusActiveSession,
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
  const [activeTerminalKind, setActiveTerminalKindState] = useState<TerminalKind>("agent");
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

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
  }, [isResizingSidebar]);

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
    return visibleSessions.filter((session) => getRepoName(session.repo.repoPath).toLowerCase().includes(needle));
  }, [visibleSessions, filter]);

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
    setRepoPath(path);
    setRepoHint("");
    updateRecentDirs(path);
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

    setActiveTerminalKindState("agent");
    setActiveTerminalKind("agent");

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

    setDialogOpen(false);
    await startSession(repoConfig);
  };

  const startEnabled = repoPath.trim().length > 0 && Boolean(selectedAgent);
  const handleSelectTerminalKind = (kind: TerminalKind) => {
    setActiveTerminalKindState(kind);
    setActiveTerminalKind(kind);
  };

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
          sessions={filteredSessions}
          activeSessionId={activeSessionId}
          onFilterChange={setFilter}
        onSelectSession={setActiveSessionId}
        onNewSession={handleOpenDialog}
        onOpenSettings={openSettings}
        onRenameSession={openRename}
        searchRef={searchInputRef}
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
        activeTerminalKind={activeTerminalKind}
        onSelectTerminalKind={handleSelectTerminalKind}
        onRegisterTerminal={registerTerminal}
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

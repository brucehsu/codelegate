import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import styles from "./App.module.css";
import Sidebar from "./components/Sidebar/Sidebar";
import MainPane from "./components/MainPane/MainPane";
import NewSessionDialog from "./components/NewSessionDialog/NewSessionDialog";
import SettingsDialog from "./components/SettingsDialog/SettingsDialog";
import RenameDialog from "./components/RenameDialog/RenameDialog";
import CloseDialog from "./components/CloseDialog/CloseDialog";
import { useAppState } from "./hooks/useAppState";
import { useToasts } from "./hooks/useToasts";
import Toasts from "./components/Toasts/Toasts";
import type { AgentId, CloseConfirmPayload, CloseConfirmResult, EnvVar, RepoConfig, PaneKind } from "./types";
import { getRepoName, groupSessionsByRepo, validateEnvVars } from "./utils/session";
import { defineHotkey, runHotkeys, type HotkeyBinding } from "./utils/hotkeys";
import {
  buildShortcutCombo,
  getShortcutModifierTokens,
  matchesShortcutModifierState,
} from "./utils/shortcutModifier";
import { agentCatalog } from "./constants";

const emptyEnv: EnvVar[] = [{ key: "", value: "" }];

function buildModifierSessionSelectHotkeys(
  shortcutModifier: string,
  selectSessionByHotkeyIndex: (index: number) => void
): HotkeyBinding[] {
  const bindings: HotkeyBinding[] = [];
  for (let index = 0; index < 9; index += 1) {
    const number = index + 1;
    const sharedOptions = {
      preventDefault: true,
      stopPropagation: true,
      handler: () => selectSessionByHotkeyIndex(index),
    };
    bindings.push(
      defineHotkey({
        id: `session-select-digit-${number}`,
        combo: buildShortcutCombo(shortcutModifier, `Digit${number}`),
        ...sharedOptions,
      }),
      defineHotkey({
        id: `session-select-numpad-${number}`,
        combo: buildShortcutCombo(shortcutModifier, `Numpad${number}`),
        ...sharedOptions,
      })
    );
  }
  return bindings;
}

export default function App() {
  const { toasts, pushToast, removeToast } = useToasts();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const sidebarPaneRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef({ startX: 0, startWidth: 360 });
  const terminalResizeRafRef = useRef<number | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeDialogRemember, setCloseDialogRemember] = useState(true);
  const [closeDialogHasRunning, setCloseDialogHasRunning] = useState(false);
  const [closeDialogSessionCount, setCloseDialogSessionCount] = useState(0);
  const closeDialogResolveRef = useRef<((result: CloseConfirmResult) => void) | null>(null);
  const closeDialogPromiseRef = useRef<Promise<CloseConfirmResult> | null>(null);
  const previousActiveSessionIdRef = useRef<string | null>(null);

  function focusSearch() {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }

  const resolveCloseDialog = useCallback((result: CloseConfirmResult) => {
    const resolve = closeDialogResolveRef.current;
    if (!resolve) {
      return false;
    }
    closeDialogResolveRef.current = null;
    closeDialogPromiseRef.current = null;
    resolve(result);
    return true;
  }, []);

  const requestCloseConfirm = useCallback((payload: CloseConfirmPayload) => {
    if (closeDialogPromiseRef.current) {
      return closeDialogPromiseRef.current;
    }
    const promise = new Promise<CloseConfirmResult>((resolve) => {
      closeDialogResolveRef.current = resolve;
      setCloseDialogHasRunning(payload.hasRunning);
      setCloseDialogSessionCount(payload.sessionCount);
      setCloseDialogRemember(true);
      setCloseDialogOpen(true);
    });
    closeDialogPromiseRef.current = promise;
    return promise;
  }, []);

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
    updateShortcutModifier,
    updateRepoDefaults,
    updateAgentSettings,
    startSession,
    restartAgentSession,
    registerTerminal,
    setActivePaneKind,
    renameBranch,
    refreshSessionBranch,
    terminateSession,
    agentOutputting,
    focusActiveSession,
    unreadOutput,
    jumpToBottom,
  } = useAppState(pushToast, focusSearch, requestCloseConfirm);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogRecentDirs, setDialogRecentDirs] = useState<string[]>(config.settings.recentDirs);
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
  const [agentArgs, setAgentArgs] = useState<Record<string, string>>(config.settings.agentArgs ?? {});
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [activePaneKind, setActivePaneKindState] = useState<PaneKind>("agent");
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [showShortcutHints, setShowShortcutHints] = useState(false);
  const [collapsedRepoGroups, setCollapsedRepoGroups] = useState<Record<string, boolean>>({});
  const [sessionHotkeyPage, setSessionHotkeyPage] = useState(0);
  const shortcutModifier = config.settings.shortcutModifier;
  const shortcutModifierTokens = useMemo(
    () => getShortcutModifierTokens(shortcutModifier),
    [shortcutModifier]
  );
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

  useEffect(() => {
    const previous = previousActiveSessionIdRef.current;
    if (previous && activeSessionId && previous !== activeSessionId) {
      const nextSession = sessions.find((session) => session.id === activeSessionId);
      if (nextSession) {
        const repoName = getRepoName(nextSession.repo.repoPath);
        const branchName = nextSession.branch?.trim();
        const destination = branchName ? `${repoName} - ${branchName}` : repoName;
        pushToast({ tone: "success", message: `Switched to: ${destination}` });
      }
    }
    previousActiveSessionIdRef.current = activeSessionId;
  }, [activeSessionId, sessions, pushToast]);

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

  const activeSession = useMemo(
    () => visibleSessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, visibleSessions]
  );

  const canRestartActiveAgent = useMemo(() => {
    if (activePaneKind !== "agent" || !activeSession) {
      return false;
    }
    return activeSession.status === "stopped" || activeSession.status === "error";
  }, [activePaneKind, activeSession]);

  const handleSelectPaneKind = useCallback((kind: PaneKind) => {
    setActivePaneKindState(kind);
    setActivePaneKind(kind);
  }, [setActivePaneKind]);

  const openRename = useCallback((sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    setRenameSessionId(sessionId);
    setRenameValue(session?.branch ?? "");
    setRenameOpen(true);
  }, [sessions]);

  const renameActiveSession = useCallback(() => {
    if (!activeSessionId) {
      return;
    }
    openRename(activeSessionId);
  }, [activeSessionId, openRename]);

  const terminateActiveSession = useCallback(async () => {
    if (!activeSessionId) {
      return;
    }
    const confirmed = await confirm(
      "Terminate this session? This will close the tab and stop ongoing shell sessions.",
      { title: "Codelegate", kind: "warning" }
    );
    if (!confirmed) {
      return;
    }
    terminateSession(activeSessionId);
  }, [activeSessionId, terminateSession]);

  const openSettings = useCallback(() => {
    setFontFamily(config.settings.terminalFontFamily);
    setFontSize(config.settings.terminalFontSize);
    setBatterySaver(config.settings.batterySaver);
    setAgentArgs(config.settings.agentArgs ?? {});
    setSettingsOpen(true);
  }, [
    config.settings.batterySaver,
    config.settings.agentArgs,
    config.settings.terminalFontFamily,
    config.settings.terminalFontSize,
  ]);

  const cycleSessionHotkeyPage = useCallback(() => {
    if (hotkeyPageCount <= 1) {
      return;
    }
    setSessionHotkeyPage((prev) => (prev + 1) % hotkeyPageCount);
  }, [hotkeyPageCount]);

  const selectSessionByHotkeyIndex = useCallback(
    (index: number) => {
      const target = visualSessions[sessionHotkeyPage * 9 + index];
      if (!target) {
        return;
      }
      setActiveSessionId(target.id);
    },
    [sessionHotkeyPage, setActiveSessionId, visualSessions]
  );

  const modifierHotkeys = useMemo<HotkeyBinding[]>(
    () => [
      defineHotkey({
        id: "pane-agent",
        combo: buildShortcutCombo(shortcutModifier, "KeyA"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => handleSelectPaneKind("agent"),
      }),
      defineHotkey({
        id: "pane-git",
        combo: buildShortcutCombo(shortcutModifier, "KeyG"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => handleSelectPaneKind("git"),
      }),
      defineHotkey({
        id: "pane-terminal",
        combo: buildShortcutCombo(shortcutModifier, "KeyT"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => handleSelectPaneKind("terminal"),
      }),
      ...(canRestartActiveAgent && activeSession
        ? [
            defineHotkey({
              id: "agent-restart",
              combo: buildShortcutCombo(shortcutModifier, "KeyR"),
              preventDefault: true,
              stopPropagation: true,
              handler: () => {
                void restartAgentSession(activeSession.id);
              },
            }),
          ]
        : []),
      defineHotkey({
        id: "session-new-alt",
        combo: buildShortcutCombo(shortcutModifier, "KeyN"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => handleOpenDialog(),
      }),
      defineHotkey({
        id: "settings-open-alt",
        combo: buildShortcutCombo(shortcutModifier, "KeyP"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => openSettings(),
      }),
      defineHotkey({
        id: "session-rename-alt",
        combo: buildShortcutCombo(shortcutModifier, "KeyB"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => renameActiveSession(),
      }),
      defineHotkey({
        id: "session-terminate-alt",
        combo: buildShortcutCombo(shortcutModifier, "KeyW"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => {
          void terminateActiveSession();
        },
      }),
      defineHotkey({
        id: "session-hotkey-page-next-digit",
        combo: buildShortcutCombo(shortcutModifier, "Digit0"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => cycleSessionHotkeyPage(),
      }),
      defineHotkey({
        id: "session-hotkey-page-next-numpad",
        combo: buildShortcutCombo(shortcutModifier, "Numpad0"),
        preventDefault: true,
        stopPropagation: true,
        handler: () => cycleSessionHotkeyPage(),
      }),
      ...buildModifierSessionSelectHotkeys(shortcutModifier, selectSessionByHotkeyIndex),
    ],
    [
      shortcutModifier,
      activeSession,
      canRestartActiveAgent,
      cycleSessionHotkeyPage,
      handleSelectPaneKind,
      selectSessionByHotkeyIndex,
      handleOpenDialog,
      openSettings,
      renameActiveSession,
      restartAgentSession,
      terminateActiveSession,
    ]
  );

  function resetForm() {
    setSelectedAgent("claude");
    setRepoPath("");
    setRepoHint("");
    setWorktreeEnabled(false);
    setEnvVars(emptyEnv);
    setPreCommands("");
  }

  const closeSettings = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => focusActiveSession());
  };

  const handleShortcutModifierCommit = useCallback(
    (modifier: string) => {
      updateShortcutModifier(modifier);
    },
    [updateShortcutModifier]
  );

  const saveSettings = () => {
    const allowedAgentIds = new Set(agentCatalog.map((agent) => agent.id));
    const cleanedArgs: Record<string, string> = {};
    Object.entries(agentArgs).forEach(([id, value]) => {
      const trimmed = value.trim();
      if (trimmed.length > 0 && allowedAgentIds.has(id as AgentId)) {
        cleanedArgs[id] = trimmed;
      }
    });
    updateTerminalSettings({
      terminalFontFamily: fontFamily.trim() || config.settings.terminalFontFamily,
      terminalFontSize: Number.isNaN(fontSize) ? config.settings.terminalFontSize : fontSize,
    });
    updateBatterySaver(batterySaver);
    updateAgentSettings(cleanedArgs);
    setAgentArgs(cleanedArgs);
    setSettingsOpen(false);
    requestAnimationFrame(() => focusActiveSession());
  };

  function handleOpenDialog() {
    resetForm();
    setDialogRecentDirs(config.settings.recentDirs);
    setDialogOpen(true);
  }

  const handleCloseDialog = () => {
    setDialogOpen(false);
    requestAnimationFrame(() => focusActiveSession());
  };

  const handleCloseConfirmCancel = useCallback(() => {
    setCloseDialogOpen(false);
    const resolved = resolveCloseDialog({ confirmed: false, remember: false });
    if (resolved) {
      requestAnimationFrame(() => focusActiveSession());
    }
  }, [focusActiveSession, resolveCloseDialog]);

  const handleCloseConfirmSubmit = useCallback(() => {
    setCloseDialogOpen(false);
    resolveCloseDialog({ confirmed: true, remember: closeDialogRemember });
  }, [closeDialogRemember, resolveCloseDialog]);

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

    updateRecentDirs(trimmedPath);
    updateRepoDefaults(trimmedPath, envVars, preCommands);
    setDialogOpen(false);
    await startSession(repoConfig);
  };

  const startEnabled = repoPath.trim().length > 0 && Boolean(selectedAgent);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifierActive = matchesShortcutModifierState(event, shortcutModifier);
      setShowShortcutHints(modifierActive);
      if (!modifierActive || event.repeat) {
        return;
      }
      runHotkeys(event, modifierHotkeys);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const modifierActive = matchesShortcutModifierState(event, shortcutModifier);
      setShowShortcutHints(modifierActive);
      if (!modifierActive) {
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
  }, [modifierHotkeys, shortcutModifier]);

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
          shortcutModifierTokens={shortcutModifierTokens}
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
        onRefreshSessionBranch={refreshSessionBranch}
        unreadOutput={unreadOutput}
        onJumpToBottom={jumpToBottom}
        onNotify={pushToast}
        shortcutModifier={shortcutModifier}
        showShortcutHints={showShortcutHints}
        onRestartAgentSession={restartAgentSession}
      />
      <NewSessionDialog
        open={dialogOpen}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        repoPath={repoPath}
        recentDirs={dialogRecentDirs}
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
        shortcutModifier={shortcutModifier}
        agentArgs={agentArgs}
        onChangeFontFamily={setFontFamily}
        onChangeFontSize={setFontSize}
        onToggleBatterySaver={setBatterySaver}
        onCommitShortcutModifier={handleShortcutModifierCommit}
        onAgentArgsChange={setAgentArgs}
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
      <CloseDialog
        open={closeDialogOpen}
        hasRunning={closeDialogHasRunning}
        sessionCount={closeDialogSessionCount}
        remember={closeDialogRemember}
        onRememberChange={setCloseDialogRemember}
        onClose={handleCloseConfirmCancel}
        onConfirm={handleCloseConfirmSubmit}
      />
      <Toasts toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}

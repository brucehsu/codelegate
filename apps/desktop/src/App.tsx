import { useEffect, useMemo, useState } from "react";
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
import type { AgentId, EnvVar, RepoConfig } from "./types";
import { getRepoName, validateEnvVars } from "./utils/session";

const emptyEnv: EnvVar[] = [{ key: "", value: "" }];

export default function App() {
  const { toasts, pushToast, removeToast } = useToasts();

  const {
    config,
    sessions,
    activeSessionId,
    filter,
    setFilter,
    setActiveSessionId,
    updateRecentDirs,
    updateTerminalSettings,
    startSession,
    registerTerminal,
    renameBranch,
    focusActiveSession,
  } = useAppState(pushToast, handleOpenDialog);

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
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    setFontFamily(config.settings.terminalFontFamily);
    setFontSize(config.settings.terminalFontSize);
  }, [config.settings.terminalFontFamily, config.settings.terminalFontSize]);

  const filteredSessions = useMemo(() => {
    const needle = filter.toLowerCase();
    return sessions.filter((session) => getRepoName(session.repo.repoPath).toLowerCase().includes(needle));
  }, [sessions, filter]);

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

  return (
    <div className={styles.shell}>
      <Sidebar
        filter={filter}
        sessions={filteredSessions}
        activeSessionId={activeSessionId}
        onFilterChange={setFilter}
        onSelectSession={setActiveSessionId}
        onNewSession={handleOpenDialog}
        onOpenSettings={openSettings}
        onRenameSession={openRename}
      />
      <MainPane sessions={sessions} activeSessionId={activeSessionId} onRegisterTerminal={registerTerminal} />
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
        onChangeFontFamily={setFontFamily}
        onChangeFontSize={setFontSize}
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

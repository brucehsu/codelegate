import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import styles from "./App.module.css";
import Sidebar from "./components/Sidebar/Sidebar";
import MainPane from "./components/MainPane/MainPane";
import NewSessionDialog from "./components/NewSessionDialog/NewSessionDialog";
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
    startSession,
    registerTerminal,
  } = useAppState(pushToast);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("claude");
  const [repoPath, setRepoPath] = useState("");
  const [repoHint, setRepoHint] = useState("");
  const [worktreeEnabled, setWorktreeEnabled] = useState(false);
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [envVars, setEnvVars] = useState<EnvVar[]>(emptyEnv);
  const [preCommands, setPreCommands] = useState("");

  const filteredSessions = useMemo(() => {
    const needle = filter.toLowerCase();
    return sessions.filter((session) => getRepoName(session.repo.repoPath).toLowerCase().includes(needle));
  }, [sessions, filter]);

  const resetForm = () => {
    setSelectedAgent("claude");
    setRepoPath("");
    setRepoHint("");
    setWorktreeEnabled(false);
    setWorktreePath("");
    setWorktreeBranch("");
    setEnvVars(emptyEnv);
    setPreCommands("");
  };

  const handleOpenDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
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

    if (worktreeEnabled && !worktreePath.trim()) {
      pushToast({ message: "Worktree path is required when enabled.", tone: "error" });
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
            path: worktreePath.trim(),
            branch: worktreeBranch.trim(),
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
        worktreePath={worktreePath}
        onWorktreePathChange={setWorktreePath}
        worktreeBranch={worktreeBranch}
        onWorktreeBranchChange={setWorktreeBranch}
        envVars={envVars}
        onEnvChange={setEnvVars}
        preCommands={preCommands}
        onPreCommandsChange={setPreCommands}
        startEnabled={startEnabled}
        onClose={handleCloseDialog}
        onSubmit={handleSubmit}
      />
      <Toasts toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}

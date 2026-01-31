import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";

type AgentId = "claude" | "codex";

interface EnvVar {
  key: string;
  value: string;
}

interface WorktreeConfig {
  enabled: boolean;
  path: string;
  branch: string;
}

interface RepoConfig {
  repoPath: string;
  agent: AgentId;
  env: EnvVar[];
  preCommands: string;
  worktree?: WorktreeConfig;
}

interface AppSettings {
  theme: "dark" | "light";
  recentDirs: string[];
}

interface AppConfig {
  version: number;
  settings: AppSettings;
}

interface Session {
  id: string;
  repo: RepoConfig;
  status: "running" | "stopped" | "error";
  ptyId?: number;
  term?: Terminal;
  fit?: FitAddon;
  container?: HTMLDivElement;
  lastError?: string;
  startedAt?: number;
}

interface PtyOutput {
  session_id: number;
  data: string;
}

interface PtyExit {
  session_id: number;
}

const X_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <line x1="18" y1="6" x2="6" y2="18"></line>
  <line x1="6" y1="6" x2="18" y2="18"></line>
</svg>`;

const agentCatalog = [
  {
    id: "claude" as const,
    label: "Claude Code",
  },
  {
    id: "codex" as const,
    label: "Codex CLI",
  },
];

const agentCommandById: Record<AgentId, string> = {
  claude:
    'if command -v claude >/dev/null 2>&1; then exec claude; elif command -v claude-code >/dev/null 2>&1; then exec claude-code; else echo "Claude Code not found in PATH"; fi',
  codex:
    'if command -v codex >/dev/null 2>&1; then exec codex; elif command -v codex-cli >/dev/null 2>&1; then exec codex-cli; else echo "Codex CLI not found in PATH"; fi',
};

const darkTerminalTheme = {
  background: "#0b0e14",
  foreground: "#e7ecf3",
  cursor: "#4fd1c5",
  selectionBackground: "#2a3550",
};

const lightTerminalTheme = {
  background: "#f8f9fb",
  foreground: "#10131a",
  cursor: "#0a7c6f",
  selectionBackground: "#c8d2ea",
};

function getRepoName(path: string) {
  const cleaned = path.replace(/\/+$/, "");
  const parts = cleaned.split("/");
  return parts[parts.length - 1] || cleaned;
}

function createSessionId(repoPath: string) {
  return `${repoPath}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`;
}

function escapeShellArg(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellArgs(shellPath: string, command?: string) {
  const name = shellPath.split("/").pop() ?? "";
  if (command && name.includes("bash")) {
    return ["-l", "-i", "-c", command];
  }
  if (command && name.includes("zsh")) {
    return ["-l", "-i", "-c", command];
  }
  if (command && name.includes("fish")) {
    return ["-l", "-i", "-c", command];
  }
  if (name.includes("bash")) {
    return ["-l", "-i"];
  }
  if (name.includes("zsh")) {
    return ["-l", "-i"];
  }
  if (name.includes("fish")) {
    return ["-l", "-i"];
  }
  return command ? ["-c", command] : ([] as string[]);
}

function envListToMap(env: EnvVar[]) {
  const map: Record<string, string> = {};
  env.forEach((entry) => {
    if (entry.key.trim()) {
      map[entry.key.trim()] = entry.value ?? "";
    }
  });
  return map;
}

function requiredElement<T extends HTMLElement>(selector: string) {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return el;
}

export async function initApp() {
  const sessionList = requiredElement<HTMLDivElement>("#session-list");
  const terminalStack = requiredElement<HTMLDivElement>("#terminal-stack");
  const emptyState = requiredElement<HTMLDivElement>("#empty-state");
  const banner = requiredElement<HTMLDivElement>("#banner");
  const tabPane = requiredElement<HTMLDivElement>("#tab-pane");
  const sessionDialog = requiredElement<HTMLDialogElement>("#session-dialog");
  const agentPicker = requiredElement<HTMLDivElement>("#agent-picker");
  const agentHint = requiredElement<HTMLSpanElement>("#agent-hint");
  const repoPicker = requiredElement<HTMLDivElement>("#repo-picker");
  const repoTrigger = requiredElement<HTMLButtonElement>("#repo-trigger");
  const repoTriggerLabel = requiredElement<HTMLSpanElement>("#repo-trigger-label");
  const repoMenu = requiredElement<HTMLDivElement>("#repo-menu");
  const startSessionButton = requiredElement<HTMLButtonElement>("#start-session");
  const repoHint = requiredElement<HTMLSpanElement>("#repo-hint");
  const worktreeToggle = requiredElement<HTMLInputElement>("#worktree-toggle");
  const worktreeFields = requiredElement<HTMLDivElement>("#worktree-fields");
  const worktreePathInput = requiredElement<HTMLInputElement>("#worktree-path");
  const worktreeBranchInput = requiredElement<HTMLInputElement>("#worktree-branch");
  const envList = requiredElement<HTMLDivElement>("#env-list");
  const preCommandsInput = requiredElement<HTMLTextAreaElement>("#pre-commands");
  const filterInput = requiredElement<HTMLInputElement>("#session-filter");
  const sessionForm = requiredElement<HTMLFormElement>("#session-form");

  const state = {
    config: { version: 1, settings: { theme: "dark", recentDirs: [] } } as AppConfig,
    sessions: new Map<string, Session>(),
    activeSessionId: "" as string | "",
    filter: "",
  };

  let closeInProgress = false;
  let selectedAgent: AgentId = "claude";
  let repoPathValue = "";

  function showBanner(message: string, tone: "error" | "info" = "error") {
    banner.textContent = message;
    banner.classList.remove("hidden");
    banner.dataset.tone = tone;
  }

  function clearBanner() {
    banner.textContent = "";
    banner.classList.add("hidden");
    banner.dataset.tone = "";
  }

  function applyTheme(theme: "dark" | "light") {
    document.body.dataset.theme = theme;
    state.sessions.forEach((session) => {
      if (session.term) {
        session.term.options.theme = theme === "dark" ? darkTerminalTheme : lightTerminalTheme;
      }
    });
  }

  function renderSessionList() {
    sessionList.innerHTML = "";
    const entries = Array.from(state.sessions.values()).filter((session) =>
      getRepoName(session.repo.repoPath).toLowerCase().includes(state.filter.toLowerCase())
    );

    entries.forEach((session) => {
      const button = document.createElement("button");
      button.className = "session-item";
      if (state.activeSessionId === session.id) {
        button.classList.add("active");
      }
      button.dataset.sessionId = session.id;

      const label = document.createElement("div");
      label.className = "session-label";
      label.textContent = getRepoName(session.repo.repoPath);

      const meta = document.createElement("div");
      meta.className = "session-meta";
      const agent = agentCatalog.find((item) => item.id === session.repo.agent);
      meta.textContent = agent?.label ?? session.repo.agent;

      const status = document.createElement("span");
      status.className = `status ${session.status}`;

      const right = document.createElement("div");
      right.className = "session-right";
      right.append(status, meta);

      button.append(label, right);
      button.addEventListener("click", () => setActiveSession(session.id));

      sessionList.appendChild(button);
    });
  }

  function ensureTerminal(session: Session) {
    if (session.term && session.container && session.fit) {
      return session;
    }

    const container = document.createElement("div");
    container.className = "terminal-session";
    container.dataset.repo = session.repo.repoPath;
    terminalStack.appendChild(container);

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
      theme: state.config.settings.theme === "dark" ? darkTerminalTheme : lightTerminalTheme,
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 1000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    term.onData((data) => {
      if (session.ptyId) {
        invoke("write_pty", { sessionId: session.ptyId, data });
      }
    });

    session.term = term;
    session.fit = fit;
    session.container = container;

    return session;
  }

  function setActiveSession(sessionId: string) {
    state.activeSessionId = sessionId;
    renderSessionList();

    const session = state.sessions.get(sessionId);
    if (!session) {
      return;
    }

    ensureTerminal(session);

    state.sessions.forEach((item) => {
      if (item.container) {
        item.container.classList.toggle("hidden", item.id !== sessionId);
      }
    });

    if (session.container && session.fit) {
      session.fit.fit();
      if (session.ptyId) {
        invoke("resize_pty", {
          sessionId: session.ptyId,
          cols: session.term?.cols ?? 80,
          rows: session.term?.rows ?? 24,
        });
      }
    }

    emptyState.classList.toggle("hidden", Boolean(session.term));
    tabPane.classList.toggle("hidden", !session.term);
  }

  const agentButtons = Array.from(agentPicker.querySelectorAll<HTMLButtonElement>(".agent-card"));

  function updateAgentPicker() {
    agentButtons.forEach((button) => {
      const id = button.dataset.agent as AgentId | undefined;
      if (!id) {
        return;
      }
      button.classList.toggle("active", id === selectedAgent);
    });
    agentHint.textContent = "";
  }

  agentButtons.forEach((button) => {
    const id = button.dataset.agent as AgentId | undefined;
    if (!id) {
      return;
    }
    button.addEventListener("click", () => {
      selectedAgent = id;
      agentHint.textContent = "";
      updateAgentPicker();
      updateStartState();
    });
  });

  function renderRecentDirs() {
    repoMenu.innerHTML = "";
    if (state.config.settings.recentDirs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "select-item disabled";
      empty.textContent = "No recent directories";
      repoMenu.appendChild(empty);
    } else {
      state.config.settings.recentDirs.forEach((dir) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "select-item";
        item.textContent = dir;
        item.addEventListener("click", () => {
          setRepoSelection(dir);
          closeRepoMenu();
        });
        repoMenu.appendChild(item);
      });
    }

    if (repoPathValue && !state.config.settings.recentDirs.includes(repoPathValue)) {
      setRepoSelection("");
    }
  }

  function updateRecentDirs(path: string) {
    const trimmed = path.trim();
    if (!trimmed) {
      return;
    }
    const next = [trimmed, ...state.config.settings.recentDirs.filter((entry) => entry !== trimmed)].slice(0, 10);
    state.config.settings.recentDirs = next;
    setRepoSelection(trimmed);
    renderRecentDirs();
    invoke("save_config", { config: state.config });
  }

  function setRepoSelection(path: string) {
    repoPathValue = path;
    repoTriggerLabel.textContent = path || "Select a directory";
    repoTrigger.classList.toggle("placeholder", !path);
    updateStartState();
  }

  function openRepoMenu() {
    repoPicker.classList.add("open");
  }

  function closeRepoMenu() {
    repoPicker.classList.remove("open");
  }

  function updateStartState() {
    const ready = repoPathValue.trim().length > 0 && Boolean(selectedAgent);
    startSessionButton.disabled = !ready;
  }

  function updateToolbarState() {
    const session = state.sessions.get(state.activeSessionId);
    if (!session) {
      tabPane.classList.add("hidden");
      return;
    }
    tabPane.classList.toggle("hidden", !session.term);
  }

  async function startSession(repo: RepoConfig) {
    clearBanner();

    const sessionId = createSessionId(repo.repoPath);
    const session: Session = {
      id: sessionId,
      repo,
      status: "stopped",
    };
    state.sessions.set(sessionId, session);
    ensureTerminal(session);

    const repoRoot = repo.repoPath;

    let shell = "";
    try {
      shell = await invoke<string>("get_default_shell");
    } catch (error) {
      session.status = "error";
      session.lastError = String(error);
      renderSessionList();
      showBanner(String(error));
      return;
    }

    const envMap = envListToMap(repo.env);
    envMap.TERM = envMap.TERM || "xterm-256color";

    let sessionCwd = repoRoot;
    const initCommands: string[] = [];
    if (repo.worktree?.enabled && repo.worktree.path.trim()) {
      const wtPath = repo.worktree.path.trim();
      const branch = repo.worktree.branch.trim();
      const base = escapeShellArg(repoRoot);
      const target = escapeShellArg(wtPath);
      const branchArg = branch ? ` ${escapeShellArg(branch)}` : "";
      initCommands.push(`git -C ${base} worktree add ${target}${branchArg}`);
      sessionCwd = wtPath;
    }

    initCommands.push(`cd ${escapeShellArg(sessionCwd)}`);
    const preCommands = repo.preCommands.trim();
    if (preCommands) {
      preCommands
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .forEach((line) => initCommands.push(line));
    }
    initCommands.push(agentCommandById[repo.agent] ?? repo.agent);
    const commandLine = initCommands.filter((line) => line.trim().length > 0).join(" && ");

    let ptyId: number;
    try {
      ptyId = await invoke<number>("spawn_pty", {
        shell,
        args: shellArgs(shell, commandLine),
        cwd: repoRoot,
        env: envMap,
        cols: session.term?.cols ?? 80,
        rows: session.term?.rows ?? 24,
      });
    } catch (error) {
      session.status = "error";
      session.lastError = String(error);
      renderSessionList();
      showBanner(`Failed to start session: ${String(error)}`);
      return;
    }

    session.ptyId = ptyId;
    session.status = "running";
    session.lastError = undefined;
    session.startedAt = Date.now();
    state.sessions.set(sessionId, session);
    renderSessionList();
    setActiveSession(session.id);
  }

  async function stopSession(sessionId: string) {
    const session = state.sessions.get(sessionId);
    if (!session || !session.ptyId) {
      return;
    }
    try {
      await invoke("kill_pty", { sessionId: session.ptyId });
    } catch (error) {
      showBanner(`Failed to stop session: ${String(error)}`);
    } finally {
      session.status = "stopped";
      session.ptyId = undefined;
      session.startedAt = undefined;
      renderSessionList();
      updateToolbarState();
    }
  }

  function addEnvRow(key = "", value = "") {
    const row = document.createElement("div");
    row.className = "env-row";

    const keyInput = document.createElement("input");
    keyInput.className = "input";
    keyInput.placeholder = "KEY";
    keyInput.value = key;

    const valueInput = document.createElement("input");
    valueInput.className = "input";
    valueInput.placeholder = "value";
    valueInput.value = value;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ghost icon-button remove-button";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.innerHTML = X_ICON;
  removeBtn.addEventListener("click", () => row.remove());

    row.append(keyInput, valueInput, removeBtn);
    envList.appendChild(row);
  }

  function collectEnvVars(): EnvVar[] {
    const rows = Array.from(envList.querySelectorAll<HTMLDivElement>(".env-row"));
    return rows
      .map((row) => {
        const inputs = row.querySelectorAll<HTMLInputElement>("input");
        return {
          key: inputs[0]?.value.trim() ?? "",
          value: inputs[1]?.value ?? "",
        };
      })
      .filter((entry) => entry.key.length > 0);
  }

  function validateEnvVars(env: EnvVar[]) {
    const invalid = env.find((entry) => !/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(entry.key));
    if (invalid) {
      return `Invalid environment variable name: ${invalid.key}`;
    }
    return "";
  }

  async function handleSessionSubmit(event: SubmitEvent) {
    event.preventDefault();
    clearBanner();

    const agent = selectedAgent;
    const repoPath = repoPathValue.trim();
    if (!repoPath) {
      repoHint.textContent = "Select a repository path.";
      return;
    }
    repoHint.textContent = "";

    updateRecentDirs(repoPath);

    const envVars = collectEnvVars();
    const envError = validateEnvVars(envVars);
    if (envError) {
      showBanner(envError);
      return;
    }

    const worktreeEnabled = worktreeToggle.checked;
    const worktreePath = worktreePathInput.value.trim();
    if (worktreeEnabled && !worktreePath) {
      showBanner("Worktree path is required when enabled.");
      return;
    }

    const repoConfig: RepoConfig = {
      repoPath,
      agent,
      env: envVars,
      preCommands: preCommandsInput.value,
      worktree: worktreeEnabled
        ? {
            enabled: true,
            path: worktreePath,
            branch: worktreeBranchInput.value.trim(),
          }
        : undefined,
    };

    sessionDialog.close();
    await startSession(repoConfig);
  }

  function resetSessionForm() {
    selectedAgent = agentCatalog[0]?.id ?? "claude";
    setRepoSelection("");
    repoHint.textContent = "";
    renderRecentDirs();
    worktreeToggle.checked = false;
    worktreeFields.classList.add("hidden");
    worktreePathInput.value = "";
    worktreeBranchInput.value = "";
    envList.innerHTML = "";
    addEnvRow();
    preCommandsInput.value = "";
    updateAgentPicker();
    updateStartState();
  }

  async function bootstrap() {
    state.config = await invoke<AppConfig>("load_config");
    state.config.settings.theme = "dark";
    state.config.settings.recentDirs = state.config.settings.recentDirs ?? [];
    applyTheme("dark");
    renderRecentDirs();
    updateStartState();

    updateAgentPicker();
    renderSessionList();

    updateToolbarState();

    await listen<PtyOutput>("pty-output", (event) => {
      const session = Array.from(state.sessions.values()).find((item) => item.ptyId === event.payload.session_id);
      if (session?.term) {
        session.term.write(event.payload.data);
      }
    });

    await listen<PtyExit>("pty-exit", (event) => {
      const session = Array.from(state.sessions.values()).find((item) => item.ptyId === event.payload.session_id);
      if (!session) {
        return;
      }
      const elapsed = session.startedAt ? Date.now() - session.startedAt : null;
      if (elapsed !== null && elapsed < 2000) {
        session.status = "error";
        session.lastError = "Agent exited unexpectedly.";
        showBanner("Agent exited unexpectedly. Check repository and agent configuration.");
      } else {
        session.status = "stopped";
      }
      session.ptyId = undefined;
      renderSessionList();
      updateToolbarState();
    });

    await getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (closeInProgress) {
        return;
      }
      const hasRunning = Array.from(state.sessions.values()).some((session) => session.status === "running");
      if (!hasRunning) {
        closeInProgress = true;
        try {
          await invoke("exit_app");
        } catch (error) {
          closeInProgress = false;
          showBanner(`Unable to close app: ${String(error)}`);
        }
        return;
      }
      const confirmed = await confirm("You have active sessions. Close anyway?", {
        title: "Codelegate",
        kind: "warning",
      });
      if (confirmed) {
        closeInProgress = true;
        try {
          await invoke("exit_app");
        } catch (error) {
          closeInProgress = false;
          showBanner(`Unable to close app: ${String(error)}`);
        }
      }
    });
  }

  filterInput.addEventListener("input", (event) => {
    state.filter = (event.target as HTMLInputElement).value;
    renderSessionList();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = button.closest("dialog");
      dialog?.close();
    });
  });

  document.querySelector<HTMLButtonElement>("#new-session")?.addEventListener("click", () => {
    updateAgentPicker();
    resetSessionForm();
    sessionDialog.showModal();
  });

  document.querySelector<HTMLButtonElement>("#browse-repo")?.addEventListener("click", async () => {
    const selection = await open({ directory: true, multiple: false });
    if (typeof selection === "string") {
      updateRecentDirs(selection);
    }
  });

  repoTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (repoPicker.classList.contains("open")) {
      closeRepoMenu();
    } else {
      openRepoMenu();
    }
  });

  repoTrigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openRepoMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (!repoPicker.contains(event.target as Node)) {
      closeRepoMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeRepoMenu();
    }
  });

  worktreeToggle.addEventListener("change", () => {
    worktreeFields.classList.toggle("hidden", !worktreeToggle.checked);
  });

  document.querySelector<HTMLButtonElement>("#add-env")?.addEventListener("click", () => addEnvRow());

  sessionForm.addEventListener("submit", handleSessionSubmit);

  window.addEventListener("resize", () => {
    const session = state.sessions.get(state.activeSessionId);
    if (!session?.fit || !session.ptyId) {
      return;
    }
    session.fit.fit();
    invoke("resize_pty", {
      sessionId: session.ptyId,
      cols: session.term?.cols ?? 80,
      rows: session.term?.rows ?? 24,
    });
  });

  try {
    await bootstrap();
  } catch (error) {
    showBanner(String(error));
  }
}

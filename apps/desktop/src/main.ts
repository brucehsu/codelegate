import "xterm/css/xterm.css";
import "./style.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root element");
}

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-controls">
        <input class="input" id="session-filter" placeholder="Search sessions" />
        <button class="primary" id="new-session">New Session</button>
      </div>
      <div id="session-list" class="session-list"></div>
    </aside>
    <main class="main">
      <div id="banner" class="banner hidden"></div>
      <div class="tab-pane hidden" id="tab-pane">
        <div class="tab-strip">
          <button class="tab active" type="button" disabled>Agent</button>
        </div>
        <div class="tab-body">
          <div id="terminal-stack" class="terminal-stack"></div>
        </div>
      </div>
      <div id="empty-state" class="empty-state">
        <div class="empty-logo">⌘</div>
        <h1>Codelegate</h1>
      </div>
    </main>
  </div>

  <dialog id="session-dialog" class="dialog">
    <form id="session-form" class="dialog-form">
      <div class="dialog-header">
        <div>
          <h3>New Session</h3>
          <p>Launch a local agent session for a repository.</p>
        </div>
        <button type="button" class="ghost" data-close>Close</button>
      </div>

      <div class="form-grid">
        <div class="field full">
          <span>Agent CLI</span>
          <div class="agent-picker" id="agent-picker"></div>
          <span class="field-hint" id="agent-hint"></span>
        </div>

        <label class="field full">
          <span>Repository path</span>
          <div class="input-row">
            <div class="select-field" id="repo-picker">
              <button type="button" class="select-trigger placeholder" id="repo-trigger">
                <span id="repo-trigger-label">Select a directory</span>
              </button>
              <div class="select-menu" id="repo-menu"></div>
            </div>
            <button type="button" class="ghost" id="browse-repo">Browse</button>
          </div>
          <span class="field-hint" id="repo-hint"></span>
        </label>

        <label class="field checkbox full">
          <input type="checkbox" id="worktree-toggle" />
          <span>Create git worktree</span>
        </label>

        <div id="worktree-fields" class="worktree-fields hidden full">
          <label class="field">
            <span>Worktree path</span>
            <input id="worktree-path" class="input" placeholder="/path/to/worktree" />
          </label>
          <label class="field">
            <span>Branch (optional)</span>
            <input id="worktree-branch" class="input" placeholder="feature/my-branch" />
          </label>
        </div>

        <div class="field full">
          <span>Environment variables (optional)</span>
          <div id="env-list" class="env-list"></div>
          <button type="button" class="ghost" id="add-env">Add variable</button>
        </div>

        <label class="field full">
          <span>Commands to run before agent (optional)</span>
          <textarea id="pre-commands" class="input" rows="3" placeholder="# e.g. setup commands\nnpm install"></textarea>
        </label>
      </div>

      <div class="dialog-actions">
        <button type="button" class="ghost" data-close>Cancel</button>
        <button type="submit" class="primary" id="start-session" disabled>Start</button>
      </div>
    </form>
  </dialog>

`;

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
  repo: RepoConfig;
  status: "running" | "stopped" | "error";
  ptyId?: number;
  term?: Terminal;
  fit?: FitAddon;
  container?: HTMLDivElement;
  lastError?: string;
  startedAt?: number;
}

const agentCatalog = [
  {
    id: "claude" as const,
    label: "Claude Code",
    logo: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5l7 4v8l-7 4-7-4v-8l7-4z" fill="currentColor" opacity="0.2" />
        <path d="M12 5.2l4.9 2.8v5.9L12 16.7 7.1 14V8l4.9-2.8z" fill="currentColor" />
      </svg>
    `,
  },
  {
    id: "codex" as const,
    label: "Codex CLI",
    logo: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4a6 6 0 106 6h-2.2A3.8 3.8 0 1112 6.2V4z" fill="currentColor" />
        <path d="M12 20a6 6 0 10-6-6h2.2A3.8 3.8 0 0012 17.8V20z" fill="currentColor" opacity="0.6" />
      </svg>
    `,
  },
];

const agentCommandById: Record<AgentId, string> = {
  claude:
    'if command -v claude >/dev/null 2>&1; then exec claude; elif command -v claude-code >/dev/null 2>&1; then exec claude-code; else echo "Claude Code not found in PATH"; fi',
  codex:
    'if command -v codex >/dev/null 2>&1; then exec codex; elif command -v codex-cli >/dev/null 2>&1; then exec codex-cli; else echo "Codex CLI not found in PATH"; fi',
};

const state = {
  config: { version: 1, settings: { theme: "dark", recentDirs: [] } } as AppConfig,
  sessions: new Map<string, Session>(),
  activeRepo: "" as string | "",
  filter: "",
};

let closeInProgress = false;

const sessionList = document.querySelector<HTMLDivElement>("#session-list")!;
const terminalStack = document.querySelector<HTMLDivElement>("#terminal-stack")!;
const emptyState = document.querySelector<HTMLDivElement>("#empty-state")!;
const banner = document.querySelector<HTMLDivElement>("#banner")!;
const tabPane = document.querySelector<HTMLDivElement>("#tab-pane")!;

const sessionDialog = document.querySelector<HTMLDialogElement>("#session-dialog")!;

const agentPicker = document.querySelector<HTMLDivElement>("#agent-picker")!;
let selectedAgent: AgentId = "claude";
const agentHint = document.querySelector<HTMLSpanElement>("#agent-hint")!;
const repoPicker = document.querySelector<HTMLDivElement>("#repo-picker")!;
const repoTrigger = document.querySelector<HTMLButtonElement>("#repo-trigger")!;
const repoTriggerLabel = document.querySelector<HTMLSpanElement>("#repo-trigger-label")!;
const repoMenu = document.querySelector<HTMLDivElement>("#repo-menu")!;
let repoPathValue = "";
const startSessionButton = document.querySelector<HTMLButtonElement>("#start-session")!;
const repoHint = document.querySelector<HTMLSpanElement>("#repo-hint")!;
const worktreeToggle = document.querySelector<HTMLInputElement>("#worktree-toggle")!;
const worktreeFields = document.querySelector<HTMLDivElement>("#worktree-fields")!;
const worktreePathInput = document.querySelector<HTMLInputElement>("#worktree-path")!;
const worktreeBranchInput = document.querySelector<HTMLInputElement>("#worktree-branch")!;
const envList = document.querySelector<HTMLDivElement>("#env-list")!;
const preCommandsInput = document.querySelector<HTMLTextAreaElement>("#pre-commands")!;

const filterInput = document.querySelector<HTMLInputElement>("#session-filter")!;

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

function renderSessionList() {
  sessionList.innerHTML = "";
  const entries = Array.from(state.sessions.values()).filter((session) =>
    getRepoName(session.repo.repoPath).toLowerCase().includes(state.filter.toLowerCase())
  );

  entries.forEach((session) => {
    const button = document.createElement("button");
    button.className = "session-item";
    if (state.activeRepo === session.repo.repoPath) {
      button.classList.add("active");
    }
    button.dataset.repo = session.repo.repoPath;

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
    button.addEventListener("click", () => setActiveSession(session.repo.repoPath));

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

function setActiveSession(repoPath: string) {
  state.activeRepo = repoPath;
  renderSessionList();

  const session = state.sessions.get(repoPath);
  if (!session) {
    return;
  }

  ensureTerminal(session);

  state.sessions.forEach((item) => {
    if (item.container) {
      item.container.classList.toggle("hidden", item.repo.repoPath !== repoPath);
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

function updateAgentPicker() {
  agentPicker.innerHTML = "";
  agentCatalog.forEach((agent) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "agent-card";
    button.dataset.agent = agent.id;
    button.innerHTML = `
      <span class="agent-logo ${agent.id}">${agent.logo}</span>
      <span class="agent-label">${agent.label}</span>
    `;
    if (agent.id === selectedAgent) {
      button.classList.add("active");
    }
    button.addEventListener("click", () => {
      selectedAgent = agent.id;
      agentHint.textContent = "";
      updateAgentPicker();
      updateStartState();
    });
    agentPicker.appendChild(button);
  });
  agentHint.textContent = "";
}

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
  const session = state.sessions.get(state.activeRepo);
  if (!session) {
    tabPane.classList.add("hidden");
    return;
  }
  tabPane.classList.toggle("hidden", !session.term);
}

async function startSession(repo: RepoConfig) {
  clearBanner();

  const session = state.sessions.get(repo.repoPath) ?? {
    repo,
    status: "stopped" as const,
  };
  session.repo = repo;
  state.sessions.set(repo.repoPath, session);
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
  state.sessions.set(repo.repoPath, session);
  renderSessionList();
  setActiveSession(repo.repoPath);
}

async function stopSession(repoPath: string) {
  const session = state.sessions.get(repoPath);
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
  removeBtn.className = "ghost";
  removeBtn.textContent = "Remove";
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

  if (state.sessions.has(repoPath) && state.sessions.get(repoPath)?.status === "running") {
    showBanner("A session for this repository is already running.");
    return;
  }

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

const sessionForm = document.querySelector<HTMLFormElement>("#session-form")!;
sessionForm.addEventListener("submit", handleSessionSubmit);

window.addEventListener("resize", () => {
  const session = state.sessions.get(state.activeRepo);
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

bootstrap().catch((error) => showBanner(String(error)));

interface PtyOutput {
  session_id: number;
  data: string;
}

interface PtyExit {
  session_id: number;
}

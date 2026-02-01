import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { agentCommandById, darkTerminalTheme, lightTerminalTheme } from "../constants";
import type { AppConfig, PtyExit, PtyOutput, RepoConfig, Session, ToastInput } from "../types";
import { createSessionId, envListToMap, getRepoName } from "../utils/session";
import { escapeShellArg, shellArgs } from "../utils/shell";

interface SessionRuntime {
  container?: HTMLDivElement | null;
  term?: Terminal;
  fit?: FitAddon;
  ptyId?: number;
}

const defaultSettings = {
  theme: "dark" as const,
  recentDirs: [],
  terminalFontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
  terminalFontSize: 13,
};

const defaultConfig: AppConfig = {
  version: 1,
  settings: defaultSettings,
};

function formatWorktreeStamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}`;
}

function sanitizeRepoSlug(name: string) {
  const safe = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return safe || "repo";
}

export function useAppState(notify: (toast: ToastInput) => void) {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const runtimeRef = useRef(new Map<string, SessionRuntime>());
  const ptyToSessionRef = useRef(new Map<number, string>());
  const sessionsRef = useRef<Session[]>([]);
  const activeSessionRef = useRef<string | null>(null);
  const closeInProgressRef = useRef(false);
  const pendingFocusRef = useRef<string | null>(null);

  const focusSession = useCallback((sessionId: string) => {
    const runtime = runtimeRef.current.get(sessionId);
    if (runtime?.term) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          runtime.term?.focus();
        });
      });
      setTimeout(() => {
        runtime.term?.focus();
      }, 0);
      return true;
    }
    return false;
  }, []);

  const focusActiveSession = useCallback(() => {
    const sessionId = activeSessionRef.current;
    if (!sessionId) {
      return;
    }
    if (!focusSession(sessionId)) {
      pendingFocusRef.current = sessionId;
    }
  }, [focusSession]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  const applyTheme = useCallback((theme: "dark" | "light") => {
    document.body.dataset.theme = theme;
    runtimeRef.current.forEach((runtime) => {
      if (runtime.term) {
        runtime.term.options.theme = theme === "dark" ? darkTerminalTheme : lightTerminalTheme;
      }
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    invoke<AppConfig>("load_config")
      .then((loaded) => {
        if (!mounted) {
          return;
        }
        const nextConfig = {
          ...loaded,
          settings: {
            ...defaultSettings,
            ...loaded.settings,
            theme: "dark",
            recentDirs: loaded.settings?.recentDirs ?? defaultSettings.recentDirs,
          },
        } as AppConfig;
        setConfig(nextConfig);
        applyTheme("dark");
      })
      .catch(() => {
        applyTheme("dark");
      });
    return () => {
      mounted = false;
    };
  }, [applyTheme]);

  const updateRecentDirs = useCallback((path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      return;
    }
    setConfig((prev) => {
      const next = {
        ...prev,
        settings: {
          ...prev.settings,
          recentDirs: [trimmed, ...prev.settings.recentDirs.filter((entry) => entry !== trimmed)].slice(0, 10),
        },
      };
      invoke("save_config", { config: next });
      return next;
    });
  }, []);

  const updateTerminalSettings = useCallback((updates: { terminalFontFamily: string; terminalFontSize: number }) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        settings: {
          ...prev.settings,
          terminalFontFamily: updates.terminalFontFamily,
          terminalFontSize: updates.terminalFontSize,
        },
      };
      invoke("save_config", { config: next });
      return next;
    });

    runtimeRef.current.forEach((runtime) => {
      if (runtime.term) {
        runtime.term.options.fontFamily = updates.terminalFontFamily;
        runtime.term.options.fontSize = updates.terminalFontSize;
        runtime.fit?.fit();
        if (runtime.ptyId && runtime.term) {
          invoke("resize_pty", {
            sessionId: runtime.ptyId,
            cols: runtime.term.cols,
            rows: runtime.term.rows,
          });
        }
      }
    });
  }, []);

  useEffect(() => {
    const fontFamily = config.settings.terminalFontFamily;
    const fontSize = config.settings.terminalFontSize;
    runtimeRef.current.forEach((runtime) => {
      if (runtime.term) {
        runtime.term.options.fontFamily = fontFamily;
        runtime.term.options.fontSize = fontSize;
        runtime.fit?.fit();
        if (runtime.ptyId && runtime.term) {
          invoke("resize_pty", {
            sessionId: runtime.ptyId,
            cols: runtime.term.cols,
            rows: runtime.term.rows,
          });
        }
      }
    });
  }, [config.settings.terminalFontFamily, config.settings.terminalFontSize]);

  const ensureRuntime = useCallback((sessionId: string) => {
    const map = runtimeRef.current;
    let runtime = map.get(sessionId);
    if (!runtime) {
      runtime = {};
      map.set(sessionId, runtime);
    }
    return runtime;
  }, []);

  const registerTerminal = useCallback(
    (sessionId: string, element: HTMLDivElement | null) => {
      if (!element) {
        return;
      }
      const runtime = ensureRuntime(sessionId);
      if (runtime.container === element) {
        return;
      }
      runtime.container = element;

      if (!runtime.term) {
        const term = new Terminal({
          cursorBlink: true,
          fontFamily: config.settings.terminalFontFamily,
          theme: config.settings.theme === "dark" ? darkTerminalTheme : lightTerminalTheme,
          fontSize: config.settings.terminalFontSize,
          lineHeight: 1.25,
          scrollback: 1000,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(element);
        fit.fit();

        term.onData((data) => {
          if (runtime.ptyId) {
            invoke("write_pty", { sessionId: runtime.ptyId, data });
          }
        });

        const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
        term.attachCustomKeyEventHandler((event) => {
          if (event.type !== "keydown") {
            return true;
          }
          const key = event.key.toLowerCase();
          const isCopy = isMac ? event.metaKey && key === "c" : event.ctrlKey && event.shiftKey && key === "c";

          if (isCopy) {
            if (term.hasSelection()) {
              const text = term.getSelection();
              if (text) {
                navigator.clipboard.writeText(text).catch(() => {});
              }
              term.clearSelection();
            }
            return false;
          }

          return true;
        });

        runtime.term = term;
        runtime.fit = fit;
      }

      if (runtime.term) {
        if (pendingFocusRef.current === sessionId || activeSessionRef.current === sessionId) {
          focusSession(sessionId);
          pendingFocusRef.current = null;
        }
      }

      if (runtime.fit) {
        runtime.fit.fit();
      }
      if (runtime.ptyId && runtime.term) {
        invoke("resize_pty", {
          sessionId: runtime.ptyId,
          cols: runtime.term.cols,
          rows: runtime.term.rows,
        });
      }
    },
    [
      config.settings.theme,
      config.settings.terminalFontFamily,
      config.settings.terminalFontSize,
      ensureRuntime,
    ]
  );

  const updateSession = useCallback((sessionId: string, partial: Partial<Session>) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? { ...session, ...partial } : session)));
  }, []);

  const startSession = useCallback(
    async (repo: RepoConfig) => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      const sessionId = createSessionId(repo.repoPath);
      const session: Session = {
        id: sessionId,
        repo,
        status: "stopped",
      };

      setSessions((prev) => [...prev, session]);
      setActiveSessionId(sessionId);
      pendingFocusRef.current = sessionId;

      let shell = "";
      try {
        shell = await invoke<string>("get_default_shell");
      } catch (error) {
        updateSession(sessionId, { status: "error", lastError: String(error) });
        notify({ message: String(error), tone: "error" });
        return;
      }

      const envMap = envListToMap(repo.env);
      envMap.TERM = envMap.TERM || "xterm-256color";

      const repoRoot = repo.repoPath;
      let sessionCwd = repoRoot;
      const initCommands: string[] = [];

      if (repo.worktree?.enabled) {
        let homeDir = "";
        try {
          homeDir = await invoke<string>("get_home_dir");
        } catch (error) {
          updateSession(sessionId, { status: "error", lastError: String(error) });
          notify({ message: `Failed to resolve home directory: ${String(error)}`, tone: "error" });
          return;
        }

        const repoSlug = sanitizeRepoSlug(getRepoName(repoRoot));
        const stamp = formatWorktreeStamp(new Date());
        const worktreeRoot = `${homeDir}/.codelegate/worktrees/${repoSlug}`;
        const worktreePath = `${worktreeRoot}/${stamp}-${repo.agent}`;
        const base = escapeShellArg(repoRoot);
        const target = escapeShellArg(worktreePath);

        initCommands.push(`mkdir -p ${escapeShellArg(worktreeRoot)}`);
        initCommands.push(`git -C ${base} worktree add ${target}`);
        sessionCwd = worktreePath;
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

      const runtime = ensureRuntime(sessionId);

      let ptyId: number;
      try {
        ptyId = await invoke<number>("spawn_pty", {
          shell,
          args: shellArgs(shell, commandLine),
          cwd: repoRoot,
          env: envMap,
          cols: runtime.term?.cols ?? 80,
          rows: runtime.term?.rows ?? 24,
        });
      } catch (error) {
        updateSession(sessionId, { status: "error", lastError: String(error) });
        notify({ message: `Failed to start session: ${String(error)}`, tone: "error" });
        return;
      }

      runtime.ptyId = ptyId;
      ptyToSessionRef.current.set(ptyId, sessionId);

      updateSession(sessionId, { status: "running", lastError: undefined, startedAt: Date.now(), ptyId });

      if (runtime.term && runtime.fit) {
        runtime.fit.fit();
        invoke("resize_pty", {
          sessionId: ptyId,
          cols: runtime.term.cols,
          rows: runtime.term.rows,
        });
      }
    },
    [ensureRuntime, updateSession]
  );

  useEffect(() => {
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    listen<PtyOutput>("pty-output", (event) => {
      const sessionId = ptyToSessionRef.current.get(event.payload.session_id);
      if (!sessionId) {
        return;
      }
      const runtime = runtimeRef.current.get(sessionId);
      runtime?.term?.write(event.payload.data);
    }).then((unlisten) => {
      unlistenOutput = unlisten;
    });

    listen<PtyExit>("pty-exit", (event) => {
      const sessionId = ptyToSessionRef.current.get(event.payload.session_id);
      if (!sessionId) {
        return;
      }
      const runtime = runtimeRef.current.get(sessionId);
      if (runtime) {
        runtime.ptyId = undefined;
      }
      ptyToSessionRef.current.delete(event.payload.session_id);

      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) {
            return session;
          }
          const elapsed = session.startedAt ? Date.now() - session.startedAt : null;
          if (elapsed !== null && elapsed < 2000) {
            notify({ message: "Agent exited unexpectedly. Check repository and agent configuration.", tone: "error" });
            return { ...session, status: "error", lastError: "Agent exited unexpectedly.", ptyId: undefined };
          }
          return { ...session, status: "stopped", ptyId: undefined };
        })
      );
    }).then((unlisten) => {
      unlistenExit = unlisten;
    });

    return () => {
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const sessionId = activeSessionRef.current;
      if (!sessionId) {
        return;
      }
      const runtime = runtimeRef.current.get(sessionId);
      if (!runtime?.fit || !runtime.ptyId || !runtime.term) {
        return;
      }
      runtime.fit.fit();
      invoke("resize_pty", {
        sessionId: runtime.ptyId,
        cols: runtime.term.cols,
        rows: runtime.term.rows,
      });
    };

    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("resize", handler);
    };
  }, []);

  useEffect(() => {
    const sessionId = activeSessionId;
    if (!sessionId) {
      return;
    }
    if (!focusSession(sessionId)) {
      pendingFocusRef.current = sessionId;
    }
    const runtime = runtimeRef.current.get(sessionId);
    if (!runtime?.fit || !runtime.ptyId || !runtime.term) {
      return;
    }
    runtime.fit.fit();
    invoke("resize_pty", {
      sessionId: runtime.ptyId,
      cols: runtime.term.cols,
      rows: runtime.term.rows,
    });
  }, [activeSessionId, focusSession]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closeInProgressRef.current) {
          return;
        }
        const hasRunning = sessionsRef.current.some((session) => session.status === "running");
        if (!hasRunning) {
          closeInProgressRef.current = true;
          try {
            await invoke("exit_app");
          } catch (error) {
            closeInProgressRef.current = false;
            notify({ message: `Unable to close app: ${String(error)}`, tone: "error" });
          }
          return;
        }
        const confirmed = await confirm("You have active sessions. Close anyway?", {
          title: "Codelegate",
          kind: "warning",
        });
        if (confirmed) {
          closeInProgressRef.current = true;
          try {
            await invoke("exit_app");
          } catch (error) {
            closeInProgressRef.current = false;
            notify({ message: `Unable to close app: ${String(error)}`, tone: "error" });
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  return {
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
    focusActiveSession,
  };
}

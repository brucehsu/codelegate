import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { agentCommandById, darkTerminalTheme, lightTerminalTheme } from "../constants";
import type { AppConfig, PtyExit, PtyOutput, RepoConfig, Session, TerminalKind, ToastInput } from "../types";
import { createSessionId, envListToMap, getRepoName } from "../utils/session";
import { escapeShellArg, shellArgs } from "../utils/shell";

interface TerminalRuntime {
  container?: HTMLDivElement | null;
  term?: Terminal;
  fit?: FitAddon;
  ptyId?: number;
  starting?: boolean;
  resizeObserver?: ResizeObserver;
  resizeRaf?: number;
  lastFit?: {
    width: number;
    height: number;
    cols: number;
    rows: number;
  };
  isFollowing?: boolean;
  scrollDisposable?: { dispose: () => void };
  viewportEl?: HTMLDivElement | null;
  viewportHandler?: (() => void) | null;
}

interface SessionRuntime {
  agent: TerminalRuntime;
  terminal: TerminalRuntime;
}

interface Hotkey {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  handler: (event: KeyboardEvent) => void;
}

function matchesHotkey(event: KeyboardEvent, hotkey: Hotkey) {
  const key = event.key.toLowerCase();
  if (key !== hotkey.key) {
    return false;
  }
  if (hotkey.ctrl !== undefined && hotkey.ctrl !== event.ctrlKey) {
    return false;
  }
  if (hotkey.shift !== undefined && hotkey.shift !== event.shiftKey) {
    return false;
  }
  if (hotkey.alt !== undefined && hotkey.alt !== event.altKey) {
    return false;
  }
  if (hotkey.meta !== undefined && hotkey.meta !== event.metaKey) {
    return false;
  }
  return true;
}

function runHotkeys(event: KeyboardEvent, hotkeys: Hotkey[]) {
  for (const hotkey of hotkeys) {
    if (!matchesHotkey(event, hotkey)) {
      continue;
    }
    if (hotkey.preventDefault) {
      event.preventDefault();
    }
    if (hotkey.stopPropagation) {
      event.stopPropagation();
    }
    hotkey.handler(event);
    return true;
  }
  return false;
}

const defaultSettings = {
  theme: "dark" as const,
  recentDirs: [],
  terminalFontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
  terminalFontSize: 13,
  batterySaver: false,
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

function getNextVisibleSessionId(sessions: Session[], closingId: string) {
  const visible = sessions.filter((session) => !session.isTabClosed && session.id !== closingId);
  if (visible.length === 0) {
    return null;
  }

  const index = sessions.findIndex((session) => session.id === closingId);
  if (index < 0) {
    return visible[0].id;
  }

  for (let i = index + 1; i < sessions.length; i += 1) {
    const session = sessions[i];
    if (session && !session.isTabClosed && session.id !== closingId) {
      return session.id;
    }
  }

  for (let i = index - 1; i >= 0; i -= 1) {
    const session = sessions[i];
    if (session && !session.isTabClosed && session.id !== closingId) {
      return session.id;
    }
  }

  return visible[0].id;
}

export function useAppState(
  notify: (toast: ToastInput) => void,
  onOpenNewSession?: () => void,
  onFocusSearch?: () => void
) {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [unreadOutput, setUnreadOutput] = useState<Record<string, boolean>>({});

  const unreadOutputRef = useRef(unreadOutput);
  useEffect(() => {
    unreadOutputRef.current = unreadOutput;
  }, [unreadOutput]);

  const runtimeRef = useRef(new Map<string, SessionRuntime>());
  const ptyToSessionRef = useRef(new Map<number, { sessionId: string; kind: TerminalKind }>());
  const sessionsRef = useRef<Session[]>([]);
  const activeSessionRef = useRef<string | null>(null);
  const activeTerminalKindRef = useRef<TerminalKind>("agent");
  const closeInProgressRef = useRef(false);
  const pendingFocusRef = useRef<{ sessionId: string; kind: TerminalKind } | null>(null);

  const scheduleTerminalFit = useCallback((runtime: TerminalRuntime, force = false) => {
    if (!runtime.term || !runtime.fit || !runtime.container) {
      return;
    }
    if (runtime.resizeRaf !== undefined) {
      return;
    }
    runtime.resizeRaf = window.requestAnimationFrame(() => {
      runtime.resizeRaf = undefined;
      const container = runtime.container;
      if (!container || !container.isConnected) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width < 8 || height < 8) {
        return;
      }
      const previous = runtime.lastFit;
      const currentCols = runtime.term?.cols ?? 0;
      const currentRows = runtime.term?.rows ?? 0;
      if (
        !force &&
        previous &&
        previous.width === width &&
        previous.height === height &&
        previous.cols === currentCols &&
        previous.rows === currentRows
      ) {
        return;
      }
      runtime.fit?.fit();
      const cols = runtime.term?.cols ?? 0;
      const rows = runtime.term?.rows ?? 0;
      runtime.lastFit = { width, height, cols, rows };
      if (runtime.ptyId && runtime.term && (!previous || cols !== previous.cols || rows !== previous.rows)) {
        invoke("resize_pty", {
          sessionId: runtime.ptyId,
          cols,
          rows,
        });
      }
    });
  }, []);

  const getUnreadKey = useCallback((sessionId: string, kind: TerminalKind) => `${sessionId}:${kind}`, []);

  const setUnreadFor = useCallback(
    (sessionId: string, kind: TerminalKind, value: boolean) => {
      const key = getUnreadKey(sessionId, kind);
      const current = Boolean(unreadOutputRef.current[key]);
      if (current === value) {
        return;
      }
      setUnreadOutput((prev) => {
        const exists = Boolean(prev[key]);
        if (exists === value) {
          return prev;
        }
        if (!value) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: true };
      });
    },
    [getUnreadKey]
  );

  const focusSession = useCallback((sessionId: string, kind: TerminalKind) => {
    const runtime = runtimeRef.current.get(sessionId)?.[kind];
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
    const kind = activeTerminalKindRef.current;
    if (!focusSession(sessionId, kind)) {
      pendingFocusRef.current = { sessionId, kind };
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
      [runtime.agent, runtime.terminal].forEach((terminal) => {
        if (terminal.term) {
          terminal.term.options.theme = theme === "dark" ? darkTerminalTheme : lightTerminalTheme;
        }
      });
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
        document.body.dataset.batterySaver = nextConfig.settings.batterySaver ? "on" : "off";
      })
      .catch(() => {
        applyTheme("dark");
        document.body.dataset.batterySaver = "off";
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
      [runtime.agent, runtime.terminal].forEach((terminal) => {
        if (terminal.term) {
          terminal.term.options.fontFamily = updates.terminalFontFamily;
          terminal.term.options.fontSize = updates.terminalFontSize;
          scheduleTerminalFit(terminal, true);
        }
      });
    });
  }, [scheduleTerminalFit]);

  const updateBatterySaver = useCallback((enabled: boolean) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        settings: {
          ...prev.settings,
          batterySaver: enabled,
        },
      };
      invoke("save_config", { config: next });
      return next;
    });
    document.body.dataset.batterySaver = enabled ? "on" : "off";
  }, []);

  useEffect(() => {
    const fontFamily = config.settings.terminalFontFamily;
    const fontSize = config.settings.terminalFontSize;
    runtimeRef.current.forEach((runtime) => {
      [runtime.agent, runtime.terminal].forEach((terminal) => {
        if (terminal.term) {
          terminal.term.options.fontFamily = fontFamily;
          terminal.term.options.fontSize = fontSize;
          scheduleTerminalFit(terminal, true);
        }
      });
    });
  }, [config.settings.terminalFontFamily, config.settings.terminalFontSize, scheduleTerminalFit]);

  useEffect(() => {
    if (!document.fonts?.ready) {
      return;
    }
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) {
        return;
      }
      runtimeRef.current.forEach((runtime) => {
        [runtime.agent, runtime.terminal].forEach((terminal) => {
          if (terminal.term) {
            scheduleTerminalFit(terminal, true);
          }
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [scheduleTerminalFit]);

  const cycleSession = useCallback(() => {
    const list = sessionsRef.current;
    if (list.length === 0) {
      return;
    }

    const currentId = activeSessionRef.current;
    let index = list.findIndex((session) => session.id === currentId);
    if (index < 0) {
      index = 0;
    }

    const nextIndex = (index + 1) % list.length;
    setActiveSessionId(list[nextIndex].id);
  }, [setActiveSessionId]);

  const globalHotkeys = useMemo<Hotkey[]>(
    () => [
      {
        key: "tab",
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
        preventDefault: true,
        handler: () => cycleSession(),
      },
      {
        key: "t",
        ctrl: true,
        shift: true,
        alt: false,
        meta: false,
        preventDefault: true,
        handler: () => onOpenNewSession?.(),
      },
      {
        key: "s",
        ctrl: true,
        shift: true,
        alt: false,
        meta: false,
        preventDefault: true,
        handler: () => onFocusSearch?.(),
      },
    ],
    [cycleSession, onOpenNewSession, onFocusSearch]
  );

  const isMac = useMemo(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform), []);

  const ensureSessionRuntime = useCallback((sessionId: string) => {
    const map = runtimeRef.current;
    let runtime = map.get(sessionId);
    if (!runtime) {
      runtime = { agent: {}, terminal: {} };
      map.set(sessionId, runtime);
    }
    return runtime;
  }, []);

  const ensureTerminalRuntime = useCallback(
    (sessionId: string, kind: TerminalKind) => {
      const runtime = ensureSessionRuntime(sessionId);
      return runtime[kind];
    },
    [ensureSessionRuntime]
  );

  const setActiveTerminalKind = useCallback(
    (kind: TerminalKind) => {
      activeTerminalKindRef.current = kind;
      const sessionId = activeSessionRef.current;
      if (!sessionId) {
        return;
      }
      if (!focusSession(sessionId, kind)) {
        pendingFocusRef.current = { sessionId, kind };
      }
      const runtime = runtimeRef.current.get(sessionId)?.[kind];
      if (runtime) {
        scheduleTerminalFit(runtime);
      }
    },
    [focusSession, scheduleTerminalFit]
  );

  const jumpToBottom = useCallback(
    (sessionId: string, kind: TerminalKind) => {
      const runtime = runtimeRef.current.get(sessionId)?.[kind];
      if (!runtime?.term) {
        return;
      }
      runtime.isFollowing = true;
      runtime.term.scrollToBottom();
      setUnreadFor(sessionId, kind, false);
      scheduleTerminalFit(runtime);
    },
    [scheduleTerminalFit, setUnreadFor]
  );

  const registerTerminal = useCallback(
    (sessionId: string, kind: TerminalKind, element: HTMLDivElement | null) => {
      if (!element) {
        const runtime = runtimeRef.current.get(sessionId)?.[kind];
        if (!runtime) {
          return;
        }
        runtime.container = null;
        runtime.lastFit = undefined;
        runtime.isFollowing = undefined;
        if (runtime.resizeObserver) {
          runtime.resizeObserver.disconnect();
          runtime.resizeObserver = undefined;
        }
        runtime.scrollDisposable?.dispose();
        runtime.scrollDisposable = undefined;
        if (runtime.viewportEl && runtime.viewportHandler) {
          runtime.viewportEl.removeEventListener("scroll", runtime.viewportHandler);
        }
        runtime.viewportEl = null;
        runtime.viewportHandler = null;
        if (runtime.resizeRaf !== undefined) {
          window.cancelAnimationFrame(runtime.resizeRaf);
          runtime.resizeRaf = undefined;
        }
        return;
      }
      const runtime = ensureTerminalRuntime(sessionId, kind);
      runtime.container = element;
      runtime.lastFit = undefined;
      if (!runtime.resizeObserver) {
        runtime.resizeObserver = new ResizeObserver(() => scheduleTerminalFit(runtime));
      } else {
        runtime.resizeObserver.disconnect();
      }
      runtime.resizeObserver.observe(element);
      const allowTerminalStart = kind !== "terminal" || activeTerminalKindRef.current === "terminal";

      if (!runtime.term) {
        if (!allowTerminalStart) {
          return;
        }
        const term = new Terminal({
          allowProposedApi: true,
          cursorBlink: true,
          fontFamily: config.settings.terminalFontFamily,
          theme: config.settings.theme === "dark" ? darkTerminalTheme : lightTerminalTheme,
          fontSize: config.settings.terminalFontSize,
          lineHeight: 1.25,
          modifyOtherKeys: 2,
          scrollOnOutput: false,
          scrollOnUserInput: false,
          scrollback: 1000,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(element);

        term.onData((data) => {
          if (runtime.isFollowing === false) {
            runtime.isFollowing = true;
            term.scrollToBottom();
            setUnreadFor(sessionId, kind, false);
          }
          if (runtime.ptyId) {
            invoke("write_pty", { sessionId: runtime.ptyId, data });
          }
        });

        term.attachCustomKeyEventHandler((event) => {
          if (event.type !== "keydown") {
            return true;
          }
          if (
            event.shiftKey &&
            (event.key === "Enter" || event.key === "Return" || event.code === "NumpadEnter")
          ) {
            event.preventDefault();
            event.stopPropagation();
            const sequence = "\x1b[13;2u";
            if (runtime.ptyId) {
              invoke("write_pty", { sessionId: runtime.ptyId, data: sequence });
            } else {
              term.write(sequence);
            }
            return false;
          }
          const copyHotkey: Hotkey = isMac
            ? {
                key: "c",
                ctrl: false,
                shift: false,
                alt: false,
                meta: true,
                preventDefault: true,
                handler: () => {
                  if (term.hasSelection()) {
                    const text = term.getSelection();
                    if (text) {
                      navigator.clipboard.writeText(text).catch(() => {});
                    }
                    term.clearSelection();
                  }
                },
              }
            : {
                key: "c",
                ctrl: true,
                shift: true,
                alt: false,
                meta: false,
                preventDefault: true,
                handler: () => {
                  if (term.hasSelection()) {
                    const text = term.getSelection();
                    if (text) {
                      navigator.clipboard.writeText(text).catch(() => {});
                    }
                    term.clearSelection();
                  }
                },
              };

          const handled = runHotkeys(event, [...globalHotkeys, copyHotkey]);
          return !handled;
        });

        runtime.term = term;
        runtime.fit = fit;
      }
      if (runtime.term && !runtime.scrollDisposable) {
        runtime.scrollDisposable = runtime.term.onScroll(() => {
          const buffer = runtime.term?.buffer.active;
          if (!buffer) {
            return;
          }
          const distanceFromBottom = buffer.baseY - buffer.viewportY;
          runtime.isFollowing = distanceFromBottom <= 1;
          setUnreadFor(sessionId, kind, !runtime.isFollowing);
        });
      }
      if (runtime.term) {
        const viewport = element.querySelector(".xterm-viewport") as HTMLDivElement | null;
        if (viewport && (runtime.viewportEl !== viewport || !runtime.viewportHandler)) {
          if (runtime.viewportEl && runtime.viewportHandler) {
            runtime.viewportEl.removeEventListener("scroll", runtime.viewportHandler);
          }
          const handler = () => {
            const buffer = runtime.term?.buffer.active;
            if (!buffer) {
              return;
            }
            const distanceFromBottom = buffer.baseY - buffer.viewportY;
            runtime.isFollowing = distanceFromBottom <= 1;
            setUnreadFor(sessionId, kind, !runtime.isFollowing);
          };
          runtime.viewportEl = viewport;
          runtime.viewportHandler = handler;
          viewport.addEventListener("scroll", handler, { passive: true });
          handler();
        }
      }
      if (runtime.term) {
        const buffer = runtime.term.buffer.active;
        const distanceFromBottom = buffer.baseY - buffer.viewportY;
        runtime.isFollowing = distanceFromBottom <= 1;
        setUnreadFor(sessionId, kind, !runtime.isFollowing);
      }

      if (runtime.term) {
        const pending = pendingFocusRef.current;
        if (
          (pending && pending.sessionId === sessionId && pending.kind === kind) ||
          (activeSessionRef.current === sessionId && activeTerminalKindRef.current === kind)
        ) {
          focusSession(sessionId, kind);
          pendingFocusRef.current = null;
        }
      }

      scheduleTerminalFit(runtime);

      if (kind === "terminal" && runtime.term && !runtime.ptyId && !runtime.starting && allowTerminalStart) {
        runtime.starting = true;
        const session = sessionsRef.current.find((item) => item.id === sessionId);
        const sessionCwd = session?.cwd ?? session?.repo.repoPath;
        if (!session || !sessionCwd) {
          runtime.starting = false;
          return;
        }
        invoke<string>("get_default_shell")
          .then((shell) => {
            const envMap = envListToMap(session.repo.env);
            envMap.TERM = envMap.TERM || "xterm-256color";
            return invoke<number>("spawn_pty", {
              shell,
              args: shellArgs(shell),
              cwd: sessionCwd,
              env: envMap,
              cols: runtime.term?.cols ?? 80,
              rows: runtime.term?.rows ?? 24,
            });
          })
          .then((ptyId) => {
            runtime.ptyId = ptyId;
            ptyToSessionRef.current.set(ptyId, { sessionId, kind: "terminal" });
            scheduleTerminalFit(runtime);
          })
          .catch((error) => {
            notify({ message: `Failed to start terminal: ${String(error)}`, tone: "error" });
          })
          .finally(() => {
            runtime.starting = false;
          });
      }
    },
    [
      config.settings.theme,
      config.settings.terminalFontFamily,
      config.settings.terminalFontSize,
      ensureTerminalRuntime,
      globalHotkeys,
      isMac,
      focusSession,
      scheduleTerminalFit,
      setUnreadFor,
      notify,
    ]
  );

  const updateSession = useCallback((sessionId: string, partial: Partial<Session>) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? { ...session, ...partial } : session)));
  }, []);

  const renameBranch = useCallback(
    async (sessionId: string, newName: string) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      const cwd = session?.cwd ?? session?.repo.repoPath;
      if (!cwd) {
        notify({ message: "Unable to resolve session path.", tone: "error" });
        return false;
      }
      const trimmed = newName.trim();
      if (!trimmed) {
        notify({ message: "Branch name cannot be empty.", tone: "error" });
        return false;
      }
      try {
        const branch = await invoke<string>("rename_git_branch", { path: cwd, name: trimmed });
        updateSession(sessionId, { branch: branch.trim() || trimmed });
        return true;
      } catch (error) {
        notify({ message: `Failed to rename branch: ${String(error)}`, tone: "error" });
        return false;
      }
    },
    [notify, updateSession]
  );

  const closeSessionTab = useCallback(
    (sessionId: string) => {
      const closingActive = activeSessionRef.current === sessionId;
      const nextActiveId = closingActive ? getNextVisibleSessionId(sessionsRef.current, sessionId) : null;

      setSessions((prev) =>
        prev.map((session) => (session.id === sessionId ? { ...session, isTabClosed: true } : session))
      );

      if (closingActive) {
        setActiveSessionId(nextActiveId);
      }
    },
    [setActiveSessionId]
  );

  const terminateSession = useCallback(
    async (sessionId: string) => {
      const runtime = runtimeRef.current.get(sessionId);
      const ptyIds = new Set<number>();

      if (runtime?.agent.ptyId) {
        ptyIds.add(runtime.agent.ptyId);
      }
      if (runtime?.terminal.ptyId) {
        ptyIds.add(runtime.terminal.ptyId);
      }

      const closingActive = activeSessionRef.current === sessionId;
      const nextActiveId = closingActive ? getNextVisibleSessionId(sessionsRef.current, sessionId) : null;

      if (ptyIds.size > 0) {
        await Promise.all(
          Array.from(ptyIds).map((ptyId) =>
            invoke("kill_pty", { sessionId: ptyId }).catch((error) => {
              notify({ message: `Failed to terminate session: ${String(error)}`, tone: "error" });
            })
          )
        );
      }

      ptyIds.forEach((ptyId) => {
        ptyToSessionRef.current.delete(ptyId);
      });

      if (pendingFocusRef.current?.sessionId === sessionId) {
        pendingFocusRef.current = null;
      }

      runtimeRef.current.delete(sessionId);
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));

      if (closingActive) {
        setActiveSessionId(nextActiveId);
      }
    },
    [notify, setActiveSessionId]
  );

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
        cwd: repo.repoPath,
        status: "stopped",
      };

      setSessions((prev) => [...prev, session]);
      setActiveSessionId(sessionId);
      pendingFocusRef.current = { sessionId, kind: activeTerminalKindRef.current };

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
      updateSession(sessionId, { cwd: sessionCwd });

      const resolveBranch = async (attempts: number) => {
        try {
          const branch = await invoke<string>("get_git_branch", { path: sessionCwd });
          if (branch && branch.trim().length > 0) {
            updateSession(sessionId, { branch: branch.trim() });
            return;
          }
        } catch {
          // Ignore and retry below.
        }
        if (attempts > 0) {
          setTimeout(() => resolveBranch(attempts - 1), 500);
        }
      };

      resolveBranch(repo.worktree?.enabled ? 5 : 1);

      const runtime = ensureTerminalRuntime(sessionId, "agent");

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
      ptyToSessionRef.current.set(ptyId, { sessionId, kind: "agent" });

      updateSession(sessionId, { status: "running", lastError: undefined, startedAt: Date.now(), ptyId });

      if (runtime.term && runtime.fit) {
        scheduleTerminalFit(runtime);
      }
    },
    [ensureTerminalRuntime, scheduleTerminalFit, updateSession]
  );

  useEffect(() => {
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    listen<PtyOutput>("pty-output", (event) => {
      const info = ptyToSessionRef.current.get(event.payload.session_id);
      if (!info) {
        return;
      }
      const runtime = runtimeRef.current.get(info.sessionId)?.[info.kind];
      if (!runtime?.term) {
        return;
      }
      const buffer = runtime.term.buffer.active;
      const distanceFromBottom = buffer.baseY - buffer.viewportY;
      const shouldFollow = distanceFromBottom <= 1;
      runtime.isFollowing = shouldFollow;
      if (shouldFollow) {
        scheduleTerminalFit(runtime);
        setUnreadFor(info.sessionId, info.kind, false);
      } else {
        setUnreadFor(info.sessionId, info.kind, true);
      }
      runtime.term.write(event.payload.data, () => {
        if (shouldFollow) {
          runtime.term?.scrollToBottom();
        }
      });
    }).then((unlisten) => {
      unlistenOutput = unlisten;
    });

    listen<PtyExit>("pty-exit", (event) => {
      const info = ptyToSessionRef.current.get(event.payload.session_id);
      if (!info) {
        return;
      }
      const runtime = runtimeRef.current.get(info.sessionId)?.[info.kind];
      if (runtime) {
        runtime.ptyId = undefined;
      }
      ptyToSessionRef.current.delete(event.payload.session_id);

      if (info.kind !== "agent") {
        return;
      }

      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== info.sessionId) {
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
      const runtime = runtimeRef.current.get(sessionId)?.[activeTerminalKindRef.current];
      if (!runtime) {
        return;
      }
      scheduleTerminalFit(runtime);
    };

    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("resize", handler);
    };
  }, [scheduleTerminalFit]);

  useEffect(() => {
    const sessionId = activeSessionId;
    if (!sessionId) {
      return;
    }
    const kind = activeTerminalKindRef.current;
    if (!focusSession(sessionId, kind)) {
      pendingFocusRef.current = { sessionId, kind };
    }
    const runtime = runtimeRef.current.get(sessionId)?.[kind];
    if (!runtime) {
      return;
    }
    scheduleTerminalFit(runtime);
  }, [activeSessionId, focusSession, scheduleTerminalFit]);

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

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      runHotkeys(event, globalHotkeys);
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [globalHotkeys]);

  return {
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
    closeSessionTab,
    terminateSession,
    focusActiveSession,
    unreadOutput,
    jumpToBottom,
  };
}

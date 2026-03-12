import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { agentCommandById } from "../constants";
import { DEFAULT_TERMINAL_LINE_HEIGHT, useTerminalRenderer } from "./useTerminalRenderer";
import type { TerminalAppearance, TerminalRendererRuntime } from "./useTerminalRenderer";
import type {
  AppConfig,
  AppSettings,
  CloseConfirmPayload,
  CloseConfirmResult,
  EnvVar,
  PtyExit,
  PtyOutput,
  PreviousSessionsPayload,
  RepoConfig,
  Session,
  PaneKind,
  ToastInput,
} from "../types";
import { createSessionId, envListToMap, getRepoName } from "../utils/session";
import { escapeShellArg, shellArgs } from "../utils/shell";
import { defineHotkey, runHotkeys, type HotkeyBinding } from "../utils/hotkeys";
import { buildShortcutCombo, normalizeShortcutModifier } from "../utils/shortcutModifier";

interface TerminalRuntime extends TerminalRendererRuntime {
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
  savedViewportY?: number;
  scrollDisposable?: { dispose: () => void };
  viewportEl?: HTMLDivElement | null;
  viewportHandler?: (() => void) | null;
  activationRaf?: number;
  rendererAttachRaf?: number;
  webglPostInitTimer?: number;
  notificationDisposables?: Array<{ dispose: () => void }>;
}

interface SessionRuntime {
  agent: TerminalRuntime;
  git: TerminalRuntime;
  terminal: TerminalRuntime;
}

interface WorktreeCleanupOptions {
  repoPath: string;
  worktreePath: string;
  branch?: string;
}

function forEachTerminalRuntime(
  runtimeMap: Map<string, SessionRuntime>,
  apply: (terminal: TerminalRuntime) => void
) {
  runtimeMap.forEach((runtime) => {
    apply(runtime.agent);
    apply(runtime.git);
    apply(runtime.terminal);
  });
}

function isTextInputElement(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  if (element instanceof HTMLSelectElement) {
    return true;
  }
  if (element instanceof HTMLInputElement) {
    const nonTextTypes = new Set([
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ]);
    return !nonTextTypes.has((element.type || "text").toLowerCase());
  }
  const role = element.getAttribute("role");
  return role === "textbox" || role === "searchbox";
}

function isRuntimeVisible(runtime?: TerminalRuntime) {
  const container = runtime?.container;
  if (!container || !container.isConnected) {
    return false;
  }
  const rect = container.getBoundingClientRect();
  return rect.width >= 8 && rect.height >= 8;
}

function decodeBase64ToUint8(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseOsc777Notification(data: string) {
  const trimmed = data.trim();
  if (!trimmed.startsWith("notify;")) {
    return null;
  }
  const payload = trimmed.slice("notify;".length);
  if (!payload) {
    return null;
  }
  const separatorIndex = payload.indexOf(";");
  if (separatorIndex < 0) {
    const message = payload.trim();
    if (!message) {
      return null;
    }
    return { title: "Codelegate", message };
  }
  const title = payload.slice(0, separatorIndex).trim();
  const message = payload.slice(separatorIndex + 1).trim();
  if (!title && !message) {
    return null;
  }
  return {
    title: title || "Codelegate",
    message: message || title,
  };
}

function decodeBase64Text(data: string) {
  const normalized = data.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) {
    return "";
  }
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function parseOsc52ClipboardData(data: string) {
  const separatorIndex = data.indexOf(";");
  if (separatorIndex < 0) {
    return null;
  }
  const encoded = data.slice(separatorIndex + 1).trim();
  if (!encoded || encoded === "?") {
    return null;
  }
  try {
    return decodeBase64Text(encoded);
  } catch {
    return null;
  }
}

const defaultSettings = {
  theme: "dark" as const,
  recentDirs: [],
  terminalFontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
  terminalFontSize: 13,
  shortcutModifier: "Alt",
  repoDefaults: {},
  agentArgs: {},
};

const defaultConfig: AppConfig = {
  version: 1,
  settings: defaultSettings,
};

const TERMINAL_SCROLLBACK_LINES = 30000;

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

function ensureTermEnv(env: Record<string, string>) {
  if (!env.TERM) {
    env.TERM = "xterm-256color";
  }
  return env;
}

function applyAgentArgs(command: string, args: string) {
  const trimmed = args.trim();
  if (!trimmed) {
    return command;
  }
  if (!command.includes("exec ")) {
    return `${command} ${trimmed}`;
  }
  return command.replace(/exec ([^;]+)/g, `exec $1 ${trimmed}`);
}

function normalizeEnvVars(env: EnvVar[]) {
  return env
    .map((entry) => ({
      key: entry.key.trim(),
      value: (entry.value ?? "").trim(),
    }))
    .filter((entry) => entry.key.length > 0 && entry.value.length > 0);
}

function normalizeFontFamily(value: string): string {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    return defaultSettings.terminalFontFamily;
  }
  return entries
    .map((entry) => {
      const alreadyQuoted =
        (entry.startsWith('"') && entry.endsWith('"')) ||
        (entry.startsWith("'") && entry.endsWith("'"));
      if (alreadyQuoted || !/\s/.test(entry)) {
        return entry;
      }
      return `"${entry.replace(/"/g, '\\"')}"`;
    })
    .join(", ");
}

function resolveSessionCwd(session?: Session | null) {
  return session?.cwd ?? session?.repo.repoPath ?? null;
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
  onFocusSearch?: () => void,
  onConfirmClose?: (payload: CloseConfirmPayload) => Promise<CloseConfirmResult>
) {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [hasSavedConfig, setHasSavedConfig] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [unreadOutput, setUnreadOutput] = useState<Record<string, boolean>>({});
  const [agentOutputting, setAgentOutputting] = useState<Record<string, boolean>>({});
  const configRef = useRef(config);
  const configReadyResolveRef = useRef<(() => void) | null>(null);
  const configReadyPromiseRef = useRef(
    new Promise<void>((resolve) => {
      configReadyResolveRef.current = resolve;
    })
  );

  const unreadOutputRef = useRef(unreadOutput);
  const agentOutputtingRef = useRef(agentOutputting);
  const agentOutputtingTimersRef = useRef<Map<string, number>>(new Map());
  const agentOutputtingSuppressUntilRef = useRef<Map<string, number>>(new Map());
  const notificationPermissionRequestRef = useRef<Promise<string> | null>(null);
  const notificationPluginUnavailableRef = useRef(false);
  const fontRefreshRafRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    unreadOutputRef.current = unreadOutput;
  }, [unreadOutput]);
  useEffect(() => {
    agentOutputtingRef.current = agentOutputting;
  }, [agentOutputting]);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const runtimeRef = useRef(new Map<string, SessionRuntime>());
  const ptyToSessionRef = useRef(new Map<number, { sessionId: string; kind: PaneKind }>());
  const sessionsRef = useRef<Session[]>([]);
  const activeSessionRef = useRef<string | null>(null);
  const activePaneKindRef = useRef<PaneKind>("agent");
  const closeInProgressRef = useRef(false);
  const closePromptInProgressRef = useRef(false);
  const pendingExitRequestRef = useRef(false);
  const restoreInProgressRef = useRef(false);
  const pendingFocusRef = useRef<{ sessionId: string; kind: PaneKind } | null>(null);
  const isMac = useMemo(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform), []);

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
      const term = runtime.term;
      if (!term) {
        return;
      }
      const previous = runtime.lastFit;
      const currentCols = term.cols ?? 0;
      const currentRows = term.rows ?? 0;
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
      term.write("", () => {
        runtime.fit?.fit();
        const cols = runtime.term?.cols ?? term.cols ?? 0;
        const rows = runtime.term?.rows ?? term.rows ?? 0;
        runtime.lastFit = { width, height, cols, rows };
        if (runtime.ptyId && runtime.term && (!previous || cols !== previous.cols || rows !== previous.rows)) {
          invoke("resize_pty", {
            sessionId: runtime.ptyId,
            cols,
            rows,
          });
        }
      });
    });
  }, [notify, onConfirmClose]);

  const registerPty = useCallback(
    (runtime: TerminalRuntime, sessionId: string, kind: PaneKind, ptyId: number) => {
      runtime.ptyId = ptyId;
      ptyToSessionRef.current.set(ptyId, { sessionId, kind });
      scheduleTerminalFit(runtime);
    },
    [scheduleTerminalFit]
  );

  const getUnreadKey = useCallback((sessionId: string, kind: PaneKind) => `${sessionId}:${kind}`, []);

  const setUnreadFor = useCallback(
    (sessionId: string, kind: PaneKind, value: boolean) => {
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

  const setAgentOutputtingFor = useCallback((sessionId: string, value: boolean) => {
    const current = Boolean(agentOutputtingRef.current[sessionId]);
    if (current === value) {
      return;
    }
    setAgentOutputting((prev) => {
      const exists = Boolean(prev[sessionId]);
      if (exists === value) {
        return prev;
      }
      if (!value) {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      }
      return { ...prev, [sessionId]: true };
    });
  }, []);

  const suppressAgentOutputting = useCallback((sessionId: string, durationMs: number) => {
    const now = performance.now();
    const nextUntil = now + durationMs;
    const currentUntil = agentOutputtingSuppressUntilRef.current.get(sessionId) ?? 0;
    if (nextUntil > currentUntil) {
      agentOutputtingSuppressUntilRef.current.set(sessionId, nextUntil);
    }
  }, []);

  const markAgentOutputting = useCallback(
    (sessionId: string) => {
      setAgentOutputtingFor(sessionId, true);
      const existing = agentOutputtingTimersRef.current.get(sessionId);
      if (existing) {
        window.clearTimeout(existing);
      }
      const timeout = window.setTimeout(() => {
        agentOutputtingTimersRef.current.delete(sessionId);
        setAgentOutputtingFor(sessionId, false);
      }, 700);
      agentOutputtingTimersRef.current.set(sessionId, timeout);
    },
    [setAgentOutputtingFor]
  );

  const clearAgentOutputting = useCallback(
    (sessionId: string) => {
      const existing = agentOutputtingTimersRef.current.get(sessionId);
      if (existing) {
        window.clearTimeout(existing);
        agentOutputtingTimersRef.current.delete(sessionId);
      }
      agentOutputtingSuppressUntilRef.current.delete(sessionId);
      setAgentOutputtingFor(sessionId, false);
    },
    [setAgentOutputtingFor]
  );

  const setFollowingState = useCallback(
    (runtime: TerminalRuntime, sessionId: string, kind: PaneKind, isFollowing: boolean) => {
      runtime.isFollowing = isFollowing;
      setUnreadFor(sessionId, kind, !isFollowing);
    },
    [setUnreadFor]
  );

  const updateFollowState = useCallback(
    (runtime: TerminalRuntime, sessionId: string, kind: PaneKind, viewport?: HTMLDivElement | null) => {
      const buffer = runtime.term?.buffer.active;
      if (!buffer) {
        return;
      }
      const distanceFromBottom = buffer.baseY - buffer.viewportY;
      setFollowingState(runtime, sessionId, kind, distanceFromBottom <= 1);
    },
    [setFollowingState]
  );

  const focusSession = useCallback((sessionId: string, kind: PaneKind) => {
    const runtime = runtimeRef.current.get(sessionId)?.[kind];
    if (runtime?.term) {
      const activeElement = document.activeElement;
      const activeInsideTerminal = activeElement instanceof Element && Boolean(activeElement.closest(".xterm"));
      if (isTextInputElement(activeElement) && !activeInsideTerminal) {
        return true;
      }
      if (!isRuntimeVisible(runtime)) {
        return false;
      }
      runtime.term.clearSelection();
      requestAnimationFrame(() => {
        runtime.term?.focus();
      });
      return true;
    }
    return false;
  }, []);

  const focusActiveSession = useCallback(() => {
    const sessionId = activeSessionRef.current;
    if (!sessionId) {
      return;
    }
    const kind = activePaneKindRef.current;
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

  const markConfigReady = useCallback(() => {
    configReadyResolveRef.current?.();
    configReadyResolveRef.current = null;
  }, []);

  const saveConfig = useCallback((updater: (prev: AppConfig) => AppConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      invoke("save_config", { config: next })
        .then(() => {
          setHasSavedConfig(true);
        })
        .catch((error) => {
          notify({ message: `Failed to save config: ${String(error)}`, tone: "error" });
        });
      return next;
    });
  }, [notify]);

  const updateSettings = useCallback(
    (updater: (settings: AppSettings) => AppSettings) => {
      saveConfig((prev) => ({
        ...prev,
        settings: updater(prev.settings),
      }));
    },
    [saveConfig]
  );

  const applyTheme = useCallback((theme: "dark" | "light") => {
    document.body.dataset.theme = theme;
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      invoke<AppConfig>("load_config"),
      invoke<boolean>("has_saved_config").catch(() => false),
    ])
      .then(([loaded, hasSaved]) => {
        if (!mounted) {
          return;
        }
        const nextConfig = {
          ...loaded,
          settings: {
            ...defaultSettings,
            ...loaded.settings,
            theme: loaded.settings?.theme ?? defaultSettings.theme,
            recentDirs: loaded.settings?.recentDirs ?? defaultSettings.recentDirs,
            terminalFontFamily: normalizeFontFamily(
              loaded.settings?.terminalFontFamily ?? defaultSettings.terminalFontFamily
            ),
            shortcutModifier: normalizeShortcutModifier(
              loaded.settings?.shortcutModifier ?? defaultSettings.shortcutModifier
            ),
            repoDefaults: loaded.settings?.repoDefaults ?? defaultSettings.repoDefaults,
            agentArgs: loaded.settings?.agentArgs ?? defaultSettings.agentArgs,
          },
        } as AppConfig;
        setConfig(nextConfig);
        setHasSavedConfig(hasSaved);
        applyTheme(nextConfig.settings.theme);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setHasSavedConfig(false);
        applyTheme(defaultSettings.theme);
      })
      .finally(() => {
        markConfigReady();
      });
    return () => {
      mounted = false;
    };
  }, [applyTheme, markConfigReady]);

  const persistConfig = useCallback(async () => {
    try {
      await invoke("save_config", { config: configRef.current });
      setHasSavedConfig(true);
      return true;
    } catch (error) {
      notify({ message: `Failed to save config: ${String(error)}`, tone: "error" });
      return false;
    }
  }, [notify]);

  const updateRecentDirs = useCallback((path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      return;
    }
    updateSettings((settings) => ({
      ...settings,
      recentDirs: [trimmed, ...settings.recentDirs.filter((entry) => entry !== trimmed)].slice(0, 10),
    }));
  }, [updateSettings]);

  const toTerminalAppearance = useCallback(
    (settings: Pick<AppSettings, "terminalFontFamily" | "terminalFontSize">): TerminalAppearance => ({
      fontFamily: settings.terminalFontFamily,
      fontSize: settings.terminalFontSize,
      lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
    }),
    []
  );

  const {
    applyTerminalAppearance,
    clearPendingRendererAttach,
    ensureWebglRenderer,
    loadTerminalFonts,
    refreshTerminalRows,
    refreshWebglRenderer,
  } = useTerminalRenderer();

  const applyTerminalAppearanceToRuntime = useCallback(
    (runtime: TerminalRuntime, appearance: TerminalAppearance, ensureRenderer = true) => {
      if (!runtime.term) {
        return;
      }
      applyTerminalAppearance(runtime, appearance);
      if (ensureRenderer) {
        ensureWebglRenderer(runtime, appearance);
      }
      if (runtime.webgl) {
        refreshWebglRenderer(runtime);
      } else {
        refreshTerminalRows(runtime.term);
      }
      scheduleTerminalFit(runtime, true);
    },
    [applyTerminalAppearance, ensureWebglRenderer, refreshTerminalRows, refreshWebglRenderer, scheduleTerminalFit]
  );

  const applyTerminalAppearanceToAll = useCallback(
    (appearance: TerminalAppearance, ensureRenderer = true) => {
      forEachTerminalRuntime(runtimeRef.current, (runtime) => {
        applyTerminalAppearanceToRuntime(runtime, appearance, ensureRenderer);
      });
    },
    [applyTerminalAppearanceToRuntime]
  );

  const activateRuntime = useCallback(
    (runtime: TerminalRuntime, options?: { focus?: boolean; clearSelection?: boolean }) => {
      const term = runtime.term;
      if (!term) {
        return;
      }
      if (runtime.activationRaf !== undefined) {
        window.cancelAnimationFrame(runtime.activationRaf);
      }
      runtime.activationRaf = window.requestAnimationFrame(() => {
        runtime.activationRaf = undefined;
        if (!runtime.term || !isRuntimeVisible(runtime)) {
          return;
        }
        const appearance = toTerminalAppearance(configRef.current.settings);
        applyTerminalAppearanceToRuntime(runtime, appearance, true);
        if (options?.clearSelection !== false) {
          runtime.term.clearSelection();
        }
        if (options?.focus) {
          runtime.term.focus();
        }
      });
    },
    [applyTerminalAppearanceToRuntime, toTerminalAppearance]
  );

  const refreshTerminalRenderersAfterFontLoad = useCallback(() => {
    applyTerminalAppearanceToAll(toTerminalAppearance(configRef.current.settings));
  }, [applyTerminalAppearanceToAll, toTerminalAppearance]);

  const terminalAppearance = useMemo(
    () =>
      toTerminalAppearance({
        terminalFontFamily: config.settings.terminalFontFamily,
        terminalFontSize: config.settings.terminalFontSize,
      }),
    [config.settings.terminalFontFamily, config.settings.terminalFontSize, toTerminalAppearance]
  );

  const updateTerminalSettings = useCallback(
    (updates: { terminalFontFamily: string; terminalFontSize: number }) => {
      const nextFontFamily = normalizeFontFamily(updates.terminalFontFamily);
      const appearance = toTerminalAppearance({
        terminalFontFamily: nextFontFamily,
        terminalFontSize: updates.terminalFontSize,
      });
      updateSettings((settings) => ({
        ...settings,
        terminalFontFamily: nextFontFamily,
        terminalFontSize: updates.terminalFontSize,
      }));
      applyTerminalAppearanceToAll(appearance);
    },
    [applyTerminalAppearanceToAll, toTerminalAppearance, updateSettings]
  );

  const updateShortcutModifier = useCallback(
    (modifier: string) => {
      const normalized = normalizeShortcutModifier(modifier);
      updateSettings((settings) => ({
        ...settings,
        shortcutModifier: normalized,
      }));
    },
    [updateSettings]
  );

  const updateRepoDefaults = useCallback(
    (repoPath: string, envVars: EnvVar[], preCommands: string) => {
      const trimmedPath = repoPath.trim();
      if (!trimmedPath) {
        return;
      }
      const normalizedEnv = normalizeEnvVars(envVars);
      updateSettings((settings) => {
        const nextDefaults = { ...(settings.repoDefaults ?? {}) };
        const existing = nextDefaults[trimmedPath];
        const nextPreCommands =
          preCommands.trim().length > 0
            ? preCommands
            : existing?.preCommands ?? "";
        const hasPreCommands = nextPreCommands.trim().length > 0;
        if (normalizedEnv.length === 0 && !hasPreCommands) {
          delete nextDefaults[trimmedPath];
        } else {
          nextDefaults[trimmedPath] = {
            env: normalizedEnv,
            preCommands: nextPreCommands,
          };
        }
        return {
          ...settings,
          repoDefaults: nextDefaults,
        };
      });
    },
    [updateSettings]
  );

  const updateAgentSettings = useCallback(
    (agentArgs: Record<string, string>) => {
      updateSettings((settings) => ({
        ...settings,
        agentArgs,
      }));
    },
    [updateSettings]
  );

  useEffect(() => {
    applyTerminalAppearanceToAll(terminalAppearance);
  }, [applyTerminalAppearanceToAll, terminalAppearance]);

  useEffect(() => {
    let cancelled = false;
    loadTerminalFonts(terminalAppearance).then(() => {
      if (cancelled) {
        return;
      }
      applyTerminalAppearanceToAll(terminalAppearance);
    });
    return () => {
      cancelled = true;
    };
  }, [applyTerminalAppearanceToAll, loadTerminalFonts, terminalAppearance]);

  useEffect(() => {
    const fontSet = document.fonts;
    if (!fontSet || typeof fontSet.addEventListener !== "function") {
      return;
    }
    let cancelled = false;
    const scheduleRefresh = () => {
      if (cancelled || fontRefreshRafRef.current !== undefined) {
        return;
      }
      fontRefreshRafRef.current = window.requestAnimationFrame(() => {
        fontRefreshRafRef.current = undefined;
        if (cancelled) {
          return;
        }
        refreshTerminalRenderersAfterFontLoad();
      });
    };
    void fontSet.ready.then(() => {
      scheduleRefresh();
    });
    fontSet.addEventListener("loadingdone", scheduleRefresh);
    return () => {
      cancelled = true;
      fontSet.removeEventListener("loadingdone", scheduleRefresh);
      if (fontRefreshRafRef.current !== undefined) {
        window.cancelAnimationFrame(fontRefreshRafRef.current);
        fontRefreshRafRef.current = undefined;
      }
    };
  }, [refreshTerminalRenderersAfterFontLoad]);

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

  const globalHotkeys = useMemo<HotkeyBinding[]>(
    () => [
      defineHotkey({
        id: "session-cycle",
        combo: "Ctrl+Tab",
        preventDefault: true,
        handler: () => cycleSession(),
      }),
      defineHotkey({
        id: "focus-search",
        combo: buildShortcutCombo(config.settings.shortcutModifier, "KeyS"),
        preventDefault: true,
        handler: () => onFocusSearch?.(),
      }),
    ],
    [config.settings.shortcutModifier, cycleSession, onFocusSearch]
  );

  const copySelection = useCallback((term: Terminal) => {
    if (!term.hasSelection()) {
      return;
    }
    const text = term.getSelection();
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    term.clearSelection();
  }, []);

  const configureTerminalOptions = useCallback((term: Terminal) => {
    const termOptions = (term as Terminal & {
      options: {
        scrollOnOutput?: boolean;
        scrollOnUserInput?: boolean;
        minimumContrastRatio?: number;
        fontWeight?: string | number;
        fontWeightBold?: string | number;
      };
    }).options;
    // Keep default key encoding to avoid IME/Caps Lock input being translated into
    // unexpected control sequences (e.g. line-kill in shells).
    termOptions.scrollOnOutput = false;
    termOptions.scrollOnUserInput = false;
    termOptions.minimumContrastRatio = 1;
    termOptions.fontWeight = "normal";
    termOptions.fontWeightBold = "bold";
  }, []);

  const ensureNotificationPermission = useCallback(async () => {
    if (notificationPluginUnavailableRef.current) {
      return "denied";
    }

    let granted: boolean | null = null;
    try {
      granted = await invoke<boolean | null>("plugin:notification|is_permission_granted");
    } catch {
      notificationPluginUnavailableRef.current = true;
      return "denied";
    }

    if (granted === true) {
      return "granted";
    }
    if (granted === false) {
      return "denied";
    }

    if (!notificationPermissionRequestRef.current) {
      notificationPermissionRequestRef.current = invoke<string>("plugin:notification|request_permission")
        .catch(() => "denied")
        .finally(() => {
          notificationPermissionRequestRef.current = null;
        });
    }
    return notificationPermissionRequestRef.current;
  }, []);

  const publishTerminalNotification = useCallback(
    async (sessionId: string, title: string, message: string) => {
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        return;
      }

      const permission = await ensureNotificationPermission();
      if (permission !== "granted") {
        return;
      }

      const session = sessionsRef.current.find((item) => item.id === sessionId);
      const repo = session ? getRepoName(session.repo.repoPath) || session.repo.repoPath : "repo";
      const branch = session?.branch?.trim() || "unknown";
      const prefixedMessage = `[${repo} - ${branch}] ${trimmedMessage}`;

      try {
        await invoke("plugin:notification|notify", {
          options: {
            title: title || "Codelegate",
            body: prefixedMessage,
          },
        });
      } catch {
        // Ignore notification publish failures to keep terminal output flow stable.
      }
    },
    [ensureNotificationPermission]
  );

  const handleTerminalOscNotification = useCallback(
    (sessionId: string, kind: PaneKind, oscId: number, data: string) => {
      if (kind !== "agent" && kind !== "terminal") {
        return;
      }
      if (oscId === 9) {
        void publishTerminalNotification(sessionId, "Codelegate", data);
        return;
      }
      if (oscId === 777) {
        const parsed = parseOsc777Notification(data);
        if (!parsed) {
          return;
        }
        void publishTerminalNotification(sessionId, parsed.title, parsed.message);
      }
    },
    [publishTerminalNotification]
  );

  const handleTerminalOscClipboard = useCallback((data: string) => {
    const clipboardText = parseOsc52ClipboardData(data);
    if (clipboardText === null) {
      return;
    }
    navigator.clipboard.writeText(clipboardText).catch(() => {});
  }, []);

  const attachTerminalHandlers = useCallback(
    (term: Terminal, runtime: TerminalRuntime, sessionId: string, kind: PaneKind) => {
      const copyHotkey = defineHotkey({
        id: "terminal-copy-selection",
        combo: isMac ? "Meta+KeyC" : "Ctrl+Shift+KeyC",
        preventDefault: true,
        handler: () => copySelection(term),
      });
      const terminalHotkeys = [...globalHotkeys, copyHotkey];

      runtime.notificationDisposables?.forEach((disposable) => disposable.dispose());
      runtime.notificationDisposables = [];
      const parserApi = (term as Terminal & {
        parser?: {
          registerOscHandler?: (ident: number, callback: (data: string) => boolean) => { dispose: () => void };
        };
      }).parser;
      const osc9Disposable = parserApi?.registerOscHandler?.(9, (data) => {
        handleTerminalOscNotification(sessionId, kind, 9, data);
        return true;
      });
      const osc777Disposable = parserApi?.registerOscHandler?.(777, (data) => {
        handleTerminalOscNotification(sessionId, kind, 777, data);
        return true;
      });
      const osc52Disposable =
        kind === "terminal"
          ? parserApi?.registerOscHandler?.(52, (data) => {
              handleTerminalOscClipboard(data);
              return true;
            })
          : undefined;
      if (osc9Disposable) {
        runtime.notificationDisposables.push(osc9Disposable);
      }
      if (osc777Disposable) {
        runtime.notificationDisposables.push(osc777Disposable);
      }
      if (osc52Disposable) {
        runtime.notificationDisposables.push(osc52Disposable);
      }

      term.onData((data) => {
        // Some programs (e.g. zellij/tmux) enable terminal focus reporting.
        // Switching back to this view can emit ESC[I / ESC[O, which should not
        // force-follow and jump the viewport to bottom.
        const isFocusReport = data === "\x1b[I" || data === "\x1b[O";
        if (runtime.isFollowing === false && !isFocusReport) {
          setFollowingState(runtime, sessionId, kind, true);
          term.scrollToBottom();
        }
        if (kind === "agent") {
          suppressAgentOutputting(sessionId, 180);
        }
        if (runtime.ptyId) {
          invoke("write_pty", { sessionId: runtime.ptyId, data });
        }
      });

      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") {
          return true;
        }
        // Let xterm's internal composition logic handle IME/CapsLock flows.
        if (
          event.isComposing ||
          event.key === "Process" ||
          event.key === "Dead" ||
          event.code === "CapsLock" ||
          event.keyCode === 229 ||
          event.keyCode === 20 ||
          event.getModifierState("CapsLock")
        ) {
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
        /*
        if (
          !isMac &&
          event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          (event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            event.key === "ArrowUp" ||
            event.key === "ArrowDown")
        ) {
          event.preventDefault();
          event.stopPropagation();
          const sequenceMap: Record<string, string> = {
            ArrowLeft: "\x1b[1;5D",
            ArrowRight: "\x1b[1;5C",
            ArrowUp: "\x1b[1;5A",
            ArrowDown: "\x1b[1;5B",
          };
          const sequence = sequenceMap[event.key];
          if (sequence) {
            if (runtime.ptyId) {
              invoke("write_pty", { sessionId: runtime.ptyId, data: sequence });
            } else {
              term.write(sequence);
            }
            return false;
          }
        }
        */
        const handled = runHotkeys(event, terminalHotkeys);
        return !handled;
      });
    },
    [
      copySelection,
      globalHotkeys,
      handleTerminalOscClipboard,
      handleTerminalOscNotification,
      isMac,
      setFollowingState,
      suppressAgentOutputting,
    ]
  );

  const createTerminal = useCallback(
    (element: HTMLDivElement, runtime: TerminalRuntime, sessionId: string, kind: PaneKind) => {
      const term = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily: terminalAppearance.fontFamily,
        fontSize: terminalAppearance.fontSize,
        lineHeight: terminalAppearance.lineHeight,
        scrollback: TERMINAL_SCROLLBACK_LINES,
      });
      configureTerminalOptions(term);
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new ImageAddon());
      term.loadAddon(new SearchAddon());
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
      term.loadAddon(new WebLinksAddon());
      term.open(element);
      attachTerminalHandlers(term, runtime, sessionId, kind);
      runtime.term = term;
      runtime.fit = fit;
      applyTerminalAppearance(runtime, terminalAppearance);
      ensureWebglRenderer(runtime, terminalAppearance);
    },
    [
      applyTerminalAppearance,
      attachTerminalHandlers,
      configureTerminalOptions,
      ensureWebglRenderer,
      terminalAppearance,
    ]
  );

  const ensureSessionRuntime = useCallback((sessionId: string) => {
    const map = runtimeRef.current;
    let runtime = map.get(sessionId);
    if (!runtime) {
      runtime = { agent: {}, git: {}, terminal: {} };
      map.set(sessionId, runtime);
    }
    return runtime;
  }, []);

  const ensureTerminalRuntime = useCallback(
    (sessionId: string, kind: PaneKind) => {
      const runtime = ensureSessionRuntime(sessionId);
      return runtime[kind];
    },
    [ensureSessionRuntime]
  );

  const cleanupTerminalRuntimeAttachment = useCallback(
    (runtime: TerminalRuntime) => {
      clearPendingRendererAttach(runtime);
      if (runtime.activationRaf !== undefined) {
        window.cancelAnimationFrame(runtime.activationRaf);
        runtime.activationRaf = undefined;
      }
      runtime.container = null;
      runtime.lastFit = undefined;
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
    },
    [clearPendingRendererAttach]
  );

  const detachTerminalRuntime = useCallback(
    (runtime: TerminalRuntime, preserveViewport = false) => {
      if (preserveViewport && runtime.term) {
        runtime.savedViewportY = runtime.term.buffer.active.viewportY;
      }
      cleanupTerminalRuntimeAttachment(runtime);
    },
    [cleanupTerminalRuntimeAttachment]
  );

  const disposeTerminalRuntime = useCallback(
    (runtime: TerminalRuntime) => {
      detachTerminalRuntime(runtime);
      runtime.notificationDisposables?.forEach((disposable) => disposable.dispose());
      runtime.notificationDisposables = undefined;
      if (runtime.term) {
        runtime.term.dispose();
      } else {
        runtime.webgl?.dispose();
      }
      runtime.webgl = undefined;
      runtime.term = undefined;
      runtime.fit = undefined;
      runtime.ptyId = undefined;
      runtime.starting = false;
      runtime.isFollowing = undefined;
      runtime.savedViewportY = undefined;
      runtime.activationRaf = undefined;
    },
    [detachTerminalRuntime]
  );

  const disposeSessionRuntime = useCallback(
    (runtime: SessionRuntime) => {
      disposeTerminalRuntime(runtime.agent);
      disposeTerminalRuntime(runtime.git);
      disposeTerminalRuntime(runtime.terminal);
    },
    [disposeTerminalRuntime]
  );

  const setActivePaneKind = useCallback(
    (kind: PaneKind) => {
      activePaneKindRef.current = kind;
      const sessionId = activeSessionRef.current;
      if (!sessionId) {
        return;
      }
      const runtime = runtimeRef.current.get(sessionId)?.[kind];
      if (runtime?.term) {
        activateRuntime(runtime, { focus: true, clearSelection: true });
        scheduleTerminalFit(runtime);
        return;
      }
      if (!focusSession(sessionId, kind)) {
        pendingFocusRef.current = { sessionId, kind };
      }
    },
    [activateRuntime, focusSession, scheduleTerminalFit]
  );

  const jumpToBottom = useCallback(
    (sessionId: string, kind: PaneKind) => {
      const runtime = runtimeRef.current.get(sessionId)?.[kind];
      if (!runtime?.term) {
        return;
      }
      setFollowingState(runtime, sessionId, kind, true);
      runtime.term.scrollToBottom();
      scheduleTerminalFit(runtime);
    },
    [scheduleTerminalFit, setFollowingState]
  );

  const registerTerminal = useCallback(
    (sessionId: string, kind: PaneKind, element: HTMLDivElement | null) => {
      if (!element) {
        const runtime = runtimeRef.current.get(sessionId)?.[kind];
        if (!runtime) {
          return;
        }
        detachTerminalRuntime(runtime, true);
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
      const allowTerminalStart = kind !== "terminal" || activePaneKindRef.current === "terminal";

      if (!runtime.term) {
        if (!allowTerminalStart) {
          return;
        }
        createTerminal(element, runtime, sessionId, kind);
      }
      const term = runtime.term;
      if (term) {
        if (!runtime.scrollDisposable) {
          runtime.scrollDisposable = term.onScroll(() => {
            updateFollowState(runtime, sessionId, kind, runtime.viewportEl ?? undefined);
          });
        }
        const viewport = element.querySelector(".xterm-viewport") as HTMLDivElement | null;
        if (viewport && (runtime.viewportEl !== viewport || !runtime.viewportHandler)) {
          if (runtime.viewportEl && runtime.viewportHandler) {
            runtime.viewportEl.removeEventListener("scroll", runtime.viewportHandler);
          }
          const handler = () => {
            updateFollowState(runtime, sessionId, kind, viewport);
          };
          runtime.viewportEl = viewport;
          runtime.viewportHandler = handler;
          viewport.addEventListener("scroll", handler, { passive: true });
          handler();
        }
        if (runtime.savedViewportY !== undefined && runtime.isFollowing === false) {
          term.scrollToLine(runtime.savedViewportY);
        }
        runtime.savedViewportY = undefined;
        updateFollowState(runtime, sessionId, kind, runtime.viewportEl ?? undefined);

        const isActiveRuntime = activeSessionRef.current === sessionId && activePaneKindRef.current === kind;
        const pending = pendingFocusRef.current;
        if (
          (pending && pending.sessionId === sessionId && pending.kind === kind) ||
          isActiveRuntime
        ) {
          focusSession(sessionId, kind);
          pendingFocusRef.current = null;
        }
        if (isActiveRuntime) {
          activateRuntime(runtime, { focus: true, clearSelection: true });
        } else {
          activateRuntime(runtime, { focus: false, clearSelection: false });
        }
      }

      scheduleTerminalFit(runtime);

      if (kind === "terminal" && term && !runtime.ptyId && !runtime.starting && allowTerminalStart) {
        runtime.starting = true;
        const session = sessionsRef.current.find((item) => item.id === sessionId);
        const sessionCwd = resolveSessionCwd(session);
        if (!session || !sessionCwd) {
          runtime.starting = false;
          return;
        }
        invoke<string>("get_default_shell")
          .then((shell) => {
            const envMap = ensureTermEnv(envListToMap(session.repo.env));
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
            registerPty(runtime, sessionId, "terminal", ptyId);
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
      createTerminal,
      detachTerminalRuntime,
      ensureTerminalRuntime,
      focusSession,
      registerPty,
      scheduleTerminalFit,
      updateFollowState,
      notify,
      activateRuntime,
    ]
  );

  const updateSession = useCallback((sessionId: string, partial: Partial<Session>) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? { ...session, ...partial } : session)));
  }, []);

  const renameBranch = useCallback(
    async (sessionId: string, newName: string) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      const cwd = resolveSessionCwd(session);
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

  const refreshSessionBranch = useCallback(
    async (sessionId: string) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      const cwd = resolveSessionCwd(session);
      if (!cwd) {
        return;
      }
      try {
        const branch = await invoke<string>("get_git_branch", { path: cwd });
        const nextBranch = branch.trim();
        if (nextBranch.length > 0) {
          updateSession(sessionId, { branch: nextBranch });
        }
      } catch {
        // Ignore refresh failures to avoid noisy toasts during manual refresh.
      }
    },
    [updateSession]
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
    async (
      sessionId: string,
      options: {
        cleanupWorktree?: WorktreeCleanupOptions;
      } = {}
    ) => {
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

      const killTasks = Array.from(ptyIds).map((ptyId) =>
        invoke("kill_pty", { sessionId: ptyId }).catch((error) => {
          notify({ message: `Failed to terminate session: ${String(error)}`, tone: "error" });
        })
      );

      ptyIds.forEach((ptyId) => {
        ptyToSessionRef.current.delete(ptyId);
      });

      agentOutputtingSuppressUntilRef.current.delete(sessionId);
      if (pendingFocusRef.current?.sessionId === sessionId) {
        pendingFocusRef.current = null;
      }

      clearAgentOutputting(sessionId);
      if (runtime) {
        disposeSessionRuntime(runtime);
      }
      runtimeRef.current.delete(sessionId);
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));

      if (closingActive) {
        setActiveSessionId(nextActiveId);
      }

      if (options.cleanupWorktree) {
        const { repoPath, worktreePath, branch } = options.cleanupWorktree;
        const repoName = getRepoName(repoPath) || repoPath;
        const branchName = branch?.trim() || "unknown";
        notify({ message: `Deleting worktree [${repoName}] ${branchName}`, tone: "info" });
        void (async () => {
          if (killTasks.length > 0) {
            await Promise.allSettled(killTasks);
          }
          try {
            await invoke("remove_session_worktree", {
              repoPath,
              worktreePath,
              branch: branch?.trim() || undefined,
            });
            notify({ message: `Deleted worktree [${repoName}] ${branchName}`, tone: "success" });
          } catch (error) {
            notify({
              message: `Failed to delete worktree [${repoName}] ${branchName}: ${String(error)}`,
              tone: "error",
            });
          }
        })();
      } else if (killTasks.length > 0) {
        void Promise.allSettled(killTasks);
      }
    },
    [clearAgentOutputting, disposeSessionRuntime, notify, setActiveSessionId]
  );

  const spawnAgentForSession = useCallback(
    async ({
      sessionId,
      repo,
      repoRoot,
      sessionCwd,
      initialCommands = [],
      failureMessage,
    }: {
      sessionId: string;
      repo: RepoConfig;
      repoRoot: string;
      sessionCwd: string;
      initialCommands?: string[];
      failureMessage: string;
    }) => {
      let shell = "";
      try {
        shell = await invoke<string>("get_default_shell");
      } catch (error) {
        updateSession(sessionId, { status: "error", lastError: String(error) });
        notify({ message: String(error), tone: "error" });
        return false;
      }

      const envMap = ensureTermEnv(envListToMap(repo.env));
      const currentSettings = configRef.current.settings;
      await loadTerminalFonts(toTerminalAppearance(currentSettings));

      const initCommands: string[] = [...initialCommands, `cd ${escapeShellArg(sessionCwd)}`];
      const preCommands = repo.preCommands.trim();
      if (preCommands) {
        preCommands
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .forEach((line) => initCommands.push(line));
      }
      const agentCommand = agentCommandById[repo.agent] ?? repo.agent;
      const agentArgs = configRef.current.settings.agentArgs?.[repo.agent]?.trim() ?? "";
      initCommands.push(applyAgentArgs(agentCommand, agentArgs));

      const runtime = ensureTerminalRuntime(sessionId, "agent");
      if (runtime.starting) {
        return false;
      }

      runtime.starting = true;
      let ptyId: number;
      try {
        ptyId = await invoke<number>("spawn_pty", {
          shell,
          args: shellArgs(shell, initCommands.join(" && ")),
          cwd: repoRoot,
          env: envMap,
          cols: runtime.term?.cols ?? 80,
          rows: runtime.term?.rows ?? 24,
        });
      } catch (error) {
        updateSession(sessionId, { status: "error", lastError: String(error) });
        notify({ message: `${failureMessage}: ${String(error)}`, tone: "error" });
        return false;
      } finally {
        runtime.starting = false;
      }

      registerPty(runtime, sessionId, "agent", ptyId);
      updateSession(sessionId, {
        cwd: sessionCwd,
        status: "running",
        lastError: undefined,
        startedAt: Date.now(),
        ptyId,
      });
      return true;
    },
    [ensureTerminalRuntime, loadTerminalFonts, notify, registerPty, toTerminalAppearance, updateSession]
  );

  const restartAgentSession = useCallback(
    async (sessionId: string) => {
      await configReadyPromiseRef.current;

      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (!session) {
        return false;
      }

      const sessionCwd = resolveSessionCwd(session);
      if (!sessionCwd) {
        notify({ message: "Unable to resolve session path.", tone: "error" });
        return false;
      }

      const runtime = ensureTerminalRuntime(sessionId, "agent");
      const currentPtyId = runtime.ptyId;
      if (currentPtyId) {
        runtime.ptyId = undefined;
        ptyToSessionRef.current.delete(currentPtyId);
        try {
          await invoke("kill_pty", { sessionId: currentPtyId });
        } catch (error) {
          notify({ message: `Failed to terminate previous agent process: ${String(error)}`, tone: "error" });
        }
      }

      clearAgentOutputting(sessionId);
      agentOutputtingSuppressUntilRef.current.delete(sessionId);
      updateSession(sessionId, { status: "stopped", lastError: undefined, ptyId: undefined });

      return spawnAgentForSession({
        sessionId,
        repo: session.repo,
        repoRoot: session.repo.repoPath,
        sessionCwd,
        failureMessage: "Failed to restart agent",
      });
    },
    [clearAgentOutputting, ensureTerminalRuntime, notify, spawnAgentForSession, updateSession]
  );

  const startSession = useCallback(
    async (repo: RepoConfig, options: { activate?: boolean; cwd?: string | null } = {}) => {
      await configReadyPromiseRef.current;
      const shouldActivate = options.activate !== false;
      if (shouldActivate) {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) {
          activeElement.blur();
        }
      }
      const sessionId = createSessionId(repo.repoPath);
      const session: Session = {
        id: sessionId,
        repo,
        cwd: repo.repoPath,
        status: "stopped",
      };

      setSessions((prev) => [...prev, session]);
      if (shouldActivate) {
        setActiveSessionId(sessionId);
        pendingFocusRef.current = { sessionId, kind: activePaneKindRef.current };
      }

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
          return null;
        }

        const repoSlug = sanitizeRepoSlug(getRepoName(repoRoot));
        const worktreeRoot = `${homeDir}/.codelegate/worktrees/${repoSlug}`;
        const worktreeRootWithSlash = `${worktreeRoot}/`;
        const trimmed = options.cwd?.trim() ?? "";
        if (trimmed.length > 0 && trimmed.startsWith(worktreeRootWithSlash)) {
          try {
            const exists = await invoke<boolean>("path_exists", { path: trimmed });
            if (exists) {
              sessionCwd = trimmed;
            }
          } catch {
            // Ignore and fall back to creating a new worktree below.
          }
        }

        if (sessionCwd === repoRoot) {
          const stamp = formatWorktreeStamp(new Date());
          const worktreePath = `${worktreeRoot}/${stamp}-${repo.agent}`;
          const base = escapeShellArg(repoRoot);
          const target = escapeShellArg(worktreePath);

          initCommands.push(`mkdir -p ${escapeShellArg(worktreeRoot)}`);
          initCommands.push(`git -C ${base} worktree add ${target}`);
          sessionCwd = worktreePath;
        }
      } else if (options.cwd) {
        const trimmed = options.cwd.trim();
        if (trimmed.length > 0 && trimmed.startsWith(repoRoot)) {
          sessionCwd = trimmed;
        }
      }

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

      const started = await spawnAgentForSession({
        sessionId,
        repo,
        repoRoot,
        sessionCwd,
        initialCommands: initCommands,
        failureMessage: "Failed to start session",
      });
      if (!started) {
        return null;
      }

      return sessionId;
    },
    [setActiveSessionId, spawnAgentForSession, updateSession]
  );

  useEffect(() => {
    if (restoreInProgressRef.current) {
      return;
    }
    restoreInProgressRef.current = true;
    let cancelled = false;

    const restorePreviousSessions = async () => {
      await configReadyPromiseRef.current;
      if (cancelled || sessionsRef.current.length > 0) {
        return;
      }
      let payload: PreviousSessionsPayload | null = null;
      try {
        payload = await invoke<PreviousSessionsPayload | null>("load_previous_sessions");
      } catch (error) {
        notify({ message: `Failed to load previous sessions: ${String(error)}`, tone: "error" });
        return;
      }
      if (!payload || payload.sessions.length === 0 || cancelled) {
        return;
      }
      const restoredIds: string[] = [];
      for (const entry of payload.sessions) {
        const restoredId = await startSession(entry.repo, {
          activate: false,
          cwd: entry.cwd ?? null,
        });
        if (restoredId) {
          restoredIds.push(restoredId);
        }
      }
      if (cancelled || restoredIds.length === 0) {
        return;
      }
      const rawIndex = Number.isFinite(payload.activeIndex) ? payload.activeIndex : 0;
      const activeIndex = Math.min(Math.max(rawIndex, 0), restoredIds.length - 1);
      const activeId = restoredIds[activeIndex] ?? restoredIds[0];
      if (activeId) {
        setActiveSessionId(activeId);
      }
    };

    restorePreviousSessions();
    return () => {
      cancelled = true;
    };
  }, [notify, setActiveSessionId, startSession]);

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
      if (info.kind === "agent") {
        const suppressUntil = agentOutputtingSuppressUntilRef.current.get(info.sessionId);
        if (!suppressUntil || performance.now() >= suppressUntil) {
          markAgentOutputting(info.sessionId);
        }
      }
      const shouldFollow = runtime.isFollowing !== false;
      setFollowingState(runtime, info.sessionId, info.kind, shouldFollow);
      const data = decodeBase64ToUint8(event.payload.data_base64);
      runtime.term.write(data, () => {
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
      clearAgentOutputting(info.sessionId);

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
      suppressAgentOutputting(sessionId, 250);
      const runtime = runtimeRef.current.get(sessionId)?.[activePaneKindRef.current];
      if (!runtime) {
        return;
      }
      scheduleTerminalFit(runtime);
    };

    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("resize", handler);
    };
  }, [scheduleTerminalFit, suppressAgentOutputting]);

  useEffect(() => {
    const sessionId = activeSessionId;
    if (!sessionId) {
      return;
    }
    const kind = activePaneKindRef.current;
    const runtime = runtimeRef.current.get(sessionId)?.[kind];
    if (runtime?.term) {
      activateRuntime(runtime, { focus: true, clearSelection: true });
      scheduleTerminalFit(runtime);
      return;
    }
    if (!focusSession(sessionId, kind)) {
      pendingFocusRef.current = { sessionId, kind };
    }
  }, [activeSessionId, activateRuntime, focusSession, scheduleTerminalFit]);

  const handleCloseRequest = useCallback(async () => {
    if (closeInProgressRef.current || closePromptInProgressRef.current) {
      return;
    }
    const visibleSessions = sessionsRef.current.filter((session) => !session.isTabClosed);
    const hasRunning = visibleSessions.some((session) => session.status === "running");
    const sessionCount = visibleSessions.length;
    if (!onConfirmClose && !hasRunning) {
      closeInProgressRef.current = true;
      try {
        await invoke("exit_app");
      } catch (error) {
        closeInProgressRef.current = false;
        notify({ message: `Unable to close app: ${String(error)}`, tone: "error" });
      }
      return;
    }
    closePromptInProgressRef.current = true;
    let result: CloseConfirmResult;
    try {
      if (onConfirmClose) {
        result = await onConfirmClose({ hasRunning, sessionCount });
      } else {
        const confirmed = await confirm("You have active sessions. Close anyway?", {
          title: "Codelegate",
          kind: "warning",
        });
        result = { confirmed, remember: false };
      }
    } catch (error) {
      notify({ message: `Unable to confirm close: ${String(error)}`, tone: "error" });
      return;
    } finally {
      closePromptInProgressRef.current = false;
    }
    if (!result.confirmed) {
      return;
    }
    closeInProgressRef.current = true;
    if (onConfirmClose) {
      try {
        if (result.remember) {
          const activeId = activeSessionRef.current;
          const activeIndex = activeId
            ? visibleSessions.findIndex((session) => session.id === activeId)
            : -1;
          const payload: PreviousSessionsPayload = {
            sessions: visibleSessions.map((session) => ({
              repo: session.repo,
              cwd: session.cwd || undefined,
            })),
            activeIndex: activeIndex >= 0 ? activeIndex : 0,
          };
          await invoke("save_previous_sessions", { payload });
        } else {
          await invoke("clear_previous_sessions");
        }
      } catch (error) {
        notify({
          message: `Failed to save previous sessions: ${String(error)}`,
          tone: "error",
        });
      }
    }
    try {
      await invoke("exit_app");
    } catch (error) {
      closeInProgressRef.current = false;
      notify({ message: `Unable to close app: ${String(error)}`, tone: "error" });
    }
  }, [notify, onConfirmClose]);

  const shouldInterceptClose = hasSavedConfig === true;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!shouldInterceptClose) {
          return;
        }
        event.preventDefault();
        await handleCloseRequest();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [handleCloseRequest, shouldInterceptClose]);

  useEffect(() => {
    let unlistenExit: (() => void) | undefined;
    listen("app-exit-requested", () => {
      if (hasSavedConfig === null) {
        pendingExitRequestRef.current = true;
        return;
      }
      if (shouldInterceptClose) {
        void handleCloseRequest();
      } else {
        void invoke("exit_app");
      }
    }).then((fn) => {
      unlistenExit = fn;
    });
    return () => {
      unlistenExit?.();
    };
  }, [handleCloseRequest, hasSavedConfig, shouldInterceptClose]);

  useEffect(() => {
    if (!pendingExitRequestRef.current || hasSavedConfig === null) {
      return;
    }
    pendingExitRequestRef.current = false;
    if (shouldInterceptClose) {
      void handleCloseRequest();
    } else {
      void invoke("exit_app");
    }
  }, [handleCloseRequest, hasSavedConfig, shouldInterceptClose]);

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

  useEffect(
    () => () => {
      forEachTerminalRuntime(runtimeRef.current, (runtime) => {
        disposeTerminalRuntime(runtime);
      });
      runtimeRef.current.clear();
      ptyToSessionRef.current.clear();
      agentOutputtingTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      agentOutputtingTimersRef.current.clear();
      agentOutputtingSuppressUntilRef.current.clear();
    },
    [disposeTerminalRuntime]
  );

  return {
    config,
    hasSavedConfig,
    sessions,
    activeSessionId,
    filter,
    setFilter,
    setActiveSessionId,
    updateRecentDirs,
    updateTerminalSettings,
    updateShortcutModifier,
    updateRepoDefaults,
    updateAgentSettings,
    startSession,
    restartAgentSession,
    registerTerminal,
    setActivePaneKind,
    renameBranch,
    refreshSessionBranch,
    closeSessionTab,
    terminateSession,
    agentOutputting,
    focusActiveSession,
    unreadOutput,
    jumpToBottom,
    persistConfig,
  };
}

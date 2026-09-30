/**
 * `~/.codelegate/config.json` reading and writing.
 *
 * Reproduces the Tauri `load_config` / `has_saved_config` / `save_config`
 * commands: same file location, same pretty-printed JSON, same defaults. The
 * Rust version relied on serde `#[serde(default = "...")]` attributes to fill
 * in missing fields; `mergeConfig` does that explicitly here.
 *
 * This module never imports `electron` at runtime so the unit suite can load
 * it in a plain Node environment. Everything takes an optional `homeDir` for
 * the same reason.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { IPC } from "../../shared/channels";
import type { AppConfig, AppSettings, EnvVar, RepoSessionDefaults } from "../../shared/types";
import type { IpcHandle } from "./register";

export const DEFAULT_TERMINAL_FONT_FAMILY = '"JetBrains Mono", "SF Mono", "Fira Code", monospace';
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const DEFAULT_SHORTCUT_MODIFIER = "Alt";

/** `$HOME` first, exactly like the Rust `std::env::var_os("HOME")` lookup. */
export function resolveHomeDir(homeDir?: string): string {
  const resolved = homeDir ?? process.env.HOME ?? os.homedir();
  if (!resolved) {
    throw new Error("Unable to locate home directory");
  }
  return resolved;
}

export function codelegateDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".codelegate");
}

export function configFile(homeDir?: string): string {
  return path.join(codelegateDir(homeDir), "config.json");
}

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    settings: {
      theme: "dark",
      recentDirs: [],
      terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      shortcutModifier: DEFAULT_SHORTCUT_MODIFIER,
      repoDefaults: {},
      agentArgs: {},
      agentCommands: {},
      sidebarCollapsed: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/**
 * Serde's `Vec<EnvVar>` with `#[serde(default)]`: anything that is not an array
 * of `{key, value}` string pairs contributes nothing. Lives here rather than in
 * `sessions.ts` because both the config file and the session file carry env
 * lists; `config.ts` never imports `sessions.ts`, so there is no cycle.
 */
export function normalizeEnv(raw: unknown): EnvVar[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is EnvVar =>
      isRecord(entry) && typeof entry.key === "string" && typeof entry.value === "string",
  );
}

/**
 * One `repoDefaults` value. The Rust struct had no optional fields, so a
 * missing or mistyped `env` / `preCommands` fell back to its serde default; an
 * entry that is not an object at all was never a `RepoSessionDefaults`.
 */
export function normalizeRepoSessionDefaults(raw: unknown): RepoSessionDefaults | null {
  if (!isRecord(raw)) return null;
  return {
    env: normalizeEnv(raw.env),
    preCommands: typeof raw.preCommands === "string" ? raw.preCommands : "",
  };
}

/**
 * The whole `repoDefaults` map. A container of the wrong shape becomes `{}`,
 * and keys that cannot address a repository (the empty string) or whose value
 * is not an object are dropped rather than handed to the renderer, which
 * dereferences `env` directly.
 */
export function normalizeRepoDefaults(raw: unknown): Record<string, RepoSessionDefaults> {
  if (!isRecord(raw)) return {};
  const out: Record<string, RepoSessionDefaults> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (key.length === 0) continue;
    const defaults = normalizeRepoSessionDefaults(entry);
    if (defaults) out[key] = defaults;
  }
  return out;
}

/**
 * Smallest and largest terminal font size a config file may ask for. The Rust
 * field was a `u16`, so a negative or fractional value never survived
 * deserialization; the range keeps a hand-edited config from producing an
 * unusable terminal.
 */
export const MIN_TERMINAL_FONT_SIZE = 6;
export const MAX_TERMINAL_FONT_SIZE = 72;

/** A whole number in `[min, max]`, or the default. Serde's integer types, by hand. */
function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  if (value < min || value > max) return fallback;
  return value;
}

/** Stand-in for serde's per-field defaults: unknown or malformed fields fall back. */
export function mergeConfig(raw: unknown): AppConfig {
  const base = defaultConfig();
  if (!isRecord(raw)) return base;

  const settings = isRecord(raw.settings) ? raw.settings : {};
  const merged: AppSettings = {
    theme: settings.theme === "light" || settings.theme === "dark" ? settings.theme : base.settings.theme,
    recentDirs: Array.isArray(settings.recentDirs)
      ? settings.recentDirs.filter((entry): entry is string => typeof entry === "string")
      : base.settings.recentDirs,
    terminalFontFamily:
      typeof settings.terminalFontFamily === "string" && settings.terminalFontFamily.length > 0
        ? settings.terminalFontFamily
        : base.settings.terminalFontFamily,
    terminalFontSize: boundedInteger(
      settings.terminalFontSize,
      MIN_TERMINAL_FONT_SIZE,
      MAX_TERMINAL_FONT_SIZE,
      base.settings.terminalFontSize,
    ),
    shortcutModifier:
      typeof settings.shortcutModifier === "string" && settings.shortcutModifier.length > 0
        ? settings.shortcutModifier
        : base.settings.shortcutModifier,
    repoDefaults: normalizeRepoDefaults(settings.repoDefaults),
    agentArgs: stringRecord(settings.agentArgs),
    agentCommands: stringRecord(settings.agentCommands),
    sidebarCollapsed:
      typeof settings.sidebarCollapsed === "boolean" ? settings.sidebarCollapsed : base.settings.sidebarCollapsed,
  };

  return {
    // The Rust field was a `u32`: a float or a negative version number is as
    // malformed as a string one.
    version: boundedInteger(raw.version, 0, Number.MAX_SAFE_INTEGER, base.version),
    settings: merged,
  };
}

/**
 * Both files this module writes can hold environment secrets, so a file we
 * create ourselves is owner-only. An existing file keeps whatever mode it has.
 */
export const DEFAULT_JSON_FILE_MODE = 0o600;

export interface WriteJsonFileOptions {
  /** Mode for a file that does not exist yet. Defaults to `0o600`. */
  defaultMode?: number;
}

/**
 * Where the bytes actually belong. A symlinked `config.json` (a dotfile repo
 * pointing at a checked-in file, say) must stay a symlink: writing the temp
 * file beside the *link* and renaming over it would replace the link with a
 * regular file, so resolve first and rename onto the resolved path instead.
 */
async function resolveWriteTarget(file: string): Promise<string> {
  let isLink: boolean;
  try {
    isLink = (await fsp.lstat(file)).isSymbolicLink();
  } catch {
    return file;
  }
  if (!isLink) return file;
  try {
    return await fsp.realpath(file);
  } catch {
    // Dangling link: `realpath` fails on the missing tail, so resolve the link
    // text ourselves and create the target the link already points at.
    try {
      return path.resolve(path.dirname(file), await fsp.readlink(file));
    } catch {
      return file;
    }
  }
}

/** The target's own permission bits, or `fallback` when it does not exist yet. */
async function existingFileMode(file: string, fallback: number): Promise<number> {
  try {
    const stats = await fsp.stat(file);
    return stats.isFile() ? stats.mode & 0o777 : fallback;
  } catch {
    return fallback;
  }
}

/** fsync a directory so the rename itself survives a crash. Best effort: not all platforms allow it. */
async function syncDirectory(directory: string): Promise<void> {
  const handle = await fsp.open(directory, "r").catch(() => undefined);
  if (!handle) return;
  try {
    await handle.sync();
  } catch {
    // Windows and some network filesystems refuse to fsync a directory.
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Write JSON the way the Rust backend did (`to_string_pretty`, two-space
 * indent, no trailing newline) but through a temp file plus rename so a crash
 * mid-write cannot truncate the real file.
 *
 * The rename also has to leave the file as the user left it: a symlink stays a
 * symlink, an existing mode (a hand-applied `chmod 600`, say) is preserved
 * rather than reset to the umask default, and the data is fsynced before the
 * rename so the swap cannot expose an empty file.
 */
export async function writeJsonFileAtomic(
  file: string,
  value: unknown,
  options: WriteJsonFileOptions = {},
): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const target = await resolveWriteTarget(file);
  const directory = path.dirname(target);
  if (target !== file) await fsp.mkdir(directory, { recursive: true });

  const mode = await existingFileMode(target, options.defaultMode ?? DEFAULT_JSON_FILE_MODE);
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.write`;
  try {
    const handle = await fsp.open(temporary, "w", mode);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
      // `open` masks the requested mode through the umask; `chmod` does not.
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temporary, target);
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDirectory(directory);
}

export async function loadConfig(homeDir?: string): Promise<AppConfig> {
  const file = configFile(homeDir);
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig();
    throw new Error(`Failed to read config: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse config: ${(error as Error).message}`);
  }
  return mergeConfig(parsed);
}

export async function hasSavedConfig(homeDir?: string): Promise<boolean> {
  try {
    await fsp.access(configFile(homeDir));
    return true;
  } catch {
    return false;
  }
}

// Full snapshots must reach disk in request order, even if an earlier save fails.
const pendingConfigWrites = new Map<string, Promise<void>>();

export async function saveConfig(config: AppConfig, homeDir?: string): Promise<void> {
  const file = path.resolve(configFile(homeDir));
  const previous = pendingConfigWrites.get(file) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(() => writeJsonFileAtomic(file, config));
  pendingConfigWrites.set(file, write);
  try {
    await write;
  } catch (error) {
    throw new Error(`Failed to write config: ${(error as Error).message}`);
  } finally {
    if (pendingConfigWrites.get(file) === write) {
      pendingConfigWrites.delete(file);
    }
  }
}

/**
 * Synchronous twin of `has_saved_config() && load_config().is_ok()`
 * (`should_override_close_flow` in the Tauri backend). It has to be sync
 * because it is consulted from `close` and `before-quit` handlers, which must
 * decide whether to call `preventDefault()` before they return.
 */
export function configExistsAndParses(homeDir?: string): boolean {
  try {
    const raw = fs.readFileSync(configFile(homeDir), "utf8");
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

export function registerConfigIpc(handle: IpcHandle): void {
  handle(IPC.LOAD_CONFIG, () => loadConfig());
  handle(IPC.HAS_SAVED_CONFIG, () => hasSavedConfig());
  handle(IPC.SAVE_CONFIG, (_event, config: AppConfig) => saveConfig(config));
}

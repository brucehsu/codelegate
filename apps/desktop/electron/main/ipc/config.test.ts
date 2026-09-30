import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configExistsAndParses,
  configFile,
  defaultConfig,
  hasSavedConfig,
  loadConfig,
  mergeConfig,
  saveConfig,
  writeJsonFileAtomic,
} from "./config";

/** Modes and symlinks do not mean the same thing on Windows; the app ships mac and Linux. */
const posixOnly = it.skipIf(process.platform === "win32");

function modeOf(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "codelegate-config-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

function writeConfig(contents: string): void {
  const file = configFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
}

describe("config paths", () => {
  it("lives at ~/.codelegate/config.json", () => {
    expect(configFile(home)).toBe(path.join(home, ".codelegate", "config.json"));
  });
});

describe("loadConfig", () => {
  it("returns the defaults when no file exists", async () => {
    await expect(loadConfig(home)).resolves.toEqual(defaultConfig());
  });

  it("fills missing fields from the defaults", async () => {
    writeConfig(JSON.stringify({ version: 1, settings: { theme: "dark", recentDirs: ["/tmp/repo"] } }));
    const config = await loadConfig(home);
    expect(config.settings.recentDirs).toEqual(["/tmp/repo"]);
    expect(config.settings.terminalFontSize).toBe(defaultConfig().settings.terminalFontSize);
    expect(config.settings.terminalFontFamily).toBe(defaultConfig().settings.terminalFontFamily);
    expect(config.settings.shortcutModifier).toBe("Alt");
    expect(config.settings.sidebarCollapsed).toBe(false);
    expect(config.settings.repoDefaults).toEqual({});
  });

  it("keeps values that are present", async () => {
    writeConfig(
      JSON.stringify({
        version: 2,
        settings: {
          theme: "dark",
          recentDirs: [],
          terminalFontFamily: "Menlo",
          terminalFontSize: 15,
          shortcutModifier: "Ctrl",
          sidebarCollapsed: true,
          agentCommands: { claude: "claude --resume" },
        },
      }),
    );
    const config = await loadConfig(home);
    expect(config.version).toBe(2);
    expect(config.settings.terminalFontFamily).toBe("Menlo");
    expect(config.settings.terminalFontSize).toBe(15);
    expect(config.settings.shortcutModifier).toBe("Ctrl");
    expect(config.settings.sidebarCollapsed).toBe(true);
    expect(config.settings.agentCommands).toEqual({ claude: "claude --resume" });
  });

  it("rejects unparseable JSON", async () => {
    writeConfig("{ not json");
    await expect(loadConfig(home)).rejects.toThrow(/Failed to parse config/u);
  });

  it("drops values of the wrong type", () => {
    const merged = mergeConfig({ version: "nope", settings: { terminalFontSize: "13", agentArgs: { a: 1 } } });
    expect(merged.version).toBe(1);
    expect(merged.settings.terminalFontSize).toBe(13);
    expect(merged.settings.agentArgs).toEqual({});
  });

  it("normalizes junk repoDefaults entries", () => {
    const merged = mergeConfig({
      settings: {
        repoDefaults: {
          "/tmp/one": { env: "nope", preCommands: 12 },
          "/tmp/two": { env: [{ key: "A", value: "1" }, { key: "B" }, "nope", null] },
          "/tmp/three": "not an object",
          "/tmp/four": ["also", "not"],
          "": { env: [], preCommands: "" },
        },
      },
    });
    expect(merged.settings.repoDefaults).toEqual({
      "/tmp/one": { env: [], preCommands: "" },
      "/tmp/two": { env: [{ key: "A", value: "1" }], preCommands: "" },
    });
  });

  it("drops a repoDefaults container that is not an object", () => {
    for (const repoDefaults of [["/tmp/repo"], "nope", 3, null]) {
      expect(mergeConfig({ settings: { repoDefaults } }).settings.repoDefaults).toEqual({});
    }
  });

  it("round trips a valid repoDefaults entry", () => {
    const repoDefaults = {
      "/tmp/repo": { env: [{ key: "FOO", value: "bar" }], preCommands: "nvm use" },
    };
    expect(mergeConfig({ settings: { repoDefaults } }).settings.repoDefaults).toEqual(repoDefaults);
  });

  it("rejects a terminal font size the old u16 field could never have held", () => {
    // Negative, fractional, out of range and not a number at all.
    for (const terminalFontSize of [-4, 12.5, 0, 400, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(mergeConfig({ settings: { terminalFontSize } }).settings.terminalFontSize).toBe(13);
    }
  });

  it("keeps a sane terminal font size", () => {
    for (const terminalFontSize of [6, 13, 20, 72]) {
      expect(mergeConfig({ settings: { terminalFontSize } }).settings.terminalFontSize).toBe(terminalFontSize);
    }
  });
});

describe("saveConfig", () => {
  it("queues snapshots in request order while allowing other config files to save", async () => {
    const terminalConfig = defaultConfig();
    terminalConfig.settings.terminalFontSize = 17;
    const agentConfig = structuredClone(terminalConfig);
    agentConfig.settings.agentArgs = { claude: "--verbose" };
    agentConfig.settings.agentCommands = { claude: "custom-claude" };

    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const mkdir = fsp.mkdir.bind(fsp);
    const mkdirSpy = vi.spyOn(fsp, "mkdir").mockImplementationOnce(async (directory, options) => {
      markStarted();
      await blocked;
      return mkdir(directory, options);
    });

    const first = saveConfig(terminalConfig, home);
    await started;
    const second = saveConfig(agentConfig, home);
    try {
      // The later snapshot must not start its write while the first is blocked.
      expect(mkdirSpy).toHaveBeenCalledTimes(1);
      const otherHome = path.join(home, "other-home");
      await saveConfig(defaultConfig(), otherHome);
      await expect(loadConfig(otherHome)).resolves.toEqual(defaultConfig());
    } finally {
      releaseFirst();
      await Promise.allSettled([first, second]);
    }

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    await expect(loadConfig(home)).resolves.toEqual(agentConfig);
  });

  it("reports a failed save and still writes the next queued snapshot", async () => {
    vi.spyOn(fsp, "mkdir").mockRejectedValueOnce(new Error("write denied"));
    const config = defaultConfig();
    config.settings.agentArgs = { claude: "--verbose" };

    const results = await Promise.allSettled([
      saveConfig(defaultConfig(), home),
      saveConfig(config, home),
    ]);

    expect(results[0]).toEqual({
      status: "rejected",
      reason: new Error("Failed to write config: write denied"),
    });
    expect(results[1]).toEqual({ status: "fulfilled", value: undefined });
    await expect(loadConfig(home)).resolves.toEqual(config);
  });

  it("writes pretty JSON and leaves no temp file behind", async () => {
    const config = defaultConfig();
    config.settings.recentDirs = ["/tmp/one"];
    await saveConfig(config, home);

    const raw = fs.readFileSync(configFile(home), "utf8");
    expect(raw).toBe(JSON.stringify(config, null, 2));
    expect(JSON.parse(raw)).toEqual(config);
    expect(fs.readdirSync(path.join(home, ".codelegate"))).toEqual(["config.json"]);
  });

  it("round trips through loadConfig", async () => {
    const config = defaultConfig();
    config.settings.terminalFontSize = 17;
    await saveConfig(config, home);
    await expect(loadConfig(home)).resolves.toEqual(config);
  });
});

describe("writeJsonFileAtomic", () => {
  it("fails for a directory target and removes the temporary file", async () => {
    const file = path.join(home, "directory.json");
    fs.mkdirSync(file, { mode: 0o755 });

    await expect(writeJsonFileAtomic(file, { secret: "value" })).rejects.toMatchObject({
      code: expect.stringMatching(/^(EISDIR|ENOTDIR|EEXIST|EPERM|EACCES)$/u),
    });

    expect(fs.statSync(file).isDirectory()).toBe(true);
    expect(fs.readdirSync(home).filter((entry) => entry.endsWith(".write"))).toEqual([]);
  });

  posixOnly("preserves the mode of an existing file", async () => {
    for (const mode of [0o600, 0o644]) {
      const file = path.join(home, `modes-${mode.toString(8)}.json`);
      fs.writeFileSync(file, "{}", "utf8");
      fs.chmodSync(file, mode);

      await writeJsonFileAtomic(file, { kept: mode });

      expect(modeOf(file)).toBe(mode);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ kept: mode });
    }
  });

  posixOnly("creates a new file owner-only", async () => {
    const file = path.join(home, "fresh", "new.json");
    await writeJsonFileAtomic(file, { fresh: true });
    expect(modeOf(file)).toBe(0o600);
  });

  posixOnly("honours an explicit default mode for a new file", async () => {
    const file = path.join(home, "explicit.json");
    await writeJsonFileAtomic(file, { fresh: true }, { defaultMode: 0o640 });
    expect(modeOf(file)).toBe(0o640);
  });

  posixOnly("writes through a symlinked config without replacing the link", async () => {
    const store = path.join(home, "dotfiles");
    fs.mkdirSync(store, { recursive: true });
    const real = path.join(store, "codelegate.json");
    fs.writeFileSync(real, "{}", "utf8");
    fs.chmodSync(real, 0o600);

    const link = configFile(home);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link);

    const config = defaultConfig();
    config.settings.terminalFontSize = 19;
    await saveConfig(config, home);

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(real, "utf8"))).toEqual(config);
    expect(modeOf(real)).toBe(0o600);
    // No temp file left behind on either side of the link.
    expect(fs.readdirSync(path.join(home, ".codelegate"))).toEqual(["config.json"]);
    expect(fs.readdirSync(store)).toEqual(["codelegate.json"]);
    await expect(loadConfig(home)).resolves.toEqual(config);
  });

  posixOnly("creates the target of a dangling symlink", async () => {
    const store = path.join(home, "dotfiles");
    fs.mkdirSync(store, { recursive: true });
    const real = path.join(store, "codelegate.json");

    const link = path.join(home, "dangling.json");
    fs.symlinkSync(real, link);

    await writeJsonFileAtomic(link, { created: true });

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(real, "utf8"))).toEqual({ created: true });
    expect(modeOf(real)).toBe(0o600);
    expect(fs.readdirSync(store)).toEqual(["codelegate.json"]);
  });
});

describe("hasSavedConfig / configExistsAndParses", () => {
  it("is false before anything is written", async () => {
    await expect(hasSavedConfig(home)).resolves.toBe(false);
    expect(configExistsAndParses(home)).toBe(false);
  });

  it("is true once a parseable config exists", async () => {
    await saveConfig(defaultConfig(), home);
    await expect(hasSavedConfig(home)).resolves.toBe(true);
    expect(configExistsAndParses(home)).toBe(true);
  });

  it("does not intercept the close flow when the config is corrupt", async () => {
    writeConfig("{{{");
    await expect(hasSavedConfig(home)).resolves.toBe(true);
    expect(configExistsAndParses(home)).toBe(false);
  });
});

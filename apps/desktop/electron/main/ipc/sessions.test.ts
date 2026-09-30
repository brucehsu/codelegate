import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PreviousSessionsPayload } from "../../shared/types";
import {
  clearPreviousSessions,
  loadPreviousSessions,
  normalizePreviousSessions,
  previousSessionsFile,
  previousSessionsSnapshotFile,
  savePreviousSessions,
  savePreviousSessionsSnapshot,
} from "./sessions";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "codelegate-sessions-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const payload: PreviousSessionsPayload = {
  sessions: [
    {
      repo: { repoPath: "/tmp/repo", agent: "claude", env: [{ key: "FOO", value: "bar" }], preCommands: "" },
      cwd: "/tmp/repo",
    },
  ],
  activeIndex: 0,
};

describe("session file locations", () => {
  it("uses the historic file names", () => {
    expect(previousSessionsFile(home)).toBe(path.join(home, ".codelegate", "previous_sessions.json"));
    expect(previousSessionsSnapshotFile(home)).toBe(
      path.join(home, ".codelegate", "previous_sessions.json.tmp"),
    );
  });
});

describe("loadPreviousSessions", () => {
  it("returns null when nothing was saved", async () => {
    await expect(loadPreviousSessions(home)).resolves.toBeNull();
  });

  it("round trips a saved payload", async () => {
    await savePreviousSessions(payload, home);
    await expect(loadPreviousSessions(home)).resolves.toEqual(payload);
  });

  it("defaults missing fields", async () => {
    const file = previousSessionsFile(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{}", "utf8");
    await expect(loadPreviousSessions(home)).resolves.toEqual({ sessions: [], activeIndex: 0 });
  });

  it("rejects unparseable JSON", async () => {
    const file = previousSessionsFile(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "nope", "utf8");
    await expect(loadPreviousSessions(home)).rejects.toThrow(/Failed to parse previous sessions/u);
  });

  it("restores nothing when the file is not a session payload", async () => {
    const file = previousSessionsFile(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ sessions: "all of them" }), "utf8");
    await expect(loadPreviousSessions(home)).resolves.toBeNull();
  });
});

describe("normalizePreviousSessions", () => {
  const repo = { repoPath: "/tmp/repo", agent: "claude" };

  it("applies the field defaults the Rust types had", () => {
    expect(normalizePreviousSessions({ sessions: [{ repo }] })).toEqual({
      sessions: [{ repo: { repoPath: "/tmp/repo", agent: "claude", env: [], preCommands: "" } }],
      activeIndex: 0,
    });
  });

  it("keeps only well formed env vars, worktrees and cwds", () => {
    const normalized = normalizePreviousSessions({
      sessions: [
        {
          repo: {
            ...repo,
            agent: "codex",
            env: [{ key: "FOO", value: "bar" }, { key: "BAD" }, "nope", null],
            preCommands: 42,
            worktree: { enabled: true, branch: "feat/x" },
          },
          cwd: 7,
        },
        { repo: { ...repo, worktree: { branch: "feat/y" } } },
      ],
      activeIndex: 1,
    });

    expect(normalized).toEqual({
      sessions: [
        {
          repo: {
            repoPath: "/tmp/repo",
            agent: "codex",
            env: [{ key: "FOO", value: "bar" }],
            preCommands: "",
            worktree: { enabled: true, branch: "feat/x" },
          },
        },
        { repo: { repoPath: "/tmp/repo", agent: "claude", env: [], preCommands: "" } },
      ],
      activeIndex: 1,
    });
  });

  it("drops entries that are not sessions", () => {
    const normalized = normalizePreviousSessions({
      sessions: [
        null,
        "nope",
        {},
        { repo: null },
        { repo: { agent: "claude" } },
        { repo: { repoPath: "/tmp/repo", agent: "gemini" } },
        { repo },
      ],
      activeIndex: 0,
    });
    expect(normalized?.sessions).toHaveLength(1);
    expect(normalized?.sessions[0].repo.repoPath).toBe("/tmp/repo");
  });

  it("clamps activeIndex to what survived", () => {
    expect(normalizePreviousSessions({ sessions: [{ repo }], activeIndex: 9 })?.activeIndex).toBe(0);
    expect(normalizePreviousSessions({ sessions: [{ repo }, { repo }], activeIndex: 9 })?.activeIndex).toBe(1);
    expect(normalizePreviousSessions({ sessions: [], activeIndex: 3 })?.activeIndex).toBe(0);
    for (const activeIndex of [-1, 1.5, "1", Number.NaN, null]) {
      expect(normalizePreviousSessions({ sessions: [{ repo }, { repo }], activeIndex })?.activeIndex).toBe(0);
    }
  });

  it("rejects a malformed top level", () => {
    for (const raw of [null, 3, "nope", [], { sessions: {} }]) {
      expect(normalizePreviousSessions(raw)).toBeNull();
    }
  });
});

describe("savePreviousSessionsSnapshot", () => {
  it("writes to the .json.tmp twin and not the live file", async () => {
    await savePreviousSessionsSnapshot(payload, home);
    expect(fs.existsSync(previousSessionsSnapshotFile(home))).toBe(true);
    expect(fs.existsSync(previousSessionsFile(home))).toBe(false);
    expect(JSON.parse(fs.readFileSync(previousSessionsSnapshotFile(home), "utf8"))).toEqual(payload);
  });

  it("leaves no atomic-write scratch files behind", async () => {
    await savePreviousSessions(payload, home);
    await savePreviousSessionsSnapshot(payload, home);
    expect(fs.readdirSync(path.join(home, ".codelegate")).sort()).toEqual([
      "previous_sessions.json",
      "previous_sessions.json.tmp",
    ]);
  });
});

describe("clearPreviousSessions", () => {
  it("removes the live file", async () => {
    await savePreviousSessions(payload, home);
    await clearPreviousSessions(home);
    expect(fs.existsSync(previousSessionsFile(home))).toBe(false);
  });

  it("is a no-op when there is nothing to clear", async () => {
    await expect(clearPreviousSessions(home)).resolves.toBeUndefined();
  });
});

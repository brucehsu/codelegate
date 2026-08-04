import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_TERMINAL_SCROLLBACK_LINES,
  applyTerminalScrollbackLimit,
  getTerminalScrollbackLines,
  INACTIVE_TERMINAL_SCROLLBACK_LINES,
  snapshotTerminalViewport,
  type TerminalRetentionIdentity,
} from "./terminalRetention";

const agent = (sessionId: string, agentId?: string): TerminalRetentionIdentity => ({
  sessionId,
  kind: "agent",
  ...(agentId === undefined ? {} : { agentId }),
});

const terminal = (sessionId: string): TerminalRetentionIdentity => ({
  sessionId,
  kind: "terminal",
});

async function createPopulatedTerminal() {
  const term = new Terminal({ cols: 10, rows: 3, scrollback: 10 });
  await new Promise<void>((resolve) => {
    term.write("0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6", resolve);
  });
  return term;
}

describe("getTerminalScrollbackLines", () => {
  it("exports the active and inactive scrollback limits", () => {
    expect(ACTIVE_TERMINAL_SCROLLBACK_LINES).toBe(10_000);
    expect(INACTIVE_TERMINAL_SCROLLBACK_LINES).toBe(1_000);
  });

  it("gives the exact visible agent terminal the active limit", () => {
    const visible = agent("session-a", "codex");

    expect(getTerminalScrollbackLines(agent("session-a", "codex"), visible)).toBe(
      ACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
  });

  it("keeps agents inactive when their session, pane, or agent differs", () => {
    const visible = agent("session-a", "codex");

    expect(getTerminalScrollbackLines(agent("session-b", "codex"), visible)).toBe(
      INACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
    expect(getTerminalScrollbackLines(terminal("session-a"), visible)).toBe(
      INACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
    expect(getTerminalScrollbackLines(agent("session-a", "claude"), visible)).toBe(
      INACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
  });

  it("matches shell terminals by their session and kind", () => {
    const visible = terminal("session-a");

    expect(getTerminalScrollbackLines(terminal("session-a"), visible)).toBe(
      ACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
    expect(getTerminalScrollbackLines(terminal("session-b"), visible)).toBe(
      INACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
    expect(getTerminalScrollbackLines(agent("session-a", "codex"), visible)).toBe(
      INACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
  });

  it("keeps every terminal inactive when no terminal is visible", () => {
    expect(getTerminalScrollbackLines(agent("session-a", "codex"), null)).toBe(
      INACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
    expect(getTerminalScrollbackLines(terminal("session-a"), null)).toBe(
      INACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
  });

  it("does not accidentally match agent terminals with missing or different ids", () => {
    expect(getTerminalScrollbackLines(agent("session-a"), agent("session-a", "codex"))).toBe(
      INACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
    expect(getTerminalScrollbackLines(agent("session-a", "codex"), agent("session-a"))).toBe(
      INACTIVE_TERMINAL_SCROLLBACK_LINES,
    );
  });
});

describe("applyTerminalScrollbackLimit", () => {
  it("synchronously trims history and saves the clamped viewport for a scrolled terminal", async () => {
    const term = await createPopulatedTerminal();
    try {
      term.scrollToLine(2);
      expect(term.buffer.active.baseY).toBe(4);
      expect(term.buffer.active.viewportY).toBe(2);
      expect(term.buffer.active.length).toBe(7);
      const state = { isFollowing: false, savedViewportY: 2 };

      expect(applyTerminalScrollbackLimit(term, state, 2)).toBe(true);
      expect(term.options.scrollback).toBe(2);
      expect(term.buffer.active.baseY).toBe(2);
      expect(term.buffer.active.viewportY).toBe(0);
      expect(term.buffer.active.length).toBe(5);
      expect(state.savedViewportY).toBe(0);
    } finally {
      term.dispose();
    }
  });

  it("does not assign a saved viewport while the terminal is following output", async () => {
    const term = await createPopulatedTerminal();
    try {
      const state: { isFollowing: boolean; savedViewportY?: number } = { isFollowing: true };

      expect(applyTerminalScrollbackLimit(term, state, 2)).toBe(true);
      expect(state.savedViewportY).toBeUndefined();
    } finally {
      term.dispose();
    }
  });

  it("returns false for an unchanged limit without altering saved state", async () => {
    const term = await createPopulatedTerminal();
    try {
      const state = { isFollowing: false, savedViewportY: 3 };
      const before = {
        baseY: term.buffer.active.baseY,
        length: term.buffer.active.length,
        viewportY: term.buffer.active.viewportY,
      };

      expect(applyTerminalScrollbackLimit(term, state, 10)).toBe(false);
      expect(state.savedViewportY).toBe(3);
      expect(term.buffer.active.baseY).toBe(before.baseY);
      expect(term.buffer.active.length).toBe(before.length);
      expect(term.buffer.active.viewportY).toBe(before.viewportY);
    } finally {
      term.dispose();
    }
  });

  it("increases the allowance without pretending trimmed history was restored", async () => {
    const term = await createPopulatedTerminal();
    try {
      const state = { isFollowing: false, savedViewportY: 2 };
      expect(applyTerminalScrollbackLimit(term, state, 2)).toBe(true);
      const trimmed = {
        baseY: term.buffer.active.baseY,
        length: term.buffer.active.length,
        viewportY: term.buffer.active.viewportY,
      };

      expect(applyTerminalScrollbackLimit(term, state, 10)).toBe(true);
      expect(term.options.scrollback).toBe(10);
      expect(term.buffer.active.baseY).toBe(trimmed.baseY);
      expect(term.buffer.active.length).toBe(trimmed.length);
      expect(term.buffer.active.viewportY).toBe(trimmed.viewportY);
      expect(state.savedViewportY).toBe(trimmed.viewportY);
    } finally {
      term.dispose();
    }
  });
});

describe("snapshotTerminalViewport", () => {
  it("tracks viewport shifts when background output evicts old rows", async () => {
    const term = new Terminal({ cols: 10, rows: 3, scrollback: 5 });
    const state = { isFollowing: false, savedViewportY: undefined as number | undefined };
    const scrollDisposable = term.onScroll(() => snapshotTerminalViewport(term, state));
    try {
      await new Promise<void>((resolve) => {
        term.write("0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6", resolve);
      });
      term.scrollToLine(2);
      expect(state.savedViewportY).toBe(2);

      await new Promise<void>((resolve) => {
        term.write("\r\n7\r\n8\r\n9\r\n10\r\n11\r\n12", resolve);
      });

      expect(term.buffer.active.viewportY).toBe(0);
      expect(state.savedViewportY).toBe(term.buffer.active.viewportY);
    } finally {
      scrollDisposable.dispose();
      term.dispose();
    }
  });

  it("clears a saved viewport when the terminal follows output", async () => {
    const term = await createPopulatedTerminal();
    try {
      const state = { isFollowing: true, savedViewportY: 2 };

      snapshotTerminalViewport(term, state);

      expect(state.savedViewportY).toBeUndefined();
    } finally {
      term.dispose();
    }
  });
});

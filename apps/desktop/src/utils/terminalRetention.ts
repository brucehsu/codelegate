export const ACTIVE_TERMINAL_SCROLLBACK_LINES = 10_000;
export const INACTIVE_TERMINAL_SCROLLBACK_LINES = 1_000;

export interface TerminalRetentionIdentity {
  sessionId: string;
  kind: "agent" | "terminal";
  agentId?: string;
}

export interface TerminalScrollbackSurface {
  options: {
    scrollback?: number;
  };
  buffer: {
    active: {
      viewportY: number;
    };
  };
}

export interface TerminalScrollbackState {
  isFollowing?: boolean;
  savedViewportY?: number;
}

export interface TerminalViewportSurface {
  buffer: {
    active: {
      viewportY: number;
    };
  };
}

function isSameTerminal(identity: TerminalRetentionIdentity, visibleIdentity: TerminalRetentionIdentity) {
  return (
    identity.sessionId === visibleIdentity.sessionId &&
    identity.kind === visibleIdentity.kind &&
    identity.agentId === visibleIdentity.agentId
  );
}

export function getTerminalScrollbackLines(
  identity: TerminalRetentionIdentity,
  visibleIdentity: TerminalRetentionIdentity | null
) {
  return visibleIdentity && isSameTerminal(identity, visibleIdentity)
    ? ACTIVE_TERMINAL_SCROLLBACK_LINES
    : INACTIVE_TERMINAL_SCROLLBACK_LINES;
}

export function applyTerminalScrollbackLimit(
  surface: TerminalScrollbackSurface,
  state: TerminalScrollbackState,
  targetLines: number
) {
  const currentLines = surface.options.scrollback ?? INACTIVE_TERMINAL_SCROLLBACK_LINES;
  if (currentLines === targetLines) {
    return false;
  }

  const wasFollowing = state.isFollowing;
  surface.options.scrollback = targetLines;
  if (targetLines < currentLines && wasFollowing === false) {
    state.savedViewportY = surface.buffer.active.viewportY;
  }
  return true;
}

export function snapshotTerminalViewport(
  surface: TerminalViewportSurface,
  state: TerminalScrollbackState
) {
  if (state.isFollowing === false) {
    state.savedViewportY = surface.buffer.active.viewportY;
    return;
  }
  state.savedViewportY = undefined;
}

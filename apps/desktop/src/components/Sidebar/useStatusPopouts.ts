import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionStatus } from "../../types";

const POPOUT_DURATION_MS = 4000;

export interface StatusPopoutSession {
  id: string;
  status: SessionStatus;
}

export interface UseStatusPopoutsArgs {
  sessions: readonly StatusPopoutSession[];
  agentOutputting: Record<string, boolean>;
  unreadSessions: Record<string, boolean>;
  enabled: boolean;
}

export interface UseStatusPopoutsResult {
  popouts: Set<string>;
  dismiss: (sessionId: string) => void;
}

export function useStatusPopouts({
  sessions,
  agentOutputting,
  unreadSessions,
  enabled,
}: UseStatusPopoutsArgs): UseStatusPopoutsResult {
  const [popouts, setPopouts] = useState<Set<string>>(new Set());

  const prevUnreadLightRef = useRef<Map<string, boolean>>(new Map());
  const timersRef = useRef<Map<string, number>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const removePopout = useCallback(
    (id: string) => {
      clearTimer(id);
      setPopouts((prev) => {
        if (!prev.has(id)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [clearTimer]
  );

  const addPopout = useCallback(
    (id: string) => {
      clearTimer(id);
      setPopouts((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      const timer = window.setTimeout(() => {
        removePopout(id);
      }, POPOUT_DURATION_MS);
      timersRef.current.set(id, timer);
    },
    [clearTimer, removePopout]
  );

  const dismiss = useCallback(
    (sessionId: string) => {
      removePopout(sessionId);
    },
    [removePopout]
  );

  useEffect(() => {
    const prevUnreadLight = prevUnreadLightRef.current;
    const currentIds = new Set<string>();

    for (const session of sessions) {
      const { id } = session;
      currentIds.add(id);

      const isOutputting = agentOutputting[id] ?? false;
      const showsUnreadLight =
        session.status === "running" && !isOutputting && Boolean(unreadSessions[id]);
      const isNewSession = !prevUnreadLight.has(id);
      const wasShowingUnreadLight = prevUnreadLight.get(id) ?? false;

      if (!isNewSession) {
        if (enabled && showsUnreadLight && !wasShowingUnreadLight) {
          addPopout(id);
        } else if (!showsUnreadLight && wasShowingUnreadLight) {
          removePopout(id);
        }
      }

      prevUnreadLight.set(id, showsUnreadLight);
    }

    for (const id of Array.from(prevUnreadLight.keys())) {
      if (!currentIds.has(id)) {
        prevUnreadLight.delete(id);
        removePopout(id);
      }
    }
  }, [sessions, agentOutputting, unreadSessions, enabled, addPopout, removePopout]);

  useEffect(() => {
    if (!enabled) {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
      setPopouts((prev) => (prev.size === 0 ? prev : new Set()));
    }
  }, [enabled]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { popouts, dismiss };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionStatus } from "../../types";

const POPOUT_DURATION_MS = 4000;

export interface StatusPopoutSession {
  id: string;
  status: SessionStatus;
}

export interface StatusPopoutEntry {
  persistent: boolean;
}

export interface UseStatusPopoutsArgs {
  sessions: readonly StatusPopoutSession[];
  agentOutputting: Record<string, boolean>;
  enabled: boolean;
}

export interface UseStatusPopoutsResult {
  popouts: Map<string, StatusPopoutEntry>;
  dismiss: (sessionId: string) => void;
}

export function useStatusPopouts({ sessions, agentOutputting, enabled }: UseStatusPopoutsArgs): UseStatusPopoutsResult {
  const [popouts, setPopouts] = useState<Map<string, StatusPopoutEntry>>(new Map());

  const prevStatusRef = useRef<Map<string, SessionStatus>>(new Map());
  const prevOutputtingRef = useRef<Map<string, boolean>>(new Map());
  const timersRef = useRef<Map<string, number>>(new Map());
  const acknowledgedErrorsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const prevEnabledRef = useRef(enabled);

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
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
    [clearTimer]
  );

  const removePersistentPopout = useCallback((id: string) => {
    setPopouts((prev) => {
      const entry = prev.get(id);
      if (!entry || !entry.persistent) {
        return prev;
      }
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const addPopout = useCallback(
    (id: string, persistent: boolean) => {
      clearTimer(id);
      setPopouts((prev) => {
        const next = new Map(prev);
        next.set(id, { persistent });
        return next;
      });
      if (!persistent) {
        const timer = window.setTimeout(() => {
          removePopout(id);
        }, POPOUT_DURATION_MS);
        timersRef.current.set(id, timer);
      }
    },
    [clearTimer, removePopout]
  );

  const clearAll = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    setPopouts((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);

  const dismiss = useCallback(
    (sessionId: string) => {
      if (prevStatusRef.current.get(sessionId) === "error") {
        acknowledgedErrorsRef.current.add(sessionId);
      }
      removePopout(sessionId);
    },
    [removePopout]
  );

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const prevOutputting = prevOutputtingRef.current;

    if (!seededRef.current) {
      seededRef.current = true;
      for (const session of sessions) {
        prevStatus.set(session.id, session.status);
        prevOutputting.set(session.id, agentOutputting[session.id] ?? false);
      }
      prevEnabledRef.current = enabled;
      return;
    }

    const enabledTurnedOff = prevEnabledRef.current && !enabled;
    const enabledTurnedOn = !prevEnabledRef.current && enabled;
    prevEnabledRef.current = enabled;

    const currentIds = new Set<string>();

    for (const session of sessions) {
      const { id } = session;
      currentIds.add(id);

      const nextStatus = session.status;
      const prevSessionStatus = prevStatus.get(id);
      const isNewSession = prevSessionStatus === undefined;
      const statusChanged = !isNewSession && prevSessionStatus !== nextStatus;

      const nextOutputting = agentOutputting[id] ?? false;
      const outputtingStarted = !(prevOutputting.get(id) ?? false) && nextOutputting;

      if (prevSessionStatus === "error" && nextStatus !== "error") {
        acknowledgedErrorsRef.current.delete(id);
        removePersistentPopout(id);
      }

      if (enabled && !isNewSession && (statusChanged || outputtingStarted)) {
        if (nextStatus === "error") {
          if (!acknowledgedErrorsRef.current.has(id)) {
            addPopout(id, true);
          }
        } else {
          addPopout(id, false);
        }
      }

      prevStatus.set(id, nextStatus);
      prevOutputting.set(id, nextOutputting);
    }

    for (const id of Array.from(prevStatus.keys())) {
      if (!currentIds.has(id)) {
        prevStatus.delete(id);
        prevOutputting.delete(id);
        acknowledgedErrorsRef.current.delete(id);
        removePopout(id);
      }
    }

    if (enabledTurnedOff) {
      clearAll();
    } else if (enabledTurnedOn) {
      for (const session of sessions) {
        if (session.status === "error" && !acknowledgedErrorsRef.current.has(session.id)) {
          addPopout(session.id, true);
        }
      }
    }
  }, [sessions, agentOutputting, enabled, addPopout, removePopout, removePersistentPopout, clearAll]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { popouts, dismiss };
}

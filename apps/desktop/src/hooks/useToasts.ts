import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastInput, ToastMessage } from "../types";

export function useToasts(timeoutMs = 2000) {
  const fadeOutMs = 1000;
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const displayTimeoutsRef = useRef<Map<string, number>>(new Map());
  const removeTimeoutsRef = useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((id: string) => {
    const displayTimeout = displayTimeoutsRef.current.get(id);
    if (displayTimeout) {
      window.clearTimeout(displayTimeout);
      displayTimeoutsRef.current.delete(id);
    }
    if (removeTimeoutsRef.current.has(id)) {
      return;
    }
    setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)));
    const removeTimeout = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      removeTimeoutsRef.current.delete(id);
      displayTimeoutsRef.current.delete(id);
    }, fadeOutMs);
    removeTimeoutsRef.current.set(id, removeTimeout);
  }, [fadeOutMs]);

  const pushToast = useCallback(
    (input: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: ToastMessage = {
        id,
        message: input.message,
        tone: input.tone ?? "error",
      };
      setToasts((prev) => [toast, ...prev]);
      const displayTimeout = window.setTimeout(() => removeToast(id), timeoutMs);
      displayTimeoutsRef.current.set(id, displayTimeout);
    },
    [removeToast, timeoutMs]
  );

  useEffect(() => {
    return () => {
      displayTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      removeTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      displayTimeoutsRef.current.clear();
      removeTimeoutsRef.current.clear();
    };
  }, []);

  return { toasts, pushToast, removeToast };
}

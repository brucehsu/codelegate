import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastInput, ToastMessage } from "../types";

export function useToasts(timeoutMs = 5000) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timeouts = useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timeout = timeouts.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeouts.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (input: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: ToastMessage = {
        id,
        message: input.message,
        tone: input.tone ?? "error",
      };
      setToasts((prev) => [...prev, toast]);
      const timeout = window.setTimeout(() => removeToast(id), timeoutMs);
      timeouts.current.set(id, timeout);
    },
    [removeToast, timeoutMs]
  );

  useEffect(() => {
    return () => {
      timeouts.current.forEach((timeout) => clearTimeout(timeout));
      timeouts.current.clear();
    };
  }, []);

  return { toasts, pushToast, removeToast };
}

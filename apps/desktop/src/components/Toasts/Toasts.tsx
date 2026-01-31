import type { ToastMessage } from "../../types";
import styles from "./Toasts.module.css";

interface ToastsProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export default function Toasts({ toasts, onDismiss }: ToastsProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`${styles.toast} ${toast.tone === "error" ? styles.error : styles.info}`}
          onClick={() => onDismiss(toast.id)}
        >
          <span className={styles.message}>{toast.message}</span>
        </button>
      ))}
    </div>
  );
}

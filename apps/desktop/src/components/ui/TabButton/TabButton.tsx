import type { ButtonHTMLAttributes } from "react";
import BaseButton from "../BaseButton";
import styles from "./TabButton.module.css";

interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  hotkey?: string;
  showHotkey?: boolean;
}

export default function TabButton({
  active = false,
  hotkey,
  showHotkey = false,
  className,
  type = "button",
  children,
  ...props
}: TabButtonProps) {
  const classes = [styles.button, active ? styles.active : "", className].filter(Boolean).join(" ");

  return (
    <BaseButton type={type} className={classes} {...props}>
      {children}
      {showHotkey && hotkey ? (
        <span className={styles.hint} aria-hidden="true">
          {hotkey}
        </span>
      ) : null}
    </BaseButton>
  );
}

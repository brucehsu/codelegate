import type { ButtonHTMLAttributes, ReactNode } from "react";
import BaseButton from "../BaseButton";
import styles from "./ActionButton.module.css";

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: "default" | "ghost";
}

export default function ActionButton({
  icon,
  variant = "default",
  className,
  type = "button",
  children,
  ...props
}: ActionButtonProps) {
  const isIconOnly = !children;
  const classes = [
    styles.button,
    variant === "ghost" ? styles.ghost : "",
    isIconOnly ? styles.iconOnly : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <BaseButton type={type} className={classes} {...props}>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      {children}
    </BaseButton>
  );
}

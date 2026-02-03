import type { ButtonHTMLAttributes } from "react";
import BaseButton from "../BaseButton";
import styles from "./Button.module.css";

type Variant = "primary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export default function Button({
  variant = "ghost",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const classes = [
    styles.button,
    variant === "primary" ? styles.primary : styles.ghost,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <BaseButton type={type} className={classes} {...props} />;
}

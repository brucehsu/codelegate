import type { ButtonHTMLAttributes, ReactNode } from "react";
import BaseButton from "../BaseButton";
import styles from "./IconButton.module.css";

type Size = "sm" | "lg";

type Variant = "ghost" | "fab" | "raised";

type Shape = "rounded" | "circle";

type Tone = "default" | "danger";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  variant?: Variant;
  shape?: Shape;
  tone?: Tone;
  iconSize?: number;
  children: ReactNode;
}

const sizeMap: Record<Size, number> = {
  sm: 32,
  lg: 44,
};

export default function IconButton({
  size = "sm",
  variant = "ghost",
  shape = "rounded",
  tone = "default",
  iconSize,
  className,
  type = "button",
  children,
  ...props
}: IconButtonProps) {
  const classes = [
    styles.button,
    styles[`size${size.toUpperCase()}`],
    styles[`variant${variant.charAt(0).toUpperCase()}${variant.slice(1)}`],
    shape === "circle" ? styles.shapeCircle : styles.shapeRounded,
    tone === "danger" ? styles.dangerHover : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const iconPx = iconSize ?? Math.floor(sizeMap[size] / 2);

  return (
    <BaseButton type={type} className={classes} {...props}>
      <span className={styles.icon} style={{ width: iconPx, height: iconPx }}>
        {children}
      </span>
    </BaseButton>
  );
}

import { forwardRef, type ButtonHTMLAttributes } from "react";

interface BaseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

const BaseButton = forwardRef<HTMLButtonElement, BaseButtonProps>(function BaseButton(
  { type = "button", ...props },
  ref
) {
  return <button ref={ref} type={type} {...props} />;
});

export default BaseButton;

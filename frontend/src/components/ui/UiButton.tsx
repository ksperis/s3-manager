/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, uiButtonBaseClass, uiButtonVariants } from "./styles";

type UiButtonVariant = keyof typeof uiButtonVariants;
type UiButtonSize = "xs" | "sm" | "md";

const uiButtonSizeClasses: Record<UiButtonSize, string> = {
  xs: "h-7 px-2 py-1 ui-caption",
  sm: "h-8 px-3 py-1.5 text-xs",
  md: "px-4 py-2 ui-body",
};

type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
  children: ReactNode;
};

export default function UiButton({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  leftIcon,
  rightIcon,
  loading = false,
  disabled,
  children,
  ...props
}: UiButtonProps) {
  return (
    <button
      type={type}
      className={cx(uiButtonBaseClass, uiButtonVariants[variant], uiButtonSizeClasses[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {leftIcon ? <span aria-hidden="true">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span aria-hidden="true">{rightIcon}</span> : null}
    </button>
  );
}

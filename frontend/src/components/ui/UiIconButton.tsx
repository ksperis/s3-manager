/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, uiButtonVariants, uiIconButtonClass } from "./styles";

type UiIconButtonSize = "compact" | "md";
type UiIconButtonVariant = "neutral" | "ghost" | "danger";

const uiIconButtonSizeClasses: Record<UiIconButtonSize, string> = {
  compact: "h-6 w-6 text-sm",
  md: "h-8 w-8",
};

type UiIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  label: string;
  icon: ReactNode;
  size?: UiIconButtonSize;
  variant?: UiIconButtonVariant;
};

export default function UiIconButton({
  label,
  icon,
  size = "md",
  variant = "neutral",
  className,
  type = "button",
  title,
  ...props
}: UiIconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx(
        uiIconButtonClass,
        uiIconButtonSizeClasses[size],
        variant === "ghost" && uiButtonVariants.ghost,
        variant === "danger" && uiButtonVariants.danger,
        className
      )}
      {...props}
    >
      {icon}
    </button>
  );
}

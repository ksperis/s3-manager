/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, uiButtonBaseClass, uiButtonVariants } from "./styles";

type UiButtonVariant = keyof typeof uiButtonVariants;

type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: UiButtonVariant;
  children: ReactNode;
};

export default function UiButton({ variant = "primary", className, type = "button", children, ...props }: UiButtonProps) {
  return (
    <button type={type} className={cx(uiButtonBaseClass, uiButtonVariants[variant], className)} {...props}>
      {children}
    </button>
  );
}


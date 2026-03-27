/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { cx, UiTone, uiToneBadgeClasses } from "./styles";

type UiBadgeProps = {
  tone?: UiTone;
  className?: string;
  children: ReactNode;
  title?: string;
  disableToneStyles?: boolean;
};

export default function UiBadge({
  tone = "neutral",
  className,
  children,
  title,
  disableToneStyles = false,
}: UiBadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 ui-caption font-semibold",
        !disableToneStyles && uiToneBadgeClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

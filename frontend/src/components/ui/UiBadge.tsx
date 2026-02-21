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
};

export default function UiBadge({ tone = "neutral", className, children }: UiBadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 ui-caption font-semibold",
        uiToneBadgeClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}


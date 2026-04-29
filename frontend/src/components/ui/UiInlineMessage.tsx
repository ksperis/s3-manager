/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { UiTone, cx, uiToneBannerClasses } from "./styles";

type UiInlineMessageTone = "neutral" | "info" | "success" | "warning" | "error";

type UiInlineMessageProps = {
  tone?: UiInlineMessageTone;
  children: ReactNode;
  className?: string;
};

const toneMap: Record<UiInlineMessageTone, UiTone> = {
  neutral: "neutral",
  info: "info",
  success: "success",
  warning: "warning",
  error: "danger",
};

export default function UiInlineMessage({ tone = "neutral", children, className }: UiInlineMessageProps) {
  if (!children) return null;
  return (
    <div className={cx("rounded-md border px-3 py-2 ui-caption", uiToneBannerClasses[toneMap[tone]], className)}>
      {children}
    </div>
  );
}

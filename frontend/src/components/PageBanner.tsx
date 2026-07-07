/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { UiTone, cx, uiToneBannerClasses } from "./ui/styles";

export type PageBannerTone = "info" | "success" | "warning" | "error";

type PageBannerProps = {
  tone?: PageBannerTone;
  children: ReactNode;
  className?: string;
};

const toneMap: Record<PageBannerTone, UiTone> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "danger",
};

export default function PageBanner({ tone = "info", children, className }: PageBannerProps) {
  if (!children) {
    return null;
  }
  return (
    <div
      className={cx(
        "min-w-0 max-w-full break-words rounded-md border px-3 py-2 ui-caption [overflow-wrap:anywhere]",
        uiToneBannerClasses[toneMap[tone]],
        className
      )}
    >
      {children}
    </div>
  );
}

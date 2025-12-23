/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";

type PageBannerTone = "info" | "success" | "warning" | "error";

type PageBannerProps = {
  tone?: PageBannerTone;
  children: ReactNode;
  className?: string;
};

const toneClasses: Record<PageBannerTone, string> = {
  info: "border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100",
  success:
    "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100",
  warning:
    "border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100",
  error:
    "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100",
};

export default function PageBanner({ tone = "info", children, className }: PageBannerProps) {
  if (!children) {
    return null;
  }
  const base = "rounded-md px-4 py-3 text-sm";
  const toneClass = toneClasses[tone];
  const extra = className ? ` ${className}` : "";
  return <div className={`${base} ${toneClass}${extra}`}>{children}</div>;
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type UiTone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const uiCardClass = "ui-surface-card";

export const uiCardMutedClass = "ui-surface-muted";

export const uiInputClass = "ui-control";

export const uiCheckboxClass =
  "h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600";

export const uiLabelClass =
  "ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

export const uiButtonBaseClass = "ui-button-base";

export const uiButtonVariants: Record<"primary" | "secondary" | "ghost" | "warning" | "danger", string> = {
  primary: "ui-button-primary",
  secondary: "ui-button-secondary",
  ghost:
    "border border-slate-200 text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-200",
  warning: "ui-button-warning",
  danger: "ui-button-danger",
};

export const uiToneBadgeClasses: Record<UiTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100",
  danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100",
  primary:
    "border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900/40 dark:bg-primary-950/40 dark:text-primary-100",
};

export const uiToneBannerClasses: Record<UiTone, string> = {
  neutral:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/50 dark:text-sky-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100",
  danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100",
  primary:
    "border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900/40 dark:bg-primary-950/60 dark:text-primary-100",
};

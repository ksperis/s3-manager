/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type UiTone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";
export type UiFeatureStateTone = "neutral" | "configured" | "unsaved";
type UiFeatureCardState = UiFeatureStateTone | "disabled";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const uiCardClass = "ui-surface-card";

export const uiCardMutedClass = "ui-surface-muted";

export const uiPanelClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]";

export const uiPanelMutedClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]";

export const uiSectionHeaderClass =
  "border-b border-[color:var(--ui-border-soft)] px-4 py-3";

export const uiSectionHeaderLargeClass =
  "border-b border-[color:var(--ui-border-soft)] px-4 py-4";

export const uiDividerClass = "border-[color:var(--ui-border-soft)]";

export const uiTitleTextClass = "font-semibold text-[var(--ui-text)]";

export const uiMutedTextClass = "text-[var(--ui-text-muted)]";

export const uiInputClass = "ui-control";

export const uiCheckboxClass =
  "h-4 w-4 rounded border-[color:var(--ui-border)] text-primary focus:ring-primary";

export const uiRadioClass =
  "h-4 w-4 border-[color:var(--ui-border)] text-primary focus:ring-primary";

export const uiLabelClass =
  "ui-caption font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]";

export const uiButtonBaseClass = "ui-button-base";

export const uiButtonVariants: Record<"primary" | "secondary" | "ghost" | "warning" | "danger" | "neutral", string> = {
  primary: "ui-button-primary",
  secondary: "ui-button-secondary",
  neutral: "ui-button-secondary",
  ghost:
    "border border-transparent text-[var(--ui-text)] hover:border-[color:var(--ui-border)] hover:bg-[var(--ui-hover)] hover:text-primary",
  warning: "ui-button-warning",
  danger: "ui-button-danger",
};

export const uiIconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-muted)] shadow-[var(--ui-shadow-soft)] transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60";

export const uiMenuClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--shell-menu-shadow)]";

export const uiMenuItemClass =
  "rounded-md px-2.5 py-1.5 text-left transition hover:bg-[var(--ui-hover)]";

export const uiToolbarClass =
  "border-b border-[color:var(--ui-border-soft)]";

export const uiToolbarSecondaryClass =
  "border-t border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-muted)] px-4 py-4";

export const uiDataTableClass = "ui-data-table";

export const uiTableContainerClass =
  "overflow-x-auto rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)]";

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

export const uiFeatureStateHighlightFieldClasses: Record<UiFeatureStateTone, string> = {
  neutral: "",
  configured:
    "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200/70 dark:border-emerald-400/70 dark:bg-emerald-500/15 dark:ring-emerald-500/25",
  unsaved:
    "border-amber-400 bg-amber-50 ring-2 ring-amber-300/70 dark:border-amber-400/70 dark:bg-amber-500/20 dark:ring-amber-500/25",
};

export const uiFeatureStateHighlightLabelClasses: Record<UiFeatureStateTone, string> = {
  neutral: "",
  configured: "text-emerald-700 dark:text-emerald-200",
  unsaved: "text-amber-700 dark:text-amber-300",
};

export const uiFeatureCardStateClasses: Record<UiFeatureCardState, string> = {
  neutral: "",
  configured:
    "border-emerald-400 bg-emerald-50/20 ring-2 ring-emerald-200/70 dark:border-emerald-400/70 dark:bg-emerald-500/10 dark:ring-emerald-500/25",
  unsaved:
    "border-amber-400 bg-amber-50/20 ring-2 ring-amber-300/70 dark:border-amber-400/70 dark:bg-amber-500/15 dark:ring-amber-500/25",
  disabled: "opacity-60",
};

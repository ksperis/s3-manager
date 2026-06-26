/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiProgressBar from "../../../components/ui/UiProgressBar";

export type TextMatchMode = "contains" | "exact";
export type FilterCostLevel = "none" | "low" | "medium" | "high";
export type AdvancedSearchProgress = {
  active: boolean;
  determinate: boolean;
  percent: number;
  stage: string;
  message: string;
  processed: number;
  total: number;
};

type AdvancedSearchProgressEvent = {
  percent?: number;
  stage?: string;
  message?: string;
  processed?: number;
  total?: number;
};

export const INACTIVE_ADVANCED_PROGRESS: AdvancedSearchProgress = {
  active: false,
  determinate: true,
  percent: 0,
  stage: "",
  message: "",
  processed: 0,
  total: 0,
};

export const advancedFilterRootClass = "fixed inset-x-0 bottom-0 top-14 z-[46]";

export const advancedFilterBackdropClass = "absolute inset-0 bg-black/50";

export const advancedFilterDrawerClass =
  "absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l border-[color:var(--ui-border)] bg-white text-[var(--ui-text)] shadow-[var(--shell-menu-shadow)] dark:bg-neutral-950 dark:text-slate-100";

export const advancedFilterHeaderClass = "border-b border-[color:var(--ui-border-soft)] px-4 py-3";

export const advancedFilterBodyClass = "flex-1 overflow-y-auto px-4 py-4";

export const advancedFilterFooterClass = "border-t border-[color:var(--ui-border-soft)] bg-white px-4 py-3 dark:bg-neutral-950";

export const advancedFilterSummaryClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-neutral-50 p-3 text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)] dark:bg-neutral-900/80";

export const advancedFilterSectionClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-white p-3 text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)] dark:bg-neutral-900/70";

export const advancedFilterAccordionClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-white text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)] dark:bg-neutral-900/70";

export const advancedFilterMatchModeButtonClass = (active: boolean, locked: boolean = false) => {
  if (locked) {
    if (active) {
      return "cursor-not-allowed rounded-md border border-primary-300 bg-primary-100 px-2 py-1 ui-caption font-semibold text-primary-700 opacity-80 dark:border-primary-500/50 dark:bg-primary-500/20 dark:text-primary-100";
    }
    return "cursor-not-allowed rounded-md border border-slate-200 bg-white px-2 py-1 ui-caption font-semibold text-slate-400 opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500";
  }
  if (active) {
    return "rounded-md border border-primary-300 bg-primary-100 px-2 py-1 ui-caption font-semibold text-primary-700 dark:border-primary-500/50 dark:bg-primary-500/20 dark:text-primary-100";
  }
  return "rounded-md border border-slate-200 bg-white px-2 py-1 ui-caption font-semibold text-slate-600 hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100";
};

export const FILTER_COST_LABEL: Record<FilterCostLevel, string> = {
  none: "No additional cost",
  low: "Low cost",
  medium: "Medium cost",
  high: "High cost",
};

const FILTER_COST_ENABLED_DOTS: Record<FilterCostLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const FILTER_COST_DOT_CLASS: Record<Exclude<FilterCostLevel, "none">, string> = {
  low: "bg-emerald-500 dark:bg-emerald-300",
  medium: "bg-amber-500 dark:bg-amber-300",
  high: "bg-rose-500 dark:bg-rose-300",
};

export const renderFilterCostIndicator = (level: FilterCostLevel, tooltip: string) => {
  const enabledDots = FILTER_COST_ENABLED_DOTS[level];
  const activeClass = level === "none" ? "" : FILTER_COST_DOT_CLASS[level];
  return (
    <span className="inline-flex items-center gap-1" title={tooltip} aria-label={tooltip}>
      {[0, 1, 2].map((idx) => (
        <span
          key={`${level}-${idx}`}
          className={`h-1.5 w-1.5 rounded-full ${idx < enabledDots ? activeClass : "bg-slate-300 dark:bg-slate-600"}`}
        />
      ))}
    </span>
  );
};

export function isCancelledError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (typeof err !== "object" || err === null) return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  return name === "CanceledError" || code === "ERR_CANCELED";
}

export const formatAdvancedSearchStage = (stage: string) => {
  if (!stage.trim()) return "";
  return stage
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export const progressFromAdvancedSearchEvent = (event: AdvancedSearchProgressEvent): AdvancedSearchProgress => {
  const rawPercent = Number(event.percent);
  const percent = Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, Math.round(rawPercent))) : 0;
  const rawProcessed = Number(event.processed);
  const rawTotal = Number(event.total);
  const total = Number.isFinite(rawTotal) ? Math.max(0, Math.round(rawTotal)) : 0;
  const processed = Number.isFinite(rawProcessed) ? Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, Math.round(rawProcessed))) : 0;
  return {
    active: true,
    determinate: true,
    percent,
    stage: event.stage || "",
    message: event.message || "Running advanced search...",
    processed,
    total,
  };
};

export const renderAdvancedSearchProgress = (progress: AdvancedSearchProgress) => {
  if (!progress.active) return null;
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const progressDetails = progress.total > 0 ? ` · ${progress.processed} / ${progress.total}` : "";
  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white/90 p-3 dark:border-slate-700 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
          {progress.determinate ? `Advanced search in progress · ${percent}%` : "Advanced search in progress..."}
        </p>
        {(progress.message || progress.stage) && (
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            {progress.message || formatAdvancedSearchStage(progress.stage)}
            {progressDetails}
          </p>
        )}
      </div>
      <UiProgressBar
        value={progress.determinate ? percent : 100}
        label="Advanced search progress"
        className="mt-2 h-2 bg-slate-200 dark:bg-slate-800"
        barClassName={progress.determinate ? "bg-primary transition-[width] duration-150 ease-out" : "animate-pulse bg-primary/70"}
      />
    </div>
  );
};

export type ParsedExactListInput = {
  values: string[];
  listProvided: boolean;
};

export const parseExactListInput = (value: string): ParsedExactListInput => {
  const raw = value.trim();
  if (!raw) return { values: [], listProvided: false };
  const listProvided = /[\n,]/.test(value);
  if (!listProvided) {
    return { values: [raw], listProvided: false };
  }
  const seen = new Set<string>();
  const values: string[] = [];
  value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      values.push(item);
    });
  return { values, listProvided: true };
};

export const buildTextFieldRules = (field: string, rawValue: string, mode: TextMatchMode): Array<Record<string, unknown>> => {
  const parsed = parseExactListInput(rawValue);
  if (parsed.values.length === 0) return [];
  if (parsed.listProvided) {
    if (parsed.values.length === 1) {
      return [{ field, op: "eq", value: parsed.values[0] }];
    }
    return [{ field, op: "in", value: parsed.values }];
  }
  return [{ field, op: mode === "exact" ? "eq" : "contains", value: parsed.values[0] }];
};

export const formatTextMatchModeLabel = (mode: TextMatchMode) => (mode === "exact" ? "exact" : "contains");

const formatListPreview = (values: string[], limit: number = 2) => {
  if (values.length === 0) return "";
  if (values.length <= limit) return values.join(", ");
  return `${values.slice(0, limit).join(", ")} +${values.length - limit}`;
};

export const formatTextFilterSummary = (label: string, rawValue: string, mode: TextMatchMode) => {
  const parsed = parseExactListInput(rawValue);
  if (parsed.values.length === 0) return null;
  if (parsed.listProvided) {
    return `${label} exact list: ${formatListPreview(parsed.values, 2)}`;
  }
  return `${label} ${formatTextMatchModeLabel(mode)}: ${parsed.values[0]}`;
};

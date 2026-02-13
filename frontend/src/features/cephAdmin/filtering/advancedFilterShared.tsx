/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type TextMatchMode = "contains" | "exact";
export type FilterCostLevel = "none" | "low" | "medium" | "high";

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

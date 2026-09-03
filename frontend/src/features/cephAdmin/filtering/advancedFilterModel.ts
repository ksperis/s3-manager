/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatNumber } from "../../../utils/format";

const ACTIVE_FIELD_CLASS =
  "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200/70 dark:border-emerald-400/70 dark:bg-emerald-500/15 dark:ring-emerald-500/25";
const ACTIVE_LABEL_CLASS = "text-emerald-700 dark:text-emerald-200";
const PENDING_FIELD_CLASS =
  "border-amber-400 bg-amber-50 ring-2 ring-amber-300/70 dark:border-amber-400/70 dark:bg-amber-500/20 dark:ring-amber-500/25";
const PENDING_LABEL_CLASS = "text-amber-700 dark:text-amber-300";

export const advancedFilterFieldHighlight = (isApplied: boolean, isPending: boolean) => {
  if (isPending) return { labelClass: PENDING_LABEL_CLASS, fieldClass: PENDING_FIELD_CLASS };
  if (isApplied) return { labelClass: ACTIVE_LABEL_CLASS, fieldClass: ACTIVE_FIELD_CLASS };
  return { labelClass: "", fieldClass: "" };
};

type NumericFilterSummaryField<Key extends string> = {
  format?: "number" | "percent";
  key: Key;
  label: string;
};

type NumericFilterSummaryItem<Key extends string> = {
  field: Key;
  id: string;
  label: string;
};

export const buildNumericFilterSummaryItems = <Key extends string>(
  values: object,
  fields: readonly NumericFilterSummaryField<Key>[],
  idPrefix = "num-",
): NumericFilterSummaryItem<Key>[] =>
  fields.flatMap(({ format = "number", key, label }) => {
    const value = (values as Partial<Record<Key, unknown>>)[key];
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return [];
    const numeric = Number(raw);
    const display = Number.isFinite(numeric)
      ? format === "percent"
        ? `${numeric}%`
        : formatNumber(numeric)
      : raw;
    return [{ field: key, id: `${idPrefix}${key}`, label: `${label} ${display}` }];
  });

export const appendNumericFilterRule = (
  rules: Array<Record<string, unknown>>,
  field: string,
  operator: "gte" | "lte",
  rawValue: string
) => {
  const normalizedValue = rawValue.trim();
  if (!normalizedValue) return;
  const value = Number(normalizedValue);
  if (!Number.isFinite(value)) return;
  rules.push({ field, op: operator, value });
};

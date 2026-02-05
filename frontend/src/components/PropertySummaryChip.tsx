/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import React from "react";

export type PropertySummaryTone = "active" | "inactive" | "unknown";

const chipClasses: Record<PropertySummaryTone, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100",
  inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  unknown: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-100",
};

const dotClasses: Record<PropertySummaryTone, string> = {
  active: "bg-emerald-500",
  inactive: "bg-slate-400",
  unknown: "bg-amber-500",
};

export default function PropertySummaryChip({
  label,
  state,
  tone,
  compact = false,
  title,
}: {
  label?: string;
  state: string;
  tone: PropertySummaryTone;
  compact?: boolean;
  title?: string;
}) {
  if (compact) {
    return (
      <span
        title={title}
        className={`inline-flex items-center rounded-full px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide ${chipClasses[tone]}`}
      >
        {state}
      </span>
    );
  }
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ui-caption font-semibold ${chipClasses[tone]}`}
    >
      <span className={`h-2 w-2 rounded-full ${dotClasses[tone]}`} />
      {!compact && label ? <span>{label}</span> : null}
      <span className="ui-caption uppercase tracking-wide">{state}</span>
    </span>
  );
}

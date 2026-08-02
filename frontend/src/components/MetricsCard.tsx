/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import {
  cx,
  uiCardClass,
  uiLabelClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "./ui/styles";

type MetricsCardProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  updatedAt?: string | null;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

type MetricsTileProps = {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
  className?: string;
};

type MetricsChartPanelProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  loading?: boolean;
  hasData?: boolean;
  emptyMessage?: string;
  className?: string;
};

type MetricsLegendListItem = {
  key: string;
  label: string;
  value?: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  color?: string;
  title?: string;
};

type MetricsLegendListProps = {
  items: MetricsLegendListItem[];
  className?: string;
};

export function MetricsCard({
  title,
  eyebrow,
  description,
  updatedAt,
  actions,
  children,
  className,
}: MetricsCardProps) {
  const hasHeader = Boolean(title || eyebrow || description || updatedAt || actions);
  return (
    <section className={cx(uiCardClass, "space-y-5 p-5", className)}>
      {hasHeader && (
        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            {eyebrow && <p className="ui-caption font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>}
            <h2 className={cx("ui-section", uiTitleTextClass)}>{title}</h2>
            {description && <p className={cx("ui-body", uiMutedTextClass)}>{description}</p>}
            {updatedAt && <p className={cx("ui-caption", uiMutedTextClass)}>Updated:&nbsp;{new Date(updatedAt).toLocaleString()}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function MetricsTile({ label, value, hint, loading, className }: MetricsTileProps) {
  return (
    <div className={cx("rounded-lg bg-[var(--ui-surface-muted)] px-4 py-3", className)}>
      <p className={uiLabelClass}>{label}</p>
      <p className={cx("mt-2 ui-subtitle", uiTitleTextClass)}>{loading ? "..." : value}</p>
      {hint && <p className={cx("ui-caption", uiMutedTextClass)}>{hint}</p>}
    </div>
  );
}

export function MetricsEmptyState({
  children = "No usable metrics yet.",
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-md border border-dashed border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-muted)] px-4 py-6 text-center ui-body",
        uiMutedTextClass,
        className
      )}
    >
      {children}
    </div>
  );
}

export function MetricsChartPanel({
  title,
  description,
  children,
  loading,
  hasData = true,
  emptyMessage = "No usable metrics for this period yet.",
  className,
}: MetricsChartPanelProps) {
  return (
    <div className={cx("rounded-lg bg-[var(--ui-surface-muted)] p-4", className)}>
      <p className={cx("ui-body", uiTitleTextClass)}>{title}</p>
      {description && <p className={cx("ui-caption", uiMutedTextClass)}>{description}</p>}
      {loading ? (
        <div className="mt-4 h-48 animate-pulse rounded-md bg-[var(--ui-surface)]" />
      ) : hasData ? (
        <div className="mt-4">{children}</div>
      ) : (
        <MetricsEmptyState className="mt-4">{emptyMessage}</MetricsEmptyState>
      )}
    </div>
  );
}

export function MetricsLegendList({ items, className }: MetricsLegendListProps) {
  return (
    <ul className={cx("divide-y divide-[color:var(--ui-border-soft)]", className)}>
      {items.map((item) => (
        <li key={item.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 first:pt-0 last:pb-0">
          <div className="flex min-w-0 items-start gap-2">
            {item.color && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />}
            <div className="min-w-0">
              <p className={cx("truncate ui-caption font-semibold", uiTitleTextClass)} title={item.title ?? item.label}>
                {item.label}
              </p>
              {item.detail && <p className={cx("ui-caption", uiMutedTextClass)}>{item.detail}</p>}
            </div>
          </div>
          {(item.value || item.meta) && (
            <div className="min-w-[6rem] max-w-[9rem] shrink-0 text-right">
              {item.value && <p className={cx("truncate ui-caption font-semibold", uiTitleTextClass)}>{item.value}</p>}
              {item.meta && <p className={cx("truncate ui-caption", uiMutedTextClass)}>{item.meta}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

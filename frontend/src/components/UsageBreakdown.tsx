/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatBytes, formatCompactNumber } from "../utils/format";

type UsageBreakdownItem = {
  id: string;
  label: string;
  usedBytes?: number | null;
  objectCount?: number | null;
};

type UsageBreakdownProps = {
  title: string;
  subtitle?: string;
  items?: UsageBreakdownItem[] | null;
  emptyMessage?: string;
  loading?: boolean;
  maxItems?: number;
  metric?: "bytes" | "objects";
};

const palette = ["#6366F1", "#22C55E", "#F97316", "#14B8A6", "#EF4444", "#A855F7", "#0EA5E9", "#F59E0B"];

const SkeletonPie = () => (
  <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
    <div className="h-48 w-48 animate-pulse rounded-full border-8 border-slate-100 dark:border-slate-800" />
    <div className="flex-1 space-y-3">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 flex-1 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      ))}
    </div>
  </div>
);

export default function UsageBreakdown({
  title,
  subtitle,
  items,
  emptyMessage = "No data available.",
  loading,
  maxItems = 7,
  metric = "bytes",
}: UsageBreakdownProps) {
  const normalized = (items ?? []).map((item) => ({
    ...item,
    usedBytes: item.usedBytes ?? null,
    objectCount: item.objectCount ?? null,
  }));

  const valueKey = metric === "objects" ? "objectCount" : "usedBytes";
  const formatValue = metric === "objects" ? formatCompactNumber : formatBytes;
  const totalSuffix = metric === "objects" ? "objects" : undefined;

  const ranked = [...normalized].sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0));
  const positives = ranked.filter((item) => (item[valueKey] ?? 0) > 0);
  const baseList = positives.length > 0 ? positives : ranked;
  const limit = Math.max(1, maxItems);
  const hasOverflow = baseList.length > limit;
  const primaryLimit = hasOverflow ? Math.max(1, limit - 1) : limit;
  const primary = baseList.slice(0, primaryLimit);
  const overflow = hasOverflow ? baseList.slice(primaryLimit) : [];

  const remainder = overflow.reduce(
    (acc, entry) => ({
      usedBytes: acc.usedBytes + Math.max(entry.usedBytes ?? 0, 0),
      objectCount: acc.objectCount + Math.max(entry.objectCount ?? 0, 0),
    }),
    { usedBytes: 0, objectCount: 0 }
  );

  const visible = hasOverflow
    ? [
        ...primary,
        {
          id: "others",
          label: "Others",
          usedBytes: remainder.usedBytes,
          objectCount: remainder.objectCount,
        },
      ]
    : baseList.slice(0, limit);

  const valueFor = (item: UsageBreakdownItem) =>
    Math.max(metric === "objects" ? item.objectCount ?? 0 : item.usedBytes ?? 0, 0);

  const total = visible.reduce((sum, item) => sum + valueFor(item), 0);
  const hasData = total > 0;

  const radius = 80;
  const circumference = 2 * Math.PI * radius;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Breakdown</p>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </header>

      {loading && <SkeletonPie />}

      {!loading && !hasData && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          {emptyMessage}
        </div>
      )}

      {!loading && hasData && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex justify-center lg:w-1/2">
            <div className="relative h-64 w-64">
              <svg viewBox="0 0 200 200" className="h-full w-full">
                <circle
                  cx="100"
                  cy="100"
                  r={radius}
                  fill="transparent"
                  strokeWidth="24"
                  stroke="#E2E8F0"
                  className="dark:stroke-slate-800"
                  opacity={0.35}
                />
                {visible.reduce<{ offset: number; nodes: JSX.Element[] }>(
                  (acc, item, index) => {
                    const value = valueFor(item);
                    if (value === 0 || total === 0) {
                      return acc;
                    }
                    const pct = value / total;
                    const dash = pct * circumference;
                    const node = (
                      <circle
                        key={item.id}
                        cx="100"
                        cy="100"
                        r={radius}
                        fill="transparent"
                        strokeWidth="24"
                        stroke={palette[index % palette.length]}
                        strokeDasharray={`${dash} ${circumference - dash}`}
                        strokeDashoffset={-acc.offset}
                        strokeLinecap="butt"
                        transform="rotate(-90 100 100)"
                      >
                        <title>
                          {item.label} ·{" "}
                          {metric === "objects" ? `${formatCompactNumber(value)} objects` : formatBytes(value)}
                        </title>
                      </circle>
                    );
                    return { offset: acc.offset + dash, nodes: [...acc.nodes, node] };
                  },
                  { offset: 0, nodes: [] }
                ).nodes}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {formatValue(total)}{" "}
                  {totalSuffix && (
                    <span className="text-[10px] font-semibold uppercase text-slate-400">{totalSuffix}</span>
                  )}
                </p>
              </div>
            </div>
          </div>
          <div className="flex-1" style={{ height: "16rem" }}>
            <div
              className="grid h-full gap-2 overflow-hidden"
              style={{ gridTemplateRows: `repeat(${visible.length}, minmax(0, 1fr))` }}
            >
              {visible.map((item, index) => (
                <div
                  key={item.id}
                  className="flex min-h-0 items-center justify-between rounded-xl border border-slate-100 px-2.5 py-1.5 text-[11px] dark:border-slate-800"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900 dark:text-white">{item.label}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {total > 0 ? ((valueFor(item) / total) * 100).toFixed(1) : 0}%
                      </p>
                    </div>
                  </div>
                  <div className="min-w-[92px] text-right">
                    <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{formatValue(valueFor(item))}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {metric === "objects"
                        ? formatBytes(item.usedBytes ?? 0)
                        : `${formatCompactNumber(item.objectCount ?? 0)} objects`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

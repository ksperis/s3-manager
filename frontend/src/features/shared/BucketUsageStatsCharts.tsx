/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BucketUsageStatsDistributionEntry } from "../../api/bucketUsageStats";
import { MetricsChartPanel, MetricsEmptyState } from "../../components/MetricsCard";
import { cx } from "../../components/ui/styles";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";

const USAGE_STATS_CHART_COLORS = [
  "#2563EB",
  "#059669",
  "#D97706",
  "#DC2626",
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "#4D7C0F",
  "#9333EA",
  "#64748B",
];

export function usageStatsChartColor(index: number): string {
  return USAGE_STATS_CHART_COLORS[index % USAGE_STATS_CHART_COLORS.length];
}

export function nonEmptyUsageStatsEntries(entries?: BucketUsageStatsDistributionEntry[] | null): BucketUsageStatsDistributionEntry[] {
  return (entries ?? []).filter((entry) => entry.count > 0 || entry.bytes > 0);
}

export function formatUsageStatsDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function UsageStatsEmptyChart({ message = "No data available.", compact = false }: { message?: string; compact?: boolean }) {
  return (
    <MetricsEmptyState className={cx("flex items-center justify-center", compact ? "h-28" : "h-52")}>
      {message}
    </MetricsEmptyState>
  );
}

export function UsageStatsChartShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <MetricsChartPanel title={title} description={subtitle}>
      {children}
    </MetricsChartPanel>
  );
}

export function UsageStatsDistributionTooltip({ active, payload, bytesAxis = true }: any & { bytesAxis?: boolean }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload as BucketUsageStatsDistributionEntry | undefined;
  if (!item) return null;
  const primaryValue = bytesAxis
    ? `${formatBytes(item.bytes)} · ${formatPercentage(item.ratio_bytes * 100)}`
    : `${formatCompactNumber(item.count)} version(s) · ${formatPercentage(item.ratio_count * 100)}`;
  const secondaryValue = bytesAxis ? `${formatCompactNumber(item.count)} version(s)` : `${formatBytes(item.bytes)} logical bytes`;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="ui-caption font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
      <p className="ui-caption text-slate-600 dark:text-slate-300">{primaryValue}</p>
      <p className="ui-caption text-slate-500 dark:text-slate-400">{secondaryValue}</p>
    </div>
  );
}

export function UsageStatsDistributionBars({
  entries,
  bytesAxis = true,
  height = 260,
}: {
  entries: BucketUsageStatsDistributionEntry[];
  bytesAxis?: boolean;
  height?: number;
}) {
  if (entries.length === 0) return <UsageStatsEmptyChart compact={height < 180} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={entries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
        <XAxis dataKey="label" stroke="#94A3B8" minTickGap={16} tick={{ fontSize: 11 }} />
        <YAxis
          stroke="#94A3B8"
          tickFormatter={(value) => (bytesAxis ? formatBytes(Number(value) || 0) : formatCompactNumber(Number(value) || 0))}
          tick={{ fontSize: 11 }}
        />
        <Tooltip content={<UsageStatsDistributionTooltip bytesAxis={bytesAxis} />} />
        <Bar dataKey={bytesAxis ? "bytes" : "count"} radius={[4, 4, 0, 0]}>
          {entries.map((entry, index) => (
            <Cell key={entry.key} fill={usageStatsChartColor(index)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function UsageStatsDataTypeDonut({
  entries,
  height = 260,
  legendWidth = 220,
}: {
  entries: BucketUsageStatsDistributionEntry[];
  height?: number;
  legendWidth?: number;
}) {
  if (entries.length === 0) return <UsageStatsEmptyChart compact={height < 180} />;
  const outerRadius = height < 180 ? 58 : 100;
  const innerRadius = height < 180 ? 36 : 64;
  return (
    <div className={cx("grid gap-4", legendWidth > 0 && "lg:grid-cols-[minmax(0,1fr)_220px]")}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={entries}
            dataKey="bytes"
            nameKey="label"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={entries.length > 1 ? 2 : 0}
          >
            {entries.map((entry, index) => (
              <Cell key={entry.key} fill={usageStatsChartColor(index)} />
            ))}
          </Pie>
          <Tooltip content={<UsageStatsDistributionTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {legendWidth > 0 && (
        <div className="max-h-64 space-y-2 overflow-auto pr-1">
          {entries.map((entry, index) => (
            <div key={entry.key} className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: usageStatsChartColor(index) }} />
              <div className="min-w-0">
                <p className="truncate ui-caption font-semibold text-slate-700 dark:text-slate-200">{entry.label}</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {formatBytes(entry.bytes)} · {formatPercentage(entry.ratio_bytes * 100)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

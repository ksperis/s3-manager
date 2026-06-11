/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageHistoryTrendResponse, UsageHistoryTrendWindow } from "../api/usageHistory";
import { formatBytes, formatCompactNumber, formatPercentage } from "../utils/format";
import { MetricsCard, MetricsChartPanel } from "./MetricsCard";
import MetricsUnavailableCard from "./MetricsUnavailableCard";
import { MetricsSnapshotCard } from "./MetricsTrafficOverview";
import {
  cx,
  uiCardMutedClass,
  uiMenuClass,
} from "./ui/styles";

const WINDOW_OPTIONS: { label: string; value: UsageHistoryTrendWindow; helper: string }[] = [
  { label: "24h", value: "day", helper: "Hourly snapshots" },
  { label: "7d", value: "week", helper: "Daily snapshots" },
  { label: "30d", value: "month", helper: "Daily snapshots" },
];

type TrendPoint = UsageHistoryTrendResponse["points"][number] & {
  timestampMs: number;
};

type UsageHistoryTrendsSectionProps = {
  trends: UsageHistoryTrendResponse | null;
  window: UsageHistoryTrendWindow;
  onWindowChange: (value: UsageHistoryTrendWindow) => void;
  loading?: boolean;
  error?: string | null;
  title?: string;
  description?: string;
};

export default function UsageHistoryTrendsSection({
  trends,
  window,
  onWindowChange,
  loading,
  error,
  title = "Usage history",
  description,
}: UsageHistoryTrendsSectionProps) {
  const chartData = useMemo<TrendPoint[]>(
    () =>
      (trends?.points ?? [])
        .map((point) => ({
          ...point,
          timestampMs: new Date(point.period_start).getTime(),
        }))
        .filter((point) => Number.isFinite(point.timestampMs))
        .sort((a, b) => a.timestampMs - b.timestampMs),
    [trends?.points]
  );
  const domain = useMemo(() => {
    if (!chartData.length) return undefined;
    const minTs = chartData[0]?.timestampMs;
    const maxTs = chartData[chartData.length - 1]?.timestampMs;
    if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) return undefined;
    const dayMs = 24 * 60 * 60 * 1000;
    const hourMs = 60 * 60 * 1000;
    const halfStep = window === "day" ? hourMs / 2 : dayMs / 2;
    return [minTs - halfStep, maxTs + halfStep] as [number, number];
  }, [chartData, window]);
  const summary = trends?.summary;
  const hasData = chartData.length > 0;
  const helper = WINDOW_OPTIONS.find((option) => option.value === window)?.helper ?? "Stored snapshots";
  const subtitle = description ?? `${helper} from collected quota usage history.`;

  if (error) {
    return (
      <MetricsUnavailableCard
        title={title}
        description="Stored quota snapshots over time."
        message={error}
        tone="error"
      />
    );
  }

  if (trends && !trends.available) {
    return (
      <MetricsUnavailableCard
        title={title}
        description="Stored quota snapshots over time."
        message={trends.unavailable_reason || "Usage history trends are unavailable for this context."}
      />
    );
  }

  return (
    <MetricsCard
      title={title}
      description={subtitle}
      actions={
        <div className={cx(uiCardMutedClass, "flex items-center gap-2 rounded-full px-2 py-1")}>
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rounded-full px-3 py-1 ui-caption font-semibold transition ${
                option.value === window
                  ? "bg-primary text-white shadow-sm"
                  : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]"
              }`}
              onClick={() => onWindowChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
    >

      <div className="grid gap-4 md:grid-cols-4">
        <MetricsSnapshotCard
          label="Latest storage"
          value={formatBytes(summary?.latest_used_bytes ?? 0)}
          hint={`${formatCompactNumber(summary?.subjects_count ?? 0)} subjects`}
          loading={loading}
        />
        <MetricsSnapshotCard
          label="Latest objects"
          value={formatCompactNumber(summary?.latest_used_objects ?? 0)}
          hint={`${formatCompactNumber(summary?.latest_bucket_count ?? 0)} buckets`}
          loading={loading}
        />
        <MetricsSnapshotCard
          label="Max quota ratio"
          value={formatPercentage(summary?.max_usage_ratio_pct)}
          hint="Highest point"
          loading={loading}
        />
        <MetricsSnapshotCard
          label="Snapshots"
          value={formatCompactNumber(summary?.total_records ?? 0)}
          hint={`${formatCompactNumber(summary?.points_count ?? 0)} periods`}
          loading={loading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Storage evolution" subtitle="Used bytes over time" loading={loading} hasData={hasData}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="timestampMs"
                type="number"
                domain={domain ?? ["auto", "auto"]}
                scale="time"
                tickFormatter={(value) => formatAxisTimestamp(value, window)}
                stroke="#94A3B8"
                minTickGap={32}
              />
              <YAxis tickFormatter={(value) => formatBytesAxis(Number(value) || 0)} stroke="#94A3B8" />
              <Tooltip content={<UsageHistoryTooltip window={window} metric="storage" />} />
              <Area type="monotone" dataKey="used_bytes" name="Storage" stroke="#4F46E5" fill="#4F46E5" fillOpacity={0.16} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Objects & buckets" subtitle="Inventory snapshots over time" loading={loading} hasData={hasData}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="timestampMs"
                type="number"
                domain={domain ?? ["auto", "auto"]}
                scale="time"
                tickFormatter={(value) => formatAxisTimestamp(value, window)}
                stroke="#94A3B8"
                minTickGap={32}
              />
              <YAxis tickFormatter={(value) => formatCompactNumber(Number(value) || 0)} stroke="#94A3B8" />
              <Tooltip content={<UsageHistoryTooltip window={window} metric="inventory" />} />
              <Legend />
              <Line type="monotone" dataKey="used_objects" name="Objects" stroke="#0EA5E9" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="bucket_count" name="Buckets" stroke="#14B8A6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </MetricsCard>
  );
}

type ChartCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  loading?: boolean;
  hasData?: boolean;
};

function ChartCard({ title, subtitle, children, loading, hasData }: ChartCardProps) {
  return (
    <MetricsChartPanel
      title={title}
      description={subtitle}
      loading={loading}
      hasData={hasData}
      emptyMessage="No usage history snapshots for this window yet."
    >
      {children}
    </MetricsChartPanel>
  );
}

function formatAxisTimestamp(value: string | number, window: UsageHistoryTrendWindow) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (window === "day") {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" }).format(date);
}

const tooltipFormatterHourly = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const tooltipFormatterDaily = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "2-digit",
  month: "short",
});

function UsageHistoryTooltip({ payload, label, window, metric }: any) {
  if (!payload || payload.length === 0) return null;
  const date = new Date(label);
  const formatted = Number.isNaN(date.getTime())
    ? label
    : window === "day"
      ? tooltipFormatterHourly.format(date)
      : tooltipFormatterDaily.format(date);
  return (
    <div className={cx(uiMenuClass, "px-3 py-2 ui-body")}>
      <p className="font-semibold">{formatted}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="ui-caption">
          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: {formatTooltipValue(entry.name, entry.value, metric)}
        </p>
      ))}
    </div>
  );
}

function formatTooltipValue(name: string, value: unknown, metric: "storage" | "inventory") {
  const numeric = Number(value) || 0;
  if (metric === "storage" || name === "Storage") return formatBytes(numeric);
  return formatCompactNumber(numeric);
}

function formatBytesAxis(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let sized = value;
  while (sized >= 1024 && idx < units.length - 1) {
    sized /= 1024;
    idx += 1;
  }
  const decimals = sized >= 10 ? 0 : 1;
  return `${sized.toFixed(decimals)} ${units[idx]}`;
}

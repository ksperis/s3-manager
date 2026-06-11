/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ManagerTrafficStats,
  type TrafficBucketRanking,
  type TrafficRequestBreakdown,
  type TrafficUserRanking,
  type TrafficWindow,
} from "../api/stats";
import { formatBytes, formatCompactNumber, formatPercentage } from "../utils/format";
import {
  MetricsCard,
  MetricsChartPanel,
  MetricsEmptyState,
  MetricsLegendList,
  MetricsTile,
} from "./MetricsCard";
import PageBanner from "./PageBanner";
import TrafficBytesChart from "./TrafficBytesChart";
import { cx, uiMenuClass } from "./ui/styles";

const WINDOW_OPTIONS: { label: string; value: TrafficWindow; helper: string }[] = [
  { label: "24h", value: "day", helper: "Last 24 hours" },
  { label: "7d", value: "week", helper: "Weekly trend" },
  { label: "30d", value: "month", helper: "Monthly trend" },
];

type TimelinePoint = {
  timestamp: string;
  timestampMs: number;
  bytes_in: number;
  bytes_out: number;
  ops: number;
  success_ops: number;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function expectedStepMs(window: TrafficWindow): number {
  return window === "week" || window === "month" ? DAY_MS : HOUR_MS;
}

export type MetricsSnapshotCardProps = {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
};

export type MetricsSummaryCardProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  updatedAt?: string | null;
  children: ReactNode;
};

export function MetricsSummaryCard({ eyebrow, title, description, updatedAt, children }: MetricsSummaryCardProps) {
  return (
    <MetricsCard eyebrow={eyebrow} title={title} description={description} updatedAt={updatedAt}>
      {children}
    </MetricsCard>
  );
}

export function MetricsSnapshotCard({ label, value, hint, loading }: MetricsSnapshotCardProps) {
  return <MetricsTile label={label} value={value} hint={hint} loading={loading} />;
}

type MetricsTrafficOverviewProps = {
  traffic: ManagerTrafficStats | null | undefined;
  window: TrafficWindow;
  onWindowChange: (value: TrafficWindow) => void;
  loading?: boolean;
  error?: string | null;
  showEmpty?: boolean;
  description?: string;
  bucketRankingTitle?: string;
  userRankingTitle?: string;
};

export default function MetricsTrafficOverview({
  traffic,
  window,
  onWindowChange,
  loading,
  error,
  showEmpty,
  description,
  bucketRankingTitle = "Most active buckets",
  userRankingTitle = "Most active accounts",
}: MetricsTrafficOverviewProps) {
  const timeline = useMemo<TimelinePoint[]>(
    () => {
      const raw = (traffic?.series ?? [])
        .map((point) => ({
          ...point,
          timestampMs: new Date(point.timestamp).getTime(),
        }))
        .filter((point) => Number.isFinite(point.timestampMs))
        .sort((a, b) => a.timestampMs - b.timestampMs);

      if (!traffic?.start || !traffic?.end) {
        return raw;
      }

      const startMs = new Date(traffic.start).getTime();
      const endMs = new Date(traffic.end).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        return raw;
      }

      const step = expectedStepMs(window);
      const startBoundary = Math.floor(startMs / step) * step;
      const endBoundary = Math.floor(endMs / step) * step;
      const entries = new Map<number, TimelinePoint>();
      raw.forEach((point) => {
        const key = Math.floor(point.timestampMs / step) * step;
        const existing = entries.get(key);
        if (existing) {
          entries.set(key, {
            ...existing,
            bytes_in: existing.bytes_in + point.bytes_in,
            bytes_out: existing.bytes_out + point.bytes_out,
            ops: existing.ops + point.ops,
            success_ops: existing.success_ops + point.success_ops,
          });
        } else {
          entries.set(key, { ...point, timestampMs: key, timestamp: new Date(key).toISOString() });
        }
      });

      const filled: TimelinePoint[] = [];
      for (let ts = startBoundary; ts <= endBoundary; ts += step) {
        const existing = entries.get(ts);
        if (existing) {
          filled.push(existing);
        } else {
          filled.push({
            timestamp: new Date(ts).toISOString(),
            timestampMs: ts,
            bytes_in: 0,
            bytes_out: 0,
            ops: 0,
            success_ops: 0,
          });
        }
      }
      return filled;
    },
    [traffic, window]
  );

  const totals = traffic?.totals;
  const hasData = timeline.length > 0;
  const domain = useMemo(() => {
    if (!timeline.length) {
      return undefined;
    }
    const minTs = timeline[0]?.timestampMs;
    const maxTs = timeline[timeline.length - 1]?.timestampMs;
    if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) {
      return undefined;
    }
    const step = expectedStepMs(window);
    const halfStep = Math.max(step / 2, 1);
    return [minTs - halfStep, maxTs + halfStep] as [number, number];
  }, [timeline, window]);
  const helperText = WINDOW_OPTIONS.find((option) => option.value === window)?.helper ?? "Selected range";
  const subtitle = description ?? `Reading RGW logs (${helperText}) for the selected window.`;
  const hideMetrics = Boolean(error);

  return (
    <MetricsCard
      title="RGW traffic"
      description={subtitle}
      actions={
        <div className="flex items-center gap-2 rounded-full bg-[var(--ui-surface-muted)] px-2 py-1">
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

      {error && <PageBanner tone="warning">{error}</PageBanner>}

      {!hideMetrics && (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricsSnapshotCard label="Egress" value={formatBytes(totals?.bytes_out ?? 0)} hint="Outgoing bytes" loading={loading} />
          <MetricsSnapshotCard label="Ingress" value={formatBytes(totals?.bytes_in ?? 0)} hint="Incoming bytes" loading={loading} />
          <MetricsSnapshotCard
            label="Success rate"
            value={totals?.success_rate != null ? formatPercentage(totals.success_rate * 100) : "—"}
            hint={`${formatCompactNumber(totals?.ops ?? 0)} requests`}
            loading={loading}
          />
        </div>
      )}

      {showEmpty && !hideMetrics && (
        <MetricsEmptyState>No traffic data available for this window.</MetricsEmptyState>
      )}

      {!showEmpty && !hideMetrics && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard
              title={window === "week" || window === "month" ? "Daily traffic" : "Hourly traffic"}
              subtitle="Ingress vs egress comparison"
              loading={loading}
              hasData={hasData}
            >
              <TrafficBytesChart
                window={window}
                series={traffic?.series ?? []}
                start={traffic?.start}
                end={traffic?.end}
                chartKey={`${traffic?.start ?? ""}-${traffic?.end ?? ""}-${window}`}
              />
            </ChartCard>
          </div>
          <div>
            <ChartCard title="Call volume" subtitle="Ops per slot" loading={loading} hasData={hasData}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={timeline} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis
                    dataKey="timestampMs"
                    type="number"
                    domain={domain ?? ["auto", "auto"]}
                    scale="time"
                    tickFormatter={(value) => formatOpsAxisTimestamp(value, window)}
                    stroke="#94A3B8"
                    minTickGap={26}
                  />
                  <YAxis tickFormatter={(value) => formatCompactNumber(Number(value) || 0)} stroke="#94A3B8" />
                  <Tooltip content={<OpsTooltip window={window} />} />
                  <Bar dataKey="ops" name="Ops" fill="#14B8A6" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      )}

      {!showEmpty && !hideMetrics && (
        <div className="grid gap-4 lg:grid-cols-3">
          <RankingCard title={bucketRankingTitle} items={(traffic?.bucket_rankings ?? []).slice(0, 5)} loading={loading} />
          <RankingCard
            title={userRankingTitle}
            items={(traffic?.user_rankings ?? []).slice(0, 5)}
            loading={loading}
            type="user"
          />
          <RequestBreakdown items={traffic?.request_breakdown ?? []} loading={loading} />
        </div>
      )}
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
    <MetricsChartPanel title={title} description={subtitle} loading={loading} hasData={hasData} emptyMessage="No usable metrics for this period yet.">
      {children}
    </MetricsChartPanel>
  );
}

function formatOpsAxisTimestamp(value: string | number, window: TrafficWindow) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (window === "week" || window === "month") {
    return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

const opsTooltipFormatterHourly = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const opsTooltipFormatterDaily = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "2-digit",
  month: "short",
});

function OpsTooltip({ payload, label, window }: any) {
  if (!payload || payload.length === 0) return null;
  const date = new Date(label);
  const formatted = Number.isNaN(date.getTime())
    ? label
    : window === "week" || window === "month"
      ? opsTooltipFormatterDaily.format(date)
      : opsTooltipFormatterHourly.format(date);
  const entry = payload[0];
  return (
    <div className={cx(uiMenuClass, "px-3 py-2 ui-body")}>
      <p className="font-semibold">{formatted}</p>
      <p className="ui-caption">
        <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
        {formatCompactNumber(entry.value)} ops
      </p>
    </div>
  );
}

type RankingCardProps = {
  title: string;
  items: TrafficBucketRanking[] | TrafficUserRanking[];
  loading?: boolean;
  type?: "bucket" | "user";
};

function RankingCard({ title, items, loading, type = "bucket" }: RankingCardProps) {
  if (loading) {
    return <MetricsChartPanel title={title} loading />;
  }
  if (!items || items.length === 0) {
    return <MetricsChartPanel title={title} hasData={false} />;
  }
  return (
    <MetricsChartPanel title={title}>
      <MetricsLegendList
        items={items.map((entry) => {
          const label = type === "bucket" ? (entry as TrafficBucketRanking).bucket : (entry as TrafficUserRanking).user;
          return {
            key: label,
            label,
            title: label,
            detail: (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{formatCompactNumber(entry.ops)} ops</span>
                <span>{entry.success_ratio != null ? formatPercentage(entry.success_ratio * 100) : "n/a"} success</span>
                <span>In {formatBytes(entry.bytes_in)}</span>
                <span>Out {formatBytes(entry.bytes_out)}</span>
              </span>
            ),
            value: formatBytes(entry.bytes_total),
          };
        })}
      />
    </MetricsChartPanel>
  );
}

type RequestBreakdownProps = {
  items: TrafficRequestBreakdown[];
  loading?: boolean;
};

function RequestBreakdown({ items, loading }: RequestBreakdownProps) {
  if (loading) {
    return <MetricsChartPanel title="Request breakdown" loading />;
  }
  if (!items || items.length === 0) {
    return <MetricsChartPanel title="Request breakdown" hasData={false} />;
  }
  return (
    <MetricsChartPanel title="Request breakdown">
      <MetricsLegendList
        items={items.map((entry) => ({
          key: entry.group,
          label: entry.group,
          color: "#94A3B8",
          detail: `${formatCompactNumber(entry.ops)} ops`,
          value: formatBytes(entry.bytes_in + entry.bytes_out),
        }))}
      />
    </MetricsChartPanel>
  );
}

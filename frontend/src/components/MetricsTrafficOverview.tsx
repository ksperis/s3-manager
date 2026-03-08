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
import PageBanner from "./PageBanner";
import TrafficBytesChart from "./TrafficBytesChart";

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

export function MetricsSnapshotCard({ label, value, hint, loading }: MetricsSnapshotCardProps) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 ui-subtitle font-semibold text-slate-900 dark:text-white">{loading ? "…" : value}</p>
      {hint && <p className="ui-caption text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
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

  return (
    <section className="space-y-5 ui-surface-card p-5">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="ui-caption font-semibold uppercase tracking-wide text-primary">RGW traffic</p>
          <h3 className="ui-section font-semibold text-slate-900 dark:text-slate-100">Bandwidth & requests</h3>
          <p className="ui-body text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-900/60">
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rounded-full px-3 py-1 ui-caption font-semibold transition ${
                option.value === window
                  ? "bg-primary text-white shadow-sm"
                  : "text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
              onClick={() => onWindowChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {error && <PageBanner tone="warning">{error}</PageBanner>}

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

      {showEmpty && !error && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center ui-body text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          No traffic data available for this window.
        </div>
      )}

      {!showEmpty && (
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

      {!showEmpty && (
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
    </section>
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
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="ui-body font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        {subtitle && <p className="ui-caption text-slate-500 dark:text-slate-400">{subtitle}</p>}
        <div className="mt-4 h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="ui-body font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {subtitle && <p className="ui-caption text-slate-500 dark:text-slate-400">{subtitle}</p>}
      {hasData ? <div className="mt-4">{children}</div> : <EmptyState />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center ui-body text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
      No usable metrics for this period yet.
    </div>
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
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
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
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="ui-body font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        <div className="mt-3 space-y-2">
          {[1, 2, 3].map((key) => (
            <div key={key} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="ui-body font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        <EmptyState />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="ui-body font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <ul className="mt-3 space-y-3">
        {items.map((entry) => (
          <li
            key={type === "bucket" ? (entry as TrafficBucketRanking).bucket : (entry as TrafficUserRanking).user}
            className="rounded-lg border border-slate-100 p-3 dark:border-slate-800"
          >
            <div className="flex items-center justify-between ui-body">
              <div>
                <p className="font-semibold text-slate-700 dark:text-slate-200">
                  {type === "bucket" ? (entry as TrafficBucketRanking).bucket : (entry as TrafficUserRanking).user}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {formatCompactNumber(entry.ops)} ops ·{" "}
                  {entry.success_ratio != null ? formatPercentage(entry.success_ratio * 100) : "n/a"} success
                </p>
              </div>
              <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">{formatBytes(entry.bytes_total)}</p>
            </div>
            <div className="mt-2 flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
                In&nbsp;{formatBytes(entry.bytes_in)}
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
                Out&nbsp;{formatBytes(entry.bytes_out)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type RequestBreakdownProps = {
  items: TrafficRequestBreakdown[];
  loading?: boolean;
};

function RequestBreakdown({ items, loading }: RequestBreakdownProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="ui-body font-semibold text-slate-700 dark:text-slate-200">Request breakdown</p>
        <div className="mt-3 space-y-2">
          {[1, 2, 3].map((key) => (
            <div key={key} className="h-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="ui-body font-semibold text-slate-700 dark:text-slate-200">Request breakdown</p>
        <EmptyState />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="ui-body font-semibold text-slate-700 dark:text-slate-200">Request breakdown</p>
      <ul className="mt-3 space-y-2">
        {items.map((entry) => (
          <li
            key={entry.group}
            className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 ui-body dark:bg-slate-900/50"
          >
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
              {entry.group}
            </div>
            <div className="text-right ui-caption text-slate-500 dark:text-slate-400">
              <p>{formatBytes(entry.bytes_in + entry.bytes_out)}</p>
              <p>{formatCompactNumber(entry.ops)} ops</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

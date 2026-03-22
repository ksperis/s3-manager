/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { S3AccountSelector } from "../../api/accountParams";
import {
  ManagerTrafficStats,
  TrafficBucketRanking,
  TrafficCategoryBreakdown,
  TrafficRequestBreakdown,
  TrafficWindow,
  fetchManagerTraffic,
} from "../../api/stats";
import { fetchCephAdminClusterTraffic } from "../../api/cephAdmin";
import TrafficBytesChart from "../../components/TrafficBytesChart";
import { cx, uiCardClass, uiCardMutedClass } from "../../components/ui/styles";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import { extractApiError } from "../../utils/apiError";
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

const WINDOW_OPTIONS: { label: string; value: TrafficWindow; helper: string }[] = [
  { label: "24h", value: "day", helper: "Last day" },
  { label: "7d", value: "week", helper: "Weekly trend" },
  { label: "30d", value: "month", helper: "Monthly trend" },
];

const REQUEST_COLORS: Record<string, string> = {
  read: "#4F46E5",
  write: "#0EA5E9",
  delete: "#F97316",
  list: "#22C55E",
  metadata: "#8B5CF6",
  other: "#94A3B8",
};

const CATEGORY_COLORS = ["#4F46E5", "#14B8A6", "#F97316", "#0EA5E9", "#F59E0B", "#EC4899"];
type TrafficAnalyticsProps = {
  accountId?: S3AccountSelector;
  endpointId?: number | null;
  bucketName?: string;
  scope?: "manager" | "ceph-admin";
  enabled?: boolean;
};

export default function TrafficAnalytics({ accountId, endpointId, bucketName, scope = "manager", enabled = true }: TrafficAnalyticsProps) {
  const [window, setWindow] = useState<TrafficWindow>("week");
  const [traffic, setTraffic] = useState<ManagerTrafficStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setTraffic(null);
      return () => {
        cancelled = true;
      };
    }
    async function load() {
      setLoading(true);
      setError(null);
      try {
        let data: ManagerTrafficStats;
        if (scope === "ceph-admin") {
          if (!endpointId) {
            if (!cancelled) {
              setTraffic(null);
            }
            return;
          }
          data = await fetchCephAdminClusterTraffic(endpointId, window, bucketName);
        } else {
          data = await fetchManagerTraffic(accountId ?? null, window, bucketName);
        }
        if (!cancelled) {
          setTraffic(data);
        }
      } catch (err) {
        if (!cancelled) {
          setTraffic(null);
          setError(extractApiError(err, "Unable to retrieve traffic logs."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [accountId, endpointId, window, bucketName, scope, enabled]);

  const totals = traffic?.totals;
  const hasSeries = (traffic?.series ?? []).length > 0;

  const primaryBuckets = useMemo(() => (traffic?.bucket_rankings ?? []).slice(0, 5), [traffic]);
  const topCategories = useMemo(() => (traffic?.category_breakdown ?? []).slice(0, 6), [traffic]);
  const requestPieData = useMemo(() => prepareRequestPie(traffic?.request_breakdown ?? []), [traffic]);

  return (
    <section className={cx(uiCardClass, "space-y-4 p-4")}>
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Traffic</p>
          <h3 className="ui-section font-semibold text-slate-900 dark:text-slate-100">Traffic visualization</h3>
          {bucketName && (
            <p className="ui-caption font-semibold text-primary-700 dark:text-primary-200">Bucket: {bucketName}</p>
          )}
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Ingress/egress volume, request types, and busiest buckets.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-900/60">
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rounded-full px-2.5 py-1 ui-caption font-semibold transition ${
                option.value === window
                  ? "bg-primary text-white shadow-sm"
                  : "text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
              onClick={() => setWindow(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 ui-caption text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <TrafficTotalCard
          label="Egress traffic"
          value={formatBytes(totals?.bytes_out ?? 0)}
          hint="Bytes sent"
          loading={loading}
        />
        <TrafficTotalCard
          label="Ingress traffic"
          value={formatBytes(totals?.bytes_in ?? 0)}
          hint="Bytes received"
          loading={loading}
        />
        <TrafficTotalCard
          label="Success rate"
          value={totals?.success_rate != null ? formatPercentage(totals.success_rate * 100) : "—"}
          hint={`${formatCompactNumber(totals?.ops ?? 0)} requests`}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard
            title={window === "week" || window === "month" ? "Daily traffic" : "Hourly traffic"}
            subtitle="Ingress vs egress comparison"
            loading={loading}
            hasData={hasSeries}
          >
            <TrafficBytesChart
              window={window}
              series={traffic?.series ?? []}
              start={traffic?.start}
              end={traffic?.end}
              chartKey={`${traffic?.start ?? ""}-${traffic?.end ?? ""}-${window}-${bucketName ?? "all"}`}
            />
          </ChartCard>
        </div>
        <div>
          <ChartCard title="Request breakdown" subtitle="By functional group" loading={loading} hasData={requestPieData.length > 0}>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <ResponsiveContainer width="60%" height={280}>
                <PieChart>
                  <Pie
                    data={requestPieData}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={45}
                    outerRadius={80}
                  >
                    {requestPieData.map((entry, index) => (
                      <Cell key={entry.label} fill={REQUEST_COLORS[entry.label] ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatBytes(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="flex-1 space-y-2 ui-body">
                {(traffic?.request_breakdown ?? []).map((entry) => (
                  <li key={entry.group} className={cx(uiCardMutedClass, "flex items-center justify-between px-3 py-2")}>
                    <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: REQUEST_COLORS[entry.group] ?? "#94A3B8" }}
                      />
                      {entry.group}
                    </span>
                    <span className="ui-caption text-slate-500 dark:text-slate-400">{formatCompactNumber(entry.ops)} ops</span>
                  </li>
                ))}
              </ul>
            </div>
          </ChartCard>
        </div>
      </div>

      {!bucketName && (
        <div className="grid gap-4 lg:grid-cols-2">
          <BucketRanking rankings={primaryBuckets} loading={loading} />
          <CategoryChart categories={topCategories} loading={loading} />
        </div>
      )}
    </section>
  );
}

type TotalCardProps = {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
};

function TrafficTotalCard({ label, value, hint, loading }: TotalCardProps) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1.5 ui-title font-semibold text-slate-900 dark:text-white">{loading ? "…" : value}</p>
      {hint && <p className="ui-caption text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

type ChartCardProps = {
  title: string;
  subtitle?: string;
  loading?: boolean;
  children: ReactNode;
  hasData?: boolean;
};

function ChartCard({ title, subtitle, loading, children, hasData }: ChartCardProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        <div className="mt-3 h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {subtitle && <p className="ui-caption text-slate-500 dark:text-slate-400">{subtitle}</p>}
      {hasData ? <div className="mt-3">{children}</div> : <EmptyState />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center ui-caption text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
      No usable measurements yet for this time window.
    </div>
  );
}

function prepareRequestPie(requests: TrafficRequestBreakdown[]) {
  const dataset = requests.map((entry) => ({
    label: entry.group,
    value: entry.bytes_in + entry.bytes_out,
  }));
  const total = dataset.reduce((sum, entry) => sum + entry.value, 0);
  if (total === 0) {
    return [];
  }
  return dataset;
}

type BucketRankingProps = {
  rankings: TrafficBucketRanking[];
  loading?: boolean;
};

function BucketRanking({ rankings, loading }: BucketRankingProps) {
  const maxComponent = Math.max(
    ...rankings.map((entry) => Math.max(entry.bytes_in ?? 0, entry.bytes_out ?? 0)),
    0
  );
  const safeMaxComponent = maxComponent || 1;
  return (
    <ChartCard
      title="Most active buckets"
      subtitle="Top 5 for the selected window"
      loading={loading}
      hasData={rankings.length > 0}
    >
      <ul className="space-y-3">
        {rankings.map((entry) => (
          <li key={entry.bucket} className="space-y-2 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
            <div className="flex items-center justify-between ui-body">
              <div>
                <p className="font-semibold text-slate-700 dark:text-slate-200">{entry.bucket}</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {`${formatCompactNumber(entry.ops)} ops · success ${
                    entry.success_ratio != null ? formatPercentage(entry.success_ratio * 100) : "n/a"
                  }`}
                </p>
              </div>
              <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">{formatBytes(entry.bytes_total)}</p>
            </div>
            <div className="space-y-1">
              <BucketBar label="In" color="#0EA5E9" value={entry.bytes_in ?? 0} max={safeMaxComponent} />
              <BucketBar label="Out" color="#4F46E5" value={entry.bytes_out ?? 0} max={safeMaxComponent} />
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

type CategoryChartProps = {
  categories: TrafficCategoryBreakdown[];
  loading?: boolean;
};

function CategoryChart({ categories, loading }: CategoryChartProps) {
  const chartData = categories.map((entry) => ({
    ...entry,
    total: entry.bytes_in + entry.bytes_out,
  }));
  return (
    <ChartCard title="Top request categories" subtitle="By transferred volume" loading={loading} hasData={chartData.length > 0}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 60 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis type="number" tickFormatter={(value) => formatBytes(value)} stroke="#94A3B8" />
          <YAxis type="category" dataKey="category" stroke="#94A3B8" />
          <Tooltip formatter={(value) => formatBytes(Number(value))} />
          <Bar dataKey="total" fill="#14B8A6">
            {chartData.map((entry, index) => (
              <Cell key={entry.category} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function BucketBar({ label, color, value, max }: { label: string; color: string; value: number; max: number }) {
  const width = Math.max((value / max) * 100, value > 0 ? 2 : 0);
  return (
    <div className="flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
      <span className="w-8 text-right font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-2 rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
      <span className="w-20 text-right ui-caption text-slate-500 dark:text-slate-400">{formatBytes(value)}</span>
    </div>
  );
}

// Traffic bytes axis formatting is handled by the shared TrafficBytesChart component.

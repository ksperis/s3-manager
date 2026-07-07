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
import {
  MetricsCard,
  MetricsChartPanel,
  MetricsLegendList,
  MetricsTile,
} from "../../components/MetricsCard";
import PageBanner from "../../components/PageBanner";
import TrafficBytesChart from "../../components/TrafficBytesChart";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
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
  visible?: boolean;
};

export default function TrafficAnalytics({
  accountId,
  endpointId,
  bucketName,
  scope = "manager",
  enabled = true,
  visible = true,
}: TrafficAnalyticsProps) {
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
  const hideMetrics = Boolean(error);

  const primaryBuckets = useMemo(() => (traffic?.bucket_rankings ?? []).slice(0, 5), [traffic]);
  const topCategories = useMemo(() => (traffic?.category_breakdown ?? []).slice(0, 6), [traffic]);
  const requestPieData = useMemo(() => prepareRequestPie(traffic?.request_breakdown ?? []), [traffic]);

  if (!visible) {
    return null;
  }

  return (
    <MetricsCard
      title="Traffic"
      description="Ingress/egress volume, request types, and busiest buckets."
      actions={
        <UiSegmentedControl
          ariaLabel="Traffic window"
          options={WINDOW_OPTIONS}
          value={window}
          onChange={setWindow}
        />
      }
    >

      {error && <PageBanner tone="warning">{error}</PageBanner>}

      {!hideMetrics && (
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
      )}

      {!hideMetrics && (
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
                <MetricsLegendList
                  className="flex-1"
                  items={(traffic?.request_breakdown ?? []).map((entry) => ({
                    key: entry.group,
                    label: entry.group,
                    color: REQUEST_COLORS[entry.group] ?? "#94A3B8",
                    value: `${formatCompactNumber(entry.ops)} ops`,
                  }))}
                />
              </div>
            </ChartCard>
          </div>
        </div>
      )}

      {!bucketName && !hideMetrics && (
        <div className="grid gap-4 lg:grid-cols-2">
          <BucketRanking rankings={primaryBuckets} loading={loading} />
          <CategoryChart categories={topCategories} loading={loading} />
        </div>
      )}
    </MetricsCard>
  );
}

type TotalCardProps = {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
};

function TrafficTotalCard({ label, value, hint, loading }: TotalCardProps) {
  return <MetricsTile label={label} value={value} hint={hint} loading={loading} />;
}

type ChartCardProps = {
  title: string;
  subtitle?: string;
  loading?: boolean;
  children: ReactNode;
  hasData?: boolean;
};

function ChartCard({ title, subtitle, loading, children, hasData }: ChartCardProps) {
  return (
    <MetricsChartPanel title={title} description={subtitle} loading={loading} hasData={hasData} emptyMessage="No usable measurements yet for this time window.">
      {children}
    </MetricsChartPanel>
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
          <li key={entry.bucket} className="space-y-2 border-b border-[color:var(--ui-border-soft)] pb-3 last:border-b-0 last:pb-0">
            <div className="flex items-center justify-between ui-body">
              <div className="min-w-0">
                <p className="truncate font-semibold text-[var(--ui-text)]" title={entry.bucket}>{entry.bucket}</p>
                <p className="ui-caption text-[var(--ui-text-muted)]">
                  {`${formatCompactNumber(entry.ops)} ops · success ${
                    entry.success_ratio != null ? formatPercentage(entry.success_ratio * 100) : "n/a"
                  }`}
                </p>
              </div>
              <p className="shrink-0 ui-caption font-semibold text-[var(--ui-text-muted)]">{formatBytes(entry.bytes_total)}</p>
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
    <div className="flex items-center gap-2 ui-caption text-[var(--ui-text-muted)]">
      <span className="w-8 text-right font-semibold text-[var(--ui-text)]">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-[var(--ui-surface)]">
        <div className="h-2 rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
      <span className="w-20 text-right ui-caption text-[var(--ui-text-muted)]">{formatBytes(value)}</span>
    </div>
  );
}

// Traffic bytes axis formatting is handled by the shared TrafficBytesChart component.

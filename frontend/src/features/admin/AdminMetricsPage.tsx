/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AdminStats,
  AdminTrafficStats,
  TrafficBucketRanking,
  TrafficRequestBreakdown,
  TrafficUserRanking,
  TrafficWindow,
  fetchAdminStorage,
  fetchAdminTraffic,
} from "../../api/stats";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import PageHeader from "../../components/PageHeader";
import UsageBreakdown from "../../components/UsageBreakdown";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";

const WINDOW_OPTIONS: { label: string; value: TrafficWindow; helper: string }[] = [
  { label: "24h", value: "day", helper: "Last 24 hours" },
  { label: "7d", value: "week", helper: "Weekly trend" },
];

type TimelinePoint = {
  timestamp: string;
  timestampMs: number;
  bytes_in: number;
  bytes_out: number;
  ops: number;
  success_ops: number;
};

export default function AdminMetricsPage() {
  const [storage, setStorage] = useState<AdminStats | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageLoading, setStorageLoading] = useState<boolean>(true);

  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [endpointLoading, setEndpointLoading] = useState<boolean>(true);
  const [endpointError, setEndpointError] = useState<string | null>(null);

  const [traffic, setTraffic] = useState<AdminTrafficStats | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [trafficLoading, setTrafficLoading] = useState<boolean>(false);

  const [window, setWindow] = useState<TrafficWindow>("week");

  useEffect(() => {
    let cancelled = false;
    async function loadEndpoints() {
      setEndpointLoading(true);
      setEndpointError(null);
      try {
        const data = await listStorageEndpoints();
        if (cancelled) {
          return;
        }
        const cephEndpoints = data.filter((endpoint) => endpoint.provider === "ceph");
        setEndpoints(cephEndpoints);
        if (cephEndpoints.length === 0) {
          setSelectedEndpointId(null);
          setEndpointError("No Ceph endpoint available for metrics.");
        } else {
          const preferred = cephEndpoints.find((ep) => ep.is_default) || cephEndpoints[0];
          setSelectedEndpointId((current) => current ?? preferred.id);
        }
      } catch {
        if (!cancelled) {
          setEndpoints([]);
          setSelectedEndpointId(null);
          setEndpointError("Unable to retrieve the endpoint list.");
        }
      } finally {
        if (!cancelled) {
          setEndpointLoading(false);
        }
      }
    }
    loadEndpoints();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStorage() {
      if (endpointLoading) {
        return;
      }
      if (selectedEndpointId == null) {
        setStorage(null);
        setStorageLoading(false);
        return;
      }
      setStorage(null);
      setStorageLoading(true);
      setStorageError(null);
      try {
        const data = await fetchAdminStorage(selectedEndpointId);
        if (!cancelled) {
          setStorage(data);
        }
      } catch {
        if (!cancelled) {
          setStorageError("Unable to load admin storage metrics.");
          setStorage(null);
        }
      } finally {
        if (!cancelled) {
          setStorageLoading(false);
        }
      }
    }
    loadStorage();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, selectedEndpointId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTraffic() {
      if (endpointLoading) {
        return;
      }
      if (selectedEndpointId == null) {
        setTraffic(null);
        setTrafficLoading(false);
        return;
      }
      setTraffic(null);
      setTrafficLoading(true);
      setTrafficError(null);
      try {
        const data = await fetchAdminTraffic(window, selectedEndpointId);
        if (!cancelled) {
          setTraffic(data);
        }
      } catch {
        if (!cancelled) {
          setTrafficError("Unable to retrieve RGW logs.");
          setTraffic(null);
        }
      } finally {
        if (!cancelled) {
          setTrafficLoading(false);
        }
      }
    }
    loadTraffic();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, selectedEndpointId, window]);

  const storageTotals = storage?.storage_totals;
  const timeline = useMemo<TimelinePoint[]>(
    () =>
      (traffic?.series ?? [])
        .map((point) => ({
          ...point,
          timestampMs: new Date(point.timestamp).getTime(),
        }))
        .sort((a, b) => a.timestampMs - b.timestampMs),
    [traffic]
  );

  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null,
    [endpoints, selectedEndpointId]
  );

  const accountUsageItems = useMemo(
    () =>
      (storage?.account_usage ?? []).map((account) => ({
        id: account.account_id,
        label: account.account_name || account.account_id,
        usedBytes: account.used_bytes ?? null,
        objectCount: account.object_count ?? null,
      })),
    [storage?.account_usage]
  );

  const userUsageItems = useMemo(
    () =>
      (storage?.s3_user_usage ?? []).map((user) => ({
        id: user.rgw_user_uid || `s3-user-${user.user_id}`,
        label: user.user_name || user.rgw_user_uid || `User #${user.user_id}`,
        usedBytes: user.used_bytes ?? null,
        objectCount: user.object_count ?? null,
      })),
    [storage?.s3_user_usage]
  );

  const pageError = endpointError || storageError;
  const missingTraffic = selectedEndpointId != null && !traffic && !trafficLoading && !trafficError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metrics"
        description={pageError || "Centralized view of platform storage and traffic."}
        breadcrumbs={[{ label: "Admin" }, { label: "Overview", to: "/admin" }, { label: "Metrics" }]}
      />

      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Ceph endpoint</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Choose the storage to analyze (Ceph endpoints only).
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3">
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              value={selectedEndpointId ?? ""}
              onChange={(event) => setSelectedEndpointId(event.target.value ? Number(event.target.value) : null)}
              disabled={endpointLoading || endpoints.length === 0}
            >
              {endpointLoading && <option value="">Loading...</option>}
              {!endpointLoading && endpoints.length === 0 && <option value="">No Ceph endpoint</option>}
              {!endpointLoading &&
                endpoints.map((endpoint) => (
                  <option key={endpoint.id} value={endpoint.id} title={endpoint.endpoint_url}>
                    {endpoint.is_default ? `${endpoint.name} (default)` : endpoint.name}
                  </option>
                ))}
            </select>
            {selectedEndpoint && (
              <span
                className="max-w-[320px] truncate text-xs text-slate-500 dark:text-slate-400"
                title={selectedEndpoint.endpoint_url}
              >
                {selectedEndpoint.endpoint_url}
              </span>
            )}
          </div>
        </div>
      </div>

      {pageError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          {pageError}
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-5 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
        <header className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Storage snapshot</p>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stored volume & objects</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Aggregated stats across known S3 accounts.</p>
          </div>
          {storage?.generated_at && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Updated:&nbsp;{new Date(storage.generated_at).toLocaleString()}
            </p>
          )}
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SnapshotCard
            label="Stored volume"
            value={storageTotals?.used_bytes != null ? formatBytes(storageTotals.used_bytes) : "—"}
            hint="Sum of known buckets"
            loading={storageLoading}
          />
          <SnapshotCard
            label="Objects"
            value={storageTotals?.object_count != null ? formatCompactNumber(storageTotals.object_count) : "—"}
            hint="Instant count"
            loading={storageLoading}
          />
          <SnapshotCard
            label="Visible buckets"
            value={
              storageTotals?.bucket_count != null ? formatCompactNumber(storageTotals.bucket_count) : "—"
            }
            hint="Based on root credentials"
            loading={storageLoading}
          />
          <SnapshotCard
            label="S3 accounts"
            value={storage ? formatCompactNumber(storage.total_accounts) : "—"}
            hint={`${formatCompactNumber(storage?.total_s3_users ?? 0)} S3 users`}
            loading={storageLoading}
          />
        </div>
      </section>

      <TrafficOverview
        window={window}
        onWindowChange={setWindow}
        loading={trafficLoading}
        traffic={traffic}
        timeline={timeline}
        error={trafficError}
        showEmpty={missingTraffic}
      />

      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Storage breakdown</p>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Accounts & users</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Account scan with graphical breakdown.</p>
        </header>
        <div className="grid gap-6 xl:grid-cols-2">
          <UsageBreakdown
            title="Accounts (volume)"
            subtitle="Volume used per account (top 8)."
            loading={storageLoading}
            metric="bytes"
            items={accountUsageItems}
            emptyMessage="No volume data available."
          />
          <UsageBreakdown
            title="Accounts (objects)"
            subtitle="Object count per account (top 8)."
            loading={storageLoading}
            metric="objects"
            items={accountUsageItems}
            emptyMessage="No object data available."
          />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <UsageBreakdown
            title="S3 users (volume)"
            subtitle="Volume consumed per user."
            loading={storageLoading}
            metric="bytes"
            items={userUsageItems}
            emptyMessage="No S3 users with metrics."
          />
          <UsageBreakdown
            title="S3 users (objects)"
            subtitle="Object count per user."
            loading={storageLoading}
            metric="objects"
            items={userUsageItems}
            emptyMessage="No S3 users with metrics."
          />
        </div>
      </section>
    </div>
  );
}

type SnapshotCardProps = {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
};

function SnapshotCard({ label, value, hint, loading }: SnapshotCardProps) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{loading ? "…" : value}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

type TrafficOverviewProps = {
  traffic: AdminStats["traffic"] | null | undefined;
  timeline: TimelinePoint[];
  window: TrafficWindow;
  onWindowChange: (value: TrafficWindow) => void;
  loading?: boolean;
  error?: string | null;
  showEmpty?: boolean;
};

function TrafficOverview({ traffic, timeline, window, onWindowChange, loading, error, showEmpty }: TrafficOverviewProps) {
  const totals = traffic?.totals;
  const hasData = timeline.length > 0;
  const domain =
    traffic?.start && traffic?.end
      ? [new Date(traffic.start).getTime(), new Date(traffic.end).getTime()]
      : undefined;

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">RGW traffic</p>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bandwidth & requests</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Reading RGW logs ({WINDOW_OPTIONS.find((o) => o.value === window)?.helper}) for the selected window.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-900/60">
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
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

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SnapshotCard label="Egress" value={formatBytes(totals?.bytes_out ?? 0)} hint="Outgoing bytes" loading={loading} />
        <SnapshotCard label="Ingress" value={formatBytes(totals?.bytes_in ?? 0)} hint="Incoming bytes" loading={loading} />
        <SnapshotCard
          label="Success rate"
          value={totals?.success_rate != null ? formatPercentage(totals.success_rate * 100) : "—"}
          hint={`${formatCompactNumber(totals?.ops ?? 0)} requests`}
          loading={loading}
        />
      </div>

      {showEmpty && !error && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          No traffic data available for this window.
        </div>
      )}

      {!showEmpty && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard title="Bandwidth" subtitle="Ingress vs egress" loading={loading} hasData={hasData}>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart
                  data={timeline}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  key={`${traffic?.start ?? ""}-${traffic?.end ?? ""}-${window}`}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis
                    dataKey="timestampMs"
                    type="number"
                    domain={domain ?? ["auto", "auto"]}
                    tickFormatter={formatTimestamp}
                    stroke="#94A3B8"
                    minTickGap={32}
                  />
                  <YAxis tickFormatter={formatYAxisBytes} stroke="#94A3B8" />
                  <Tooltip content={<BytesTooltip />} />
                  <Legend />
                  <Area type="monotone" dataKey="bytes_in" name="Ingress" stackId="bytes" stroke="#0EA5E9" fill="#0EA5E9" fillOpacity={0.25} />
                  <Area type="monotone" dataKey="bytes_out" name="Egress" stackId="bytes" stroke="#4F46E5" fill="#4F46E5" fillOpacity={0.25} />
                </AreaChart>
              </ResponsiveContainer>
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
                    tickFormatter={formatTimestampShort}
                    stroke="#94A3B8"
                    minTickGap={26}
                  />
                  <YAxis tickFormatter={(value) => formatCompactNumber(Number(value) || 0)} stroke="#94A3B8" />
                  <Tooltip content={<OpsTooltip />} />
                  <Bar dataKey="ops" name="Ops" fill="#14B8A6" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      )}

      {!showEmpty && (
        <div className="grid gap-4 lg:grid-cols-3">
          <RankingCard title="Most active buckets" items={(traffic?.bucket_rankings ?? []).slice(0, 5)} loading={loading} />
          <RankingCard
            title="Most active users"
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
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        <div className="mt-4 h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      {hasData ? <div className="mt-4">{children}</div> : <EmptyState />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
      No usable metrics for this period yet.
    </div>
  );
}

function formatTimestamp(value: string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit" }).format(date);
}

function formatTimestampShort(value: string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatYAxisBytes(value: number) {
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

function BytesTooltip({ payload, label }: any) {
  if (!payload || payload.length === 0) return null;
  const date = new Date(label);
  const formatted = Number.isNaN(date.getTime()) ? label : new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <p className="font-semibold">{formatted}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="text-xs">
          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: {formatBytes(entry.value)}
        </p>
      ))}
    </div>
  );
}

function OpsTooltip({ payload, label }: any) {
  if (!payload || payload.length === 0) return null;
  const date = new Date(label);
  const formatted = Number.isNaN(date.getTime()) ? label : new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  const entry = payload[0];
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <p className="font-semibold">{formatted}</p>
      <p className="text-xs">
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
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
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
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        <EmptyState />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <ul className="mt-3 space-y-3">
        {items.map((entry) => (
          <li key={type === "bucket" ? (entry as TrafficBucketRanking).bucket : (entry as TrafficUserRanking).user} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
            <div className="flex items-center justify-between text-sm">
              <div>
                <p className="font-semibold text-slate-700 dark:text-slate-200">
                  {type === "bucket" ? (entry as TrafficBucketRanking).bucket : (entry as TrafficUserRanking).user}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatCompactNumber(entry.ops)} ops ·{" "}
                  {entry.success_ratio != null ? formatPercentage(entry.success_ratio * 100) : "n/a"} success
                </p>
              </div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{formatBytes(entry.bytes_total)}</p>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
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
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Request breakdown</p>
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
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Request breakdown</p>
        <EmptyState />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Request breakdown</p>
      <ul className="mt-3 space-y-2">
        {items.map((entry) => (
          <li key={entry.group} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
              {entry.group}
            </div>
            <div className="text-right text-xs text-slate-500 dark:text-slate-400">
              <p>{formatBytes(entry.bytes_in + entry.bytes_out)}</p>
              <p>{formatCompactNumber(entry.ops)} ops</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

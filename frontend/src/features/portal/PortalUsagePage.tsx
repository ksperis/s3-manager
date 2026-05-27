/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { getPortalBillingMe, type BillingSubjectDetail } from "../../api/billing";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import {
  PortalV3Badge,
  PortalV3Card,
  PortalV3Donut,
  PortalV3MetricCard,
  PortalV3MiniLineChart,
  PortalV3Page,
  PortalV3PageHeader,
  PortalV3Progress,
} from "./PortalV3Components";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const COLORS = ["#2563eb", "#14b8a6", "#64748b", "#f59e0b", "#ef4444", "#94a3b8"];

function currentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function percent(used?: number | null, quota?: number | null): number | null {
  if (used == null || quota == null || quota <= 0) return null;
  return Math.min(100, Math.max(0, (used / quota) * 100));
}

function formatCurrency(value?: number | null, currency?: string | null): string {
  if (value == null) return "-";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || "EUR"}`;
  }
}

function metricDelta(value?: string | null): string {
  return value && value !== "-" ? value : "Unavailable";
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-6 text-center text-xs font-semibold text-slate-500">
      {children}
    </div>
  );
}

function trendLabels(points: Array<{ label: string }>): string[] {
  if (points.length === 0) return [];
  if (points.length <= 6) return points.map((point) => point.label);
  const indexes = new Set([0, Math.floor(points.length / 4), Math.floor(points.length / 2), Math.floor((points.length * 3) / 4), points.length - 1]);
  return points.filter((_point, index) => indexes.has(index)).map((point) => point.label);
}

export default function PortalUsagePage() {
  const [month, setMonth] = useState(currentMonth());
  const [billing, setBilling] = useState<BillingSubjectDetail | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingUnavailable, setBillingUnavailable] = useState(false);
  const {
    workspace,
    storageSpaces,
    usage,
    usageError,
    traffic,
    trafficLoading,
    loading,
    error,
    accountError,
    accountLoading,
    hasAccountContext,
    accountIdForApi,
    state,
  } = usePortalWorkspaceData({ includeTraffic: true });

  useEffect(() => {
    let cancelled = false;
    if (!hasAccountContext || !accountIdForApi) {
      setBilling(null);
      setBillingLoading(false);
      setBillingUnavailable(false);
      return () => {
        cancelled = true;
      };
    }
    setBillingLoading(true);
    setBillingUnavailable(false);
    getPortalBillingMe(month, accountIdForApi)
      .then((data) => {
        if (!cancelled) setBilling(data);
      })
      .catch(() => {
        if (!cancelled) {
          setBilling(null);
          setBillingUnavailable(true);
        }
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, month]);

  const storageBySpace = useMemo(() => {
    const apiSpaces = storageSpaces ?? [];
    return apiSpaces
      .map((space) => {
        const workspaceSpace = workspace.spaces.find((item) => item.id === space.id);
        return {
          id: space.id,
          name: workspaceSpace?.name ?? space.name,
          usedBytes: space.used_bytes ?? null,
          objectCount: space.object_count ?? null,
          quotaBytes: space.quota_max_size_bytes ?? null,
        };
      })
      .filter((space) => space.usedBytes != null || space.objectCount != null);
  }, [storageSpaces, workspace.spaces]);

  const totalUsedBytes =
    usage?.used_bytes ??
    (storageBySpace.some((space) => space.usedBytes != null)
      ? storageBySpace.reduce((sum, space) => sum + (space.usedBytes ?? 0), 0)
      : null);
  const totalObjects =
    usage?.used_objects ??
    (storageBySpace.some((space) => space.objectCount != null)
      ? storageBySpace.reduce((sum, space) => sum + (space.objectCount ?? 0), 0)
      : null);
  const quotaBytes = state?.quota_max_size_bytes ?? null;
  const quotaPercent = percent(totalUsedBytes, quotaBytes);
  const trafficTotals = traffic?.totals ?? null;
  const billingUsage = billing?.usage ?? null;
  const dataInBytes = trafficTotals?.bytes_in ?? billingUsage?.bytes_in ?? null;
  const dataOutBytes = trafficTotals?.bytes_out ?? billingUsage?.bytes_out ?? null;
  const requestCount = trafficTotals?.ops ?? billingUsage?.ops_total ?? null;
  const cost = billing?.cost ?? null;
  const billingCoverage = billing?.coverage;

  const billingTrend = useMemo(
    () =>
      (billing?.daily ?? [])
        .map((point) => ({
          label: point.day.slice(5),
          storage: point.storage_bytes ?? null,
          traffic: (point.bytes_in ?? 0) + (point.bytes_out ?? 0),
          requests: point.ops_total ?? null,
        }))
        .filter((point) => point.storage != null || point.traffic > 0 || point.requests != null),
    [billing]
  );
  const trafficTrend = useMemo(
    () =>
      (traffic?.series ?? []).map((point) => ({
        label: new Date(point.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        traffic: point.bytes_in + point.bytes_out,
        requests: point.ops,
      })),
    [traffic]
  );
  const storageTrendValues = billingTrend.map((point) => point.storage ?? 0).filter((value) => value > 0);
  const trafficTrendValues =
    billingTrend.length > 0
      ? billingTrend.map((point) => point.traffic)
      : trafficTrend.map((point) => point.traffic);
  const requestTrendValues =
    billingTrend.length > 0
      ? billingTrend.map((point) => point.requests ?? 0)
      : trafficTrend.map((point) => point.requests);
  const labels = trendLabels(
    billingTrend.length > 0
      ? billingTrend.map((point) => ({ label: point.label }))
      : trafficTrend.map((point) => ({ label: point.label }))
  );

  const donutSegments = storageBySpace.slice(0, 6).map((space, index) => ({
    value: space.usedBytes ?? 0,
    color: COLORS[index] ?? "#94a3b8",
  }));

  if (accountLoading || loading) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading analytics...</div></PortalV3Page>;
  }

  if (accountError || error || !hasAccountContext) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">{accountError ?? error ?? "Select an account."}</div></PortalV3Page>;
  }

  return (
    <PortalV3Page>
      <PortalV3PageHeader
        title="Usage & Analytics"
        description="Track storage, bandwidth, requests and billing sources for this workspace."
        right={
          <label className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm">
            <span>Month</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="w-[120px] border-0 bg-transparent p-0 text-xs font-semibold text-slate-700 outline-none"
            />
          </label>
        }
      />

      <div className="border-b border-slate-200">
        <div className="flex gap-7 overflow-x-auto">
          {["Overview", "Storage", "Bandwidth", "Requests", "Billing source"].map((tab, index) => (
            <button key={tab} type="button" className={index === 0 ? "portal-v3-tab portal-v3-tab-active" : "portal-v3-tab"}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {usageError ? (
        <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          Usage metrics are unavailable from the storage endpoint. Available billing or traffic data is still shown.
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <PortalV3MetricCard
          label="Storage Used"
          value={formatBytes(totalUsedBytes)}
          delta={quotaPercent == null ? "Quota unavailable" : `${formatPercentage(quotaPercent)} used`}
        />
        <PortalV3MetricCard label="Objects" value={formatCompactNumber(totalObjects)} delta={metricDelta(totalObjects != null ? "tracked" : null)} tone="blue" />
        <PortalV3MetricCard label="Data In" value={formatBytes(dataInBytes)} delta={trafficLoading ? "Loading traffic" : metricDelta(dataInBytes != null ? "from traffic" : null)} tone="green" />
        <PortalV3MetricCard label="Data Out" value={formatBytes(dataOutBytes)} delta={trafficLoading ? "Loading traffic" : metricDelta(dataOutBytes != null ? "from traffic" : null)} tone="amber" />
        <PortalV3MetricCard label="Requests" value={formatCompactNumber(requestCount)} delta={metricDelta(requestCount != null ? "operations" : null)} tone="blue" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <PortalV3Card title="Storage over time" description="Uses billing daily storage when collection is enabled.">
          {storageTrendValues.length > 0 ? (
            <>
              <PortalV3MiniLineChart values={storageTrendValues} />
              <div className="mt-2 flex justify-between text-[11px] font-semibold text-slate-400">
                {labels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </>
          ) : (
            <EmptyState>No storage trend data available for this month.</EmptyState>
          )}
        </PortalV3Card>

        <PortalV3Card title="Usage by storage space">
          {storageBySpace.length > 0 && totalUsedBytes != null ? (
            <div className="grid gap-4 md:grid-cols-[190px_1fr] md:items-center">
              <PortalV3Donut segments={donutSegments} center={formatBytes(totalUsedBytes)} caption="total used" />
              <div className="space-y-3">
                {storageBySpace.slice(0, 6).map((space, index) => {
                  const share = percent(space.usedBytes, totalUsedBytes) ?? 0;
                  return (
                    <div key={space.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index] ?? "#94a3b8" }} />
                        <span className="truncate font-semibold text-slate-700">{space.name}</span>
                      </div>
                      <span className="shrink-0 text-slate-500">{formatBytes(space.usedBytes)}</span>
                      <div className="col-span-2">
                        <PortalV3Progress value={share} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState>No per-storage-space usage metrics available.</EmptyState>
          )}
        </PortalV3Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <PortalV3Card title="Bandwidth trend" description="Ingress and egress combined.">
          {trafficTrendValues.length > 0 ? (
            <>
              <PortalV3MiniLineChart values={trafficTrendValues} />
              <div className="mt-2 flex justify-between text-[11px] font-semibold text-slate-400">
                {labels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </>
          ) : (
            <EmptyState>No bandwidth trend available.</EmptyState>
          )}
        </PortalV3Card>

        <PortalV3Card title="Request trend" description="Total operations over time.">
          {requestTrendValues.length > 0 ? (
            <>
              <PortalV3MiniLineChart values={requestTrendValues} />
              <div className="mt-2 flex justify-between text-[11px] font-semibold text-slate-400">
                {labels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </>
          ) : (
            <EmptyState>No request trend available.</EmptyState>
          )}
        </PortalV3Card>

        <PortalV3Card title="Billing source" description="Cost and monthly collection coverage when billing is enabled.">
          {billingLoading ? (
            <EmptyState>Loading billing source data...</EmptyState>
          ) : billing ? (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-500">Estimated cost</span>
                <span className="text-lg font-bold text-slate-950">{formatCurrency(cost?.total_cost, cost?.currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-500">Average storage</span>
                <span className="font-bold text-slate-800">{formatBytes(billing.storage.avg_bytes)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-500">Coverage</span>
                <PortalV3Badge tone={billingCoverage && billingCoverage.coverage_ratio >= 0.9 ? "green" : "amber"}>
                  {billingCoverage ? `${billingCoverage.days_collected}/${billingCoverage.days_in_month} days` : "Unavailable"}
                </PortalV3Badge>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
                {cost?.rate_card_name ? `Rate card: ${cost.rate_card_name}` : "No rate card attached."}
              </div>
            </div>
          ) : (
            <EmptyState>{billingUnavailable ? "Billing source is disabled or unavailable." : "No billing source data available."}</EmptyState>
          )}
        </PortalV3Card>
      </section>
    </PortalV3Page>
  );
}

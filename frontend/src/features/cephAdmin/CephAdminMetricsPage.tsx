/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  CephAdminClusterStorageMetrics,
  CephAdminClusterTrafficMetrics,
  fetchCephAdminClusterStorage,
  fetchCephAdminClusterTraffic,
} from "../../api/cephAdmin";
import { TrafficWindow } from "../../api/stats";
import MetricsTrafficOverview, { MetricsSnapshotCard } from "../../components/MetricsTrafficOverview";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import UsageBreakdown from "../../components/UsageBreakdown";
import WorkspaceContextStrip from "../../components/WorkspaceContextStrip";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import useCephAdminWorkspaceContextStrip from "./useCephAdminWorkspaceContextStrip";

function extractError(err: unknown, fallback: string): string {
  return extractApiError(err, fallback);
}

export default function CephAdminMetricsPage() {
  const {
    selectedEndpointId,
    selectedEndpoint,
    selectedEndpointAccess,
    selectedEndpointAccessLoading,
    loading: endpointLoading,
  } = useCephAdminEndpoint();
  const [storage, setStorage] = useState<CephAdminClusterStorageMetrics | null>(null);
  const [storageLoading, setStorageLoading] = useState<boolean>(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const [traffic, setTraffic] = useState<CephAdminClusterTrafficMetrics | null>(null);
  const [trafficLoading, setTrafficLoading] = useState<boolean>(false);
  const [trafficError, setTrafficError] = useState<string | null>(null);

  const [window, setWindow] = useState<TrafficWindow>("week");
  const metricsCredentialsReady = !selectedEndpointAccessLoading && Boolean(selectedEndpointAccess?.can_metrics);
  const storageFeatureEnabled = selectedEndpoint?.capabilities?.metrics !== false;
  const usageLogFeatureEnabled = selectedEndpoint?.capabilities?.usage !== false;
  const canLoadStorage = selectedEndpointId != null && metricsCredentialsReady && storageFeatureEnabled;
  const canLoadTraffic = selectedEndpointId != null && metricsCredentialsReady && usageLogFeatureEnabled;

  useEffect(() => {
    let cancelled = false;
    async function loadStorage() {
      if (endpointLoading || selectedEndpointAccessLoading) {
        return;
      }
      const endpointId = selectedEndpointId;
      if (!canLoadStorage || endpointId == null) {
        setStorage(null);
        setStorageLoading(false);
        return;
      }
      setStorage(null);
      setStorageLoading(true);
      setStorageError(null);
      try {
        const payload = await fetchCephAdminClusterStorage(endpointId);
        if (!cancelled) {
          setStorage(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setStorage(null);
          setStorageError(extractError(err, "Unable to load cluster storage metrics."));
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
  }, [canLoadStorage, endpointLoading, selectedEndpointAccessLoading, selectedEndpointId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTraffic() {
      if (endpointLoading || selectedEndpointAccessLoading) {
        return;
      }
      const endpointId = selectedEndpointId;
      if (!canLoadTraffic || endpointId == null) {
        setTraffic(null);
        setTrafficLoading(false);
        return;
      }
      setTraffic(null);
      setTrafficLoading(true);
      setTrafficError(null);
      try {
        const payload = await fetchCephAdminClusterTraffic(endpointId, window);
        if (!cancelled) {
          setTraffic(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setTraffic(null);
          setTrafficError(extractError(err, "Unable to retrieve RGW logs."));
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
  }, [canLoadTraffic, endpointLoading, selectedEndpointAccessLoading, selectedEndpointId, window]);

  const storageTotals = storage?.storage_totals;
  const ownerUsageItems = useMemo(
    () =>
      (storage?.owner_usage ?? []).map((entry) => ({
        id: entry.owner,
        label: entry.owner,
        usedBytes: entry.used_bytes ?? null,
        objectCount: entry.object_count ?? null,
      })),
    [storage?.owner_usage]
  );
  const bucketUsageItems = useMemo(
    () =>
      (storage?.bucket_usage ?? []).map((entry) => ({
        id: entry.name,
        label: entry.name,
        usedBytes: entry.used_bytes ?? null,
        objectCount: entry.object_count ?? null,
      })),
    [storage?.bucket_usage]
  );

  const endpointRequired = !endpointLoading && selectedEndpointId == null;
  const metricsUnavailableError =
    !endpointLoading && !selectedEndpointAccessLoading && selectedEndpointId != null && !metricsCredentialsReady
      ? "Supervision credentials are not configured for this endpoint."
      : null;
  const storageDisabledMessage =
    selectedEndpointId != null && metricsCredentialsReady && !storageFeatureEnabled
      ? "Storage metrics are disabled for this endpoint."
      : null;
  const trafficDisabledMessage =
    selectedEndpointId != null && metricsCredentialsReady && !usageLogFeatureEnabled
      ? "Usage logs are disabled for this endpoint."
      : null;
  const noMetricsSurfaceAvailable =
    selectedEndpointId != null && metricsCredentialsReady && !storageFeatureEnabled && !usageLogFeatureEnabled;
  const missingTraffic = canLoadTraffic && !traffic && !trafficLoading && !trafficError;
  const contextStrip = useCephAdminWorkspaceContextStrip({
    description: "Cluster-wide RGW storage and traffic metrics depend on the selected endpoint and its supervision capabilities.",
    extraAlerts: metricsUnavailableError ? [{ tone: "warning", message: metricsUnavailableError }] : [],
  });

  return (
    <div className="space-y-4 ui-caption leading-relaxed">
      <PageHeader
        title="Metrics"
        description="Cluster-wide Ceph RGW storage and traffic metrics."
        breadcrumbs={[{ label: "Ceph Admin", to: "/ceph-admin" }, { label: "Metrics" }]}
      />
      <WorkspaceContextStrip {...contextStrip} />
      {storageError && <PageBanner tone="error">{storageError}</PageBanner>}

      {endpointRequired ? (
        <PageEmptyState
          title="Select a Ceph endpoint before opening metrics"
          description="Cluster metrics are endpoint-scoped. Choose an endpoint to load storage snapshots, traffic analytics, and owner breakdowns."
          primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
          tone="warning"
        />
      ) : metricsUnavailableError ? (
        <PageEmptyState
          title="Metrics credentials are not configured for this endpoint"
          description="This endpoint does not currently expose Ceph admin metrics. Configure supervision credentials before opening storage and traffic analytics."
          primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
          tone="warning"
        />
      ) : noMetricsSurfaceAvailable ? (
        <PageEmptyState
          title="Metrics are disabled for this endpoint"
          description="Both storage metrics and usage logs are disabled for the selected endpoint. Enable at least one capability to restore analytics on this page."
          primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
          tone="warning"
        />
      ) : (
        <>
          {storageDisabledMessage && <PageBanner tone="info">{storageDisabledMessage}</PageBanner>}
          {trafficDisabledMessage && <PageBanner tone="info">{trafficDisabledMessage}</PageBanner>}

          {storageFeatureEnabled && (
            <>
              <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-5 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
                <header className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
                  <div>
                    <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Storage snapshot</p>
                    <h3 className="ui-section font-semibold text-slate-900 dark:text-slate-100">Stored volume & objects</h3>
                    <p className="ui-body text-slate-500 dark:text-slate-400">Aggregated stats across the entire RGW cluster.</p>
                  </div>
                  {storage?.generated_at && (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      Updated:&nbsp;{new Date(storage.generated_at).toLocaleString()}
                    </p>
                  )}
                </header>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricsSnapshotCard
                    label="Stored volume"
                    value={storageTotals?.used_bytes != null ? formatBytes(storageTotals.used_bytes) : "—"}
                    hint="Sum of all visible buckets"
                    loading={storageLoading}
                  />
                  <MetricsSnapshotCard
                    label="Objects"
                    value={storageTotals?.object_count != null ? formatCompactNumber(storageTotals.object_count) : "—"}
                    hint="Instant cluster count"
                    loading={storageLoading}
                  />
                  <MetricsSnapshotCard
                    label="Buckets"
                    value={formatCompactNumber(storageTotals?.bucket_count ?? storage?.total_buckets ?? 0)}
                    hint="Across all owners"
                    loading={storageLoading}
                  />
                  <MetricsSnapshotCard
                    label="Owners"
                    value={formatCompactNumber(storageTotals?.owners_with_usage ?? 0)}
                    hint="Distinct bucket owners"
                    loading={storageLoading}
                  />
                </div>
              </section>

              <section className="space-y-4 ui-surface-card p-5">
                <header className="space-y-1">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Storage breakdown</p>
                  <h3 className="ui-section font-semibold text-slate-900 dark:text-slate-100">Owners & buckets</h3>
                  <p className="ui-body text-slate-500 dark:text-slate-400">Top consumers by owner and bucket.</p>
                </header>
                <div className="grid gap-6 xl:grid-cols-2">
                  <UsageBreakdown
                    title="Owners (volume)"
                    subtitle="Volume used per owner (top 8)."
                    loading={storageLoading}
                    metric="bytes"
                    items={ownerUsageItems}
                    emptyMessage="No owner volume data available."
                  />
                  <UsageBreakdown
                    title="Owners (objects)"
                    subtitle="Object count per owner (top 8)."
                    loading={storageLoading}
                    metric="objects"
                    items={ownerUsageItems}
                    emptyMessage="No owner object data available."
                  />
                </div>
                <div className="grid gap-6 xl:grid-cols-2">
                  <UsageBreakdown
                    title="Buckets (volume)"
                    subtitle="Volume used per bucket (top 8)."
                    loading={storageLoading}
                    metric="bytes"
                    items={bucketUsageItems}
                    emptyMessage="No bucket volume data available."
                  />
                  <UsageBreakdown
                    title="Buckets (objects)"
                    subtitle="Object count per bucket (top 8)."
                    loading={storageLoading}
                    metric="objects"
                    items={bucketUsageItems}
                    emptyMessage="No bucket object data available."
                  />
                </div>
              </section>
            </>
          )}

          {usageLogFeatureEnabled && (
            <MetricsTrafficOverview
              traffic={traffic}
              window={window}
              onWindowChange={setWindow}
              loading={trafficLoading}
              error={trafficError}
              showEmpty={missingTraffic}
              description="Reading cluster-wide RGW logs for the selected window."
              userRankingTitle="Most active owners"
            />
          )}
        </>
      )}
    </div>
  );
}

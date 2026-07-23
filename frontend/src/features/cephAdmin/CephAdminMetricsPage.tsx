/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCephAdminUsageStatsAggregate,
  streamCephAdminUsageStatsAggregate,
  type BucketUsageStatsAggregate,
} from "../../api/bucketUsageStats";
import {
  CephAdminClusterStorageMetrics,
  CephAdminClusterTrafficMetrics,
  fetchCephAdminClusterStorage,
  fetchCephAdminClusterTraffic,
} from "../../api/cephAdmin";
import { TrafficWindow } from "../../api/stats";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { MetricsCard } from "../../components/MetricsCard";
import MetricsTrafficOverview, { MetricsSnapshotCard, MetricsSummaryCard } from "../../components/MetricsTrafficOverview";
import MetricsUnavailableCard from "../../components/MetricsUnavailableCard";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";
import UsageBreakdown from "../../components/UsageBreakdown";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";

type CephAdminMetricsTab = "storage" | "usage-composition" | "traffic";

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
  const [activeTab, setActiveTab] = useState<CephAdminMetricsTab>("storage");
  const [storage, setStorage] = useState<CephAdminClusterStorageMetrics | null>(null);
  const [storageLoading, setStorageLoading] = useState<boolean>(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const [traffic, setTraffic] = useState<CephAdminClusterTrafficMetrics | null>(null);
  const [trafficLoading, setTrafficLoading] = useState<boolean>(false);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsRecalculating, setUsageStatsRecalculating] = useState(false);
  const [usageStatsConfirmOpen, setUsageStatsConfirmOpen] = useState(false);

  const [window, setWindow] = useState<TrafficWindow>("week");
  const metricsCredentialsReady = !selectedEndpointAccessLoading && Boolean(selectedEndpointAccess?.can_metrics);
  const usageStatsAccessReady = !selectedEndpointAccessLoading && Boolean(selectedEndpointAccess?.can_admin);
  const storageFeatureEnabled = selectedEndpoint?.capabilities?.metrics !== false;
  const usageLogFeatureEnabled = selectedEndpoint?.capabilities?.usage !== false;
  const canLoadStorage = selectedEndpointId != null && metricsCredentialsReady && storageFeatureEnabled;
  const canLoadTraffic = selectedEndpointId != null && metricsCredentialsReady && usageLogFeatureEnabled;
  const canLoadUsageStatsAggregate = selectedEndpointId != null && usageStatsAccessReady;

  const loadUsageStatsAggregate = useCallback(async () => {
    const endpointId = selectedEndpointId;
    if (!canLoadUsageStatsAggregate || endpointId == null) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      setUsageStatsError(null);
      return;
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const data = await getCephAdminUsageStatsAggregate(endpointId);
      setUsageStatsAggregate(data.aggregate);
    } catch (err) {
      setUsageStatsAggregate(null);
      setUsageStatsError(extractError(err, "Unable to load cluster usage composition."));
    } finally {
      setUsageStatsLoading(false);
    }
  }, [canLoadUsageStatsAggregate, selectedEndpointId]);

  useEffect(() => {
    void loadUsageStatsAggregate();
  }, [loadUsageStatsAggregate]);

  const runUsageStatsRecalculation = useCallback(async () => {
    const endpointId = selectedEndpointId;
    if (!canLoadUsageStatsAggregate || endpointId == null) return;
    setUsageStatsRecalculating(true);
    setUsageStatsError(null);
    try {
      await streamCephAdminUsageStatsAggregate(endpointId, { parallelism: 8 });
      await loadUsageStatsAggregate();
    } catch (err) {
      setUsageStatsError(extractError(err, "Unable to recalculate cluster usage composition."));
    } finally {
      setUsageStatsRecalculating(false);
    }
  }, [canLoadUsageStatsAggregate, loadUsageStatsAggregate, selectedEndpointId]);

  const handleRecalculateUsageStats = useCallback(() => {
    if (!canLoadUsageStatsAggregate || selectedEndpointId == null) return;
    setUsageStatsConfirmOpen(true);
  }, [canLoadUsageStatsAggregate, selectedEndpointId]);

  const handleConfirmRecalculateUsageStats = useCallback(() => {
    setUsageStatsConfirmOpen(false);
    void runUsageStatsRecalculation();
  }, [runUsageStatsRecalculation]);

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
  const usageStatsAggregateSection = canLoadUsageStatsAggregate ? (
    <BucketUsageStatsAggregateCard
      title="Cluster usage composition"
      description="Latest calculated bucket snapshots for the selected Ceph endpoint."
      aggregate={usageStatsAggregate}
      loading={usageStatsLoading}
      error={usageStatsError}
      recalculating={usageStatsRecalculating}
      recalculateLabel="Recalculate cluster"
      onRecalculate={handleRecalculateUsageStats}
    />
  ) : null;
  const metricsTabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: "Storage" },
        ...(canLoadUsageStatsAggregate ? [{ id: "usage-composition" as const, label: "Usage composition" }] : []),
        { id: "traffic" as const, label: "Traffic" },
      ],
    [canLoadUsageStatsAggregate]
  );

  useEffect(() => {
    if (!metricsTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(metricsTabs[0]?.id ?? "storage");
    }
  }, [activeTab, metricsTabs]);

  return (
    <div className="space-y-4 ui-caption leading-relaxed">
      <PageHeader
        title="Usage & Metrics"
        description="Latest calculated logical usage composition plus cluster-wide Ceph RGW storage and traffic metrics."
        breadcrumbs={cephAdminPageBreadcrumbs("metrics")}
      />

      {endpointRequired ? (
        <PageEmptyState
          title="Select a Ceph endpoint before opening usage and metrics"
          description="Cluster usage composition and metrics are endpoint-scoped. Choose an endpoint to load usage snapshots, storage metrics, traffic analytics, and owner breakdowns."
          primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
          tone="warning"
        />
      ) : metricsUnavailableError && !canLoadUsageStatsAggregate ? (
        <PageEmptyState
          title="Metrics credentials are not configured for this endpoint"
          description="This endpoint does not currently expose Ceph admin metrics. Configure supervision credentials before opening storage and traffic analytics."
          primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
          tone="warning"
        />
      ) : noMetricsSurfaceAvailable && !canLoadUsageStatsAggregate ? (
        <PageEmptyState
          title="Metrics are disabled for this endpoint"
          description="Both storage metrics and usage logs are disabled for the selected endpoint. Enable at least one capability to restore analytics on this page."
          primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
          tone="warning"
        />
      ) : (
        <>
          {usageStatsConfirmOpen && (
            <ConfirmActionDialog
              title="Recalculate cluster usage composition"
              description="This operation can be costly because it lists object versions across every bucket on the selected Ceph endpoint."
              confirmLabel="Start recalculation"
              cancelLabel="Cancel"
              tone="primary"
              onCancel={() => setUsageStatsConfirmOpen(false)}
              onConfirm={handleConfirmRecalculateUsageStats}
              details={[
                { label: "Endpoint", value: selectedEndpoint?.name ?? `Endpoint ${selectedEndpointId}` },
                {
                  label: "Buckets",
                  value:
                    usageStatsAggregate?.bucket_count != null
                      ? `${usageStatsAggregate.bucket_count} bucket${usageStatsAggregate.bucket_count === 1 ? "" : "s"}`
                      : "Unknown",
                },
              ]}
              impacts={[
                "The calculation may generate significant RGW listing traffic on large or heavily versioned buckets.",
                "If the calculation fails, the latest successful snapshot remains visible.",
              ]}
              warning="Start this only when a fresh cluster-wide logical usage composition is needed."
            />
          )}

          <PageTabs
            tabs={metricsTabs}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as CephAdminMetricsTab)}
            variant="line"
            ariaLabel="Ceph Admin metrics sections"
            idPrefix="ceph-admin-metrics"
          />

          <PageTabPanel idPrefix="ceph-admin-metrics" tabId={activeTab} className="space-y-4 pt-4">
          {activeTab === "storage" ? (
            metricsUnavailableError ? (
              <MetricsUnavailableCard
                eyebrow="RGW metrics"
                title="Storage snapshot"
                description="Aggregated stats across the entire RGW cluster."
                message={metricsUnavailableError}
                tone="warning"
              />
            ) : noMetricsSurfaceAvailable ? (
              <MetricsUnavailableCard
                eyebrow="RGW metrics"
                title="Storage snapshot"
                description="Aggregated stats across the entire RGW cluster."
                message="Both storage metrics and usage logs are disabled for the selected endpoint."
                tone="warning"
              />
            ) : storageDisabledMessage ? (
              <MetricsUnavailableCard
                title="Storage snapshot"
                description="Aggregated stats across the entire RGW cluster."
                message={storageDisabledMessage}
              />
            ) : storageError ? (
              <MetricsUnavailableCard
                title="Storage snapshot"
                description="Aggregated stats across the entire RGW cluster."
                message={storageError}
                tone="error"
              />
            ) : storageFeatureEnabled ? (
              <>
                <MetricsSummaryCard
                  title="Storage snapshot"
                  description="Aggregated stats across the entire RGW cluster."
                  updatedAt={storage?.generated_at}
                >
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
                </MetricsSummaryCard>

                <MetricsCard
                  title="Storage breakdown"
                  description="Top consumers by owner and bucket."
                >
                  <div className="grid gap-6 xl:grid-cols-2">
                    <UsageBreakdown
                      title="Owners (volume)"
                      loading={storageLoading}
                      metric="bytes"
                      items={ownerUsageItems}
                      emptyMessage="No owner volume data available."
                    />
                    <UsageBreakdown
                      title="Owners (objects)"
                      loading={storageLoading}
                      metric="objects"
                      items={ownerUsageItems}
                      emptyMessage="No owner object data available."
                    />
                  </div>
                  <div className="grid gap-6 xl:grid-cols-2">
                    <UsageBreakdown
                      title="Buckets (volume)"
                      loading={storageLoading}
                      metric="bytes"
                      items={bucketUsageItems}
                      emptyMessage="No bucket volume data available."
                    />
                    <UsageBreakdown
                      title="Buckets (objects)"
                      loading={storageLoading}
                      metric="objects"
                      items={bucketUsageItems}
                      emptyMessage="No bucket object data available."
                    />
                  </div>
                </MetricsCard>
              </>
            ) : null
          ) : null}

          {activeTab === "usage-composition" && canLoadUsageStatsAggregate ? usageStatsAggregateSection : null}

          {activeTab === "traffic" && metricsUnavailableError ? (
            <MetricsUnavailableCard
              eyebrow="RGW metrics"
              title="RGW traffic"
              description="Reading cluster-wide RGW logs for the selected window."
              message={metricsUnavailableError}
              tone="warning"
            />
          ) : null}
          {activeTab === "traffic" && !metricsUnavailableError && noMetricsSurfaceAvailable ? (
            <MetricsUnavailableCard
              eyebrow="RGW metrics"
              title="RGW traffic"
              description="Reading cluster-wide RGW logs for the selected window."
              message="Both storage metrics and usage logs are disabled for the selected endpoint."
              tone="warning"
            />
          ) : null}
          {activeTab === "traffic" && !metricsUnavailableError && !noMetricsSurfaceAvailable && trafficDisabledMessage ? (
            <MetricsUnavailableCard
              title="RGW traffic"
              description="Reading cluster-wide RGW logs for the selected window."
              message={trafficDisabledMessage}
            />
          ) : activeTab === "traffic" && !metricsUnavailableError && !noMetricsSurfaceAvailable && usageLogFeatureEnabled ? (
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
          ) : null}
          </PageTabPanel>
        </>
      )}
    </div>
  );
}

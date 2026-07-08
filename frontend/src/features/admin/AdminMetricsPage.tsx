/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAdminUsageStatsAggregate,
  streamAdminUsageStatsAggregate,
  type BucketUsageStatsAggregate,
} from "../../api/bucketUsageStats";
import {
  AdminStats,
  AdminTrafficStats,
  TrafficWindow,
  fetchAdminStorage,
  fetchAdminTraffic,
} from "../../api/stats";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import {
  fetchAdminUsageHistoryTrends,
  type UsageHistoryTrendResponse,
  type UsageHistoryTrendWindow,
} from "../../api/usageHistory";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { MetricsCard } from "../../components/MetricsCard";
import MetricsTrafficOverview, { MetricsSnapshotCard, MetricsSummaryCard } from "../../components/MetricsTrafficOverview";
import MetricsUnavailableCard from "../../components/MetricsUnavailableCard";
import PageControlStrip from "../../components/PageControlStrip";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { adminBreadcrumbs } from "./adminBreadcrumbs";
import UsageBreakdown from "../../components/UsageBreakdown";
import UsageHistoryTrendsSection from "../../components/UsageHistoryTrendsSection";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiDividerClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";

type AdminMetricsTab = "storage" | "usage-composition" | "usage-history" | "traffic";

function extractError(err: unknown, fallback: string): string {
  return extractApiError(err, fallback);
}

export default function AdminMetricsPage() {
  const { generalSettings } = useGeneralSettings();
  const [activeTab, setActiveTab] = useState<AdminMetricsTab>("storage");
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
  const [usageHistoryWindow, setUsageHistoryWindow] = useState<UsageHistoryTrendWindow>("month");
  const [usageHistoryTrends, setUsageHistoryTrends] = useState<UsageHistoryTrendResponse | null>(null);
  const [usageHistoryLoading, setUsageHistoryLoading] = useState<boolean>(false);
  const [usageHistoryError, setUsageHistoryError] = useState<string | null>(null);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsRecalculating, setUsageStatsRecalculating] = useState(false);

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
      } catch (err) {
        if (!cancelled) {
          setEndpoints([]);
          setSelectedEndpointId(null);
          setEndpointError(extractError(err, "Unable to retrieve the endpoint list."));
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
      } catch (err) {
        if (!cancelled) {
          setStorageError(extractError(err, "Unable to load admin storage metrics."));
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
      } catch (err) {
        if (!cancelled) {
          setTrafficError(extractError(err, "Unable to retrieve RGW logs."));
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

  useEffect(() => {
    let cancelled = false;
    async function loadUsageHistoryTrends() {
      if (!generalSettings.usage_history_enabled || endpointLoading) {
        setUsageHistoryTrends(null);
        setUsageHistoryLoading(false);
        setUsageHistoryError(null);
        return;
      }
      if (selectedEndpointId == null) {
        setUsageHistoryTrends(null);
        setUsageHistoryLoading(false);
        return;
      }
      setUsageHistoryTrends(null);
      setUsageHistoryLoading(true);
      setUsageHistoryError(null);
      try {
        const data = await fetchAdminUsageHistoryTrends({
          window: usageHistoryWindow,
          endpointId: selectedEndpointId,
          subjectType: "all",
        });
        if (!cancelled) {
          setUsageHistoryTrends(data);
        }
      } catch (err) {
        if (!cancelled) {
          setUsageHistoryTrends(null);
          setUsageHistoryError(extractError(err, "Unable to load usage history trends."));
        }
      } finally {
        if (!cancelled) {
          setUsageHistoryLoading(false);
        }
      }
    }
    loadUsageHistoryTrends();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, generalSettings.usage_history_enabled, selectedEndpointId, usageHistoryWindow]);

  const loadUsageStatsAggregate = useCallback(async () => {
    if (endpointLoading || selectedEndpointId == null) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      setUsageStatsError(null);
      return;
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const data = await getAdminUsageStatsAggregate(selectedEndpointId);
      setUsageStatsAggregate(data.aggregate);
    } catch (err) {
      setUsageStatsAggregate(null);
      setUsageStatsError(extractError(err, "Unable to load managed accounts usage composition."));
    } finally {
      setUsageStatsLoading(false);
    }
  }, [endpointLoading, selectedEndpointId]);

  useEffect(() => {
    void loadUsageStatsAggregate();
  }, [loadUsageStatsAggregate]);

  const handleRecalculateUsageStats = useCallback(async () => {
    if (selectedEndpointId == null) return;
    setUsageStatsRecalculating(true);
    setUsageStatsError(null);
    try {
      await streamAdminUsageStatsAggregate(selectedEndpointId, { parallelism: 8 });
      await loadUsageStatsAggregate();
    } catch (err) {
      setUsageStatsError(extractError(err, "Unable to recalculate managed accounts usage composition."));
    } finally {
      setUsageStatsRecalculating(false);
    }
  }, [loadUsageStatsAggregate, selectedEndpointId]);

  const storageTotals = storage?.storage_totals;
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

  const missingTraffic = selectedEndpointId != null && !traffic && !trafficLoading && !trafficError;
  const showStorageMetrics = !storageError;
  const showUsageHistoryTrends = Boolean(generalSettings.usage_history_enabled) && selectedEndpointId != null;
  const metricsTabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: "Storage" },
        { id: "usage-composition" as const, label: "Usage composition" },
        ...(showUsageHistoryTrends ? [{ id: "usage-history" as const, label: "Usage history" }] : []),
        { id: "traffic" as const, label: "Traffic" },
      ],
    [showUsageHistoryTrends]
  );
  const usageStatsAggregateSection = (
    <BucketUsageStatsAggregateCard
      title="Managed accounts usage composition"
      description="Latest calculated bucket snapshots for S3 accounts managed by the application on the selected endpoint."
      aggregate={usageStatsAggregate}
      loading={usageStatsLoading}
      error={usageStatsError}
      recalculating={usageStatsRecalculating}
      recalculateLabel="Recalculate endpoint"
      onRecalculate={handleRecalculateUsageStats}
    />
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
        description="Managed account usage composition, platform storage, and traffic analytics."
        breadcrumbs={adminBreadcrumbs({ label: "Overview", to: "/admin" }, { label: "Usage & Metrics" })}
      />
      <PageControlStrip
        label="Metrics scope"
        title={selectedEndpoint?.name ?? (endpointLoading ? "Loading Ceph endpoints..." : "No Ceph endpoint selected")}
        description="Choose the Ceph endpoint used for storage and traffic analytics."
        controls={
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <UiSelect
              label="Ceph endpoint"
              hint="Only Ceph endpoints are eligible for this page."
              value={selectedEndpointId ?? ""}
              onChange={(event) => setSelectedEndpointId(event.target.value ? Number(event.target.value) : null)}
              disabled={endpointLoading || endpoints.length === 0}
              fieldClassName="md:min-w-72"
              size="compact"
            >
              {endpointLoading && <option value="">Loading...</option>}
              {!endpointLoading && endpoints.length === 0 && <option value="">No Ceph endpoint</option>}
              {!endpointLoading &&
                endpoints.map((endpoint) => (
                  <option key={endpoint.id} value={endpoint.id} title={endpoint.endpoint_url}>
                    {endpoint.is_default ? `${endpoint.name} (default)` : endpoint.name}
                  </option>
                ))}
            </UiSelect>
          </div>
        }
        items={[
          { label: "Endpoint URL", value: selectedEndpoint?.endpoint_url ?? "Unavailable", mono: Boolean(selectedEndpoint?.endpoint_url) },
          { label: "Provider", value: selectedEndpoint?.provider?.toUpperCase() ?? "Unavailable" },
          { label: "Selection", value: selectedEndpoint?.is_default ? "Default endpoint" : "Manual selection" },
          { label: "Coverage", value: "Storage totals + RGW traffic" },
        ]}
        alerts={endpointError ? [{ tone: "warning", message: endpointError }] : []}
      />

      {!endpointLoading && selectedEndpointId == null ? (
        <PageEmptyState
          title="No Ceph endpoint available for metrics"
          description={endpointError || "Add or enable a Ceph endpoint before loading platform metrics."}
          primaryAction={{ label: "Open endpoints", to: "/admin/endpoints" }}
          tone="warning"
        />
      ) : null}

      {selectedEndpointId != null && (
        <>
          <div className={cx("border-b pb-3", uiDividerClass)}>
            <PageTabs
              tabs={metricsTabs}
              activeTab={activeTab}
              onChange={(tab) => setActiveTab(tab as AdminMetricsTab)}
              variant="bar"
            />
          </div>

          {activeTab === "storage" ? (
            storageError ? (
              <MetricsUnavailableCard
                title="Storage snapshot"
                description="Aggregated stats across known S3 accounts."
                message={storageError}
                tone="warning"
              />
            ) : (
              <>
                <MetricsSummaryCard
                  title="Storage snapshot"
                  description="Aggregated stats across known S3 accounts."
                  updatedAt={storage?.generated_at}
                >
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricsSnapshotCard
                      label="Stored volume"
                      value={storageTotals?.used_bytes != null ? formatBytes(storageTotals.used_bytes) : "—"}
                      hint="Sum of known buckets"
                      loading={storageLoading}
                    />
                    <MetricsSnapshotCard
                      label="Objects"
                      value={storageTotals?.object_count != null ? formatCompactNumber(storageTotals.object_count) : "—"}
                      hint="Instant count"
                      loading={storageLoading}
                    />
                    <MetricsSnapshotCard
                      label="Visible buckets"
                      value={storageTotals?.bucket_count != null ? formatCompactNumber(storageTotals.bucket_count) : "—"}
                      hint="Based on root credentials"
                      loading={storageLoading}
                    />
                    <MetricsSnapshotCard
                      label="S3 accounts"
                      value={storage ? formatCompactNumber(storage.total_accounts) : "—"}
                      hint={`${formatCompactNumber(storage?.total_s3_users ?? 0)} S3 users`}
                      loading={storageLoading}
                    />
                  </div>
                </MetricsSummaryCard>

                {showStorageMetrics && (
                  <MetricsCard
                    title="Storage breakdown"
                    description="Accounts and S3 users by volume and object count."
                  >
                    <div className="grid gap-6 xl:grid-cols-2">
                      <UsageBreakdown
                        title="Accounts (volume)"
                        loading={storageLoading}
                        metric="bytes"
                        items={accountUsageItems}
                        emptyMessage="No volume data available."
                      />
                      <UsageBreakdown
                        title="Accounts (objects)"
                        loading={storageLoading}
                        metric="objects"
                        items={accountUsageItems}
                        emptyMessage="No object data available."
                      />
                    </div>
                    <div className="grid gap-6 xl:grid-cols-2">
                      <UsageBreakdown
                        title="S3 users (volume)"
                        loading={storageLoading}
                        metric="bytes"
                        items={userUsageItems}
                        emptyMessage="No S3 users with metrics."
                      />
                      <UsageBreakdown
                        title="S3 users (objects)"
                        loading={storageLoading}
                        metric="objects"
                        items={userUsageItems}
                        emptyMessage="No S3 users with metrics."
                      />
                    </div>
                  </MetricsCard>
                )}
              </>
            )
          ) : null}

          {activeTab === "usage-composition" ? usageStatsAggregateSection : null}

          {activeTab === "usage-history" && showUsageHistoryTrends && (
            <UsageHistoryTrendsSection
              trends={usageHistoryTrends}
              window={usageHistoryWindow}
              onWindowChange={setUsageHistoryWindow}
              loading={usageHistoryLoading}
              error={usageHistoryError}
              description="Stored quota snapshots across accounts and S3 users for the selected endpoint."
            />
          )}

          {activeTab === "traffic" ? (
            <MetricsTrafficOverview
              traffic={traffic}
              window={window}
              onWindowChange={setWindow}
              loading={trafficLoading}
              error={trafficError}
              showEmpty={missingTraffic}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

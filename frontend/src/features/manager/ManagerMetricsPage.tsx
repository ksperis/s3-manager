/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getManagerUsageStatsAggregate,
  streamManagerUsageStatsAggregate,
  type BucketUsageStatsAggregate,
} from "../../api/bucketUsageStats";
import {
  fetchManagerUsageHistoryTrends,
  type UsageHistoryTrendResponse,
  type UsageHistoryTrendWindow,
} from "../../api/usageHistory";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageShell from "../../components/PageShell";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";
import MetricsUnavailableCard from "../../components/MetricsUnavailableCard";
import PageEmptyState from "../../components/PageEmptyState";
import UsageBreakdown from "../../components/UsageBreakdown";
import UsageHistoryTrendsSection from "../../components/UsageHistoryTrendsSection";
import { extractApiError } from "../../utils/apiError";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";
import TrafficAnalytics from "./TrafficAnalytics";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerStats } from "./useManagerStats";

type ManagerMetricsTab = "storage" | "usage-composition" | "usage-history" | "traffic";

export default function ManagerMetricsPage() {
  const { generalSettings } = useGeneralSettings();
  const [activeTab, setActiveTab] = useState<ManagerMetricsTab>("storage");
  const {
    accounts,
    selectedS3AccountId,
    hasS3AccountContext,
    requiresS3AccountSelection,
    accountIdForApi,
    accessMode,
    managerStatsEnabled,
    managerStatsMessage,
  } = useS3AccountContext();

  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const hasContext = hasS3AccountContext;
  const endpointCaps = selected?.storage_endpoint_capabilities ?? null;
  const usageFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.metrics !== false : true);
  const metricsFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.usage !== false : true);
  const canLoadUsageStatsAggregate =
    hasContext &&
    Boolean(requiresS3AccountSelection) &&
    Boolean(generalSettings.bucket_usage_stats_enabled);
  const canShowUsageBreakdowns = usageFeatureEnabled && hasContext;
  const showTrafficAnalytics = metricsFeatureEnabled && hasContext;
  const showMetricsDisabledBanner = hasContext && !usageFeatureEnabled && !metricsFeatureEnabled;
  const showUsageDisabledBanner = hasContext && managerStatsEnabled && !usageFeatureEnabled && metricsFeatureEnabled;
  const showTrafficDisabledBanner = hasContext && managerStatsEnabled && usageFeatureEnabled && !metricsFeatureEnabled;
  const managerMetricsMessage =
    hasContext && !managerStatsEnabled
      ? managerStatsMessage || "Metrics are unavailable for this context."
      : null;

  const { stats, loading, error } = useManagerStats(
    accountIdForApi,
    canShowUsageBreakdowns,
    accessMode ?? "default"
  );
  const [usageHistoryWindow, setUsageHistoryWindow] = useState<UsageHistoryTrendWindow>("month");
  const [usageHistoryTrends, setUsageHistoryTrends] = useState<UsageHistoryTrendResponse | null>(null);
  const [usageHistoryLoading, setUsageHistoryLoading] = useState(false);
  const [usageHistoryError, setUsageHistoryError] = useState<string | null>(null);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsRecalculating, setUsageStatsRecalculating] = useState(false);
  const showUsageBreakdowns = canShowUsageBreakdowns && !error;
  const showUsageHistoryTrends =
    Boolean(generalSettings.usage_history_enabled) &&
    hasContext &&
    !managerMetricsMessage &&
    !showMetricsDisabledBanner;
  const showFullPageMetricsUnavailable =
    Boolean(managerMetricsMessage) &&
    !showUsageBreakdowns &&
    !showTrafficAnalytics &&
    !canLoadUsageStatsAggregate;
  const showFullPageMetricsDisabled = showMetricsDisabledBanner && !canLoadUsageStatsAggregate;

  const loadUsageStatsAggregate = useCallback(async () => {
    if (!canLoadUsageStatsAggregate) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      setUsageStatsError(null);
      return;
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const data = await getManagerUsageStatsAggregate(accountIdForApi);
      setUsageStatsAggregate(data.aggregate);
    } catch (err) {
      setUsageStatsAggregate(null);
      setUsageStatsError(extractApiError(err, "Unable to load usage composition."));
    } finally {
      setUsageStatsLoading(false);
    }
  }, [accountIdForApi, canLoadUsageStatsAggregate]);

  useEffect(() => {
    void loadUsageStatsAggregate();
  }, [loadUsageStatsAggregate]);

  const handleRecalculateUsageStats = useCallback(async () => {
    if (!canLoadUsageStatsAggregate) return;
    setUsageStatsRecalculating(true);
    setUsageStatsError(null);
    try {
      await streamManagerUsageStatsAggregate(accountIdForApi, { parallelism: 8 });
      await loadUsageStatsAggregate();
    } catch (err) {
      setUsageStatsError(extractApiError(err, "Unable to recalculate usage composition."));
    } finally {
      setUsageStatsRecalculating(false);
    }
  }, [accountIdForApi, canLoadUsageStatsAggregate, loadUsageStatsAggregate]);

  useEffect(() => {
    if (!showUsageHistoryTrends) {
      setUsageHistoryTrends(null);
      setUsageHistoryLoading(false);
      setUsageHistoryError(null);
      return;
    }
    let cancelled = false;
    setUsageHistoryLoading(true);
    setUsageHistoryError(null);
    fetchManagerUsageHistoryTrends(accountIdForApi, usageHistoryWindow)
      .then((data) => {
        if (!cancelled) setUsageHistoryTrends(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageHistoryTrends(null);
          setUsageHistoryError(extractApiError(err, "Unable to load usage history trends."));
        }
      })
      .finally(() => {
        if (!cancelled) setUsageHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, showUsageHistoryTrends, usageHistoryWindow]);

  const usageStatsAggregateSection = canLoadUsageStatsAggregate ? (
    <BucketUsageStatsAggregateCard
      title="Account usage composition"
      description="Latest calculated bucket snapshots for the active account context."
      aggregate={usageStatsAggregate}
      loading={usageStatsLoading}
      error={usageStatsError}
      recalculating={usageStatsRecalculating}
      recalculateLabel="Recalculate account"
      onRecalculate={handleRecalculateUsageStats}
    />
  ) : null;
  const metricsTabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: "Storage" },
        ...(canLoadUsageStatsAggregate ? [{ id: "usage-composition" as const, label: "Usage composition" }] : []),
        ...(showUsageHistoryTrends ? [{ id: "usage-history" as const, label: "Usage history" }] : []),
        { id: "traffic" as const, label: "Traffic" },
      ],
    [canLoadUsageStatsAggregate, showUsageHistoryTrends]
  );

  useEffect(() => {
    if (!metricsTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(metricsTabs[0]?.id ?? "storage");
    }
  }, [activeTab, metricsTabs]);

  return (
    <PageShell
      title="Usage & Metrics"
      description="Logical usage composition, storage analytics, and traffic analytics for the active execution context."
      breadcrumbs={managerPageBreadcrumbs("metrics")}
    >
      {!hasContext ? (
        <PageEmptyState
          title="Select an account to view usage and metrics"
          description="Usage composition and Manager metrics depend on an execution context. Choose an account to load bucket usage, storage, and traffic analytics."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : showFullPageMetricsUnavailable ? (
        <PageEmptyState
          title="Metrics are unavailable for this context"
          description={managerMetricsMessage ?? "Metrics are unavailable for this context."}
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : showFullPageMetricsDisabled ? (
        <PageEmptyState
          title="Metrics are disabled for this endpoint"
          description="Neither storage analytics nor traffic analytics are enabled on the selected endpoint."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <>
          <PageTabs
            tabs={metricsTabs}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as ManagerMetricsTab)}
            variant="line"
            ariaLabel="Manager metrics sections"
            idPrefix="manager-metrics"
          />

          <PageTabPanel idPrefix="manager-metrics" tabId={activeTab} className="space-y-4 pt-4">
          {activeTab === "storage" ? (
            <>
              {managerMetricsMessage && !showUsageBreakdowns && (
                <MetricsUnavailableCard
                  eyebrow="Metrics"
                  title="Storage analytics"
                  description="Bucket volume and object counts for the active context."
                  message={managerMetricsMessage}
                  tone="warning"
                />
              )}
              {!managerMetricsMessage && showMetricsDisabledBanner && (
                <MetricsUnavailableCard
                  eyebrow="Metrics"
                  title="Storage analytics"
                  description="Bucket volume and object counts for the active context."
                  message="Neither storage analytics nor traffic analytics are enabled on the selected endpoint."
                  tone="warning"
                />
              )}
              {!managerMetricsMessage && !showMetricsDisabledBanner && showUsageDisabledBanner && (
                <MetricsUnavailableCard
                  title="Storage analytics"
                  description="Bucket volume and object counts for the active context."
                  message="Storage analytics are disabled for this endpoint."
                />
              )}
              {!managerMetricsMessage && !showMetricsDisabledBanner && error && (
                <MetricsUnavailableCard
                  title="Storage analytics"
                  description="Bucket volume and object counts for the active context."
                  message={error}
                  tone="error"
                />
              )}
              {!managerMetricsMessage && !showMetricsDisabledBanner && showUsageBreakdowns && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <UsageBreakdown
                    title="Bucket breakdown (storage)"
                    loading={loading}
                    metric="bytes"
                    items={(stats?.bucket_usage ?? []).map((bucket) => ({
                      id: bucket.name,
                      label: bucket.name,
                      usedBytes: bucket.used_bytes ?? null,
                      objectCount: bucket.object_count ?? null,
                    }))}
                    emptyMessage="No bucket storage metrics available."
                  />
                  <UsageBreakdown
                    title="Bucket breakdown (objects)"
                    loading={loading}
                    metric="objects"
                    items={(stats?.bucket_usage ?? []).map((bucket) => ({
                      id: bucket.name,
                      label: bucket.name,
                      usedBytes: bucket.used_bytes ?? null,
                      objectCount: bucket.object_count ?? null,
                    }))}
                    emptyMessage="No bucket object metrics available."
                  />
                </div>
              )}
            </>
          ) : null}

          {activeTab === "usage-composition" && canLoadUsageStatsAggregate ? usageStatsAggregateSection : null}

          {activeTab === "usage-history" && showUsageHistoryTrends && (
            <UsageHistoryTrendsSection
              trends={usageHistoryTrends}
              window={usageHistoryWindow}
              onWindowChange={setUsageHistoryWindow}
              loading={usageHistoryLoading}
              error={usageHistoryError}
              description="Stored usage snapshots for the active execution context."
            />
          )}

          {activeTab === "traffic" && managerMetricsMessage && !showTrafficAnalytics ? (
            <MetricsUnavailableCard
              eyebrow="Metrics"
              title="Traffic"
              description="Ingress/egress volume, request types, and busiest buckets."
              message={managerMetricsMessage}
              tone="warning"
            />
          ) : null}
          {activeTab === "traffic" && !managerMetricsMessage && showMetricsDisabledBanner ? (
            <MetricsUnavailableCard
              eyebrow="Metrics"
              title="Traffic"
              description="Ingress/egress volume, request types, and busiest buckets."
              message="Neither storage analytics nor traffic analytics are enabled on the selected endpoint."
              tone="warning"
            />
          ) : null}
          {activeTab === "traffic" && !managerMetricsMessage && !showMetricsDisabledBanner && showTrafficDisabledBanner ? (
            <MetricsUnavailableCard
              title="Traffic"
              description="Ingress/egress volume, request types, and busiest buckets."
              message="Traffic analytics are disabled for this endpoint."
            />
          ) : null}
          {showTrafficAnalytics && (
            <TrafficAnalytics
              accountId={accountIdForApi}
              enabled={showTrafficAnalytics}
              visible={activeTab === "traffic"}
            />
          )}
          </PageTabPanel>
        </>
      )}
    </PageShell>
  );
}

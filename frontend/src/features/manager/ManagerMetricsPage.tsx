/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  fetchManagerUsageHistoryTrends,
  type UsageHistoryTrendResponse,
  type UsageHistoryTrendWindow,
} from "../../api/usageHistory";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageHeader from "../../components/PageHeader";
import MetricsUnavailableCard from "../../components/MetricsUnavailableCard";
import PageEmptyState from "../../components/PageEmptyState";
import UsageBreakdown from "../../components/UsageBreakdown";
import UsageHistoryTrendsSection from "../../components/UsageHistoryTrendsSection";
import { extractApiError } from "../../utils/apiError";
import TrafficAnalytics from "./TrafficAnalytics";
import { useS3AccountContext } from "./S3AccountContext";
import { useManagerStats } from "./useManagerStats";

export default function ManagerMetricsPage() {
  const { generalSettings } = useGeneralSettings();
  const {
    accounts,
    selectedS3AccountId,
    hasS3AccountContext,
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
  const showUsageBreakdowns = canShowUsageBreakdowns && !error;
  const showUsageHistoryTrends =
    Boolean(generalSettings.usage_history_enabled) &&
    hasContext &&
    !managerMetricsMessage &&
    !showMetricsDisabledBanner;

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Metrics"
        description="Storage and traffic analytics for the active execution context."
        breadcrumbs={[{ label: "Manager" }, { label: "Overview" }, { label: "Metrics" }]}
      />

      {!hasContext ? (
        <PageEmptyState
          title="Select an account to view metrics"
          description="Manager metrics depend on an execution context. Choose an account to load bucket storage and traffic analytics."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : managerMetricsMessage && !showUsageBreakdowns && !showTrafficAnalytics ? (
        <PageEmptyState
          title="Metrics are unavailable for this context"
          description={managerMetricsMessage}
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : showMetricsDisabledBanner ? (
        <PageEmptyState
          title="Metrics are disabled for this endpoint"
          description="Neither storage analytics nor traffic analytics are enabled on the selected endpoint."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <>
          {showUsageDisabledBanner && (
            <MetricsUnavailableCard
              eyebrow="Storage analytics"
              title="Bucket breakdown"
              description="Stored volume and object counts for buckets in the active context."
              message="Storage analytics are disabled for this endpoint."
            />
          )}
          {error && (
            <MetricsUnavailableCard
              eyebrow="Storage analytics"
              title="Bucket breakdown"
              description="Stored volume and object counts for buckets in the active context."
              message={error}
              tone="error"
            />
          )}
          {showUsageBreakdowns && (
            <div className="grid gap-6 lg:grid-cols-2">
              <UsageBreakdown
                title="Bucket breakdown (storage)"
                subtitle="Stored volume per bucket (top 8)."
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
                subtitle="Object counts per bucket (top 8)."
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

          {showUsageHistoryTrends && (
            <UsageHistoryTrendsSection
              trends={usageHistoryTrends}
              window={usageHistoryWindow}
              onWindowChange={setUsageHistoryWindow}
              loading={usageHistoryLoading}
              error={usageHistoryError}
              description="Stored usage snapshots for the active execution context."
            />
          )}

          {showTrafficDisabledBanner && (
            <MetricsUnavailableCard
              eyebrow="Traffic"
              title="Traffic visualization"
              description="Ingress/egress volume, request types, and busiest buckets."
              message="Traffic analytics are disabled for this endpoint."
            />
          )}
          {showTrafficAnalytics && <TrafficAnalytics accountId={accountIdForApi} enabled={showTrafficAnalytics} />}
        </>
      )}
    </div>
  );
}

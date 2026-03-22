/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import UsageBreakdown from "../../components/UsageBreakdown";
import WorkspaceContextStrip from "../../components/WorkspaceContextStrip";
import TrafficAnalytics from "./TrafficAnalytics";
import { useS3AccountContext } from "./S3AccountContext";
import useManagerWorkspaceContextStrip from "./useManagerWorkspaceContextStrip";
import { useManagerStats } from "./useManagerStats";

export default function ManagerMetricsPage() {
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
  const showUsageBreakdowns = usageFeatureEnabled && hasContext;
  const showTrafficAnalytics = metricsFeatureEnabled && hasContext;
  const showMetricsDisabledBanner = hasContext && !usageFeatureEnabled && !metricsFeatureEnabled;
  const showUsageDisabledBanner = hasContext && managerStatsEnabled && !usageFeatureEnabled && metricsFeatureEnabled;
  const showTrafficDisabledBanner = hasContext && managerStatsEnabled && usageFeatureEnabled && !metricsFeatureEnabled;
  const managerMetricsMessage =
    hasContext && !managerStatsEnabled
      ? managerStatsMessage || "Metrics are unavailable for this context."
      : null;
  const contextStrip = useManagerWorkspaceContextStrip({
    description: "Storage and traffic analytics use the selected execution context and the active endpoint capabilities.",
    extraAlerts: managerMetricsMessage ? [{ tone: "warning", message: managerMetricsMessage }] : [],
  });

  const { stats, loading, error } = useManagerStats(
    accountIdForApi,
    showUsageBreakdowns,
    accessMode ?? "default"
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Metrics"
        description="Storage and traffic analytics for the active execution context."
        breadcrumbs={[{ label: "Manager" }, { label: "Overview" }, { label: "Metrics" }]}
      />
      <WorkspaceContextStrip {...contextStrip} />

      {error && <PageBanner tone="error">{error}</PageBanner>}

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
          {showUsageDisabledBanner && <PageBanner tone="info">Storage analytics are disabled for this endpoint.</PageBanner>}
          {showTrafficDisabledBanner && <PageBanner tone="info">Traffic analytics are disabled for this endpoint.</PageBanner>}
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

          {showTrafficAnalytics && <TrafficAnalytics accountId={accountIdForApi} enabled={showTrafficAnalytics} />}
        </>
      )}
    </div>
  );
}

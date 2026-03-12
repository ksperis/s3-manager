/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import UsageBreakdown from "../../components/UsageBreakdown";
import TrafficAnalytics from "./TrafficAnalytics";
import { useS3AccountContext } from "./S3AccountContext";
import { useManagerStats } from "./useManagerStats";

export default function ManagerMetricsPage() {
  const {
    accounts,
    selectedS3AccountId,
    requiresS3AccountSelection,
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
  const managerMetricsMessage =
    hasContext && !managerStatsEnabled
      ? managerStatsMessage || "Metrics are unavailable for this context."
      : null;

  const { stats, loading, error } = useManagerStats(
    accountIdForApi,
    showUsageBreakdowns,
    accessMode ?? "default"
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Metrics"
        breadcrumbs={[{ label: "Manager" }, { label: "Overview" }, { label: "Metrics" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {requiresS3AccountSelection && !selected && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          Select an account to view metrics.
        </div>
      )}

      {managerMetricsMessage && <PageBanner tone="warning">{managerMetricsMessage}</PageBanner>}

      {showMetricsDisabledBanner && !managerMetricsMessage && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          Usage and traffic metrics are disabled for this storage endpoint.
        </div>
      )}

      {hasContext && (
        <>
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

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
    selectedS3AccountType,
    requiresS3AccountSelection,
    hasS3AccountContext,
    accountIdForApi,
    accessMode,
    managerStatsEnabled,
  } = useS3AccountContext();
  const isS3User = selectedS3AccountType === "s3_user";
  const isConnection = selectedS3AccountType === "connection";

  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const hasContext = hasS3AccountContext;
  const endpointCaps = selected?.storage_endpoint_capabilities ?? null;
  const usageFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.usage !== false : true);
  const metricsFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.metrics !== false : true);
  const showUsageBreakdowns = usageFeatureEnabled && hasContext;
  const showTrafficAnalytics = metricsFeatureEnabled && hasContext;
  const showMetricsDisabledBanner = !usageFeatureEnabled && !metricsFeatureEnabled;

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

      {isConnection && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 ui-body text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          Connection context: platform metrics are disabled. Use a platform account with supervision enabled to access usage and traffic analytics.
        </div>
      )}

      {showMetricsDisabledBanner && (
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

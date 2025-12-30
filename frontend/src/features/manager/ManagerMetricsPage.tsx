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

type SessionCapabilities = {
  can_view_traffic?: boolean;
};

function getCapabilities(): SessionCapabilities | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { capabilities?: SessionCapabilities };
    return parsed.capabilities ?? null;
  } catch {
    return null;
  }
}

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
  const capabilities = getCapabilities();
  const isS3User = selectedS3AccountType === "s3_user";
  const metricsAllowed = !isS3User && (managerStatsEnabled ?? capabilities?.can_view_traffic !== false);
  const { stats, loading, error } = useManagerStats(
    metricsAllowed ? accountIdForApi : null,
    metricsAllowed && hasS3AccountContext,
    accessMode ?? "default"
  );

  if (isS3User || !metricsAllowed) {
    return (
      <div className="space-y-4">
      <PageHeader
        title="Metrics"
        breadcrumbs={[{ label: "Manager" }, { label: "Overview" }, { label: "Metrics" }]}
      />
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          {isS3User
            ? "Select an S3 Account (tenant) to access traffic and storage breakdowns."
            : "Connect with account root keys or ask an admin to enable Allow stats for all users to access traffic analytics and bucket usage rankings."}
        </div>
      </div>
    );
  }

  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const hasContext = hasS3AccountContext;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Metrics"
        breadcrumbs={[{ label: "Manager" }, { label: "Overview" }, { label: "Metrics" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {requiresS3AccountSelection && !selected && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          Select an account to view metrics.
        </div>
      )}

      {hasContext && (
        <>
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

          <TrafficAnalytics accountId={accountIdForApi} enabled={metricsAllowed && hasContext} />
        </>
      )}
    </div>
  );
}

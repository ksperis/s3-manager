/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { useS3AccountContext } from "./S3AccountContext";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UsageOverview from "./UsageOverview";
import { useManagerStats } from "./useManagerStats";
import { useIamOverview } from "./useIamOverview";

type SessionCapabilities = {
  can_manage_iam?: boolean;
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

export default function ManagerDashboard() {
  const {
    accounts,
    selectedS3AccountId,
    requiresS3AccountSelection,
    sessionS3AccountName,
    selectedS3AccountType,
    hasS3AccountContext,
    accountIdForApi,
    accessMode,
    managerStatsEnabled,
  } = useS3AccountContext();
  const capabilities = getCapabilities();
  const isS3User = selectedS3AccountType === "s3_user";
  const isConnection = selectedS3AccountType === "connection";
  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const hasContext = hasS3AccountContext;
  const endpointCaps = selected?.storage_endpoint_capabilities ?? null;
  // Usage/traffic stats are a platform/RGW feature. We only enable the widgets when the backend says it is allowed.
  const usageFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.usage !== false : true);
  const { stats, loading, error } = useManagerStats(
    accountIdForApi,
    usageFeatureEnabled && hasContext,
    accessMode ?? "default"
  );
  const canManageIam = !isS3User && !isConnection;
  const { overview: iamOverview, loading: iamLoading, error: iamError } = useIamOverview(
    accountIdForApi,
    canManageIam,
    hasContext,
    accessMode ?? "default"
  );
  const accountLabel = selected?.display_name ?? sessionS3AccountName ?? "RGW session";
  const iamDisabled = isS3User || isConnection;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manager dashboard"
        description={
          usageFeatureEnabled
            ? error || "S3Account-scoped S3 + IAM controls (real-time stats)."
            : "Usage insights disabled for this storage endpoint."
        }
        breadcrumbs={[{ label: "Manager" }, { label: "Dashboard" }]}
      />

      {requiresS3AccountSelection && !selected && (
        <PageBanner tone="warning">Select an account to view metrics.</PageBanner>
      )}

      {hasContext && (
        <>
          <UsageOverview
            accountName={accountLabel}
            storage={{
              used: stats?.total_bytes ?? selected?.used_bytes ?? null,
              quotaBytes:
                selected?.quota_max_size_gb !== undefined && selected?.quota_max_size_gb !== null
                  ? selected.quota_max_size_gb * 1024 ** 3
                  : null,
            }}
            objects={{
              used: stats?.total_objects ?? null,
              quota: selected?.quota_max_objects ?? null,
            }}
            stats={stats}
            statsError={error}
            loading={loading}
            iamDisabled={iamDisabled}
            metricsDisabled={!usageFeatureEnabled}
            iamOverview={iamOverview}
            iamLoading={iamLoading}
            iamError={iamError}
          />

        </>
      )}
    </div>
  );
}

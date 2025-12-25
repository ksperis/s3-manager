/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { useS3AccountContext } from "./S3AccountContext";
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
  } = useS3AccountContext();
  const capabilities = getCapabilities();
  const isS3User = selectedS3AccountType === "s3_user";
  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const hasContext = hasS3AccountContext;
  const metricsAllowed = !isS3User && capabilities?.can_view_traffic !== false;
  const { stats, loading, error } = useManagerStats(
    metricsAllowed ? accountIdForApi : null,
    metricsAllowed && hasContext,
    accessMode ?? "default"
  );
  const canManageIam = !isS3User;
  const { overview: iamOverview, loading: iamLoading, error: iamError } = useIamOverview(
    accountIdForApi,
    canManageIam,
    hasContext,
    accessMode ?? "default"
  );
  const accountLabel = selected?.name ?? sessionS3AccountName ?? "RGW session";
  const iamDisabled = isS3User;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manager dashboard"
        description={
          metricsAllowed
            ? error || "S3Account-scoped S3 + IAM controls (real-time stats)."
            : "Usage insights limited: connect with account root keys for traffic analytics."
        }
        breadcrumbs={[{ label: "Manager" }, { label: "Dashboard" }]}
      />

      {requiresS3AccountSelection && !selected && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          Select an account to view metrics.
        </div>
      )}

      {isS3User && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          Autonomous S3 users have limited insights. IAM widgets and traffic analytics are disabled for this profile.
        </div>
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
            metricsDisabled={!metricsAllowed}
            iamOverview={iamOverview}
            iamLoading={iamLoading}
            iamError={iamError}
          />

        </>
      )}
    </div>
  );
}

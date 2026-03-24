/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { fetchManagerWorkspaceHealthOverview, WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageEmptyState from "../../components/PageEmptyState";
import WorkspaceEndpointHealthCards from "../../components/WorkspaceEndpointHealthCards";
import { useS3AccountContext } from "./S3AccountContext";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UsageOverview from "./UsageOverview";
import { useManagerStats } from "./useManagerStats";
import { useIamOverview } from "./useIamOverview";
import { extractApiError } from "../../utils/apiError";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";

export default function ManagerDashboard() {
  const { generalSettings } = useGeneralSettings();
  const {
    accounts,
    selectedS3AccountId,
    sessionS3AccountName,
    selectedS3AccountType,
    hasS3AccountContext,
    accountIdForApi,
    accessMode,
    managerStatsEnabled,
    managerStatsMessage,
  } = useS3AccountContext();
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const isS3User = selectedS3AccountType === "s3_user";
  const isConnection = selectedS3AccountType === "connection";
  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const hasContext = hasS3AccountContext;
  const endpointCaps = selected?.storage_endpoint_capabilities ?? null;
  const iamFeatureEnabled = endpointCaps ? endpointCaps.iam !== false : true;
  // Usage/traffic stats are backend-driven. We only enable the widgets when the backend says it is allowed.
  const usageFeatureEnabled = Boolean(managerStatsEnabled) && (endpointCaps ? endpointCaps.metrics !== false : true);
  const { stats, loading, error } = useManagerStats(
    accountIdForApi,
    usageFeatureEnabled && hasContext,
    accessMode ?? "default"
  );
  const canManageIam = !isS3User && !isConnection && iamFeatureEnabled;
  const { overview: iamOverview, loading: iamLoading, error: iamError } = useIamOverview(
    accountIdForApi,
    canManageIam,
    hasContext,
    accessMode ?? "default"
  );
  const accountLabel = selected
    ? formatAccountLabel(selected, defaultEndpointId, defaultEndpointName)
    : sessionS3AccountName ?? "S3 session";
  const iamDisabled = isS3User || isConnection || !iamFeatureEnabled;
  const metricsStatusMessage =
    hasContext && !managerStatsEnabled
      ? managerStatsMessage || "Metrics are unavailable for this context."
      : null;
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [workspaceHealthError, setWorkspaceHealthError] = useState<string | null>(null);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled || !hasContext) {
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceHealthLoading(true);
    setWorkspaceHealthError(null);
    fetchManagerWorkspaceHealthOverview(accountIdForApi)
      .then((data) => {
        if (cancelled) return;
        setWorkspaceHealth(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkspaceHealth(null);
        setWorkspaceHealthError(extractApiError(err, "Unable to load endpoint health for this account."));
      })
      .finally(() => {
        if (!cancelled) setWorkspaceHealthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.endpoint_status_enabled, hasContext]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manager dashboard"
        description="Operational overview for the active manager context."
        breadcrumbs={[{ label: "Manager" }, { label: "Dashboard" }]}
      />

      {!hasContext ? (
        <PageEmptyState
          title="Select an account to start"
          description="Manager surfaces stay available, but metrics, IAM data, and bucket actions remain disabled until an execution context is selected."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          secondaryAction={{ label: "Open profile", to: "/manager/profile" }}
          tone="warning"
        />
      ) : null}

      {hasContext && metricsStatusMessage ? <PageBanner tone="warning">{metricsStatusMessage}</PageBanner> : null}

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
          {generalSettings.endpoint_status_enabled && (
            <WorkspaceEndpointHealthCards
              data={workspaceHealth}
              loading={workspaceHealthLoading}
              error={workspaceHealthError}
              title="Endpoint Health"
              showStatusCounters={false}
            />
          )}
        </>
      )}

      {error && <PageBanner tone="error">{error}</PageBanner>}
    </div>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { getPortalBillingMe, type BillingSubjectDetail } from "../../api/billing";
import type { TrafficWindow } from "../../api/stats";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import MetricsTrafficOverview, { MetricsSnapshotCard, MetricsSummaryCard } from "../../components/MetricsTrafficOverview";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import UsageBreakdown from "../../components/UsageBreakdown";
import { cx, uiCardMutedClass, uiDividerClass, uiInputClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import { PortalPageState } from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type PortalUsageTab = "storage" | "storage-spaces" | "traffic" | "billing";

const tabs: { id: PortalUsageTab; label: string }[] = [
  { id: "storage", label: "Storage" },
  { id: "storage-spaces", label: "Storage Spaces" },
  { id: "traffic", label: "Traffic" },
  { id: "billing", label: "Billing" },
];

function currentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function percent(used?: number | null, quota?: number | null): number | null {
  if (used == null || quota == null || quota <= 0) return null;
  return Math.min(100, Math.max(0, (used / quota) * 100));
}

function formatCurrency(value?: number | null, currency?: string | null): string {
  if (value == null) return "-";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || "EUR"}`;
  }
}

export default function PortalUsagePage() {
  const [month, setMonth] = useState(currentMonth());
  const [activeTab, setActiveTab] = useState<PortalUsageTab>("storage");
  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>("week");
  const [billing, setBilling] = useState<BillingSubjectDetail | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingUnavailable, setBillingUnavailable] = useState(false);
  const {
    workspace,
    storageSpaces,
    usage,
    usageLoading,
    usageError,
    traffic,
    trafficLoading,
    trafficError,
    loading,
    error,
    accountError,
    accountLoading,
    hasAccountContext,
    accountIdForApi,
    state,
  } = usePortalWorkspaceData({ includeTraffic: true, trafficWindow });

  useEffect(() => {
    let cancelled = false;
    if (!hasAccountContext || !accountIdForApi || !month) {
      setBilling(null);
      setBillingLoading(false);
      setBillingUnavailable(false);
      return () => {
        cancelled = true;
      };
    }
    setBillingLoading(true);
    setBillingUnavailable(false);
    getPortalBillingMe(month, accountIdForApi)
      .then((data) => {
        if (!cancelled) setBilling(data);
      })
      .catch(() => {
        if (!cancelled) {
          setBilling(null);
          setBillingUnavailable(true);
        }
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, month]);

  const storageBySpace = useMemo(() => {
    const usageSpaces = usage?.storage_spaces ?? [];
    if (usageSpaces.length > 0) {
      return usageSpaces
        .map((space) => ({
          id: space.id,
          name: space.name,
          usedBytes: space.used_bytes ?? null,
          objectCount: space.object_count ?? null,
          quotaBytes: space.quota_max_size_bytes ?? null,
        }))
        .filter((space) => space.usedBytes != null || space.objectCount != null);
    }
    const apiSpaces = storageSpaces ?? [];
    return apiSpaces
      .map((space) => {
        const workspaceSpace = workspace.spaces.find((item) => item.id === space.id);
        return {
          id: space.id,
          name: workspaceSpace?.name ?? space.name,
          usedBytes: space.used_bytes ?? null,
          objectCount: space.object_count ?? null,
          quotaBytes: space.quota_max_size_bytes ?? null,
        };
      })
      .filter((space) => space.usedBytes != null || space.objectCount != null);
  }, [storageSpaces, usage?.storage_spaces, workspace.spaces]);

  const storageSpaceItems = useMemo(
    () =>
      storageBySpace.map((space) => ({
        id: space.id,
        label: space.name,
        usedBytes: space.usedBytes,
        objectCount: space.objectCount,
      })),
    [storageBySpace]
  );

  const totalUsedBytes =
    usage?.used_bytes ??
    (storageBySpace.some((space) => space.usedBytes != null)
      ? storageBySpace.reduce((sum, space) => sum + (space.usedBytes ?? 0), 0)
      : state?.used_bytes ?? workspace.usedBytes ?? null);
  const totalObjects =
    usage?.used_objects ??
    (storageBySpace.some((space) => space.objectCount != null)
      ? storageBySpace.reduce((sum, space) => sum + (space.objectCount ?? 0), 0)
      : state?.used_objects ?? workspace.usedObjects ?? null);
  const quotaBytes = usage?.quota_max_size_bytes ?? state?.quota_max_size_bytes ?? workspace.quotaBytes ?? null;
  const quotaObjects = usage?.quota_max_objects ?? state?.quota_max_objects ?? workspace.quotaObjects ?? null;
  const quotaPercent = percent(totalUsedBytes, quotaBytes);
  const objectQuotaPercent = percent(totalObjects, quotaObjects);
  const storageSpaceCount = workspace.spaces.length || storageSpaces?.length || 0;
  const billingUsage = billing?.usage ?? null;
  const cost = billing?.cost ?? null;
  const billingCoverage = billing?.coverage ?? null;
  const trafficMissing = !traffic && !trafficLoading && !trafficError;

  const billingMonthControl = (
    <label className={cx(uiCardMutedClass, "flex h-9 items-center gap-2 px-3 ui-caption font-semibold", uiMutedTextClass)}>
      <span>Month</span>
      <input
        type="month"
        value={month}
        onChange={(event) => setMonth(event.target.value)}
        className={cx(uiInputClass, "h-6 w-[120px] border-0 bg-transparent p-0 ui-caption font-semibold shadow-none")}
      />
    </label>
  );

  if (accountLoading || loading) {
    return <PortalPageState>Loading analytics...</PortalPageState>;
  }

  if (accountError || error) {
    return <PortalPageState tone="error">{accountError ?? error}</PortalPageState>;
  }

  if (!hasAccountContext) {
    return (
      <div className="space-y-4">
        <PageEmptyState
          title="Select an account to view analytics"
          description="Usage, traffic and billing analytics are attached to your selected portal account."
          tone="warning"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usage & Analytics"
        description="Track storage, traffic, requests and billing for this portal workspace."
        breadcrumbs={[{ label: "Portal" }, { label: "Usage & Analytics" }]}
      />

      <div className={cx("border-b pb-3", uiDividerClass)}>
        <PageTabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={(tab) => setActiveTab(tab as PortalUsageTab)}
          variant="bar"
        />
      </div>

      {activeTab === "storage" ? (
        <MetricsSummaryCard
          title="Storage snapshot"
          description="Current storage, object and quota usage for this portal account."
        >
          {usageError ? (
            <PageBanner tone="warning">Usage data is unavailable from storage metrics. Available workspace data is still shown.</PageBanner>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricsSnapshotCard
              label="Stored volume"
              value={formatBytes(totalUsedBytes)}
              hint={quotaPercent == null ? "Quota unavailable" : `${formatPercentage(quotaPercent)} of quota`}
              loading={usageLoading}
            />
            <MetricsSnapshotCard
              label="Objects"
              value={formatCompactNumber(totalObjects)}
              hint={objectQuotaPercent == null ? (totalObjects == null ? "Unavailable" : "Tracked") : `${formatPercentage(objectQuotaPercent)} of object quota`}
              loading={usageLoading}
            />
            <MetricsSnapshotCard
              label="Storage Spaces"
              value={formatCompactNumber(storageSpaceCount)}
              hint="Visible in this workspace"
              loading={usageLoading}
            />
            <MetricsSnapshotCard
              label="Storage quota"
              value={formatBytes(quotaBytes)}
              hint={quotaBytes == null ? "Unavailable" : `${formatBytes(totalUsedBytes)} used`}
              loading={usageLoading}
            />
          </div>
        </MetricsSummaryCard>
      ) : null}

      {activeTab === "storage-spaces" ? (
        <MetricsCard
          title="Storage Spaces"
          description="Storage and object composition across the Storage Spaces you can access."
        >
          {usageError ? (
            <PageBanner tone="warning">Per-space usage metrics are unavailable. Stored Storage Space metadata is still shown when present.</PageBanner>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-2">
            <UsageBreakdown
              title="Storage Spaces (volume)"
              loading={usageLoading}
              metric="bytes"
              items={storageSpaceItems}
              emptyMessage="No Storage Space volume metrics available."
            />
            <UsageBreakdown
              title="Storage Spaces (objects)"
              loading={usageLoading}
              metric="objects"
              items={storageSpaceItems}
              emptyMessage="No Storage Space object metrics available."
            />
          </div>
        </MetricsCard>
      ) : null}

      {activeTab === "traffic" ? (
        <MetricsTrafficOverview
          title="Traffic"
          traffic={traffic}
          window={trafficWindow}
          onWindowChange={setTrafficWindow}
          loading={trafficLoading}
          error={trafficError}
          showEmpty={trafficMissing}
          description="Uploads, downloads and requests for this portal account."
          bucketRankingTitle="Most active Storage Spaces"
          userRankingTitle="Most active users"
        />
      ) : null}

      {activeTab === "billing" ? (
        <MetricsCard
          title="Billing"
          description="Estimated monthly usage and cost for this portal account."
          actions={billingMonthControl}
        >
          {billingLoading && !billing ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricsSnapshotCard label="Estimated cost" value="-" loading />
              <MetricsSnapshotCard label="Average storage" value="-" loading />
              <MetricsSnapshotCard label="Requests" value="-" loading />
              <MetricsSnapshotCard label="Coverage" value="-" loading />
            </div>
          ) : billing ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricsSnapshotCard
                  label="Estimated cost"
                  value={formatCurrency(cost?.total_cost, cost?.currency)}
                  hint={cost?.currency ?? "Billing currency"}
                  loading={billingLoading}
                />
                <MetricsSnapshotCard
                  label="Average storage"
                  value={formatBytes(billing.storage.avg_bytes)}
                  hint={`${formatCompactNumber(billing.storage.total_objects)} objects`}
                  loading={billingLoading}
                />
                <MetricsSnapshotCard
                  label="Requests"
                  value={formatCompactNumber(billingUsage?.ops_total)}
                  hint={`${formatBytes(billingUsage?.bytes_out)} out, ${formatBytes(billingUsage?.bytes_in)} in`}
                  loading={billingLoading}
                />
                <MetricsSnapshotCard
                  label="Coverage"
                  value={billingCoverage ? `${billingCoverage.days_collected}/${billingCoverage.days_in_month} days` : "-"}
                  hint={billingCoverage ? formatPercentage(billingCoverage.coverage_ratio * 100) : "Unavailable"}
                  loading={billingLoading}
                />
              </div>
              <div className={cx(uiCardMutedClass, "px-4 py-3")}>
                <p className={cx("ui-caption font-semibold", uiMutedTextClass)}>Rate card</p>
                <p className={cx("ui-body font-semibold", uiTitleTextClass)}>
                  {cost?.rate_card_name ? cost.rate_card_name : "No rate card attached."}
                </p>
              </div>
            </>
          ) : (
            <MetricsEmptyState>
              {billingUnavailable ? "Billing source is disabled or unavailable." : "No billing source data available."}
            </MetricsEmptyState>
          )}
        </MetricsCard>
      ) : null}
    </div>
  );
}

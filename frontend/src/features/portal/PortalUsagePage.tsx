/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { getPortalBillingMe, type BillingSubjectDetail } from "../../api/billing";
import type { BucketUsageStatsAggregate } from "../../api/bucketUsageStats";
import { fetchPortalUsageHistoryTrends, getPortalUsageStatsAggregate } from "../../api/portal";
import type { TrafficWindow } from "../../api/stats";
import type { UsageHistoryTrendResponse, UsageHistoryTrendWindow } from "../../api/usageHistory";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import MetricsTrafficOverview, { MetricsSnapshotCard, MetricsSummaryCard } from "../../components/MetricsTrafficOverview";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import UsageBreakdown from "../../components/UsageBreakdown";
import UsageHistoryTrendsSection from "../../components/UsageHistoryTrendsSection";
import { cx, uiCardMutedClass, uiDividerClass, uiInputClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import BucketUsageStatsAggregateCard from "../shared/BucketUsageStatsAggregateCard";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { PortalPageState } from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type PortalUsageTab = "storage" | "storage-spaces" | "usage-composition" | "usage-history" | "traffic" | "billing";

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
  const { generalSettings } = useGeneralSettings();
  const [month, setMonth] = useState(currentMonth());
  const [activeTab, setActiveTab] = useState<PortalUsageTab>("storage");
  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>("week");
  const [usageHistoryWindow, setUsageHistoryWindow] = useState<UsageHistoryTrendWindow>("month");
  const [billing, setBilling] = useState<BillingSubjectDetail | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingUnavailable, setBillingUnavailable] = useState(false);
  const [usageStatsAggregate, setUsageStatsAggregate] = useState<BucketUsageStatsAggregate | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageHistoryTrends, setUsageHistoryTrends] = useState<UsageHistoryTrendResponse | null>(null);
  const [usageHistoryLoading, setUsageHistoryLoading] = useState(false);
  const [usageHistoryError, setUsageHistoryError] = useState<string | null>(null);
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

  const tabs = useMemo(
    () =>
      [
        { id: "storage" as const, label: "Storage" },
        { id: "storage-spaces" as const, label: "Storage Spaces" },
        ...(generalSettings.bucket_usage_stats_enabled ? [{ id: "usage-composition" as const, label: "Usage composition" }] : []),
        ...(generalSettings.usage_history_enabled ? [{ id: "usage-history" as const, label: "Usage history" }] : []),
        { id: "traffic" as const, label: "Traffic" },
        { id: "billing" as const, label: "Billing" },
      ],
    [generalSettings.bucket_usage_stats_enabled, generalSettings.usage_history_enabled]
  );

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0]?.id ?? "storage");
    }
  }, [activeTab, tabs]);

  useEffect(() => {
    let cancelled = false;
    if (!generalSettings.bucket_usage_stats_enabled || !hasAccountContext || !accountIdForApi) {
      setUsageStatsAggregate(null);
      setUsageStatsLoading(false);
      setUsageStatsError(null);
      return () => {
        cancelled = true;
      };
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    getPortalUsageStatsAggregate(accountIdForApi)
      .then((data) => {
        if (!cancelled) setUsageStatsAggregate(data.aggregate);
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageStatsAggregate(null);
          setUsageStatsError(extractApiError(err, "Unable to load usage composition."));
        }
      })
      .finally(() => {
        if (!cancelled) setUsageStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.bucket_usage_stats_enabled, hasAccountContext]);

  useEffect(() => {
    let cancelled = false;
    if (!generalSettings.usage_history_enabled || !hasAccountContext || !accountIdForApi) {
      setUsageHistoryTrends(null);
      setUsageHistoryLoading(false);
      setUsageHistoryError(null);
      return () => {
        cancelled = true;
      };
    }
    setUsageHistoryLoading(true);
    setUsageHistoryError(null);
    fetchPortalUsageHistoryTrends(accountIdForApi, usageHistoryWindow)
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
  }, [accountIdForApi, generalSettings.usage_history_enabled, hasAccountContext, usageHistoryWindow]);

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
        breadcrumbs={portalBreadcrumbs({ label: "Usage & Analytics" })}
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

      {activeTab === "usage-composition" ? (
        <BucketUsageStatsAggregateCard
          title="Usage composition"
          description="Latest calculated usage composition for the Storage Spaces visible in this portal account."
          aggregate={usageStatsAggregate}
          loading={usageStatsLoading}
          error={usageStatsError}
          recalculateLabel="Recalculate"
          coverageItemLabel="Storage Spaces"
          emptyTitle="No usage composition snapshots yet."
          emptyDescription="Snapshots are produced by the platform usage collection; no portal action is required."
        />
      ) : null}

      {activeTab === "usage-history" ? (
        <UsageHistoryTrendsSection
          trends={usageHistoryTrends}
          window={usageHistoryWindow}
          onWindowChange={setUsageHistoryWindow}
          loading={usageHistoryLoading}
          error={usageHistoryError}
          description="Stored usage snapshots for the selected portal account."
        />
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

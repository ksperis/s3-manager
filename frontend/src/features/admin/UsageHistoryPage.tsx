/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  collectUsageHistory,
  listUsageHistory,
  type UsageHistoryGranularity,
  type UsageHistoryRecord,
  type UsageHistoryResponse,
  type UsageHistorySortBy,
  type UsageHistorySortDir,
  type UsageHistorySubjectType,
} from "../../api/usageHistory";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageControlStrip from "../../components/PageControlStrip";
import PageHeader from "../../components/PageHeader";
import { adminBreadcrumbs } from "./adminBreadcrumbs";
import StatCards from "../../components/StatCards";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  toolbarCompactButtonClasses,
  toolbarCompactInputClasses,
  toolbarCompactSelectClasses,
} from "../../components/toolbarControlClasses";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { RefreshIcon } from "../browser/browserIcons";
import FeatureDisabledPage from "../shared/FeatureDisabledPage";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";

const SUBJECT_TYPES: Array<{ value: UsageHistorySubjectType; label: string }> = [
  { value: "all", label: "All subjects" },
  { value: "account", label: "RGW Accounts" },
  { value: "s3_user", label: "RGW Users" },
];

const SORT_OPTIONS: Array<{ value: UsageHistorySortBy; label: string }> = [
  { value: "period", label: "Period" },
  { value: "subject", label: "Subject" },
  { value: "used_bytes", label: "Storage" },
  { value: "used_objects", label: "Objects" },
  { value: "ratio", label: "Quota ratio" },
];

function dateDaysAgo(days: number): string {
  const now = new Date();
  const value = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function todayDate(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSubjectType(value: UsageHistoryRecord["subject_type"]): string {
  return value === "account" ? "Account" : "S3 user";
}

function collectionMessage(result: Awaited<ReturnType<typeof collectUsageHistory>>): string {
  if (result.status === "skipped" && result.reason) {
    return result.reason;
  }
  const processed = result.subjects_processed ?? 0;
  const hourly = result.history_hourly_upserts ?? 0;
  const daily = result.history_daily_upserts ?? 0;
  return `Collection completed: ${processed} subject${processed === 1 ? "" : "s"} processed, ${hourly} hourly and ${daily} daily snapshot${daily === 1 ? "" : "s"}.`;
}

function describeCollectionIssue(issue: unknown, fallback: string): string {
  if (typeof issue === "string") return issue;
  if (issue && typeof issue === "object") {
    const record = issue as Record<string, unknown>;
    const detail = record.error ?? record.warning ?? record.message;
    if (detail != null) return String(detail);
  }
  if (issue != null) return String(issue);
  return fallback;
}

function collectionIssueMessage(kind: "error" | "warning", issues?: unknown[]): string | null {
  if (!issues?.length) return null;
  const first = describeCollectionIssue(issues[0], `Unknown ${kind}`);
  const label = kind === "error" ? "error" : "warning";
  return `Collection finished with ${issues.length} ${label}${issues.length === 1 ? "" : "s"}. First ${label}: ${first}`;
}

const historyTableColumns: Array<DataTableColumn<UsageHistoryRecord, UsageHistorySortBy>> = [
  {
    id: "period",
    label: "Period",
    field: "period",
    primary: true,
    render: (item) => (
      <>
        <div className={cx("font-medium", uiTitleTextClass)}>{formatDateTime(item.period_start)}</div>
        <div className={cx("ui-caption", uiMutedTextClass)}>{item.granularity}</div>
      </>
    ),
  },
  {
    id: "endpoint",
    label: "Endpoint",
    render: (item) => (
      <>
        <div className={cx("font-medium", uiTitleTextClass)}>{item.endpoint_name}</div>
        <div className={cx("ui-caption", uiMutedTextClass)}>#{item.storage_endpoint_id}</div>
      </>
    ),
  },
  {
    id: "subject",
    label: "Subject",
    field: "subject",
    render: (item) => (
      <>
        <div className={cx("font-medium", uiTitleTextClass)}>{item.subject_name}</div>
        <div className={cx("ui-caption", uiMutedTextClass)}>
          {formatSubjectType(item.subject_type)}
          {item.subject_identifier ? ` - ${item.subject_identifier}` : ""}
        </div>
      </>
    ),
  },
  {
    id: "storage",
    label: "Storage",
    field: "used_bytes",
    render: (item) => (
      <>
        <div className={cx("font-medium", uiTitleTextClass)}>{formatBytes(item.used_bytes)}</div>
        {item.quota_size_bytes != null ? (
          <div className={cx("ui-caption", uiMutedTextClass)}>Quota {formatBytes(item.quota_size_bytes)}</div>
        ) : null}
      </>
    ),
  },
  {
    id: "objects",
    label: "Objects",
    field: "used_objects",
    render: (item) => (
      <>
        <div className={cx("font-medium", uiTitleTextClass)}>{formatCompactNumber(item.used_objects)}</div>
        {item.quota_objects != null ? (
          <div className={cx("ui-caption", uiMutedTextClass)}>Quota {formatCompactNumber(item.quota_objects)}</div>
        ) : null}
      </>
    ),
  },
  {
    id: "ratio",
    label: "Quota ratio",
    field: "ratio",
    render: (item) => formatPercentage(item.usage_ratio_pct),
  },
  {
    id: "samples",
    label: "Samples",
    align: "right",
    render: (item) => item.samples_count ?? (item.granularity === "hourly" ? "1" : "-"),
  },
  {
    id: "collected",
    label: "Collected",
    render: (item) => formatDateTime(item.collected_at),
  },
];

export default function UsageHistoryPage() {
  const { generalSettings } = useGeneralSettings();
  const [granularity, setGranularity] = useState<UsageHistoryGranularity>("daily");
  const [subjectType, setSubjectType] = useState<UsageHistorySubjectType>("all");
  const [sortBy, setSortBy] = useState<UsageHistorySortBy>("period");
  const [sortDir, setSortDir] = useState<UsageHistorySortDir>("desc");
  const [startDate, setStartDate] = useState<string>(dateDaysAgo(14));
  const [endDate, setEndDate] = useState<string>(todayDate());
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [endpointsLoading, setEndpointsLoading] = useState(false);
  const [endpointsError, setEndpointsError] = useState<string | null>(null);

  const [history, setHistory] = useState<UsageHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [collectLoading, setCollectLoading] = useState(false);
  const [collectSuccess, setCollectSuccess] = useState<string | null>(null);
  const [collectWarning, setCollectWarning] = useState<string | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEndpoints() {
      if (!generalSettings.usage_history_enabled) return;
      setEndpointsLoading(true);
      setEndpointsError(null);
      try {
        const data = await listStorageEndpoints();
        if (!cancelled) {
          setEndpoints(data);
        }
      } catch (err) {
        if (!cancelled) {
          setEndpoints([]);
          setEndpointsError(extractApiError(err, "Unable to load endpoints."));
        }
      } finally {
        if (!cancelled) {
          setEndpointsLoading(false);
        }
      }
    }
    void loadEndpoints();
    return () => {
      cancelled = true;
    };
  }, [generalSettings.usage_history_enabled]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      if (!generalSettings.usage_history_enabled) return;
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const data = await listUsageHistory({
          granularity,
          endpointId: selectedEndpointId,
          subjectType,
          start: startDate,
          end: endDate,
          page: 1,
          pageSize: 100,
          sortBy,
          sortDir,
        });
        if (!cancelled) {
          setHistory(data);
        }
      } catch (err) {
        if (!cancelled) {
          setHistory(null);
          setHistoryError(extractApiError(err, "Unable to load usage history."));
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [
    endDate,
    generalSettings.usage_history_enabled,
    granularity,
    reloadToken,
    selectedEndpointId,
    sortBy,
    sortDir,
    startDate,
    subjectType,
  ]);

  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null,
    [endpoints, selectedEndpointId]
  );

  const stats = useMemo(
    () => [
      {
        label: "Snapshots",
        value: formatCompactNumber(history?.summary.total_records ?? 0),
        hint: `${granularity === "daily" ? "Daily" : "Hourly"} records in range`,
      },
      {
        label: "Subjects",
        value: formatCompactNumber(history?.summary.subjects_count ?? 0),
        hint: "Distinct accounts and users",
      },
      {
        label: "Latest collection",
        value: formatDateTime(history?.summary.latest_collected_at),
        hint: "Most recent stored snapshot",
      },
      {
        label: "Max quota ratio",
        value: formatPercentage(history?.summary.max_usage_ratio_pct),
        hint: "Highest recorded usage ratio",
      },
    ],
    [granularity, history]
  );

  const tableStatus = resolveListTableStatus({
    loading: historyLoading,
    error: historyError,
    rowCount: history?.items.length ?? 0,
  });

  async function handleCollect() {
    setCollectLoading(true);
    setCollectSuccess(null);
    setCollectWarning(null);
    setCollectError(null);
    try {
      const result = await collectUsageHistory();
      const message = collectionMessage(result);
      const errorMessage = collectionIssueMessage("error", result.errors);
      const warningMessage = collectionIssueMessage("warning", result.warnings);
      if (errorMessage) {
        setCollectError(`${message} ${errorMessage}`);
      } else {
        setCollectSuccess(message);
        setCollectWarning(warningMessage);
      }
      setReloadToken((current) => current + 1);
    } catch (err) {
      setCollectError(extractApiError(err, "Unable to trigger usage history collection."));
    } finally {
      setCollectLoading(false);
    }
  }

  function handleTableSort(field: UsageHistorySortBy) {
    if (field === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("desc");
  }

  if (!generalSettings.usage_history_enabled) {
    return <FeatureDisabledPage feature="Usage history" />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usage history"
        description="Stored quota usage snapshots collected for RGW accounts and users."
        breadcrumbs={adminBreadcrumbs({ label: "Audit & Reporting" }, { label: "Usage history" })}
        rightContent={
          <button
            type="button"
            onClick={() => void handleCollect()}
            disabled={collectLoading}
            className={cx(uiButtonBaseClass, uiButtonVariants.primary, "h-8 gap-2 px-3 py-1.5 text-xs")}
          >
            <RefreshIcon className={cx("h-3.5 w-3.5", collectLoading && "animate-spin")} />
            {collectLoading ? "Collecting..." : "Collect usage"}
          </button>
        }
      />

      <PageControlStrip
        label="History scope"
        title={selectedEndpoint?.name ?? "All endpoints"}
        description="Filter the stored usage snapshots. Daily rows keep the latest usage for each day; hourly rows keep the exact collected quotas."
        controls={
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 ui-caption text-[var(--ui-text-muted)]">
              Granularity
              <select
                value={granularity}
                onChange={(event) => setGranularity(event.target.value as UsageHistoryGranularity)}
                className={toolbarCompactSelectClasses}
              >
                <option value="daily">Daily</option>
                <option value="hourly">Hourly</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption text-[var(--ui-text-muted)]">
              Endpoint
              <select
                value={selectedEndpointId ?? ""}
                onChange={(event) => setSelectedEndpointId(event.target.value ? Number(event.target.value) : null)}
                className={toolbarCompactSelectClasses}
                disabled={endpointsLoading}
              >
                <option value="">{endpointsLoading ? "Loading..." : "All endpoints"}</option>
                {endpoints.map((endpoint) => (
                  <option key={endpoint.id} value={endpoint.id}>
                    {endpoint.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption text-[var(--ui-text-muted)]">
              Subject
              <select
                value={subjectType}
                onChange={(event) => setSubjectType(event.target.value as UsageHistorySubjectType)}
                className={toolbarCompactSelectClasses}
              >
                {SUBJECT_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption text-[var(--ui-text-muted)]">
              Start
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className={toolbarCompactInputClasses}
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption text-[var(--ui-text-muted)]">
              End
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className={toolbarCompactInputClasses}
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption text-[var(--ui-text-muted)]">
              Sort by
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as UsageHistorySortBy)}
                className={toolbarCompactSelectClasses}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption text-[var(--ui-text-muted)]">
              Direction
              <select
                value={sortDir}
                onChange={(event) => setSortDir(event.target.value as UsageHistorySortDir)}
                className={toolbarCompactSelectClasses}
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
            <button
              type="button"
              className={toolbarCompactButtonClasses}
              onClick={() => setReloadToken((current) => current + 1)}
              disabled={historyLoading}
            >
              Refresh
            </button>
          </div>
        }
        items={[
          { label: "Endpoint URL", value: selectedEndpoint?.endpoint_url ?? "All endpoint data", mono: Boolean(selectedEndpoint?.endpoint_url) },
          { label: "Granularity", value: granularity === "daily" ? "Daily snapshots" : "Hourly snapshots" },
          { label: "Subject type", value: SUBJECT_TYPES.find((option) => option.value === subjectType)?.label ?? subjectType },
          { label: "Range", value: `${startDate || "-"} to ${endDate || "-"}` },
        ]}
        alerts={endpointsError ? [{ tone: "warning", message: endpointsError }] : []}
      />

      {collectSuccess ? <PageBanner tone="success">{collectSuccess}</PageBanner> : null}
      {collectWarning ? <PageBanner tone="warning">{collectWarning}</PageBanner> : null}
      {collectError ? <PageBanner tone="error">{collectError}</PageBanner> : null}
      {historyError ? <PageBanner tone="error">{historyError}</PageBanner> : null}

      <StatCards stats={stats} columns={4} />

      <section className="ui-surface-card">
        <ListToolbar
          title="Snapshots"
          description="Usage history rows stored by the quota monitor."
          countLabel={`${history?.total ?? 0} record${history?.total === 1 ? "" : "s"}`}
        />
        <DataTableShell
          columns={historyTableColumns}
          rows={history?.items ?? []}
          rowKey={(item) => `${item.granularity}-${item.id}`}
          status={tableStatus}
          loadingMessage="Loading usage history..."
          errorMessage="Unable to load usage history."
          emptyMessage="No usage history for this scope."
          primaryColumnId="period"
          sort={{
            field: sortBy,
            direction: sortDir,
            onSort: handleTableSort,
          }}
          responsiveCards
          tableClassName="compact-table"
          rowClassName="bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50"
        />
      </section>
    </div>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import PageShell from "../../components/PageShell";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import PageControlStrip from "../../components/PageControlStrip";
import PageEmptyState from "../../components/PageEmptyState";
import StatCards from "../../components/StatCards";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiCardMutedClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { triggerBlobDownload } from "../../utils/download";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import { DownloadIcon, RefreshIcon } from "../browser/browserIcons";
import {
  BillingSubjectDetail,
  BillingSubjectSummary,
  BillingSummary,
  getBillingSubjectDetail,
  getBillingSubjects,
  getBillingSummary,
  downloadBillingCsv,
  collectBillingDaily,
} from "../../api/billing";

// QA checklist:
// - Verify summary loads with selected month/endpoint.
// - Select account and user subjects, check table values.
// - Click a row and confirm daily charts render.
// - Export CSV and validate content.

const SUBJECT_TYPES = [
  { value: "account", label: "RGW Accounts" },
  { value: "s3_user", label: "RGW Users" },
] as const;

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "cost", label: "Cost" },
  { value: "egress", label: "Egress" },
  { value: "storage", label: "Storage" },
  { value: "requests", label: "Requests" },
] as const;
type BillingSortBy = (typeof SORT_OPTIONS)[number]["value"];

function currentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function defaultCollectDay(): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

function formatCurrency(value?: number | null, currency?: string | null): string {
  if (value === undefined || value === null) return "-";
  const code = currency || "EUR";
  return `${value.toFixed(2)} ${code}`;
}

function formatCoverage(coverage?: BillingSummary["coverage"] | BillingSubjectDetail["coverage"] | null): string {
  if (!coverage) return "-";
  return `${Math.round(coverage.coverage_ratio * 100)}% (${coverage.days_collected}/${coverage.days_in_month} days)`;
}

function formatCoverageBreakdown(coverage?: BillingSummary["coverage"] | BillingSubjectDetail["coverage"] | null): string {
  if (!coverage) return "Coverage unavailable";
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return `Storage ${storageDays}d · Usage ${usageDays}d`;
}

function hasPartialBillingSources(coverage?: BillingSummary["coverage"] | BillingSubjectDetail["coverage"] | null): boolean {
  if (!coverage) return false;
  const storageDays = coverage.storage_days_collected ?? coverage.days_collected;
  const usageDays = coverage.usage_days_collected ?? coverage.days_collected;
  return storageDays !== usageDays;
}

function isLowCoverage(coverage?: BillingSummary["coverage"] | BillingSubjectDetail["coverage"] | null): boolean {
  return Boolean(coverage && coverage.days_collected > 0 && coverage.coverage_ratio < 0.8);
}

function extractCollectionErrors(result: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const errors = result?.errors;
  return Array.isArray(errors) ? errors.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")) : [];
}

function formatCollectionResult(result: Record<string, unknown> | null, day: string): string | null {
  if (!result) return null;
  const endpoints = Number(result.endpoints ?? 0);
  const storageRecords = Number(result.storage_records ?? 0);
  const usageRecords = Number(result.usage_records ?? 0);
  const errors = extractCollectionErrors(result).length;
  const prefix = errors > 0 ? "Collection finished with issues" : "Collection completed";
  return `${prefix} for ${day}: ${endpoints} endpoint${endpoints === 1 ? "" : "s"}, ${storageRecords} storage record${storageRecords === 1 ? "" : "s"}, ${usageRecords} usage record${usageRecords === 1 ? "" : "s"}, ${errors} error${errors === 1 ? "" : "s"}.`;
}

function isBillingDisabledMessage(message: string): boolean {
  return message.toLowerCase().includes("billing is disabled");
}

export default function BillingPage() {
  const [month, setMonth] = useState<string>(currentMonth());
  const [collectDay, setCollectDay] = useState<string>(defaultCollectDay());
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [subjectType, setSubjectType] = useState<"account" | "s3_user">("account");
  const [sortBy, setSortBy] = useState<BillingSortBy>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [reloadToken, setReloadToken] = useState(0);

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);

  const [subjects, setSubjects] = useState<BillingSubjectSummary[]>([]);
  const [subjectsTotal, setSubjectsTotal] = useState<number>(0);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [subjectsLoading, setSubjectsLoading] = useState<boolean>(false);

  const [detail, setDetail] = useState<BillingSubjectDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  const [pageError, setPageError] = useState<string | null>(null);
  const [billingDisabled, setBillingDisabled] = useState<boolean>(false);
  const [collectLoading, setCollectLoading] = useState<boolean>(false);
  const [collectMessage, setCollectMessage] = useState<string | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [collectResult, setCollectResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEndpoints() {
      try {
        const data = await listStorageEndpoints();
        if (cancelled) return;
        const cephEndpoints = data.filter((endpoint) => endpoint.provider === "ceph");
        setEndpoints(cephEndpoints);
        if (cephEndpoints.length === 0) {
          setSelectedEndpointId(null);
          setPageError("No Ceph endpoint available for billing.");
        } else {
          const preferred = cephEndpoints.find((ep) => ep.is_default) || cephEndpoints[0];
          setSelectedEndpointId((current) => current ?? preferred.id);
          setPageError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setEndpoints([]);
          setSelectedEndpointId(null);
          setPageError(extractApiError(err, "Unable to retrieve the endpoint list."));
        }
      }
    }
    loadEndpoints();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      if (!selectedEndpointId) {
        setSummary(null);
        return;
      }
      setSummaryLoading(true);
      setSummaryError(null);
      setBillingDisabled(false);
      try {
        const data = await getBillingSummary(month, selectedEndpointId);
        if (!cancelled) {
          setSummary(data);
        }
      } catch (err) {
        if (!cancelled) {
          const message = extractApiError(err, "Unable to load billing summary.");
          setSummary(null);
          setSummaryError(message);
          setBillingDisabled(isBillingDisabledMessage(message));
        }
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      }
    }
    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [month, selectedEndpointId, reloadToken]);

  useEffect(() => {
    setPage(1);
    setDetail(null);
    setDetailError(null);
  }, [month, selectedEndpointId, subjectType, sortBy, sortDir]);

  useEffect(() => {
    let cancelled = false;
    async function loadSubjects() {
      if (!selectedEndpointId) {
        setSubjects([]);
        setSubjectsTotal(0);
        return;
      }
      setSubjectsLoading(true);
      setSubjectsError(null);
      try {
        const data = await getBillingSubjects(month, selectedEndpointId, subjectType, page, pageSize, sortBy, sortDir);
        if (!cancelled) {
          setSubjects(data.items);
          setSubjectsTotal(data.total);
        }
      } catch (err) {
        if (!cancelled) {
          setSubjects([]);
          setSubjectsTotal(0);
          setSubjectsError(extractApiError(err, "Unable to load billing subjects."));
        }
      } finally {
        if (!cancelled) {
          setSubjectsLoading(false);
        }
      }
    }
    loadSubjects();
    return () => {
      cancelled = true;
    };
  }, [month, page, pageSize, selectedEndpointId, subjectType, sortBy, sortDir, reloadToken]);

  useEffect(() => {
    if (!subjects.length) {
      setDetail(null);
    }
  }, [subjects]);

  const detailSubjectId = detail?.subject_id ?? null;
  const detailSubjectType = detail?.subject_type ?? null;

  useEffect(() => {
    if (detailSubjectId == null || !detailSubjectType || !selectedEndpointId) {
      return;
    }
    const endpointId = selectedEndpointId;
    const subjectType = detailSubjectType as "account" | "s3_user";
    const subjectId = detailSubjectId;
    let cancelled = false;
    async function reloadDetail() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const data = await getBillingSubjectDetail(
          month,
          endpointId,
          subjectType,
          subjectId
        );
        if (!cancelled) {
          setDetail(data);
        }
      } catch (err) {
        if (!cancelled) {
          setDetailError(extractApiError(err, "Unable to load billing detail."));
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }
    reloadDetail();
    return () => {
      cancelled = true;
    };
  }, [detailSubjectId, detailSubjectType, month, selectedEndpointId, reloadToken]);

  const stats = useMemo(() => {
    const storageAvg = summary?.storage?.avg_bytes ?? null;
    const egress = summary?.usage?.bytes_out ?? null;
    const ingress = summary?.usage?.bytes_in ?? null;
    const requests = summary?.usage?.ops_total ?? null;
    const coverage = summary?.coverage?.coverage_ratio ?? null;
    return [
      {
        label: "Avg storage",
        value: storageAvg !== null ? formatBytes(storageAvg) : "-",
        hint: "Average daily storage",
      },
      {
        label: "Egress",
        value: egress !== null ? formatBytes(egress) : "-",
        hint: "Outgoing bytes",
      },
      {
        label: "Ingress",
        value: ingress !== null ? formatBytes(ingress) : "-",
        hint: "Incoming bytes",
      },
      {
        label: "Requests",
        value: requests != null ? formatCompactNumber(requests) : "-",
        hint: "Total API calls",
      },
      {
        label: "Coverage",
        value: coverage != null ? `${Math.round(coverage * 100)}%` : "-",
        hint: formatCoverageBreakdown(summary?.coverage),
      },
      {
        label: "Estimated cost",
        value: summary?.cost?.total_cost != null ? formatCurrency(summary.cost.total_cost, summary.cost.currency) : "-",
        hint: summary?.cost?.rate_card_name ? `Rate card: ${summary.cost.rate_card_name}` : "No rate card",
      },
    ];
  }, [summary]);

  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null,
    [endpoints, selectedEndpointId]
  );
  const hasBillingData = Boolean(summary && (summary.coverage.days_collected > 0 || subjectsTotal > 0));
  const canExport = Boolean(selectedEndpointId && hasBillingData && !summaryLoading && !subjectsLoading && !billingDisabled);
  const canCollect = Boolean(collectDay && !collectLoading && !billingDisabled);
  const collectionErrors = extractCollectionErrors(collectResult);
  const noRateCard = Boolean(summary && summary.coverage.days_collected > 0 && !summary.cost);
  const lowCoverage = isLowCoverage(summary?.coverage);
  const partialSources = hasPartialBillingSources(summary?.coverage);

  async function handleRowClick(subject: BillingSubjectSummary) {
    if (!selectedEndpointId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await getBillingSubjectDetail(month, selectedEndpointId, subject.subject_type as "account" | "s3_user", subject.subject_id);
      setDetail(data);
    } catch (err) {
      setDetail(null);
      setDetailError(extractApiError(err, "Unable to load billing detail."));
    } finally {
      setDetailLoading(false);
    }
  }

  function handleTableSort(field: BillingSortBy) {
    if (field === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "name" ? "asc" : "desc");
  }

  async function handleExport() {
    if (!selectedEndpointId || !canExport) return;
    setPageError(null);
    try {
      const blob = await downloadBillingCsv(month, selectedEndpointId);
      triggerBlobDownload(
        `billing-${month}-endpoint-${selectedEndpointId}.csv`,
        blob,
      );
    } catch (err) {
      setPageError(extractApiError(err, "Unable to export CSV."));
    }
  }

  async function handleCollectDaily() {
    if (!canCollect) return;
    setCollectLoading(true);
    setCollectMessage(null);
    setCollectError(null);
    setCollectResult(null);
    try {
      const result = await collectBillingDaily(collectDay);
      setCollectResult(result);
      setCollectMessage(formatCollectionResult(result, collectDay));
      setReloadToken((prev) => prev + 1);
    } catch (err) {
      setCollectError(extractApiError(err, "Unable to trigger billing collection."));
    } finally {
      setCollectLoading(false);
    }
  }

  const dailySeries = useMemo(() => {
    return (detail?.daily ?? []).map((point) => ({
      ...point,
      label: point.day.slice(5),
      traffic_bytes: (point.bytes_in ?? 0) + (point.bytes_out ?? 0),
    }));
  }, [detail]);
  const subjectsTableStatus = resolveListTableStatus({
    loading: subjectsLoading,
    error: subjectsError,
    rowCount: subjects.length,
  });
  const subjectTableColumns: Array<DataTableColumn<BillingSubjectSummary, BillingSortBy>> = [
    {
      id: "name",
      label: "Name",
      field: "name",
      primary: true,
      render: (subject) => (
        <button
          type="button"
          className="text-left"
          onClick={() => void handleRowClick(subject)}
          aria-label={`View billing detail for ${subject.name}`}
        >
          <span className={cx("block font-medium", uiTitleTextClass)}>{subject.name}</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>{subject.rgw_identifier ?? "No RGW identifier"}</span>
        </button>
      ),
    },
    {
      id: "storage",
      label: "Storage avg",
      field: "storage",
      render: (subject) => formatBytes(subject.storage.avg_bytes),
    },
    {
      id: "egress",
      label: "Egress",
      field: "egress",
      render: (subject) => formatBytes(subject.usage.bytes_out),
    },
    {
      id: "ingress",
      label: "Ingress",
      render: (subject) => formatBytes(subject.usage.bytes_in),
    },
    {
      id: "requests",
      label: "Requests",
      field: "requests",
      render: (subject) => formatCompactNumber(subject.usage.ops_total),
    },
    {
      id: "cost",
      label: "Cost",
      field: "cost",
      render: (subject) => (subject.cost?.total_cost != null ? formatCurrency(subject.cost.total_cost, subject.cost.currency) : "-"),
    },
  ];

  return (
    <PageShell
      title="Billing"
      description="Monthly usage and cost overview."
      breadcrumbs={adminPageBreadcrumbs("billing")}
      rightContent={
        <UiButton
          variant="secondary"
          size="sm"
          onClick={() => void handleExport()}
          disabled={!canExport}
          title={canExport ? "Export the selected month as CSV" : "Select a Ceph endpoint with billing data before exporting"}
          leftIcon={<DownloadIcon className="h-3.5 w-3.5" />}
        >
          Export CSV
        </UiButton>
      }
    >
      <PageControlStrip
        label="Billing scope"
        title={selectedEndpoint?.name ?? "No Ceph endpoint selected"}
        description="Choose the month, Ceph endpoint, subject view, and ordering used to aggregate costs and traffic."
        controls={
          <div className="flex flex-wrap items-end gap-3">
            <UiInput
              label="Month"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              size="compact"
            />
            <UiSelect
              label="Endpoint"
              value={selectedEndpointId ?? ""}
              onChange={(event) => setSelectedEndpointId(event.target.value ? Number(event.target.value) : null)}
              size="compact"
            >
              {endpoints.length === 0 ? <option value="">No Ceph endpoint</option> : null}
              {endpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name}
                </option>
              ))}
            </UiSelect>
            <UiSelect
              label="Subject"
              value={subjectType}
              onChange={(event) => setSubjectType(event.target.value as "account" | "s3_user")}
              size="compact"
            >
              {SUBJECT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </UiSelect>
            <UiSelect
              label="Sort by"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as BillingSortBy)}
              size="compact"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </UiSelect>
            <UiSelect
              label="Direction"
              value={sortDir}
              onChange={(event) => setSortDir(event.target.value as "asc" | "desc")}
              size="compact"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </UiSelect>
          </div>
        }
        items={[
          { label: "Endpoint URL", value: selectedEndpoint?.endpoint_url ?? "Unavailable", mono: Boolean(selectedEndpoint?.endpoint_url) },
          { label: "Month", value: month || "Unavailable" },
          { label: "Subject type", value: SUBJECT_TYPES.find((option) => option.value === subjectType)?.label ?? subjectType },
          { label: "Sort", value: `${SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? sortBy} (${sortDir})` },
        ]}
        alerts={!selectedEndpointId && pageError ? [{ tone: "warning", message: pageError }] : []}
      />
      {pageError && selectedEndpointId != null ? <PageBanner tone="error">{pageError}</PageBanner> : null}
      {billingDisabled ? (
        <PageBanner tone="warning">
          Billing is disabled. Enable it in General settings to use this page.
        </PageBanner>
      ) : null}
      {!selectedEndpointId ? (
        <PageEmptyState
          title="No Ceph endpoint available for billing"
          description={pageError || "Add or enable a Ceph endpoint before loading billing analytics."}
          primaryAction={{ label: "Open endpoints", to: "/admin/endpoints" }}
          tone="warning"
        />
      ) : (
        <>
          <section className="ui-surface-card">
            <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>Manual daily collection</h2>
                <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                  Run the billing collector for one UTC day when scheduler data is missing or stale.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <UiInput
                  label="Collect day"
                  type="date"
                  value={collectDay}
                  onChange={(event) => setCollectDay(event.target.value)}
                  size="compact"
                />
                <UiButton
                  variant="primary"
                  size="sm"
                  onClick={() => void handleCollectDaily()}
                  loading={collectLoading}
                  disabled={!canCollect}
                  leftIcon={<RefreshIcon className={cx("h-3.5 w-3.5", collectLoading && "animate-spin")} />}
                >
                  {collectLoading ? "Collecting..." : "Collect daily"}
                </UiButton>
              </div>
            </div>
            {collectMessage ? <PageBanner tone={collectionErrors.length > 0 ? "warning" : "success"} className="mx-4 mb-4">{collectMessage}</PageBanner> : null}
            {collectError ? <PageBanner tone="error" className="mx-4 mb-4">{collectError}</PageBanner> : null}
            {collectionErrors.length > 0 ? (
              <div className={cx(uiCardMutedClass, "mx-4 mb-4 px-4 py-3")}>
                <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>Collection issues</p>
                <ul className={cx("mt-2 space-y-1 ui-caption", uiMutedTextClass)}>
                  {collectionErrors.slice(0, 5).map((entry, index) => (
                    <li key={index}>
                      {String(entry.subject ?? `endpoint ${entry.endpoint_id ?? "-"}`)}
                      {entry.subject_id != null ? ` #${String(entry.subject_id)}` : ""}: {String(entry.error ?? "Unknown error")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {summaryError ? <PageBanner tone={billingDisabled ? "warning" : "error"}>{summaryError}</PageBanner> : null}
          {lowCoverage ? (
            <PageBanner tone="warning">
              Billing coverage is partial for this month: {formatCoverage(summary?.coverage)}. Treat estimated cost as provisional.
            </PageBanner>
          ) : null}
          {partialSources ? (
            <PageBanner tone="warning">
              Storage and usage sources do not cover the same number of days ({formatCoverageBreakdown(summary?.coverage)}).
            </PageBanner>
          ) : null}
          {noRateCard ? (
            <PageBanner tone="warning">
              No matching rate card is attached for this scope. Usage totals are available, but estimated cost stays unavailable.
            </PageBanner>
          ) : null}
          {summaryLoading ? <PageBanner tone="info">Loading summary...</PageBanner> : <StatCards stats={stats} columns={3} />}

          <ListPageSection
              title="Subjects"
              description={selectedEndpoint ? `Monthly totals for ${selectedEndpoint.name}.` : "Monthly subject totals."}
              showHeading
              countLabel={`${subjectsTotal} subject${subjectsTotal === 1 ? "" : "s"}`}
          >
            {subjectsError ? <PageBanner tone="error" className="mx-4 mb-4">{subjectsError}</PageBanner> : null}
            <DataTableShell
              columns={subjectTableColumns}
              rows={subjects}
              rowKey={(subject) => `${subject.subject_type}-${subject.subject_id}`}
              status={subjectsTableStatus}
              loadingMessage="Loading subjects..."
              errorMessage="Unable to load subjects."
              emptyMessage="No subjects for this scope."
              primaryColumnId="name"
              sort={{ field: sortBy, direction: sortDir, onSort: handleTableSort }}
              pagination={{
                page,
                pageSize,
                total: subjectsTotal,
                onPageChange: setPage,
                onPageSizeChange: (size) => {
                  setPageSize(size);
                  setPage(1);
                },
                pageSizeOptions: [10, 25, 50, 100, 200],
                disabled: subjectsLoading,
              }}
              responsiveCards
              tableClassName="compact-table"
              rowClassName={(subject) =>
                cx(
                  "bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50",
                  detail?.subject_type === subject.subject_type &&
                    detail.subject_id === subject.subject_id &&
                    "bg-[var(--ui-selected-bg)] dark:bg-[var(--ui-selected-bg)]"
                )
              }
              rowAttributes={(subject) => ({
                "aria-current": detail?.subject_type === subject.subject_type && detail.subject_id === subject.subject_id ? "true" : undefined,
              })}
            />
          </ListPageSection>

          <section className="ui-surface-card p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className={cx("ui-body font-semibold", uiTitleTextClass)}>Subject detail</h2>
                <p className={cx("ui-caption", uiMutedTextClass)}>Daily storage, traffic, requests, coverage, and cost for the selected subject.</p>
              </div>
              {detail?.name ? <div className={cx("ui-caption", uiMutedTextClass)}>{detail.name}</div> : null}
            </div>
            {detailLoading ? <PageBanner tone="info" className="mt-3">Loading detail...</PageBanner> : null}
            {detailError ? <PageBanner tone="error" className="mt-3">{detailError}</PageBanner> : null}
            {!detailLoading && !detail ? <PageBanner tone="info" className="mt-3">Select a subject to view charts.</PageBanner> : null}
            {!detailLoading && detail ? (
              <div className="mt-4 space-y-4">
                {hasPartialBillingSources(detail.coverage) ? (
                  <PageBanner tone="warning">This subject has partial source coverage: {formatCoverageBreakdown(detail.coverage)}.</PageBanner>
                ) : null}
                {!detail.cost ? (
                  <PageBanner tone="warning">No rate card matched this subject, so cost is unavailable.</PageBanner>
                ) : null}
                <div className="grid gap-4 lg:grid-cols-3">
                  {dailySeries.length > 0 ? (
                    <>
                      <div className={cx(uiCardMutedClass, "p-3")}>
                        <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>Storage (daily)</h3>
                        <div className="mt-3 h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dailySeries}>
                              <defs>
                                <linearGradient id="storageFill" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatBytes(Number(value) || 0)} domain={["dataMin", "dataMax"]} />
                              <Tooltip formatter={(value) => formatBytes(value as number)} />
                              <Area type="monotone" dataKey="storage_bytes" stroke="#3b82f6" fill="url(#storageFill)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className={cx(uiCardMutedClass, "p-3")}>
                        <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>Traffic (daily)</h3>
                        <div className="mt-3 h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dailySeries}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatBytes(Number(value) || 0)} />
                              <Tooltip formatter={(value) => formatBytes(value as number)} />
                              <Bar dataKey="traffic_bytes" fill="#0ea5e9" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className={cx(uiCardMutedClass, "p-3")}>
                        <h3 className={cx("ui-caption font-semibold", uiTitleTextClass)}>Requests (daily)</h3>
                        <div className="mt-3 h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dailySeries}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatCompactNumber(Number(value) || 0)} />
                              <Tooltip formatter={(value) => formatCompactNumber(value as number)} />
                              <Bar dataKey="ops_total" fill="#22c55e" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="lg:col-span-3">
                      <PageBanner tone="info">No daily billing points are available for this subject and month.</PageBanner>
                    </div>
                  )}
                  <div className={cx(uiCardMutedClass, "p-3 lg:col-span-3")}>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>Avg storage</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatBytes(detail.storage.avg_bytes)}</p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>Egress</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatBytes(detail.usage.bytes_out)}</p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>Ingress</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatBytes(detail.usage.bytes_in)}</p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>Requests</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatCompactNumber(detail.usage.ops_total)}</p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>Cost</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>
                          {detail.cost?.total_cost != null ? formatCurrency(detail.cost.total_cost, detail.cost.currency) : "-"}
                        </p>
                      </div>
                      <div>
                        <p className={cx("ui-caption", uiMutedTextClass)}>Coverage</p>
                        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{formatCoverage(detail.coverage)}</p>
                        <p className={cx("ui-caption", uiMutedTextClass)}>{formatCoverageBreakdown(detail.coverage)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </>
      )}
    </PageShell>
  );
}

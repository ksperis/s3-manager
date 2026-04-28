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
import ListToolbar from "../../components/ListToolbar";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import PageControlStrip from "../../components/PageControlStrip";
import PageEmptyState from "../../components/PageEmptyState";
import StatCards from "../../components/StatCards";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { toolbarCompactButtonClasses, toolbarCompactInputClasses, toolbarCompactSelectClasses } from "../../components/toolbarControlClasses";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
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

export default function BillingPage() {
  const [month, setMonth] = useState<string>(currentMonth());
  const [collectDay, setCollectDay] = useState<string>(defaultCollectDay());
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [subjectType, setSubjectType] = useState<"account" | "s3_user">("account");
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [reloadToken, setReloadToken] = useState(0);

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);

  const [subjects, setSubjects] = useState<BillingSubjectSummary[]>([]);
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
          setSummary(null);
          setSummaryError(extractApiError(err, "Unable to load billing summary."));
          setBillingDisabled(true);
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
    let cancelled = false;
    async function loadSubjects() {
      if (!selectedEndpointId) {
        setSubjects([]);
        return;
      }
      setSubjectsLoading(true);
      setSubjectsError(null);
      try {
        const data = await getBillingSubjects(month, selectedEndpointId, subjectType, 1, 200, sortBy, sortDir);
        if (!cancelled) {
          setSubjects(data.items);
        }
      } catch (err) {
        if (!cancelled) {
          setSubjects([]);
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
  }, [month, selectedEndpointId, subjectType, sortBy, sortDir, reloadToken]);

  useEffect(() => {
    if (!subjects.length) {
      setDetail(null);
    }
  }, [subjects]);

  useEffect(() => {
    if (!detail || !selectedEndpointId) {
      return;
    }
    let cancelled = false;
    async function reloadDetail() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const data = await getBillingSubjectDetail(
          month,
          selectedEndpointId,
          detail.subject_type as "account" | "s3_user",
          detail.subject_id
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
  }, [detail?.subject_id, detail?.subject_type, month, selectedEndpointId, reloadToken]);

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
        hint: "Days collected in month",
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

  async function handleExport() {
    if (!selectedEndpointId) return;
    try {
      const blob = await downloadBillingCsv(month, selectedEndpointId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `billing-${month}-endpoint-${selectedEndpointId}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setPageError(extractApiError(err, "Unable to export CSV."));
    }
  }

  async function handleCollectDaily() {
    if (!collectDay) return;
    setCollectLoading(true);
    setCollectMessage(null);
    setCollectError(null);
    try {
      await collectBillingDaily(collectDay);
      setCollectMessage(`Collection completed for ${collectDay}.`);
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

  return (
    <div className="space-y-4">
      <PageHeader title="Billing" description="Monthly usage and cost overview." />
      <PageControlStrip
        label="Billing scope"
        title={selectedEndpoint?.name ?? "No Ceph endpoint selected"}
        description="Choose the month, Ceph endpoint, and billing subject view used to aggregate costs and traffic."
        controls={
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 ui-caption text-slate-600 dark:text-slate-300">
              Month
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className={toolbarCompactInputClasses}
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption text-slate-600 dark:text-slate-300">
              Endpoint
              <select
                value={selectedEndpointId ?? ""}
                onChange={(event) => setSelectedEndpointId(event.target.value ? Number(event.target.value) : null)}
                className={toolbarCompactSelectClasses}
              >
                {endpoints.length === 0 ? <option value="">No Ceph endpoint</option> : null}
                {endpoints.map((endpoint) => (
                  <option key={endpoint.id} value={endpoint.id}>
                    {endpoint.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption text-slate-600 dark:text-slate-300">
              Subject
              <select
                value={subjectType}
                onChange={(event) => setSubjectType(event.target.value as "account" | "s3_user")}
                className={toolbarCompactSelectClasses}
              >
                {SUBJECT_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption text-slate-600 dark:text-slate-300">
              Sort by
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className={toolbarCompactSelectClasses}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption text-slate-600 dark:text-slate-300">
              Direction
              <select
                value={sortDir}
                onChange={(event) => setSortDir(event.target.value as "asc" | "desc")}
                className={toolbarCompactSelectClasses}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption text-slate-600 dark:text-slate-300">
              Collect day
              <input
                type="date"
                value={collectDay}
                onChange={(event) => setCollectDay(event.target.value)}
                className={toolbarCompactInputClasses}
              />
            </label>
            <button type="button" onClick={handleCollectDaily} disabled={collectLoading} className={toolbarCompactButtonClasses}>
              {collectLoading ? "Collecting..." : "Collect daily"}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600"
            >
              Export CSV
            </button>
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
      {billingDisabled && (
        <PageBanner tone="warning">
          Billing is disabled. Enable it in General settings to use this page.
        </PageBanner>
      )}
      {collectMessage && <PageBanner tone="success">{collectMessage}</PageBanner>}
      {collectError && <PageBanner tone="error">{collectError}</PageBanner>}
      {!selectedEndpointId ? (
        <PageEmptyState
          title="No Ceph endpoint available for billing"
          description={pageError || "Add or enable a Ceph endpoint before loading billing analytics."}
          primaryAction={{ label: "Open endpoints", to: "/admin/endpoints" }}
          tone="warning"
        />
      ) : (
        <>
      {summaryError && <PageBanner tone="error">{summaryError}</PageBanner>}
      {summaryLoading ? <PageBanner tone="info">Loading summary...</PageBanner> : <StatCards stats={stats} columns={3} />}

      <div className="ui-surface-card">
        <ListToolbar
          title="Subjects"
          description={selectedEndpoint ? `Monthly totals for ${selectedEndpoint.name}.` : "Monthly subject totals."}
          countLabel={`${subjects.length} subject${subjects.length === 1 ? "" : "s"}`}
        />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Storage avg</th>
                <th className="px-4 py-3 text-left">Egress</th>
                <th className="px-4 py-3 text-left">Ingress</th>
                <th className="px-4 py-3 text-left">Requests</th>
                <th className="px-4 py-3 text-left">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {subjectsTableStatus === "loading" && <TableEmptyState colSpan={6} message="Loading subjects..." />}
              {subjectsTableStatus === "error" && <TableEmptyState colSpan={6} message="Unable to load subjects." tone="error" />}
              {subjectsTableStatus === "empty" && <TableEmptyState colSpan={6} message="No subjects." />}
              {subjects.map((subject) => (
                <tr
                  key={`${subject.subject_type}-${subject.subject_id}`}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  onClick={() => void handleRowClick(subject)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{subject.name}</div>
                    <div className="text-xs text-slate-500">{subject.rgw_identifier ?? ""}</div>
                  </td>
                  <td className="px-4 py-3">{formatBytes(subject.storage.avg_bytes)}</td>
                  <td className="px-4 py-3">{formatBytes(subject.usage.bytes_out)}</td>
                  <td className="px-4 py-3">{formatBytes(subject.usage.bytes_in)}</td>
                  <td className="px-4 py-3">{formatCompactNumber(subject.usage.ops_total)}</td>
                  <td className="px-4 py-3">
                    {subject.cost?.total_cost != null
                      ? formatCurrency(subject.cost.total_cost, subject.cost.currency)
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Subject detail</h3>
            <p className="text-xs text-slate-500">Daily series for the selected subject.</p>
          </div>
          {detail?.name && <div className="text-xs text-slate-500">{detail.name}</div>}
        </div>
        {detailLoading && <PageBanner tone="info" className="mt-3">Loading detail...</PageBanner>}
        {detailError && <PageBanner tone="error" className="mt-3">{detailError}</PageBanner>}
        {!detailLoading && !detail && <PageBanner tone="info" className="mt-3">Select a subject to view charts.</PageBanner>}
        {!detailLoading && detail && (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Storage (daily)</h4>
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
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value) => formatBytes(Number(value) || 0)}
                      domain={["dataMin", "dataMax"]}
                    />
                    <Tooltip formatter={(value) => formatBytes(value as number)} />
                    <Area type="monotone" dataKey="storage_bytes" stroke="#3b82f6" fill="url(#storageFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Traffic (daily)</h4>
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
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Requests (daily)</h4>
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
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800 lg:col-span-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <p className="text-xs text-slate-500">Avg storage</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatBytes(detail.storage.avg_bytes)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Egress</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatBytes(detail.usage.bytes_out)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Ingress</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatBytes(detail.usage.bytes_in)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Requests</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatCompactNumber(detail.usage.ops_total)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Cost</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {detail.cost?.total_cost != null
                      ? formatCurrency(detail.cost.total_cost, detail.cost.currency)
                      : "-"}
                  </p>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Coverage: {Math.round(detail.coverage.coverage_ratio * 100)}% ({detail.coverage.days_collected}/
                {detail.coverage.days_in_month} days)
              </div>
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  EndpointHealthIncident,
  EndpointHealthSeries,
  EndpointHealthSummary,
  fetchHealthIncidents,
  fetchHealthSeries,
  fetchHealthSummary,
  runHealthchecks,
  type HealthCheckStatus,
} from "../../api/healthchecks";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import StatCards from "../../components/StatCards";
import TableEmptyState from "../../components/TableEmptyState";

type WindowOption = { label: string; value: "day" | "week" | "month"; helper: string };

const WINDOW_OPTIONS: WindowOption[] = [
  { label: "24h", value: "day", helper: "Last 24 hours" },
  { label: "7d", value: "week", helper: "Last 7 days" },
  { label: "30d", value: "month", helper: "Last 30 days" },
];

const STATUS_LABELS: Record<HealthCheckStatus, string> = {
  unknown: "Unknown",
  up: "Up",
  degraded: "Degraded",
  down: "Down",
};

function StatusPill({ status }: { status: HealthCheckStatus }) {
  const classes =
    status === "up"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
      : status === "degraded"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100"
        : status === "down"
          ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-100"
          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 ui-caption font-semibold ${classes}`}>{STATUS_LABELS[status]}</span>;
}

function formatLatency(value?: number | null) {
  if (value == null) return "-";
  return `${value} ms`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatChartTime(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatChartDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" }).format(date);
}

function buildStatusCounts(endpoints: EndpointHealthSummary[]) {
  return endpoints.reduce(
    (acc, endpoint) => {
      acc.total += 1;
      acc[endpoint.status] += 1;
      return acc;
    },
    { total: 0, up: 0, degraded: 0, down: 0, unknown: 0 }
  );
}

export default function EndpointStatusPage() {
  const [summary, setSummary] = useState<EndpointHealthSummary[] | null>(null);
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState<boolean>(false);

  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [windowValue, setWindowValue] = useState<WindowOption["value"]>("week");

  const [series, setSeries] = useState<EndpointHealthSeries | null>(null);
  const [seriesLoading, setSeriesLoading] = useState<boolean>(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const [incidents, setIncidents] = useState<EndpointHealthIncident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState<boolean>(false);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const loadSummary = useCallback(async (preserveSelection = true) => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const data = await fetchHealthSummary();
      setSummary(data.endpoints);
      setSummaryUpdatedAt(data.generated_at);
      if (!preserveSelection || selectedEndpointId == null || !data.endpoints.some((ep) => ep.endpoint_id === selectedEndpointId)) {
        setSelectedEndpointId(data.endpoints[0]?.endpoint_id ?? null);
      }
    } catch {
      setSummary([]);
      setSummaryError("Unable to load endpoint status.");
      setSelectedEndpointId(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [selectedEndpointId]);

  const loadDetails = useCallback(async (endpointId: number, window: WindowOption["value"]) => {
    setSeriesLoading(true);
    setSeriesError(null);
    setIncidentsLoading(true);
    setIncidentsError(null);
    try {
      const [seriesData, incidentData] = await Promise.all([
        fetchHealthSeries(endpointId, window),
        fetchHealthIncidents(endpointId, window),
      ]);
      setSeries(seriesData);
      setIncidents(incidentData.incidents ?? []);
    } catch {
      setSeries(null);
      setIncidents([]);
      setSeriesError("Unable to load healthcheck series.");
      setIncidentsError("Unable to load incidents.");
    } finally {
      setSeriesLoading(false);
      setIncidentsLoading(false);
    }
  }, []);

  const handleRunNow = useCallback(async () => {
    if (runLoading) return;
    setRunLoading(true);
    setActionMessage(null);
    setActionError(null);
    try {
      await runHealthchecks();
      setActionMessage("Healthchecks executed.");
      await loadSummary(true);
      if (selectedEndpointId != null) {
        await loadDetails(selectedEndpointId, windowValue);
      }
    } catch {
      setActionError("Unable to run healthchecks.");
    } finally {
      setRunLoading(false);
    }
  }, [runLoading, loadSummary, loadDetails, selectedEndpointId, windowValue]);

  useEffect(() => {
    loadSummary(true);
  }, [loadSummary]);

  useEffect(() => {
    if (selectedEndpointId == null) {
      setSeries(null);
      setIncidents([]);
      return;
    }
    loadDetails(selectedEndpointId, windowValue);
  }, [selectedEndpointId, windowValue, loadDetails]);

  const selectedEndpoint = useMemo(() => {
    return summary?.find((endpoint) => endpoint.endpoint_id === selectedEndpointId) ?? null;
  }, [summary, selectedEndpointId]);

  const stats = useMemo(() => buildStatusCounts(summary ?? []), [summary]);

  const latencySeries = useMemo(() => {
    if (!series) return [];
    if (series.series.length > 0) {
      return series.series.map((point) => ({
        timestampMs: new Date(point.timestamp).getTime(),
        latency_ms: point.latency_ms ?? null,
      }));
    }
    return series.daily.map((point) => ({
      timestampMs: new Date(point.day).getTime(),
      latency_ms: point.avg_latency_ms ?? null,
    }));
  }, [series]);

  const dailyStatusSeries = useMemo(() => {
    if (!series) return [];
    return series.daily.map((point) => ({
      day: point.day,
      ok_count: point.ok_count,
      degraded_count: point.degraded_count,
      down_count: point.down_count,
    }));
  }, [series]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Endpoint Status"
        description="Live healthchecks and history for storage endpoints."
        breadcrumbs={[{ label: "Admin" }, { label: "Connectivity" }, { label: "Endpoint Status" }]}
        actions={[
          { label: runLoading ? "Running..." : "Run now", onClick: handleRunNow },
          { label: "Refresh", onClick: () => loadSummary(true), variant: "ghost" },
        ]}
        inlineContent={
          summaryUpdatedAt ? (
            <span className="ui-caption font-medium text-slate-500 dark:text-slate-400">
              Updated {formatTimestamp(summaryUpdatedAt)}
            </span>
          ) : null
        }
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {actionError && <PageBanner tone="warning">{actionError}</PageBanner>}
      {summaryError && <PageBanner tone="warning">{summaryError}</PageBanner>}

      <StatCards
        columns={4}
        stats={[
          { label: "Total endpoints", value: stats.total },
          { label: "Up", value: stats.up },
          { label: "Degraded", value: stats.degraded },
          { label: "Down", value: stats.down },
          { label: "Unknown", value: stats.unknown },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Endpoints</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">Click an endpoint to inspect details.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    {["Endpoint", "Status", "Latency", "Last check"].map((label) => (
                      <th key={label} className="px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {summaryLoading && (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 ui-body text-slate-500 dark:text-slate-400">
                        Loading endpoints...
                      </td>
                    </tr>
                  )}
                  {!summaryLoading && (summary?.length ?? 0) === 0 && (
                    <TableEmptyState colSpan={4} message="No endpoints available." />
                  )}
                  {!summaryLoading &&
                    summary?.map((endpoint) => (
                      <tr
                        key={endpoint.endpoint_id}
                        onClick={() => setSelectedEndpointId(endpoint.endpoint_id)}
                        className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                          endpoint.endpoint_id === selectedEndpointId ? "bg-slate-50 dark:bg-slate-800/60" : ""
                        }`}
                      >
                        <td className="px-6 py-4">
                          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{endpoint.name}</p>
                          <p className="ui-caption text-slate-500 dark:text-slate-400">{endpoint.endpoint_url}</p>
                        </td>
                        <td className="px-6 py-4">
                          <StatusPill status={endpoint.status} />
                        </td>
                        <td className="px-6 py-4 ui-body text-slate-700 dark:text-slate-200">{formatLatency(endpoint.latency_ms)}</td>
                        <td className="px-6 py-4 ui-caption text-slate-500 dark:text-slate-400">{formatTimestamp(endpoint.checked_at)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                  {selectedEndpoint ? selectedEndpoint.name : "Endpoint details"}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {selectedEndpoint ? selectedEndpoint.endpoint_url : "Select an endpoint to inspect history."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {WINDOW_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setWindowValue(option.value)}
                    className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                      windowValue === option.value
                        ? "bg-primary text-white"
                        : "border border-slate-200 text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
                    }`}
                    title={option.helper}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-6 px-6 py-6">
              {seriesError && <PageBanner tone="warning">{seriesError}</PageBanner>}
              {seriesLoading && <p className="ui-body text-slate-500 dark:text-slate-400">Loading charts...</p>}
              {!seriesLoading && selectedEndpointId == null && (
                <p className="ui-body text-slate-500 dark:text-slate-400">Select an endpoint to view charts.</p>
              )}
              {!seriesLoading && selectedEndpoint?.error_message && (
                <PageBanner tone={selectedEndpoint.status === "up" ? "info" : "warning"}>
                  Last check: {selectedEndpoint.error_message}
                </PageBanner>
              )}
              {!seriesLoading && selectedEndpointId != null && (
                <div className="space-y-6">
                  <div>
                    <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Latency (ms)</p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">Raw checks or daily average when raw is unavailable.</p>
                    <div className="mt-3 h-64">
                      {latencySeries.length === 0 ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">No latency data for this window.</p>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={latencySeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis
                              dataKey="timestampMs"
                              type="number"
                              scale="time"
                              tickFormatter={formatChartTime}
                              stroke="#94A3B8"
                            />
                            <YAxis tickFormatter={(value) => `${value} ms`} stroke="#94A3B8" />
                            <Tooltip
                              formatter={(value) => (value == null ? "-" : `${value} ms`)}
                              labelFormatter={(value) => formatChartTime(Number(value))}
                            />
                            <Line type="monotone" dataKey="latency_ms" name="Latency" stroke="#3B82F6" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Status Counts (daily)</p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">Daily aggregation of checks.</p>
                    <div className="mt-3 h-56">
                      {dailyStatusSeries.length === 0 ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">No daily status data for this window.</p>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={dailyStatusSeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis dataKey="day" tickFormatter={formatChartDay} stroke="#94A3B8" />
                            <YAxis stroke="#94A3B8" />
                            <Tooltip
                              formatter={(value, name) => [value as number, name.replace("_", " ")]}
                              labelFormatter={(value) => formatChartDay(String(value))}
                            />
                            <Area type="monotone" dataKey="ok_count" name="Up" stackId="status" stroke="#10B981" fill="#10B981" fillOpacity={0.25} />
                            <Area type="monotone" dataKey="degraded_count" name="Degraded" stackId="status" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.2} />
                            <Area type="monotone" dataKey="down_count" name="Down" stackId="status" stroke="#EF4444" fill="#EF4444" fillOpacity={0.2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Incidents</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">Downtime or degraded periods detected.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    {["Status", "Start", "End", "Duration"].map((label) => (
                      <th key={label} className="px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {incidentsLoading && (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 ui-body text-slate-500 dark:text-slate-400">
                        Loading incidents...
                      </td>
                    </tr>
                  )}
                  {!incidentsLoading && incidentsError && (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 ui-body text-slate-500 dark:text-slate-400">
                        {incidentsError}
                      </td>
                    </tr>
                  )}
                  {!incidentsLoading && !incidentsError && incidents.length === 0 && (
                    <TableEmptyState colSpan={4} message="No incidents recorded for this window." />
                  )}
                  {!incidentsLoading &&
                    !incidentsError &&
                    incidents.map((incident, index) => (
                      <tr key={`${incident.start}-${index}`}>
                        <td className="px-6 py-4">
                          <StatusPill status={incident.status} />
                        </td>
                        <td className="px-6 py-4 ui-caption text-slate-500 dark:text-slate-400">{formatTimestamp(incident.start)}</td>
                        <td className="px-6 py-4 ui-caption text-slate-500 dark:text-slate-400">
                          {incident.end ? formatTimestamp(incident.end) : "Ongoing"}
                        </td>
                        <td className="px-6 py-4 ui-caption text-slate-500 dark:text-slate-400">
                          {incident.duration_minutes != null ? `${incident.duration_minutes} min` : "-"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

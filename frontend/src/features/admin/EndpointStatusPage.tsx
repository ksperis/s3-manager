/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  EndpointHealthGlobalIncident,
  EndpointHealthLatencyOverviewEndpoint,
  EndpointHealthOverviewEndpoint,
  fetchHealthGlobalIncidents,
  fetchHealthLatencyOverview,
  fetchHealthOverview,
  runHealthchecks,
  type HealthCheckStatus,
} from "../../api/healthchecks";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import ListSectionCard from "../../components/list/ListSectionCard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import {
  EndpointTimelineBar,
  formatCheckMode,
  formatLatency,
  formatPercent,
  formatTimestamp,
  statusStatCardClasses,
  StatusPill,
} from "./endpointStatusShared";

type WindowOption = { label: string; value: "day" | "week" | "month"; helper: string };
type IncidentWindowOption = { label: string; value: "month" | "quarter" | "half_year"; helper: string };

const TIMELINE_WINDOW_OPTIONS: WindowOption[] = [
  { label: "24h", value: "day", helper: "Last 24 hours" },
  { label: "7d", value: "week", helper: "Last 7 days" },
  { label: "30d", value: "month", helper: "Last 30 days" },
];

const INCIDENT_WINDOW_OPTIONS: IncidentWindowOption[] = [
  { label: "30d", value: "month", helper: "Last 30 days" },
  { label: "90d", value: "quarter", helper: "Last 90 days" },
  { label: "6m", value: "half_year", helper: "Last 6 months" },
];

function latencyBarClass(status: HealthCheckStatus) {
  if (status === "up") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "down") return "bg-rose-500";
  return "bg-slate-400";
}

function buildStatusCounts(endpoints: EndpointHealthLatencyOverviewEndpoint[]) {
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
  const navigate = useNavigate();

  const [latencyEndpoints, setLatencyEndpoints] = useState<EndpointHealthLatencyOverviewEndpoint[]>([]);
  const [latencyUpdatedAt, setLatencyUpdatedAt] = useState<string | null>(null);
  const [latencyLoading, setLatencyLoading] = useState<boolean>(true);
  const [latencyError, setLatencyError] = useState<string | null>(null);

  const [timelineWindow, setTimelineWindow] = useState<WindowOption["value"]>("week");
  const [timelineEndpoints, setTimelineEndpoints] = useState<EndpointHealthOverviewEndpoint[]>([]);
  const [timelineStart, setTimelineStart] = useState<string | null>(null);
  const [timelineEnd, setTimelineEnd] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState<boolean>(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const [incidentWindow, setIncidentWindow] = useState<IncidentWindowOption["value"]>("half_year");
  const [globalIncidents, setGlobalIncidents] = useState<EndpointHealthGlobalIncident[]>([]);
  const [globalIncidentsTotal, setGlobalIncidentsTotal] = useState<number>(0);
  const [incidentsLoading, setIncidentsLoading] = useState<boolean>(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<HealthCheckStatus | "all">("all");

  const loadLatencyOverview = useCallback(async () => {
    setLatencyLoading(true);
    setLatencyError(null);
    try {
      const payload = await fetchHealthLatencyOverview("day");
      setLatencyEndpoints(payload.endpoints ?? []);
      setLatencyUpdatedAt(payload.generated_at ?? null);
    } catch {
      setLatencyEndpoints([]);
      setLatencyError("Unable to load latency overview.");
    } finally {
      setLatencyLoading(false);
    }
  }, []);

  const loadTimelineOverview = useCallback(async (windowValue: WindowOption["value"]) => {
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const payload = await fetchHealthOverview(windowValue);
      setTimelineEndpoints(payload.endpoints ?? []);
      setTimelineStart(payload.start ?? null);
      setTimelineEnd(payload.end ?? null);
    } catch {
      setTimelineEndpoints([]);
      setTimelineStart(null);
      setTimelineEnd(null);
      setTimelineError("Unable to load endpoint timelines.");
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  const loadGlobalIncidents = useCallback(async (windowValue: IncidentWindowOption["value"]) => {
    setIncidentsLoading(true);
    setIncidentsError(null);
    try {
      const payload = await fetchHealthGlobalIncidents(windowValue, 300);
      setGlobalIncidents(payload.incidents ?? []);
      setGlobalIncidentsTotal(payload.total ?? 0);
    } catch {
      setGlobalIncidents([]);
      setGlobalIncidentsTotal(0);
      setIncidentsError("Unable to load global incidents.");
    } finally {
      setIncidentsLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadLatencyOverview(), loadTimelineOverview(timelineWindow), loadGlobalIncidents(incidentWindow)]);
  }, [incidentWindow, loadGlobalIncidents, loadLatencyOverview, loadTimelineOverview, timelineWindow]);

  const handleRunNow = useCallback(async () => {
    if (runLoading) return;
    setRunLoading(true);
    setActionMessage(null);
    setActionError(null);
    try {
      await runHealthchecks();
      setActionMessage("Healthchecks executed.");
      await loadAll();
    } catch {
      setActionError("Unable to run healthchecks.");
    } finally {
      setRunLoading(false);
    }
  }, [loadAll, runLoading]);

  useEffect(() => {
    loadLatencyOverview();
  }, [loadLatencyOverview]);

  useEffect(() => {
    loadTimelineOverview(timelineWindow);
  }, [timelineWindow, loadTimelineOverview]);

  useEffect(() => {
    loadGlobalIncidents(incidentWindow);
  }, [incidentWindow, loadGlobalIncidents]);

  const stats = useMemo(() => buildStatusCounts(latencyEndpoints), [latencyEndpoints]);
  const filteredLatencyEndpoints = useMemo(
    () => latencyEndpoints.filter((endpoint) => statusFilter === "all" || endpoint.status === statusFilter),
    [latencyEndpoints, statusFilter]
  );
  const filteredTimelineEndpoints = useMemo(
    () => timelineEndpoints.filter((endpoint) => statusFilter === "all" || endpoint.status === statusFilter),
    [timelineEndpoints, statusFilter]
  );

  const maxOverviewLatency = useMemo(() => {
    const values = filteredLatencyEndpoints
      .map((endpoint) => endpoint.max_latency_ms)
      .filter((value): value is number => value != null && value > 0);
    if (values.length === 0) return 1;
    return Math.max(...values, 1);
  }, [filteredLatencyEndpoints]);
  const incidentsTableStatus = resolveListTableStatus({
    loading: incidentsLoading,
    error: incidentsError,
    rowCount: globalIncidents.length,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Endpoint Status"
        description="Global operational view across all storage endpoints."
        breadcrumbs={[{ label: "Admin" }, { label: "Connectivity" }, { label: "Endpoint Status" }]}
        actions={[
          { label: runLoading ? "Running..." : "Check now", onClick: handleRunNow },
          { label: "Refresh", onClick: loadAll, variant: "ghost" },
        ]}
        inlineContent={
          latencyUpdatedAt ? (
            <span className="ui-caption font-medium text-slate-500 dark:text-slate-400">Updated {formatTimestamp(latencyUpdatedAt)}</span>
          ) : null
        }
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {latencyError && <PageBanner tone="error">{latencyError}</PageBanner>}
      {timelineError && <PageBanner tone="error">{timelineError}</PageBanner>}
      {incidentsError && <PageBanner tone="error">{incidentsError}</PageBanner>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { key: "up" as const, label: "Up", value: stats.up },
          { key: "degraded" as const, label: "Degraded", value: stats.degraded },
          { key: "down" as const, label: "Down", value: stats.down },
          { key: "unknown" as const, label: "Unknown", value: stats.unknown },
        ].map((item) => (
          (() => {
            const isActive = statusFilter === item.key;
            const isDimmed = statusFilter !== "all" && !isActive;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter((current) => (current === item.key ? "all" : item.key))}
                className={`rounded-xl border px-3 py-3 text-left shadow-sm transition ${
                  isActive ? "ring-2 ring-primary/40" : ""
                } ${isDimmed ? "opacity-65" : ""} ${statusStatCardClasses(item.key, item.value)}`}
              >
                <p className="ui-caption font-medium opacity-80">{item.label}</p>
                <p className="mt-1.5 ui-title font-semibold">{item.value}</p>
              </button>
            );
          })()
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Endpoint Latency</p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            24h rolling min/avg/max latency (down checks excluded). Click a card for endpoint details.
          </p>
        </div>
        <div className="px-4 py-4 sm:px-6">
          {latencyLoading && <p className="ui-body text-slate-500 dark:text-slate-400">Loading latency overview...</p>}
          {!latencyLoading && filteredLatencyEndpoints.length === 0 && (
            <p className="ui-body text-slate-500 dark:text-slate-400">No endpoints for the selected status filter.</p>
          )}
          {!latencyLoading && filteredLatencyEndpoints.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredLatencyEndpoints.map((endpoint) => {
                const currentLatency = endpoint.status === "down" ? null : endpoint.latency_ms;
                const minLatency = endpoint.min_latency_ms ?? null;
                const avgLatency = endpoint.avg_latency_ms ?? null;
                const maxLatency = endpoint.max_latency_ms ?? null;
                const currentAboveAverage = currentLatency != null && avgLatency != null ? currentLatency > avgLatency : false;
                const relativePct = currentLatency == null ? null : Math.round((currentLatency / maxOverviewLatency) * 100);
                const relativeWidth = relativePct == null ? 0 : Math.max(8, Math.min(100, relativePct));
                const minMarkerPct = minLatency == null ? null : Math.max(0, Math.min(100, (minLatency / maxOverviewLatency) * 100));
                const maxMarkerPct = maxLatency == null ? null : Math.max(0, Math.min(100, (maxLatency / maxOverviewLatency) * 100));
                const relativeLabel = relativePct == null ? "No latency sample yet." : `${relativePct}% of slowest endpoint.`;

                return (
                  <button
                    key={endpoint.endpoint_id}
                    type="button"
                    onClick={() => navigate(`/admin/endpoint-status/${endpoint.endpoint_id}`)}
                    className="rounded-lg border border-slate-200/90 bg-white p-3 text-left transition hover:-translate-y-[1px] hover:border-primary/50 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate ui-caption font-semibold text-slate-900 dark:text-slate-100">{endpoint.name}</p>
                      <StatusPill status={endpoint.status} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="ui-caption text-slate-500 dark:text-slate-400">Current latency</p>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{formatLatency(currentLatency)}</p>
                    </div>
                    <div className="relative mt-1 h-2.5">
                      <div className="absolute inset-x-0 top-0.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800" />
                      {minMarkerPct != null && (
                        <div className="absolute top-0 h-2.5 w-px bg-slate-500/80 dark:bg-slate-300/80" style={{ left: `${minMarkerPct}%` }} />
                      )}
                      {maxMarkerPct != null && (
                        <div className="absolute top-0 h-2.5 w-px bg-slate-700 dark:bg-slate-100" style={{ left: `${maxMarkerPct}%` }} />
                      )}
                      {currentLatency != null && (
                        <div
                          className={`absolute left-0 top-0.5 h-1.5 rounded-full ${currentAboveAverage ? "bg-amber-500" : latencyBarClass(endpoint.status)}`}
                          style={{ width: `${relativeWidth}%` }}
                        />
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="ui-caption text-slate-500 dark:text-slate-400">{relativeLabel}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">{formatCheckMode(endpoint.check_mode)}</p>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="ui-caption text-slate-500 dark:text-slate-400">Min {formatLatency(minLatency)}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">Avg {formatLatency(avgLatency)}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">Max {formatLatency(maxLatency)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Endpoint Timelines</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Availability timelines (green up, amber degraded, red down). Default view is 7 days.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TIMELINE_WINDOW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTimelineWindow(option.value)}
                className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                  timelineWindow === option.value
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
        <div className="space-y-3 px-6 py-4">
          {timelineLoading && <p className="ui-body text-slate-500 dark:text-slate-400">Loading timelines...</p>}
          {!timelineLoading && filteredTimelineEndpoints.length === 0 && (
            <p className="ui-body text-slate-500 dark:text-slate-400">No timeline data for the selected status filter.</p>
          )}
          {!timelineLoading &&
            filteredTimelineEndpoints.map((endpoint) => (
              <button
                key={`timeline-${endpoint.endpoint_id}`}
                type="button"
                onClick={() => navigate(`/admin/endpoint-status/${endpoint.endpoint_id}`)}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left transition hover:border-primary/50 hover:bg-primary/5 dark:border-slate-700 dark:hover:bg-primary-900/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="ui-caption font-semibold text-slate-900 dark:text-slate-100">{endpoint.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="ui-caption text-slate-500 dark:text-slate-400">{formatPercent(endpoint.availability_pct ?? null)} availability</span>
                    <span className="ui-caption text-slate-500 dark:text-slate-400">{formatCheckMode(endpoint.check_mode)}</span>
                    <StatusPill status={endpoint.status} />
                  </div>
                </div>
                <EndpointTimelineBar points={endpoint.timeline} rangeStart={timelineStart} rangeEnd={timelineEnd} className="mt-2 h-3" />
              </button>
            ))}
        </div>
      </div>

      <ListSectionCard
        title="Incidents"
        subtitle="All incidents across endpoints. Default view is 6 months."
        rightContent={(
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {globalIncidentsTotal} incidents
            </span>
            {globalIncidentsTotal > globalIncidents.length && (
              <span className="ui-caption text-slate-500 dark:text-slate-400">showing first {globalIncidents.length}</span>
            )}
            <div className="flex flex-wrap gap-2">
              {INCIDENT_WINDOW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setIncidentWindow(option.value)}
                  className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                    incidentWindow === option.value
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
        )}
      >
        <div className="overflow-x-auto">
          <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {[
                  "Endpoint",
                  "Status",
                  "Start",
                  "End",
                  "Duration",
                  "Type",
                ].map((label) => (
                  <th key={label} className="px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {incidentsTableStatus === "loading" && (
                <TableEmptyState colSpan={6} message="Loading incidents..." />
              )}
              {incidentsTableStatus === "error" && (
                <TableEmptyState colSpan={6} message="Unable to load incidents." tone="error" />
              )}
              {incidentsTableStatus === "empty" && (
                <TableEmptyState colSpan={6} message="No incidents for this range." />
              )}
              {globalIncidents.map((incident, index) => (
                <tr key={`${incident.endpoint_id}-${incident.start}-${index}`}>
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/endpoint-status/${incident.endpoint_id}`)}
                      className="text-left hover:text-primary"
                    >
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{incident.endpoint_name}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">{incident.endpoint_url || "-"}</p>
                    </button>
                  </td>
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
                  <td className="px-6 py-4 ui-caption text-slate-500 dark:text-slate-400">
                    {(incident.check_type || "availability").toUpperCase()} · {(incident.scope || "endpoint").toUpperCase()} · {formatCheckMode(incident.check_mode)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ListSectionCard>
    </div>
  );
}

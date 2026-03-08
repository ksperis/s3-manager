/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import { HealthCheckStatus, WorkspaceEndpointHealthOverviewResponse } from "../api/healthchecks";

function statusLabel(status: HealthCheckStatus) {
  if (status === "up") return "Up";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  return "Unknown";
}

function statusPillClass(status: HealthCheckStatus) {
  if (status === "up") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100";
  if (status === "degraded") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100";
  if (status === "down") return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-100";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function statusStatCardClass(status: "up" | "degraded" | "down" | "unknown", value: number) {
  if (value <= 0) return "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
  if (status === "up") return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-100";
  if (status === "degraded") return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-100";
  if (status === "down") return "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/60 dark:bg-rose-900/20 dark:text-rose-100";
  return "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
}

function formatLatency(value?: number | null) {
  if (value == null) return "-";
  return `${value} ms`;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatCheckMode(mode?: string | null) {
  return (mode || "http").toUpperCase();
}

function incidentStateBadgeClass(ongoing: boolean) {
  if (ongoing) {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function formatIncidentWindow(minutes?: number | null) {
  const value = Math.max(1, Number(minutes ?? 720));
  if (value % 60 === 0) {
    const hours = value / 60;
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  }
  return `${value} minute${value > 1 ? "s" : ""}`;
}

type WorkspaceEndpointHealthCardsProps = {
  data: WorkspaceEndpointHealthOverviewResponse | null;
  loading: boolean;
  error?: string | null;
  title?: string;
  action?: { to: string; label: string };
  className?: string;
  showStatusCounters?: boolean;
};

export default function WorkspaceEndpointHealthCards({
  data,
  loading,
  error,
  title = "Endpoint Health",
  action,
  className = "grid gap-4 xl:grid-cols-[1.7fr_1fr]",
  showStatusCounters = true,
}: WorkspaceEndpointHealthCardsProps) {
  const incidents = data?.incidents ?? [];
  const orderedIncidents = [...incidents].sort((left, right) => {
    if (left.ongoing !== right.ongoing) return left.ongoing ? -1 : 1;
    const leftStart = new Date(left.start).getTime();
    const rightStart = new Date(right.start).getTime();
    return rightStart - leftStart;
  });
  const showIncidents = !loading && !error && incidents.length > 0;

  return (
    <div className={className}>
      <section className="ui-surface-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{title}</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Real-time status and latency.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.generated_at && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 ui-caption font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Updated {formatTimestamp(data.generated_at)}
              </span>
            )}
            {action && (
              <Link
                to={action.to}
                className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
              >
                {action.label}
              </Link>
            )}
          </div>
        </div>

        {loading && (
          <div className="mt-3 h-28 animate-pulse rounded-xl border border-slate-200/80 bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70" />
        )}
        {!loading && error && (
          <p className="mt-3 ui-caption text-rose-600 dark:text-rose-300">{error}</p>
        )}
        {!loading && !error && (
          <>
            {showStatusCounters && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { key: "up" as const, label: "Up", value: data?.up_count ?? 0 },
                  { key: "degraded" as const, label: "Degraded", value: data?.degraded_count ?? 0 },
                  { key: "down" as const, label: "Down", value: data?.down_count ?? 0 },
                  { key: "unknown" as const, label: "Unknown", value: data?.unknown_count ?? 0 },
                ].map((item) => (
                  <div key={item.key} className={`rounded-lg border px-2.5 py-2 ${statusStatCardClass(item.key, item.value)}`}>
                    <p className="ui-caption font-medium opacity-85">{item.label}</p>
                    <p className="mt-1 ui-body font-semibold">{item.value}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 space-y-2">
              {(data?.endpoints ?? []).length === 0 && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">No endpoint linked to this workspace context.</p>
              )}
              {(data?.endpoints ?? []).slice(0, 6).map((endpoint) => (
                <div
                  key={endpoint.endpoint_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/30"
                >
                  <div className="min-w-0">
                    <p className="truncate ui-caption font-semibold text-slate-900 dark:text-slate-100">{endpoint.name}</p>
                    <p className="truncate ui-caption text-slate-500 dark:text-slate-400">
                      {formatLatency(endpoint.latency_ms)} · {formatCheckMode(endpoint.check_mode)} · {formatTimestamp(endpoint.checked_at)}
                    </p>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 ui-caption font-semibold ${statusPillClass(endpoint.status)}`}>
                    {statusLabel(endpoint.status)}
                  </span>
                </div>
              ))}
              {(data?.endpoints ?? []).length > 6 && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  +{(data?.endpoints ?? []).length - 6} more endpoint(s).
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {showIncidents && (
        <section className="ui-surface-card p-4">
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Ongoing / Recent Incidents</p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Ongoing incidents and incidents ended in the last {formatIncidentWindow(data?.incident_highlight_minutes)}.
          </p>
          <div className="mt-3 space-y-2">
            {orderedIncidents.slice(0, 5).map((incident, index) => (
              <div
                key={`${incident.endpoint_id}-${incident.start}-${index}`}
                className={`rounded-lg border px-3 py-2 ${
                  incident.ongoing
                    ? "border-amber-200/90 bg-amber-50/80 dark:border-amber-800/60 dark:bg-amber-900/20"
                    : "border-slate-200/90 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="ui-caption font-semibold text-slate-900 dark:text-slate-100">{incident.endpoint_name}</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold ${incidentStateBadgeClass(incident.ongoing)}`}>
                      {incident.ongoing ? "In progress" : "Resolved"}
                    </span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold ${statusPillClass(incident.status)}`}>
                      {statusLabel(incident.status)}
                    </span>
                  </div>
                </div>
                <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
                  {incident.ongoing ? "Ongoing since" : "From"} {formatTimestamp(incident.start)}
                  {incident.end ? ` to ${formatTimestamp(incident.end)}` : ""}
                </p>
              </div>
            ))}
            {orderedIncidents.length > 5 && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">+{orderedIncidents.length - 5} more incident(s).</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

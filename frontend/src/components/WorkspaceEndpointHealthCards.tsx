/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import { HealthCheckStatus, WorkspaceEndpointHealthOverviewResponse } from "../api/healthchecks";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiCardClass,
  uiCardMutedClass,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "./ui/styles";

function statusLabel(status: HealthCheckStatus) {
  if (status === "up") return "Up";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  return "Unknown";
}

function statusPillClass(status: HealthCheckStatus) {
  if (status === "up") return "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950 dark:text-emerald-100";
  if (status === "degraded") return "border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950 dark:text-amber-100";
  if (status === "down") return "border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950 dark:text-rose-100";
  return "border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text)]";
}

function statusStatCardClass(status: "up" | "degraded" | "down" | "unknown", value: number) {
  if (value <= 0) return "border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)]";
  if (status === "up") return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950 dark:text-emerald-100";
  if (status === "degraded") return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950 dark:text-amber-100";
  if (status === "down") return "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950 dark:text-rose-100";
  return "border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)]";
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
    return "border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950 dark:text-amber-100";
  }
  return "border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text)]";
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
      <section className={cx(uiCardClass, "p-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={cx("ui-body", uiTitleTextClass)}>{title}</p>
            <p className={cx("ui-caption", uiMutedTextClass)}>
              Real-time status and latency.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.generated_at && (
              <span className={cx("rounded-full border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-2.5 py-1 ui-caption font-medium", uiMutedTextClass)}>
                Updated {formatTimestamp(data.generated_at)}
              </span>
            )}
            {action && (
              <Link
                to={action.to}
                className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "rounded-md px-2.5 py-1.5 ui-caption")}
              >
                {action.label}
              </Link>
            )}
          </div>
        </div>

        {loading && (
          <div className={cx(uiPanelMutedClass, "mt-3 h-28 animate-pulse")} />
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
                <p className={cx("ui-caption", uiMutedTextClass)}>No endpoint linked to this workspace context.</p>
              )}
              {(data?.endpoints ?? []).slice(0, 6).map((endpoint) => (
                <div
                  key={endpoint.endpoint_id}
                  className={cx(uiCardMutedClass, "flex flex-wrap items-center justify-between gap-2 px-3 py-2")}
                >
                  <div className="min-w-0">
                    <p className={cx("truncate ui-caption", uiTitleTextClass)}>{endpoint.name}</p>
                    <p className={cx("truncate ui-caption", uiMutedTextClass)}>
                      {formatLatency(endpoint.latency_ms)} · {formatCheckMode(endpoint.check_mode)} · {formatTimestamp(endpoint.checked_at)}
                    </p>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 ui-caption font-semibold ${statusPillClass(endpoint.status)}`}>
                    {statusLabel(endpoint.status)}
                  </span>
                </div>
              ))}
              {(data?.endpoints ?? []).length > 6 && (
                <p className={cx("ui-caption", uiMutedTextClass)}>
                  +{(data?.endpoints ?? []).length - 6} more endpoint(s).
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {showIncidents && (
        <section className={cx(uiCardClass, "p-4")}>
          <p className={cx("ui-body", uiTitleTextClass)}>Ongoing / Recent Incidents</p>
          <p className={cx("ui-caption", uiMutedTextClass)}>
            Ongoing incidents and incidents ended in the last {formatIncidentWindow(data?.incident_highlight_minutes)}.
          </p>
          <div className="mt-3 space-y-2">
            {orderedIncidents.slice(0, 5).map((incident, index) => (
              <div
                key={`${incident.endpoint_id}-${incident.start}-${index}`}
                className={`rounded-lg border px-3 py-2 ${
                  incident.ongoing
                    ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950"
                    : "border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={cx("ui-caption", uiTitleTextClass)}>{incident.endpoint_name}</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold ${incidentStateBadgeClass(incident.ongoing)}`}>
                      {incident.ongoing ? "In progress" : "Resolved"}
                    </span>
                  </div>
                </div>
                <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                  {incident.ongoing ? "Ongoing since" : "From"} {formatTimestamp(incident.start)}
                  {incident.end ? ` to ${formatTimestamp(incident.end)}` : ""}
                </p>
              </div>
            ))}
            {orderedIncidents.length > 5 && (
              <p className={cx("ui-caption", uiMutedTextClass)}>+{orderedIncidents.length - 5} more incident(s).</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

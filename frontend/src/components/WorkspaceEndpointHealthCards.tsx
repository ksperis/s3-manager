/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import type { WorkspaceEndpointHealthOverviewResponse } from "../api/healthchecks";
import { formatLocalDateTime } from "../utils/dateTime";
import { WorkspaceStatusCounter, WorkspaceStatusDot, WorkspaceStatusPill } from "./WorkspaceDashboardKit";
import WorkspaceIncidentsCard from "./WorkspaceIncidentsCard";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiCardClass,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "./ui/styles";

function formatLatency(value?: number | null) {
  if (value == null) return "-";
  return `${value} ms`;
}

function formatCheckMode(mode?: string | null) {
  return (mode || "http").toUpperCase();
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
  const effectiveCounts = {
    up: data?.up_count ?? 0,
    degraded: data?.degraded_count ?? 0,
    down: data?.down_count ?? 0,
    unknown: data?.unknown_count ?? 0,
  };
  const showIncidents = !loading && !error && incidents.length > 0;

  return (
    <div className={className}>
      <section className={cx(uiCardClass, "p-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={cx("ui-body", uiTitleTextClass)}>{title}</p>
            <p className={cx("ui-caption", uiMutedTextClass)}>
              Stored status from the latest endpoint check.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.generated_at && (
              <span className={cx("rounded-full border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-2.5 py-1 ui-caption font-medium", uiMutedTextClass)}>
                Updated {formatLocalDateTime(data.generated_at)}
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
                  { key: "up" as const, label: "Up", value: effectiveCounts.up },
                  { key: "degraded" as const, label: "Degraded", value: effectiveCounts.degraded },
                  { key: "down" as const, label: "Down", value: effectiveCounts.down },
                  { key: "unknown" as const, label: "Unknown", value: effectiveCounts.unknown },
                ].map((item) => (
                  <WorkspaceStatusCounter key={item.key} label={item.label} value={item.value} status={item.key} />
                ))}
              </div>
            )}
            <div className="mt-3 space-y-2">
              {(data?.endpoints ?? []).length === 0 && (
                <p className={cx("ui-caption", uiMutedTextClass)}>No endpoint linked to this workspace context.</p>
              )}
              {(data?.endpoints ?? []).slice(0, 6).map((endpoint) => {
                const stale = endpoint.is_stale === true;
                const effectiveStatus = stale ? "unknown" : endpoint.status;
                return <div
                  key={endpoint.endpoint_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)]/45 px-3 py-2 dark:bg-transparent"
                >
                  <div className="min-w-0">
                    <p className={cx("flex min-w-0 items-center gap-2 truncate ui-caption", uiTitleTextClass)}>
                      <WorkspaceStatusDot status={effectiveStatus} className="shrink-0" />
                      <span className="truncate">{endpoint.name}</span>
                    </p>
                    <p className={cx("truncate ui-caption", uiMutedTextClass)}>
                      {formatLatency(endpoint.latency_ms)} · {formatCheckMode(endpoint.check_mode)} · Last check {formatLocalDateTime(endpoint.checked_at)}
                      {stale ? " · Stale" : ""}
                    </p>
                  </div>
                  <WorkspaceStatusPill status={effectiveStatus} className="ui-caption" />
                </div>
              })}
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
        <WorkspaceIncidentsCard
          incidents={incidents}
          loading={false}
          incidentHighlightMinutes={data?.incident_highlight_minutes}
          action={action}
        />
      )}
    </div>
  );
}

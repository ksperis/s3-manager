/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import type { WorkspaceEndpointIncidentEntry } from "../api/healthchecks";
import { OpenIcon } from "../features/browser/browserIcons";
import { cx, uiCardClass, uiCardMutedClass, uiMutedTextClass } from "./ui/styles";

const MAX_INCIDENT_ROWS = 5;

type WorkspaceIncidentsCardProps = {
  incidents: WorkspaceEndpointIncidentEntry[];
  loading: boolean;
  incidentHighlightMinutes?: number | null;
  action?: { to: string; label: string };
  showEmptyState?: boolean;
  className?: string;
};

function formatTimestamp(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatIncidentWindow(minutes?: number | null) {
  const value = Math.max(1, Number(minutes ?? 720));
  if (value % (24 * 60) === 0) {
    const days = value / (24 * 60);
    return `${days} day${days > 1 ? "s" : ""}`;
  }
  if (value % 60 === 0) {
    const hours = value / 60;
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  }
  return `${value} minute${value > 1 ? "s" : ""}`;
}

function sortIncidents(incidents: WorkspaceEndpointIncidentEntry[]) {
  return [...incidents].sort((left, right) => {
    if (left.ongoing !== right.ongoing) return left.ongoing ? -1 : 1;
    return new Date(right.start).getTime() - new Date(left.start).getTime();
  });
}

function incidentRowClass(ongoing: boolean) {
  if (ongoing) {
    return "border-amber-300/80 bg-amber-50/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-amber-500/35 dark:bg-amber-500/10 dark:shadow-none";
  }
  return "border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)]/45 dark:bg-transparent";
}

function incidentDotClass(ongoing: boolean) {
  return ongoing ? "bg-amber-500" : "bg-emerald-500";
}

function incidentBadgeClass(ongoing: boolean) {
  if (ongoing) {
    return "border-amber-300/80 bg-amber-100/80 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
  }
  return "border-[color:var(--ui-border)] bg-transparent text-[var(--ui-text-muted)]";
}

export default function WorkspaceIncidentsCard({
  incidents,
  loading,
  incidentHighlightMinutes,
  action,
  showEmptyState = false,
  className,
}: WorkspaceIncidentsCardProps) {
  const orderedIncidents = sortIncidents(incidents);
  const visibleIncidents = orderedIncidents.slice(0, MAX_INCIDENT_ROWS);
  const hiddenIncidentCount = Math.max(0, orderedIncidents.length - MAX_INCIDENT_ROWS);

  if (!loading && orderedIncidents.length === 0 && !showEmptyState) return null;

  return (
    <section className={cx(uiCardClass, "p-4", className)}>
      <div>
        <h2 className="ui-body font-semibold text-[var(--ui-text)]">Ongoing / Recent Incidents</h2>
        <p className={cx("mt-0.5 ui-caption", uiMutedTextClass)}>
          Ongoing incidents and incidents ended in the last {formatIncidentWindow(incidentHighlightMinutes)}.
        </p>
      </div>

      {loading ? (
        <div className={cx(uiCardMutedClass, "mt-4 h-48 animate-pulse")} />
      ) : orderedIncidents.length === 0 ? (
        <div className={cx(uiCardMutedClass, "mt-4 border-dashed px-3 py-6 text-center ui-caption", uiMutedTextClass)}>
          No ongoing or recent incidents.
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {visibleIncidents.map((incident, index) => (
              <div
                key={`${incident.endpoint_id}-${incident.start}-${index}`}
                data-incident-state={incident.ongoing ? "ongoing" : "resolved"}
                className={cx(
                  "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                  incidentRowClass(incident.ongoing)
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", incidentDotClass(incident.ongoing))}
                  />
                  <div className="min-w-0">
                    <p className="truncate ui-caption font-semibold text-[var(--ui-text)]">{incident.endpoint_name}</p>
                    <p className={cx("mt-0.5 truncate ui-caption", uiMutedTextClass)}>
                      {incident.ongoing ? "Ongoing since" : "From"} {formatTimestamp(incident.start)}
                      {incident.end ? ` to ${formatTimestamp(incident.end)}` : ""}
                    </p>
                  </div>
                </div>
                <span
                  className={cx(
                    "shrink-0 rounded-md border px-2 py-0.5 ui-caption font-semibold leading-4",
                    incidentBadgeClass(incident.ongoing)
                  )}
                >
                  {incident.ongoing ? "In progress" : "Resolved"}
                </span>
              </div>
            ))}
          </div>

          {(hiddenIncidentCount > 0 || action) && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              {hiddenIncidentCount > 0 ? (
                <p className="ui-caption font-medium text-primary">+ {hiddenIncidentCount} more incident(s)</p>
              ) : (
                <span />
              )}
              {action && (
                <Link to={action.to} className="inline-flex items-center gap-2 ui-caption font-semibold text-primary">
                  {action.label}
                  <OpenIcon className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

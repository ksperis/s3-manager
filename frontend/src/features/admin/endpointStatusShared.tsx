/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import type { HealthCheckStatus } from "../../api/healthchecks";

export const STATUS_LABELS: Record<HealthCheckStatus, string> = {
  unknown: "Unknown",
  up: "Up",
  degraded: "Degraded",
  down: "Down",
};

export function StatusPill({ status }: { status: HealthCheckStatus }) {
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

export function formatLatency(value?: number | null) {
  if (value == null) return "-";
  return `${value} ms`;
}

export function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatChartTime(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatChartDay(value: number | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit" }).format(date);
}

export function formatPercent(value?: number | null) {
  if (value == null) return "-";
  return `${value.toFixed(1)}%`;
}

export function formatCheckMode(mode?: string | null) {
  return (mode || "http").toUpperCase();
}

export function toTimestampMs(value: string) {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

export function statusStatCardClasses(status: "up" | "degraded" | "down" | "unknown", value: number) {
  if (value <= 0) {
    return "border-slate-200/80 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100";
  }
  if (status === "up") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-100";
  }
  if (status === "degraded") {
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-100";
  }
  if (status === "down") {
    return "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/60 dark:bg-rose-900/20 dark:text-rose-100";
  }
  return "border-slate-200/80 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100";
}

export function statusSegmentClass(status: HealthCheckStatus) {
  if (status === "up") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "down") return "bg-rose-500";
  return "bg-slate-300 dark:bg-slate-700";
}

export function statusTextClass(status: HealthCheckStatus) {
  if (status === "up") return "text-emerald-700 dark:text-emerald-300";
  if (status === "degraded") return "text-amber-700 dark:text-amber-300";
  if (status === "down") return "text-rose-700 dark:text-rose-300";
  return "text-slate-700 dark:text-slate-300";
}

export function statusChartColor(status: HealthCheckStatus) {
  if (status === "up") return "#10B981";
  if (status === "degraded") return "#F59E0B";
  if (status === "down") return "#EF4444";
  return "#94A3B8";
}

export function timelineLevelFromStatus(status: HealthCheckStatus) {
  if (status === "down") return 100;
  if (status === "degraded") return 60;
  if (status === "up") return 12;
  return 4;
}

export type TimelinePoint = {
  timestamp: string;
  end_timestamp?: string | null;
  status: HealthCheckStatus;
  latency_ms?: number | null;
  reason?: string | null;
};

type TimelineSegment = {
  status: HealthCheckStatus;
  startMs: number;
  endMs: number;
  latencyMs?: number | null;
  reason?: string | null;
};

export type TimelineSegmentDetail = TimelineSegment & {
  key: string;
  durationMs: number;
  cause?: string | null;
  startTimestamp: string;
  endTimestamp: string;
};

export function parseTimestampMs(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

export function formatDurationShort(durationMs: number) {
  const minutes = Math.max(0, Math.round(durationMs / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days} d ${remainingHours} h` : `${days} d`;
}

function timelineSegmentCause(status: HealthCheckStatus, latencyMs?: number | null, reason?: string | null) {
  if (reason) return reason;
  if (status === "down") return "Endpoint unavailable or check failure.";
  if (status === "degraded") {
    if (latencyMs != null) return `Latency elevated (${latencyMs} ms).`;
    return "Service degraded during this period.";
  }
  return null;
}

function buildTimelineSegments(points: TimelinePoint[], rangeStart?: string | null, rangeEnd?: string | null): TimelineSegment[] {
  const rangeStartMs = parseTimestampMs(rangeStart);
  const rangeEndMs = parseTimestampMs(rangeEnd);
  if (rangeStartMs == null || rangeEndMs == null || rangeEndMs <= rangeStartMs) return [];

  const sorted = [...points]
    .map((point) => ({ ...point, startMs: parseTimestampMs(point.timestamp) }))
    .filter((point): point is TimelinePoint & { startMs: number } => point.startMs != null)
    .sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return [];

  const segments: TimelineSegment[] = [];
  let cursor = rangeStartMs;
  sorted.forEach((point, index) => {
    const startMs = Math.max(point.startMs, rangeStartMs);
    const pointEndMs = parseTimestampMs(point.end_timestamp);
    const nextStartMs = sorted[index + 1]?.startMs ?? rangeEndMs;
    const endMs = Math.min(pointEndMs ?? nextStartMs, rangeEndMs);
    if (startMs > cursor) {
      segments.push({ status: "unknown", startMs: cursor, endMs: startMs });
    }
    if (endMs > startMs) {
      segments.push({
        status: point.status,
        startMs,
        endMs,
        latencyMs: point.latency_ms,
        reason: point.reason,
      });
      cursor = endMs;
    }
  });
  if (cursor < rangeEndMs) {
    segments.push({ status: "unknown", startMs: cursor, endMs: rangeEndMs });
  }
  const merged: TimelineSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push({ ...segment });
      continue;
    }
    const contiguous = segment.startMs <= previous.endMs + 1;
    if (contiguous && previous.status === segment.status) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      if (previous.latencyMs == null && segment.latencyMs != null) {
        previous.latencyMs = segment.latencyMs;
      }
      if (!previous.reason && segment.reason) {
        previous.reason = segment.reason;
      }
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

export function buildTimelineSegmentDetails(
  points: TimelinePoint[],
  rangeStart?: string | null,
  rangeEnd?: string | null
): TimelineSegmentDetail[] {
  const segments = buildTimelineSegments(points, rangeStart, rangeEnd);
  return segments.map((segment, index) => {
    const durationMs = Math.max(1, segment.endMs - segment.startMs);
    const cause = timelineSegmentCause(segment.status, segment.latencyMs, segment.reason);
    return {
      ...segment,
      key: `${segment.status}-${segment.startMs}-${segment.endMs}-${index}`,
      durationMs,
      cause,
      startTimestamp: new Date(segment.startMs).toISOString(),
      endTimestamp: new Date(segment.endMs).toISOString(),
    };
  });
}

export function EndpointTimelineBar({
  points,
  rangeStart,
  rangeEnd,
  className = "mt-2 h-3",
  selectedSegmentKey,
  onSegmentSelect,
}: {
  points: TimelinePoint[];
  rangeStart?: string | null;
  rangeEnd?: string | null;
  className?: string;
  selectedSegmentKey?: string | null;
  onSegmentSelect?: (segment: TimelineSegmentDetail) => void;
}) {
  const [hoveredSegmentKey, setHoveredSegmentKey] = useState<string | null>(null);
  const segments = useMemo(() => buildTimelineSegmentDetails(points, rangeStart, rangeEnd), [points, rangeStart, rangeEnd]);
  const rangeStartMs = parseTimestampMs(rangeStart);
  const rangeEndMs = parseTimestampMs(rangeEnd);
  const hasRange = rangeStartMs != null && rangeEndMs != null && rangeEndMs > rangeStartMs;
  if (!hasRange || segments.length === 0 || rangeStartMs == null || rangeEndMs == null) {
    return <div className={`${className} w-full rounded-md border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700`} />;
  }

  const rangeDurationMs = rangeEndMs - rangeStartMs;
  return (
    <div className={`${className} flex overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800`}>
      {segments.map((segmentDetail) => {
        const widthPct = (segmentDetail.durationMs / rangeDurationMs) * 100;
        const isHovered = hoveredSegmentKey === segmentDetail.key;
        const isSelected = selectedSegmentKey === segmentDetail.key;
        const lines = [
          `${STATUS_LABELS[segmentDetail.status]}`,
          `Start: ${formatTimestamp(segmentDetail.startTimestamp)}`,
          `End: ${formatTimestamp(segmentDetail.endTimestamp)}`,
          `Duration: ${formatDurationShort(segmentDetail.durationMs)}`,
        ];
        if (segmentDetail.cause) lines.push(`Cause: ${segmentDetail.cause}`);
        return (
          <div
            key={segmentDetail.key}
            role={onSegmentSelect ? "button" : undefined}
            tabIndex={onSegmentSelect ? 0 : undefined}
            onMouseEnter={() => {
              setHoveredSegmentKey(segmentDetail.key);
            }}
            onMouseLeave={() => {
              setHoveredSegmentKey(null);
            }}
            onClick={() => onSegmentSelect?.(segmentDetail)}
            onKeyDown={(event) => {
              if (!onSegmentSelect) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSegmentSelect(segmentDetail);
              }
            }}
            className={`h-full transition-all duration-150 ${statusSegmentClass(segmentDetail.status)} ${
              onSegmentSelect ? "cursor-pointer" : "cursor-default"
            } ${
              isHovered ? "brightness-125 ring-2 ring-inset ring-white/95 dark:ring-slate-100/90" : ""
            } ${isSelected ? "brightness-125 ring-2 ring-inset ring-white/95 dark:ring-slate-100/90" : ""}`}
            style={{ width: `${widthPct}%`, minWidth: "1px" }}
            title={lines.join("\n")}
          />
        );
      })}
    </div>
  );
}

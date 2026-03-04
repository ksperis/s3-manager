/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { EndpointHealthSeries, HealthCheckStatus, HealthWindow } from "../../api/healthchecks";
import { toTimestampMs } from "./endpointStatusShared";

export type LatencyDisplayMode = "rollup" | "daily";

export type LatencyChartPoint = {
  timestampMs: number;
  latency_ms: number | null;
  p95_latency_ms: number | null;
  status: HealthCheckStatus;
};

export type LatencyStatusBand = {
  startMs: number;
  endMs: number;
  status: "degraded" | "down";
};

function statusSeverity(status: HealthCheckStatus): number {
  if (status === "down") return 3;
  if (status === "degraded") return 2;
  if (status === "up") return 1;
  return 0;
}

export function deriveDailyStatusFromCounts(okCount: number, degradedCount: number, downCount: number): HealthCheckStatus {
  if (downCount > 0) return "down";
  if (degradedCount > 0) return "degraded";
  if (okCount > 0) return "up";
  return "unknown";
}

export function chooseLatencyDisplayMode(windowValue: HealthWindow | string, hasRollupSeries: boolean): LatencyDisplayMode {
  const isShortWindow = windowValue === "day" || windowValue === "week";
  if (isShortWindow && hasRollupSeries) return "rollup";
  return "daily";
}

export function buildLatencyChartPoints(
  series: EndpointHealthSeries | null,
  windowValue: HealthWindow | string
): { mode: LatencyDisplayMode; points: LatencyChartPoint[] } {
  const hasRollupSeries = (series?.series.length ?? 0) > 0;
  const mode = chooseLatencyDisplayMode(windowValue, hasRollupSeries);
  if (!series) {
    return { mode, points: [] };
  }

  if (mode === "rollup") {
    const points = series.series
      .map((point) => ({
        timestampMs: toTimestampMs(point.timestamp),
        latency_ms: point.latency_ms ?? null,
        p95_latency_ms: null,
        status: point.status ?? "unknown",
      }))
      .filter((point): point is LatencyChartPoint => point.timestampMs != null)
      .sort((a, b) => a.timestampMs - b.timestampMs);
    return { mode, points };
  }

  const points = series.daily
    .map((point) => ({
      timestampMs: toTimestampMs(point.day),
      latency_ms: point.avg_latency_ms ?? null,
      p95_latency_ms: point.p95_latency_ms ?? null,
      status: deriveDailyStatusFromCounts(point.ok_count, point.degraded_count, point.down_count),
    }))
    .filter((point): point is LatencyChartPoint => point.timestampMs != null)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  return { mode, points };
}

export function downsampleLatencySeries(points: LatencyChartPoint[], maxPoints = 1200): LatencyChartPoint[] {
  if (points.length <= maxPoints) return points;

  const chunkSize = Math.max(1, Math.ceil(points.length / maxPoints));
  const output: LatencyChartPoint[] = [];
  for (let index = 0; index < points.length; index += chunkSize) {
    const chunk = points.slice(index, index + chunkSize);
    if (chunk.length === 0) continue;
    const timestampMs = chunk[Math.floor(chunk.length / 2)]?.timestampMs ?? chunk[0].timestampMs;
    const latencies = chunk.map((point) => point.latency_ms).filter((value): value is number => value != null);
    const p95Values = chunk.map((point) => point.p95_latency_ms).filter((value): value is number => value != null);
    const hasNullLatency = chunk.some((point) => point.latency_ms == null);
    const hasNullP95 = chunk.some((point) => point.p95_latency_ms == null);
    const status = chunk.reduce<HealthCheckStatus>((acc, point) => {
      return statusSeverity(point.status) >= statusSeverity(acc) ? point.status : acc;
    }, "unknown");
    output.push({
      timestampMs,
      latency_ms: hasNullLatency ? null : latencies.length > 0 ? Math.round(latencies.reduce((acc, value) => acc + value, 0) / latencies.length) : null,
      p95_latency_ms: hasNullP95 ? null : p95Values.length > 0 ? Math.max(...p95Values) : null,
      status,
    });
  }
  return output;
}

export function buildLatencyStatusBands(
  points: LatencyChartPoint[],
  options?: { rangeStartMs?: number | null; rangeEndMs?: number | null }
): LatencyStatusBand[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.timestampMs - b.timestampMs);
  const rangeStartMs = options?.rangeStartMs ?? sorted[0].timestampMs;
  const rangeEndMs = options?.rangeEndMs ?? sorted[sorted.length - 1].timestampMs;
  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) {
    return [];
  }

  const segments: LatencyStatusBand[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index];
    if (point.status !== "down" && point.status !== "degraded") continue;
    const startMs = Math.max(point.timestampMs, rangeStartMs);
    const nextTimestamp = sorted[index + 1]?.timestampMs ?? rangeEndMs;
    const endMs = Math.min(nextTimestamp, rangeEndMs);
    if (endMs <= startMs) continue;
    segments.push({ startMs, endMs, status: point.status });
  }

  if (segments.length <= 1) return segments;

  const merged: LatencyStatusBand[] = [segments[0]];
  for (const segment of segments.slice(1)) {
    const previous = merged[merged.length - 1];
    const contiguous = segment.startMs <= previous.endMs + 1;
    if (contiguous && segment.status === previous.status) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

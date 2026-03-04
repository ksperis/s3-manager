import { describe, expect, it } from "vitest";
import type { EndpointHealthSeries } from "../../api/healthchecks";
import {
  buildLatencyChartPoints,
  buildLatencyStatusBands,
  chooseLatencyDisplayMode,
  deriveDailyStatusFromCounts,
  downsampleLatencySeries,
} from "./endpointStatusLatencyChart";

function buildSeries(overrides?: Partial<EndpointHealthSeries>): EndpointHealthSeries {
  return {
    endpoint_id: 12,
    window: "week",
    start: "2026-03-01T00:00:00.000Z",
    end: "2026-03-02T00:00:00.000Z",
    data_points: 4,
    check_mode: "http",
    check_target_url: "https://endpoint.example.test",
    check_type: "availability",
    scope: "endpoint",
    resolution_seconds: 300,
    series: [
      { timestamp: "2026-03-01T00:00:00.000Z", status: "up", latency_ms: 101, http_status: 200 },
      { timestamp: "2026-03-01T00:05:00.000Z", status: "degraded", latency_ms: 2500, http_status: 503 },
      { timestamp: "2026-03-01T00:10:00.000Z", status: "down", latency_ms: null, http_status: null },
      { timestamp: "2026-03-01T00:15:00.000Z", status: "down", latency_ms: null, http_status: null },
    ],
    daily: [
      { day: "2026-03-01", ok_count: 4, degraded_count: 1, down_count: 3, avg_latency_ms: 830, p95_latency_ms: 2200 },
      { day: "2026-03-02", ok_count: 0, degraded_count: 2, down_count: 0, avg_latency_ms: 1600, p95_latency_ms: 2100 },
    ],
    ...overrides,
  };
}

describe("endpointStatusLatencyChart", () => {
  it("chooses rollup mode on short windows when rollups exist", () => {
    expect(chooseLatencyDisplayMode("day", true)).toBe("rollup");
    expect(chooseLatencyDisplayMode("week", true)).toBe("rollup");
  });

  it("chooses daily mode on long windows even when rollups exist", () => {
    expect(chooseLatencyDisplayMode("month", true)).toBe("daily");
    expect(chooseLatencyDisplayMode("quarter", true)).toBe("daily");
    expect(chooseLatencyDisplayMode("half_year", true)).toBe("daily");
  });

  it("derives daily status with down > degraded > up > unknown priority", () => {
    expect(deriveDailyStatusFromCounts(10, 2, 1)).toBe("down");
    expect(deriveDailyStatusFromCounts(10, 2, 0)).toBe("degraded");
    expect(deriveDailyStatusFromCounts(10, 0, 0)).toBe("up");
    expect(deriveDailyStatusFromCounts(0, 0, 0)).toBe("unknown");
  });

  it("builds chart points using daily aggregates on month window", () => {
    const payload = buildLatencyChartPoints(buildSeries(), "month");
    expect(payload.mode).toBe("daily");
    expect(payload.points).toHaveLength(2);
    expect(payload.points[0].status).toBe("down");
    expect(payload.points[0].latency_ms).toBe(830);
    expect(payload.points[0].p95_latency_ms).toBe(2200);
    expect(payload.points[1].status).toBe("degraded");
  });

  it("merges contiguous bands by status and keeps boundaries between degraded/down", () => {
    const points = buildLatencyChartPoints(buildSeries(), "week").points;
    const t0 = points[0].timestampMs;
    const t1 = points[1].timestampMs;
    const t2 = points[2].timestampMs;
    const t3 = points[3].timestampMs;
    const t4 = t3 + 5 * 60 * 1000;
    const bands = buildLatencyStatusBands(points, { rangeStartMs: t0, rangeEndMs: t4 });

    expect(bands).toEqual([
      { startMs: t1, endMs: t2, status: "degraded" },
      { startMs: t2, endMs: t4, status: "down" },
    ]);
  });

  it("preserves latency holes when downsampling mixed chunks", () => {
    const points = [
      { timestampMs: 1, latency_ms: 100, p95_latency_ms: null, status: "up" as const },
      { timestampMs: 2, latency_ms: null, p95_latency_ms: null, status: "down" as const },
      { timestampMs: 3, latency_ms: 120, p95_latency_ms: null, status: "up" as const },
      { timestampMs: 4, latency_ms: null, p95_latency_ms: null, status: "degraded" as const },
    ];
    const sampled = downsampleLatencySeries(points, 2);

    expect(sampled).toHaveLength(2);
    expect(sampled[0].latency_ms).toBeNull();
    expect(sampled[1].latency_ms).toBeNull();
  });
});

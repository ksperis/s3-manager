import { describe, expect, it } from "vitest";
import type { ManagerTrafficStats } from "../api/stats";
import { buildWorkspaceStorageEvolutionPoints } from "./WorkspaceDashboardKit";
import {
  buildWorkspaceDashboardKpis,
  formatWorkspaceProjectedFull,
  formatWorkspaceSignedBytesDelta,
  selectWorkspaceTrafficTrend,
  workspaceStorageGrowthDelta,
} from "./workspaceDashboardKpis";

function trafficStats(window: string, bytesIn: number, bytesOut: number, timestamps: string[]): ManagerTrafficStats {
  return {
    window,
    start: timestamps[0] ?? "2026-06-10T00:00:00Z",
    end: timestamps.at(-1) ?? "2026-06-10T23:59:59Z",
    resolution: "day",
    data_points: timestamps.length,
    series: timestamps.map((timestamp) => ({ timestamp, bytes_in: bytesIn / timestamps.length, bytes_out: bytesOut / timestamps.length, ops: 1, success_ops: 1 })),
    totals: { bytes_in: bytesIn, bytes_out: bytesOut, ops: 1, success_ops: 1 },
    bucket_rankings: [],
    user_rankings: [],
    request_breakdown: [],
    category_breakdown: [],
  };
}

describe("workspaceDashboardKpis", () => {
  it("selects the same transfer trend priority as manager dashboards", () => {
    const selection = selectWorkspaceTrafficTrend({
      month: trafficStats("month", 1024, 1024, ["2026-05-10T00:00:00Z", "2026-06-10T00:00:00Z"]),
      week: trafficStats("week", 512, 256, ["2026-06-03T00:00:00Z", "2026-06-10T00:00:00Z"]),
      day: trafficStats("day", 256, 128, ["2026-06-10T00:00:00Z"]),
    });

    expect(selection).toEqual({ totalBytes: 2048, label: "last 30 days" });
  });

  it("builds the four shared KPI cards with storage, count, object and transfer trends", () => {
    const transferTrend = selectWorkspaceTrafficTrend({
      month: trafficStats("month", 1024, 1024, ["2026-05-10T00:00:00Z", "2026-06-10T00:00:00Z"]),
      day: trafficStats("day", 256, 128, ["2026-06-10T00:00:00Z"]),
    });

    const metrics = buildWorkspaceDashboardKpis({
      storage: {
        usedBytes: 512,
        quotaBytes: 1024,
        progressLabel: "Storage quota usage",
        trendBaseline: { window: "month", label: "last 30 days", period_start: "2026-05-10", used_bytes: 256 },
        icon: "storage",
      },
      spaces: {
        label: "Storage spaces",
        value: 1,
        quota: 4,
        unitLabel: "spaces",
        activeValue: 1,
        activeLabel: "active",
        progressLabel: "Storage spaces quota usage",
        trendBaseline: { window: "month", label: "last 30 days", period_start: "2026-05-10", bucket_count: 0 },
        trendBaselineValue: 0,
        tone: "emerald",
        icon: "spaces",
      },
      objects: {
        label: "Objects",
        value: 12,
        quota: 100,
        unitLabel: "objects",
        knownDetail: "Tracked objects",
        progressLabel: "Object quota usage",
        trendBaseline: { window: "month", label: "last 30 days", period_start: "2026-05-10", used_objects: 8 },
        trendBaselineValue: 8,
        tone: "violet",
        icon: "objects",
      },
      transfer: {
        bytes: 384,
        trendSelection: transferTrend,
        icon: "transfer",
      },
    });

    expect(metrics.map((metric) => metric.label)).toEqual(["Storage used", "Storage spaces", "Objects", "Transfer"]);
    expect(metrics[0].trend?.label).toBe("256 B vs last 30 days");
    expect(metrics[1].detail).toBe("1 / 4 spaces (25%)");
    expect(metrics[1].progress).toBe(25);
    expect(metrics[1].progressLabel).toBe("Storage spaces quota usage");
    expect(metrics[1].trend?.label).toBe("1 vs last 30 days");
    expect(metrics[2].trend?.label).toBe("4 vs last 30 days");
    expect(metrics[3].value).toBe("384 B");
    expect(metrics[3].detail).toBe("Last 24h");
    expect(metrics[3].trend?.label).toBe("2.0 KB vs last 30 days");
  });

  it("builds storage evolution points from a baseline and keeps a stable fallback without one", () => {
    const baselinePoints = buildWorkspaceStorageEvolutionPoints(
      512,
      { window: "week", label: "last week", period_start: "2026-06-03", used_bytes: 256 },
      "2026-06-10T00:00:00Z"
    );
    expect(baselinePoints).toHaveLength(10);
    expect(baselinePoints[0].usedBytes).toBe(256);
    expect(baselinePoints.at(-1)?.usedBytes).toBe(512);

    const stablePoints = buildWorkspaceStorageEvolutionPoints(512, null, "2026-06-10T00:00:00Z");
    expect(stablePoints).toHaveLength(10);
    expect(new Set(stablePoints.map((point) => point.usedBytes))).toEqual(new Set([512]));
  });

  it("formats shared storage overview growth and projected-full signals", () => {
    const baseline = { window: "week" as const, label: "last week", period_start: "2026-06-03", used_bytes: 256 };
    const growthDelta = workspaceStorageGrowthDelta(1024, baseline);

    expect(growthDelta).toBe(768);
    expect(formatWorkspaceSignedBytesDelta(growthDelta)).toBe("+768 B");
    expect(formatWorkspaceProjectedFull(1024, 2048, baseline)).toBe("~9 days");
    expect(formatWorkspaceProjectedFull(1024, 2048, { ...baseline, used_bytes: 1024 })).toBe("Stable");
    expect(formatWorkspaceProjectedFull(2048, 2048, baseline)).toBe("Full");
    expect(formatWorkspaceProjectedFull(1024, null, baseline)).toBe("-");
  });
});

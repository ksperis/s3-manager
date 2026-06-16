import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { BucketUsageStatsSnapshot } from "../../api/bucketUsageStats";
import { UsageStatsDistributionTooltip } from "./BucketUsageStatsCharts";
import BucketUsageStatsPanel from "./BucketUsageStatsPanel";

vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Bar: ({ children, dataKey }: { children?: ReactNode; dataKey?: string }) => (
      <div data-testid={`usage-stats-bar-${dataKey ?? "unknown"}`}>{children}</div>
    ),
    BarChart: Passthrough,
    CartesianGrid: Passthrough,
    Cell: () => null,
    Pie: Passthrough,
    PieChart: Passthrough,
    ResponsiveContainer: Passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

const snapshot: BucketUsageStatsSnapshot = {
  scope_kind: "manager",
  scope_id: "s3u-1",
  scope_name: "Managed user",
  bucket_name: "bucket-a",
  scan_mode: "versions",
  version_listing_available: true,
  object_version_count: 3,
  current_version_count: 2,
  noncurrent_version_count: 1,
  delete_marker_count: 1,
  total_bytes: 200,
  current_bytes: 160,
  noncurrent_bytes: 40,
  calculated_at: "2026-01-01T00:00:00Z",
  warnings: [],
  data_type_distribution: [
    { key: "documents", label: "Documents", count: 2, bytes: 140, ratio_count: 2 / 3, ratio_bytes: 0.7 },
    { key: "backups", label: "Backups", count: 1, bytes: 60, ratio_count: 1 / 3, ratio_bytes: 0.3 },
  ],
  storage_class_distribution: [
    { key: "STANDARD", label: "STANDARD", count: 2, bytes: 160, ratio_count: 2 / 3, ratio_bytes: 0.8 },
    { key: "GLACIER", label: "GLACIER", count: 1, bytes: 40, ratio_count: 1 / 3, ratio_bytes: 0.2 },
  ],
  size_distribution: [
    { key: "1_b_128_kib", label: "1 B-128 KiB", count: 3, bytes: 200, ratio_count: 1, ratio_bytes: 1 },
  ],
  age_distribution: [
    { key: "30_90d", label: "30-90d", count: 3, bytes: 200, ratio_count: 1, ratio_bytes: 1 },
  ],
  current_vs_noncurrent: [
    { key: "current", label: "Current versions", count: 2, bytes: 160, ratio_count: 2 / 3, ratio_bytes: 0.8 },
    { key: "noncurrent", label: "Non-current versions", count: 1, bytes: 40, ratio_count: 1 / 3, ratio_bytes: 0.2 },
  ],
};

describe("BucketUsageStatsPanel", () => {
  it("renders latest snapshot with current and non-current space ratios", () => {
    render(<BucketUsageStatsPanel snapshot={snapshot} />);

    expect(screen.getByText("Usage stats")).toBeInTheDocument();
    expect(screen.getByText("200 B")).toBeInTheDocument();
    expect(screen.getByText("160 B")).toBeInTheDocument();
    expect(screen.getByText("40 B")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("Current vs non-current")).toBeInTheDocument();
  });

  it("renders size and age distributions by version count while storage classes stay byte-based", () => {
    render(<BucketUsageStatsPanel snapshot={snapshot} />);

    const storageClassesPanel = screen.getByText("Storage classes").closest("div") as HTMLElement;
    const objectSizesPanel = screen.getByText("Object sizes").closest("div") as HTMLElement;
    const objectAgePanel = screen.getByText("Object age").closest("div") as HTMLElement;

    expect(within(storageClassesPanel).getByText("Logical bytes by storage class")).toBeInTheDocument();
    expect(within(storageClassesPanel).getByTestId("usage-stats-bar-bytes")).toBeInTheDocument();
    expect(within(objectSizesPanel).getByText("Version count by object size")).toBeInTheDocument();
    expect(within(objectSizesPanel).getByTestId("usage-stats-bar-count")).toBeInTheDocument();
    expect(within(objectAgePanel).getByText("Version count by last modified date")).toBeInTheDocument();
    expect(within(objectAgePanel).getByTestId("usage-stats-bar-count")).toBeInTheDocument();
  });

  it("renders distribution tooltips with the active chart metric first", () => {
    const entry = {
      key: "large",
      label: "Large objects",
      count: 12,
      bytes: 2048,
      ratio_count: 0.4,
      ratio_bytes: 0.9,
    };

    const { rerender } = render(<UsageStatsDistributionTooltip active payload={[{ payload: entry }]} bytesAxis={false} />);

    expect(screen.getByText("Large objects")).toBeInTheDocument();
    expect(screen.getByText("12 version(s) · 40%")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB logical bytes")).toBeInTheDocument();

    rerender(<UsageStatsDistributionTooltip active payload={[{ payload: entry }]} />);

    expect(screen.getByText("2.0 KB · 90%")).toBeInTheDocument();
    expect(screen.getByText("12 version(s)")).toBeInTheDocument();
  });

  it("shows fallback warning when version listing was unavailable", () => {
    render(<BucketUsageStatsPanel snapshot={{ ...snapshot, version_listing_available: false, current_vs_noncurrent: [] }} />);

    expect(screen.getByText(/Version listing was unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Unavailable for fallback current-only scans.")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ManagerTrafficStats } from "../api/stats";
import MetricsTrafficOverview from "./MetricsTrafficOverview";

vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Bar: ({ children, dataKey, name }: { children?: ReactNode; dataKey?: string; name?: string }) => (
      <div data-testid={`traffic-bar-${dataKey ?? "unknown"}`} data-name={name}>{children}</div>
    ),
    BarChart: Passthrough,
    CartesianGrid: () => null,
    Legend: () => null,
    ResponsiveContainer: Passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

const traffic: ManagerTrafficStats = {
  window: "week",
  start: "2026-07-24T00:00:00Z",
  end: "2026-07-30T00:00:00Z",
  resolution: "daily",
  data_points: 1,
  series: [
    { timestamp: "2026-07-30T00:00:00Z", bytes_in: 128, bytes_out: 64, ops: 2, success_ops: 2 },
  ],
  totals: { bytes_in: 128, bytes_out: 64, ops: 2, success_ops: 2, success_rate: 1 },
  bucket_rankings: [
    { bucket: "bucket-a", bytes_in: 128, bytes_out: 64, bytes_total: 192, ops: 2, success_ratio: 1 },
  ],
  user_rankings: [
    { user: "project-a", bytes_in: 128, bytes_out: 64, bytes_total: 192, ops: 2, success_ratio: 1 },
  ],
  request_breakdown: [],
  category_breakdown: [],
};

describe("MetricsTrafficOverview", () => {
  it("customizes traffic legends and can hide the bucket ranking", () => {
    render(
      <MetricsTrafficOverview
        traffic={traffic}
        window="week"
        onWindowChange={() => undefined}
        showBucketRanking={false}
        bucketRankingTitle="Storage Space ranking"
        userRankingTitle="Activity source"
        labels={{ ingress: "Uploaded", egress: "Downloaded" }}
      />,
    );

    expect(screen.getByTestId("traffic-bar-bytes_in")).toHaveAttribute("data-name", "Uploaded");
    expect(screen.getByTestId("traffic-bar-bytes_out")).toHaveAttribute("data-name", "Downloaded");
    expect(screen.queryByText("Storage Space ranking")).not.toBeInTheDocument();
    expect(screen.getByText("Activity source")).toBeInTheDocument();
  });

  it("does not invent zero totals when traffic data is absent", () => {
    render(
      <MetricsTrafficOverview
        traffic={null}
        window="week"
        onWindowChange={() => undefined}
        showEmpty
        labels={{ emptyMessage: "No scoped traffic" }}
      />,
    );

    expect(screen.getByText("No scoped traffic")).toBeInTheDocument();
    expect(screen.queryByText("0 B")).not.toBeInTheDocument();
  });
});

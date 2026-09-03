import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";

import CephAdminMetricsPage from "./CephAdminMetricsPage";

const useCephAdminEndpointMock = vi.fn();
const fetchCephAdminClusterStorageMock = vi.fn();
const fetchCephAdminClusterTrafficMock = vi.fn();
const getCephAdminUsageStatsAggregateMock = vi.fn();
const streamCephAdminUsageStatsAggregateMock = vi.fn();

vi.mock("./CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

vi.mock("../../api/cephAdminMetrics", () => ({
  fetchCephAdminClusterStorage: (...args: unknown[]) => fetchCephAdminClusterStorageMock(...args),
  fetchCephAdminClusterTraffic: (...args: unknown[]) => fetchCephAdminClusterTrafficMock(...args),
}));

vi.mock("../../api/bucketUsageStats", () => ({
  getCephAdminUsageStatsAggregate: (...args: unknown[]) => getCephAdminUsageStatsAggregateMock(...args),
  streamCephAdminUsageStatsAggregate: (...args: unknown[]) => streamCephAdminUsageStatsAggregateMock(...args),
}));

vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Area: Passthrough,
    AreaChart: Passthrough,
    Bar: Passthrough,
    BarChart: Passthrough,
    CartesianGrid: Passthrough,
    Cell: () => null,
    Legend: () => null,
    Pie: Passthrough,
    PieChart: Passthrough,
    ResponsiveContainer: Passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function makeApiError(detail: string) {
  return new ApiError("Request failed", {
    response: { status: 403, data: { detail }, headers: {} },
  });
}

function buildEndpoint(capabilities: { metrics?: boolean; usage?: boolean } = { metrics: true, usage: true }) {
  return {
    id: 7,
    name: "Ceph Endpoint",
    endpoint_url: "https://ceph.example.test",
    is_default: true,
    capabilities,
    tags: [],
  };
}

function buildEndpointContext(capabilities?: { metrics?: boolean; usage?: boolean }) {
  const endpoint = buildEndpoint(capabilities);
  return {
    endpoints: [endpoint],
    selectedEndpointId: endpoint.id,
    setSelectedEndpointId: vi.fn(),
    selectedEndpoint: endpoint,
    selectedEndpointAccess: {
      endpoint_id: endpoint.id,
      can_admin: true,
      can_metrics: true,
      can_accounts: true,
      admin_warning: null,
    },
    selectedEndpointAccessLoading: false,
    selectedEndpointAccessError: null,
    loading: false,
    error: null,
  };
}

function makeStorageMetrics() {
  return {
    total_buckets: 1,
    bucket_usage: [{ name: "alpha", used_bytes: 2048, object_count: 4, bucket_count: 1 }],
    owner_usage: [{ owner: "tenant-a", used_bytes: 2048, object_count: 4, bucket_count: 1 }],
    storage_totals: { used_bytes: 2048, object_count: 4, bucket_count: 1, owners_with_usage: 1 },
    generated_at: "2026-05-04T10:00:00Z",
  };
}

function makeTrafficMetrics() {
  return {
    window: "week",
    start: "2026-04-27T00:00:00Z",
    end: "2026-05-04T00:00:00Z",
    resolution: "day",
    data_points: 0,
    series: [],
    totals: { bytes_in: 0, bytes_out: 0, ops: 0, success_ops: 0, success_rate: null },
    bucket_rankings: [],
    user_rankings: [],
    request_breakdown: [],
    category_breakdown: [],
  };
}

function makeUsageStatsAggregate(overrides?: Record<string, unknown>) {
  return {
    scope_kind: "ceph_admin",
    scope_id: "7",
    scope_name: "Ceph Endpoint",
    bucket_count: 3,
    buckets_with_snapshot: 2,
    missing_bucket_count: 1,
    partial_scan_count: 0,
    object_version_count: 4,
    current_version_count: 3,
    noncurrent_version_count: 1,
    delete_marker_count: 1,
    total_bytes: 4096,
    current_bytes: 3072,
    noncurrent_bytes: 1024,
    oldest_snapshot_at: "2026-06-10T12:00:00Z",
    newest_snapshot_at: "2026-06-10T12:45:00Z",
    warnings: ["1 bucket has no calculated snapshot."],
    data_type_distribution: [
      { key: "documents", label: "Documents", count: 3, bytes: 3072, ratio_count: 0.75, ratio_bytes: 0.75 },
      { key: "archives", label: "Archives", count: 1, bytes: 1024, ratio_count: 0.25, ratio_bytes: 0.25 },
    ],
    storage_class_distribution: [
      { key: "STANDARD", label: "STANDARD", count: 4, bytes: 4096, ratio_count: 1, ratio_bytes: 1 },
    ],
    size_distribution: [],
    age_distribution: [],
    current_vs_noncurrent: [
      { key: "current", label: "Current versions", count: 3, bytes: 3072, ratio_count: 0.75, ratio_bytes: 0.75 },
      { key: "noncurrent", label: "Non-current versions", count: 1, bytes: 1024, ratio_count: 0.25, ratio_bytes: 0.25 },
    ],
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <CephAdminMetricsPage />
    </MemoryRouter>
  );
}

describe("CephAdminMetricsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext());
    fetchCephAdminClusterStorageMock.mockResolvedValue(makeStorageMetrics());
    fetchCephAdminClusterTrafficMock.mockResolvedValue(makeTrafficMetrics());
    getCephAdminUsageStatsAggregateMock.mockResolvedValue({ aggregate: makeUsageStatsAggregate() });
    streamCephAdminUsageStatsAggregateMock.mockResolvedValue({ status: "completed" });
  });

  it("keeps disabled storage metrics inside the storage snapshot card", async () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext({ metrics: false, usage: true }));

    renderPage();

    const message = screen.getByText("Storage metrics are disabled for this endpoint.");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage snapshot")).toBeInTheDocument();
    expect(within(storageCard as HTMLElement).queryByText("Stored volume & objects")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));
    expect(screen.getByText("RGW traffic")).toBeInTheDocument();
    expect(await screen.findAllByText("No usable metrics for this period yet.")).not.toHaveLength(0);
  });

  it("keeps disabled usage logs inside the traffic card", async () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext({ metrics: true, usage: false }));

    renderPage();

    expect(screen.getByText("Storage breakdown")).toBeInTheDocument();
    const storageCard = screen.getByText("Storage snapshot").closest("section");
    expect(storageCard).toHaveClass("ui-surface-card");
    expect(storageCard).not.toHaveClass("rounded-2xl");
    expect(storageCard?.className).not.toContain("bg-gradient-to-br");
    expect(
      await screen.findByText((_content, element) => element?.textContent?.startsWith("Updated:") ?? false)
    ).toBeInTheDocument();
    expect(screen.queryByText("Usage logs are disabled for this endpoint.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));

    const message = screen.getByText("Usage logs are disabled for this endpoint.");
    const trafficCard = message.closest("section");

    expect(trafficCard).not.toBeNull();
    expect(within(trafficCard as HTMLElement).getByText("RGW traffic")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).queryByText("Bandwidth & requests")).not.toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).queryByText("Egress")).not.toBeInTheDocument();
  });

  it("keeps usage composition visible when all live metrics are disabled", async () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext({ metrics: false, usage: false }));

    renderPage();

    expect(screen.getByText("Both storage metrics and usage logs are disabled for the selected endpoint.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Usage composition" }));
    expect(await screen.findByText("Cluster usage composition")).toBeInTheDocument();
    expect(screen.getByText("2 / 3 buckets covered")).toBeInTheDocument();
    expect(screen.queryByText("Storage metrics are disabled for this endpoint.")).not.toBeInTheDocument();
    expect(screen.queryByText("Usage logs are disabled for this endpoint.")).not.toBeInTheDocument();
  });

  it("keeps storage load errors inside the storage snapshot card", async () => {
    fetchCephAdminClusterStorageMock.mockRejectedValueOnce(makeApiError("Unable to load cluster storage metrics."));

    renderPage();

    const message = await screen.findByText("Unable to load cluster storage metrics.");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage snapshot")).toBeInTheDocument();
    expect(screen.queryByText("Storage breakdown")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));
    expect(screen.getByText("RGW traffic")).toBeInTheDocument();
  });

  it("keeps traffic load errors inside the traffic card without empty counters", async () => {
    fetchCephAdminClusterTrafficMock.mockRejectedValueOnce(makeApiError("Usage logs are disabled for this endpoint."));

    renderPage();

    expect(await screen.findByText("Storage breakdown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));
    const message = await screen.findByText("Usage logs are disabled for this endpoint.");
    const trafficCard = message.closest("section");

    expect(trafficCard).not.toBeNull();
    expect(within(trafficCard as HTMLElement).getByText("RGW traffic")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).queryByText("Egress")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage breakdown")).not.toBeInTheDocument();
  });

  it("recalculates cluster usage composition for the selected endpoint", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Usage composition" }));
    await screen.findByText("Cluster usage composition");
    expect(screen.queryByText("Storage breakdown")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recalculate cluster" }));
    expect(streamCephAdminUsageStatsAggregateMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Recalculate cluster usage composition" });
    expect(within(dialog).getByText(/can be costly/i)).toBeInTheDocument();
    expect(within(dialog).getByText("3 buckets")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Start recalculation" }));
    await waitFor(() =>
      expect(streamCephAdminUsageStatsAggregateMock).toHaveBeenCalledWith(7, { parallelism: 8 })
    );
    await waitFor(() => expect(getCephAdminUsageStatsAggregateMock).toHaveBeenCalledTimes(2));
  });
});

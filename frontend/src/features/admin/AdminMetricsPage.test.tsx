import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminMetricsPage from "./AdminMetricsPage";

const listStorageEndpointsMock = vi.fn();
const fetchAdminStorageMock = vi.fn();
const fetchAdminTrafficMock = vi.fn();
const fetchAdminUsageHistoryTrendsMock = vi.fn();
const getAdminUsageStatsAggregateMock = vi.fn();
const streamAdminUsageStatsAggregateMock = vi.fn();
let usageHistoryEnabled = false;

function makeAxiosError(detail: string) {
  return {
    isAxiosError: true,
    response: { data: { detail } },
    message: "Request failed with status code 403",
  };
}

function makeCephEndpoint() {
  return {
    id: 7,
    name: "Ceph main",
    provider: "ceph",
    endpoint_url: "https://ceph.example.test",
    is_default: true,
  };
}

function makeStorageStats() {
  return {
    total_accounts: 1,
    total_users: 1,
    total_admins: 1,
    total_s3_users: 1,
    total_buckets: 1,
    account_usage: [{ account_id: "tenant-a", account_name: "Tenant A", used_bytes: 2048, object_count: 4 }],
    s3_user_usage: [{ user_id: 1, user_name: "User A", rgw_user_uid: "user-a", used_bytes: 1024, object_count: 2 }],
    storage_totals: { used_bytes: 2048, object_count: 4, bucket_count: 1 },
    generated_at: "2026-05-04T10:00:00Z",
  };
}

function makeTrafficStats() {
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

function makeUsageHistoryTrends() {
  return {
    window: "month",
    granularity: "daily",
    available: true,
    unavailable_reason: null,
    points: [
      {
        period_start: "2026-05-04",
        used_bytes: 3072,
        used_objects: 6,
        bucket_count: 2,
        max_usage_ratio_pct: 50,
        subjects_count: 2,
        samples_count: 3,
        collected_at: "2026-05-04T10:00:00Z",
      },
    ],
    summary: {
      total_records: 3,
      points_count: 1,
      subjects_count: 2,
      latest_used_bytes: 3072,
      latest_used_objects: 6,
      latest_bucket_count: 2,
      latest_collected_at: "2026-05-04T10:00:00Z",
      max_usage_ratio_pct: 50,
    },
  };
}

function makeUsageStatsAggregate() {
  return {
    scope_kind: "admin_managed",
    scope_id: "7",
    scope_name: "Ceph main",
    managed_account_count: 2,
    accounts_with_listed_buckets: 2,
    skipped_account_count: 0,
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
    warnings: ["Some buckets do not have usage stats snapshots yet."],
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
  };
}

vi.mock("../../api/storageEndpoints", async () => {
  const actual = await vi.importActual<typeof import("../../api/storageEndpoints")>("../../api/storageEndpoints");
  return {
    ...actual,
    listStorageEndpoints: () => listStorageEndpointsMock(),
  };
});

vi.mock("../../api/stats", async () => {
  const actual = await vi.importActual<typeof import("../../api/stats")>("../../api/stats");
  return {
    ...actual,
    fetchAdminStorage: (...args: unknown[]) => fetchAdminStorageMock(...args),
    fetchAdminTraffic: (...args: unknown[]) => fetchAdminTrafficMock(...args),
  };
});

vi.mock("../../api/usageHistory", () => ({
  fetchAdminUsageHistoryTrends: (...args: unknown[]) => fetchAdminUsageHistoryTrendsMock(...args),
}));

vi.mock("../../api/bucketUsageStats", () => ({
  getAdminUsageStatsAggregate: (...args: unknown[]) => getAdminUsageStatsAggregateMock(...args),
  streamAdminUsageStatsAggregate: (...args: unknown[]) => streamAdminUsageStatsAggregateMock(...args),
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
    Line: Passthrough,
    LineChart: Passthrough,
    Pie: Passthrough,
    PieChart: Passthrough,
    ResponsiveContainer: Passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: { usage_history_enabled: usageHistoryEnabled },
  }),
}));

describe("AdminMetricsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usageHistoryEnabled = false;
    listStorageEndpointsMock.mockResolvedValue([]);
    fetchAdminStorageMock.mockResolvedValue(makeStorageStats());
    fetchAdminTrafficMock.mockResolvedValue(makeTrafficStats());
    fetchAdminUsageHistoryTrendsMock.mockResolvedValue(makeUsageHistoryTrends());
    getAdminUsageStatsAggregateMock.mockResolvedValue({ aggregate: makeUsageStatsAggregate() });
    streamAdminUsageStatsAggregateMock.mockResolvedValue({ status: "completed" });
  });

  it("renders the admin control strip and empty state when no ceph endpoint is available", async () => {
    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Metrics scope")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No Ceph endpoint available for metrics")).toBeInTheDocument();
    });
    expect(screen.getByRole("combobox", { name: "Ceph endpoint" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Ceph endpoint" })).toBeDisabled();
    expect(screen.getByText("Only Ceph endpoints are eligible for this page.")).toBeInTheDocument();
  });

  it("keeps disabled storage metrics inside the storage snapshot card", async () => {
    listStorageEndpointsMock.mockResolvedValue([makeCephEndpoint()]);
    fetchAdminStorageMock.mockRejectedValueOnce(makeAxiosError("Storage metrics are disabled for this endpoint"));

    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    const message = await screen.findByText("Storage metrics are disabled for this endpoint");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage snapshot")).toBeInTheDocument();
    expect(within(storageCard as HTMLElement).queryByText("Stored volume & objects")).not.toBeInTheDocument();
    expect(screen.queryByText("Accounts & users")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));
    expect(screen.getByText("RGW traffic")).toBeInTheDocument();
  });

  it("renders the storage snapshot with the shared card surface", async () => {
    listStorageEndpointsMock.mockResolvedValue([makeCephEndpoint()]);

    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    const storageCard = (await screen.findByText("Storage snapshot")).closest("section");

    expect(screen.getByRole("combobox", { name: "Ceph endpoint" })).toHaveValue("7");
    expect(storageCard).not.toBeNull();
    expect(storageCard).toHaveClass("ui-surface-card");
    expect(storageCard).not.toHaveClass("rounded-2xl");
    expect(storageCard?.className).not.toContain("bg-gradient-to-br");
  });

  it("renders managed accounts usage composition and recalculates the selected endpoint", async () => {
    listStorageEndpointsMock.mockResolvedValue([makeCephEndpoint()]);

    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Storage breakdown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Usage composition" }));
    expect(await screen.findByText("Managed accounts usage composition")).toBeInTheDocument();
    expect(screen.queryByText("Storage breakdown")).not.toBeInTheDocument();
    expect(screen.getByText("2 / 3 buckets covered")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent?.startsWith("2 / 2 managed accounts listed") ?? false)).toBeInTheDocument();
    expect(getAdminUsageStatsAggregateMock).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByRole("button", { name: "Recalculate endpoint" }));

    await waitFor(() => expect(streamAdminUsageStatsAggregateMock).toHaveBeenCalledWith(7, { parallelism: 8 }));
    await waitFor(() => expect(getAdminUsageStatsAggregateMock).toHaveBeenCalledTimes(2));
  });

  it("keeps disabled usage logs inside the traffic card without empty counters", async () => {
    listStorageEndpointsMock.mockResolvedValue([makeCephEndpoint()]);
    fetchAdminTrafficMock.mockRejectedValueOnce(makeAxiosError("Usage logs are disabled for this endpoint"));

    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    await screen.findByText("Storage breakdown");
    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));
    const message = await screen.findByText("Usage logs are disabled for this endpoint");
    const trafficCard = message.closest("section");

    expect(trafficCard).not.toBeNull();
    expect(within(trafficCard as HTMLElement).getByText("RGW traffic")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).queryByText("Bandwidth & requests")).not.toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).queryByText("Egress")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage breakdown")).not.toBeInTheDocument();
  });

  it("renders usage history trends when the feature is enabled", async () => {
    usageHistoryEnabled = true;
    listStorageEndpointsMock.mockResolvedValue([makeCephEndpoint()]);

    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Usage history" }));
    expect(await screen.findByText("Latest storage")).toBeInTheDocument();
    expect(screen.queryByText("Usage history trends")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("3.0 KB").length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(fetchAdminUsageHistoryTrendsMock).toHaveBeenCalledWith({
        window: "month",
        endpointId: 7,
        subjectType: "all",
      })
    );
  });

  it("hides usage history trends and avoids trend calls when the feature is disabled", async () => {
    usageHistoryEnabled = false;
    listStorageEndpointsMock.mockResolvedValue([makeCephEndpoint()]);

    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Storage snapshot")).toBeInTheDocument();
    expect(screen.queryByText("Usage history")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usage history" })).not.toBeInTheDocument();
    expect(fetchAdminUsageHistoryTrendsMock).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalUsagePage from "./PortalUsagePage";

const mocks = vi.hoisted(() => ({
  billingMock: vi.fn(),
  usageHistoryMock: vi.fn(),
  usageStatsMock: vi.fn(),
  hookArgs: [] as unknown[],
  hookResult: {
    workspace: {
      spaces: [
        {
          id: "research-data",
          name: "Research Data",
          usedBytes: 512,
          objectCount: 12,
          quotaBytes: 1024,
        },
      ],
      usedBytes: 512,
      usedObjects: 12,
      quotaBytes: 1024,
    },
    storageSpaces: [
      {
        id: "research-data",
        name: "Research Data",
        role: "Owner",
        used_bytes: 512,
        object_count: 12,
        quota_max_size_bytes: 1024,
      },
    ],
    usage: {
      used_bytes: 512,
      used_objects: 12,
      quota_max_size_bytes: 1024,
      storage_spaces: [{ id: "research-data", name: "Research Data", used_bytes: 512, object_count: 12 }],
    },
    usageLoading: false,
    usageError: null,
    traffic: {
      window: "week",
      start: "2026-05-20T00:00:00Z",
      end: "2026-05-21T00:00:00Z",
      resolution: "day",
      data_points: 2,
      series: [
        { timestamp: "2026-05-20T00:00:00Z", bytes_in: 100, bytes_out: 50, ops: 10, success_ops: 10 },
        { timestamp: "2026-05-21T00:00:00Z", bytes_in: 200, bytes_out: 75, ops: 20, success_ops: 20 },
      ],
      totals: { bytes_in: 300, bytes_out: 125, ops: 30, success_ops: 30, success_rate: 1 },
      bucket_rankings: [{ bucket: "research-data", bytes_total: 425, bytes_in: 300, bytes_out: 125, ops: 30, success_ops: 30 }],
      user_rankings: [{ user: "manager@example.com", bytes_total: 425, bytes_in: 300, bytes_out: 125, ops: 30, success_ops: 30 }],
      request_breakdown: [{ group: "GET", bytes_in: 0, bytes_out: 125, ops: 10 }],
      category_breakdown: [],
    },
    trafficLoading: false,
    trafficError: null,
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
    accountIdForApi: "101",
    state: { quota_max_size_bytes: 1024 },
  } as any,
}));

vi.mock("../../api/billing", () => ({
  getPortalBillingMe: (...args: unknown[]) => mocks.billingMock(...args),
}));

vi.mock("../../api/portal", () => ({
  fetchPortalUsageHistoryTrends: (...args: unknown[]) => mocks.usageHistoryMock(...args),
  getPortalUsageStatsAggregate: (...args: unknown[]) => mocks.usageStatsMock(...args),
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: (options: unknown) => {
    mocks.hookArgs.push(options);
    return mocks.hookResult;
  },
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

function mockBilling() {
  mocks.billingMock.mockResolvedValue({
    month: "2026-05",
    subject_type: "account",
    subject_id: 101,
    name: "Research",
    daily: [
      { day: "2026-05-20", storage_bytes: 400, bytes_in: 100, bytes_out: 50, ops_total: 10 },
      { day: "2026-05-21", storage_bytes: 512, bytes_in: 200, bytes_out: 75, ops_total: 20 },
    ],
    usage: { bytes_in: 300, bytes_out: 125, ops_total: 30 },
    storage: { avg_bytes: 456, total_objects: 12 },
    coverage: { days_collected: 2, days_in_month: 31, coverage_ratio: 0.06 },
    cost: { total_cost: 1.25, currency: "EUR", rate_card_name: "default" },
  });
}

function mockUsageComposition() {
  mocks.usageStatsMock.mockResolvedValue({
    aggregate: {
      scope_kind: "portal",
      scope_id: "101",
      scope_name: "Research",
      bucket_count: 1,
      buckets_with_snapshot: 1,
      missing_bucket_count: 0,
      partial_scan_count: 0,
      object_version_count: 12,
      current_version_count: 12,
      noncurrent_version_count: 0,
      delete_marker_count: 0,
      total_bytes: 512,
      current_bytes: 512,
      noncurrent_bytes: 0,
      data_type_distribution: [{ key: "documents", label: "Documents", count: 12, bytes: 512, ratio_count: 1, ratio_bytes: 1 }],
      storage_class_distribution: [{ key: "STANDARD", label: "STANDARD", count: 12, bytes: 512, ratio_count: 1, ratio_bytes: 1 }],
      size_distribution: [],
      age_distribution: [],
      current_vs_noncurrent: [
        { key: "current", label: "Current versions", count: 12, bytes: 512, ratio_count: 1, ratio_bytes: 1 },
        { key: "noncurrent", label: "Non-current versions", count: 0, bytes: 0, ratio_count: 0, ratio_bytes: 0 },
      ],
      warnings: [],
      oldest_snapshot_at: "2026-05-20T00:00:00Z",
      newest_snapshot_at: "2026-05-21T00:00:00Z",
    },
  });
}

function mockUsageHistory() {
  mocks.usageHistoryMock.mockResolvedValue({
    window: "month",
    granularity: "daily",
    available: true,
    points: [
      {
        period_start: "2026-05-20",
        used_bytes: 400,
        used_objects: 10,
        bucket_count: 1,
        max_usage_ratio_pct: 40,
        subjects_count: 1,
        samples_count: 1,
        collected_at: "2026-05-20T12:00:00Z",
      },
      {
        period_start: "2026-05-21",
        used_bytes: 512,
        used_objects: 12,
        bucket_count: 1,
        max_usage_ratio_pct: 50,
        subjects_count: 1,
        samples_count: 1,
        collected_at: "2026-05-21T12:00:00Z",
      },
    ],
    summary: {
      total_records: 2,
      points_count: 2,
      subjects_count: 1,
      latest_used_bytes: 512,
      latest_used_objects: 12,
      latest_bucket_count: 1,
      latest_collected_at: "2026-05-21T12:00:00Z",
      max_usage_ratio_pct: 50,
    },
  });
}

describe("PortalUsagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hookArgs.length = 0;
    mocks.hookResult.workspace = {
      spaces: [
        {
          id: "research-data",
          name: "Research Data",
          usedBytes: 512,
          objectCount: 12,
          quotaBytes: 1024,
        },
      ],
      usedBytes: 512,
      usedObjects: 12,
      quotaBytes: 1024,
    };
    mocks.hookResult.storageSpaces = [
      {
        id: "research-data",
        name: "Research Data",
        role: "Owner",
        used_bytes: 512,
        object_count: 12,
        quota_max_size_bytes: 1024,
      },
    ];
    mocks.hookResult.usage = {
      used_bytes: 512,
      used_objects: 12,
      quota_max_size_bytes: 1024,
      storage_spaces: [{ id: "research-data", name: "Research Data", used_bytes: 512, object_count: 12 }],
    };
    mocks.hookResult.usageLoading = false;
    mocks.hookResult.usageError = null;
    mocks.hookResult.traffic = {
      window: "week",
      start: "2026-05-20T00:00:00Z",
      end: "2026-05-21T00:00:00Z",
      resolution: "day",
      data_points: 2,
      series: [
        { timestamp: "2026-05-20T00:00:00Z", bytes_in: 100, bytes_out: 50, ops: 10, success_ops: 10 },
        { timestamp: "2026-05-21T00:00:00Z", bytes_in: 200, bytes_out: 75, ops: 20, success_ops: 20 },
      ],
      totals: { bytes_in: 300, bytes_out: 125, ops: 30, success_ops: 30, success_rate: 1 },
      bucket_rankings: [{ bucket: "research-data", bytes_total: 425, bytes_in: 300, bytes_out: 125, ops: 30, success_ops: 30 }],
      user_rankings: [{ user: "manager@example.com", bytes_total: 425, bytes_in: 300, bytes_out: 125, ops: 30, success_ops: 30 }],
      request_breakdown: [{ group: "GET", bytes_in: 0, bytes_out: 125, ops: 10 }],
      category_breakdown: [],
    };
    mocks.hookResult.trafficLoading = false;
    mocks.hookResult.trafficError = null;
    mocks.hookResult.state = { quota_max_size_bytes: 1024 };
    mockBilling();
    mockUsageComposition();
    mockUsageHistory();
  });

  it("renders storage, Storage Spaces, usage composition, history, traffic and visible billing analytics", async () => {
    render(<PortalUsagePage />);

    expect(screen.getByRole("heading", { name: "Usage & Analytics" })).toBeInTheDocument();
    expect(screen.getByText("Storage snapshot")).toBeInTheDocument();
    expect(screen.getByText("Stored volume")).toBeInTheDocument();
    expect(screen.getByText("50% of quota")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Storage Spaces" }));

    expect(screen.getByText("Storage Spaces (volume)")).toBeInTheDocument();
    expect(screen.getByText("Storage Spaces (objects)")).toBeInTheDocument();
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Usage composition" }));

    expect(await screen.findByText("Logical bytes")).toBeInTheDocument();
    expect(screen.getByText("1 / 1 Storage Spaces covered")).toBeInTheDocument();
    expect(mocks.usageStatsMock).toHaveBeenCalledWith("101");

    fireEvent.click(screen.getByRole("button", { name: "Usage history" }));

    expect(await screen.findByText("Storage evolution")).toBeInTheDocument();
    expect(screen.getByText("Latest storage")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    await waitFor(() => {
      expect(mocks.usageHistoryMock).toHaveBeenLastCalledWith("101", "week");
    });

    fireEvent.click(screen.getByRole("button", { name: "Traffic" }));

    expect(screen.getByRole("heading", { name: "Traffic" })).toBeInTheDocument();
    expect(screen.getByText("Egress")).toBeInTheDocument();
    expect(screen.getByText("Ingress")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    await waitFor(() => {
      const lastHookArgs = mocks.hookArgs[mocks.hookArgs.length - 1] as { trafficWindow?: string };
      expect(lastHookArgs.trafficWindow).toBe("month");
    });

    fireEvent.click(screen.getByRole("button", { name: "Billing" }));

    expect(await screen.findByText("€1.25")).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("2/31 days")).toBeInTheDocument();
    expect(mocks.billingMock).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), "101");
  });

  it("keeps unavailable usage, traffic and billing states inside their tabs", async () => {
    mocks.hookResult.workspace = {
      spaces: [{ id: "empty-space", name: "Empty Space", usedBytes: null, objectCount: null, quotaBytes: null }],
      usedBytes: null,
      usedObjects: null,
      quotaBytes: null,
    };
    mocks.hookResult.storageSpaces = [
      { id: "empty-space", name: "Empty Space", role: "Viewer", used_bytes: null, object_count: null, quota_max_size_bytes: null },
    ];
    mocks.hookResult.usage = { used_bytes: null, used_objects: null, storage_spaces: [] };
    mocks.hookResult.traffic = null;
    mocks.hookResult.trafficError = "Traffic data is unavailable.";
    mocks.hookResult.state = { quota_max_size_bytes: null };
    mocks.billingMock.mockRejectedValue(new Error("billing disabled"));
    mocks.usageStatsMock.mockRejectedValue(new Error("usage stats disabled"));
    mocks.usageHistoryMock.mockResolvedValue({
      window: "month",
      granularity: "daily",
      available: false,
      unavailable_reason: "Usage history is disabled.",
      points: [],
      summary: {
        total_records: 0,
        points_count: 0,
        subjects_count: 0,
        latest_used_bytes: 0,
        latest_used_objects: 0,
        latest_bucket_count: 0,
        latest_collected_at: null,
        max_usage_ratio_pct: null,
      },
    });

    render(<PortalUsagePage />);

    expect(screen.getAllByText("Quota unavailable").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Storage Spaces" }));
    expect(screen.getByText("No Storage Space volume metrics available.")).toBeInTheDocument();
    expect(screen.getByText("No Storage Space object metrics available.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usage composition" }));
    expect(await screen.findByText("usage stats disabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usage history" }));
    expect(await screen.findByText("Usage history is disabled.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Traffic" }));
    expect(screen.getByText("Traffic data is unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Egress")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Billing" }));
    await waitFor(() => {
      expect(screen.getByText("Billing source is disabled or unavailable.")).toBeInTheDocument();
    });
  });
});

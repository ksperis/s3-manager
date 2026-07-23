import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import ManagerMetricsPage from "./ManagerMetricsPage";

const useS3AccountContextMock = vi.fn();
const useManagerStatsMock = vi.fn();
const fetchManagerUsageHistoryTrendsMock = vi.fn();
const getManagerUsageStatsAggregateMock = vi.fn();
const streamManagerUsageStatsAggregateMock = vi.fn();
let usageHistoryEnabled = false;
let bucketUsageStatsEnabled = false;

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("./useManagerStats", () => ({
  useManagerStats: (...args: unknown[]) => useManagerStatsMock(...args),
}));

vi.mock("../../api/usageHistory", () => ({
  fetchManagerUsageHistoryTrends: (...args: unknown[]) => fetchManagerUsageHistoryTrendsMock(...args),
}));

vi.mock("../../api/bucketUsageStats", () => ({
  getManagerUsageStatsAggregate: (...args: unknown[]) => getManagerUsageStatsAggregateMock(...args),
  streamManagerUsageStatsAggregate: (...args: unknown[]) => streamManagerUsageStatsAggregateMock(...args),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      usage_history_enabled: usageHistoryEnabled,
      bucket_usage_stats_enabled: bucketUsageStatsEnabled,
    },
  }),
}));

vi.mock("./TrafficAnalytics", () => ({
  default: ({ visible = true }: { visible?: boolean }) => (visible ? <div data-testid="traffic-analytics">traffic</div> : null),
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

function buildContext({
  managerStatsEnabled = true,
  managerStatsMessage = null,
  capabilities = { metrics: true, usage: true },
  contextId = "conn-1",
  accessMode = "connection",
}: {
  managerStatsEnabled?: boolean;
  managerStatsMessage?: string | null;
  capabilities?: { metrics?: boolean; usage?: boolean };
  contextId?: string;
  accessMode?: string;
} = {}) {
  return {
    accounts: [
      {
        id: contextId,
        display_name: "Ceph connection",
        storage_endpoint_capabilities: capabilities,
      },
    ],
    selectedS3AccountId: contextId,
    requiresS3AccountSelection: true,
    hasS3AccountContext: true,
    accountIdForApi: contextId,
    accessMode,
    managerStatsEnabled,
    managerStatsMessage,
  };
}

function buildStatsResult(overrides?: Record<string, unknown>) {
  return {
    stats: {
      total_buckets: 1,
      total_iam_users: 0,
      total_iam_groups: 0,
      total_iam_roles: 0,
      total_iam_policies: 0,
      bucket_usage: [{ name: "alpha", used_bytes: 42, object_count: 2 }],
    },
    loading: false,
    error: null,
    reload: vi.fn(),
    ...overrides,
  };
}

function buildUsageHistoryTrends(overrides?: Record<string, unknown>) {
  return {
    window: "month",
    granularity: "daily",
    available: true,
    unavailable_reason: null,
    points: [
      {
        period_start: "2026-06-08",
        used_bytes: 4096,
        used_objects: 8,
        bucket_count: 2,
        max_usage_ratio_pct: 42,
        subjects_count: 1,
        samples_count: 2,
        collected_at: "2026-06-08T12:00:00Z",
      },
    ],
    summary: {
      total_records: 2,
      points_count: 1,
      subjects_count: 1,
      latest_used_bytes: 4096,
      latest_used_objects: 8,
      latest_bucket_count: 2,
      latest_collected_at: "2026-06-08T12:00:00Z",
      max_usage_ratio_pct: 42,
    },
    ...overrides,
  };
}

function buildUsageStatsAggregate(overrides?: Record<string, unknown>) {
  return {
    scope_kind: "manager",
    scope_id: "conn-1",
    scope_name: "Ceph connection",
    bucket_count: 2,
    buckets_with_snapshot: 1,
    missing_bucket_count: 1,
    partial_scan_count: 0,
    object_version_count: 3,
    current_version_count: 2,
    noncurrent_version_count: 1,
    delete_marker_count: 1,
    total_bytes: 2048,
    current_bytes: 1536,
    noncurrent_bytes: 512,
    oldest_snapshot_at: "2026-06-10T12:00:00Z",
    newest_snapshot_at: "2026-06-10T12:30:00Z",
    warnings: ["1 / 2 buckets covered."],
    data_type_distribution: [
      { key: "documents", label: "Documents", count: 2, bytes: 1536, ratio_count: 2 / 3, ratio_bytes: 0.75 },
      { key: "images", label: "Images", count: 1, bytes: 512, ratio_count: 1 / 3, ratio_bytes: 0.25 },
    ],
    storage_class_distribution: [
      { key: "STANDARD", label: "STANDARD", count: 3, bytes: 2048, ratio_count: 1, ratio_bytes: 1 },
    ],
    size_distribution: [],
    age_distribution: [],
    current_vs_noncurrent: [
      { key: "current", label: "Current versions", count: 2, bytes: 1536, ratio_count: 2 / 3, ratio_bytes: 0.75 },
      { key: "noncurrent", label: "Non-current versions", count: 1, bytes: 512, ratio_count: 1 / 3, ratio_bytes: 0.25 },
    ],
    ...overrides,
  };
}

function setManagerUser() {
  localStorage.setItem(
    "user",
    JSON.stringify({
      role: "ui_user",
      capabilities: { can_manage_buckets: true },
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        feature_rules: false,
        bucket_quota: false,
        ceph_s3_user_keys: true,
      },
    })
  );
}

describe("ManagerMetricsPage", () => {
  beforeEach(() => {
    useManagerStatsMock.mockReset();
    useS3AccountContextMock.mockReset();
    fetchManagerUsageHistoryTrendsMock.mockReset();
    getManagerUsageStatsAggregateMock.mockReset();
    streamManagerUsageStatsAggregateMock.mockReset();
    fetchManagerUsageHistoryTrendsMock.mockResolvedValue(buildUsageHistoryTrends());
    getManagerUsageStatsAggregateMock.mockResolvedValue({ aggregate: buildUsageStatsAggregate() });
    streamManagerUsageStatsAggregateMock.mockResolvedValue({ status: "completed" });
    usageHistoryEnabled = false;
    bucketUsageStatsEnabled = false;
    localStorage.clear();
  });

  it("renders usage and traffic widgets for eligible connection context", () => {
    useS3AccountContextMock.mockReturnValue(buildContext());
    useManagerStatsMock.mockReturnValue(buildStatsResult());

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Bucket breakdown (storage)")).toBeInTheDocument();
    expect(screen.getByText("Bucket breakdown (objects)")).toBeInTheDocument();
    expect(screen.queryByTestId("traffic-analytics")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));
    expect(screen.getByTestId("traffic-analytics")).toBeInTheDocument();
    expect(
      screen.queryByText("Connection context: platform metrics are disabled. Use a platform account with supervision enabled to access usage and traffic analytics.")
    ).not.toBeInTheDocument();
  });

  it("shows backend reason when metrics are unavailable for selected context", () => {
    useS3AccountContextMock.mockReturnValue(
      buildContext({
        managerStatsEnabled: false,
        managerStatsMessage: "Metrics are unavailable: unable to resolve RGW identity for this connection.",
      })
    );
    useManagerStatsMock.mockReturnValue(buildStatsResult({ stats: null }));

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    expect(
      screen.getByText("Metrics are unavailable: unable to resolve RGW identity for this connection.")
    ).toBeInTheDocument();
    expect(screen.getByText("Metrics are unavailable for this context")).toBeInTheDocument();
    expect(screen.queryByText("Bucket breakdown (storage)")).not.toBeInTheDocument();
    expect(screen.queryByTestId("traffic-analytics")).not.toBeInTheDocument();
  });

  it("keeps disabled storage analytics inside a storage card", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ capabilities: { metrics: false, usage: true } }));
    useManagerStatsMock.mockReturnValue(buildStatsResult({ stats: null }));

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    const message = screen.getByText("Storage analytics are disabled for this endpoint.");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage analytics")).toBeInTheDocument();
    expect(within(storageCard as HTMLElement).queryByText("Bucket breakdown")).not.toBeInTheDocument();
    expect(screen.queryByText("Bucket breakdown (storage)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));
    expect(screen.getByTestId("traffic-analytics")).toBeInTheDocument();
  });

  it("keeps disabled traffic analytics inside a traffic card", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ capabilities: { metrics: true, usage: false } }));
    useManagerStatsMock.mockReturnValue(buildStatsResult());

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Bucket breakdown (storage)")).toBeInTheDocument();
    expect(screen.queryByText("Traffic analytics are disabled for this endpoint.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));

    const message = screen.getByText("Traffic analytics are disabled for this endpoint.");
    const trafficCard = message.closest("section");

    expect(trafficCard).not.toBeNull();
    expect(within(trafficCard as HTMLElement).getByText("Traffic")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).queryByText("Traffic visualization")).not.toBeInTheDocument();
    expect(screen.queryByTestId("traffic-analytics")).not.toBeInTheDocument();
  });

  it("keeps the full-page empty state when all metrics are disabled", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ capabilities: { metrics: false, usage: false } }));
    useManagerStatsMock.mockReturnValue(buildStatsResult({ stats: null }));

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Metrics are disabled for this endpoint")).toBeInTheDocument();
    expect(screen.queryByText("Storage analytics are disabled for this endpoint.")).not.toBeInTheDocument();
    expect(screen.queryByText("Traffic analytics are disabled for this endpoint.")).not.toBeInTheDocument();
  });

  it("keeps manager stats errors inside the storage card", () => {
    useS3AccountContextMock.mockReturnValue(buildContext());
    useManagerStatsMock.mockReturnValue(
      buildStatsResult({
        stats: null,
        error: "Storage metrics are not available for this credential.",
      })
    );

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    const message = screen.getByText("Storage metrics are not available for this credential.");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage analytics")).toBeInTheDocument();
    expect(screen.queryByText("Bucket breakdown (storage)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Traffic" }));
    expect(screen.getByTestId("traffic-analytics")).toBeInTheDocument();
  });

  it("renders usage history trends for eligible account contexts", async () => {
    usageHistoryEnabled = true;
    useS3AccountContextMock.mockReturnValue(buildContext({ contextId: "1", accessMode: "account" }));
    useManagerStatsMock.mockReturnValue(buildStatsResult());

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("tab", { name: "Usage history" }));
    expect(await screen.findByText("Latest storage")).toBeInTheDocument();
    expect(screen.queryByText("Usage history trends")).not.toBeInTheDocument();
    expect(screen.getByText("Storage evolution").parentElement).not.toHaveClass("ui-surface-muted");
    expect(screen.getByText("Objects & buckets").parentElement).not.toHaveClass("ui-surface-muted");
    expect(screen.getByText("4.0 KB")).toBeInTheDocument();
    await waitFor(() => expect(fetchManagerUsageHistoryTrendsMock).toHaveBeenCalledWith("1", "month"));
  });

  it("shows usage history unavailable copy for private connection contexts", async () => {
    usageHistoryEnabled = true;
    fetchManagerUsageHistoryTrendsMock.mockResolvedValueOnce(
      buildUsageHistoryTrends({
        available: false,
        unavailable_reason:
          "Usage history trends are unavailable for private connection contexts because snapshots are stored for RGW accounts and legacy S3 users.",
        points: [],
      })
    );
    useS3AccountContextMock.mockReturnValue(buildContext());
    useManagerStatsMock.mockReturnValue(buildStatsResult());

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("tab", { name: "Usage history" }));
    expect(await screen.findByText(/private connection contexts/)).toBeInTheDocument();
    expect(fetchManagerUsageHistoryTrendsMock).toHaveBeenCalledWith("conn-1", "month");
  });

  it("hides usage history trends when the feature is disabled", () => {
    usageHistoryEnabled = false;
    useS3AccountContextMock.mockReturnValue(buildContext({ contextId: "1", accessMode: "account" }));
    useManagerStatsMock.mockReturnValue(buildStatsResult());

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Usage history")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usage history" })).not.toBeInTheDocument();
    expect(fetchManagerUsageHistoryTrendsMock).not.toHaveBeenCalled();
  });

  it("renders account usage composition and recalculates all account buckets when usage stats are enabled", async () => {
    bucketUsageStatsEnabled = true;
    setManagerUser();
    useS3AccountContextMock.mockReturnValue(buildContext());
    useManagerStatsMock.mockReturnValue(buildStatsResult());

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Bucket breakdown (storage)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Usage composition" }));
    await screen.findByText("Account usage composition");
    expect(screen.queryByText("Bucket breakdown (storage)")).not.toBeInTheDocument();
    expect(screen.getByText("1 / 2 buckets covered")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(getManagerUsageStatsAggregateMock).toHaveBeenCalledWith("conn-1");

    fireEvent.click(screen.getByRole("button", { name: "Recalculate account" }));

    await waitFor(() =>
      expect(streamManagerUsageStatsAggregateMock).toHaveBeenCalledWith("conn-1", { parallelism: 8 })
    );
    await waitFor(() => expect(getManagerUsageStatsAggregateMock).toHaveBeenCalledTimes(2));
  });
});

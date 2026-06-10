import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BucketsPage from "./BucketsPage";
import ManagerBrowserPage from "./ManagerBrowserPage";
import ManagerDashboard from "./ManagerDashboard";

const useS3AccountContextMock = vi.fn();
const useManagerStatsMock = vi.fn();
const useIamOverviewMock = vi.fn();
const listBucketsMock = vi.fn();
const getBucketPropertiesMock = vi.fn();
const listManagerActivityMock = vi.fn();
const fetchManagerTrafficMock = vi.fn();
const fetchManagerUsageTrendsMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("./useManagerStats", () => ({
  useManagerStats: (...args: unknown[]) => useManagerStatsMock(...args),
}));

vi.mock("./useIamOverview", () => ({
  useIamOverview: (...args: unknown[]) => useIamOverviewMock(...args),
}));

vi.mock("../shared/storageEndpointLabel", () => ({
  formatAccountLabel: () => "Account Alpha",
  useDefaultStorageEndpoint: () => ({
    defaultEndpointId: null,
    defaultEndpointName: "Default",
  }),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      endpoint_status_enabled: false,
    },
  }),
}));

vi.mock("../browser/BrowserEmbed", () => ({
  default: (props: { onSelectedBucketNameChange?: (bucketName: string) => void }) => (
    <button
      type="button"
      data-testid="browser-embed"
      onClick={() => props.onSelectedBucketNameChange?.("bucket-a")}
    >
      browser
    </button>
  ),
}));

vi.mock("../../api/buckets", async () => {
  const actual = await vi.importActual<typeof import("../../api/buckets")>("../../api/buckets");
  return {
    ...actual,
    listBuckets: (...args: unknown[]) => listBucketsMock(...args),
    getBucketProperties: (...args: unknown[]) => getBucketPropertiesMock(...args),
    createBucket: vi.fn(),
    deleteBucket: vi.fn(),
  };
});

vi.mock("../../api/managerActivity", () => ({
  listManagerActivity: (...args: unknown[]) => listManagerActivityMock(...args),
}));

vi.mock("../../api/stats", async () => {
  const actual = await vi.importActual<typeof import("../../api/stats")>("../../api/stats");
  return {
    ...actual,
    fetchManagerTraffic: (...args: unknown[]) => fetchManagerTrafficMock(...args),
    fetchManagerUsageTrends: (...args: unknown[]) => fetchManagerUsageTrendsMock(...args),
  };
});

function trafficPoint(timestamp: string, bytesIn: number, bytesOut: number) {
  return {
    timestamp,
    bytes_in: bytesIn,
    bytes_out: bytesOut,
    ops: 0,
    success_ops: 0,
  };
}

function daysBefore(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function managerTrafficResponse(
  bytesIn: number,
  bytesOut: number,
  options?: {
    window?: "day" | "week" | "month";
    end?: string;
    series?: Array<ReturnType<typeof trafficPoint>>;
  }
) {
  const end = options?.end ?? new Date().toISOString();
  return {
    window: options?.window ?? "day",
    start: new Date().toISOString(),
    end,
    resolution: options?.window === "month" || options?.window === "week" ? "daily" : "hour",
    data_points: options?.series?.length ?? 0,
    series: options?.series ?? [],
    totals: {
      bytes_in: bytesIn,
      bytes_out: bytesOut,
      ops: 0,
      success_ops: 0,
      success_rate: null,
    },
    bucket_rankings: [],
    user_rankings: [],
    request_breakdown: [],
    category_breakdown: [],
  };
}

function trendText(value: string) {
  return (_content: string, element: Element | null) => element?.tagName === "SPAN" && element.textContent === value;
}

function expectMetricValue(label: string, value: string) {
  const metricValue = document.querySelector(`[data-kpi-value="${label}"]`);
  expect(metricValue).not.toBeNull();
  expect(metricValue).toHaveTextContent(value);
}

describe("manager shell pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useS3AccountContextMock.mockReturnValue({
      accounts: [],
      selectedS3AccountId: null,
      requiresS3AccountSelection: true,
      sessionS3AccountName: null,
      selectedS3AccountType: null,
      hasS3AccountContext: false,
      accountIdForApi: null,
      accessMode: "default",
      managerStatsEnabled: false,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });
    useManagerStatsMock.mockReturnValue({
      stats: null,
      loading: false,
      error: null,
    });
    useIamOverviewMock.mockReturnValue({
      overview: null,
      loading: false,
      error: null,
    });
    listBucketsMock.mockResolvedValue([]);
    getBucketPropertiesMock.mockResolvedValue({
      lifecycle_rules: [],
      cors_rules: [],
    });
    listManagerActivityMock.mockResolvedValue([]);
    fetchManagerTrafficMock.mockResolvedValue(managerTrafficResponse(0, 0));
    fetchManagerUsageTrendsMock.mockResolvedValue({});
    window.localStorage.clear();
  });

  it("renders the manager dashboard without mock values when no context is selected", () => {
    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Manager dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Top buckets by storage")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("Transfer")).toBeInTheDocument();
    expect(screen.queryByText("Active transfers")).not.toBeInTheDocument();
    expect(screen.queryByText("Select an account to display live values.")).not.toBeInTheDocument();
    expect(screen.queryByText("5.3 TB")).not.toBeInTheDocument();
    expect(screen.queryByText("128")).not.toBeInTheDocument();
    expect(screen.queryByText("backup-prod")).not.toBeInTheDocument();
    expect(screen.queryByText("jane.doe@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("+ 220 GB vs last 30 days")).not.toBeInTheDocument();
    expect(screen.queryByText("99.99%")).not.toBeInTheDocument();
    expect(screen.queryByText("Execution context")).not.toBeInTheDocument();
    expect(fetchManagerTrafficMock).not.toHaveBeenCalled();
  });

  it("keeps manager dashboard cards visible without fallback values when metrics are unavailable", async () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "conn-1",
          name: "User9001",
          type: "connection",
          storage_endpoint_capabilities: { iam: false, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "conn-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "connection",
      hasS3AccountContext: true,
      accountIdForApi: "conn-1",
      accessMode: "default",
      managerStatsEnabled: false,
      managerStatsMessage: "Metrics are unavailable for this context.",
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Manager dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Storage overview")).toBeInTheDocument();
    expect(screen.getByText("Quota status")).toBeInTheDocument();
    expect(screen.queryByText("Metrics are unavailable for this context.")).not.toBeInTheDocument();
    expect(screen.queryByText("5.3 TB")).not.toBeInTheDocument();
    expect(screen.queryByText("10 TB")).not.toBeInTheDocument();
    expect(screen.queryByText("4.2 M")).not.toBeInTheDocument();
    expect(screen.queryByText("220 GB / 1 TB")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Usage")).not.toBeInTheDocument();
    expect(screen.queryByText(/Storage usage for/)).not.toBeInTheDocument();
    expect(screen.getByText("Transfer")).toBeInTheDocument();
    expect(screen.queryByText("Active transfers")).not.toBeInTheDocument();
    expect(fetchManagerTrafficMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Access management")).toBeInTheDocument();
  });

  it("shows access management for IAM-capable connection contexts", async () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "conn-1",
          name: "AWS/tests3",
          type: "connection",
          storage_endpoint_capabilities: { iam: true, metrics: false, usage: false },
          capabilities: { can_manage_iam: true, sts_capable: false, admin_api_capable: false },
        },
      ],
      selectedS3AccountId: "conn-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "connection",
      hasS3AccountContext: true,
      accountIdForApi: "conn-1",
      accessMode: "connection",
      managerStatsEnabled: false,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });
    useIamOverviewMock.mockReturnValue({
      overview: { iam_users: 1, iam_groups: 0, iam_roles: 0, iam_policies: 0 },
      loading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(listBucketsMock).toHaveBeenCalledWith("conn-1", { with_stats: false }));
    const accessSection = screen.getByText("Access management").closest("section");
    expect(accessSection).not.toBeNull();
    expect(useIamOverviewMock).toHaveBeenCalledWith("conn-1", true, true, "connection:0");
    expect(within(accessSection!).getByText("Users")).toBeInTheDocument();
    expect(within(accessSection!).getByText("1")).toBeInTheDocument();
  });

  it("keeps the redesigned dashboard structure stable when storage metrics are disabled", async () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: false,
      managerStatsMessage: "Metrics are unavailable for this context.",
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(listBucketsMock).toHaveBeenCalledWith("account-1", { with_stats: false }));
    expect(screen.getByTestId("manager-dashboard")).toBeInTheDocument();
    expect(screen.getByText("Top buckets by storage")).toBeInTheDocument();
    expect(screen.getByText("Quick actions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage lifecycle" })).toHaveAttribute("href", "/manager/buckets");
    expect(screen.getByText("Storage backend health")).toBeInTheDocument();
    expect(screen.queryByText("Storage Usage")).not.toBeInTheDocument();
    expect(screen.queryByText("Metrics are unavailable for this context.")).not.toBeInTheDocument();
    expect(screen.queryByText("5.3 TB")).not.toBeInTheDocument();
    expect(screen.queryByText("4.2 M")).not.toBeInTheDocument();
    expect(fetchManagerTrafficMock).not.toHaveBeenCalled();
  });

  it("renders upload and download volumes from manager traffic usage", async () => {
    fetchManagerTrafficMock.mockResolvedValue(managerTrafficResponse(2048, 4096));
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchManagerTrafficMock).toHaveBeenCalledWith("account-1", "day"));
    await waitFor(() => expectMetricValue("Transfer", "6.0 KB"));
    expect(screen.getByText("Last 24h")).toBeInTheDocument();
    expect(screen.getByText("Transfer").closest("a")).toHaveAttribute("href", "/manager/metrics");
    expect(screen.queryByText("Active transfers")).not.toBeInTheDocument();
  });

  it("falls back manager dashboard traffic trend from month to last week", async () => {
    const end = "2026-06-08T12:00:00.000Z";
    fetchManagerTrafficMock.mockImplementation((_accountId, window) => {
      if (window === "month") {
        return Promise.resolve(
          managerTrafficResponse(8 * 1024, 0, {
            window,
            end,
            series: [trafficPoint(end, 8 * 1024, 0)],
          })
        );
      }
      if (window === "week") {
        return Promise.resolve(
          managerTrafficResponse(1024, 1024, {
            window,
            end,
            series: [trafficPoint(daysBefore(end, 6), 1024, 1024)],
          })
        );
      }
      return Promise.resolve(managerTrafficResponse(256, 512, { window: "day", end, series: [trafficPoint(end, 256, 512)] }));
    });
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchManagerTrafficMock).toHaveBeenCalledWith("account-1", "month"));
    await waitFor(() => expectMetricValue("Transfer", "768 B"));
    expect(screen.getByText(trendText("2.0 KB vs last week"))).toBeInTheDocument();
    expect(screen.queryByText(trendText("8.0 KB vs last 30 days"))).not.toBeInTheDocument();
  });

  it("falls back manager dashboard traffic trend to yesterday when month and week are not ready", async () => {
    const end = "2026-06-08T12:00:00.000Z";
    fetchManagerTrafficMock.mockImplementation((_accountId, window) => {
      if (window === "month") {
        return Promise.resolve(
          managerTrafficResponse(8 * 1024, 0, {
            window,
            end,
            series: [trafficPoint(end, 8 * 1024, 0)],
          })
        );
      }
      if (window === "week") {
        return Promise.resolve(
          managerTrafficResponse(4 * 1024, 0, {
            window,
            end,
            series: [trafficPoint(end, 4 * 1024, 0)],
          })
        );
      }
      return Promise.resolve(managerTrafficResponse(512, 512, { window: "day", end, series: [trafficPoint(end, 512, 512)] }));
    });
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchManagerTrafficMock).toHaveBeenCalledWith("account-1", "week"));
    await waitFor(() => expectMetricValue("Transfer", "1.0 KB"));
    expect(screen.getByText(trendText("1.0 KB vs yesterday"))).toBeInTheDocument();
    expect(screen.queryByText(trendText("8.0 KB vs last 30 days"))).not.toBeInTheDocument();
    expect(screen.queryByText(trendText("4.0 KB vs last week"))).not.toBeInTheDocument();
  });

  it("keeps real zero upload and download volumes visible", async () => {
    fetchManagerTrafficMock.mockResolvedValue(managerTrafficResponse(0, 0));
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchManagerTrafficMock).toHaveBeenCalledWith("account-1", "day"));
    await waitFor(() => expectMetricValue("Transfer", "0 B"));
    expect(screen.getByText("Last 24h")).toBeInTheDocument();
  });

  it("keeps upload and download traffic silent when usage loading fails", async () => {
    fetchManagerTrafficMock.mockRejectedValue(new Error("traffic unavailable"));
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(fetchManagerTrafficMock).toHaveBeenCalledWith("account-1", "day"));
    await waitFor(() => expect(screen.queryByText("...")).not.toBeInTheDocument());
    expect(screen.getByText("Transfer")).toBeInTheDocument();
    expect(screen.queryByText("traffic unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("0 B")).not.toBeInTheDocument();
  });

  it("renders recent manager activity from audit logs", async () => {
    listManagerActivityMock.mockResolvedValue([
      {
        id: 101,
        created_at: new Date().toISOString(),
        action: "create_bucket",
        entity_type: "bucket",
        entity_id: "research-data",
        account_id: 1,
        account_name: "Account Alpha",
        status: "success",
        user_email: "manager@example.com",
      },
    ]);
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: false,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(listManagerActivityMock).toHaveBeenCalledWith("account-1", { limit: 5 }));
    expect(await screen.findByText("Bucket created")).toBeInTheDocument();
    expect(screen.getByText("research-data")).toBeInTheDocument();
  });

  it("shows an empty recent activity state only after an empty successful response", async () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: false,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(listManagerActivityMock).toHaveBeenCalledWith("account-1", { limit: 5 }));
    expect(await screen.findByText("No recent activity.")).toBeInTheDocument();
  });

  it("keeps recent activity silent when audit activity loading fails", async () => {
    listManagerActivityMock.mockRejectedValue(new Error("activity unavailable"));
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: false,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(listManagerActivityMock).toHaveBeenCalledWith("account-1", { limit: 5 }));
    await waitFor(() => expect(screen.queryByText("No recent activity.")).not.toBeInTheDocument());
    expect(screen.queryByText("activity unavailable")).not.toBeInTheDocument();
  });

  it("renders a bucket metric card and bucket ranking link", async () => {
    listBucketsMock.mockResolvedValue([{ name: "bucket-a" }, { name: "bucket-b" }]);
    fetchManagerUsageTrendsMock.mockResolvedValue({
      storage: { window: "month", label: "last 30 days", period_start: "2026-05-10", used_bytes: 4 * 1024 ** 3 },
      buckets: { window: "month", label: "last 30 days", period_start: "2026-05-10", bucket_count: 1 },
      objects: { window: "month", label: "last 30 days", period_start: "2026-05-10", used_objects: 8 },
    });
    useManagerStatsMock.mockReturnValue({
      stats: {
        total_buckets: 2,
        total_iam_users: 2,
        total_iam_groups: 1,
        total_iam_roles: 3,
        total_iam_policies: 0,
        total_bytes: 5 * 1024 ** 3,
        total_objects: 12,
        bucket_usage: [
          { name: "bucket-a", used_bytes: 2_000, object_count: 8 },
          { name: "bucket-b", used_bytes: 1_000, object_count: 4 },
        ],
      },
      loading: false,
      error: null,
    });
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "User9001",
          type: "account",
          max_buckets: 4,
          max_users: 5,
          max_roles: 6,
          max_groups: 4,
          quota_max_size_gb: 10,
          quota_max_objects: 24,
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
          capabilities: { can_manage_iam: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("Top buckets by storage")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Buckets\s+2\s+of 4 buckets \(50%\)/i })).toHaveAttribute("href", "/manager/buckets");
    expect(screen.getByRole("meter", { name: "Storage used quota usage" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("meter", { name: "Buckets quota usage" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("meter", { name: "Objects quota usage" })).toHaveAttribute("aria-valuenow", "50");
    const quotaStatus = screen.getByRole("heading", { name: "Quota status" }).closest("section");
    expect(quotaStatus).not.toBeNull();
    const quotaStatusScope = within(quotaStatus!);
    expect(quotaStatusScope.getByText("Buckets")).toBeInTheDocument();
    expect(quotaStatusScope.getByText("2 / 4")).toBeInTheDocument();
    expect(quotaStatusScope.getByText("Users")).toBeInTheDocument();
    expect(quotaStatusScope.getByText("2 / 5")).toBeInTheDocument();
    expect(quotaStatusScope.getByText("Roles")).toBeInTheDocument();
    expect(quotaStatusScope.getByText("3 / 6")).toBeInTheDocument();
    expect(quotaStatusScope.getByText("Groups")).toBeInTheDocument();
    expect(quotaStatusScope.getByText("1 / 4")).toBeInTheDocument();
    expect(quotaStatusScope.queryByText("Bandwidth (month)")).not.toBeInTheDocument();
    expect(await screen.findByText(trendText("1.0 GB vs last 30 days"))).toBeInTheDocument();
    expect(screen.getByText(trendText("1 vs last 30 days"))).toBeInTheDocument();
    expect(screen.getByText(trendText("4 vs last 30 days"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View all buckets/ })).toHaveAttribute("href", "/manager/buckets");
  });

  it("renders fallback usage trend labels with negative and neutral deltas", async () => {
    fetchManagerUsageTrendsMock.mockResolvedValue({
      storage: { window: "week", label: "last week", period_start: "2026-06-02", used_bytes: 6 * 1024 ** 3 },
      buckets: { window: "day", label: "yesterday", period_start: "2026-06-08", bucket_count: 2 },
      objects: { window: "week", label: "last week", period_start: "2026-06-02", used_objects: 10 },
    });
    useManagerStatsMock.mockReturnValue({
      stats: {
        total_buckets: 2,
        total_iam_users: 0,
        total_iam_groups: 0,
        total_iam_roles: 0,
        total_iam_policies: 0,
        total_bytes: 5 * 1024 ** 3,
        total_objects: 12,
        bucket_usage: [{ name: "bucket-a", used_bytes: 2_000, object_count: 8 }],
      },
      loading: false,
      error: null,
    });
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    expect(await screen.findByText(trendText("1.0 GB vs last week"))).toBeInTheDocument();
    expect(screen.getByText(trendText("0 vs yesterday"))).toBeInTheDocument();
    expect(screen.getByText(trendText("2 vs last week"))).toBeInTheDocument();
  });

  it("renders the manager browser page without a page-level context strip", () => {
    render(
      <MemoryRouter>
        <ManagerBrowserPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Select a manager context first")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getByText("Manager")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getByText("Browser")).toBeInTheDocument();
    expect(screen.queryByText("Execution context")).not.toBeInTheDocument();
  });

  it("adds the selected bucket to the manager browser breadcrumb", () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          storage_endpoint_capabilities: { iam: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerBrowserPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("browser-embed"));

    expect(within(screen.getByRole("navigation")).getByText("bucket-a")).toBeInTheDocument();
  });

  it("renders the manager buckets page without a page-level context strip", () => {
    render(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Select an account before managing buckets")).toBeInTheDocument();
    expect(screen.queryByText("Execution context")).not.toBeInTheDocument();
  });

  it("offers the Notifications bucket column when SNS is enabled and requests notifications enrichment", async () => {
    listBucketsMock.mockResolvedValue([
      {
        name: "bucket-a",
        used_bytes: 1024,
        object_count: 1,
        features: {
          notifications: { state: "Configured", tone: "active" },
        },
      },
    ]);
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          endpoint_provider: "ceph",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true, sns: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const notificationsColumn = await screen.findByLabelText("Notifications");

    fireEvent.click(notificationsColumn);

    await waitFor(() =>
      expect(listBucketsMock.mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({
          include: expect.arrayContaining(["notifications"]),
        })
      )
    );
  });

  it("loads manager bucket feature summaries only when a feature chip is focused", async () => {
    window.localStorage.setItem(
      "manager.bucket_list.columns.v1",
      JSON.stringify(["used_bytes", "object_count", "tags", "lifecycle_rules"])
    );
    listBucketsMock.mockResolvedValue([
      {
        name: "bucket-a",
        used_bytes: 1024,
        object_count: 1,
        tags: [{ key: "env", value: "prod" }],
        features: {
          lifecycle_rules: { state: "Enabled", tone: "active" },
        },
      },
    ]);
    getBucketPropertiesMock.mockResolvedValue({
      versioning_status: "Disabled",
      lifecycle_rules: [{ id: "archive-rule", status: "Enabled", prefix: "logs/" }],
      cors_rules: [],
    });
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          name: "Account Alpha",
          type: "account",
          endpoint_provider: "ceph",
          storage_endpoint_capabilities: { iam: true, metrics: true, usage: true, sns: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      selectedS3AccountType: "account",
      hasS3AccountContext: true,
      accountIdForApi: "account-1",
      accessMode: "default",
      managerStatsEnabled: true,
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <BucketsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    expect(getBucketPropertiesMock).not.toHaveBeenCalled();

    fireEvent.focus(screen.getByRole("button", { name: "S3 tags details" }));
    expect(await screen.findByText("env: prod")).toBeInTheDocument();
    expect(getBucketPropertiesMock).not.toHaveBeenCalled();

    fireEvent.focus(screen.getByRole("button", { name: "Lifecycle rules details" }));

    await waitFor(() => expect(getBucketPropertiesMock).toHaveBeenCalledWith("account-1", "bucket-a"));
    expect(await screen.findByText("archive-rule: Enabled - Prefix: logs/")).toBeInTheDocument();
  });
});

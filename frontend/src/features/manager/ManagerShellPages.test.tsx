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
const listManagerActivityMock = vi.fn();
const fetchManagerTrafficMock = vi.fn();

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
  default: () => <div data-testid="browser-embed">browser</div>,
}));

vi.mock("../../api/buckets", async () => {
  const actual = await vi.importActual<typeof import("../../api/buckets")>("../../api/buckets");
  return {
    ...actual,
    listBuckets: (...args: unknown[]) => listBucketsMock(...args),
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
  };
});

function managerTrafficResponse(bytesIn: number, bytesOut: number) {
  return {
    window: "day",
    start: new Date().toISOString(),
    end: new Date().toISOString(),
    resolution: "hour",
    data_points: 0,
    series: [],
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
    listManagerActivityMock.mockResolvedValue([]);
    fetchManagerTrafficMock.mockResolvedValue(managerTrafficResponse(0, 0));
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
    expect(screen.getByText("Upload / Download")).toBeInTheDocument();
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
    expect(screen.getByText("Upload / Download")).toBeInTheDocument();
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
    expect(await screen.findByText("2.0 KB / 4.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Last 24h")).toBeInTheDocument();
    expect(screen.getByText("Upload / Download").closest("a")).toHaveAttribute("href", "/manager/metrics");
    expect(screen.queryByText("Active transfers")).not.toBeInTheDocument();
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
    expect(await screen.findByText("0 B / 0 B")).toBeInTheDocument();
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
    expect(screen.getByText("Upload / Download")).toBeInTheDocument();
    expect(screen.queryByText("traffic unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("0 B / 0 B")).not.toBeInTheDocument();
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
    useManagerStatsMock.mockReturnValue({
      stats: {
        total_buckets: 2,
        total_iam_users: 0,
        total_iam_groups: 0,
        total_iam_roles: 0,
        total_iam_policies: 0,
        total_bytes: 3_000,
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
    expect(await screen.findByRole("link", { name: /Buckets\s+2\s+Buckets/i })).toHaveAttribute("href", "/manager/buckets");
    expect(screen.getByRole("link", { name: /View all buckets/ })).toHaveAttribute("href", "/manager/buckets");
  });

  it("renders the manager browser page without a page-level context strip", () => {
    render(
      <MemoryRouter>
        <ManagerBrowserPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Select a manager context first")).toBeInTheDocument();
    expect(screen.queryByText("Execution context")).not.toBeInTheDocument();
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
});

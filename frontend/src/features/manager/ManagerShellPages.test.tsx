import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BucketsPage from "./BucketsPage";
import ManagerBrowserPage from "./ManagerBrowserPage";
import ManagerDashboard from "./ManagerDashboard";

const useS3AccountContextMock = vi.fn();
const useManagerStatsMock = vi.fn();
const useIamOverviewMock = vi.fn();
const listBucketsMock = vi.fn();

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
  });

  it("renders the manager dashboard without a page-level context strip", () => {
    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("Select an account to start")).toBeInTheDocument();
    expect(screen.queryByText("Execution context")).not.toBeInTheDocument();
  });

  it("hides the dashboard storage usage card and metrics banner when manager stats are unavailable", async () => {
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

    expect(screen.queryByText("Metrics are unavailable for this context.")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Usage")).not.toBeInTheDocument();
    expect(screen.queryByText(/Storage usage for/)).not.toBeInTheDocument();
    expect(screen.queryByText("IAM resources")).not.toBeInTheDocument();
    expect(await screen.findByText("0")).toBeInTheDocument();
  });

  it("shows IAM resources for IAM-capable connection contexts", async () => {
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

    expect(screen.getByText("IAM resources")).toBeInTheDocument();
    expect(useIamOverviewMock).toHaveBeenCalledWith("conn-1", true, true, "connection");
    expect(await screen.findByText("1")).toBeInTheDocument();
  });

  it("keeps the manager dashboard overview grid width stable when storage usage is hidden", async () => {
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

    const overviewGrid = screen.getByText("IAM resources").closest("section")?.parentElement;
    expect(overviewGrid).toHaveClass("lg:grid-cols-2");
    expect(screen.queryByText("Storage Usage")).not.toBeInTheDocument();
    expect(screen.queryByText("Metrics are unavailable for this context.")).not.toBeInTheDocument();
    expect(await screen.findByText("0")).toBeInTheDocument();
  });

  it("renders a bucket summary card that links to the bucket list", async () => {
    listBucketsMock.mockResolvedValue([{ name: "bucket-a" }, { name: "bucket-b" }]);
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
      managerStatsMessage: null,
      managerBrowserEnabled: true,
    });

    render(
      <MemoryRouter>
        <ManagerDashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("Bucket overview")).toBeInTheDocument();
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View/ })).toHaveAttribute("href", "/manager/buckets");
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
});

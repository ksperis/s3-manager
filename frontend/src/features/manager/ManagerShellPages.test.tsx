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

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalDashboard from "./PortalDashboard";

const navigateMock = vi.fn();
const fetchPortalStateMock = vi.fn();
const fetchPortalSettingsMock = vi.fn();
const fetchPortalTrafficMock = vi.fn();
const fetchPortalBucketStatsMock = vi.fn();
const fetchPortalUsageMock = vi.fn();
const listPortalUsersMock = vi.fn();
const fetchPortalWorkspaceHealthOverviewMock = vi.fn();
const tMock = (text: { en: string }) => text.en;

const generalSettingsState = {
  browser_enabled: true,
  browser_portal_enabled: true,
  endpoint_status_enabled: false,
};

const portalAccountContextState = {
  accountIdForApi: 1,
  selectedAccount: { id: 1, name: "Account 1" },
  hasAccountContext: true,
  loading: false,
  error: null,
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    language: "en",
    t: tMock,
  }),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: generalSettingsState,
  }),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => portalAccountContextState,
}));

vi.mock("./PortalBucketModal", () => ({
  default: ({ bucket }: { bucket: { name: string } }) => <div data-testid="portal-bucket-modal">Bucket modal: {bucket.name}</div>,
}));

vi.mock("../../api/portal", () => ({
  bootstrapPortalIdentity: vi.fn(),
  createPortalAccessKey: vi.fn(),
  createPortalBucket: vi.fn(),
  deletePortalAccessKey: vi.fn(),
  fetchPortalState: (...args: unknown[]) => fetchPortalStateMock(...args),
  listPortalUsers: (...args: unknown[]) => listPortalUsersMock(...args),
  updatePortalAccessKeyStatus: vi.fn(),
  fetchPortalSettings: (...args: unknown[]) => fetchPortalSettingsMock(...args),
  fetchPortalTraffic: (...args: unknown[]) => fetchPortalTrafficMock(...args),
  fetchPortalBucketStats: (...args: unknown[]) => fetchPortalBucketStatsMock(...args),
  fetchPortalUsage: (...args: unknown[]) => fetchPortalUsageMock(...args),
}));

vi.mock("../../api/healthchecks", () => ({
  fetchPortalWorkspaceHealthOverview: (...args: unknown[]) => fetchPortalWorkspaceHealthOverviewMock(...args),
}));

const basePortalState = {
  account_id: 1,
  iam_user: { iam_username: "portal-user" },
  access_keys: [],
  iam_provisioned: true,
  buckets: [
    {
      name: "bucket-a",
      creation_date: "2026-03-10T10:00:00Z",
      used_bytes: 128,
      object_count: 4,
      quota_max_size_bytes: null,
      quota_max_objects: null,
    },
  ],
  total_buckets: 1,
  s3_endpoint: "https://s3.example.com",
  used_bytes: 128,
  used_objects: 4,
  quota_max_size_bytes: null,
  quota_max_objects: null,
  account_role: "portal_manager",
  can_manage_buckets: true,
  can_manage_portal_users: false,
};

describe("PortalDashboard bucket interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    generalSettingsState.browser_enabled = true;
    generalSettingsState.browser_portal_enabled = true;
    generalSettingsState.endpoint_status_enabled = false;
    fetchPortalStateMock.mockResolvedValue(basePortalState);
    fetchPortalSettingsMock.mockResolvedValue({});
    fetchPortalTrafficMock.mockResolvedValue({ series: [], totals: { ops: 0 } });
    fetchPortalBucketStatsMock.mockResolvedValue({ name: "bucket-a", used_bytes: 128, object_count: 4 });
    fetchPortalUsageMock.mockResolvedValue({ used_bytes: 128, used_objects: 4 });
    listPortalUsersMock.mockResolvedValue([]);
    fetchPortalWorkspaceHealthOverviewMock.mockResolvedValue({ endpoints: [], incidents: [], incident_highlight_minutes: 720 });
  });

  it("opens the bucket modal when browser feature is disabled and bucket card is clicked", async () => {
    generalSettingsState.browser_enabled = false;
    const user = userEvent.setup();
    render(<PortalDashboard />);

    const openDetailsButton = await screen.findByRole("button", { name: "Open bucket details for bucket-a" });
    await user.click(openDetailsButton);

    expect(await screen.findByTestId("portal-bucket-modal")).toHaveTextContent("Bucket modal: bucket-a");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("opens portal browser on bucket card click when browser feature is enabled", async () => {
    const user = userEvent.setup();
    render(<PortalDashboard />);

    const openInBrowserButton = await screen.findByRole("button", { name: "Open bucket bucket-a in Browser" });
    await user.click(openInBrowserButton);

    expect(navigateMock).toHaveBeenCalledWith("/portal/browser?bucket=bucket-a");
    expect(localStorage.getItem("selectedPortalAccountId")).toBe("1");
    expect(screen.queryByTestId("portal-bucket-modal")).not.toBeInTheDocument();
  });

  it("opens bucket info modal from info button without navigating", async () => {
    const user = userEvent.setup();
    render(<PortalDashboard />);

    const infoButton = await screen.findByRole("button", { name: "Bucket information for bucket-a" });
    await user.click(infoButton);

    expect(await screen.findByTestId("portal-bucket-modal")).toHaveTextContent("Bucket modal: bucket-a");
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

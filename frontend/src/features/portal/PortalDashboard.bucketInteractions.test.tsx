import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalDashboard from "./PortalDashboard";

const navigateMock = vi.fn();
const fetchPortalStateMock = vi.fn();
const fetchPortalSettingsMock = vi.fn();
const createPortalAccessKeyMock = vi.fn();
const deletePortalBucketMock = vi.fn();
const updatePortalAccessKeyStatusMock = vi.fn();
const fetchPortalTrafficMock = vi.fn();
const fetchPortalBucketStatsMock = vi.fn();
const fetchPortalUsageMock = vi.fn();
const listPortalUsersMock = vi.fn();
const fetchPortalWorkspaceHealthOverviewMock = vi.fn();
const confirmActionMock = vi.fn();
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
  default: ({
    bucket,
    canDeleteBucket,
    onDeleteBucket,
    deleteError,
  }: {
    bucket: { name: string };
    canDeleteBucket?: boolean;
    onDeleteBucket?: () => void;
    deleteError?: string | null;
  }) => (
    <div data-testid="portal-bucket-modal">
      <div>Bucket modal: {bucket.name}</div>
      {canDeleteBucket ? (
        <button type="button" onClick={() => onDeleteBucket?.()}>
          Delete bucket
        </button>
      ) : null}
      {deleteError ? <div>{deleteError}</div> : null}
    </div>
  ),
}));

vi.mock("../../api/portal", () => ({
  bootstrapPortalIdentity: vi.fn(),
  createPortalAccessKey: (...args: unknown[]) => createPortalAccessKeyMock(...args),
  createPortalBucket: vi.fn(),
  deletePortalAccessKey: vi.fn(),
  deletePortalBucket: (...args: unknown[]) => deletePortalBucketMock(...args),
  fetchPortalState: (...args: unknown[]) => fetchPortalStateMock(...args),
  listPortalUsers: (...args: unknown[]) => listPortalUsersMock(...args),
  updatePortalAccessKeyStatus: (...args: unknown[]) => updatePortalAccessKeyStatusMock(...args),
  fetchPortalSettings: (...args: unknown[]) => fetchPortalSettingsMock(...args),
  fetchPortalTraffic: (...args: unknown[]) => fetchPortalTrafficMock(...args),
  fetchPortalBucketStats: (...args: unknown[]) => fetchPortalBucketStatsMock(...args),
  fetchPortalUsage: (...args: unknown[]) => fetchPortalUsageMock(...args),
}));

vi.mock("../../api/healthchecks", () => ({
  fetchPortalWorkspaceHealthOverview: (...args: unknown[]) => fetchPortalWorkspaceHealthOverviewMock(...args),
}));

vi.mock("../../utils/confirm", () => ({
  confirmAction: (...args: unknown[]) => confirmActionMock(...args),
  confirmDeletion: vi.fn(),
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
    localStorage.setItem("user", JSON.stringify({ id: 42, email: "manager@example.com" }));
    generalSettingsState.browser_enabled = true;
    generalSettingsState.browser_portal_enabled = true;
    generalSettingsState.endpoint_status_enabled = false;
    fetchPortalStateMock.mockResolvedValue(basePortalState);
    fetchPortalSettingsMock.mockResolvedValue({});
    createPortalAccessKeyMock.mockResolvedValue({
      access_key_id: "AK-NEW",
      secret_access_key: "SK-NEW",
      status: "Active",
    });
    deletePortalBucketMock.mockResolvedValue(undefined);
    updatePortalAccessKeyStatusMock.mockResolvedValue({
      access_key_id: "AK-NEW",
      status: "Inactive",
      is_portal: false,
      deletable: true,
      is_active: false,
    });
    confirmActionMock.mockReturnValue(true);
    fetchPortalTrafficMock.mockResolvedValue({ series: [], totals: { ops: 0 } });
    fetchPortalBucketStatsMock.mockResolvedValue({ name: "bucket-a", used_bytes: 128, object_count: 4 });
    fetchPortalUsageMock.mockResolvedValue({ used_bytes: 128, used_objects: 4 });
    listPortalUsersMock.mockResolvedValue([]);
    fetchPortalWorkspaceHealthOverviewMock.mockResolvedValue({ endpoints: [], incidents: [], incident_highlight_minutes: 720 });
  });

  it("shows buckets from portal state for portal_manager", async () => {
    fetchPortalStateMock.mockResolvedValueOnce({
      ...basePortalState,
      buckets: [
        ...basePortalState.buckets,
        {
          name: "bucket-b",
          creation_date: "2026-03-11T10:00:00Z",
          used_bytes: 64,
          object_count: 2,
          quota_max_size_bytes: null,
          quota_max_objects: null,
        },
      ],
      total_buckets: 2,
    });

    render(<PortalDashboard />);

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    expect(await screen.findByText("bucket-b")).toBeInTheDocument();
  });

  it("shows buckets from portal state for portal_user", async () => {
    fetchPortalStateMock.mockResolvedValueOnce({
      ...basePortalState,
      account_role: "portal_user",
      can_manage_buckets: false,
      buckets: [
        {
          name: "bucket-user",
          creation_date: "2026-03-12T10:00:00Z",
          used_bytes: 32,
          object_count: 1,
          quota_max_size_bytes: null,
          quota_max_objects: null,
        },
      ],
      total_buckets: 1,
    });

    render(<PortalDashboard />);

    expect(await screen.findByText("bucket-user")).toBeInTheDocument();
  });

  it("does not open bucket details when clicking a bucket on home", async () => {
    generalSettingsState.browser_enabled = false;
    const user = userEvent.setup();
    render(<PortalDashboard />);

    await user.click(await screen.findByText("bucket-a"));

    expect(screen.queryByTestId("portal-bucket-modal")).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("does not open browser when clicking a bucket on home", async () => {
    const user = userEvent.setup();
    render(<PortalDashboard />);

    await user.click(await screen.findByText("bucket-a"));

    expect(navigateMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("selectedPortalAccountId")).toBeNull();
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

  it("disables key creation when max IAM user keys is reached", async () => {
    const user = userEvent.setup();
    fetchPortalStateMock.mockResolvedValueOnce({
      ...basePortalState,
      access_keys: [
        { access_key_id: "AK-USER-1", status: "Active", is_portal: false },
        { access_key_id: "AK-USER-2", status: "Inactive", is_portal: false },
      ],
    });
    fetchPortalSettingsMock.mockResolvedValueOnce({
      allow_portal_user_access_key_create: true,
      max_portal_user_access_keys: 2,
    });

    render(<PortalDashboard />);

    await user.click(await screen.findByRole("button", { name: "2 key(s)" }));

    const createButton = await screen.findByRole("button", { name: "Create user key" });
    expect(createButton).toBeDisabled();
    expect(screen.getByText("Maximum IAM user keys reached (2). Delete a key before creating a new one.")).toBeInTheDocument();
    await user.click(createButton);
    expect(createPortalAccessKeyMock).not.toHaveBeenCalled();
  });

  it("shows explicit Active and Inactive labels in IAM key rows", async () => {
    const user = userEvent.setup();
    fetchPortalStateMock.mockResolvedValueOnce({
      ...basePortalState,
      access_keys: [
        { access_key_id: "AK-USER-ACTIVE", status: "Active", is_portal: false },
        { access_key_id: "AK-USER-INACTIVE", status: "Inactive", is_portal: false },
      ],
    });

    render(<PortalDashboard />);
    await user.click(await screen.findByRole("button", { name: "2 key(s)" }));

    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
  });

  it("allows portal_user to disable a key when key management is enabled", async () => {
    const user = userEvent.setup();
    fetchPortalStateMock.mockResolvedValueOnce({
      ...basePortalState,
      account_role: "portal_user",
      can_manage_buckets: false,
      access_keys: [{ access_key_id: "AK-USER-1", status: "Active", is_portal: false, deletable: true }],
    });
    fetchPortalSettingsMock.mockResolvedValueOnce({
      allow_portal_user_access_key_create: true,
      max_portal_user_access_keys: 2,
    });
    updatePortalAccessKeyStatusMock.mockResolvedValueOnce({
      access_key_id: "AK-USER-1",
      status: "Inactive",
      is_portal: false,
      deletable: true,
      is_active: false,
    });

    render(<PortalDashboard />);
    await user.click(await screen.findByRole("button", { name: "1 key(s)" }));
    await user.click(await screen.findByRole("button", { name: "Disable key" }));

    await waitFor(() => expect(updatePortalAccessKeyStatusMock).toHaveBeenCalledWith(1, "AK-USER-1", false));
  });

  it("deletes selected bucket from modal when bucket is empty", async () => {
    const user = userEvent.setup();
    fetchPortalStateMock.mockResolvedValueOnce({
      ...basePortalState,
      buckets: [{ ...basePortalState.buckets[0], object_count: 0 }],
      used_objects: 0,
    });
    fetchPortalSettingsMock.mockResolvedValueOnce({
      allow_portal_user_bucket_create: true,
    });
    fetchPortalBucketStatsMock.mockResolvedValue({ name: "bucket-a", used_bytes: 128, object_count: 0 });

    render(<PortalDashboard />);

    await user.click(await screen.findByRole("button", { name: "Bucket information for bucket-a" }));
    await user.click(await screen.findByRole("button", { name: "Delete bucket" }));

    await waitFor(() => expect(deletePortalBucketMock).toHaveBeenCalledWith(1, "bucket-a", false));
    expect(confirmActionMock).toHaveBeenCalled();
    expect(screen.queryByTestId("portal-bucket-modal")).not.toBeInTheDocument();
  });

  it("allows portal_user to delete bucket when bucket management is enabled", async () => {
    const user = userEvent.setup();
    fetchPortalStateMock.mockResolvedValueOnce({
      ...basePortalState,
      account_role: "portal_user",
      can_manage_buckets: false,
      buckets: [{ ...basePortalState.buckets[0], object_count: 0 }],
      used_objects: 0,
    });
    fetchPortalSettingsMock.mockResolvedValueOnce({
      allow_portal_user_bucket_create: true,
    });
    fetchPortalBucketStatsMock.mockResolvedValue({ name: "bucket-a", used_bytes: 128, object_count: 0 });

    render(<PortalDashboard />);

    await user.click(await screen.findByRole("button", { name: "Bucket information for bucket-a" }));
    await user.click(await screen.findByRole("button", { name: "Delete bucket" }));

    await waitFor(() => expect(deletePortalBucketMock).toHaveBeenCalledWith(1, "bucket-a", false));
  });

  it("does not call delete API when selected bucket is not empty", async () => {
    const user = userEvent.setup();
    fetchPortalSettingsMock.mockResolvedValueOnce({
      allow_portal_user_bucket_create: true,
    });
    render(<PortalDashboard />);

    await user.click(await screen.findByRole("button", { name: "Bucket information for bucket-a" }));
    await user.click(await screen.findByRole("button", { name: "Delete bucket" }));

    expect(confirmActionMock).not.toHaveBeenCalled();
    expect(deletePortalBucketMock).not.toHaveBeenCalled();
  });

  it("keeps modal open and shows API error when delete fails", async () => {
    const user = userEvent.setup();
    fetchPortalStateMock.mockResolvedValueOnce({
      ...basePortalState,
      buckets: [{ ...basePortalState.buckets[0], object_count: 0 }],
      used_objects: 0,
    });
    fetchPortalSettingsMock.mockResolvedValueOnce({
      allow_portal_user_bucket_create: true,
    });
    fetchPortalBucketStatsMock.mockResolvedValue({ name: "bucket-a", used_bytes: 128, object_count: 0 });
    deletePortalBucketMock.mockRejectedValueOnce(new Error("Bucket 'bucket-a' is not empty."));

    render(<PortalDashboard />);

    await user.click(await screen.findByRole("button", { name: "Bucket information for bucket-a" }));
    await user.click(await screen.findByRole("button", { name: "Delete bucket" }));

    expect(await screen.findByText("Bucket 'bucket-a' is not empty.")).toBeInTheDocument();
    expect(screen.getByTestId("portal-bucket-modal")).toBeInTheDocument();
  });
});

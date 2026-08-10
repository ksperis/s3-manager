import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BucketDetailPage from "../BucketDetailPage";

const useS3AccountContextMock = vi.fn();
const useCephAdminEndpointMock = vi.fn();
const listBucketsMock = vi.fn();
const getBucketVersioningMock = vi.fn();
const getBucketObjectLockMock = vi.fn();
const getBucketLifecycleMock = vi.fn();
const getBucketEncryptionMock = vi.fn();
const getBucketNotificationsMock = vi.fn();
const getBucketLoggingMock = vi.fn();
const getBucketWebsiteMock = vi.fn();
const getBucketReplicationMock = vi.fn();
const getBucketPolicyMock = vi.fn();
const getBucketAclMock = vi.fn();
const getBucketCorsMock = vi.fn();
const getBucketTagsMock = vi.fn();
const getBucketPublicAccessBlockMock = vi.fn();
const putBucketLifecycleMock = vi.fn();
const listObjectsMock = vi.fn();
const listCephAdminBucketObjectsMock = vi.fn();
const listCephAdminBucketsMock = vi.fn();
const getCephAdminBucketPropertiesMock = vi.fn();
const getCephAdminBucketVersioningMock = vi.fn();
const getCephAdminBucketObjectLockMock = vi.fn();
const getCephAdminBucketLifecycleMock = vi.fn();
const getCephAdminBucketEncryptionMock = vi.fn();
const getCephAdminBucketNotificationsMock = vi.fn();
const getCephAdminBucketLoggingMock = vi.fn();
const getCephAdminBucketWebsiteMock = vi.fn();
const getCephAdminBucketReplicationMock = vi.fn();
const getCephAdminBucketPolicyMock = vi.fn();
const getCephAdminBucketAclMock = vi.fn();
const getCephAdminBucketCorsMock = vi.fn();
const getCephAdminBucketTagsMock = vi.fn();
const getCephAdminBucketPublicAccessBlockMock = vi.fn();
const putCephAdminBucketLifecycleMock = vi.fn();
const setCephAdminBucketVersioningMock = vi.fn();
const updateCephAdminBucketObjectLockMock = vi.fn();
const fetchCephAdminClusterTrafficMock = vi.fn();

vi.mock("../../../api/buckets", async () => {
  const actual = await vi.importActual<typeof import("../../../api/buckets")>("../../../api/buckets");
  return {
    ...actual,
    listBuckets: (...args: unknown[]) => listBucketsMock(...args),
    getBucketVersioning: (...args: unknown[]) => getBucketVersioningMock(...args),
    getBucketObjectLock: (...args: unknown[]) => getBucketObjectLockMock(...args),
    getBucketLifecycle: (...args: unknown[]) => getBucketLifecycleMock(...args),
    getBucketEncryption: (...args: unknown[]) => getBucketEncryptionMock(...args),
    getBucketNotifications: (...args: unknown[]) => getBucketNotificationsMock(...args),
    getBucketLogging: (...args: unknown[]) => getBucketLoggingMock(...args),
    getBucketWebsite: (...args: unknown[]) => getBucketWebsiteMock(...args),
    getBucketReplication: (...args: unknown[]) => getBucketReplicationMock(...args),
    getBucketPolicy: (...args: unknown[]) => getBucketPolicyMock(...args),
    getBucketAcl: (...args: unknown[]) => getBucketAclMock(...args),
    getBucketCors: (...args: unknown[]) => getBucketCorsMock(...args),
    getBucketTags: (...args: unknown[]) => getBucketTagsMock(...args),
    getBucketPublicAccessBlock: (...args: unknown[]) => getBucketPublicAccessBlockMock(...args),
    putBucketLifecycle: (...args: unknown[]) => putBucketLifecycleMock(...args),
  };
});

vi.mock("../../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../../api/cephAdmin")>("../../../api/cephAdmin");
  return {
    ...actual,
    listCephAdminBuckets: (...args: unknown[]) => listCephAdminBucketsMock(...args),
    listCephAdminBucketObjects: (...args: unknown[]) => listCephAdminBucketObjectsMock(...args),
    getCephAdminBucketProperties: (...args: unknown[]) => getCephAdminBucketPropertiesMock(...args),
    getCephAdminBucketVersioning: (...args: unknown[]) => getCephAdminBucketVersioningMock(...args),
    getCephAdminBucketObjectLock: (...args: unknown[]) => getCephAdminBucketObjectLockMock(...args),
    getCephAdminBucketLifecycle: (...args: unknown[]) => getCephAdminBucketLifecycleMock(...args),
    getCephAdminBucketEncryption: (...args: unknown[]) => getCephAdminBucketEncryptionMock(...args),
    getCephAdminBucketNotifications: (...args: unknown[]) => getCephAdminBucketNotificationsMock(...args),
    getCephAdminBucketLogging: (...args: unknown[]) => getCephAdminBucketLoggingMock(...args),
    getCephAdminBucketWebsite: (...args: unknown[]) => getCephAdminBucketWebsiteMock(...args),
    getCephAdminBucketReplication: (...args: unknown[]) => getCephAdminBucketReplicationMock(...args),
    getCephAdminBucketPolicy: (...args: unknown[]) => getCephAdminBucketPolicyMock(...args),
    getCephAdminBucketAcl: (...args: unknown[]) => getCephAdminBucketAclMock(...args),
    getCephAdminBucketCors: (...args: unknown[]) => getCephAdminBucketCorsMock(...args),
    getCephAdminBucketTags: (...args: unknown[]) => getCephAdminBucketTagsMock(...args),
    getCephAdminBucketPublicAccessBlock: (...args: unknown[]) => getCephAdminBucketPublicAccessBlockMock(...args),
    putCephAdminBucketLifecycle: (...args: unknown[]) => putCephAdminBucketLifecycleMock(...args),
    setCephAdminBucketVersioning: (...args: unknown[]) => setCephAdminBucketVersioningMock(...args),
    updateCephAdminBucketObjectLock: (...args: unknown[]) => updateCephAdminBucketObjectLockMock(...args),
    fetchCephAdminClusterTraffic: (...args: unknown[]) => fetchCephAdminClusterTrafficMock(...args),
  };
});

vi.mock("../../../api/objects", async () => {
  const actual = await vi.importActual<typeof import("../../../api/objects")>("../../../api/objects");
  return {
    ...actual,
    listObjects: (...args: unknown[]) => listObjectsMock(...args),
  };
});

vi.mock("../S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../cephAdmin/CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

describe("BucketDetailPage replication state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useS3AccountContextMock.mockReturnValue({
      accounts: [],
      selectedS3AccountId: null,
      accountIdForApi: null,
      requiresS3AccountSelection: false,
      accessMode: "admin",
      managerBucketQuotaEnabled: false,
    });
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        name: "endpoint-1",
        capabilities: {
          static_website: true,
          sse: true,
          metrics: true,
          replication: true,
          sns: true,
        },
      },
    });
    listBucketsMock.mockResolvedValue([{ name: "demo-bucket", used_bytes: null, object_count: null }]);
    getBucketVersioningMock.mockResolvedValue({ status: "Disabled", enabled: false });
    getBucketObjectLockMock.mockResolvedValue({ enabled: false, mode: null, days: null, years: null });
    getBucketLifecycleMock.mockResolvedValue({ rules: [] });
    getBucketEncryptionMock.mockResolvedValue({ rules: [] });
    getBucketNotificationsMock.mockResolvedValue({ configuration: {} });
    getBucketLoggingMock.mockResolvedValue({ enabled: false });
    getBucketWebsiteMock.mockResolvedValue(null);
    getBucketPolicyMock.mockResolvedValue({ policy: null });
    getBucketAclMock.mockResolvedValue({ owner: "owner", grants: [] });
    getBucketCorsMock.mockResolvedValue({ rules: [] });
    getBucketTagsMock.mockResolvedValue({ tags: [] });
    getBucketPublicAccessBlockMock.mockResolvedValue({
      block_public_acls: false,
      ignore_public_acls: false,
      block_public_policy: false,
      restrict_public_buckets: false,
    });
    putBucketLifecycleMock.mockImplementation((_accountId, _bucketName, rules) => Promise.resolve({ rules }));
    getBucketReplicationMock.mockResolvedValue({ configuration: {} });
    listObjectsMock.mockResolvedValue({ prefix: "", objects: [], prefixes: [], is_truncated: false });
    listCephAdminBucketObjectsMock.mockResolvedValue({ prefix: "", objects: [], prefixes: [], is_truncated: false });
    listCephAdminBucketsMock.mockResolvedValue({
      items: [{ name: "demo-bucket" }],
    });
    getCephAdminBucketPropertiesMock.mockResolvedValue({
      versioning_status: "Disabled",
      object_lock_enabled: false,
      object_lock: { enabled: false, mode: null, days: null, years: null },
      public_access_block: {
        block_public_acls: false,
        ignore_public_acls: false,
        block_public_policy: false,
        restrict_public_buckets: false,
      },
      lifecycle_rules: [],
      cors_rules: [],
    });
    getCephAdminBucketVersioningMock.mockResolvedValue({ status: "Disabled", enabled: false });
    getCephAdminBucketObjectLockMock.mockResolvedValue({ enabled: false, mode: null, days: null, years: null });
    getCephAdminBucketLifecycleMock.mockResolvedValue({ rules: [] });
    getCephAdminBucketEncryptionMock.mockResolvedValue({ rules: [] });
    getCephAdminBucketNotificationsMock.mockResolvedValue({ configuration: {} });
    getCephAdminBucketLoggingMock.mockResolvedValue({ enabled: false });
    getCephAdminBucketWebsiteMock.mockResolvedValue(null);
    getCephAdminBucketPolicyMock.mockResolvedValue({ policy: null });
    getCephAdminBucketAclMock.mockResolvedValue({ owner: "owner", grants: [] });
    getCephAdminBucketCorsMock.mockResolvedValue({ rules: [] });
    getCephAdminBucketTagsMock.mockResolvedValue({ tags: [] });
    getCephAdminBucketPublicAccessBlockMock.mockResolvedValue({
      block_public_acls: false,
      ignore_public_acls: false,
      block_public_policy: false,
      restrict_public_buckets: false,
    });
    putCephAdminBucketLifecycleMock.mockImplementation((_endpointId, _bucketName, rules) => Promise.resolve({ rules }));
    getCephAdminBucketReplicationMock.mockResolvedValue({
      configuration: { Role: "" },
    });
    setCephAdminBucketVersioningMock.mockResolvedValue(undefined);
    updateCephAdminBucketObjectLockMock.mockResolvedValue({
      enabled: true,
      mode: null,
      days: null,
      years: null,
    });
    fetchCephAdminClusterTrafficMock.mockResolvedValue({
      window: "week",
      start: null,
      end: null,
      series: [],
      totals: { bytes_in: 0, bytes_out: 0, ops: 0, success_rate: null },
      bucket_rankings: [],
      user_rankings: [],
      request_breakdown: [],
      category_breakdown: [],
    });
  });

  it("renders the Manager bucket detail header with a working buckets return action", () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [],
      selectedS3AccountId: null,
      accountIdForApi: null,
      requiresS3AccountSelection: true,
      accessMode: "admin",
      managerBucketQuotaEnabled: false,
    });

    render(
      <MemoryRouter initialEntries={["/manager/buckets/demo-bucket"]}>
        <BucketDetailPage bucketNameOverride="demo-bucket" />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /Back to buckets/i })).toHaveAttribute("href", "/manager/buckets");
  });

  it("supports a history-aware Ceph Admin return action and endpoint-scoped breadcrumb", () => {
    const onBack = vi.fn();
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: null,
      selectedEndpoint: null,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage
          mode="ceph-admin"
          bucketNameOverride="demo-bucket"
          bucketListPathOverride="/ceph-admin/buckets?ep=7"
          onBackToBuckets={onBack}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "Buckets" })).toHaveAttribute("href", "/ceph-admin/buckets?ep=7");
    fireEvent.click(screen.getByRole("button", { name: /Back to buckets/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders the bucket overview without a redundant eyebrow or nested card shell", async () => {
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    const bucketTitle = await screen.findByRole("heading", { name: "Bucket demo-bucket" });
    const overviewSection = bucketTitle.closest("section");

    expect(overviewSection).not.toBeNull();
    expect(overviewSection).not.toHaveClass("ui-surface-card");
    expect(within(overviewSection as HTMLElement).queryByText("Overview")).not.toBeInTheDocument();
    expect(within(overviewSection as HTMLElement).queryByText("Summary of enabled features.")).not.toBeInTheDocument();

    const propertiesGroup = within(overviewSection as HTMLElement).getByText("Bucket properties").parentElement;
    expect(propertiesGroup).not.toHaveClass("ui-surface-muted");
  });

  it("shows a read-only object browser for Ceph Admin buckets", async () => {
    const user = userEvent.setup();
    listCephAdminBucketObjectsMock.mockResolvedValue({
      prefix: "",
      objects: [
        {
          key: "reports/summary.csv",
          size: 2048,
          last_modified: "2026-07-16T08:00:00Z",
          storage_class: "STANDARD",
        },
      ],
      prefixes: ["reports/"],
      is_truncated: false,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Objects / S3 Console" }));

    await waitFor(() =>
      expect(listCephAdminBucketObjectsMock).toHaveBeenCalledWith(1, "demo-bucket", "")
    );
    expect(screen.getAllByText("reports/")).not.toHaveLength(0);
    expect(screen.getByText("reports/summary.csv")).toBeInTheDocument();
    expect(
      screen.getByText("Read-only preview using the selected endpoint's Ceph Admin credentials.")
    ).toBeInTheDocument();
  });

  it("uses the shared warning banner when Ceph Admin bucket context is missing", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: null,
      selectedEndpoint: null,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    const endpointWarning = await screen.findByText("Select a Ceph endpoint before managing this bucket.");
    expect(endpointWarning).toHaveClass("ui-caption");
    expect(endpointWarning).toHaveClass("border-amber-200");
  });

  it("hides Manager quota tab without bucket quota access", async () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [{ id: "ceph-account", name: "Ceph account", endpoint_provider: "ceph" }],
      selectedS3AccountId: "ceph-account",
      accountIdForApi: "ceph-account",
      requiresS3AccountSelection: true,
      accessMode: "admin",
      managerBucketQuotaEnabled: false,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage bucketNameOverride="demo-bucket" embedded hideObjectsTab />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "Bucket demo-bucket" });
    expect(screen.queryByRole("button", { name: "Privileged Ceph" })).not.toBeInTheDocument();
  });

  it("shows Manager quota tab with bucket quota access", async () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_user",
        manager_tool_access: {
          bucket_compare: false,
          bucket_integrity_check: false,
          bucket_migration: false,
          feature_rules: false,
        },
      })
    );
    useS3AccountContextMock.mockReturnValue({
      accounts: [{ id: "ceph-account", name: "Ceph account", endpoint_provider: "ceph" }],
      selectedS3AccountId: "ceph-account",
      accountIdForApi: "ceph-account",
      requiresS3AccountSelection: true,
      accessMode: "admin",
      managerBucketQuotaEnabled: true,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage bucketNameOverride="demo-bucket" embedded hideObjectsTab />
      </MemoryRouter>
    );

    expect(await screen.findByRole("button", { name: "Privileged Ceph" })).toBeInTheDocument();
  });

  it("hides Storage Ops quota tab when the context is not quota eligible", async () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_user",
        manager_tool_access: {
          bucket_compare: false,
          bucket_integrity_check: false,
          bucket_migration: false,
          feature_rules: false,
        },
      })
    );

    render(
      <MemoryRouter>
        <BucketDetailPage
          bucketNameOverride="demo-bucket"
          accountIdOverride="conn-aws"
          hideQuotaTab
          embedded
          hideObjectsTab
        />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "Bucket demo-bucket" });
    expect(screen.queryByRole("button", { name: "Privileged Ceph" })).not.toBeInTheDocument();
  });

  it("treats replication payload with empty role and no rules as not configured", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketReplicationMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Replication")).toBeInTheDocument();
    expect((await screen.findAllByText("Not set")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    const replicationCard = await screen.findByTestId("bucket-feature-replication");
    expect(replicationCard).toHaveAttribute("data-feature-state", "neutral");
    expect(
      screen.getByText("Configure Ceph RGW multisite bucket replication across zones within this bucket's zonegroup.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/cross-zonegroup/i)).not.toBeInTheDocument();
  });

  it("keeps the replication rule ID input mounted and focused while editing", async () => {
    const user = userEvent.setup();
    getCephAdminBucketReplicationMock.mockResolvedValue({
      configuration: {
        Role: "arn:aws:iam::123456789012:role/replication",
        Rules: [
          {
            ID: "rule-1",
            Status: "Enabled",
            Destination: { Bucket: "arn:aws:s3:::target-bucket" },
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => expect(getCephAdminBucketReplicationMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Advanced" }));

    const replicationCard = await screen.findByTestId("bucket-feature-replication");
    await waitFor(() =>
      expect(within(replicationCard).getByRole("textbox", { name: "ID" })).toHaveValue("rule-1")
    );
    const ruleIdInput = within(replicationCard).getByRole("textbox", { name: "ID" });
    await user.type(ruleIdInput, "-updated");

    expect(ruleIdInput).toHaveFocus();
    expect(within(replicationCard).getByRole("textbox", { name: "ID" })).toBe(ruleIdInput);
    expect(ruleIdInput).toHaveValue("rule-1-updated");
  });

  it("preserves bucket tag row identity when removing another draft", async () => {
    const user = userEvent.setup();
    getCephAdminBucketTagsMock.mockResolvedValueOnce({
      tags: [
        { key: "environment", value: "test" },
        { key: "owner", value: "platform" },
      ],
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Properties" }));
    const tagsCard = await screen.findByTestId("bucket-feature-tags");
    const tagKeyInputs = within(tagsCard).getAllByPlaceholderText("Tag key");
    const ownerInput = tagKeyInputs[1];
    const firstTagRow = tagKeyInputs[0].closest("div");
    expect(firstTagRow).not.toBeNull();

    await user.click(within(firstTagRow!).getByRole("button", { name: "Remove" }));

    expect(within(tagsCard).getAllByPlaceholderText("Tag key")[0]).toBe(ownerInput);
    expect(ownerInput).toHaveValue("owner");
  });

  it("disables replication when the endpoint capability is disabled", async () => {
    const user = userEvent.setup();
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        name: "endpoint-1",
        capabilities: {
          static_website: true,
          sse: true,
          metrics: true,
          replication: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    expect(screen.queryByText("Replication")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Advanced" }));

    expect(getCephAdminBucketReplicationMock).not.toHaveBeenCalled();
    const replicationCard = await screen.findByTestId("bucket-feature-replication");
    const replicationShell = replicationCard.parentElement?.parentElement as HTMLElement;
    expect(replicationCard).toHaveAttribute("data-feature-state", "disabled");
    expect(within(replicationCard).getByText("Bucket replication is disabled on this endpoint.")).toBeInTheDocument();
    expect(within(replicationShell).getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(within(replicationShell).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(replicationCard).getByLabelText("Role ARN")).toBeDisabled();
  });

  it("shows the Notifications overview badge when SNS is enabled", async () => {
    getCephAdminBucketNotificationsMock.mockResolvedValueOnce({
      configuration: {
        TopicConfigurations: [
          {
            Id: "topic-1",
            TopicArn: "arn:aws:sns:us-east-1:123456789012:bucket-events",
            Events: ["s3:ObjectCreated:*"],
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketNotificationsMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getAllByText("Configured").length).toBeGreaterThan(0);
  });

  it("hides the Notifications overview badge when SNS is disabled", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        name: "endpoint-1",
        capabilities: {
          static_website: true,
          sse: true,
          metrics: true,
          replication: true,
          sns: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listCephAdminBucketsMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
  });

  it("keeps notifications card neutral for TopicConfigurations empty draft-equivalent payload", async () => {
    const user = userEvent.setup();
    getCephAdminBucketNotificationsMock.mockResolvedValueOnce({
      configuration: { TopicConfigurations: [] },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketNotificationsMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    const notificationsCard = await screen.findByTestId("bucket-feature-notifications");
    expect(notificationsCard).toHaveAttribute("data-feature-state", "neutral");
  });

  it("automatically enables versioning before saving object lock", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Properties" }));

    const objectLockCard = await screen.findByTestId("bucket-feature-object-lock");
    const objectLockSwitch = within(objectLockCard).getByLabelText("Enable object lock");
    await user.click(objectLockSwitch);

    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const objectLockSaveButton = saveButtons.find((button) => button.getAttribute("form") === "bucket-object-lock-form");
    expect(objectLockSaveButton).toBeDefined();
    await user.click(objectLockSaveButton!);

    await waitFor(() => {
      expect(setCephAdminBucketVersioningMock).toHaveBeenCalledWith(1, "demo-bucket", true);
      expect(updateCephAdminBucketObjectLockMock).toHaveBeenCalled();
    });

    const versioningCallOrder = setCephAdminBucketVersioningMock.mock.invocationCallOrder[0];
    const objectLockCallOrder = updateCephAdminBucketObjectLockMock.mock.invocationCallOrder[0];
    expect(versioningCallOrder).toBeLessThan(objectLockCallOrder);
  });

  it("does not render replication info card in Ceph Admin tab", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketReplicationMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Ceph Admin" }));
    expect(screen.queryByText("Replication / multisite")).not.toBeInTheDocument();
  });

  it("keeps Properties cards visible when public access block is unavailable", async () => {
    const user = userEvent.setup();
    getCephAdminBucketPublicAccessBlockMock.mockRejectedValueOnce(new Error("XNotImplemented"));

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketPublicAccessBlockMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Properties" }));

    expect(await screen.findByTestId("bucket-feature-versioning")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-object-lock")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-lifecycle")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-tags")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-encryption")).toBeInTheDocument();
  });

  it("keeps non-versioning Properties cards visible when versioning is unavailable", async () => {
    const user = userEvent.setup();
    getCephAdminBucketVersioningMock.mockRejectedValueOnce(new Error("versioning unavailable"));

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Properties" }));

    expect(await screen.findByText("versioning unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-object-lock")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-lifecycle")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-tags")).toBeInTheDocument();
  });

  it("keeps non-object-lock Properties cards visible when Object Lock is unavailable", async () => {
    const user = userEvent.setup();
    getCephAdminBucketObjectLockMock.mockRejectedValueOnce(new Error("object lock unavailable"));

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Properties" }));

    expect(await screen.findByText("object lock unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-versioning")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-lifecycle")).toBeInTheDocument();
    expect(screen.getByTestId("bucket-feature-tags")).toBeInTheDocument();
  });

  it("omits blank Rule 3 lifecycle expiration fields from the quick-add payload", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketLifecycleMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Properties" }));
    await user.click(screen.getByRole("button", { name: "Show editor" }));
    await user.click(screen.getByRole("button", { name: "Quick add" }));

    const rule3 = screen.getByText("Rule 3: current/noncurrent expiration").closest("div") as HTMLElement;
    const noncurrentDaysInput = within(rule3).getByLabelText("Noncurrent versions expiration (days)");
    const addRule3Button = within(rule3).getByRole("button", { name: "Add" });

    await user.clear(noncurrentDaysInput);
    await user.click(addRule3Button);

    expect(await screen.findByText("Provide current or noncurrent expiration days.")).toBeInTheDocument();
    expect(putCephAdminBucketLifecycleMock).not.toHaveBeenCalled();

    await user.type(noncurrentDaysInput, "90");
    await user.click(addRule3Button);

    await waitFor(() => {
      expect(putCephAdminBucketLifecycleMock).toHaveBeenCalled();
    });

    const savedRules = putCephAdminBucketLifecycleMock.mock.calls[0][2] as Record<string, unknown>[];
    expect(savedRules).toHaveLength(1);
    expect(savedRules[0]).toMatchObject({
      Status: "Enabled",
      Filter: { Prefix: "" },
      NoncurrentVersionExpiration: { NoncurrentDays: 90 },
    });
    expect(savedRules[0]).not.toHaveProperty("Expiration");
  });

  it("disables server access logging when the endpoint does not implement it", async () => {
    const user = userEvent.setup();
    getCephAdminBucketLoggingMock.mockRejectedValueOnce(
      new Error(
        "Unable to fetch bucket logging for 'demo-bucket': An error occurred (XNotImplemented) when calling the GetBucketLogging operation: The request you provided implies functionality that is not implemented."
      )
    );

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketLoggingMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Advanced" }));

    const accessLoggingCard = await screen.findByTestId("bucket-feature-access-logging");
    const accessLoggingShell = accessLoggingCard.parentElement?.parentElement as HTMLElement;
    expect(accessLoggingCard).toHaveAttribute("data-feature-state", "disabled");
    expect(within(accessLoggingShell).getByRole("button", { name: "Disable" })).toBeDisabled();
    expect(within(accessLoggingShell).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(accessLoggingCard).getByLabelText("Enable server access logging")).toBeDisabled();
    expect(within(accessLoggingCard).getByLabelText("Target bucket")).toBeDisabled();
    expect(within(accessLoggingCard).getByLabelText("Target prefix (optional)")).toBeDisabled();
  });

  it("disables JSON feature cards when the endpoint returns XNotImplemented", async () => {
    const user = userEvent.setup();
    getCephAdminBucketNotificationsMock.mockRejectedValueOnce(
      new Error("An error occurred (XNotImplemented) when calling the GetBucketNotificationConfiguration operation.")
    );

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketNotificationsMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Advanced" }));

    const notificationsCard = await screen.findByTestId("bucket-feature-notifications");
    const notificationsShell = notificationsCard.parentElement?.parentElement as HTMLElement;
    expect(notificationsCard).toHaveAttribute("data-feature-state", "disabled");
    expect(within(notificationsShell).getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(within(notificationsShell).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(notificationsCard).getByRole("textbox")).toBeDisabled();
    expect(within(notificationsCard).getByRole("button", { name: "Show example" })).toBeDisabled();
  });

  it("does not disable feature cards for non-implementation-unrelated errors", async () => {
    const user = userEvent.setup();
    getCephAdminBucketLoggingMock.mockRejectedValueOnce(new Error("AccessDenied"));

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getCephAdminBucketLoggingMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Advanced" }));

    const accessLoggingCard = await screen.findByTestId("bucket-feature-access-logging");
    const accessLoggingShell = accessLoggingCard.parentElement?.parentElement as HTMLElement;
    const accessDeniedMessage = within(accessLoggingCard).getByText("AccessDenied");
    expect(accessDeniedMessage).toBeInTheDocument();
    expect(accessDeniedMessage).toHaveClass("ui-caption");
    expect(accessLoggingCard).toHaveAttribute("data-feature-state", "neutral");
    expect(within(accessLoggingShell).getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("keeps bucket Metrics available for non-Ceph manager endpoints", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          kind: "connection",
          id: "conn-aws",
          display_name: "AWS connection",
          tags: [],
          endpoint_tags: [],
          endpoint_provider: "aws",
          storage_endpoint_capabilities: { metrics: true, usage: true },
          capabilities: { can_manage_iam: false, sts_capable: false, admin_api_capable: false },
        },
      ],
      selectedS3AccountId: "conn-aws",
      accountIdForApi: "conn-aws",
      requiresS3AccountSelection: true,
      accessMode: "connection",
      managerBucketQuotaEnabled: false,
    });

    render(
      <MemoryRouter>
        <BucketDetailPage bucketNameOverride="demo-bucket" embedded hideObjectsTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listBucketsMock).toHaveBeenCalled();
    });

    const metricsTab = screen.getByRole("button", { name: "Metrics" });
    expect(metricsTab).not.toBeDisabled();

    await user.click(metricsTab);

    expect(screen.getByText("Current usage and quota")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Traffic" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Live endpoint metrics are unavailable. S3-Manager usage stats calculated from bucket listings remain available in the Usage stats tab."
      )
    ).toBeInTheDocument();
  });

  it("keeps bucket Metrics clickable for Ceph endpoints with metrics enabled", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    const metricsTab = screen.getByRole("button", { name: "Metrics" });
    expect(metricsTab).not.toBeDisabled();

    await user.click(metricsTab);

    expect(await screen.findByText("Current usage and quota")).toBeInTheDocument();
    const trafficTitle = screen.getByRole("heading", { name: "Traffic" });
    expect(trafficTitle).toHaveClass("ui-section");
    expect(screen.queryByText("Bucket: demo-bucket")).not.toBeInTheDocument();
  });

  it("keeps bucket Metrics available for Ceph endpoints when metrics capability is disabled", async () => {
    const user = userEvent.setup();
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        name: "endpoint-1",
        capabilities: {
          static_website: true,
          sse: true,
          metrics: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <BucketDetailPage mode="ceph-admin" bucketNameOverride="demo-bucket" embedded />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listCephAdminBucketsMock).toHaveBeenCalled();
    });

    const metricsTab = screen.getByRole("button", { name: "Metrics" });
    expect(metricsTab).not.toBeDisabled();

    await user.click(metricsTab);

    expect(screen.getByText("Current usage and quota")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Traffic" })).not.toBeInTheDocument();
    expect(screen.getByText(/S3-Manager usage stats calculated from bucket listings/)).toBeInTheDocument();
  });
});

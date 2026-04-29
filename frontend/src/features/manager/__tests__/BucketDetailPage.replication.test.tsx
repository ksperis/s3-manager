import { render, screen, waitFor, within } from "@testing-library/react";
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
const listObjectsMock = vi.fn();
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
  };
});

vi.mock("../../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../../api/cephAdmin")>("../../../api/cephAdmin");
  return {
    ...actual,
    listCephAdminBuckets: (...args: unknown[]) => listCephAdminBucketsMock(...args),
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
    useS3AccountContextMock.mockReturnValue({
      accounts: [],
      selectedS3AccountId: null,
      accountIdForApi: null,
      requiresS3AccountSelection: false,
      accessMode: "admin",
    });
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        name: "endpoint-1",
        capabilities: {
          static_website: true,
          sse: true,
          metrics: true,
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
    getBucketReplicationMock.mockResolvedValue({ configuration: {} });
    listObjectsMock.mockResolvedValue({ prefix: "", objects: [], prefixes: [], is_truncated: false });
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
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    const replicationCard = await screen.findByTestId("bucket-feature-replication");
    expect(replicationCard).toHaveAttribute("data-feature-state", "neutral");
    expect(
      screen.getByText("Configure Ceph RGW multisite bucket replication across zones within this bucket's zonegroup.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/cross-zonegroup/i)).not.toBeInTheDocument();
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

  it("keeps bucket Metrics disabled for non-Ceph manager endpoints", async () => {
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
    expect(metricsTab).toBeDisabled();

    await user.click(metricsTab);

    expect(screen.queryByText("Current Usage and Quota")).not.toBeInTheDocument();
    expect(screen.queryByText("Traffic visualization")).not.toBeInTheDocument();
    expect(screen.queryByText("Metrics are unavailable: this connection endpoint is not a Ceph provider.")).not.toBeInTheDocument();
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

    expect(await screen.findByText("Current Usage and Quota")).toBeInTheDocument();
    const trafficTitle = screen.getByRole("heading", { name: "Traffic visualization" });
    expect(trafficTitle).toHaveClass("ui-subtitle");
    expect(screen.queryByText("Bucket: demo-bucket")).not.toBeInTheDocument();
  });

  it("disables bucket Metrics for Ceph endpoints when metrics capability is disabled", async () => {
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

    expect(screen.getByRole("button", { name: "Metrics" })).toBeDisabled();
  });
});

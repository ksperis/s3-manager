import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BucketDetailPage from "../BucketDetailPage";

const listCephAdminBucketsMock = vi.fn();
const getCephAdminBucketPropertiesMock = vi.fn();
const getCephAdminBucketLifecycleMock = vi.fn();
const getCephAdminBucketEncryptionMock = vi.fn();
const getCephAdminBucketNotificationsMock = vi.fn();
const getCephAdminBucketLoggingMock = vi.fn();
const getCephAdminBucketWebsiteMock = vi.fn();
const getCephAdminBucketReplicationMock = vi.fn();
const getCephAdminBucketPolicyMock = vi.fn();
const getCephAdminBucketAclMock = vi.fn();
const getCephAdminBucketCorsMock = vi.fn();
const setCephAdminBucketVersioningMock = vi.fn();
const updateCephAdminBucketObjectLockMock = vi.fn();

vi.mock("../../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../../api/cephAdmin")>("../../../api/cephAdmin");
  return {
    ...actual,
    listCephAdminBuckets: (...args: unknown[]) => listCephAdminBucketsMock(...args),
    getCephAdminBucketProperties: (...args: unknown[]) => getCephAdminBucketPropertiesMock(...args),
    getCephAdminBucketLifecycle: (...args: unknown[]) => getCephAdminBucketLifecycleMock(...args),
    getCephAdminBucketEncryption: (...args: unknown[]) => getCephAdminBucketEncryptionMock(...args),
    getCephAdminBucketNotifications: (...args: unknown[]) => getCephAdminBucketNotificationsMock(...args),
    getCephAdminBucketLogging: (...args: unknown[]) => getCephAdminBucketLoggingMock(...args),
    getCephAdminBucketWebsite: (...args: unknown[]) => getCephAdminBucketWebsiteMock(...args),
    getCephAdminBucketReplication: (...args: unknown[]) => getCephAdminBucketReplicationMock(...args),
    getCephAdminBucketPolicy: (...args: unknown[]) => getCephAdminBucketPolicyMock(...args),
    getCephAdminBucketAcl: (...args: unknown[]) => getCephAdminBucketAclMock(...args),
    getCephAdminBucketCors: (...args: unknown[]) => getCephAdminBucketCorsMock(...args),
    setCephAdminBucketVersioning: (...args: unknown[]) => setCephAdminBucketVersioningMock(...args),
    updateCephAdminBucketObjectLock: (...args: unknown[]) => updateCephAdminBucketObjectLockMock(...args),
  };
});

vi.mock("../S3AccountContext", () => ({
  useS3AccountContext: () => ({
    accounts: [],
    selectedS3AccountId: null,
    accountIdForApi: null,
    requiresS3AccountSelection: false,
    accessMode: "admin",
  }),
}));

vi.mock("../../cephAdmin/CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => ({
    selectedEndpointId: 1,
    selectedEndpoint: {
      name: "endpoint-1",
      capabilities: {
        static_website: true,
        sse: true,
        metrics: true,
      },
    },
  }),
}));

describe("BucketDetailPage replication state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    getCephAdminBucketLifecycleMock.mockResolvedValue({ rules: [] });
    getCephAdminBucketEncryptionMock.mockResolvedValue({ rules: [] });
    getCephAdminBucketNotificationsMock.mockResolvedValue({ configuration: {} });
    getCephAdminBucketLoggingMock.mockResolvedValue({ enabled: false });
    getCephAdminBucketWebsiteMock.mockResolvedValue(null);
    getCephAdminBucketPolicyMock.mockResolvedValue({ policy: null });
    getCephAdminBucketAclMock.mockResolvedValue({ owner: "owner", grants: [] });
    getCephAdminBucketCorsMock.mockResolvedValue({ rules: [] });
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
});

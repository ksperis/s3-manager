import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
  LONG_RUNNING_REQUEST_TIMEOUT_MS: 0,
}));

import {
  addAdminPortalRequestMessage,
  approveAdminPortalRequest,
  createPortalRequest,
  listAdminPortalRequests,
  listPortalRequests,
  rejectAdminPortalRequest,
} from "./portalRequests";

import {
  createPortalAccessKey,
  fetchPortalActivity,
  deletePortalAccessKey,
  fetchPortalAlerts,
  fetchPortalAccessKeysState,
  fetchPortalCollaborators,
  fetchPortalCollaboratorAccessReview,
  downloadPortalServerAccessRawLogs,
  fetchPortalServerAccessLogPage,
  grantPortalStorageSpaceShare,
  createPortalStorageSpace,
  createPortalStorageSpacePublicLink,
  deletePortalStorageSpace,
  deletePortalStorageSpaceObject,
  downloadPortalStorageSpaceObject,
  fetchPortalStorageSpaceObjectDetail,
  fetchPortalStorageSpaceObjectVersions,
  fetchPortalStorageSpaceAccessSummary,
  fetchPortalStorageSpaceUsageStats,
  fetchPortalUsageHistoryTrends,
  fetchPortalUsageTrends,
  getPortalUsageStatsAggregate,
  importPortalStorageSpace,
  listPortalShareCandidates,
  listPortalStorageSpaceShareCandidates,
  listPortalStorageSpacePublicLinks,
  listPortalStorageSpaces,
  portalStorageSpaceVersionCleanupConfirmationPhrase,
  revokePortalStorageSpacePublicLink,
  revokePortalStorageSpaceShare,
  restorePortalStorageSpaceObject,
  updatePortalAccessKeyStatus,
  updatePortalStorageSpace,
  updatePortalStorageSpaceShare,
} from "./portal";

describe("portal storage spaces api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    clientMock.patch.mockReset();
    clientMock.put.mockReset();
    clientMock.delete.mockReset();
    clientMock.get.mockResolvedValue({ data: [] });
    clientMock.post.mockResolvedValue({ data: { key: "raw-data/report.csv", message: "Uploaded" } });
    clientMock.patch.mockResolvedValue({ data: {} });
    clientMock.put.mockResolvedValue({ data: {} });
    clientMock.delete.mockResolvedValue({ data: [] });
  });

  it("builds history cleanup confirmation phrases as displayed uppercase text", () => {
    expect(portalStorageSpaceVersionCleanupConfirmationPhrase("Test1")).toBe("CLEAN HISTORY TEST1");
    expect(portalStorageSpaceVersionCleanupConfirmationPhrase("Research Data")).toBe("CLEAN HISTORY RESEARCH DATA");
  });

  it("lists storage spaces through the canonical portal endpoint", async () => {
    await listPortalStorageSpaces("101", { search: "research", role: "Owner", status: "Active", sort: "-used_bytes", includeArchived: true });

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces", {
      params: {
        account_id: "101",
        search: "research",
        role: "Owner",
        status: "Active",
        sort: "-used_bytes",
        include_archived: true,
      },
    });
  });

  it("creates and updates storage spaces through user-facing endpoints", async () => {
    await createPortalStorageSpace("101", {
      name: "Research Data",
      naming_mode: "named_bucket",
      description: "Lab files",
      visibility: "shared",
      share_scope: "account",
      account_member_role: "Editor",
      initial_shares: [],
    });
    await importPortalStorageSpace("101", { bucket_name: "existing-bucket", description: "Imported", visibility: "shared", share_scope: "account", account_member_role: "Viewer", initial_shares: [] });
    await updatePortalStorageSpace("101", "research data", { description: "Updated", visibility: "private", share_scope: "restricted", archived: true });

    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/storage-spaces",
      { name: "Research Data", naming_mode: "named_bucket", description: "Lab files", visibility: "shared", share_scope: "account", account_member_role: "Editor", initial_shares: [] },
      { params: { account_id: "101" } }
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/storage-spaces/import",
      { bucket_name: "existing-bucket", description: "Imported", visibility: "shared", share_scope: "account", account_member_role: "Viewer", initial_shares: [] },
      { params: { account_id: "101" } }
    );
    expect(clientMock.patch).toHaveBeenCalledWith(
      "/portal/storage-spaces/research%20data",
      { description: "Updated", visibility: "private", share_scope: "restricted", archived: true },
      { params: { account_id: "101" } }
    );
  });

  it("deletes a storage space through the canonical portal endpoint", async () => {
    await deletePortalStorageSpace("101", "research data");

    expect(clientMock.delete).toHaveBeenCalledWith("/portal/storage-spaces/research%20data", {
      params: { account_id: "101" },
    });
  });

  it("fetches a storage space access summary without IAM vocabulary", async () => {
    clientMock.get.mockResolvedValueOnce({ data: { mode: "restricted", effective_member_count: 2 } });

    await fetchPortalStorageSpaceAccessSummary("101", "research data");

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/access-summary", {
      params: {
        account_id: "101",
      },
    });
  });

  it("fetches object detail and deletes objects through portal object detail endpoints", async () => {
    await fetchPortalStorageSpaceObjectDetail("101", "research data", "raw-data/report.csv");
    await deletePortalStorageSpaceObject("101", "research data", "raw-data/old.csv");

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/objects/detail", {
      params: {
        account_id: "101",
        key: "raw-data/report.csv",
      },
    });
    expect(clientMock.delete).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/objects", {
      params: { account_id: "101", key: "raw-data/old.csv" },
    });
  });

  it("loads file history, then restores a selected version", async () => {
    clientMock.get.mockResolvedValue({ data: { versions: [] } });
    clientMock.post.mockResolvedValueOnce({
      data: {
        key: "raw-data/report.csv",
        restored_from_version_id: "v2",
        message: "Restored",
      },
    });

    await fetchPortalStorageSpaceObjectVersions(
      "101",
      "research data",
      "raw-data/report.csv",
      { keyMarker: "raw-data/report.csv", versionIdMarker: "v3" },
    );
    await restorePortalStorageSpaceObject(
      "101",
      "research data",
      "raw-data/report.csv",
      "v2",
    );

    expect(clientMock.get).toHaveBeenCalledWith(
      "/portal/storage-spaces/research%20data/objects/versions",
      {
        params: {
          account_id: "101",
          key: "raw-data/report.csv",
          key_marker: "raw-data/report.csv",
          version_id_marker: "v3",
        },
      },
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/storage-spaces/research%20data/objects/restore",
      { key: "raw-data/report.csv", version_id: "v2" },
      { params: { account_id: "101" } },
    );
  });

  it("downloads a storage space object as a blob with filename", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    clientMock.get.mockResolvedValueOnce({
      data: blob,
      headers: { "content-disposition": 'attachment; filename="report.csv"' },
    });

    const result = await downloadPortalStorageSpaceObject("101", "research data", "raw-data/report.csv");

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/objects/download", {
      params: {
        account_id: "101",
        key: "raw-data/report.csv",
      },
      responseType: "blob",
      timeout: 0,
    });
    expect(result.blob).toBe(blob);
    expect(result.filename).toBe("report.csv");
  });

  it("forwards an abort signal while loading a storage space object", async () => {
    const controller = new AbortController();
    clientMock.get.mockResolvedValueOnce({
      data: new Blob(["preview"], { type: "image/png" }),
      headers: {},
    });

    await downloadPortalStorageSpaceObject(
      "101",
      "research data",
      "raw-data/photo.png",
      controller.signal,
    );

    expect(clientMock.get).toHaveBeenCalledWith(
      "/portal/storage-spaces/research%20data/objects/download",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("manages storage space shares through canonical portal endpoints", async () => {
    clientMock.get.mockResolvedValueOnce({ data: [] });
    clientMock.post.mockResolvedValueOnce({ data: { id: "research-data:12", role: "Viewer" } });
    clientMock.get.mockResolvedValueOnce({ data: [] });

    await listPortalShareCandidates("101");
    await listPortalStorageSpaceShareCandidates("101", "research data");
    await grantPortalStorageSpaceShare("101", "research data", { email: "viewer@example.com", role: "Viewer" });
    await updatePortalStorageSpaceShare("101", "research data", 12, "Editor");
    await revokePortalStorageSpaceShare("101", "research data", 12);

    expect(clientMock.get).toHaveBeenCalledWith("/portal/share-candidates", {
      params: { account_id: "101" },
    });
    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/share-candidates", {
      params: { account_id: "101" },
    });
    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/storage-spaces/research%20data/shares",
      { email: "viewer@example.com", role: "Viewer" },
      { params: { account_id: "101" } }
    );
    expect(clientMock.put).toHaveBeenCalledWith(
      "/portal/storage-spaces/research%20data/shares/12",
      { role: "Editor" },
      { params: { account_id: "101" } }
    );
    expect(clientMock.delete).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/shares/12", {
      params: { account_id: "101" },
    });
  });

  it("manages public links through storage space endpoints", async () => {
    await listPortalStorageSpacePublicLinks("101", "research data", { objectKey: "raw-data/report.csv", includeRevoked: true });
    await createPortalStorageSpacePublicLink("101", "research data", {
      object_key: "raw-data/report.csv",
      label: "Report",
      expires_at: "2026-06-10T10:00:00Z",
    });
    await revokePortalStorageSpacePublicLink("101", "research data", 42);

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/public-links", {
      params: {
        account_id: "101",
        object_key: "raw-data/report.csv",
        include_revoked: true,
      },
    });
    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/storage-spaces/research%20data/public-links",
      { object_key: "raw-data/report.csv", label: "Report", expires_at: "2026-06-10T10:00:00Z" },
      { params: { account_id: "101" } }
    );
    expect(clientMock.delete).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/public-links/42", {
      params: { account_id: "101" },
    });
  });

  it("fetches portal activity access logs and alerts", async () => {
    await fetchPortalActivity("101", { spaceId: "research data", limit: 25 });
    await fetchPortalCollaborators("101");
    await fetchPortalServerAccessLogPage("101", {
      date: "2026-07-08",
      spaceId: "research data",
      limit: 25,
      offset: 50,
      timezoneOffsetMinutes: -120,
      advancedFilter: '{"match":"all","rules":[{"field":"path","op":"contains","value":"captures/"}]}',
    });
    clientMock.get.mockResolvedValueOnce({
      data: new Blob(["raw"]),
      headers: { "content-disposition": 'attachment; filename="portal-server-access-logs-2026-07-08.log"' },
    });
    await downloadPortalServerAccessRawLogs("101", {
      dateFrom: "2026-07-08",
      dateTo: "2026-07-08",
      spaceId: "research data",
      timezoneOffsetMinutes: -120,
    });
    await fetchPortalAlerts("101", 5);

    expect(clientMock.get).toHaveBeenCalledWith("/portal/activity", {
      params: { account_id: "101", space_id: "research data", limit: 25 },
    });
    expect(clientMock.get).toHaveBeenCalledWith("/portal/collaborators", {
      params: { account_id: "101" },
    });
    expect(clientMock.get).toHaveBeenCalledWith("/portal/access-logs/page", {
      params: {
        account_id: "101",
        date: "2026-07-08",
        space_id: "research data",
        limit: 25,
        offset: 50,
        timezone_offset_minutes: -120,
        advanced_filter: '{"match":"all","rules":[{"field":"path","op":"contains","value":"captures/"}]}',
      },
    });
    expect(clientMock.get).toHaveBeenCalledWith("/portal/access-logs/raw", {
      params: {
        account_id: "101",
        date_from: "2026-07-08",
        date_to: "2026-07-08",
        space_id: "research data",
        timezone_offset_minutes: -120,
      },
      responseType: "blob",
      timeout: 0,
    });
    expect(clientMock.get).toHaveBeenCalledWith("/portal/alerts", {
      params: { account_id: "101", limit: 5 },
    });
  });

  it("fetches a collaborator access review for the selected project", async () => {
    await fetchPortalCollaboratorAccessReview("101", 13);

    expect(clientMock.get).toHaveBeenCalledWith("/portal/collaborators/13/access", {
      params: { account_id: "101" },
    });
  });

  it("manages portal access keys through user-facing endpoints", async () => {
    await fetchPortalAccessKeysState("101");
    await createPortalAccessKey("101");
    await createPortalAccessKey("101", {
      target_type: "external",
      storage_space_id: "research data",
      external_email: "partner@example.org",
      permission: "read_only",
    });
    await updatePortalAccessKeyStatus("101", "AK USER", false);
    await deletePortalAccessKey("101", "AK USER");

    expect(clientMock.get).toHaveBeenCalledWith("/portal/access-keys", {
      params: { account_id: "101" },
    });
    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/access-keys",
      undefined,
      { params: { account_id: "101" } }
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/access-keys",
      {
        target_type: "external",
        storage_space_id: "research data",
        external_email: "partner@example.org",
        permission: "read_only",
      },
      { params: { account_id: "101" } }
    );
    expect(clientMock.put).toHaveBeenCalledWith(
      "/portal/access-keys/AK%20USER/status",
      { active: false },
      { params: { account_id: "101" } }
    );
    expect(clientMock.delete).toHaveBeenCalledWith("/portal/access-keys/AK%20USER", {
      params: { account_id: "101" },
    });
  });

  it("fetches portal usage trends for dashboard KPI baselines", async () => {
    await fetchPortalUsageTrends("101");

    expect(clientMock.get).toHaveBeenCalledWith("/portal/usage-trends", {
      params: { account_id: "101" },
    });
  });

  it("fetches portal usage composition and history through portal endpoints", async () => {
    await getPortalUsageStatsAggregate("101");
    await fetchPortalStorageSpaceUsageStats("101", "space / one");
    await fetchPortalUsageHistoryTrends("101", "month");

    expect(clientMock.get).toHaveBeenCalledWith("/portal/usage-stats/latest", {
      params: { account_id: "101" },
    });
    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/space%20%2F%20one/usage-stats", {
      params: { account_id: "101" },
    });
    expect(clientMock.get).toHaveBeenCalledWith("/portal/usage-history-trends", {
      params: { account_id: "101", window: "month" },
    });
  });

  it("manages portal admin request endpoints", async () => {
    await listPortalRequests("101");
    await createPortalRequest("101", {
      request_type: "portal_user_access",
      target_name: "Jane Viewer",
      target_email: "jane@example.org",
    });
    await createPortalRequest("101", {
      request_type: "portal_user_removal",
      target_name: "Old User",
      target_email: "old@example.org",
      reason: "Left the project",
    });
    await listAdminPortalRequests({
      status: "pending",
      request_type: "account_quota_change",
      account_id: 101,
      search: "jane",
      limit: 50,
    });
    await approveAdminPortalRequest(7, { message: "Approved" });
    await rejectAdminPortalRequest(8, { message: "Rejected" });
    await addAdminPortalRequestMessage(9, { message: "Need more context" });

    expect(clientMock.get).toHaveBeenCalledWith("/portal/requests", {
      params: { account_id: "101" },
    });
    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/requests",
      {
        request_type: "portal_user_access",
        target_name: "Jane Viewer",
        target_email: "jane@example.org",
      },
      { params: { account_id: "101" } }
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/requests",
      {
        request_type: "portal_user_removal",
        target_name: "Old User",
        target_email: "old@example.org",
        reason: "Left the project",
      },
      { params: { account_id: "101" } }
    );
    expect(clientMock.get).toHaveBeenCalledWith("/admin/portal-requests", {
      params: {
        status: "pending",
        request_type: "account_quota_change",
        account_id: 101,
        search: "jane",
        limit: 50,
      },
    });
    expect(clientMock.post).toHaveBeenCalledWith(
      "/admin/portal-requests/7/approve",
      { message: "Approved" }
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      "/admin/portal-requests/8/reject",
      { message: "Rejected" }
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      "/admin/portal-requests/9/messages",
      { message: "Need more context" }
    );
  });
});

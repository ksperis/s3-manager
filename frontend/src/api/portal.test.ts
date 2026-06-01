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
}));

import {
  fetchPortalActivity,
  fetchPortalAlerts,
  grantPortalStorageSpaceShare,
  createPortalStorageSpace,
  createPortalStorageSpaceFolder,
  createPortalStorageSpacePublicLink,
  deletePortalStorageSpaceObject,
  downloadPortalStorageSpaceObject,
  fetchPortalStorageSpaceObjectDetail,
  fetchPortalStorageSpace,
  fetchPortalTransfers,
  listPortalStorageSpacePublicLinks,
  listPortalStorageSpaceShares,
  listPortalStorageSpaceObjects,
  listPortalStorageSpaces,
  revokePortalStorageSpacePublicLink,
  revokePortalStorageSpaceShare,
  updatePortalStorageSpace,
  updatePortalStorageSpaceShare,
  uploadPortalStorageSpaceObject,
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
    await createPortalStorageSpace("101", { name: "Research Data", description: "Lab files" });
    await updatePortalStorageSpace("101", "research data", { description: "Updated", archived: true });

    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/storage-spaces",
      { name: "Research Data", description: "Lab files" },
      { params: { account_id: "101" } }
    );
    expect(clientMock.patch).toHaveBeenCalledWith(
      "/portal/storage-spaces/research%20data",
      { description: "Updated", archived: true },
      { params: { account_id: "101" } }
    );
  });

  it("fetches a storage space detail through the canonical portal endpoint", async () => {
    clientMock.get.mockResolvedValueOnce({ data: { id: "research-data", name: "Research Data", role: "Owner" } });

    await fetchPortalStorageSpace("101", "research data");

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/research%20data", {
      params: {
        account_id: "101",
      },
    });
  });

  it("lists storage space objects through the portal object endpoint", async () => {
    clientMock.get.mockResolvedValueOnce({ data: { prefix: "raw-data/", prefixes: [], objects: [] } });

    await listPortalStorageSpaceObjects("101", "research data", {
      prefix: "raw-data/",
      continuationToken: "token",
      maxKeys: 200,
    });

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/objects", {
      params: {
        account_id: "101",
        prefix: "raw-data/",
        continuation_token: "token",
        max_keys: 200,
      },
    });
  });

  it("uploads a storage space object with multipart form data", async () => {
    const file = new File(["hello"], "report.csv", { type: "text/csv" });

    await uploadPortalStorageSpaceObject("101", "research data", file, { prefix: "raw-data/" });

    expect(clientMock.post).toHaveBeenCalledTimes(1);
    const [url, formData, config] = clientMock.post.mock.calls[0];
    expect(url).toBe("/portal/storage-spaces/research%20data/objects/upload");
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("file")).toBe(file);
    expect(formData.get("prefix")).toBe("raw-data/");
    expect(config).toEqual({ params: { account_id: "101" } });
  });

  it("fetches object detail and creates folders without browser endpoints", async () => {
    await fetchPortalStorageSpaceObjectDetail("101", "research data", "raw-data/report.csv");
    await createPortalStorageSpaceFolder("101", "research data", { prefix: "raw-data/", name: "new-folder" });
    await deletePortalStorageSpaceObject("101", "research data", "raw-data/old.csv");

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/objects/detail", {
      params: {
        account_id: "101",
        key: "raw-data/report.csv",
      },
    });
    expect(clientMock.post).toHaveBeenCalledWith(
      "/portal/storage-spaces/research%20data/objects/folders",
      { prefix: "raw-data/", name: "new-folder" },
      { params: { account_id: "101" } }
    );
    expect(clientMock.delete).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/objects", {
      params: { account_id: "101", key: "raw-data/old.csv" },
    });
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
    });
    expect(result.blob).toBe(blob);
    expect(result.filename).toBe("report.csv");
  });

  it("manages storage space shares through canonical portal endpoints", async () => {
    clientMock.get.mockResolvedValueOnce({ data: [] });
    clientMock.post.mockResolvedValueOnce({ data: { id: "research-data:12", role: "Viewer" } });
    clientMock.get.mockResolvedValueOnce({ data: [] });

    await listPortalStorageSpaceShares("101", "research data");
    await grantPortalStorageSpaceShare("101", "research data", { email: "viewer@example.com", role: "Viewer" });
    await updatePortalStorageSpaceShare("101", "research data", 12, "Editor");
    await revokePortalStorageSpaceShare("101", "research data", 12);

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces/research%20data/shares", {
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

  it("fetches portal activity transfers and alerts", async () => {
    await fetchPortalActivity("101", { spaceId: "research data", limit: 25 });
    await fetchPortalTransfers("101", { limit: 10 });
    await fetchPortalAlerts("101", 5);

    expect(clientMock.get).toHaveBeenCalledWith("/portal/activity", {
      params: { account_id: "101", space_id: "research data", limit: 25 },
    });
    expect(clientMock.get).toHaveBeenCalledWith("/portal/transfers", {
      params: { account_id: "101", limit: 10 },
    });
    expect(clientMock.get).toHaveBeenCalledWith("/portal/alerts", {
      params: { account_id: "101", limit: 5 },
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
}));

import {
  downloadPortalStorageSpaceObject,
  fetchPortalStorageSpace,
  listPortalStorageSpaceObjects,
  listPortalStorageSpaces,
  uploadPortalStorageSpaceObject,
} from "./portal";

describe("portal storage spaces api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    clientMock.get.mockResolvedValue({ data: [] });
    clientMock.post.mockResolvedValue({ data: { key: "raw-data/report.csv", message: "Uploaded" } });
  });

  it("lists storage spaces through the canonical portal endpoint", async () => {
    await listPortalStorageSpaces("101", { search: "research" });

    expect(clientMock.get).toHaveBeenCalledWith("/portal/storage-spaces", {
      params: {
        account_id: "101",
        search: "research",
      },
    });
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
  LONG_RUNNING_REQUEST_TIMEOUT_MS: 0,
}));

import {
  fetchObjectMetadata,
  listBrowserObjects,
  listObjectVersions,
  updateObjectTags,
} from "./browserObjects";

describe("browser object api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.get.mockResolvedValue({
      data: {
        prefix: "",
        objects: [],
        prefixes: [],
        is_truncated: false,
        next_continuation_token: null,
      },
    });
    clientMock.post.mockReset();
    clientMock.post.mockResolvedValue({ data: undefined });
    clientMock.put.mockReset();
    clientMock.put.mockResolvedValue({ data: { key: "demo.txt", tags: [] } });
  });

  it("passes force_refresh when listing objects with an explicit refresh", async () => {
    await listBrowserObjects("conn-7", "bucket-a", {
      prefix: "uploads/",
      maxKeys: 25,
      forceRefresh: true,
    });

    expect(clientMock.get).toHaveBeenCalledWith(
      "/browser/buckets/bucket-a/objects",
      expect.objectContaining({
        params: expect.objectContaining({
          account_id: "conn-7",
          prefix: "uploads/",
          max_keys: 25,
          force_refresh: true,
        }),
      }),
    );
  });

  it("lists hierarchical versions with Portal headers, S3 cursors, and cancellation", async () => {
    const signal = new AbortController().signal;

    await listObjectVersions("101", "research data", {
      prefix: "reports/",
      delimiter: "/",
      keyMarker: "reports/a.txt",
      versionIdMarker: "v2",
      maxKeys: 1000,
      signal,
      requestOptions: { workspaceSurface: "portal" },
    });

    expect(clientMock.get).toHaveBeenCalledWith(
      "/browser/buckets/research%20data/versions",
      {
        params: {
          account_id: "101",
          prefix: "reports/",
          delimiter: "/",
          key: undefined,
          key_marker: "reports/a.txt",
          version_id_marker: "v2",
          max_keys: 1000,
        },
        headers: { "X-S3-Workspace": "portal" },
        signal,
      },
    );
  });

  it("sends the explicit Manager Browser surface on object reads and writes", async () => {
    clientMock.get.mockResolvedValue({ data: {} });

    await fetchObjectMetadata(
      "12",
      "bucket-a",
      "demo.txt",
      null,
      null,
      undefined,
      { workspaceSurface: "manager" },
    );
    await updateObjectTags(
      "12",
      "bucket-a",
      { key: "demo.txt", tags: [] },
      undefined,
      { workspaceSurface: "manager" },
    );

    for (const call of clientMock.get.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({ headers: { "X-S3-Workspace": "manager-browser" } }),
      );
    }
    expect(clientMock.put).toHaveBeenCalledWith(
      "/browser/buckets/bucket-a/object-tags",
      { key: "demo.txt", tags: [] },
      expect.objectContaining({ headers: { "X-S3-Workspace": "manager-browser" } }),
    );
  });
});

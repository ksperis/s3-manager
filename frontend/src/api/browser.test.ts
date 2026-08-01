import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
  LONG_RUNNING_REQUEST_TIMEOUT_MS: 0,
}));

import {
  getBucketVersioning,
  listBrowserObjects,
  listObjectVersions,
  proxyUpload,
} from "./browser";

describe("browser api", () => {
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

    await getBucketVersioning("101", "research data", {
      workspaceSurface: "portal",
    });
    await listObjectVersions("101", "research data", {
      prefix: "reports/",
      delimiter: "/",
      keyMarker: "reports/a.txt",
      versionIdMarker: "v2",
      maxKeys: 1000,
      signal,
      requestOptions: { workspaceSurface: "portal" },
    });

    expect(clientMock.get).toHaveBeenNthCalledWith(
      1,
      "/browser/buckets/research%20data/versioning",
      {
        params: { account_id: "101" },
        headers: { "X-S3-Workspace": "portal" },
      },
    );
    expect(clientMock.get).toHaveBeenNthCalledWith(
      2,
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

  it.each([
    ["text/plain", "text/plain"],
    ["", "application/octet-stream"],
  ])(
    "sends the browser file content type '%s' as proxy upload metadata",
    async (fileType, expectedContentType) => {
      const file = new File(["payload"], "report.txt", { type: fileType });

      await proxyUpload("conn-7", "bucket-a", "uploads/report.txt", file);

      const form = clientMock.post.mock.calls[0]?.[1] as FormData;
      expect(form.get("content_type")).toBe(expectedContentType);
    },
  );
});

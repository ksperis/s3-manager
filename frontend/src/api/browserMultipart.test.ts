import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./client", () => ({ default: clientMock }));

import {
  abortMultipartUpload,
  completeMultipartUpload,
  initiateMultipartUpload,
  listMultipartUploads,
  presignPart,
} from "./browserMultipart";

const SSE_CUSTOMER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("browser multipart api", () => {
  beforeEach(() => {
    clientMock.delete.mockReset();
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    clientMock.get.mockResolvedValue({
      data: { uploads: [], is_truncated: false },
    });
    clientMock.post.mockResolvedValue({ data: {} });
  });

  it("initiates and presigns multipart uploads with canonical workspace and SSE-C headers", async () => {
    await initiateMultipartUpload(
      "account-1",
      "research data",
      { key: "archive.tar", content_type: "application/x-tar" },
      SSE_CUSTOMER_KEY,
      { workspaceSurface: "manager" },
    );
    await presignPart(
      "account-1",
      "research data",
      "upload/1",
      { key: "archive.tar", part_number: 2 },
      SSE_CUSTOMER_KEY,
      { workspaceSurface: "manager" },
    );

    const expectedHeaders = {
      "X-S3-SSE-C-Key": SSE_CUSTOMER_KEY,
      "X-S3-SSE-C-Algorithm": "AES256",
      "X-S3-Workspace": "manager-browser",
    };
    expect(clientMock.post).toHaveBeenNthCalledWith(
      1,
      "/browser/buckets/research%20data/multipart/initiate",
      { key: "archive.tar", content_type: "application/x-tar" },
      {
        params: { account_id: "account-1" },
        headers: expectedHeaders,
      },
    );
    expect(clientMock.post).toHaveBeenNthCalledWith(
      2,
      "/browser/buckets/research%20data/multipart/upload%2F1/presign",
      { key: "archive.tar", part_number: 2 },
      {
        params: { account_id: "account-1" },
        headers: expectedHeaders,
      },
    );
  });

  it("keeps multipart listing cursors and completion actions scoped to Portal", async () => {
    await listMultipartUploads("account-1", "research data", {
      prefix: "exports/",
      keyMarker: "exports/a.tar",
      uploadIdMarker: "upload-1",
      maxUploads: 25,
      workspaceSurface: "portal",
    });
    await completeMultipartUpload(
      "account-1",
      "research data",
      "upload-1",
      "exports/a.tar",
      { parts: [{ part_number: 1, etag: "etag-1" }] },
      { workspaceSurface: "portal" },
    );
    await abortMultipartUpload(
      "account-1",
      "research data",
      "upload-2",
      "exports/b.tar",
      { workspaceSurface: "portal" },
    );

    expect(clientMock.get).toHaveBeenCalledWith(
      "/browser/buckets/research%20data/multipart",
      {
        params: {
          account_id: "account-1",
          prefix: "exports/",
          key_marker: "exports/a.tar",
          upload_id_marker: "upload-1",
          max_uploads: 25,
        },
        headers: { "X-S3-Workspace": "portal" },
      },
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      "/browser/buckets/research%20data/multipart/upload-1/complete",
      { parts: [{ part_number: 1, etag: "etag-1" }] },
      {
        params: { account_id: "account-1", key: "exports/a.tar" },
        headers: { "X-S3-Workspace": "portal" },
      },
    );
    expect(clientMock.delete).toHaveBeenCalledWith(
      "/browser/buckets/research%20data/multipart/upload-2",
      {
        params: { account_id: "account-1", key: "exports/b.tar" },
        headers: { "X-S3-Workspace": "portal" },
      },
    );
  });
});

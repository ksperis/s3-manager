import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
  buildApiFetchHeaders: (headers: Record<string, string>) => headers,
  LONG_RUNNING_REQUEST_TIMEOUT_MS: 0,
}));

import {
  buildBrowserFetchHeaders,
  presignObject,
  proxyDownload,
  proxyUpload,
} from "./browserTransfers";

const SSE_CUSTOMER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("browser transfer api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    clientMock.get.mockResolvedValue({ data: new Blob(["download"]) });
    clientMock.post.mockResolvedValue({
      data: { url: "https://s3.test/object", method: "PUT", expires_in: 900 },
    });
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

  it("preserves workspace, SSE-C, and account context across transfer requests", async () => {
    const signal = new AbortController().signal;
    const headers = {
      "X-S3-SSE-C-Key": SSE_CUSTOMER_KEY,
      "X-S3-SSE-C-Algorithm": "AES256",
      "X-S3-Workspace": "manager-browser",
    };

    await presignObject(
      "account-1",
      "research data",
      { key: "reports/a.csv", operation: "put_object" },
      SSE_CUSTOMER_KEY,
      { workspaceSurface: "manager" },
    );
    const downloaded = await proxyDownload(
      "account-1",
      "research data",
      "reports/a.csv",
      signal,
      SSE_CUSTOMER_KEY,
      { workspaceSurface: "manager" },
    );

    expect(downloaded).toBeInstanceOf(Blob);
    expect(clientMock.post).toHaveBeenCalledWith(
      "/browser/buckets/research%20data/presign",
      { key: "reports/a.csv", operation: "put_object" },
      { params: { account_id: "account-1" }, headers },
    );
    expect(clientMock.get).toHaveBeenCalledWith(
      "/browser/buckets/research%20data/download",
      {
        params: { account_id: "account-1", key: "reports/a.csv" },
        headers,
        responseType: "blob",
        signal,
        timeout: 0,
      },
    );
    expect(
      buildBrowserFetchHeaders(
        { workspaceSurface: "manager" },
        SSE_CUSTOMER_KEY,
      ),
    ).toEqual(headers);
  });
});

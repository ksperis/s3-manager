import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadBrowserTransferBlob,
  downloadBrowserTransferStream,
  uploadBrowserTransferBlob,
} from "./browserObjectTransferTransport";

const apiMocks = vi.hoisted(() => ({
  presignObject: vi.fn(),
  proxyDownload: vi.fn(),
  proxyUpload: vi.fn(),
}));

vi.mock("../../api/browser", async () => {
  const actual = await vi.importActual<typeof import("../../api/browser")>(
    "../../api/browser",
  );
  return {
    ...actual,
    presignObject: (...args: unknown[]) => apiMocks.presignObject(...args),
    proxyDownload: (...args: unknown[]) => apiMocks.proxyDownload(...args),
    proxyUpload: (...args: unknown[]) => apiMocks.proxyUpload(...args),
  };
});

const fetchMock = vi.fn();

describe("browser object transfer transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    apiMocks.proxyUpload.mockResolvedValue(undefined);
  });

  it("downloads direct blobs through the context presigner", async () => {
    const signal = new AbortController().signal;
    const directPresign = vi.fn().mockResolvedValue({
      url: "https://download.test/report.csv",
      method: "GET",
      expires_in: 900,
      headers: { "X-Signed": "yes" },
    });
    fetchMock.mockResolvedValue(new Response("content", { status: 200 }));

    const blob = await downloadBrowserTransferBlob({
      selector: "acc-1",
      bucket: "reports",
      key: "monthly.csv",
      mode: "direct",
      signal,
      directPresign,
    });

    expect(directPresign).toHaveBeenCalledWith({
      key: "monthly.csv",
      operation: "get_object",
      expires_in: 900,
    });
    expect(apiMocks.presignObject).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://download.test/report.csv",
      { headers: { "X-Signed": "yes" }, signal },
    );
    expect(blob.size).toBe(7);
  });

  it("delegates proxy blob downloads with the complete execution context", async () => {
    const signal = new AbortController().signal;
    const expected = new Blob(["proxy"]);
    apiMocks.proxyDownload.mockResolvedValue(expected);

    const blob = await downloadBrowserTransferBlob({
      selector: "acc-2",
      bucket: "archives",
      key: "backup.tar",
      mode: "proxy",
      signal,
      sseCustomerKeyBase64: "secret",
      options: { workspaceSurface: "manager" },
    });

    expect(blob).toBe(expected);
    expect(apiMocks.proxyDownload).toHaveBeenCalledWith(
      "acc-2",
      "archives",
      "backup.tar",
      signal,
      "secret",
      { workspaceSurface: "manager" },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams proxy downloads through an authenticated Browser request", async () => {
    const signal = new AbortController().signal;
    fetchMock.mockResolvedValue(new Response("stream", { status: 200 }));

    const stream = await downloadBrowserTransferStream({
      selector: "acc-3",
      bucket: "bucket name",
      key: "folder/report.csv",
      mode: "proxy",
      signal,
      options: { workspaceSurface: "manager" },
    });

    const [url, request] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const parsedUrl = new URL(url);
    expect(parsedUrl.pathname).toBe("/api/browser/buckets/bucket%20name/download");
    expect(parsedUrl.searchParams.get("key")).toBe("folder/report.csv");
    expect(parsedUrl.searchParams.get("account_id")).toBe("acc-3");
    expect(request).toMatchObject({
      credentials: "include",
      signal,
      headers: { "X-S3-Workspace": "manager-browser" },
    });
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  it("uses the account presigner for direct cross-context streams", async () => {
    apiMocks.presignObject.mockResolvedValue({
      url: "https://download.test/stream",
      method: "GET",
      expires_in: 900,
      headers: { "X-Signed": "yes" },
    });
    fetchMock.mockResolvedValue(new Response("stream", { status: 200 }));

    const stream = await downloadBrowserTransferStream({
      selector: "acc-5",
      bucket: "source",
      key: "large.bin",
      mode: "direct",
      sseCustomerKeyBase64: "secret",
      options: { workspaceSurface: "portal" },
    });

    expect(apiMocks.presignObject).toHaveBeenCalledWith(
      "acc-5",
      "source",
      {
        key: "large.bin",
        operation: "get_object",
        expires_in: 900,
      },
      "secret",
      { workspaceSurface: "portal" },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://download.test/stream",
      { headers: { "X-Signed": "yes" }, signal: undefined },
    );
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  it("uploads direct blobs with an explicit PUT object contract", async () => {
    const blob = new Blob(["payload"], { type: "text/plain" });
    const signal = new AbortController().signal;
    apiMocks.presignObject.mockResolvedValue({
      url: "https://upload.test/object",
      method: "PUT",
      expires_in: 1800,
      headers: { "X-Signed": "yes" },
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await uploadBrowserTransferBlob({
      selector: "acc-4",
      bucket: "target",
      key: "copied.txt",
      mode: "direct",
      blob,
      contentType: "text/plain",
      signal,
      sseCustomerKeyBase64: "secret",
      options: { workspaceSurface: "portal" },
    });

    expect(apiMocks.presignObject).toHaveBeenCalledWith(
      "acc-4",
      "target",
      {
        key: "copied.txt",
        operation: "put_object",
        content_type: "text/plain",
        content_length: 7,
        expires_in: 1800,
      },
      "secret",
      { workspaceSurface: "portal" },
    );
    expect(fetchMock).toHaveBeenCalledWith("https://upload.test/object", {
      method: "PUT",
      headers: { "X-Signed": "yes", "Content-Type": "text/plain" },
      body: blob,
      signal,
    });
  });

  it("delegates proxy blob uploads with a stable fallback filename", async () => {
    const blob = new Blob(["payload"]);

    await uploadBrowserTransferBlob({
      selector: "acc-6",
      bucket: "target",
      key: "folder/",
      mode: "proxy",
      blob,
      options: { workspaceSurface: "manager" },
    });

    expect(apiMocks.proxyUpload).toHaveBeenCalledWith(
      "acc-6",
      "target",
      "folder/",
      blob,
      undefined,
      undefined,
      undefined,
      "upload.bin",
      { workspaceSurface: "manager" },
    );
    expect(apiMocks.presignObject).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

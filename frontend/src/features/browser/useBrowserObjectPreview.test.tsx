import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserObjectPreview } from "./useBrowserObjectPreview";

const apiMocks = vi.hoisted(() => ({
  fetchObjectMetadata: vi.fn(),
  proxyDownload: vi.fn(),
}));

vi.mock("../../api/browser", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browser")>(
      "../../api/browser",
    );
  return {
    ...actual,
    fetchObjectMetadata: (...args: unknown[]) =>
      apiMocks.fetchObjectMetadata(...args),
  };
});

vi.mock("../../api/browserTransfers", () => ({
  proxyDownload: (...args: unknown[]) => apiMocks.proxyDownload(...args),
}));

const baseOptions = {
  accountId: "acc-1",
  bucketName: "bucket-a",
  metadataLoaded: false,
  objectKey: "docs/report.txt",
  objectName: "report.txt",
  presignObjectRequest: vi.fn(),
  useProxyTransfers: false,
} as const;

describe("useBrowserObjectPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads proxy previews with the current encryption and workspace context", async () => {
    const blob = new Blob(["preview"], { type: "text/plain" });
    apiMocks.proxyDownload.mockResolvedValue(blob);
    const { result } = renderHook(() =>
      useBrowserObjectPreview({
        ...baseOptions,
        requestOptions: { workspaceSurface: "manager-browser" },
        sseCustomerKeyBase64: "customer-key",
        useProxyTransfers: true,
      }),
    );
    const controller = new AbortController();

    await act(async () => {
      await expect(result.current.loadBlob(controller.signal)).resolves.toEqual(
        { blob, contentType: "text/plain" },
      );
    });
    expect(apiMocks.proxyDownload).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      "docs/report.txt",
      controller.signal,
      "customer-key",
      { workspaceSurface: "manager-browser" },
    );
    expect(baseOptions.presignObjectRequest).not.toHaveBeenCalled();
  });

  it("loads a direct preview through an inline signed URL", async () => {
    const blob = new Blob(["preview"], { type: "image/png" });
    const presignObjectRequest = vi.fn().mockResolvedValue({
      url: "https://objects.example.test/report.txt",
      method: "GET",
      expires_in: 900,
      headers: { "x-preview": "value" },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useBrowserObjectPreview({ ...baseOptions, presignObjectRequest }),
    );
    const controller = new AbortController();

    await act(async () => {
      await expect(result.current.loadBlob(controller.signal)).resolves.toEqual(
        { blob, contentType: "image/png" },
      );
    });
    expect(presignObjectRequest).toHaveBeenCalledWith("bucket-a", {
      key: "docs/report.txt",
      operation: "get_object",
      expires_in: 900,
      response_content_disposition: expect.stringContaining("inline;"),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://objects.example.test/report.txt",
      { headers: { "x-preview": "value" }, signal: controller.signal },
    );

    fetchMock.mockResolvedValueOnce({ ok: false });
    await act(async () => {
      await expect(result.current.loadBlob(controller.signal)).rejects.toThrow(
        "Preview download failed.",
      );
    });
  });

  it("uses loaded content type metadata without another API request", async () => {
    const { result } = renderHook(() =>
      useBrowserObjectPreview({
        ...baseOptions,
        metadataContentType: "application/pdf",
        metadataLoaded: true,
      }),
    );

    await act(async () => {
      await expect(
        result.current.resolveContentType(new AbortController().signal),
      ).resolves.toBe("application/pdf");
    });
    expect(apiMocks.fetchObjectMetadata).not.toHaveBeenCalled();
  });

  it("resolves missing metadata and suppresses only non-abort failures", async () => {
    apiMocks.fetchObjectMetadata
      .mockResolvedValueOnce({ content_type: "text/csv" })
      .mockRejectedValueOnce(new Error("metadata unavailable"))
      .mockRejectedValueOnce(new Error("request aborted"));
    const { result } = renderHook(() =>
      useBrowserObjectPreview({ ...baseOptions }),
    );

    await act(async () => {
      await expect(
        result.current.resolveContentType(new AbortController().signal),
      ).resolves.toBe("text/csv");
      await expect(
        result.current.resolveContentType(new AbortController().signal),
      ).resolves.toBeNull();
    });

    const abortedController = new AbortController();
    abortedController.abort();
    await act(async () => {
      await expect(
        result.current.resolveContentType(abortedController.signal),
      ).rejects.toThrow("request aborted");
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenNthCalledWith(
      1,
      "acc-1",
      "bucket-a",
      "docs/report.txt",
      null,
      undefined,
      expect.any(AbortSignal),
      undefined,
    );
  });
});

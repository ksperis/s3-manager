import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MULTIPART_THRESHOLD } from "./browserConstants";
import type { UploadQueueItem } from "./browserTypes";
import { useBrowserQueuedUpload } from "./useBrowserQueuedUpload";

const apiMocks = vi.hoisted(() => ({
  abortMultipartUpload: vi.fn(),
  completeMultipartUpload: vi.fn(),
  initiateMultipartUpload: vi.fn(),
  proxyUpload: vi.fn(),
}));

const uploadMocks = vi.hoisted(() => ({
  uploadBrowserFile: vi.fn(),
  uploadBrowserFileMultipart: vi.fn(),
}));

vi.mock("../../api/browser", async () => ({
  ...(await vi.importActual<typeof import("../../api/browser")>(
    "../../api/browser",
  )),
  ...apiMocks,
}));

vi.mock("./browserFileUpload", () => ({
  uploadBrowserFile: uploadMocks.uploadBrowserFile,
}));

vi.mock("./browserMultipartUpload", () => ({
  uploadBrowserFileMultipart: uploadMocks.uploadBrowserFileMultipart,
}));

const makeItem = (file = new File(["data"], "report.txt")): UploadQueueItem => ({
  id: "upload-1",
  file,
  relativePath: "docs/report.txt",
  key: "prefix/docs/report.txt",
  bucket: "bucket-a",
  accountId: "acc-1",
  groupId: "group-1",
  groupLabel: "docs",
  groupKind: "folder",
  itemLabel: "report.txt",
});

function createOptions() {
  return {
    clearOperationController: vi.fn(),
    completeOperation: vi.fn(),
    createOperationController: vi.fn(() => new AbortController()),
    onStatus: vi.fn(),
    onUploaded: vi.fn(),
    onWarning: vi.fn(),
    presignObject: vi.fn().mockResolvedValue({
      url: "https://example.test/upload",
      method: "PUT",
      expires_in: 1800,
      headers: {},
    }),
    presignPart: vi.fn().mockResolvedValue({
      url: "https://example.test/part",
      method: "PUT",
      expires_in: 1800,
      headers: {},
    }),
    requestOptions: { workspaceSurface: "browser" as const },
    sseCustomerKeyBase64: "customer-key",
    startOperation: vi.fn(() => "op-1"),
    transferReporter: {
      start: vi.fn(() => "transfer-1"),
      complete: vi.fn(),
      fail: vi.fn(),
    },
    updateOperation: vi.fn(),
    useProxyTransfers: false,
  };
}

describe("useBrowserQueuedUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.abortMultipartUpload.mockResolvedValue(undefined);
    apiMocks.completeMultipartUpload.mockResolvedValue(undefined);
    apiMocks.initiateMultipartUpload.mockResolvedValue({ upload_id: "mp-1" });
    apiMocks.proxyUpload.mockResolvedValue(undefined);
    uploadMocks.uploadBrowserFile.mockResolvedValue(undefined);
    uploadMocks.uploadBrowserFileMultipart.mockResolvedValue(undefined);
  });

  it("completes a direct upload and reports the uploaded key", async () => {
    uploadMocks.uploadBrowserFile.mockImplementation(
      async ({ onProgress, presign }: {
        onProgress: (event: { loaded: number; total: number }) => void;
        presign: () => Promise<unknown>;
      }) => {
        await presign();
        onProgress({ loaded: 4, total: 4 });
      },
    );
    const options = createOptions();
    const item = makeItem();
    const { result } = renderHook(() => useBrowserQueuedUpload(options));

    await act(async () => result.current(item));

    expect(options.presignObject).toHaveBeenCalledWith("bucket-a", {
      key: "prefix/docs/report.txt",
      operation: "put_object",
      content_type: undefined,
      expires_in: 1800,
    });
    expect(options.updateOperation).toHaveBeenCalledWith("op-1", {
      progress: 100,
    });
    expect(options.completeOperation).toHaveBeenCalledWith("op-1", "done");
    expect(options.transferReporter.complete).toHaveBeenCalledWith(
      "transfer-1",
      "report.txt",
    );
    expect(options.onUploaded).toHaveBeenCalledWith(
      "bucket-a",
      "prefix/docs/report.txt",
    );
  });

  it("delegates large direct files to the multipart lifecycle", async () => {
    const file = new File(["multipart"], "large.bin", {
      type: "application/octet-stream",
    });
    Object.defineProperty(file, "size", { value: MULTIPART_THRESHOLD });
    uploadMocks.uploadBrowserFileMultipart.mockImplementation(
      async ({ lifecycle, onProgress }: {
        lifecycle: {
          initiate: () => Promise<string>;
          presignPart: (uploadId: string, partNumber: number) => Promise<unknown>;
          complete: (
            uploadId: string,
            parts: Array<{ part_number: number; etag: string }>,
          ) => Promise<void>;
        };
        onProgress: (progress: number) => void;
      }) => {
        const uploadId = await lifecycle.initiate();
        await lifecycle.presignPart(uploadId, 1);
        onProgress(60);
        await lifecycle.complete(uploadId, [
          { part_number: 1, etag: "etag-1" },
        ]);
      },
    );
    const options = createOptions();
    const { result } = renderHook(() => useBrowserQueuedUpload(options));

    await act(async () => result.current(makeItem(file)));

    expect(options.updateOperation).toHaveBeenCalledWith("op-1", {
      label: "Multipart upload",
    });
    expect(apiMocks.initiateMultipartUpload).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        key: "prefix/docs/report.txt",
        content_type: "application/octet-stream",
      },
      "customer-key",
      options.requestOptions,
    );
    expect(options.presignPart).toHaveBeenCalledWith("bucket-a", "mp-1", {
      key: "prefix/docs/report.txt",
      part_number: 1,
      expires_in: 1800,
    });
    expect(apiMocks.completeMultipartUpload).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      "mp-1",
      "prefix/docs/report.txt",
      { parts: [{ part_number: 1, etag: "etag-1" }] },
      options.requestOptions,
    );
    expect(options.updateOperation).toHaveBeenCalledWith("op-1", {
      progress: 60,
    });
  });

  it("marks an aborted upload as cancelled", async () => {
    uploadMocks.uploadBrowserFile.mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );
    const options = createOptions();
    const { result } = renderHook(() => useBrowserQueuedUpload(options));

    await act(async () => result.current(makeItem()));

    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "cancelled",
    );
    expect(options.transferReporter.fail).toHaveBeenCalledWith(
      "transfer-1",
      "Upload cancelled for docs/report.txt",
    );
    expect(options.onStatus).toHaveBeenCalledWith(
      "Upload cancelled for docs/report.txt",
    );
    expect(options.onUploaded).not.toHaveBeenCalled();
    expect(options.clearOperationController).toHaveBeenCalledWith("op-1");
  });
});

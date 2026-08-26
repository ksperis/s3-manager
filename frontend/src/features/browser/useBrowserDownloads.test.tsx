import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserItem } from "./browserTypes";
import { useBrowserDownloads } from "./useBrowserDownloads";

const archiveMocks = vi.hoisted(() => ({
  downloadBrowserFolderArchive: vi.fn(),
}));
const downloadMocks = vi.hoisted(() => ({
  downloadBrowserTransferBlob: vi.fn(),
  downloadBrowserTransferStream: vi.fn(),
  triggerBlobDownload: vi.fn(),
}));

vi.mock("./browserFolderDownload", async () => ({
  ...(await vi.importActual<typeof import("./browserFolderDownload")>(
    "./browserFolderDownload",
  )),
  downloadBrowserFolderArchive: archiveMocks.downloadBrowserFolderArchive,
}));

vi.mock("./browserObjectTransferTransport", async () => ({
  ...(await vi.importActual<
    typeof import("./browserObjectTransferTransport")
  >("./browserObjectTransferTransport")),
  downloadBrowserTransferBlob: downloadMocks.downloadBrowserTransferBlob,
  downloadBrowserTransferStream: downloadMocks.downloadBrowserTransferStream,
}));

vi.mock("../../utils/download", () => ({
  triggerBlobDownload: downloadMocks.triggerBlobDownload,
}));

function item(key: string, type: "file" | "folder" = "file"): BrowserItem {
  return {
    id: `${type}:${key}`,
    key,
    name: key.replace(/\/$/, "").split("/").at(-1) ?? key,
    type,
    size: "12 B",
    modified: "",
    owner: "",
    sizeBytes: 12,
    modifiedAt: null,
  };
}

function createOptions() {
  return {
    accountId: "acc-1",
    bucketName: "bucket-a",
    cancelDownloadDetails: vi.fn(),
    clearOperationController: vi.fn(),
    completeOperation: vi.fn(),
    createOperationController: vi.fn(() => new AbortController()),
    currentPath: "bucket-a/docs",
    enabled: true,
    listAllObjectsForPrefix: vi.fn().mockResolvedValue([]),
    onStatus: vi.fn(),
    onWarning: vi.fn(),
    parallelism: 2,
    presignDownload: vi.fn().mockResolvedValue({
      url: "https://download.example/report.txt",
      method: "GET",
      expires_in: 900,
    }),
    requestOptions: undefined,
    setDownloadDetails: vi.fn(),
    showOperations: vi.fn(),
    sseActive: false,
    sseCustomerKeyBase64: null,
    startOperation: vi.fn(() => "op-1"),
    streamingZipThresholdMb: 200,
    transferReporter: {
      start: vi.fn(() => "transfer-1"),
      complete: vi.fn(),
      fail: vi.fn(),
    },
    updateOperation: vi.fn(),
    useProxyTransfers: false,
  };
}

describe("useBrowserDownloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadMocks.downloadBrowserTransferBlob.mockResolvedValue(
      new Blob(["content"]),
    );
    downloadMocks.downloadBrowserTransferStream.mockResolvedValue(
      new ReadableStream(),
    );
    archiveMocks.downloadBrowserFolderArchive.mockResolvedValue({
      cancelled: false,
      failedKeys: [],
    });
  });

  it("opens a presigned URL for an ordinary direct download", async () => {
    const options = createOptions();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(async () => {
      await result.current.downloadItems([item("docs/report.txt")]);
    });

    expect(options.presignDownload).toHaveBeenCalledWith("bucket-a", {
      key: "docs/report.txt",
      operation: "get_object",
      expires_in: 900,
    });
    expect(openSpy).toHaveBeenCalledWith(
      "https://download.example/report.txt",
      "_blank",
    );
    expect(options.transferReporter.start).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("downloads controlled objects as blobs and reports completion", async () => {
    const options = { ...createOptions(), useProxyTransfers: true };
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(async () => {
      await result.current.downloadItems([item("docs/report.txt")]);
    });

    expect(downloadMocks.downloadBrowserTransferBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: "acc-1",
        bucket: "bucket-a",
        key: "docs/report.txt",
        mode: "proxy",
      }),
    );
    expect(downloadMocks.triggerBlobDownload).toHaveBeenCalledWith(
      "report.txt",
      expect.any(Blob),
    );
    expect(options.transferReporter.complete).toHaveBeenCalledWith(
      "transfer-1",
      "report.txt",
    );
  });

  it("tracks concurrent multi-file downloads as one operation", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(async () => {
      await result.current.downloadItems([
        item("docs/a.txt"),
        item("docs/b.txt"),
      ]);
    });

    expect(downloadMocks.downloadBrowserTransferBlob).toHaveBeenCalledTimes(2);
    expect(options.showOperations).toHaveBeenCalledOnce();
    expect(options.setDownloadDetails).toHaveBeenCalled();
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "done",
      undefined,
    );
    expect(options.onStatus).toHaveBeenCalledWith("Downloaded 2 files");
  });

  it("builds and executes a folder archive plan", async () => {
    const options = createOptions();
    options.listAllObjectsForPrefix.mockResolvedValue([
      { key: "docs/archive/a.txt", size: 12 },
    ]);
    const { result } = renderHook(() => useBrowserDownloads(options));

    await act(async () => {
      await result.current.downloadFolder(item("docs/archive/", "folder"));
    });

    expect(options.listAllObjectsForPrefix).toHaveBeenCalledWith(
      "docs/archive/",
    );
    expect(archiveMocks.downloadBrowserFolderArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        folderLabel: "archive",
        parallelism: 2,
        streamingThresholdBytes: 200 * 1024 * 1024,
        totalBytes: 12,
      }),
    );
    expect(options.onStatus).toHaveBeenCalledWith("Downloaded archive");
    expect(options.clearOperationController).toHaveBeenCalledWith("op-1");
  });
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserObjectVersion } from "../../api/browser";
import { useBrowserVersionActions } from "./useBrowserVersionActions";

const apiMocks = vi.hoisted(() => ({ copyObject: vi.fn(), deleteObjects: vi.fn() }));

vi.mock("../../api/browser", async () => ({
  ...(await vi.importActual<typeof import("../../api/browser")>("../../api/browser")),
  ...apiMocks,
}));

const version = (deleteMarker = false): BrowserObjectVersion => ({
  key: "docs/report.txt",
  version_id: deleteMarker ? "delete-1" : "v1",
  is_latest: false,
  is_delete_marker: deleteMarker,
  last_modified: "2026-03-01T10:00:00Z",
  size: 12,
});

function createOptions() {
  return {
    accountId: "acc-1",
    bucketName: "bucket-a",
    clearOperationController: vi.fn(),
    completeOperation: vi.fn(),
    createOperationController: vi.fn(() => new AbortController()),
    enabled: true,
    isOperationAborted: vi.fn(() => false),
    onConfirm: vi.fn(),
    onRefreshListing: vi.fn().mockResolvedValue(undefined),
    onRefreshVersions: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn(),
    onWarning: vi.fn(),
    requestOptions: { workspaceSurface: "browser" as const },
    startOperation: vi.fn(() => "op-1"),
    versioningEnabled: true,
  };
}

describe("useBrowserVersionActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.copyObject.mockResolvedValue(undefined);
    apiMocks.deleteObjects.mockResolvedValue(undefined);
  });

  it("restores a concrete object version and refreshes both listings", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserVersionActions(options));
    await act(async () => result.current.restore(version()));

    expect(apiMocks.copyObject).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      expect.objectContaining({ source_version_id: "v1" }),
      expect.any(AbortSignal),
      options.requestOptions,
    );
    expect(options.onRefreshListing).toHaveBeenCalledWith("docs/report.txt");
    expect(options.onRefreshVersions).toHaveBeenCalledWith("docs/report.txt");
    expect(options.completeOperation).toHaveBeenCalledWith("op-1", "done", undefined);
  });

  it("confirms and removes a delete marker with request context", async () => {
    const options = createOptions();
    const target = version(true);
    const { result } = renderHook(() => useBrowserVersionActions(options));
    act(() => result.current.remove(target));

    expect(options.onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: "Delete delete marker",
      message: "Delete delete marker for docs/report.txt?",
    }));
    const confirmation = options.onConfirm.mock.calls[0]?.[0] as { onConfirm: () => Promise<void> };
    await act(async () => confirmation.onConfirm());

    expect(apiMocks.deleteObjects).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      [{ key: "docs/report.txt", version_id: "delete-1" }],
      expect.any(AbortSignal),
      options.requestOptions,
    );
    expect(options.onStatus).toHaveBeenCalledWith("Delete marker removed.");
  });

  it("refreshes version state after a cancelled restore", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    apiMocks.copyObject.mockRejectedValue(abortError);
    const options = createOptions();
    options.isOperationAborted.mockReturnValue(true);
    const { result } = renderHook(() => useBrowserVersionActions(options));
    await act(async () => result.current.restore(version()));

    expect(options.onStatus).toHaveBeenCalledWith("Restore version cancelled.");
    expect(options.onRefreshListing).toHaveBeenCalled();
    expect(options.onRefreshVersions).toHaveBeenCalled();
    expect(options.completeOperation).toHaveBeenCalledWith("op-1", "cancelled", undefined);
  });
});

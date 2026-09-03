import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserVersionCleanup } from "./useBrowserVersionCleanup";

const apiMocks = vi.hoisted(() => ({
  cleanupObjectVersions: vi.fn(),
}));

vi.mock("../../api/browserObjects", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserObjects")>(
      "../../api/browserObjects",
    );
  return {
    ...actual,
    ...apiMocks,
  };
});

function createOptions() {
  return {
    accountId: "acc-1",
    bucketName: "bucket-a",
    clearOperationController: vi.fn(),
    completeOperation: vi.fn(),
    createOperationController: vi.fn(() => new AbortController()),
    currentPath: "bucket-a/docs",
    enabled: true,
    isOperationAborted: vi.fn(() => false),
    normalizedPrefix: "docs/",
    onRefresh: vi.fn(),
    onRefreshNow: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn(),
    prefix: "docs/",
    requestOptions: undefined,
    showOperations: vi.fn(),
    startOperation: vi.fn(() => "op-1"),
    versioningEnabled: true,
  };
}

describe("useBrowserVersionCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.cleanupObjectVersions.mockResolvedValue({
      deleted_versions: 0,
      deleted_delete_markers: 0,
    });
  });

  it("does not open when versioning is unavailable", () => {
    const options = { ...createOptions(), versioningEnabled: false };
    const { result } = renderHook(() => useBrowserVersionCleanup(options));

    act(() => result.current.show());

    expect(result.current.open).toBe(false);
  });

  it("requires at least one cleanup rule", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserVersionCleanup(options));

    await act(async () => {
      await result.current.apply();
    });

    expect(result.current.error).toBe("Select at least one cleanup rule.");
    expect(apiMocks.cleanupObjectVersions).not.toHaveBeenCalled();
    expect(options.startOperation).not.toHaveBeenCalled();
  });

  it("cleans versions with the consolidated rules", async () => {
    apiMocks.cleanupObjectVersions.mockResolvedValue({
      deleted_versions: 7,
      deleted_delete_markers: 2,
    });
    const options = createOptions();
    const { result } = renderHook(() => useBrowserVersionCleanup(options));
    act(() => {
      result.current.setDraft({
        deleteOrphanMarkers: true,
        keepLast: "3",
        olderThanDays: "30",
      });
    });

    await act(async () => {
      await result.current.apply();
    });

    expect(apiMocks.cleanupObjectVersions).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        prefix: "docs/",
        keep_last_n: 3,
        older_than_days: 30,
        delete_orphan_markers: true,
      },
      expect.any(AbortSignal),
      undefined,
    );
    expect(options.showOperations).toHaveBeenCalledOnce();
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "done",
      undefined,
    );
    expect(options.clearOperationController).toHaveBeenCalledWith("op-1");
    expect(options.onRefresh).toHaveBeenCalledWith("docs/");
    expect(result.current.summary).toBe(
      "Removed 7 version(s) and 2 delete marker(s).",
    );
  });

  it("refreshes immediately after cancellation", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    apiMocks.cleanupObjectVersions.mockRejectedValue(abortError);
    const options = createOptions();
    options.isOperationAborted.mockReturnValue(true);
    const { result } = renderHook(() => useBrowserVersionCleanup(options));
    act(() => {
      result.current.setDraft((previous) => ({
        ...previous,
        keepLast: "1",
      }));
    });

    await act(async () => {
      await result.current.apply();
    });

    expect(options.isOperationAborted).toHaveBeenCalledWith(
      abortError,
      expect.any(AbortController),
    );
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "cancelled",
      undefined,
    );
    expect(options.onRefreshNow).toHaveBeenCalledWith("docs/");
    expect(result.current.summary).toBe("Cleanup cancelled.");
  });
});

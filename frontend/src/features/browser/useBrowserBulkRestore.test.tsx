import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserItem } from "./browserTypes";
import { useBrowserBulkRestore } from "./useBrowserBulkRestore";

const apiMocks = vi.hoisted(() => ({
  copyObject: vi.fn(),
  listObjectVersions: vi.fn(),
}));

vi.mock("../../api/browser", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browser")>(
      "../../api/browser",
    );
  return {
    ...actual,
    ...apiMocks,
  };
});

function item(key: string, type: "file" | "folder"): BrowserItem {
  return {
    id: `${type}:${key}`,
    key,
    name: key,
    type,
    size: "",
    modified: "",
    owner: "",
    sizeBytes: null,
    modifiedAt: null,
  };
}

function version(
  versionId: string,
  lastModified: string,
  options: { deleteMarker?: boolean; latest?: boolean } = {},
) {
  return {
    key: "docs/report.txt",
    version_id: versionId,
    is_latest: options.latest ?? false,
    is_delete_marker: options.deleteMarker ?? false,
    last_modified: lastModified,
    size: 12,
  };
}

function createOptions() {
  return {
    accountId: "acc-1",
    bucketName: "bucket-a",
    clearOperationController: vi.fn(),
    completeOperation: vi.fn(),
    createOperationController: vi.fn(() => new AbortController()),
    currentPath: "bucket-a/docs",
    deleteObjectsInBatches: vi.fn().mockResolvedValue(0),
    enabled: true,
    isOperationAborted: vi.fn(
      (_error: unknown, controller?: AbortController | null) =>
        Boolean(controller?.signal.aborted),
    ),
    listAllObjectsForPrefix: vi.fn().mockResolvedValue([]),
    normalizedPrefix: "docs/",
    onRefresh: vi.fn(),
    onRefreshNow: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn(),
    parallelism: 2,
    prefix: "docs/",
    requestOptions: undefined,
    showOperations: vi.fn(),
    startOperation: vi.fn(() => "op-1"),
    updateOperation: vi.fn(),
    versioningEnabled: true,
  };
}

describe("useBrowserBulkRestore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.copyObject.mockResolvedValue(undefined);
    apiMocks.listObjectVersions.mockResolvedValue({
      versions: [],
      delete_markers: [],
      is_truncated: false,
      next_key_marker: null,
      next_version_id_marker: null,
    });
  });

  it("creates a path target when opened without a selection", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBulkRestore(options));

    act(() => result.current.show([]));

    expect(result.current.open).toBe(true);
    expect(result.current.fileCount).toBe(0);
    expect(result.current.folderCount).toBe(1);
    expect(result.current.targetPath).toBe("bucket-a/docs");
    expect(result.current.draft.deleteMissing).toBe(false);
    expect(result.current.draft.restoreDeleted).toBe(false);
  });

  it("validates the date before listing versions", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBulkRestore(options));
    act(() => {
      result.current.show([item("docs/report.txt", "file")]);
      result.current.setDraft((previous) => ({ ...previous, date: "" }));
    });

    await act(async () => {
      await result.current.apply();
    });

    expect(result.current.error).toBe("Select a valid date.");
    expect(apiMocks.listObjectVersions).not.toHaveBeenCalled();
    expect(options.startOperation).not.toHaveBeenCalled();
  });

  it("previews the version selected at the target date", async () => {
    apiMocks.listObjectVersions.mockResolvedValue({
      versions: [
        version("v2", "2026-03-10T10:00:00Z", { latest: true }),
        version("v1", "2026-03-01T10:00:00Z"),
      ],
      delete_markers: [],
      is_truncated: false,
      next_key_marker: null,
      next_version_id_marker: null,
    });
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBulkRestore(options));
    act(() => {
      result.current.show([item("docs/report.txt", "file")]);
      result.current.setDraft((previous) => ({
        ...previous,
        date: "2026-03-05T12:00",
        dryRun: true,
      }));
    });

    await act(async () => {
      await result.current.apply();
    });

    expect(result.current.preview).toEqual({
      restoreKeys: ["docs/report.txt"],
      deleteKeys: [],
      unchangedKeys: [],
      totalRestore: 1,
      totalDelete: 0,
      totalUnchanged: 0,
    });
    expect(result.current.summary).toBe(
      "Dry run: would restore 1 object(s), delete 0 object(s), unchanged 0 object(s).",
    );
    expect(apiMocks.copyObject).not.toHaveBeenCalled();
    expect(options.startOperation).not.toHaveBeenCalled();
  });

  it("restores the latest version hidden by a delete marker", async () => {
    apiMocks.listObjectVersions.mockResolvedValue({
      versions: [version("v1", "2026-03-01T10:00:00Z")],
      delete_markers: [
        version("delete-1", "2026-03-10T10:00:00Z", {
          deleteMarker: true,
          latest: true,
        }),
      ],
      is_truncated: false,
      next_key_marker: null,
      next_version_id_marker: null,
    });
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBulkRestore(options));
    act(() => {
      result.current.show([item("docs/report.txt", "file")]);
      result.current.setDraft((previous) => ({
        ...previous,
        date: "",
        restoreDeleted: true,
      }));
    });

    await act(async () => {
      await result.current.apply();
    });

    expect(apiMocks.copyObject).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        source_key: "docs/report.txt",
        source_version_id: "v1",
        destination_key: "docs/report.txt",
        replace_metadata: false,
        move: false,
      },
      expect.any(AbortSignal),
      undefined,
    );
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "done",
      undefined,
    );
    expect(options.onRefresh).toHaveBeenCalledWith("docs/");
    expect(result.current.summary).toBe(
      "Restored 1 object(s), deleted 0 object(s), unchanged 0 object(s).",
    );
  });
});

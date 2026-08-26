import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserItem } from "./browserTypes";
import { useBrowserBulkAttributes } from "./useBrowserBulkAttributes";

const apiMocks = vi.hoisted(() => ({
  updateObjectAcl: vi.fn(),
  updateObjectLegalHold: vi.fn(),
  updateObjectMetadata: vi.fn(),
  updateObjectRetention: vi.fn(),
  updateObjectTags: vi.fn(),
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

function item(
  key: string,
  type: "file" | "folder",
  isDeleted = false,
): BrowserItem {
  return {
    id: `${type}:${key}`,
    key,
    name: key,
    type,
    isDeleted,
    size: "",
    modified: "",
    owner: "",
    sizeBytes: null,
    modifiedAt: null,
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
    enabled: true,
    listAllObjectsForPrefix: vi.fn().mockResolvedValue([]),
    onRefresh: vi.fn(),
    onRefreshNow: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn(),
    onWarning: vi.fn(),
    parallelism: 2,
    prefix: "docs/",
    showOperations: vi.fn(),
    startOperation: vi.fn(() => "op-1"),
    updateOperation: vi.fn(),
  };
}

describe("useBrowserBulkAttributes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(apiMocks).forEach((mock) =>
      mock.mockResolvedValue(undefined),
    );
  });

  it("keeps eligible targets and reports skipped deleted objects", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBulkAttributes(options));

    act(() => {
      result.current.show([
        item("docs/live.txt", "file"),
        item("docs/old.txt", "file", true),
        item("docs/folder/", "folder"),
      ]);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.fileCount).toBe(1);
    expect(result.current.folderCount).toBe(1);
    expect(options.onWarning).toHaveBeenCalledWith(
      "Deleted objects were skipped for bulk attributes.",
    );
  });

  it("validates the consolidated draft before resolving targets", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserBulkAttributes(options));
    act(() => result.current.show([item("docs/live.txt", "file")]));

    await act(async () => {
      await result.current.apply();
    });

    expect(result.current.error).toBe(
      "Select at least one attribute to update.",
    );
    expect(options.startOperation).not.toHaveBeenCalled();
  });

  it("expands folders once and applies the selected attributes", async () => {
    const options = createOptions();
    options.listAllObjectsForPrefix.mockResolvedValue([
      { key: "docs/nested.txt", size: 12 },
      { key: "docs/root.txt", size: 8 },
    ]);
    const { result } = renderHook(() => useBrowserBulkAttributes(options));
    act(() => {
      result.current.show([
        item("docs/root.txt", "file"),
        item("docs/", "folder"),
      ]);
      result.current.setDraft((previous) => ({
        ...previous,
        applyMetadata: true,
        applyTags: true,
        metadata: { ...previous.metadata, contentType: "text/plain" },
        metadataEntries: "owner=team-a",
        tags: "env=prod",
      }));
    });

    await act(async () => {
      await result.current.apply();
    });

    expect(options.listAllObjectsForPrefix).toHaveBeenCalledWith("docs/");
    expect(apiMocks.updateObjectMetadata).toHaveBeenCalledTimes(2);
    expect(apiMocks.updateObjectTags).toHaveBeenCalledTimes(2);
    expect(apiMocks.updateObjectMetadata).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      expect.objectContaining({
        key: "docs/nested.txt",
        content_type: "text/plain",
        metadata: { owner: "team-a" },
      }),
      expect.any(AbortSignal),
      undefined,
    );
    expect(options.showOperations).toHaveBeenCalledOnce();
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "done",
      undefined,
    );
    expect(options.onStatus).toHaveBeenCalledWith("Updated 2 of 2 object(s).");
    expect(options.onRefresh).toHaveBeenCalledWith("docs/");
    expect(options.clearOperationController).toHaveBeenCalledWith("op-1");
    expect(result.current.summary).toBe("Updated 2 of 2 object(s).");
  });
});

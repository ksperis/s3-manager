import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserItem } from "./browserTypes";
import { useBrowserDeleteItems } from "./useBrowserDeleteItems";

const apiMocks = vi.hoisted(() => ({
  deleteObjects: vi.fn(),
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

function item(
  key: string,
  type: "file" | "folder",
  deleted = false,
): BrowserItem {
  return {
    id: `${type}:${key}`,
    key,
    name: key.replace(/\/$/, "").split("/").at(-1) ?? key,
    type,
    isDeleted: deleted,
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
    cancelDeleteDetails: vi.fn(),
    clearOperationController: vi.fn(),
    completeOperation: vi.fn(),
    createOperationController: vi.fn(() => new AbortController()),
    currentPath: "bucket-a/docs",
    enabled: true,
    isOperationAborted: vi.fn(() => false),
    listAllObjectsForPrefix: vi.fn().mockResolvedValue([]),
    onConfirm: vi.fn(),
    onProcessed: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onRefreshNow: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn(),
    onWarning: vi.fn(),
    parallelism: 2,
    prefix: "docs/",
    requestOptions: undefined,
    setDeleteDetails: vi.fn(),
    showOperations: vi.fn(),
    startOperation: vi.fn(() => "op-1"),
    updateOperation: vi.fn(),
  };
}

async function confirmDeletion(options: ReturnType<typeof createOptions>) {
  const confirmation = options.onConfirm.mock.calls[0]?.[0] as
    | { onConfirm: () => Promise<void> | void }
    | undefined;
  expect(confirmation).toBeDefined();
  await confirmation?.onConfirm();
}

describe("useBrowserDeleteItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.deleteObjects.mockResolvedValue(undefined);
  });

  it("describes recursive folder deletion and warns about deleted targets", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserDeleteItems(options));

    act(() => {
      result.current.remove([
        item("docs/live.txt", "file"),
        item("docs/archive/", "folder"),
        item("docs/deleted.txt", "file", true),
      ]);
    });

    expect(options.onWarning).toHaveBeenCalledWith(
      "Deleted items are shown from delete markers. Use versions to restore or remove markers.",
    );
    expect(options.onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delete objects",
        message:
          "Delete 1 object(s) and 1 folder(s)? This removes all objects within the selected folders.",
        confirmLabel: "Delete",
        tone: "danger",
      }),
    );
    expect(apiMocks.deleteObjects).not.toHaveBeenCalled();
  });

  it("deletes multiple files with operation details", async () => {
    const options = createOptions();
    const targets = [
      item("docs/a.txt", "file"),
      item("docs/b.txt", "file"),
    ];
    const { result } = renderHook(() => useBrowserDeleteItems(options));
    act(() => result.current.remove(targets));

    await act(async () => {
      await confirmDeletion(options);
    });

    expect(apiMocks.deleteObjects).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      [{ key: "docs/a.txt" }, { key: "docs/b.txt" }],
      expect.any(AbortSignal),
      undefined,
    );
    expect(options.showOperations).toHaveBeenCalledOnce();
    expect(options.setDeleteDetails).toHaveBeenCalled();
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "done",
      undefined,
    );
    expect(options.onProcessed).toHaveBeenCalledWith(targets);
    expect(options.onRefresh).toHaveBeenCalledWith("docs/");
  });

  it("expands folders and deletes their prefix marker", async () => {
    const options = createOptions();
    options.listAllObjectsForPrefix.mockResolvedValue([
      { key: "docs/archive/a.txt", size: 12 },
      { key: "docs/archive/nested/b.txt", size: 8 },
    ]);
    const folder = item("docs/archive/", "folder");
    const { result } = renderHook(() => useBrowserDeleteItems(options));
    act(() => result.current.remove([folder]));

    await act(async () => {
      await confirmDeletion(options);
    });

    expect(options.listAllObjectsForPrefix).toHaveBeenCalledWith(
      "docs/archive/",
      undefined,
      undefined,
      expect.any(AbortSignal),
    );
    expect(apiMocks.deleteObjects).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      [
        { key: "docs/archive/a.txt" },
        { key: "docs/archive/nested/b.txt" },
        { key: "docs/archive/" },
      ],
      expect.any(AbortSignal),
      undefined,
    );
    expect(options.onStatus).toHaveBeenCalledWith("Deleted folder archive");
    expect(options.onProcessed).toHaveBeenCalledWith([folder]);
  });

  it("keeps the selection when a batch is cancelled", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    apiMocks.deleteObjects.mockRejectedValue(abortError);
    const options = createOptions();
    options.isOperationAborted.mockReturnValue(true);
    const targets = [
      item("docs/a.txt", "file"),
      item("docs/b.txt", "file"),
    ];
    const { result } = renderHook(() => useBrowserDeleteItems(options));
    act(() => result.current.remove(targets));

    await act(async () => {
      await confirmDeletion(options);
    });

    expect(options.cancelDeleteDetails).toHaveBeenCalledWith("op-1");
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "cancelled",
      undefined,
    );
    expect(options.onStatus).toHaveBeenCalledWith(
      "Delete cancelled after 0 of 2 item(s).",
    );
    expect(options.onRefreshNow).toHaveBeenCalledWith("docs/");
    expect(options.onProcessed).not.toHaveBeenCalled();
  });
});

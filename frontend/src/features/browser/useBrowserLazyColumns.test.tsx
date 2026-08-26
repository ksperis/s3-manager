import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserItem } from "./browserTypes";
import { useBrowserLazyColumns } from "./useBrowserLazyColumns";

const apiMocks = vi.hoisted(() => ({ fetchBrowserObjectColumns: vi.fn() }));

vi.mock("../../api/browser", async () => ({
  ...(await vi.importActual<typeof import("../../api/browser")>(
    "../../api/browser",
  )),
  ...apiMocks,
}));

const mountedViewports: HTMLDivElement[] = [];

const item = (
  id: string,
  key: string,
  overrides: Partial<BrowserItem> = {},
): BrowserItem => ({
  id,
  key,
  name: key.split("/").at(-1) ?? key,
  type: "file",
  size: "12 B",
  modified: "2026-03-01 10:00",
  owner: "owner",
  ...overrides,
});

function createViewport(...itemIds: string[]) {
  const viewport = document.createElement("div");
  itemIds.forEach((itemId) => {
    const row = document.createElement("div");
    row.dataset.lazyItemId = itemId;
    viewport.append(row);
  });
  document.body.append(viewport);
  mountedViewports.push(viewport);
  return { current: viewport };
}

function createOptions(items: BrowserItem[]) {
  return {
    accountId: "acc-1",
    bucketName: "bucket-a",
    enabled: true,
    items,
    metadataColumnsVisible: true,
    prefix: "docs/",
    requestOptions: { workspaceSurface: "browser" as const },
    sseCustomerKeyBase64: "customer-key",
    tagsColumnVisible: true,
    viewportRef: createViewport(...items.map((entry) => entry.id)),
  };
}

describe("useBrowserLazyColumns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mountedViewports.splice(0).forEach((viewport) => viewport.remove());
  });

  it("loads visible metadata and tag columns into the cache", async () => {
    apiMocks.fetchBrowserObjectColumns.mockResolvedValue({
      items: [
        {
          key: "docs/report.txt",
          content_type: "text/plain",
          metadata_count: 2,
          cache_control: "no-store",
          expires: null,
          restore_status: null,
          tags_count: 3,
          metadata_status: "ready",
          tags_status: "ready",
        },
      ],
    });
    const target = item("file-1", "docs/report.txt");
    const options = createOptions([target]);
    const { result } = renderHook(() => useBrowserLazyColumns(options));

    await waitFor(() => {
      expect(result.current["file-1"]?.metadataStatus).toBe("ready");
      expect(result.current["file-1"]?.tagsStatus).toBe("ready");
    });

    expect(apiMocks.fetchBrowserObjectColumns).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        keys: ["docs/report.txt"],
        columns: [
          "content_type",
          "metadata_count",
          "cache_control",
          "expires",
          "restore_status",
          "tags_count",
        ],
      },
      {
        sseCustomerKeyBase64: "customer-key",
        workspaceSurface: "browser",
      },
    );
    expect(result.current["file-1"]).toEqual(
      expect.objectContaining({
        contentType: "text/plain",
        metadataCount: 2,
        tagsCount: 3,
      }),
    );
  });

  it("does not load folders or deleted files", async () => {
    const options = createOptions([
      item("folder-1", "docs/folder/", { type: "folder" }),
      item("deleted-1", "docs/deleted.txt", { isDeleted: true }),
    ]);
    const { result } = renderHook(() => useBrowserLazyColumns(options));

    await act(async () => Promise.resolve());

    expect(apiMocks.fetchBrowserObjectColumns).not.toHaveBeenCalled();
    expect(result.current).toEqual({});
  });

  it("ignores an old request after the Browser context changes", async () => {
    let resolveOld!: (value: unknown) => void;
    const oldRequest = new Promise((resolve) => {
      resolveOld = resolve;
    });
    apiMocks.fetchBrowserObjectColumns.mockImplementation(
      (_accountId: unknown, bucketName: string) =>
        bucketName === "bucket-a"
          ? oldRequest
          : Promise.resolve({
              items: [
                {
                  key: "new/report.txt",
                  content_type: "application/json",
                  metadata_count: 1,
                  tags_count: 0,
                  metadata_status: "ready",
                  tags_status: "ready",
                },
              ],
            }),
    );
    const viewportRef = createViewport("file-1");
    const baseOptions = {
      ...createOptions([]),
      viewportRef,
    };
    const { result, rerender } = renderHook(
      ({ bucketName, items, prefix }) =>
        useBrowserLazyColumns({
          ...baseOptions,
          bucketName,
          items,
          prefix,
        }),
      {
        initialProps: {
          bucketName: "bucket-a",
          items: [item("file-1", "old/report.txt")],
          prefix: "old/",
        },
      },
    );
    await waitFor(() => {
      expect(apiMocks.fetchBrowserObjectColumns).toHaveBeenCalledTimes(1);
    });

    rerender({
      bucketName: "bucket-b",
      items: [item("file-1", "new/report.txt")],
      prefix: "new/",
    });
    await waitFor(() => {
      expect(result.current["file-1"]?.contentType).toBe("application/json");
    });

    await act(async () => {
      resolveOld({
        items: [
          {
            key: "old/report.txt",
            content_type: "text/plain",
            metadata_count: 9,
            tags_count: 9,
            metadata_status: "ready",
            tags_status: "ready",
          },
        ],
      });
      await oldRequest;
    });
    expect(result.current["file-1"]?.contentType).toBe("application/json");
    expect(result.current["file-1"]?.metadataCount).toBe(1);
  });
});

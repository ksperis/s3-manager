import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserObject } from "../../api/browser";
import { useBrowserContextCounts } from "./useBrowserContextCounts";

const apiMocks = vi.hoisted(() => ({ listObjectVersions: vi.fn() }));

vi.mock("../../api/browser", async () => ({
  ...(await vi.importActual<typeof import("../../api/browser")>(
    "../../api/browser",
  )),
  ...apiMocks,
}));

const object = (key: string): BrowserObject => ({ key, size: 1 });

function createOptions() {
  return {
    accountId: "acc-1",
    bucketName: "bucket-a",
    enabled: true,
    listAllObjectsForPrefix: vi.fn().mockResolvedValue([
      object("docs/a.txt"),
      object("docs/b.txt"),
    ]),
    prefix: "docs/",
    requestOptions: { workspaceSurface: "browser" as const },
    versioningEnabled: false,
  };
}

describe("useBrowserContextCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts current objects without scanning versions when versioning is off", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserContextCounts(options));

    await act(async () => result.current.count());

    expect(options.listAllObjectsForPrefix).toHaveBeenCalledWith("docs/");
    expect(apiMocks.listObjectVersions).not.toHaveBeenCalled();
    expect(result.current.counts).toEqual({
      objects: 2,
      versions: 0,
      deleteMarkers: 0,
    });
    expect(result.current.loading).toBe(false);
  });

  it("paginates versions and excludes latest delete markers from objects", async () => {
    apiMocks.listObjectVersions
      .mockResolvedValueOnce({
        versions: [
          {
            key: "docs/a.txt",
            version_id: "a-current",
            is_latest: true,
            is_delete_marker: false,
          },
          {
            key: "docs/a.txt",
            version_id: "a-old",
            is_latest: false,
            is_delete_marker: false,
          },
          {
            key: "docs/b.txt",
            version_id: "b-old",
            is_latest: false,
            is_delete_marker: false,
          },
        ],
        delete_markers: [
          {
            key: "docs/b.txt",
            version_id: "b-deleted",
            is_latest: true,
            is_delete_marker: true,
          },
        ],
        is_truncated: true,
        next_key_marker: "docs/b.txt",
        next_version_id_marker: "b-deleted",
      })
      .mockResolvedValueOnce({
        versions: [
          {
            key: "docs/c.txt",
            version_id: "c-current",
            is_latest: true,
            is_delete_marker: false,
          },
        ],
        delete_markers: [
          {
            key: "docs/d.txt",
            version_id: "d-deleted",
            is_latest: true,
            is_delete_marker: true,
          },
        ],
        is_truncated: false,
      });
    const options = { ...createOptions(), versioningEnabled: true };
    const { result } = renderHook(() => useBrowserContextCounts(options));

    await act(async () => result.current.count());

    expect(apiMocks.listObjectVersions).toHaveBeenNthCalledWith(
      2,
      "acc-1",
      "bucket-a",
      expect.objectContaining({
        prefix: "docs/",
        keyMarker: "docs/b.txt",
        versionIdMarker: "b-deleted",
        requestOptions: options.requestOptions,
      }),
    );
    expect(result.current.counts).toEqual({
      objects: 2,
      versions: 4,
      deleteMarkers: 2,
    });
  });

  it("ignores a count resolved after the prefix changes", async () => {
    let resolveOld!: (objects: BrowserObject[]) => void;
    const oldObjects = new Promise<BrowserObject[]>((resolve) => {
      resolveOld = resolve;
    });
    const options = createOptions();
    options.listAllObjectsForPrefix.mockImplementation((prefix: string) =>
      prefix === "old/"
        ? oldObjects
        : Promise.resolve([object("new/current.txt")]),
    );
    const { result, rerender } = renderHook(
      ({ prefix }) => useBrowserContextCounts({ ...options, prefix }),
      { initialProps: { prefix: "old/" } },
    );

    let oldCount!: Promise<void>;
    act(() => {
      oldCount = result.current.count();
    });
    rerender({ prefix: "new/" });
    await act(async () => result.current.count());
    expect(result.current.counts?.objects).toBe(1);

    await act(async () => {
      resolveOld([object("old/a.txt"), object("old/b.txt")]);
      await oldCount;
    });
    expect(result.current.counts?.objects).toBe(1);
  });
});

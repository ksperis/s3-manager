import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMetadata, ObjectTags } from "../../api/browser";
import type { BrowserItem } from "./browserTypes";
import { useBrowserObjectProperties } from "./useBrowserObjectProperties";

const apiMocks = vi.hoisted(() => ({
  fetchObjectMetadata: vi.fn(),
  getObjectTags: vi.fn(),
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
    getObjectTags: (...args: unknown[]) => apiMocks.getObjectTags(...args),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function browserItem(key: string, storageClass = "STANDARD"): BrowserItem {
  return {
    id: key,
    key,
    name: key.split("/").at(-1) ?? key,
    type: "file",
    size: "12 B",
    modified: "2026-08-26 10:00",
    owner: "owner",
    storageClass,
  };
}

function metadata(key: string, versionId: string): ObjectMetadata {
  return {
    key,
    size: 12,
    content_type: "text/plain",
    cache_control: "max-age=60",
    storage_class: "STANDARD_IA",
    metadata: { project: "reef" },
    version_id: versionId,
  };
}

function tags(key: string, versionId: string): ObjectTags {
  return {
    key,
    tags: [{ key: "environment", value: "test" }],
    version_id: versionId,
  };
}

describe("useBrowserObjectProperties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.fetchObjectMetadata.mockResolvedValue({
      ...metadata("docs/report.txt", "v2"),
      version_id: null,
    });
    apiMocks.getObjectTags.mockResolvedValue(tags("docs/report.txt", "v2"));
  });

  it("loads object properties and builds editable drafts", async () => {
    const item = browserItem("docs/report.txt");
    const { result } = renderHook(() =>
      useBrowserObjectProperties({
        accountId: "acc-1",
        bucketName: "bucket-a",
        isDeleted: false,
        item,
        sseCustomerKeyBase64: "customer-key",
      }),
    );

    await act(async () => {
      await result.current.load();
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      "docs/report.txt",
      null,
      "customer-key",
      undefined,
      undefined,
    );
    expect(result.current.loaded).toBe(true);
    expect(result.current.versionId).toBe("v2");
    expect(result.current.metadataDraft.contentType).toBe("text/plain");
    expect(result.current.metadataItems).toEqual([
      { id: "meta-1", key: "project", value: "reef" },
    ]);
    expect(result.current.tagsDraft).toEqual([
      { id: "tag-1", key: "environment", value: "test" },
    ]);
    expect(result.current.storageClass).toBe("STANDARD_IA");

    await act(async () => {
      await result.current.load();
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledTimes(1);
  });

  it("allows a forced reload after properties were loaded", async () => {
    const item = browserItem("docs/report.txt");
    const { result } = renderHook(() =>
      useBrowserObjectProperties({
        accountId: "acc-1",
        bucketName: "bucket-a",
        isDeleted: false,
        item,
      }),
    );
    await act(async () => {
      await result.current.load();
    });
    apiMocks.fetchObjectMetadata.mockResolvedValueOnce({
      ...metadata("docs/report.txt", "v3"),
      content_type: "application/json",
    });
    apiMocks.getObjectTags.mockResolvedValueOnce(tags("docs/report.txt", "v3"));

    await act(async () => {
      await result.current.load(true);
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledTimes(2);
    expect(result.current.versionId).toBe("v3");
    expect(result.current.metadataDraft.contentType).toBe("application/json");
  });

  it("ignores property responses from a previously selected object", async () => {
    const oldMetadata = deferred<ObjectMetadata>();
    const oldTags = deferred<ObjectTags>();
    apiMocks.fetchObjectMetadata
      .mockReturnValueOnce(oldMetadata.promise)
      .mockResolvedValueOnce(metadata("docs/current.txt", "current-v1"));
    apiMocks.getObjectTags
      .mockReturnValueOnce(oldTags.promise)
      .mockResolvedValueOnce(tags("docs/current.txt", "current-v1"));

    const { result, rerender } = renderHook(
      ({ item }) =>
        useBrowserObjectProperties({
          accountId: "acc-1",
          bucketName: "bucket-a",
          isDeleted: false,
          item,
        }),
      { initialProps: { item: browserItem("docs/old.txt") } },
    );
    act(() => {
      void result.current.load();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    const previousLoad = result.current.load;

    const currentItem = browserItem("docs/current.txt", "GLACIER");
    rerender({ item: currentItem });
    act(() => result.current.reset(currentItem));
    await act(async () => {
      await result.current.load();
      await previousLoad(true);
    });
    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledTimes(2);

    await act(async () => {
      oldMetadata.resolve(metadata("docs/old.txt", "old-v1"));
      oldTags.resolve(tags("docs/old.txt", "old-v1"));
      await Promise.all([oldMetadata.promise, oldTags.promise]);
    });
    expect(result.current.metadata?.key).toBe("docs/current.txt");
    expect(result.current.versionId).toBe("current-v1");
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchCephAdminBucketUiTagOrphans,
  fetchCephAdminBucketUiTags,
  fetchStorageOpsBucketUiTagOrphans,
  fetchStorageOpsBucketUiTags,
  patchCephAdminBucketUiTags,
  patchStorageOpsBucketUiTags,
  type BucketUiTagCatalog,
  type BucketUiTagOrphans,
} from "../../api/bucketUiTags";
import {
  buildPhysicalBucketUiTagIdentity,
  createBucketUiTagTarget,
  useBucketUiTags,
} from "./bucketUiTags";

vi.mock("../../api/bucketUiTags", () => ({
  fetchCephAdminBucketUiTagOrphans: vi.fn(),
  fetchCephAdminBucketUiTags: vi.fn(),
  fetchStorageOpsBucketUiTagOrphans: vi.fn(),
  fetchStorageOpsBucketUiTags: vi.fn(),
  patchCephAdminBucketUiTags: vi.fn(),
  patchStorageOpsBucketUiTags: vi.fn(),
}));

const emptyCatalog = (): BucketUiTagCatalog => ({ definitions: [] });
const emptyOrphans = (): BucketUiTagOrphans => ({ orphans: [] });
const duplicateLabelCatalog: BucketUiTagCatalog = {
  definitions: [
    { id: 11, label: "Production", color_key: "blue", scope: "standard", visibility: "private" },
    { id: 12, label: "Production", color_key: "amber", scope: "standard", visibility: "shared" },
  ],
};

describe("useBucketUiTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCephAdminBucketUiTagOrphans).mockResolvedValue(emptyOrphans());
    vi.mocked(fetchCephAdminBucketUiTags).mockResolvedValue(emptyCatalog());
    vi.mocked(fetchStorageOpsBucketUiTagOrphans).mockResolvedValue(emptyOrphans());
    vi.mocked(fetchStorageOpsBucketUiTags).mockResolvedValue(emptyCatalog());
    vi.mocked(patchCephAdminBucketUiTags).mockResolvedValue(emptyCatalog());
    vi.mocked(patchStorageOpsBucketUiTags).mockResolvedValue(emptyCatalog());
  });

  it("loads duplicate labels as distinct backend definitions", async () => {
    vi.mocked(fetchCephAdminBucketUiTags).mockResolvedValue(duplicateLabelCatalog);

    const { result } = renderHook(() => useBucketUiTags("ceph-admin", 7));

    await waitFor(() => expect(result.current.definitions).toHaveLength(2));
    expect(result.current.orphanEntries).toEqual({});
    expect(result.current.definitions.map((tag) => [tag.label, tag.visibility])).toEqual([
      ["Production", "private"],
      ["Production", "shared"],
    ]);
  });

  it("does not expose a previous Ceph Admin endpoint catalog while the next scope loads", async () => {
    vi.mocked(fetchCephAdminBucketUiTags).mockImplementation((endpointId) => {
      if (endpointId === 7) return Promise.resolve(duplicateLabelCatalog);
      return new Promise<BucketUiTagCatalog>(() => undefined);
    });
    const { result, rerender, unmount } = renderHook(
      ({ endpointId }) => useBucketUiTags("ceph-admin", endpointId),
      { initialProps: { endpointId: 7 } }
    );
    await waitFor(() => expect(result.current.definitions).toHaveLength(2));

    rerender({ endpointId: 8 });

    expect(result.current.definitions).toEqual([]);
    expect(result.current.orphanEntries).toEqual({});
    expect(result.current.ready).toBe(false);
    unmount();
  });

  it("keeps definitions ready when orphan inventory validation fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(fetchCephAdminBucketUiTags).mockResolvedValue(duplicateLabelCatalog);
    vi.mocked(fetchCephAdminBucketUiTagOrphans).mockRejectedValue(
      new Error("inventory unavailable")
    );

    const { result } = renderHook(() => useBucketUiTags("ceph-admin", 7));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.definitions).toHaveLength(2);
    expect(result.current.orphanEntries).toEqual({});
    expect(result.current.error).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "Unable to validate UI tags against bucket inventory.",
      expect.any(Error)
    );
    warn.mockRestore();
  });

  it("splits mutations above 200 targets and keeps Storage Ops tags private", async () => {
    const { result } = renderHook(() => useBucketUiTags("storage-ops", null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const targets = Array.from({ length: 201 }, (_, index) =>
      createBucketUiTagTarget(
        "storage-ops",
        9,
        buildPhysicalBucketUiTagIdentity(9, null, `bucket-${index}`),
        `bucket-${index}`,
        null,
        `context-${index}`
      )!
    );

    await act(async () => {
      await result.current.applyTags(
        targets,
        [{ label: "Ops", color_key: "teal", visibility: "shared" }],
        []
      );
    });

    expect(patchStorageOpsBucketUiTags).toHaveBeenCalledTimes(2);
    expect(vi.mocked(patchStorageOpsBucketUiTags).mock.calls[0][0].targets).toHaveLength(200);
    expect(vi.mocked(patchStorageOpsBucketUiTags).mock.calls[1][0].targets).toHaveLength(1);
    expect(vi.mocked(patchStorageOpsBucketUiTags).mock.calls[0][0].create_tags).toEqual([
      { label: "Ops", color_key: "teal" },
    ]);
    expect(fetchStorageOpsBucketUiTagOrphans).toHaveBeenCalledTimes(2);
  });

  it("keeps the successful catalog when a later mutation batch fails", async () => {
    const partialCatalog: BucketUiTagCatalog = {
      definitions: [
        { id: 31, label: "Partial", color_key: "blue", scope: "standard", visibility: "private" },
      ],
    };
    vi.mocked(patchCephAdminBucketUiTags)
      .mockResolvedValueOnce(partialCatalog)
      .mockRejectedValueOnce(new Error("second batch failed"));
    const onMutated = vi.fn();
    const { result } = renderHook(() => useBucketUiTags("ceph-admin", 7, onMutated));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const targets = Array.from({ length: 201 }, (_, index) =>
      createBucketUiTagTarget("ceph-admin", 7, `bucket-${index}`, `bucket-${index}`)!
    );

    await act(async () => {
      await expect(
        result.current.applyTags(targets, [{ label: "Partial", color_key: "blue" }], [])
      ).rejects.toThrow("second batch failed");
    });

    expect(result.current.definitions.map((tag) => tag.id)).toEqual([31]);
    expect(onMutated).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("second batch failed");
    expect(fetchCephAdminBucketUiTagOrphans).toHaveBeenCalledTimes(2);
  });

  it("revalidates an orphan through the physical target before removing all tags", async () => {
    const catalog: BucketUiTagCatalog = {
      definitions: [
        { id: 21, label: "Orphan", color_key: "rose", scope: "standard", visibility: "private" },
      ],
    };
    vi.mocked(fetchStorageOpsBucketUiTags).mockResolvedValue(catalog);
    vi.mocked(fetchStorageOpsBucketUiTagOrphans).mockResolvedValue({
      orphans: [
        {
          target: { endpoint_id: 9, tenant: "tenant-a", name: "missing" },
          tags: catalog.definitions,
        },
      ],
    });
    vi.mocked(patchStorageOpsBucketUiTags).mockResolvedValue(emptyCatalog());
    const { result } = renderHook(() => useBucketUiTags("storage-ops", null));
    await waitFor(() => expect(Object.keys(result.current.orphanEntries)).toHaveLength(1));
    const targetKey = Object.keys(result.current.orphanEntries)[0];

    await act(async () => {
      await result.current.removeTargets([targetKey]);
    });

    expect(patchStorageOpsBucketUiTags).toHaveBeenCalledWith({
      targets: [{ endpoint_id: 9, tenant: "tenant-a", name: "missing" }],
      add_tag_ids: [],
      create_tags: [],
      remove_tag_ids: [],
      remove_all: true,
      require_absent: true,
    });
  });
});

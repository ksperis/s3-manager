import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchCephAdminBucketUiTags,
  fetchStorageOpsBucketUiTags,
  patchCephAdminBucketUiTags,
  patchCephAdminBucketUiTagDefinition,
  patchStorageOpsBucketUiTags,
  patchStorageOpsBucketUiTagDefinition,
  type BucketUiTagCatalog,
} from "../../api/bucketUiTags";
import {
  buildPhysicalBucketUiTagIdentity,
  createBucketUiTagTarget,
  useBucketUiTags,
} from "./bucketUiTags";

vi.mock("../../api/bucketUiTags", () => ({
  fetchCephAdminBucketUiTags: vi.fn(),
  fetchStorageOpsBucketUiTags: vi.fn(),
  patchCephAdminBucketUiTags: vi.fn(),
  patchCephAdminBucketUiTagDefinition: vi.fn(),
  patchStorageOpsBucketUiTags: vi.fn(),
  patchStorageOpsBucketUiTagDefinition: vi.fn(),
}));

const emptyCatalog = (): BucketUiTagCatalog => ({ definitions: [] });
const cephCatalog: BucketUiTagCatalog = {
  definitions: [
    { id: 11, label: "Production", color_key: "blue", scope: "standard", visibility: "private" },
    { id: 12, label: "Critical", color_key: "amber", scope: "standard", visibility: "shared" },
  ],
};

describe("useBucketUiTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCephAdminBucketUiTags).mockResolvedValue(emptyCatalog());
    vi.mocked(fetchStorageOpsBucketUiTags).mockResolvedValue(emptyCatalog());
    vi.mocked(patchCephAdminBucketUiTags).mockResolvedValue(emptyCatalog());
    vi.mocked(patchCephAdminBucketUiTagDefinition).mockImplementation(
      async (_endpointId, tagId, changes) => ({
        id: tagId,
        label: "Production",
        color_key: changes.color_key ?? "blue",
        scope: "standard",
        visibility: changes.visibility ?? "private",
      })
    );
    vi.mocked(patchStorageOpsBucketUiTags).mockResolvedValue(emptyCatalog());
    vi.mocked(patchStorageOpsBucketUiTagDefinition).mockImplementation(
      async (tagId, changes) => ({
        id: tagId,
        label: "Mine",
        color_key: changes.color_key ?? "teal",
        scope: "standard",
        visibility: "private",
      })
    );
  });

  it("loads definitions by identifier with their private or shared visibility", async () => {
    vi.mocked(fetchCephAdminBucketUiTags).mockResolvedValue(cephCatalog);

    const { result } = renderHook(() => useBucketUiTags("ceph-admin", 7));

    await waitFor(() => expect(result.current.definitions).toHaveLength(2));
    expect(result.current.definitions.map((tag) => [tag.label, tag.visibility])).toEqual([
      ["Critical", "shared"],
      ["Production", "private"],
    ]);
  });

  it("does not expose a previous Ceph Admin endpoint catalog while the next scope loads", async () => {
    vi.mocked(fetchCephAdminBucketUiTags).mockImplementation((endpointId) => {
      if (endpointId === 7) return Promise.resolve(cephCatalog);
      return new Promise<BucketUiTagCatalog>(() => undefined);
    });
    const { result, rerender, unmount } = renderHook(
      ({ endpointId }) => useBucketUiTags("ceph-admin", endpointId),
      { initialProps: { endpointId: 7 } }
    );
    await waitFor(() => expect(result.current.definitions).toHaveLength(2));

    rerender({ endpointId: 8 });

    expect(result.current.definitions).toEqual([]);
    expect(result.current.ready).toBe(false);
    unmount();
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
  });

  it("updates a persisted definition immediately without changing assignments", async () => {
    vi.mocked(fetchCephAdminBucketUiTags).mockResolvedValue(cephCatalog);
    const onMutated = vi.fn();
    const { result } = renderHook(() =>
      useBucketUiTags("ceph-admin", 7, onMutated)
    );
    await waitFor(() => expect(result.current.definitions).toHaveLength(2));

    await act(async () => {
      await result.current.updateDefinition(11, {
        color_key: "rose",
        visibility: "shared",
      });
    });

    expect(patchCephAdminBucketUiTagDefinition).toHaveBeenCalledWith(7, 11, {
      color_key: "rose",
      visibility: "shared",
    });
    expect(result.current.definitions.find((tag) => tag.id === 11)).toMatchObject({
      color_key: "rose",
      visibility: "shared",
    });
    expect(onMutated).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous definition when an immediate update fails", async () => {
    vi.mocked(fetchStorageOpsBucketUiTags).mockResolvedValue({
      definitions: [
        { id: 41, label: "Mine", color_key: "teal", scope: "standard", visibility: "private" },
      ],
    });
    vi.mocked(patchStorageOpsBucketUiTagDefinition).mockRejectedValue(
      new Error("color update failed")
    );
    const { result } = renderHook(() => useBucketUiTags("storage-ops", null));
    await waitFor(() => expect(result.current.definitions).toHaveLength(1));

    await act(async () => {
      await expect(
        result.current.updateDefinition(41, { color_key: "rose" })
      ).rejects.toThrow("color update failed");
    });

    expect(patchStorageOpsBucketUiTagDefinition).toHaveBeenCalledWith(41, {
      color_key: "rose",
    });
    expect(result.current.definitions[0].color_key).toBe("teal");
    expect(result.current.error).toBe("color update failed");
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
  });
});

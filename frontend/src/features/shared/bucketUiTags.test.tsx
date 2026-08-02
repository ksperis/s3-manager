import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { buildBucketUiTagsStorageKey, createBucketUiTagTarget, useBucketUiTags } from "./bucketUiTags";

const storedEntry = (name: string, tags: string[]) => ({ name, tenant: null, tags });

describe("useBucketUiTags", () => {
  beforeEach(() => localStorage.clear());

  it("hydrates endpoint changes without copying tags between endpoints", async () => {
    const endpointAKey = buildBucketUiTagsStorageKey("ceph-admin", 7);
    const endpointBKey = buildBucketUiTagsStorageKey("ceph-admin", 8);
    localStorage.setItem(endpointAKey, JSON.stringify({ "\u001fbucket-a": storedEntry("bucket-a", ["alpha"]) }));
    localStorage.setItem(endpointBKey, JSON.stringify({ "\u001fbucket-b": storedEntry("bucket-b", ["beta"]) }));
    const endpointABefore = localStorage.getItem(endpointAKey);
    const endpointBBefore = localStorage.getItem(endpointBKey);

    const { result, rerender } = renderHook(({ endpointId }) => useBucketUiTags("ceph-admin", endpointId), {
      initialProps: { endpointId: 7 },
    });
    expect(Object.values(result.current.tags)).toEqual([["alpha"]]);

    rerender({ endpointId: 8 });
    await waitFor(() => expect(Object.values(result.current.tags)).toEqual([["beta"]]));
    expect(localStorage.getItem(endpointAKey)).toBe(endpointABefore);
    expect(localStorage.getItem(endpointBKey)).toBe(endpointBBefore);
  });

  it("synchronizes storage events for the active endpoint only", async () => {
    const activeKey = buildBucketUiTagsStorageKey("ceph-admin", 7);
    const otherKey = buildBucketUiTagsStorageKey("ceph-admin", 8);
    const { result } = renderHook(() => useBucketUiTags("ceph-admin", 7));

    localStorage.setItem(otherKey, JSON.stringify({ other: storedEntry("other", ["ignored"]) }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: otherKey })));
    expect(result.current.tags).toEqual({});

    localStorage.setItem(activeKey, JSON.stringify({ "\u001fbucket-a": storedEntry("bucket-a", ["shared"]) }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: activeKey })));
    await waitFor(() => expect(Object.values(result.current.tags)).toEqual([["shared"]]));
  });

  it("applies changes to the target endpoint key", () => {
    const { result } = renderHook(() => useBucketUiTags("storage-ops", null));
    const target = createBucketUiTagTarget("storage-ops", 9, "physical-9", "bucket-a", null);
    expect(target).not.toBeNull();

    act(() => result.current.applyTags([target!], ["ops"], []));

    expect(JSON.parse(localStorage.getItem(buildBucketUiTagsStorageKey("storage-ops", 9)) ?? "{}")).toEqual({
      "physical-9": storedEntry("bucket-a", ["ops"]),
    });
  });
});

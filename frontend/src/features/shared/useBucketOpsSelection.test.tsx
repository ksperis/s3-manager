/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import { useBucketOpsSelection } from "./useBucketOpsSelection";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const items: CephAdminBucket[] = [{ name: "alpha" }, { name: "beta" }];

function createOptions() {
  return {
    advancedFilterParam: undefined,
    extractError: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    filterValue: "",
    isStorageOps: false,
    items,
    listBuckets: vi.fn(async () => ({
      items,
      has_next: false,
      total: items.length,
    })),
    quickFilterMode: "contains" as const,
    scopeId: 7,
    setError: vi.fn(),
    sort: { field: "name" as const, direction: "asc" as const },
    tagFilters: [] as number[],
    tagFilterMode: "any" as const,
    total: items.length,
    withStats: false,
  };
}

describe("useBucketOpsSelection", () => {
  it("owns row selection and derives the selection projection", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBucketOpsSelection(options));

    act(() => result.current.toggleSelection("alpha"));

    expect(result.current.selectedBucketList).toEqual(["alpha"]);
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.headerChecked).toBe(false);
    expect(result.current.headerIndeterminate).toBe(true);

    act(() => result.current.resetSelectedBuckets());

    expect(result.current.selectedBucketList).toEqual([]);
    expect(result.current.selectedCount).toBe(0);
  });

  it("loads every filtered page once and reuses the resolved-name cache", async () => {
    const options = createOptions();
    options.listBuckets
      .mockResolvedValueOnce({
        items: [{ name: "alpha" }],
        has_next: true,
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ name: "beta" }],
        has_next: false,
        total: 2,
      });
    const { result } = renderHook(() => useBucketOpsSelection(options));

    await act(async () => result.current.setSelectionForFilteredResults(true));

    expect(options.listBuckets).toHaveBeenNthCalledWith(
      1,
      7,
      expect.objectContaining({ page: 1, page_size: 200 }),
    );
    expect(options.listBuckets).toHaveBeenNthCalledWith(
      2,
      7,
      expect.objectContaining({ page: 2, page_size: 200 }),
    );
    expect(result.current.selectedBucketList).toEqual(["alpha", "beta"]);
    expect(result.current.headerChecked).toBe(true);
    expect(result.current.selectAllProgress).toBeNull();

    await act(async () => result.current.setSelectionForFilteredResults(false));

    expect(options.listBuckets).toHaveBeenCalledTimes(2);
    expect(result.current.selectedBucketList).toEqual([]);

    act(() => result.current.invalidateSelectionCache());
    await act(async () => result.current.setSelectionForFilteredResults(true));

    expect(options.listBuckets).toHaveBeenCalledTimes(3);
    expect(result.current.selectedBucketList).toEqual(["alpha", "beta"]);
  });

  it("ignores a filtered-name response completed after the query changes", async () => {
    const options = createOptions();
    const deferred = createDeferred<{
      items: CephAdminBucket[];
      has_next: boolean;
      total: number;
    }>();
    options.listBuckets.mockReturnValueOnce(deferred.promise);
    const { result, rerender } = renderHook(
      ({ filterValue }) =>
        useBucketOpsSelection({ ...options, filterValue }),
      { initialProps: { filterValue: "old" } },
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.setSelectionForFilteredResults(true);
    });
    rerender({ filterValue: "new" });
    await act(async () => {
      deferred.resolve({ items, has_next: false, total: items.length });
      await pending;
    });

    expect(result.current.selectedBucketList).toEqual([]);
    expect(result.current.selectAllProgress).toBeNull();
    expect(options.setError).not.toHaveBeenCalled();
  });

  it("surfaces current-query loading errors and releases progress", async () => {
    const options = createOptions();
    options.listBuckets.mockRejectedValueOnce(new Error("listing failed"));
    const { result } = renderHook(() => useBucketOpsSelection(options));

    await act(async () => result.current.setSelectionForFilteredResults(true));

    expect(options.setError).toHaveBeenCalledWith("listing failed");
    expect(result.current.selectedBucketList).toEqual([]);
    expect(result.current.selectAllProgress).toBeNull();
  });
});

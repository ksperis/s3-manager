/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBucketOpsCacheRefresh } from "./useBucketOpsCacheRefresh";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createOptions() {
  return {
    clearTagTooltip: vi.fn(),
    extractError: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    invalidateSelectionCache: vi.fn(),
    refreshBucketListingCache: vi.fn(async (_scopeId: number) => undefined),
    refreshBuckets: vi.fn(),
    reloadUiTags: vi.fn(async () => undefined),
    resetBucketTooltipState: vi.fn(),
    scopeId: 7 as number | null,
    setError: vi.fn(),
  };
}

describe("useBucketOpsCacheRefresh", () => {
  it("refreshes the backend cache before invalidating the current UI caches", async () => {
    const events: string[] = [];
    const options = createOptions();
    options.refreshBucketListingCache.mockImplementationOnce(async () => {
      events.push("backend");
    });
    options.reloadUiTags.mockImplementationOnce(async () => {
      events.push("tags");
    });
    options.resetBucketTooltipState.mockImplementationOnce(() => {
      events.push("bucket-tooltips");
    });
    options.clearTagTooltip.mockImplementationOnce(() => {
      events.push("tag-tooltip");
    });
    options.invalidateSelectionCache.mockImplementationOnce(() => {
      events.push("selection");
    });
    options.refreshBuckets.mockImplementationOnce(() => {
      events.push("listing");
    });
    const { result } = renderHook(() => useBucketOpsCacheRefresh(options));

    await act(async () => result.current.refreshBucketListing());

    expect(options.refreshBucketListingCache).toHaveBeenCalledWith(7);
    expect(options.setError).toHaveBeenCalledWith(null);
    expect(events).toEqual([
      "backend",
      "tags",
      "bucket-tooltips",
      "tag-tooltip",
      "selection",
      "listing",
    ]);
    expect(result.current.cacheRefreshLoading).toBe(false);
  });

  it("surfaces a backend refresh failure without invalidating UI caches", async () => {
    const options = createOptions();
    options.refreshBucketListingCache.mockRejectedValueOnce(
      new Error("cache refresh failed"),
    );
    const { result } = renderHook(() => useBucketOpsCacheRefresh(options));

    await act(async () => result.current.refreshBucketListing());

    expect(options.setError).toHaveBeenNthCalledWith(1, null);
    expect(options.setError).toHaveBeenNthCalledWith(2, "cache refresh failed");
    expect(options.reloadUiTags).not.toHaveBeenCalled();
    expect(options.invalidateSelectionCache).not.toHaveBeenCalled();
    expect(options.refreshBuckets).not.toHaveBeenCalled();
    expect(result.current.cacheRefreshLoading).toBe(false);
  });

  it("surfaces a UI tag reload failure before clearing dependent caches", async () => {
    const options = createOptions();
    options.reloadUiTags.mockRejectedValueOnce(new Error("tag reload failed"));
    const { result } = renderHook(() => useBucketOpsCacheRefresh(options));

    await act(async () => result.current.refreshBucketListing());

    expect(options.setError).toHaveBeenNthCalledWith(1, null);
    expect(options.setError).toHaveBeenNthCalledWith(2, "tag reload failed");
    expect(options.invalidateSelectionCache).not.toHaveBeenCalled();
    expect(options.refreshBuckets).not.toHaveBeenCalled();
    expect(result.current.cacheRefreshLoading).toBe(false);
  });

  it("prevents overlapping refresh requests before React rerenders", async () => {
    const options = createOptions();
    const deferred = createDeferred<void>();
    options.refreshBucketListingCache.mockReturnValueOnce(deferred.promise);
    const { result } = renderHook(() => useBucketOpsCacheRefresh(options));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refreshBucketListing();
      void result.current.refreshBucketListing();
    });

    expect(options.refreshBucketListingCache).toHaveBeenCalledOnce();
    expect(result.current.cacheRefreshLoading).toBe(true);

    await act(async () => {
      deferred.resolve();
      await pending;
    });

    expect(options.reloadUiTags).toHaveBeenCalledOnce();
    expect(options.refreshBuckets).toHaveBeenCalledOnce();
    expect(result.current.cacheRefreshLoading).toBe(false);
  });

  it("discards a refresh result completed after its scope changes", async () => {
    const options = createOptions();
    const deferred = createDeferred<void>();
    options.refreshBucketListingCache.mockReturnValueOnce(deferred.promise);
    const { result, rerender } = renderHook(
      ({ scopeId }) => useBucketOpsCacheRefresh({ ...options, scopeId }),
      { initialProps: { scopeId: 7 as number | null } },
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refreshBucketListing();
    });
    rerender({ scopeId: 8 });

    expect(result.current.cacheRefreshLoading).toBe(true);

    await act(async () => {
      deferred.resolve();
      await pending;
    });

    expect(options.reloadUiTags).not.toHaveBeenCalled();
    expect(options.invalidateSelectionCache).not.toHaveBeenCalled();
    expect(options.refreshBuckets).not.toHaveBeenCalled();
    expect(options.setError).toHaveBeenCalledOnce();
    expect(options.setError).toHaveBeenCalledWith(null);
    expect(result.current.cacheRefreshLoading).toBe(false);
  });

  it("does nothing when no bucket scope is selected", async () => {
    const options = createOptions();
    const { result } = renderHook(() =>
      useBucketOpsCacheRefresh({ ...options, scopeId: null }),
    );

    await act(async () => result.current.refreshBucketListing());

    expect(options.refreshBucketListingCache).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
    expect(result.current.cacheRefreshLoading).toBe(false);
  });
});

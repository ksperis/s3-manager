import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserListingRefresh } from "./useBrowserListingRefresh";

function createOptions() {
  return {
    bucketName: "bucket-a",
    contextKey: "browser:account-a",
    enabled: true,
    loadObjects: vi.fn(async () => undefined),
    loadTreeChildren: vi.fn(async () => undefined),
    prefix: "current/",
    refreshToken: 1,
  };
}

describe("useBrowserListingRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves the immediate, visible, and upload refresh modes", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserListingRefresh(options));

    await act(async () => {
      await result.current.refreshNow("forced/");
    });
    expect(options.loadObjects).toHaveBeenLastCalledWith({
      prefixOverride: "forced/",
      silent: true,
      forceRefresh: true,
    });
    expect(options.loadTreeChildren).toHaveBeenLastCalledWith("forced/", {
      expand: false,
    });

    await act(async () => {
      await result.current.reload("visible/");
    });
    expect(options.loadObjects).toHaveBeenLastCalledWith({
      prefixOverride: "visible/",
    });
    expect(options.loadTreeChildren).toHaveBeenLastCalledWith("visible/");

    act(() => {
      result.current.refreshAfterUpload("uploaded/");
    });
    expect(options.loadObjects).toHaveBeenLastCalledWith({
      prefixOverride: "uploaded/",
      silent: true,
      forceRefresh: true,
    });
    expect(options.loadTreeChildren).toHaveBeenLastCalledWith("uploaded/", {
      expand: false,
    });
  });

  it("coalesces delayed refreshes onto the latest requested prefix", async () => {
    vi.useFakeTimers();
    const options = createOptions();
    const { result } = renderHook(() => useBrowserListingRefresh(options));

    act(() => {
      result.current.requestRefresh("old/");
      result.current.requestRefresh("latest/");
    });
    expect(options.loadObjects).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(options.loadObjects).toHaveBeenCalledOnce();
    expect(options.loadObjects).toHaveBeenCalledWith({
      prefixOverride: "latest/",
      silent: true,
    });
    expect(options.loadTreeChildren).toHaveBeenCalledWith("latest/", {
      expand: false,
    });
  });

  it("cancels a delayed refresh when the browsing scope changes", async () => {
    vi.useFakeTimers();
    const options = createOptions();
    const { result, rerender } = renderHook(
      ({ contextKey, prefix }) =>
        useBrowserListingRefresh({ ...options, contextKey, prefix }),
      {
        initialProps: {
          contextKey: "browser:account-a",
          prefix: "old/",
        },
      },
    );

    act(() => result.current.requestRefresh("old/"));
    rerender({ contextKey: "browser:account-b", prefix: "new/" });

    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(options.loadObjects).not.toHaveBeenCalled();
    expect(options.loadTreeChildren).not.toHaveBeenCalled();
  });

  it("refreshes the current prefix only when an external token changes", async () => {
    const options = createOptions();
    const { rerender } = renderHook(
      ({ refreshToken }) =>
        useBrowserListingRefresh({ ...options, refreshToken }),
      { initialProps: { refreshToken: 1 } },
    );
    expect(options.loadObjects).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ refreshToken: 2 });
      await Promise.resolve();
    });

    expect(options.loadObjects).toHaveBeenCalledWith({
      prefixOverride: "current/",
      silent: true,
      forceRefresh: true,
    });
    expect(options.loadTreeChildren).toHaveBeenCalledWith("current/", {
      expand: false,
    });
  });
});

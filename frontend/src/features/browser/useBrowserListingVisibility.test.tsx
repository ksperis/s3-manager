import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBrowserListingVisibility } from "./useBrowserListingVisibility";

describe("useBrowserListingVisibility", () => {
  it("owns deleted-object visibility when it is uncontrolled", () => {
    const onVisibilityChange = vi.fn();
    const { result } = renderHook(() =>
      useBrowserListingVisibility({
        deletedObjectsOptions: { onVisibilityChange },
      }),
    );

    expect(result.current.showDeletedObjects).toBe(false);
    act(() => result.current.toggleDeletedObjects());

    expect(result.current.showDeletedObjects).toBe(true);
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
  });

  it("notifies without mutating controlled deleted-object visibility", () => {
    const onVisibilityChange = vi.fn();
    const { result } = renderHook(() =>
      useBrowserListingVisibility({
        deletedObjectsOptions: {
          visible: true,
          onVisibilityChange,
        },
      }),
    );

    act(() => result.current.toggleDeletedObjects());

    expect(result.current.showDeletedObjects).toBe(true);
    expect(onVisibilityChange).toHaveBeenCalledWith(false);
  });

  it("can reset local deleted-object visibility", () => {
    const { result } = renderHook(() => useBrowserListingVisibility({}));

    act(() => result.current.toggleDeletedObjects());
    expect(result.current.showDeletedObjects).toBe(true);

    act(() => result.current.hideDeletedObjects());

    expect(result.current.showDeletedObjects).toBe(false);
  });

  it("toggles folder rows independently", () => {
    const { result } = renderHook(() => useBrowserListingVisibility({}));

    expect(result.current.showFolderItems).toBe(true);
    act(() => result.current.toggleFolderItems());
    expect(result.current.showFolderItems).toBe(false);
    expect(result.current.showDeletedObjects).toBe(false);
  });
});

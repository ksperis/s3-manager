import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCephAdminListingFilters } from "./useCephAdminListingFilters";

type TestFilterState = {
  name: string;
  suspended: "any" | "active" | "suspended";
};

const defaultAdvancedFilter: TestFilterState = {
  name: "",
  suspended: "any",
};

describe("useCephAdminListingFilters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces and trims the quick filter while resetting pagination", () => {
    const setPage = vi.fn();
    const { result } = renderHook(() =>
      useCephAdminListingFilters({ endpointId: 1, defaultAdvancedFilter, setPage })
    );
    setPage.mockClear();

    act(() => {
      result.current.setFilter("  alice  ");
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.searchValue).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.searchValue).toBe("alice");
    expect(setPage).toHaveBeenCalledWith(1);
  });

  it("applies a draft and restores field-specific defaults when a filter is removed", () => {
    const setPage = vi.fn();
    const { result } = renderHook(() =>
      useCephAdminListingFilters({ endpointId: 1, defaultAdvancedFilter, setPage })
    );

    act(() => {
      result.current.updateAdvancedField("name", "Alice");
      result.current.updateAdvancedField("suspended", "suspended");
    });
    act(() => {
      result.current.applyAdvancedFilter();
    });
    expect(result.current.advancedApplied).toEqual({ name: "Alice", suspended: "suspended" });

    act(() => {
      result.current.removeActiveFilterItem({ type: "advanced", field: "suspended" });
    });
    expect(result.current.advancedDraft.suspended).toBe("any");
    expect(result.current.advancedApplied?.suspended).toBe("any");
  });

  it("resets quick and advanced filters when the endpoint changes", () => {
    const setPage = vi.fn();
    const { result, rerender } = renderHook(
      ({ endpointId }) => useCephAdminListingFilters({ endpointId, defaultAdvancedFilter, setPage }),
      { initialProps: { endpointId: 1 } }
    );

    act(() => {
      result.current.setFilter("alice");
      result.current.setQuickFilterMode("exact");
      result.current.updateAdvancedField("name", "Alice");
      result.current.applyAdvancedFilter();
    });

    rerender({ endpointId: 2 });

    expect(result.current.filter).toBe("");
    expect(result.current.searchValue).toBe("");
    expect(result.current.quickFilterMode).toBe("contains");
    expect(result.current.advancedDraft).toEqual(defaultAdvancedFilter);
    expect(result.current.advancedApplied).toBeNull();
  });
});

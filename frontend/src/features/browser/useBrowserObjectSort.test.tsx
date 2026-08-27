import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BrowserColumnId } from "./browserObjectTableModel";
import { useBrowserObjectSort } from "./useBrowserObjectSort";

const visibleColumns = (...columns: BrowserColumnId[]) => new Set(columns);

describe("useBrowserObjectSort", () => {
  it("starts with the canonical name sort", () => {
    const { result } = renderHook(() =>
      useBrowserObjectSort({ visibleColumns: visibleColumns("size") }),
    );

    expect(result.current).toMatchObject({
      backendSortBy: "name",
      sortDirection: "asc",
      sortId: "name-asc",
      sortKey: "name",
    });
  });

  it("starts a new column ascending and then alternates its direction", () => {
    const { result } = renderHook(() =>
      useBrowserObjectSort({ visibleColumns: visibleColumns("size") }),
    );

    act(() => result.current.toggleSort("size"));
    expect(result.current.sortId).toBe("size-asc");

    act(() => result.current.toggleSort("size"));
    expect(result.current.sortId).toBe("size-desc");

    act(() => result.current.toggleSort("size"));
    expect(result.current.sortId).toBe("size-asc");
  });

  it("maps the storage class sort to the backend field name", () => {
    const { result } = renderHook(() =>
      useBrowserObjectSort({
        visibleColumns: visibleColumns("storageClass"),
      }),
    );

    act(() => result.current.toggleSort("storageClass"));

    expect(result.current.backendSortBy).toBe("storage_class");
  });

  it("returns to name ascending when the active column is hidden", () => {
    const { result, rerender } = renderHook(
      ({ columns }) => useBrowserObjectSort({ visibleColumns: columns }),
      { initialProps: { columns: visibleColumns("size") } },
    );

    act(() => {
      result.current.toggleSort("size");
      result.current.toggleSort("size");
    });
    expect(result.current.sortId).toBe("size-desc");

    rerender({ columns: visibleColumns() });

    expect(result.current.sortId).toBe("name-asc");
  });
});

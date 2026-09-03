import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadColumnWidthsForSurface,
  loadVisibleColumnsForSurface,
  persistColumnWidthsForSurface,
  persistVisibleColumnsForSurface,
} from "./browserObjectTableModel";
import { useBrowserObjectColumns } from "./useBrowserObjectColumns";

describe("useBrowserObjectColumns", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("keeps root and embedded column preferences separate", async () => {
    persistVisibleColumnsForSurface(true, ["etag"]);
    persistColumnWidthsForSurface(true, { name: 420 });
    persistVisibleColumnsForSurface(false, ["storageClass"]);
    persistColumnWidthsForSurface(false, { name: 360 });

    const { result, rerender } = renderHook(
      ({ isMainBrowserPath }: { isMainBrowserPath: boolean }) =>
        useBrowserObjectColumns({ isMainBrowserPath }),
      { initialProps: { isMainBrowserPath: true } },
    );
    expect(result.current.visibleColumns).toEqual(["etag"]);
    expect(result.current.columnWidths).toEqual({ name: 420 });

    rerender({ isMainBrowserPath: false });
    expect(result.current.visibleColumns).toEqual(["storageClass"]);
    expect(result.current.columnWidths).toEqual({ name: 360 });

    await waitFor(() => {
      expect(loadVisibleColumnsForSurface(true)).toEqual(["etag"]);
      expect(loadColumnWidthsForSurface(true)).toEqual({ name: 420 });
      expect(loadVisibleColumnsForSurface(false)).toEqual(["storageClass"]);
      expect(loadColumnWidthsForSurface(false)).toEqual({ name: 360 });
    });
  });

  it("persists a resized column only after the pointer interaction ends", async () => {
    const { result } = renderHook(() =>
      useBrowserObjectColumns({ isMainBrowserPath: true }),
    );
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => {
      result.current.startColumnResize("name")({
        clientX: 320,
        preventDefault,
        stopPropagation,
      } as ReactPointerEvent<HTMLDivElement>);
    });
    expect(document.body.style.cursor).toBe("col-resize");

    fireEvent.pointerMove(document, { clientX: 420 });
    expect(result.current.columnWidths).toEqual({ name: 420 });
    expect(loadColumnWidthsForSurface(true)).toEqual({});

    fireEvent.pointerUp(document);
    await waitFor(() =>
      expect(loadColumnWidthsForSurface(true)).toEqual({ name: 420 }),
    );
    expect(document.body.style.cursor).toBe("");
  });
});

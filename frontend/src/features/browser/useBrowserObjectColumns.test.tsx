import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserLayoutMode } from "./browserActions";
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

  it("switches layouts without persisting columns from the previous scope", async () => {
    persistVisibleColumnsForSurface(true, ["etag"], "standard");
    persistColumnWidthsForSurface(true, { name: 420 }, "standard");
    persistVisibleColumnsForSurface(true, ["storageClass"], "workbench");
    persistColumnWidthsForSurface(true, { name: 360 }, "workbench");

    const { result, rerender } = renderHook(
      ({ layoutMode }: { layoutMode: BrowserLayoutMode }) =>
        useBrowserObjectColumns({ isMainBrowserPath: true, layoutMode }),
      { initialProps: { layoutMode: "standard" as BrowserLayoutMode } },
    );
    expect(result.current.visibleColumns).toEqual(["etag"]);
    expect(result.current.columnWidths).toEqual({ name: 420 });
    const staleStandardToggle = result.current.toggleVisibleColumn;

    rerender({ layoutMode: "workbench" });
    expect(result.current.visibleColumns).toEqual(["storageClass"]);
    expect(result.current.columnWidths).toEqual({ name: 360 });
    act(() => staleStandardToggle("size"));
    expect(result.current.visibleColumns).toEqual(["storageClass"]);

    await waitFor(() => {
      expect(loadVisibleColumnsForSurface(true, "standard")).toEqual(["etag"]);
      expect(loadColumnWidthsForSurface(true, "standard")).toEqual({
        name: 420,
      });
      expect(loadVisibleColumnsForSurface(true, "workbench")).toEqual([
        "storageClass",
      ]);
      expect(loadColumnWidthsForSurface(true, "workbench")).toEqual({
        name: 360,
      });
    });
  });

  it("persists a resized column only after the pointer interaction ends", async () => {
    const { result } = renderHook(() =>
      useBrowserObjectColumns({
        isMainBrowserPath: true,
        layoutMode: "workbench",
      }),
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
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(document.body.style.cursor).toBe("col-resize");

    fireEvent.pointerMove(document, { clientX: 420 });
    expect(result.current.columnWidths).toEqual({ name: 420 });
    expect(loadColumnWidthsForSurface(true, "workbench")).toEqual({});

    fireEvent.pointerUp(document);
    await waitFor(() =>
      expect(loadColumnWidthsForSurface(true, "workbench")).toEqual({
        name: 420,
      }),
    );
    expect(document.body.style.cursor).toBe("");
  });
});

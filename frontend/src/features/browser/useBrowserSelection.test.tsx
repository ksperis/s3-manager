import { act, renderHook } from "@testing-library/react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserInspectorTab } from "./BrowserInspectorPanel";
import type { BrowserItem } from "./browserTypes";
import { useBrowserSelection } from "./useBrowserSelection";

const items: BrowserItem[] = [
  {
    id: "a",
    key: "a.txt",
    name: "a.txt",
    type: "file",
    size: "1 B",
    sizeBytes: 1,
    modified: "-",
    owner: "",
  },
  {
    id: "b",
    key: "b.txt",
    name: "b.txt",
    type: "file",
    size: "2 B",
    sizeBytes: 2,
    modified: "-",
    owner: "",
  },
  {
    id: "c",
    key: "c/",
    name: "c",
    type: "folder",
    size: "-",
    modified: "-",
    owner: "",
  },
  {
    id: "deleted",
    key: "deleted.txt",
    name: "deleted.txt",
    type: "file",
    isDeleted: true,
    size: "0 B",
    modified: "-",
    owner: "",
  },
];

function mouseEvent(
  overrides: Partial<MouseEvent<HTMLElement>> = {},
): MouseEvent<HTMLElement> {
  return {
    ctrlKey: false,
    detail: 1,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as MouseEvent<HTMLElement>;
}

function keyboardEvent(
  key: string,
  overrides: Partial<KeyboardEvent<HTMLDivElement>> = {},
): KeyboardEvent<HTMLDivElement> {
  return {
    key,
    preventDefault: vi.fn(),
    shiftKey: false,
    target: document.createElement("div"),
    ...overrides,
  } as unknown as KeyboardEvent<HTMLDivElement>;
}

function useSelectionHarness({
  currentItems = items,
  scopeKey = "account-a:bucket-a:root",
}: {
  currentItems?: BrowserItem[];
  scopeKey?: string;
}) {
  const [inspectorTab, setInspectorTab] =
    useState<BrowserInspectorTab>("bucket");
  const selection = useBrowserSelection({
    inspectorTab,
    inspectorVisible: true,
    items: currentItems,
    listItems: currentItems,
    scopeKey,
    setInspectorTab,
  });
  return { ...selection, inspectorTab };
}

describe("useBrowserSelection", () => {
  it("centralizes single, additive, and range mouse selection", () => {
    const { result } = renderHook(() => useSelectionHarness({}));

    act(() => result.current.handleItemSelectionClick(mouseEvent(), "b"));
    expect(result.current.selectedIds).toEqual(["b"]);
    expect(result.current.inspectorTab).toBe("details");
    expect(result.current.inspectedItem).toEqual(items[1]);

    act(() =>
      result.current.handleItemSelectionClick(
        mouseEvent({ ctrlKey: true }),
        "c",
      ),
    );
    expect(result.current.selectedIds).toEqual(["b", "c"]);

    act(() =>
      result.current.handleItemSelectionClick(
        mouseEvent({ shiftKey: true }),
        "a",
      ),
    );
    expect(result.current.selectedIds).toEqual(["a", "b", "c"]);
    expect(result.current.selectedBytes).toBe(3);
  });

  it("owns keyboard navigation, activation, and clearing", () => {
    const onOpenItem = vi.fn();
    const { result } = renderHook(() => useSelectionHarness({}));

    act(() =>
      result.current.handleListKeyDown(
        keyboardEvent("ArrowDown"),
        onOpenItem,
      ),
    );
    expect(result.current.selectedIds).toEqual(["a"]);

    act(() =>
      result.current.handleListKeyDown(
        keyboardEvent("ArrowDown"),
        onOpenItem,
      ),
    );
    expect(result.current.selectedIds).toEqual(["b"]);

    act(() =>
      result.current.handleListKeyDown(
        keyboardEvent("End", { shiftKey: true }),
        onOpenItem,
      ),
    );
    expect(result.current.selectedIds).toEqual(["b", "c", "deleted"]);

    act(() =>
      result.current.handleListKeyDown(keyboardEvent("Enter"), onOpenItem),
    );
    expect(onOpenItem).toHaveBeenCalledWith(items[3]);

    act(() =>
      result.current.handleListKeyDown(keyboardEvent("Escape"), onOpenItem),
    );
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.inspectorTab).toBe("bucket");
  });

  it("resets selection and inspector state when the browsing scope changes", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useSelectionHarness({ scopeKey }),
      { initialProps: { scopeKey: "account-a:bucket-a:root" } },
    );

    act(() => result.current.selectItemDetails(items[1]));
    expect(result.current.selectedIds).toEqual(["b"]);
    expect(result.current.inspectedItem).toEqual(items[1]);
    expect(result.current.inspectorTab).toBe("details");

    rerender({ scopeKey: "account-b:bucket-a:root" });

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.inspectedItem).toBeNull();
    expect(result.current.inspectorTab).toBe("bucket");
  });

  it("prepares contextual menus without leaking stale multi-selection", () => {
    const { result } = renderHook(() => useSelectionHarness({}));

    act(() => result.current.handleItemSelectionClick(mouseEvent(), "a"));
    act(() => result.current.toggleSelection("b"));

    let menuSelection!: ReturnType<
      typeof result.current.prepareItemContextMenu
    >;
    act(() => {
      menuSelection = result.current.prepareItemContextMenu(items[1]);
    });
    expect(menuSelection.kind).toBe("selection");
    expect(menuSelection.items).toEqual([items[0], items[1]]);

    act(() => {
      menuSelection = result.current.prepareItemContextMenu(items[2]);
    });
    expect(menuSelection.kind).toBe("item");
    expect(result.current.selectedIds).toEqual(["c"]);

    act(() => {
      menuSelection = result.current.prepareItemContextMenu(items[3]);
    });
    expect(menuSelection.items).toEqual([items[3]]);
    expect(result.current.selectedIds).toEqual(["c"]);
  });
});

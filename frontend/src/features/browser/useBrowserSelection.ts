/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { isBrowserInteractiveTarget } from "./browserObjectItemPresentation";
import type { BrowserItem } from "./browserTypes";

type UseBrowserSelectionOptions = {
  items: BrowserItem[];
  listItems: BrowserItem[];
  scopeKey: string;
};

type ItemContextMenuSelection = {
  kind: "item" | "selection";
  item: BrowserItem;
  items: BrowserItem[];
};

export function useBrowserSelection({
  items,
  listItems,
  scopeKey,
}: UseBrowserSelectionOptions) {
  const [, setActiveItem] = useState<BrowserItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectableListItems = useMemo(
    () => listItems.filter((item) => !item.isDeleted),
    [listItems],
  );
  const allSelected =
    selectableListItems.length > 0 &&
    selectableListItems.every((item) => selectedSet.has(item.id));
  const selectedItems = useMemo(
    () => items.filter((item) => selectedSet.has(item.id)),
    [items, selectedSet],
  );
  const selectedBytes = useMemo(
    () =>
      selectedItems.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0),
    [selectedItems],
  );
  const applyRowSelection = useCallback(
    (
      nextIds: string[],
      anchorId: string | null,
      nextActiveRowId: string | null,
    ) => {
      setSelectedIds(nextIds);
      setSelectionAnchorId(anchorId);
      setActiveRowId(nextActiveRowId);
    },
    [],
  );

  const activateItem = useCallback((item: BrowserItem | null) => {
    setActiveItem(item);
  }, []);

  const clearActiveItem = useCallback(() => setActiveItem(null), []);

  const clearSelection = useCallback(() => {
    applyRowSelection([], null, null);
    setActiveItem(null);
  }, [applyRowSelection]);

  const selectSingleRow = useCallback(
    (id: string) => {
      applyRowSelection([id], id, id);
    },
    [applyRowSelection],
  );

  const selectRangeBetweenRows = useCallback(
    (anchorId: string, targetId: string) => {
      const anchorIndex = listItems.findIndex((item) => item.id === anchorId);
      const targetIndex = listItems.findIndex((item) => item.id === targetId);
      if (anchorIndex < 0 || targetIndex < 0) {
        applyRowSelection([targetId], targetId, targetId);
        return;
      }
      const [start, end] =
        anchorIndex <= targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
      const rangeIds = listItems.slice(start, end + 1).map((item) => item.id);
      applyRowSelection(rangeIds, anchorId, targetId);
    },
    [applyRowSelection, listItems],
  );

  const toggleSelection = useCallback(
    (id: string) => {
      const nextIds = selectedIds.includes(id)
        ? selectedIds.filter((itemId) => itemId !== id)
        : [...selectedIds, id];
      applyRowSelection(nextIds, id, id);
    },
    [applyRowSelection, selectedIds],
  );

  const selectAllItems = useCallback(() => {
    const nextIds = selectableListItems.map((item) => item.id);
    applyRowSelection(nextIds, nextIds[0] ?? null, nextIds[0] ?? null);
  }, [applyRowSelection, selectableListItems]);

  const toggleAllSelection = useCallback(() => {
    if (allSelected) {
      applyRowSelection([], null, null);
      return;
    }
    selectAllItems();
  }, [allSelected, applyRowSelection, selectAllItems]);

  const handleItemSelectionClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>, itemId: string) => {
      if (event.detail > 1) return;
      if (event.shiftKey) {
        const anchorId =
          (selectionAnchorId &&
          listItems.some((item) => item.id === selectionAnchorId)
            ? selectionAnchorId
            : null) ??
          (activeRowId && listItems.some((item) => item.id === activeRowId)
            ? activeRowId
            : null) ??
          listItems.find((item) => selectedSet.has(item.id))?.id ??
          itemId;
        selectRangeBetweenRows(anchorId, itemId);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        toggleSelection(itemId);
        return;
      }
      selectSingleRow(itemId);
    },
    [
      activeRowId,
      listItems,
      selectRangeBetweenRows,
      selectSingleRow,
      selectedSet,
      selectionAnchorId,
      toggleSelection,
    ],
  );

  const handleItemCheckboxClick = useCallback(
    (itemId: string, extendRange: boolean) => {
      if (extendRange) {
        const anchorId =
          (selectionAnchorId &&
          listItems.some((item) => item.id === selectionAnchorId)
            ? selectionAnchorId
            : null) ??
          listItems.find((item) => selectedSet.has(item.id))?.id ??
          itemId;
        selectRangeBetweenRows(anchorId, itemId);
        return;
      }
      toggleSelection(itemId);
    },
    [
      listItems,
      selectRangeBetweenRows,
      selectedSet,
      selectionAnchorId,
      toggleSelection,
    ],
  );

  const prepareItemContextMenu = useCallback(
    (item: BrowserItem): ItemContextMenuSelection => {
      const isSelected = selectedSet.has(item.id);
      const menuItems = isSelected ? selectedItems : [item];
      if (!isSelected && !item.isDeleted) {
        applyRowSelection([item.id], item.id, item.id);
      }
      return {
        kind: isSelected && selectedItems.length > 1 ? "selection" : "item",
        item,
        items: menuItems,
      };
    },
    [applyRowSelection, selectedItems, selectedSet],
  );

  const prepareItemActionsMenu = useCallback(
    (item: BrowserItem) => {
      if (
        !item.isDeleted &&
        (selectedIds.length !== 1 || selectedIds[0] !== item.id)
      ) {
        selectSingleRow(item.id);
        return;
      }
      setSelectionAnchorId(item.id);
      setActiveRowId(item.id);
    },
    [selectSingleRow, selectedIds],
  );

  const removeItemsFromSelection = useCallback(
    (removedItems: BrowserItem[]) => {
      if (removedItems.length === 0) return;
      const removedIds = new Set(removedItems.map((item) => item.id));
      const nextIds = selectedIds.filter((id) => !removedIds.has(id));
      if (nextIds.length === selectedIds.length) return;
      applyRowSelection(
        nextIds,
        selectionAnchorId && nextIds.includes(selectionAnchorId)
          ? selectionAnchorId
          : (nextIds[0] ?? null),
        activeRowId && nextIds.includes(activeRowId)
          ? activeRowId
          : (nextIds[0] ?? null),
      );
      setActiveItem((current) =>
        current && removedIds.has(current.id) ? null : current,
      );
    },
    [
      activeRowId,
      applyRowSelection,
      selectedIds,
      selectionAnchorId,
    ],
  );

  const handleListKeyDown = useCallback(
    (
      event: ReactKeyboardEvent<HTMLDivElement>,
      onOpenItem: (item: BrowserItem) => void,
    ) => {
      if (isBrowserInteractiveTarget(event.target) || listItems.length === 0) {
        return;
      }
      const activeIndex = activeRowId
        ? listItems.findIndex((item) => item.id === activeRowId)
        : -1;
      const currentIndex =
        activeIndex >= 0
          ? activeIndex
          : listItems.findIndex((item) => selectedSet.has(item.id));
      const selectIndex = (nextIndex: number, extendRange: boolean) => {
        const clampedIndex = Math.max(
          0,
          Math.min(listItems.length - 1, nextIndex),
        );
        const targetId = listItems[clampedIndex]?.id;
        if (!targetId) return;
        if (extendRange) {
          const anchorId =
            (selectionAnchorId &&
            listItems.some((item) => item.id === selectionAnchorId)
              ? selectionAnchorId
              : null) ??
            listItems[Math.max(0, currentIndex)]?.id ??
            targetId;
          selectRangeBetweenRows(anchorId, targetId);
          return;
        }
        selectSingleRow(targetId);
      };

      if (event.key === "ArrowDown") {
        event.preventDefault();
        selectIndex(
          currentIndex < 0
            ? 0
            : Math.min(listItems.length - 1, currentIndex + 1),
          event.shiftKey,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        selectIndex(
          currentIndex < 0
            ? listItems.length - 1
            : Math.max(0, currentIndex - 1),
          event.shiftKey,
        );
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        selectIndex(0, event.shiftKey);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        selectIndex(listItems.length - 1, event.shiftKey);
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        const targetId = listItems[currentIndex < 0 ? 0 : currentIndex]?.id;
        if (targetId) toggleSelection(targetId);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const targetItem = listItems[currentIndex < 0 ? 0 : currentIndex];
        if (targetItem) onOpenItem(targetItem);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
      }
    },
    [
      activeRowId,
      clearSelection,
      listItems,
      selectRangeBetweenRows,
      selectSingleRow,
      selectedSet,
      selectionAnchorId,
      toggleSelection,
    ],
  );

  const handleListBackgroundClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (
        target.closest("button, a, input, textarea, select, label") ||
        target.closest("[data-browser-item]")
      ) {
        return;
      }
      clearSelection();
    },
    [clearSelection],
  );

  useEffect(() => {
    setSelectedIds([]);
    setSelectionAnchorId(null);
    setActiveRowId(null);
    setActiveItem(null);
  }, [scopeKey]);

  useEffect(() => {
    const nextIds = selectedIds.filter((id) =>
      items.some((item) => item.id === id),
    );
    if (
      nextIds.length !== selectedIds.length ||
      nextIds.some((id, index) => id !== selectedIds[index])
    ) {
      setSelectedIds(nextIds);
    }
    setActiveItem((current) =>
      current && items.some((item) => item.id === current.id) ? current : null,
    );
  }, [items, selectedIds]);

  useEffect(() => {
    setSelectionAnchorId((current) =>
      current && listItems.some((item) => item.id === current)
        ? current
        : null,
    );
    setActiveRowId((current) => {
      if (current && listItems.some((item) => item.id === current)) {
        return current;
      }
      return (
        listItems.find((item) => selectedIds.includes(item.id))?.id ?? null
      );
    });
  }, [listItems, selectedIds]);

  return {
    activateItem,
    allSelected,
    clearActiveItem,
    clearSelection,
    handleItemCheckboxClick,
    handleItemSelectionClick,
    handleListBackgroundClick,
    handleListKeyDown,
    prepareItemActionsMenu,
    prepareItemContextMenu,
    removeItemsFromSelection,
    selectAllItems,
    selectableListItems,
    selectedBytes,
    selectedCount: selectedItems.length,
    selectedIds,
    selectedItems,
    selectedSet,
    selectSingleRow,
    toggleAllSelection,
    toggleSelection,
  };
}

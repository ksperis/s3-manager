/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DEFAULT_VISIBLE_COLUMN_IDS,
  clampColumnWidth,
  loadColumnWidthsForSurface,
  loadVisibleColumnsForSurface,
  normalizeVisibleColumns,
  persistColumnWidthsForSurface,
  persistVisibleColumnsForSurface,
  resolveColumnWidthPx,
  type BrowserColumnId,
  type BrowserObjectColumnWidths,
  type BrowserResizableColumnId,
} from "./browserObjectTableModel";

type ScopedState<T> = {
  scopeKey: string;
  value: T;
};

type ActiveColumnResize = {
  columnId: BrowserResizableColumnId;
  scopeKey: string;
  startX: number;
  startWidthPx: number;
};

type UseBrowserObjectColumnsOptions = {
  isMainBrowserPath: boolean;
};

export function useBrowserObjectColumns({
  isMainBrowserPath,
}: UseBrowserObjectColumnsOptions) {
  const scopeKey = isMainBrowserPath ? "root" : "embedded";
  const storedVisibleColumns = useMemo(
    () => loadVisibleColumnsForSurface(isMainBrowserPath),
    [isMainBrowserPath],
  );
  const storedColumnWidths = useMemo(
    () => loadColumnWidthsForSurface(isMainBrowserPath),
    [isMainBrowserPath],
  );
  const [visibleColumnsState, setVisibleColumnsState] = useState<
    ScopedState<BrowserColumnId[]>
  >(() => ({ scopeKey, value: storedVisibleColumns }));
  const [columnWidthsState, setColumnWidthsState] = useState<
    ScopedState<BrowserObjectColumnWidths>
  >(() => ({ scopeKey, value: storedColumnWidths }));
  const [activeColumnResizeState, setActiveColumnResizeState] =
    useState<ActiveColumnResize | null>(null);
  const activeScopeRef = useRef(scopeKey);
  const visibleColumnsRef = useRef(storedVisibleColumns);
  const columnWidthsRef = useRef(storedColumnWidths);

  const visibleColumns =
    visibleColumnsState.scopeKey === scopeKey
      ? visibleColumnsState.value
      : storedVisibleColumns;
  const columnWidths =
    columnWidthsState.scopeKey === scopeKey
      ? columnWidthsState.value
      : storedColumnWidths;
  const activeColumnResize =
    activeColumnResizeState?.scopeKey === scopeKey
      ? activeColumnResizeState
      : null;
  activeScopeRef.current = scopeKey;
  visibleColumnsRef.current = visibleColumns;
  columnWidthsRef.current = columnWidths;

  useEffect(() => {
    setActiveColumnResizeState(null);
  }, [scopeKey]);

  useEffect(() => {
    persistVisibleColumnsForSurface(isMainBrowserPath, visibleColumns);
  }, [isMainBrowserPath, visibleColumns]);

  useEffect(() => {
    if (activeColumnResize) return;
    persistColumnWidthsForSurface(isMainBrowserPath, columnWidths);
  }, [activeColumnResize, columnWidths, isMainBrowserPath]);

  useEffect(() => {
    if (!activeColumnResize) return;
    const handlePointerMove = (event: PointerEvent) => {
      if (activeScopeRef.current !== activeColumnResize.scopeKey) return;
      const nextWidth =
        activeColumnResize.startWidthPx +
        (event.clientX - activeColumnResize.startX);
      setColumnWidthsState({
        scopeKey: activeColumnResize.scopeKey,
        value: {
          ...columnWidthsRef.current,
          [activeColumnResize.columnId]: clampColumnWidth(
            activeColumnResize.columnId,
            nextWidth,
          ),
        },
      });
    };
    const stopColumnResize = () => setActiveColumnResizeState(null);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopColumnResize);
    document.addEventListener("pointercancel", stopColumnResize);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopColumnResize);
      document.removeEventListener("pointercancel", stopColumnResize);
    };
  }, [activeColumnResize]);

  const startColumnResize = useCallback(
    (columnId: BrowserResizableColumnId) =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setActiveColumnResizeState({
          columnId,
          scopeKey,
          startX: event.clientX,
          startWidthPx: resolveColumnWidthPx(
            columnId,
            columnWidthsRef.current,
          ),
        });
      },
    [scopeKey],
  );
  const resetColumnWidth = useCallback(
    (columnId: BrowserResizableColumnId) => {
      if (activeScopeRef.current !== scopeKey) return;
      const currentWidths = columnWidthsRef.current;
      if (!(columnId in currentWidths)) return;
      const nextWidths = { ...currentWidths };
      delete nextWidths[columnId];
      setColumnWidthsState({ scopeKey, value: nextWidths });
    },
    [scopeKey],
  );
  const toggleVisibleColumn = useCallback(
    (columnId: BrowserColumnId) => {
      if (activeScopeRef.current !== scopeKey) return;
      const selected = new Set(visibleColumnsRef.current);
      if (selected.has(columnId)) {
        selected.delete(columnId);
      } else {
        selected.add(columnId);
      }
      setVisibleColumnsState({
        scopeKey,
        value: normalizeVisibleColumns(Array.from(selected)),
      });
    },
    [scopeKey],
  );
  const resetColumns = useCallback(() => {
    if (activeScopeRef.current !== scopeKey) return;
    setVisibleColumnsState({
      scopeKey,
      value: DEFAULT_VISIBLE_COLUMN_IDS,
    });
    setColumnWidthsState({ scopeKey, value: {} });
  }, [scopeKey]);

  return {
    activeColumnResize,
    columnWidths,
    resetColumnWidth,
    resetColumns,
    startColumnResize,
    toggleVisibleColumn,
    visibleColumns,
  };
}

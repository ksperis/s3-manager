/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type {
  BrowserColumnId,
  BrowserSortKey,
} from "./browserObjectTableModel";

type BrowserSortDirection = "asc" | "desc";

type BrowserSortState = {
  key: BrowserSortKey;
  direction: BrowserSortDirection;
};

type UseBrowserObjectSortOptions = {
  visibleColumns: ReadonlySet<BrowserColumnId>;
};

const DEFAULT_SORT: BrowserSortState = {
  key: "name",
  direction: "asc",
};

export function useBrowserObjectSort({
  visibleColumns,
}: UseBrowserObjectSortOptions) {
  const [sort, setSort] = useState<BrowserSortState>(DEFAULT_SORT);

  useEffect(() => {
    if (sort.key === "name" || visibleColumns.has(sort.key)) return;
    setSort(DEFAULT_SORT);
  }, [sort.key, visibleColumns]);

  const toggleSort = useCallback((key: BrowserSortKey) => {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  return {
    backendSortBy:
      sort.key === "storageClass" ? ("storage_class" as const) : sort.key,
    sortDirection: sort.direction,
    sortId: `${sort.key}-${sort.direction}`,
    sortKey: sort.key,
    toggleSort,
  };
}

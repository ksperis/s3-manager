import type { PointerEventHandler, ReactNode } from "react";

import { ChevronDownIcon } from "./browserIcons";
import {
  COLUMN_RESIZER_HITBOX_WIDTH_PX,
  createLazyColumnCacheEntry,
  type BrowserColumnId,
  type BrowserSortKey,
  type ColumnDefinition,
  type LazyColumnCacheEntry,
  type LazyFieldStatus,
} from "./browserObjectTableModel";
import type { BrowserItem } from "./browserTypes";
import { formatDateTime } from "./browserUtils";

function renderLazyCellValue(
  status: LazyFieldStatus,
  value: string | number | null,
): ReactNode {
  if (status === "idle") {
    return "—";
  }
  if (status === "error") {
    return "Unavailable";
  }
  if (status === "ready") {
    if (typeof value === "number") {
      return value.toLocaleString();
    }
    return value || "—";
  }
  return (
    <span className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500">
      <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300 dark:bg-slate-600" />
      Loading...
    </span>
  );
}

function formatExpiresCellValue(value: string | null): string | null {
  return value ? formatDateTime(value) : null;
}

function formatRestoreStatusCellValue(value: string | null): string | null {
  if (!value) return null;
  const prefixLabel = "Restored until ";
  if (!value.startsWith(prefixLabel)) {
    return value;
  }
  const rawDate = value.slice(prefixLabel.length).trim();
  if (!rawDate) return "Restored";
  return `${prefixLabel}${formatDateTime(rawDate)}`;
}

type BrowserObjectColumnValueProps = {
  item: BrowserItem;
  columnId: BrowserColumnId;
  lazyEntry?: LazyColumnCacheEntry;
};

export function BrowserObjectColumnValue({
  item,
  columnId,
  lazyEntry,
}: BrowserObjectColumnValueProps): ReactNode {
  if (columnId === "type") {
    if (item.type === "folder") {
      return item.isHistorical
        ? "Historical folder"
        : item.isDeleted
          ? "Deleted folder"
          : "Folder";
    }
    return item.isDeleted ? "Deleted object" : "Object";
  }
  if (columnId === "size") {
    return item.size;
  }
  if (columnId === "modified") {
    return item.modified;
  }
  if (columnId === "storageClass") {
    return item.storageClass ?? "—";
  }
  if (columnId === "etag") {
    return item.etag ?? "—";
  }

  if (item.type !== "file" || item.isDeleted) {
    return "—";
  }
  const resolvedLazyEntry = lazyEntry ?? createLazyColumnCacheEntry();
  if (columnId === "contentType") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      resolvedLazyEntry.contentType,
    );
  }
  if (columnId === "tagsCount") {
    return renderLazyCellValue(
      resolvedLazyEntry.tagsStatus,
      resolvedLazyEntry.tagsCount,
    );
  }
  if (columnId === "metadataCount") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      resolvedLazyEntry.metadataCount,
    );
  }
  if (columnId === "cacheControl") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      resolvedLazyEntry.cacheControl,
    );
  }
  if (columnId === "expires") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      formatExpiresCellValue(resolvedLazyEntry.expires),
    );
  }
  if (columnId === "restoreStatus") {
    return renderLazyCellValue(
      resolvedLazyEntry.metadataStatus,
      formatRestoreStatusCellValue(resolvedLazyEntry.restoreStatus),
    );
  }
  return "—";
}

type BrowserObjectColumnHeaderContentProps = {
  column: ColumnDefinition;
  sortKey: BrowserSortKey;
  sortDirection: "asc" | "desc";
  onSort: (sortKey: BrowserSortKey) => void;
};

export function BrowserObjectColumnHeaderContent({
  column,
  sortKey,
  sortDirection,
  onSort,
}: BrowserObjectColumnHeaderContentProps) {
  const sortable = column.sortable;
  if (!sortable) {
    return <span className="inline-flex h-6 items-center">{column.label}</span>;
  }
  const active = sortKey === sortable;
  return (
    <button
      type="button"
      onClick={() => onSort(sortable)}
      className="group inline-flex h-6 items-center gap-1 text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100"
    >
      <span>{column.label}</span>
      <ChevronDownIcon
        className={`h-3 w-3 transition ${active ? "opacity-100" : "opacity-30"} ${
          active && sortDirection === "asc" ? "-rotate-180" : ""
        }`}
      />
    </button>
  );
}

type BrowserColumnResizeHandleProps = {
  label: string;
  active: boolean;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onReset: () => void;
};

export function BrowserColumnResizeHandle({
  label,
  active,
  onPointerDown,
  onReset,
}: BrowserColumnResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      title={`Resize ${label} column`}
      className="absolute inset-y-0 right-0 z-10 translate-x-1/2 cursor-col-resize touch-none select-none"
      style={{ width: `${COLUMN_RESIZER_HITBOX_WIDTH_PX}px` }}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        className={`mx-auto h-full w-0.5 rounded-full bg-slate-200 transition dark:bg-slate-700 ${
          active
            ? "bg-primary dark:bg-primary-300"
            : "hover:bg-slate-300 dark:hover:bg-slate-500"
        }`}
      />
    </div>
  );
}

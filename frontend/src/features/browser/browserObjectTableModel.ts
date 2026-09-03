/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  BrowserActionId,
} from "./browserActions";
import type { BrowserObject } from "../../api/browserContracts";
import { formatBytes } from "../../utils/format";
import {
  readBrowserEmbeddedObjectColumns,
  readBrowserEmbeddedObjectColumnWidths,
  writeBrowserEmbeddedObjectColumns,
  writeBrowserEmbeddedObjectColumnWidths,
} from "./browserEmbeddedColumnsState";
import { clampBrowserPanelWidth } from "./browserPanelLayout";
import {
  readBrowserRootObjectColumns,
  readBrowserRootObjectColumnWidths,
  writeBrowserRootObjectColumns,
  writeBrowserRootObjectColumnWidths,
} from "./browserRootUiState";
import type { BrowserItem } from "./browserTypes";
import {
  formatDateTime,
  normalizeEtag,
  shortName,
} from "./browserUtils";

export type BrowserColumnId =
  | "type"
  | "size"
  | "modified"
  | "storageClass"
  | "etag"
  | "contentType"
  | "tagsCount"
  | "metadataCount"
  | "cacheControl"
  | "expires"
  | "restoreStatus";

export type BrowserSortKey =
  | "name"
  | "size"
  | "modified"
  | "storageClass"
  | "etag";

type ColumnLazySource = "metadata" | "tags";

export type BrowserResizableColumnId = "name" | BrowserColumnId;

export type ColumnDefinition = {
  id: BrowserColumnId;
  label: string;
  defaultVisible: boolean;
  sortable?: BrowserSortKey;
  lazySource?: ColumnLazySource;
  defaultWidthPx: number;
  minWidthPx: number;
  maxWidthPx: number;
  align?: "left" | "right";
};

type ResizableColumnDefinition = {
  id: BrowserResizableColumnId;
  label: string;
  defaultWidthPx: number;
  minWidthPx: number;
  maxWidthPx: number;
};

export type BrowserObjectColumnWidths = Partial<
  Record<BrowserResizableColumnId, number>
>;

export type LazyFieldStatus = "idle" | "loading" | "ready" | "error";

export type LazyColumnCacheEntry = {
  contentType: string | null;
  tagsCount: number | null;
  metadataCount: number | null;
  cacheControl: string | null;
  expires: string | null;
  restoreStatus: string | null;
  metadataStatus: LazyFieldStatus;
  tagsStatus: LazyFieldStatus;
};

const NAME_COLUMN_DEFINITION: ResizableColumnDefinition = {
  id: "name",
  label: "Name",
  defaultWidthPx: 320,
  minWidthPx: 220,
  maxWidthPx: 640,
};

export const SELECTION_COLUMN_WIDTH_PX = 36;
export const MIN_ACTIONS_COLUMN_WIDTH_PX = 108;
export const COMFORTABLE_ROW_ACTION_TARGET_SIZE_PX = 44;
export const COMPACT_ROW_ACTION_TARGET_SIZE_PX = 24;
export const ROW_ACTION_GAP_PX = 4;
export const ROW_ACTION_CELL_HORIZONTAL_PADDING_PX = 16;
export const DIRECT_ITEM_ACTION_IDS: readonly BrowserActionId[] = [
  "download",
  "delete",
];
export const DIRECT_PORTAL_ITEM_ACTION_IDS: readonly BrowserActionId[] = [
  "download",
  "createPublicLink",
  "delete",
];
export const DIRECT_DELETED_ITEM_ACTION_IDS: readonly BrowserActionId[] = [
  "restore",
];
export const COLUMN_RESIZER_HITBOX_WIDTH_PX = 12;

export const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  {
    id: "type",
    label: "Type",
    defaultVisible: false,
    defaultWidthPx: 112,
    minWidthPx: 96,
    maxWidthPx: 240,
  },
  {
    id: "size",
    label: "Size",
    defaultVisible: true,
    sortable: "size",
    defaultWidthPx: 80,
    minWidthPx: 72,
    maxWidthPx: 180,
    align: "right",
  },
  {
    id: "modified",
    label: "Modified",
    defaultVisible: true,
    sortable: "modified",
    defaultWidthPx: 160,
    minWidthPx: 132,
    maxWidthPx: 260,
  },
  {
    id: "storageClass",
    label: "Storage class",
    defaultVisible: false,
    sortable: "storageClass",
    defaultWidthPx: 160,
    minWidthPx: 120,
    maxWidthPx: 260,
  },
  {
    id: "etag",
    label: "ETag",
    defaultVisible: false,
    sortable: "etag",
    defaultWidthPx: 192,
    minWidthPx: 140,
    maxWidthPx: 320,
  },
  {
    id: "contentType",
    label: "Content-Type",
    defaultVisible: false,
    lazySource: "metadata",
    defaultWidthPx: 176,
    minWidthPx: 140,
    maxWidthPx: 320,
  },
  {
    id: "tagsCount",
    label: "Tags",
    defaultVisible: false,
    lazySource: "tags",
    defaultWidthPx: 80,
    minWidthPx: 72,
    maxWidthPx: 140,
    align: "right",
  },
  {
    id: "metadataCount",
    label: "Metadata",
    defaultVisible: false,
    lazySource: "metadata",
    defaultWidthPx: 96,
    minWidthPx: 84,
    maxWidthPx: 160,
    align: "right",
  },
  {
    id: "cacheControl",
    label: "Cache-Control",
    defaultVisible: false,
    lazySource: "metadata",
    defaultWidthPx: 176,
    minWidthPx: 140,
    maxWidthPx: 320,
  },
  {
    id: "expires",
    label: "Expires",
    defaultVisible: false,
    lazySource: "metadata",
    defaultWidthPx: 176,
    minWidthPx: 140,
    maxWidthPx: 320,
  },
  {
    id: "restoreStatus",
    label: "Restore status",
    defaultVisible: false,
    lazySource: "metadata",
    defaultWidthPx: 176,
    minWidthPx: 140,
    maxWidthPx: 320,
  },
];

const COLUMN_IDS_IN_ORDER = COLUMN_DEFINITIONS.map(
  (definition) => definition.id,
);
const RESIZABLE_COLUMN_IDS_IN_ORDER: BrowserResizableColumnId[] = [
  NAME_COLUMN_DEFINITION.id,
  ...COLUMN_IDS_IN_ORDER,
];
const RESIZABLE_COLUMN_DEFINITIONS = [
  NAME_COLUMN_DEFINITION,
  ...COLUMN_DEFINITIONS,
] as const;
const RESIZABLE_COLUMN_DEFINITIONS_BY_ID =
  RESIZABLE_COLUMN_DEFINITIONS.reduce<
    Record<BrowserResizableColumnId, ResizableColumnDefinition>
  >((acc, definition) => {
    acc[definition.id] = definition;
    return acc;
  }, {} as Record<BrowserResizableColumnId, ResizableColumnDefinition>);

export const DEFAULT_VISIBLE_COLUMN_IDS = COLUMN_DEFINITIONS.filter(
  (definition) => definition.defaultVisible,
).map((definition) => definition.id);

export const normalizeVisibleColumns = (
  columnIds: readonly string[],
): BrowserColumnId[] => {
  const selected = new Set(columnIds);
  return COLUMN_IDS_IN_ORDER.filter((columnId) => selected.has(columnId));
};

const isResizableColumnId = (
  value: string,
): value is BrowserResizableColumnId =>
  RESIZABLE_COLUMN_IDS_IN_ORDER.includes(value as BrowserResizableColumnId);

export const clampColumnWidth = (
  columnId: BrowserResizableColumnId,
  widthPx: number,
) => {
  const definition = RESIZABLE_COLUMN_DEFINITIONS_BY_ID[columnId];
  return clampBrowserPanelWidth(
    widthPx,
    definition.minWidthPx,
    definition.maxWidthPx,
  );
};

const normalizeColumnWidths = (
  widths: Record<string, number>,
): BrowserObjectColumnWidths =>
  Object.entries(widths).reduce<BrowserObjectColumnWidths>(
    (acc, [columnId, widthPx]) => {
      if (
        !isResizableColumnId(columnId) ||
        typeof widthPx !== "number" ||
        !Number.isFinite(widthPx)
      ) {
        return acc;
      }
      acc[columnId] = clampColumnWidth(columnId, widthPx);
      return acc;
    },
    {},
  );

export const resolveColumnWidthPx = (
  columnId: BrowserResizableColumnId,
  widths: BrowserObjectColumnWidths,
) =>
  widths[columnId] ??
  RESIZABLE_COLUMN_DEFINITIONS_BY_ID[columnId].defaultWidthPx;

export const loadVisibleColumnsForSurface = (
  isMainBrowserPath: boolean,
): BrowserColumnId[] => {
  const stored = isMainBrowserPath
    ? readBrowserRootObjectColumns()
    : readBrowserEmbeddedObjectColumns();
  if (!stored.length) {
    return DEFAULT_VISIBLE_COLUMN_IDS;
  }
  const normalized = normalizeVisibleColumns(stored);
  return normalized.length > 0 ? normalized : DEFAULT_VISIBLE_COLUMN_IDS;
};

export const persistVisibleColumnsForSurface = (
  isMainBrowserPath: boolean,
  columns: BrowserColumnId[],
) => {
  if (isMainBrowserPath) {
    writeBrowserRootObjectColumns(columns);
    return;
  }
  writeBrowserEmbeddedObjectColumns(columns);
};

export const loadColumnWidthsForSurface = (
  isMainBrowserPath: boolean,
): BrowserObjectColumnWidths => {
  const stored = isMainBrowserPath
    ? readBrowserRootObjectColumnWidths()
    : readBrowserEmbeddedObjectColumnWidths();
  return normalizeColumnWidths(stored);
};

export const persistColumnWidthsForSurface = (
  isMainBrowserPath: boolean,
  widths: BrowserObjectColumnWidths,
) => {
  const normalized = normalizeColumnWidths(widths);
  if (isMainBrowserPath) {
    writeBrowserRootObjectColumnWidths(normalized);
    return;
  }
  writeBrowserEmbeddedObjectColumnWidths(normalized);
};

export const createLazyColumnCacheEntry = (): LazyColumnCacheEntry => ({
  contentType: null,
  tagsCount: null,
  metadataCount: null,
  cacheControl: null,
  expires: null,
  restoreStatus: null,
  metadataStatus: "idle",
  tagsStatus: "idle",
});

export const buildBrowserItems = (
  prefixes: string[],
  deletedPrefixes: string[],
  objects: BrowserObject[],
  deletedObjects: BrowserObject[],
  displayPrefix: string,
): BrowserItem[] => {
  const activePrefixes = new Set(prefixes);
  const combinedPrefixes = [
    ...prefixes,
    ...deletedPrefixes.filter((prefix) => !activePrefixes.has(prefix)),
  ];
  const folderItems = combinedPrefixes.map((prefix) => {
    const rawName = shortName(prefix, displayPrefix);
    const deleted = !activePrefixes.has(prefix);
    return {
      id: deleted ? `${prefix}::deleted-prefix` : prefix,
      key: prefix,
      name: (rawName.endsWith("/") ? rawName.slice(0, -1) : rawName) || prefix,
      type: "folder",
      isDeleted: deleted,
      isHistorical: deleted,
      size: "-",
      sizeBytes: null,
      modified: "-",
      modifiedAt: null,
      owner: "-",
    } satisfies BrowserItem;
  });
  const objectItems = objects.map((object) => ({
    id: object.key,
    key: object.key,
    name: shortName(object.key, displayPrefix),
    type: "file" as const,
    size: formatBytes(object.size),
    sizeBytes: object.size,
    modified: formatDateTime(object.last_modified),
    modifiedAt: object.last_modified ? new Date(object.last_modified).getTime() : null,
    owner: "-",
    storageClass: object.storage_class ?? undefined,
    etag: normalizeEtag(object.etag ?? undefined) ?? null,
  } satisfies BrowserItem));
  const deletedItems = deletedObjects.map((object) => ({
    id: `${object.key}::deleted::${object.version_id ?? "null"}`,
    key: object.key,
    name: shortName(object.key, displayPrefix),
    type: "file" as const,
    isDeleted: true,
    deleteMarkerVersionId: object.version_id ?? null,
    size: "-",
    sizeBytes: null,
    modified: formatDateTime(object.last_modified),
    modifiedAt: object.last_modified ? new Date(object.last_modified).getTime() : null,
    owner: "-",
  } satisfies BrowserItem));
  return [...folderItems, ...objectItems, ...deletedItems];
};

type BrowserPathStats = {
  totalBytes: number;
  files: number;
  deletedFiles: number;
  folders: number;
  deletedFolders: number;
  storageCounts: Record<string, number>;
};

export const buildBrowserPathStats = (items: BrowserItem[]): BrowserPathStats =>
  items.reduce<BrowserPathStats>(
    (stats, item) => {
      if (item.type === "folder") {
        stats.folders += 1;
        if (item.isDeleted) stats.deletedFolders += 1;
      } else if (item.isDeleted) {
        stats.deletedFiles += 1;
      } else {
        stats.files += 1;
        stats.totalBytes += item.sizeBytes ?? 0;
        const storageClass = item.storageClass ?? "STANDARD";
        stats.storageCounts[storageClass] =
          (stats.storageCounts[storageClass] ?? 0) + 1;
      }
      return stats;
    },
    {
      totalBytes: 0,
      files: 0,
      deletedFiles: 0,
      folders: 0,
      deletedFolders: 0,
      storageCounts: {},
    },
  );

export const collectAvailableStorageClasses = (items: BrowserItem[]) =>
  Array.from(
    new Set(
      items.flatMap((item) =>
        item.storageClass ? [item.storageClass] : [],
      ),
    ),
  );

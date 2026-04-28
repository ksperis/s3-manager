/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  unstable_usePrompt,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import JSZip from "jszip";
import { ZipWriter } from "@zip.js/zip.js";
import axios from "axios";
import Modal from "../../components/Modal";
import TableEmptyState from "../../components/TableEmptyState";
import {
  toolbarCompactInputClasses,
  toolbarCompactSelectClasses,
} from "../../components/toolbarControlClasses";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import UiBadge from "../../components/ui/UiBadge";
import {
  cx,
  uiCardClass,
  uiCardMutedClass,
  uiCheckboxClass,
} from "../../components/ui/styles";
import { formatBytes } from "../../utils/format";
import { extractApiError } from "../../utils/apiError";
import {
  S3_BUCKET_NAME_MAX_LENGTH,
  isValidS3BucketName,
  normalizeS3BucketName,
  normalizeS3BucketNameInput,
} from "../../utils/s3BucketName";
import {
  withS3AccountParam,
  type S3AccountSelector,
} from "../../api/accountParams";
import {
  getBucketLogging,
  getBucketPolicy,
  getBucketProperties,
  getBucketStats,
  getBucketWebsite,
} from "../../api/buckets";
import {
  BrowserBucket,
  BrowserObject,
  BrowserObjectVersion,
  BrowserSettings,
  BucketCorsStatus,
  MultipartUploadItem,
  PresignPartRequest,
  PresignRequest,
  StsCredentials,
  StsStatus,
  buildSseCustomerBackendHeaders,
  copyObject,
  cleanupObjectVersions,
  createFolder,
  deleteObjects,
  getBucketVersioning,
  fetchBrowserObjectColumns,
  fetchObjectMetadata,
  getBucketCorsStatus,
  ensureBucketCors,
  getStsCredentials,
  getStsStatus,
  initiateMultipartUpload,
  listBrowserObjects,
  listMultipartUploads,
  listObjectVersions,
  searchBrowserBuckets,
  updateObjectAcl,
  updateObjectLegalHold,
  updateObjectMetadata,
  updateObjectRetention,
  updateObjectTags,
  fetchBrowserSettings,
  presignPart,
  presignObject,
  proxyDownload,
  proxyUpload,
  completeMultipartUpload,
  createBrowserBucket,
  abortMultipartUpload,
} from "../../api/browser";
import { useBrowserContext } from "./BrowserContext";
import BrowserBulkAttributesModal from "./BrowserBulkAttributesModal";
import BrowserBucketsPanel from "./BrowserBucketsPanel";
import BrowserBulkRestoreModal from "./BrowserBulkRestoreModal";
import BrowserCleanupModal from "./BrowserCleanupModal";
import {
  type BrowserActionState,
  getVisibleBrowserActions,
  INSPECTOR_CONTEXT_ACTION_IDS,
  INSPECTOR_SELECTION_ACTION_IDS,
  INSPECTOR_SELECTION_BULK_ACTION_IDS,
  resolveBrowserActions,
  TOOLBAR_MORE_PATH_ACTION_IDS,
  TOOLBAR_MORE_SELECTION_FULL_ACTION_IDS,
  TOOLBAR_MORE_SELECTION_OVERFLOW_ACTION_IDS,
} from "./browserActions";
import {
  BrowserConfirmModal,
  BrowserCopyValueModal,
} from "./BrowserDialogModals";
import BrowserContextMenu from "./BrowserContextMenu";
import BrowserObjectDetailsModal from "./BrowserObjectDetailsModal";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";
import BrowserOperationsModal from "./BrowserOperationsModal";
import BrowserMultipartUploadsModal from "./BrowserMultipartUploadsModal";
import BrowserPrefixVersionsModal from "./BrowserPrefixVersionsModal";
import {
  transferClipboardObjectBetweenContexts,
  type ClipboardTransferMode,
} from "./browserClipboardTransfer";
import {
  DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
  MAX_FOLDERS_PANEL_WIDTH_PX,
  MAX_INSPECTOR_PANEL_WIDTH_PX,
  MIN_FOLDERS_PANEL_WIDTH_PX,
  MIN_INSPECTOR_PANEL_WIDTH_PX,
  readBrowserRootObjectColumns,
  readBrowserRootObjectColumnWidths,
  readBrowserRootContextSelection,
  readStoredBrowserRootUiState,
  writeBrowserRootContextSelection,
  writeBrowserRootObjectColumns,
  writeBrowserRootObjectColumnWidths,
  writeBrowserRootUiLayout,
  writeBrowserRootUiPanelWidths,
} from "./browserRootUiState";
import {
  readBrowserEmbeddedObjectColumns,
  readBrowserEmbeddedObjectColumnWidths,
  writeBrowserEmbeddedObjectColumns,
  writeBrowserEmbeddedObjectColumnWidths,
} from "./browserEmbeddedColumnsState";
import BucketDetailPage from "../manager/BucketDetailPage";
import { S3AccountProvider } from "../manager/S3AccountContext";
import { presignObjectWithSts, presignPartWithSts } from "./stsPresigner";
import {
  resolveSimpleUploadOperation,
  shouldUseStsPresigner,
} from "./sseBrowserLogic";
import {
  activateSseCustomerKeyForScope,
  copySseCustomerKeyWithFallback,
  generateAndActivateSseCustomerKeyForScope,
  resolveSseCustomerKeyInputType,
} from "./sseCustomerKeyActions";
import { resolveBrowserPanelVisibility } from "./browserResponsivePanels";
import {
  BucketIcon,
  ChevronDownIcon,
  CopyIcon,
  CutIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  HistoryIcon,
  InfoIcon,
  ListIcon,
  LinkIcon,
  MoreIcon,
  OpenIcon,
  PasteIcon,
  RefreshIcon,
  SettingsIcon,
  SlidersIcon,
  SearchIcon,
  TrashIcon,
  UpIcon,
  UploadIcon,
} from "./browserIcons";
import {
  BUCKET_MENU_LIMIT,
  COMPLETED_OPERATIONS_LIMIT,
  DEFAULT_DIRECT_DOWNLOAD_PARALLELISM,
  DEFAULT_DIRECT_UPLOAD_PARALLELISM,
  DEFAULT_OTHER_OPERATIONS_PARALLELISM,
  DEFAULT_PROXY_DOWNLOAD_PARALLELISM,
  DEFAULT_PROXY_UPLOAD_PARALLELISM,
  DEFAULT_QUEUED_VISIBLE_COUNT,
  MULTIPART_CONCURRENCY,
  MULTIPART_UPLOADS_HARD_LIMIT,
  MULTIPART_UPLOADS_PAGE_SIZE,
  MULTIPART_THRESHOLD,
  OBJECTS_LIST_HARD_LIMIT,
  OBJECTS_PAGE_SIZE,
  PART_SIZE,
  TREE_PREFIXES_HARD_LIMIT,
  TREE_PREFIXES_PAGE_SIZE,
  VERSIONS_LIST_HARD_LIMIT,
  VERSIONS_PAGE_SIZE,
  bucketButtonClasses,
  bulkActionClasses,
  bulkDangerClasses,
  breadcrumbIconButtonClasses,
  countBadgeClasses,
  contextMenuItemClasses,
  contextMenuItemDisabledClasses,
  contextMenuSeparatorClasses,
  filterChipClasses,
  iconButtonClasses,
  iconButtonDangerClasses,
  storageClassChipClasses,
  storageClassOptions,
  toolbarButtonClasses,
  toolbarIconButtonClasses,
  toolbarPrimaryClasses,
} from "./browserConstants";
import {
  buildTreeNodes,
  buildUploadCandidates,
  buildUploadGrouping,
  buildVersionRows,
  chunkItems,
  clampParallelism,
  collectDroppedFiles,
  findTreeNodeByPrefix,
  formatBadgeCount,
  formatDateTime,
  formatLocalDateTime,
  getSelectionInfo,
  isAbortError,
  isLikelyCorsError,
  isImageFile,
  makeId,
  normalizeEtag,
  normalizePrefix,
  normalizeUploadPath,
  parseKeyValueLines,
  pairsToRecord,
  previewLabelForItem,
  shortName,
  toIsoString,
  updateTreeNodes,
} from "./browserUtils";
import {
  BROWSER_QUERY_DEBOUNCE_MS,
  isStaleRequest,
  mergeBucketSearchItems,
  prepareLatestRequest,
} from "./browserSearchHelpers";
import {
  normalizeBrowserListingIssue,
  resolveBucketAccessEntry,
  sanitizeBucketAccessEntries,
  splitBucketPanelBuckets,
  UNKNOWN_BUCKET_ACCESS,
  type BrowserListingIssue,
  type BucketAccessEntry,
} from "./browserBucketsPanelHelpers";
import type {
  BrowserItem,
  BulkMetadataDraft,
  ClipboardState,
  CompletedOperationItem,
  ContextMenuState,
  CopyDetailItem,
  CopyDetailStatus,
  DeleteDetailItem,
  DeleteDetailStatus,
  DownloadDetailItem,
  DownloadDetailStatus,
  ObjectDetailsTabId,
  OperationCompletionStatus,
  OperationItem,
  SelectionStats,
  TreeNode,
  UploadCandidate,
  UploadQueueItem,
} from "./browserTypes";

type BrowserPageProps = {
  accountIdForApi?: S3AccountSelector;
  hasContext?: boolean;
  storageEndpointCapabilities?: Record<string, boolean> | null;
  contextEndpointProvider?: "ceph" | "aws" | "other" | null;
  contextQuotaMaxSizeGb?: number | null;
  contextQuotaMaxObjects?: number | null;
  allowFoldersPanel?: boolean;
  allowInspectorPanel?: boolean;
  showPanelToggles?: boolean;
  defaultShowFolders?: boolean;
  defaultShowInspector?: boolean;
};

type ObjectDetailsTarget = {
  item: BrowserItem;
  initialTab: ObjectDetailsTabId;
};

type ToolbarToggleMenuItemProps = {
  label: string;
  icon: ReactNode;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

function ToolbarToggleMenuItem({
  label,
  icon,
  checked,
  onToggle,
  disabled = false,
}: ToolbarToggleMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={`${contextMenuItemClasses} ${disabled ? contextMenuItemDisabledClasses : ""}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      <span
        aria-hidden="true"
        className={`relative ml-auto inline-flex h-5 w-9 shrink-0 rounded-full transition ${
          checked ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-700"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}

type OperationDetailsKind = "download" | "delete" | "copy" | "upload" | "other";
type BucketInspectorTone = "active" | "inactive" | "unknown";
type BucketInspectorFeature = {
  state: string;
  tone: BucketInspectorTone;
};
type BucketInspectorData = {
  creation_date?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  features: Record<string, BucketInspectorFeature>;
};
type PathSuggestionSource = "local" | "remote" | "history";
type PathSuggestion = {
  value: string;
  label: string;
  source: PathSuggestionSource;
};
type PathDraftContext = {
  parentPrefix: string;
  fragment: string;
};
type SearchScope = "prefix" | "bucket";
type BrowserConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<void> | void;
};
type BrowserCopyDialogState = {
  title: string;
  label: string;
  value: string;
  successMessage?: string;
};
type BrowserColumnId =
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
type BrowserSortKey = "name" | "size" | "modified" | "storageClass" | "etag";
type ColumnLazySource = "metadata" | "tags";
type BrowserResizableColumnId = "name" | BrowserColumnId;
type ColumnDefinition = {
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
type BrowserObjectColumnWidths = Partial<
  Record<BrowserResizableColumnId, number>
>;
type LazyFieldStatus = "idle" | "loading" | "ready" | "error";
type LazyColumnCacheEntry = {
  contentType: string | null;
  tagsCount: number | null;
  metadataCount: number | null;
  cacheControl: string | null;
  expires: string | null;
  restoreStatus: string | null;
  metadataStatus: LazyFieldStatus;
  tagsStatus: LazyFieldStatus;
};

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
const DEFAULT_STREAMING_ZIP_THRESHOLD_MB = 200;
const BYTES_PER_GIB = 1024 * 1024 * 1024;
const PATH_SUGGESTIONS_DEBOUNCE_MS = 200;
const PATH_SUGGESTIONS_LIMIT = 20;
const PATH_SUGGESTIONS_API_LIMIT = 50;
const PATH_HISTORY_LIMIT = 20;
const PATH_HISTORY_STORAGE_KEY = "browser:path-history:v1";
const PANELS_DISABLE_MAX_WIDTH_PX = 1023;
const PANELS_DISABLE_MEDIA_QUERY = `(max-width: ${PANELS_DISABLE_MAX_WIDTH_PX}px)`;
const PANEL_LAYOUT_GAP_PX = 12;
const PANEL_RESIZER_HITBOX_WIDTH_PX = 12;
const MIN_BROWSER_CENTER_WIDTH_PX = 320;
const CONTEXT_MENU_PADDING_PX = 8;
const CONTEXT_MENU_FALLBACK_WIDTH_PX = 240;
const CONTEXT_MENU_FALLBACK_HEIGHT_PX = 320;
const CORS_DIRECT_TRANSFER_WARNING =
  "Direct download/upload is not allowed on this bucket.";
const TREE_PREFIXES_PAGE_BUDGET = 50;
const PATH_SUGGESTION_SOURCE_WEIGHT: Record<PathSuggestionSource, number> = {
  history: 300,
  local: 200,
  remote: 100,
};
const BUCKET_ACCESS_PROBE_CONCURRENCY = 4;
const BUCKET_ACCESS_ROOT_MARGIN = "120px";

const clampBrowserPanelWidth = (
  value: number,
  min: number,
  max: number,
) => Math.min(max, Math.max(min, Math.round(value)));

const resolveBrowserPanelWidths = ({
  containerWidth,
  foldersPanelWidthPx,
  inspectorPanelWidthPx,
  isFoldersPanelVisible,
  isInspectorPanelVisible,
}: {
  containerWidth: number;
  foldersPanelWidthPx: number;
  inspectorPanelWidthPx: number;
  isFoldersPanelVisible: boolean;
  isInspectorPanelVisible: boolean;
}) => {
  let resolvedFoldersWidth = clampBrowserPanelWidth(
    foldersPanelWidthPx,
    MIN_FOLDERS_PANEL_WIDTH_PX,
    MAX_FOLDERS_PANEL_WIDTH_PX,
  );
  let resolvedInspectorWidth = clampBrowserPanelWidth(
    inspectorPanelWidthPx,
    MIN_INSPECTOR_PANEL_WIDTH_PX,
    MAX_INSPECTOR_PANEL_WIDTH_PX,
  );
  if (containerWidth <= 0) {
    return { resolvedFoldersWidth, resolvedInspectorWidth };
  }

  const gapCount =
    (isFoldersPanelVisible ? 1 : 0) + (isInspectorPanelVisible ? 1 : 0);
  const occupiedGapWidth = gapCount * PANEL_LAYOUT_GAP_PX;

  if (isInspectorPanelVisible) {
    const maxInspectorWidth = isFoldersPanelVisible
      ? containerWidth -
        resolvedFoldersWidth -
        occupiedGapWidth -
        MIN_BROWSER_CENTER_WIDTH_PX
      : containerWidth - occupiedGapWidth - MIN_BROWSER_CENTER_WIDTH_PX;
    resolvedInspectorWidth = clampBrowserPanelWidth(
      resolvedInspectorWidth,
      MIN_INSPECTOR_PANEL_WIDTH_PX,
      Math.max(MIN_INSPECTOR_PANEL_WIDTH_PX, maxInspectorWidth),
    );
  }

  if (isFoldersPanelVisible) {
    const maxFoldersWidth = isInspectorPanelVisible
      ? containerWidth -
        resolvedInspectorWidth -
        occupiedGapWidth -
        MIN_BROWSER_CENTER_WIDTH_PX
      : containerWidth - occupiedGapWidth - MIN_BROWSER_CENTER_WIDTH_PX;
    resolvedFoldersWidth = clampBrowserPanelWidth(
      resolvedFoldersWidth,
      MIN_FOLDERS_PANEL_WIDTH_PX,
      Math.max(MIN_FOLDERS_PANEL_WIDTH_PX, maxFoldersWidth),
    );
  }

  return { resolvedFoldersWidth, resolvedInspectorWidth };
};
const LAZY_COLUMN_CONCURRENCY = 4;
const LAZY_COLUMN_BATCH_SIZE = 24;
const LAZY_COLUMN_ROOT_MARGIN = "200px";
const NAME_COLUMN_DEFINITION: ResizableColumnDefinition = {
  id: "name",
  label: "Name",
  defaultWidthPx: 320,
  minWidthPx: 220,
  maxWidthPx: 640,
};
const SELECTION_COLUMN_WIDTH_PX = 36;
const ACTIONS_COLUMN_WIDTH_PX = 176;
const COLUMN_RESIZER_HITBOX_WIDTH_PX = 12;
const COLUMN_DEFINITIONS: ColumnDefinition[] = [
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
const RESIZABLE_COLUMN_DEFINITIONS_BY_ID = RESIZABLE_COLUMN_DEFINITIONS.reduce<
  Record<BrowserResizableColumnId, ResizableColumnDefinition>
>((acc, definition) => {
  acc[definition.id] = definition;
  return acc;
}, {} as Record<BrowserResizableColumnId, ResizableColumnDefinition>);
const DEFAULT_VISIBLE_COLUMN_IDS = COLUMN_DEFINITIONS.filter(
  (definition) => definition.defaultVisible,
).map((definition) => definition.id);

const isResizableColumnId = (
  value: string,
): value is BrowserResizableColumnId =>
  RESIZABLE_COLUMN_IDS_IN_ORDER.includes(value as BrowserResizableColumnId);

const clampColumnWidth = (
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
): BrowserObjectColumnWidths => {
  return Object.entries(widths).reduce<BrowserObjectColumnWidths>(
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
};

const resolveColumnWidthPx = (
  columnId: BrowserResizableColumnId,
  widths: BrowserObjectColumnWidths,
) => widths[columnId] ?? RESIZABLE_COLUMN_DEFINITIONS_BY_ID[columnId].defaultWidthPx;

const loadVisibleColumnsForSurface = (isMainBrowserPath: boolean): BrowserColumnId[] => {
  const stored = isMainBrowserPath
    ? readBrowserRootObjectColumns()
    : readBrowserEmbeddedObjectColumns();
  if (!stored.length) {
    return DEFAULT_VISIBLE_COLUMN_IDS;
  }
  const selected = new Set(stored);
  const normalized = COLUMN_IDS_IN_ORDER.filter((columnId) =>
    selected.has(columnId),
  );
  return normalized.length > 0 ? normalized : DEFAULT_VISIBLE_COLUMN_IDS;
};

const persistVisibleColumnsForSurface = (
  isMainBrowserPath: boolean,
  columns: BrowserColumnId[],
) => {
  if (isMainBrowserPath) {
    writeBrowserRootObjectColumns(columns);
    return;
  }
  writeBrowserEmbeddedObjectColumns(columns);
};

const loadColumnWidthsForSurface = (
  isMainBrowserPath: boolean,
): BrowserObjectColumnWidths => {
  const stored = isMainBrowserPath
    ? readBrowserRootObjectColumnWidths()
    : readBrowserEmbeddedObjectColumnWidths();
  return normalizeColumnWidths(stored);
};

const persistColumnWidthsForSurface = (
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

const createLazyColumnCacheEntry = (): LazyColumnCacheEntry => ({
  contentType: null,
  tagsCount: null,
  metadataCount: null,
  cacheControl: null,
  expires: null,
  restoreStatus: null,
  metadataStatus: "idle",
  tagsStatus: "idle",
});

const getDeletedObjectEntryId = (
  value: Pick<BrowserObject, "key" | "version_id">,
) => `${value.key}::${value.version_id ?? "null"}`;

const mergeUniqueStringsWithLimit = (
  base: string[],
  incoming: string[],
  limit: number,
) => {
  if (base.length >= limit || incoming.length === 0) {
    return { items: base.slice(0, limit), limitReached: base.length >= limit };
  }
  const merged = Array.from(new Set([...base, ...incoming]));
  return {
    items: merged.slice(0, limit),
    limitReached: merged.length > limit,
  };
};

const mergeDeletedObjectsWithLimit = (
  base: BrowserObject[],
  incoming: BrowserObject[],
  limit: number,
) => {
  const byId = new Map<string, BrowserObject>();
  base.forEach((item) => byId.set(getDeletedObjectEntryId(item), item));
  incoming.forEach((item) => {
    if (byId.size < limit || byId.has(getDeletedObjectEntryId(item))) {
      byId.set(getDeletedObjectEntryId(item), item);
    }
  });
  const items = Array.from(byId.values());
  return {
    items: items.slice(0, limit),
    limitReached: items.length > limit || byId.size > limit,
  };
};
const BUCKET_INSPECTOR_FEATURE_ORDER = [
  "versioning",
  "object_lock",
  "block_public_access",
  "lifecycle_rules",
  "static_website",
  "quota",
  "bucket_policy",
  "cors",
  "access_logging",
] as const;
const BUCKET_INSPECTOR_FEATURE_LABELS: Record<string, string> = {
  versioning: "Versioning",
  object_lock: "Object Lock",
  block_public_access: "Block public access",
  lifecycle_rules: "Lifecycle rules",
  static_website: "Static website",
  quota: "Quota",
  bucket_policy: "Bucket policy",
  cors: "CORS",
  access_logging: "Access logging",
};
const BUCKET_INSPECTOR_FEATURE_CHIP_CLASSES: Record<
  BucketInspectorTone,
  string
> = {
  active:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100",
  inactive:
    "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100",
  unknown: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};
const browserSectionEyebrowClasses =
  "ui-caption font-semibold text-slate-500 dark:text-slate-400";
const browserShellClasses =
  cx(
    uiCardClass,
    "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-gradient-to-r from-white via-white to-slate-50/80 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/70",
  );
const browserSubtleSurfaceClasses =
  cx(uiCardMutedClass, "rounded-xl shadow-none");
const browserToolbarShellClasses =
  "flex flex-col gap-2 rounded-xl border border-slate-200/90 bg-slate-50/80 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/50 lg:flex-row lg:items-center lg:justify-between";
const browserToolbarPathStripClasses =
  "flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900";
const browserToolbarControlsGroupClasses =
  "flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-1.5 py-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-900";
const browserFloatingMenuClasses =
  "overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900";
const browserInputClasses =
  cx(toolbarCompactInputClasses, "w-full py-2 font-medium");
const browserSearchInputClasses =
  cx(
    toolbarCompactInputClasses,
    "h-8 w-full py-1.5 text-sm font-normal placeholder:text-slate-400 dark:placeholder:text-slate-500",
  );
const browserSelectClasses =
  cx(toolbarCompactSelectClasses, "h-9 w-full");
const browserOptionCardClasses =
  "inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 ui-caption font-medium text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const browserSearchLabelClasses =
  "ui-caption font-medium text-slate-500 dark:text-slate-400";
const browserSearchStatusChipClasses =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50/90 px-2 py-1 ui-caption text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200";
const browserExplorerShellClasses =
  cx(
    uiCardClass,
    "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-gradient-to-b from-white via-white to-slate-50/70 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/65",
  );
const inspectorTabListClasses =
  "flex flex-nowrap gap-1 rounded-xl border border-slate-200 bg-slate-50/80 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900/50";
const inspectorTabBaseClasses =
  "inline-flex min-w-0 flex-1 items-center justify-center rounded-md border px-2.5 py-1.5 text-center ui-caption font-semibold whitespace-nowrap transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const inspectorTabInactiveClasses =
  "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-100";
const inspectorTabActiveClasses =
  "border-slate-200 bg-white text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const inspectorTabPanelClasses =
  "space-y-4 ui-caption text-slate-600 dark:text-slate-300";
const inspectorSectionCardClasses =
  cx(browserSubtleSurfaceClasses, "px-3.5 py-3");
const inspectorSectionTitleClasses =
  "ui-caption font-semibold text-slate-500 dark:text-slate-400";
const inspectorEmptyStateClasses =
  "rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-4 ui-caption text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400";
const inspectorInlineActionClasses =
  "ui-caption font-semibold text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200 dark:disabled:text-slate-500";
const getMultipartUploadEntryId = (
  upload: Pick<MultipartUploadItem, "key" | "upload_id">,
) => `${upload.key}::${upload.upload_id}`;
const normalizePathDraftValue = (value: string) =>
  value.trim().replace(/^\/+/, "");

const resolvePathDraftContext = (value: string): PathDraftContext => {
  const cleaned = normalizePathDraftValue(value);
  const hasTrailingSlash = cleaned.endsWith("/");
  const slashIndex = cleaned.lastIndexOf("/");
  const parentRaw = slashIndex >= 0 ? cleaned.slice(0, slashIndex + 1) : "";
  const fragment = hasTrailingSlash
    ? ""
    : slashIndex >= 0
      ? cleaned.slice(slashIndex + 1)
      : cleaned;
  return {
    parentPrefix: parentRaw ? normalizePrefix(parentRaw) : "",
    fragment,
  };
};

const buildPathSuggestionEntries = (
  prefixes: string[],
  parentPrefix: string,
  fragment: string,
  source: PathSuggestionSource,
): PathSuggestion[] => {
  const normalizedFragment = fragment.trim().toLowerCase();
  const seen = new Set<string>();
  const entries: PathSuggestion[] = [];
  prefixes.forEach((entry) => {
    const normalized = normalizePrefix(normalizePathDraftValue(entry || ""));
    if (!normalized) return;
    if (parentPrefix && !normalized.startsWith(parentPrefix)) return;
    const relative = shortName(normalized, parentPrefix || "");
    const label = relative.endsWith("/") ? relative.slice(0, -1) : relative;
    if (!label) return;
    if (normalizedFragment && !label.toLowerCase().includes(normalizedFragment))
      return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    entries.push({ value: normalized, label, source });
  });
  return entries;
};

const scorePathSuggestion = (
  entry: PathSuggestion,
  fragment: string,
): number => {
  const query = fragment.trim().toLowerCase();
  const label = entry.label.toLowerCase();
  let score = PATH_SUGGESTION_SOURCE_WEIGHT[entry.source] ?? 0;
  if (!query) {
    return score + Math.max(0, 80 - Math.min(label.length, 80));
  }
  if (label === query) {
    score += 1200;
  } else if (label.startsWith(query)) {
    score += 1000;
  } else if (label.split("/").some((segment) => segment.startsWith(query))) {
    score += 800;
  } else if (label.includes(query)) {
    score += 600;
  }
  const index = label.indexOf(query);
  if (index >= 0) {
    score += Math.max(0, 120 - index * 4);
  }
  score += Math.max(0, 60 - Math.min(label.length, 60));
  return score;
};

const mergePathSuggestions = (
  fragment: string,
  ...groups: PathSuggestion[][]
): PathSuggestion[] => {
  const byValue = new Map<string, PathSuggestion>();
  groups.forEach((group) => {
    group.forEach((entry) => {
      const existing = byValue.get(entry.value);
      if (!existing) {
        byValue.set(entry.value, entry);
        return;
      }
      if (
        (PATH_SUGGESTION_SOURCE_WEIGHT[entry.source] ?? 0) >
        (PATH_SUGGESTION_SOURCE_WEIGHT[existing.source] ?? 0)
      ) {
        byValue.set(entry.value, entry);
      }
    });
  });
  return Array.from(byValue.values())
    .sort((a, b) => {
      const scoreDiff =
        scorePathSuggestion(b, fragment) - scorePathSuggestion(a, fragment);
      if (scoreDiff !== 0) return scoreDiff;
      return a.label.localeCompare(b.label);
    })
    .slice(0, PATH_SUGGESTIONS_LIMIT);
};

const readPathHistoryStore = (): Record<string, string[]> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PATH_HISTORY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
};

const readBucketPathHistory = (bucketName: string): string[] => {
  if (!bucketName) return [];
  const store = readPathHistoryStore();
  const rawEntries = Array.isArray(store[bucketName]) ? store[bucketName] : [];
  const seen = new Set<string>();
  const entries: string[] = [];
  rawEntries.forEach((value) => {
    const normalized = normalizePrefix(normalizePathDraftValue(value || ""));
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    entries.push(normalized);
  });
  return entries.slice(0, PATH_HISTORY_LIMIT);
};

const pushBucketPathHistory = (
  bucketName: string,
  prefixValue: string,
): string[] => {
  if (!bucketName || typeof window === "undefined") return [];
  const normalized = normalizePrefix(
    normalizePathDraftValue(prefixValue || ""),
  );
  if (!normalized) return readBucketPathHistory(bucketName);
  const store = readPathHistoryStore();
  const current = readBucketPathHistory(bucketName);
  const next = [
    normalized,
    ...current.filter((entry) => entry !== normalized),
  ].slice(0, PATH_HISTORY_LIMIT);
  store[bucketName] = next;
  try {
    window.localStorage.setItem(
      PATH_HISTORY_STORAGE_KEY,
      JSON.stringify(store),
    );
  } catch {
    // Ignore localStorage write failures (private mode / quota).
  }
  return next;
};

export default function BrowserPage({
  accountIdForApi: accountIdOverride,
  hasContext: hasContextOverride,
  storageEndpointCapabilities,
  contextEndpointProvider,
  contextQuotaMaxSizeGb,
  contextQuotaMaxObjects,
  allowFoldersPanel = true,
  allowInspectorPanel = true,
  showPanelToggles = true,
  defaultShowFolders = false,
  defaultShowInspector = false,
}: BrowserPageProps = {}) {
  const browserContext = useBrowserContext();
  const accountIdForApi = accountIdOverride ?? browserContext.selectorForApi;
  const hasS3AccountContext = hasContextOverride ?? browserContext.hasContext;
  const location = useLocation();
  const normalizedPath = location.pathname.replace(/\/+$/, "");
  const isEmbeddedBrowserPath =
    normalizedPath.endsWith("/manager/browser") ||
    normalizedPath.endsWith("/ceph-admin/browser");
  const isMainBrowserPath = normalizedPath === "/browser";
  const initialStoredRootUiState = useMemo(() => readStoredBrowserRootUiState(), []);
  const initialStoredRootUiLayout = initialStoredRootUiState?.layout ?? null;
  const initialRootUiLayout = isMainBrowserPath ? initialStoredRootUiLayout : null;
  const browserRootContextId =
    accountIdForApi == null ? null : String(accountIdForApi);
  const bucketAccessContextKey =
    accountIdForApi == null ? null : String(accountIdForApi);
  // /browser is credential-first.
  const accessMode = null;
  const [bucketName, setBucketName] = useState("");
  const [showBucketMenu, setShowBucketMenu] = useState(false);
  const [bucketFilter, setBucketFilter] = useState("");
  const [bucketMenuItems, setBucketMenuItems] = useState<BrowserBucket[]>([]);
  const [bucketMenuPage, setBucketMenuPage] = useState(1);
  const [bucketMenuHasNext, setBucketMenuHasNext] = useState(false);
  const [bucketMenuTotal, setBucketMenuTotal] = useState(0);
  const [bucketTotalCount, setBucketTotalCount] = useState(0);
  const [bucketMenuLoadingMore, setBucketMenuLoadingMore] = useState(false);
  const [bucketAccessByName, setBucketAccessByName] = useState<
    Record<string, BucketAccessEntry>
  >({});
  const [searchParams] = useSearchParams();
  const requestedBucket = useMemo(
    () => searchParams.get("bucket")?.trim() ?? "",
    [searchParams],
  );
  const [prefix, setPrefix] = useState("");
  const [objects, setObjects] = useState<BrowserObject[]>([]);
  const [deletedObjects, setDeletedObjects] = useState<BrowserObject[]>([]);
  const [deletedPrefixes, setDeletedPrefixes] = useState<string[]>([]);
  const [deletedObjectsNextKeyMarker, setDeletedObjectsNextKeyMarker] =
    useState<string | null>(null);
  const [
    deletedObjectsNextVersionIdMarker,
    setDeletedObjectsNextVersionIdMarker,
  ] = useState<string | null>(null);
  const [deletedObjectsIsTruncated, setDeletedObjectsIsTruncated] =
    useState(false);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsNextToken, setObjectsNextToken] = useState<string | null>(null);
  const [objectsIsTruncated, setObjectsIsTruncated] = useState(false);
  const [showPrefixVersions, setShowPrefixVersions] = useState(false);
  const [showFolders, setShowFolders] = useState(() =>
    isMainBrowserPath
      ? (initialRootUiLayout?.showFolders ?? defaultShowFolders)
      : defaultShowFolders,
  );
  const [showInspector, setShowInspector] = useState(() =>
    isMainBrowserPath
      ? (initialRootUiLayout?.showInspector ?? defaultShowInspector)
      : defaultShowInspector,
  );
  const [showActionBar, setShowActionBar] = useState(() =>
    isMainBrowserPath ? (initialRootUiLayout?.showActionBar ?? false) : false,
  );
  const [foldersPanelWidthPx, setFoldersPanelWidthPx] = useState(
    () =>
      initialStoredRootUiLayout?.foldersPanelWidthPx ??
      DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  );
  const [inspectorPanelWidthPx, setInspectorPanelWidthPx] = useState(
    () =>
      initialStoredRootUiLayout?.inspectorPanelWidthPx ??
      DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
  );
  const [layoutContainerWidthPx, setLayoutContainerWidthPx] = useState(0);
  const [activePanelResize, setActivePanelResize] = useState<
    "folders" | "inspector" | null
  >(null);
  const [columnWidths, setColumnWidths] = useState<BrowserObjectColumnWidths>(
    () => loadColumnWidthsForSurface(isMainBrowserPath),
  );
  const [activeColumnResize, setActiveColumnResize] = useState<{
    columnId: BrowserResizableColumnId;
    startX: number;
    startWidthPx: number;
  } | null>(null);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(PANELS_DISABLE_MEDIA_QUERY).matches;
  });
  const [inspectorTab, setInspectorTab] = useState<
    "context" | "bucket" | "selection" | "details"
  >("context");
  const [compactMode, setCompactMode] = useState(() =>
    normalizedPath.endsWith("/browser"),
  );
  const [prefixVersions, setPrefixVersions] = useState<BrowserObjectVersion[]>(
    [],
  );
  const [prefixDeleteMarkers, setPrefixDeleteMarkers] = useState<
    BrowserObjectVersion[]
  >([]);
  const [prefixVersionsLoading, setPrefixVersionsLoading] = useState(false);
  const [prefixVersionsError, setPrefixVersionsError] = useState<string | null>(
    null,
  );
  const [prefixVersionKeyMarker, setPrefixVersionKeyMarker] = useState<
    string | null
  >(null);
  const [prefixVersionIdMarker, setPrefixVersionIdMarker] = useState<
    string | null
  >(null);
  const [objectVersions, setObjectVersions] = useState<BrowserObjectVersion[]>(
    [],
  );
  const [objectDeleteMarkers, setObjectDeleteMarkers] = useState<
    BrowserObjectVersion[]
  >([]);
  const [objectVersionsLoading, setObjectVersionsLoading] = useState(false);
  const [objectVersionsError, setObjectVersionsError] = useState<string | null>(
    null,
  );
  const [objectVersionKeyMarker, setObjectVersionKeyMarker] = useState<
    string | null
  >(null);
  const [objectVersionIdMarker, setObjectVersionIdMarker] = useState<
    string | null
  >(null);
  const [objectVersionsTargetKey, setObjectVersionsTargetKey] = useState<
    string | null
  >(null);
  const [bucketVersioningEnabled, setBucketVersioningEnabled] = useState(false);
  const [showMultipartUploadsModal, setShowMultipartUploadsModal] =
    useState(false);
  const [multipartUploads, setMultipartUploads] = useState<
    MultipartUploadItem[]
  >([]);
  const [multipartUploadsLoading, setMultipartUploadsLoading] = useState(false);
  const [multipartUploadsLoadingMore, setMultipartUploadsLoadingMore] =
    useState(false);
  const [multipartUploadsError, setMultipartUploadsError] = useState<
    string | null
  >(null);
  const [multipartUploadsNextKey, setMultipartUploadsNextKey] = useState<
    string | null
  >(null);
  const [multipartUploadsNextUploadId, setMultipartUploadsNextUploadId] =
    useState<string | null>(null);
  const [multipartUploadsIsTruncated, setMultipartUploadsIsTruncated] =
    useState(false);
  const [abortingMultipartUploadIds, setAbortingMultipartUploadIds] = useState<
    Set<string>
  >(new Set());
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsLoadingMore, setObjectsLoadingMore] = useState(false);
  const [objectsIssue, setObjectsIssue] = useState<BrowserListingIssue | null>(
    null,
  );
  const [showObjectsIssueTechnicalDetails, setShowObjectsIssueTechnicalDetails] =
    useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [browserSettings, setBrowserSettings] =
    useState<BrowserSettings | null>(null);
  const [corsStatus, setCorsStatus] = useState<BucketCorsStatus | null>(null);
  const [stsStatus, setStsStatus] = useState<StsStatus | null>(null);
  const [stsCredentials, setStsCredentials] = useState<StsCredentials | null>(
    null,
  );
  const [stsCredentialsError, setStsCredentialsError] = useState<string | null>(
    null,
  );
  const [sseCustomerKeysByScope, setSseCustomerKeysByScope] = useState<
    Record<string, string>
  >({});
  const [showSseCustomerModal, setShowSseCustomerModal] = useState(false);
  const [sseCustomerKeyInput, setSseCustomerKeyInput] = useState("");
  const [sseCustomerKeyError, setSseCustomerKeyError] = useState<string | null>(
    null,
  );
  const [sseCustomerKeyNotice, setSseCustomerKeyNotice] = useState<
    string | null
  >(null);
  const [sseCustomerKeyVisible, setSseCustomerKeyVisible] = useState(false);
  const [useProxyTransfers, setUseProxyTransfers] = useState(false);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [corsFixing, setCorsFixing] = useState(false);
  const [corsFixError, setCorsFixError] = useState<string | null>(null);
  const [showCorsActionPopover, setShowCorsActionPopover] = useState(false);
  const [filter, setFilter] = useState("");
  const [showSearchOptionsMenu, setShowSearchOptionsMenu] = useState(false);
  const [showToolbarMoreMenu, setShowToolbarMoreMenu] = useState(false);
  const [showToolbarColumnsMenu, setShowToolbarColumnsMenu] = useState(false);
  const [showUploadQuickMenu, setShowUploadQuickMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<BrowserColumnId[]>(
    () => loadVisibleColumnsForSurface(isMainBrowserPath),
  );
  const [lazyColumnCache, setLazyColumnCache] = useState<
    Record<string, LazyColumnCacheEntry>
  >({});
  const [searchScope, setSearchScope] = useState<SearchScope>("prefix");
  const [searchRecursive, setSearchRecursive] = useState(false);
  const [searchExactMatch, setSearchExactMatch] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [contextCounts, setContextCounts] = useState<{
    objects: number;
    versions: number;
    deleteMarkers: number;
  } | null>(null);
  const [contextCountsLoading, setContextCountsLoading] = useState(false);
  const [contextCountsError, setContextCountsError] = useState<string | null>(
    null,
  );
  const [bucketInspectorByName, setBucketInspectorByName] = useState<
    Record<string, BucketInspectorData>
  >({});
  const [bucketInspectorLoading, setBucketInspectorLoading] = useState(false);
  const [bucketInspectorError, setBucketInspectorError] = useState<
    string | null
  >(null);
  const [activeItem, setActiveItem] = useState<BrowserItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [showDeletedObjects, setShowDeletedObjects] = useState(false);
  const [showFolderItems, setShowFolderItems] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | "file" | "folder">(
    "all",
  );
  const [storageFilter, setStorageFilter] = useState<string>("all");
  const [sortId, setSortId] = useState("name-asc");
  const sortKey = sortId.split("-")[0] as BrowserSortKey;
  const sortDirection = sortId.endsWith("asc") ? "asc" : "desc";
  const backendSortBy = useMemo<
    "name" | "size" | "modified" | "storage_class" | "etag"
  >(() => {
    if (sortKey === "storageClass") return "storage_class";
    return sortKey;
  }, [sortKey]);
  const [operations, setOperations] = useState<OperationItem[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const uploadQueueRef = useRef<UploadQueueItem[]>([]);
  const activeUploadsRef = useRef(0);
  const operationControllersRef = useRef(new Map<string, AbortController>());
  const stsCredentialsRef = useRef<StsCredentials | null>(null);
  const stsRefreshRef = useRef<Promise<StsCredentials | null> | null>(null);
  const [showActiveOperations, setShowActiveOperations] = useState(false);
  const [showQueuedOperations, setShowQueuedOperations] = useState(false);
  const [showCompletedOperations, setShowCompletedOperations] = useState(false);
  const [showFailedOperations, setShowFailedOperations] = useState(false);
  const [expandedOperationGroups, setExpandedOperationGroups] = useState<
    Record<string, boolean>
  >({});
  const [queuedVisibleCountByGroup, setQueuedVisibleCountByGroup] = useState<
    Record<string, number>
  >({});
  const [completedOperations, setCompletedOperations] = useState<
    CompletedOperationItem[]
  >([]);
  const [downloadDetails, setDownloadDetails] = useState<
    Record<string, DownloadDetailItem[]>
  >({});
  const [deleteDetails, setDeleteDetails] = useState<
    Record<string, DeleteDetailItem[]>
  >({});
  const [copyDetails, setCopyDetails] = useState<
    Record<string, CopyDetailItem[]>
  >({});
  const [objectDetailsTarget, setObjectDetailsTarget] =
    useState<ObjectDetailsTarget | null>(null);
  const [configBucketName, setConfigBucketName] = useState<string | null>(null);
  const [showCreateBucketModal, setShowCreateBucketModal] = useState(false);
  const [createBucketNameValue, setCreateBucketNameValue] = useState("");
  const [createBucketVersioning, setCreateBucketVersioning] = useState(false);
  const [createBucketLoading, setCreateBucketLoading] = useState(false);
  const [createBucketError, setCreateBucketError] = useState<string | null>(
    null,
  );
  const invalidBucketNameMessage =
    "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.";
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [newFolderLoading, setNewFolderLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] =
    useState<BrowserConfirmDialogState | null>(null);
  const [confirmDialogLoading, setConfirmDialogLoading] = useState(false);
  const [copyDialog, setCopyDialog] = useState<BrowserCopyDialogState | null>(
    null,
  );
  const [showOperationsModal, setShowOperationsModal] = useState(false);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const [pathSuggestionsLoading, setPathSuggestionsLoading] = useState(false);
  const [pathSuggestionIndex, setPathSuggestionIndex] = useState(-1);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [selectionStats, setSelectionStats] = useState<SelectionStats | null>(
    null,
  );
  const [selectionStatsLoading, setSelectionStatsLoading] = useState(false);
  const [selectionStatsError, setSelectionStatsError] = useState<string | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showBulkAttributesModal, setShowBulkAttributesModal] = useState(false);
  const [showBulkRestoreModal, setShowBulkRestoreModal] = useState(false);
  const [bulkActionItems, setBulkActionItems] = useState<BrowserItem[]>([]);
  const [bulkAttributesLoading, setBulkAttributesLoading] = useState(false);
  const [bulkAttributesError, setBulkAttributesError] = useState<string | null>(
    null,
  );
  const [bulkAttributesSummary, setBulkAttributesSummary] = useState<
    string | null
  >(null);
  const [bulkApplyMetadata, setBulkApplyMetadata] = useState(false);
  const [bulkApplyTags, setBulkApplyTags] = useState(false);
  const [bulkApplyStorageClass, setBulkApplyStorageClass] = useState(false);
  const [bulkApplyAcl, setBulkApplyAcl] = useState(false);
  const [bulkApplyLegalHold, setBulkApplyLegalHold] = useState(false);
  const [bulkApplyRetention, setBulkApplyRetention] = useState(false);
  const [bulkMetadataDraft, setBulkMetadataDraft] = useState<BulkMetadataDraft>(
    {
      contentType: "",
      cacheControl: "",
      contentDisposition: "",
      contentEncoding: "",
      contentLanguage: "",
      expires: "",
    },
  );
  const [bulkMetadataEntries, setBulkMetadataEntries] = useState("");
  const [bulkTagsDraft, setBulkTagsDraft] = useState("");
  const [bulkStorageClass, setBulkStorageClass] = useState("");
  const [bulkAclValue, setBulkAclValue] = useState("private");
  const [bulkLegalHoldStatus, setBulkLegalHoldStatus] = useState<"ON" | "OFF">(
    "OFF",
  );
  const [bulkRetentionMode, setBulkRetentionMode] = useState<
    "" | "GOVERNANCE" | "COMPLIANCE"
  >("");
  const [bulkRetentionDate, setBulkRetentionDate] = useState("");
  const [bulkRetentionBypass, setBulkRetentionBypass] = useState(false);
  const [bulkRestoreDate, setBulkRestoreDate] = useState("");
  const [bulkRestoreDeleteMissing, setBulkRestoreDeleteMissing] =
    useState(false);
  const [bulkRestoreRestoreDeleted, setBulkRestoreRestoreDeleted] =
    useState(false);
  const [bulkRestoreDryRun, setBulkRestoreDryRun] = useState(false);
  const [bulkRestoreLoading, setBulkRestoreLoading] = useState(false);
  const [bulkRestoreError, setBulkRestoreError] = useState<string | null>(null);
  const [bulkRestoreSummary, setBulkRestoreSummary] = useState<string | null>(
    null,
  );
  const [bulkRestorePreview, setBulkRestorePreview] = useState<{
    restoreKeys: string[];
    deleteKeys: string[];
    unchangedKeys: string[];
    totalRestore: number;
    totalDelete: number;
    totalUnchanged: number;
  } | null>(null);
  const [bulkRestoreTargetPath, setBulkRestoreTargetPath] = useState<
    string | null
  >(null);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupKeepLast, setCleanupKeepLast] = useState("");
  const [cleanupOlderThanDays, setCleanupOlderThanDays] = useState("");
  const [cleanupDeleteOrphanMarkers, setCleanupDeleteOrphanMarkers] =
    useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupSummary, setCleanupSummary] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const bucketMenuRef = useRef<HTMLDivElement | null>(null);
  const searchOptionsMenuRef = useRef<HTMLDivElement | null>(null);
  const searchOptionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const uploadQuickButtonRef = useRef<HTMLButtonElement | null>(null);
  const uploadQuickMenuRef = useRef<HTMLDivElement | null>(null);
  const toolbarMoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbarMoreMenuRef = useRef<HTMLDivElement | null>(null);
  const toolbarColumnsButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbarColumnsMenuRef = useRef<HTMLDivElement | null>(null);
  const corsActionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const corsActionPopoverRef = useRef<HTMLDivElement | null>(null);
  const objectsListViewportRef = useRef<HTMLDivElement | null>(null);
  const bucketMenuFilterRef = useRef<HTMLInputElement | null>(null);
  const bucketPanelViewportRef = useRef<HTMLDivElement | null>(null);
  const bucketPanelLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const layoutContainerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement | null>(null);
  const columnWidthsRef = useRef(columnWidths);
  const pathSuggestionsDebounceRef = useRef<number | null>(null);
  const bucketSearchDebounceRef = useRef<number | null>(null);
  const bucketSearchValueRef = useRef("");
  const bucketSearchRequestIdRef = useRef(0);
  const bucketAccessCacheRef = useRef<
    Map<string, Record<string, BucketAccessEntry>>
  >(new Map());
  const bucketAccessQueueRef = useRef<string[]>([]);
  const bucketAccessQueuedRef = useRef(new Set<string>());
  const bucketAccessInFlightRef = useRef(0);
  const bucketAccessAbortControllersRef = useRef<Map<string, AbortController>>(
    new Map(),
  );
  const bucketAccessSessionRef = useRef(0);
  const objectsRequestSeqRef = useRef(0);
  const objectsAbortControllerRef = useRef<AbortController | null>(null);
  const objectsSearchDebounceRef = useRef<number | null>(null);
  const objectsNavigationKeyRef = useRef<string | null>(null);
  const pathSuggestionsRequestIdRef = useRef(0);
  const objectsRefreshTimeoutRef = useRef<number | null>(null);
  const uploadRefreshTimeoutRef = useRef<number | null>(null);
  const pendingUploadedKeysByBucketRef = useRef<Map<string, Set<string>>>(
    new Map(),
  );
  const objectsRef = useRef(objects);
  const prefixesRef = useRef(prefixes);
  const deletedObjectsRef = useRef(deletedObjects);
  const deletedPrefixesRef = useRef(deletedPrefixes);
  const deletedObjectsNextKeyMarkerRef = useRef(deletedObjectsNextKeyMarker);
  const deletedObjectsNextVersionIdMarkerRef = useRef(
    deletedObjectsNextVersionIdMarker,
  );
  const deletedObjectsIsTruncatedRef = useRef(deletedObjectsIsTruncated);
  const prefixVersionsRef = useRef(prefixVersions);
  const prefixDeleteMarkersRef = useRef(prefixDeleteMarkers);
  const prefixVersionKeyMarkerRef = useRef(prefixVersionKeyMarker);
  const prefixVersionIdMarkerRef = useRef(prefixVersionIdMarker);
  const foldersPanelWidthRef = useRef(foldersPanelWidthPx);
  const inspectorPanelWidthRef = useRef(inspectorPanelWidthPx);
  const objectVersionsRef = useRef(objectVersions);
  const objectDeleteMarkersRef = useRef(objectDeleteMarkers);
  const objectVersionKeyMarkerRef = useRef(objectVersionKeyMarker);
  const objectVersionIdMarkerRef = useRef(objectVersionIdMarker);
  const objectVersionsTargetKeyRef = useRef(objectVersionsTargetKey);
  const isFoldersPanelVisibleRef = useRef(false);
  const isInspectorPanelVisibleRef = useRef(false);
  const lazyColumnCacheRef = useRef<Record<string, LazyColumnCacheEntry>>({});
  const lazyListItemsByIdRef = useRef<Map<string, BrowserItem>>(new Map());
  const lazyQueueRef = useRef<string[]>([]);
  const lazyQueuedIdsRef = useRef(new Set<string>());
  const lazyInFlightRef = useRef(0);
  const accountIdForApiRef = useRef(accountIdForApi);
  const bucketAccessByNameRef = useRef(bucketAccessByName);
  const previousAccountIdRef = useRef<typeof accountIdForApi>(accountIdForApi);
  const contextCountIdRef = useRef(0);
  const bucketInspectorRequestIdRef = useRef(0);
  const selectionStatsRequestIdRef = useRef(0);
  const browserPathRef = useRef("");
  const browserHistoryStateRef = useRef<{
    bucketName: string;
    prefix: string;
  } | null>(null);
  const skipHistoryPushRef = useRef(false);
  const browserRootSelectionPersistenceReadyRef = useRef(false);
  const browserRootSelectionContextIdRef = useRef<string | null>(
    browserRootContextId,
  );
  const operationIdsRef = useRef(new Set<string>());
  const bucketNameRef = useRef(bucketName);
  const prefixRef = useRef(prefix);
  const inspectedItemRef = useRef<BrowserItem | null>(null);
  const selectedContext = useMemo(
    () =>
      browserContext.contexts.find(
        (ctx) => ctx.id === browserContext.selectedContextId,
      ) ?? null,
    [browserContext.contexts, browserContext.selectedContextId],
  );
  const storageEndpointCaps = useMemo(() => {
    if (selectedContext?.storage_endpoint_capabilities) {
      return selectedContext.storage_endpoint_capabilities;
    }
    const raw = (selectedContext as { raw?: unknown } | null)?.raw;
    if (!raw || typeof raw !== "object") return null;
    if (!("storage_endpoint_capabilities" in raw)) return null;
    return (
      (
        raw as {
          storage_endpoint_capabilities?: Record<string, boolean> | null;
        }
      ).storage_endpoint_capabilities ?? null
    );
  }, [selectedContext]);
  const effectiveCaps =
    storageEndpointCapabilities === undefined
      ? storageEndpointCaps
      : storageEndpointCapabilities;
  const selectedContextEndpointProvider =
    selectedContext?.endpoint_provider ?? null;
  const effectiveContextEndpointProvider =
    contextEndpointProvider === undefined
      ? selectedContextEndpointProvider
      : contextEndpointProvider;
  const selectedContextQuotaSizeGb = selectedContext?.quota_max_size_gb ?? null;
  const selectedContextQuotaObjects =
    selectedContext?.quota_max_objects ?? null;
  const effectiveContextQuotaSizeGb =
    contextQuotaMaxSizeGb === undefined
      ? selectedContextQuotaSizeGb
      : contextQuotaMaxSizeGb;
  const effectiveContextQuotaObjects =
    contextQuotaMaxObjects === undefined
      ? selectedContextQuotaObjects
      : contextQuotaMaxObjects;
  const cephContextQuotaSizeBytes =
    effectiveContextQuotaSizeGb != null && effectiveContextQuotaSizeGb > 0
      ? effectiveContextQuotaSizeGb * BYTES_PER_GIB
      : null;
  const cephContextQuotaObjects =
    effectiveContextQuotaObjects != null && effectiveContextQuotaObjects > 0
      ? effectiveContextQuotaObjects
      : null;
  const isCephContext = effectiveContextEndpointProvider === "ceph";
  const showActionBarToggle = showPanelToggles && isMainBrowserPath;
  const bucketManagementEnabled =
    normalizedPath.endsWith("/browser") && !isEmbeddedBrowserPath;
  const bucketConfigurationEnabled = bucketManagementEnabled;
  const bucketConfigContextScope = "browser";

  useEffect(() => {
    if (
      normalizedPath === "/browser" ||
      normalizedPath.endsWith("/manager/browser") ||
      normalizedPath.endsWith("/ceph-admin/browser")
    ) {
      setCompactMode(true);
    }
  }, [normalizedPath]);
  const contextId =
    typeof accountIdForApi === "string" ? accountIdForApi : null;
  const isCephAdminContext = Boolean(
    contextId && contextId.startsWith("ceph-admin-"),
  );
  const isLegacyS3UserContext = Boolean(
    contextId && contextId.startsWith("s3u-"),
  );
  const isLegacyConnectionContext = Boolean(
    contextId && contextId.startsWith("conn-"),
  );
  const isLegacyContext = isLegacyS3UserContext || isLegacyConnectionContext;
  const stsEnabled = Boolean(effectiveCaps?.sts) && !isLegacyContext;
  const sseFeatureEnabled = Boolean(effectiveCaps?.sse);
  const bucketInspectorUsageEnabled = effectiveCaps
    ? effectiveCaps.metrics !== false
    : true;
  const bucketInspectorStaticWebsiteEnabled =
    effectiveCaps?.static_website ?? true;
  const normalizeSelectorId = useCallback(
    (value: S3AccountSelector | null | undefined) => {
      if (value == null) return null;
      return String(value);
    },
    [],
  );
  const currentAccountId = normalizeSelectorId(accountIdForApi);
  const accountSwitchInFlight =
    previousAccountIdRef.current !== accountIdForApi;
  const sseCustomerScopeKey = useMemo(() => {
    if (!currentAccountId || !bucketName) return null;
    return `${currentAccountId}::${bucketName}`;
  }, [bucketName, currentAccountId]);
  const sseCustomerKeyBase64Raw = useMemo(() => {
    if (!sseCustomerScopeKey) return null;
    return sseCustomerKeysByScope[sseCustomerScopeKey] ?? null;
  }, [sseCustomerKeysByScope, sseCustomerScopeKey]);
  const sseCustomerKeyBase64 = sseFeatureEnabled
    ? sseCustomerKeyBase64Raw
    : null;
  const getSseCustomerKeyForScope = useCallback(
    (selector: S3AccountSelector | null | undefined, bucket: string) => {
      const normalizedSelector = normalizeSelectorId(selector);
      if (!normalizedSelector || !bucket) return null;
      return sseCustomerKeysByScope[`${normalizedSelector}::${bucket}`] ?? null;
    },
    [normalizeSelectorId, sseCustomerKeysByScope],
  );
  const sseActive = Boolean(sseCustomerKeyBase64);
  const showSseControls = Boolean(
    sseFeatureEnabled && hasS3AccountContext && bucketName,
  );
  const clipboardAccountId = normalizeSelectorId(
    clipboard?.sourceSelector ?? null,
  );
  const clipboardMatchesContext = Boolean(
    clipboard && clipboardAccountId === currentAccountId,
  );
  const canPaste = Boolean(
    clipboard && bucketName && hasS3AccountContext,
  );
  const {
    canUseFoldersPanel,
    canUseInspectorPanel,
    isFoldersPanelVisible,
    isInspectorPanelVisible,
  } = resolveBrowserPanelVisibility({
    allowFoldersPanel,
    allowInspectorPanel,
    isNarrowViewport,
    showFolders,
    showInspector,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(PANELS_DISABLE_MEDIA_QUERY);
    const syncViewportWidth = () => {
      setIsNarrowViewport(mediaQuery.matches);
    };
    syncViewportWidth();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewportWidth);
      return () => {
        mediaQuery.removeEventListener("change", syncViewportWidth);
      };
    }
    mediaQuery.addListener(syncViewportWidth);
    return () => {
      mediaQuery.removeListener(syncViewportWidth);
    };
  }, []);

  useEffect(() => {
    if (!isMainBrowserPath) return;
    writeBrowserRootUiLayout({
      showFolders,
      showInspector,
      showActionBar,
    });
  }, [isMainBrowserPath, showActionBar, showFolders, showInspector]);

  useEffect(() => {
    foldersPanelWidthRef.current = foldersPanelWidthPx;
    inspectorPanelWidthRef.current = inspectorPanelWidthPx;
  }, [foldersPanelWidthPx, inspectorPanelWidthPx]);

  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);

  useEffect(() => {
    isFoldersPanelVisibleRef.current = isFoldersPanelVisible;
    isInspectorPanelVisibleRef.current = isInspectorPanelVisible;
  }, [isFoldersPanelVisible, isInspectorPanelVisible]);

  useLayoutEffect(() => {
    const updateLayoutContainerWidth = () => {
      setLayoutContainerWidthPx(
        Math.round(layoutContainerRef.current?.getBoundingClientRect().width ?? 0),
      );
    };
    updateLayoutContainerWidth();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", updateLayoutContainerWidth);
    if (typeof ResizeObserver === "undefined" || !layoutContainerRef.current) {
      return () => {
        window.removeEventListener("resize", updateLayoutContainerWidth);
      };
    }
    const observer = new ResizeObserver(() => {
      updateLayoutContainerWidth();
    });
    observer.observe(layoutContainerRef.current);
    return () => {
      window.removeEventListener("resize", updateLayoutContainerWidth);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activePanelResize) return;
    writeBrowserRootUiPanelWidths({
      foldersPanelWidthPx,
      inspectorPanelWidthPx,
    });
  }, [activePanelResize, foldersPanelWidthPx, inspectorPanelWidthPx]);

  useEffect(() => {
    if (!activePanelResize) return;
    const handlePointerMove = (event: PointerEvent) => {
      const rect = layoutContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (activePanelResize === "folders") {
        if (!isFoldersPanelVisibleRef.current) return;
        const nextWidth =
          event.clientX - rect.left - PANEL_LAYOUT_GAP_PX / 2;
        const { resolvedFoldersWidth } = resolveBrowserPanelWidths({
          containerWidth: rect.width,
          foldersPanelWidthPx: nextWidth,
          inspectorPanelWidthPx: inspectorPanelWidthRef.current,
          isFoldersPanelVisible: isFoldersPanelVisibleRef.current,
          isInspectorPanelVisible: isInspectorPanelVisibleRef.current,
        });
        setFoldersPanelWidthPx(resolvedFoldersWidth);
        return;
      }
      if (!isInspectorPanelVisibleRef.current) return;
      const nextWidth = rect.right - event.clientX - PANEL_LAYOUT_GAP_PX / 2;
      const { resolvedInspectorWidth } = resolveBrowserPanelWidths({
        containerWidth: rect.width,
        foldersPanelWidthPx: foldersPanelWidthRef.current,
        inspectorPanelWidthPx: nextWidth,
        isFoldersPanelVisible: isFoldersPanelVisibleRef.current,
        isInspectorPanelVisible: isInspectorPanelVisibleRef.current,
      });
      setInspectorPanelWidthPx(resolvedInspectorWidth);
    };
    const stopPanelResize = () => {
      setActivePanelResize(null);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopPanelResize);
    document.addEventListener("pointercancel", stopPanelResize);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopPanelResize);
      document.removeEventListener("pointercancel", stopPanelResize);
    };
  }, [activePanelResize]);

  useEffect(() => {
    setVisibleColumns(loadVisibleColumnsForSurface(isMainBrowserPath));
  }, [isMainBrowserPath]);

  useEffect(() => {
    persistVisibleColumnsForSurface(isMainBrowserPath, visibleColumns);
  }, [isMainBrowserPath, visibleColumns]);

  useEffect(() => {
    setColumnWidths(loadColumnWidthsForSurface(isMainBrowserPath));
  }, [isMainBrowserPath]);

  useEffect(() => {
    if (activeColumnResize) return;
    persistColumnWidthsForSurface(isMainBrowserPath, columnWidths);
  }, [activeColumnResize, columnWidths, isMainBrowserPath]);

  useEffect(() => {
    if (!activeColumnResize) return;
    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth =
        activeColumnResize.startWidthPx + (event.clientX - activeColumnResize.startX);
      setColumnWidths((prev) => ({
        ...prev,
        [activeColumnResize.columnId]: clampColumnWidth(
          activeColumnResize.columnId,
          nextWidth,
        ),
      }));
    };
    const stopColumnResize = () => {
      setActiveColumnResize(null);
    };
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

  const toggleFoldersPanel = useCallback(() => {
    if (!canUseFoldersPanel) return;
    setShowFolders((prev) => !prev);
  }, [canUseFoldersPanel]);

  const toggleInspectorPanel = useCallback(() => {
    if (!canUseInspectorPanel) return;
    setShowInspector((prev) => !prev);
  }, [canUseInspectorPanel]);

  const updateBucketAccessEntry = useCallback(
    (targetBucketName: string, nextEntry: BucketAccessEntry) => {
      if (!targetBucketName) return;
      setBucketAccessByName((prev) => {
        const normalizedNext = {
          status: nextEntry.status,
          detail: nextEntry.detail ?? null,
        } satisfies BucketAccessEntry;
        const previousEntry = prev[targetBucketName];
        if (
          previousEntry?.status === normalizedNext.status &&
          previousEntry?.detail === normalizedNext.detail
        ) {
          return prev;
        }
        const next = {
          ...prev,
          [targetBucketName]: normalizedNext,
        };
        if (bucketAccessContextKey) {
          bucketAccessCacheRef.current.set(bucketAccessContextKey, next);
        }
        return next;
      });
    },
    [bucketAccessContextKey],
  );

  const resetBucketAccessQueue = useCallback(() => {
    bucketAccessSessionRef.current += 1;
    bucketAccessQueueRef.current = [];
    bucketAccessQueuedRef.current.clear();
    bucketAccessAbortControllersRef.current.forEach((controller) =>
      controller.abort(),
    );
    bucketAccessAbortControllersRef.current.clear();
    bucketAccessInFlightRef.current = 0;
    setBucketAccessByName((prev) => {
      const sanitized = sanitizeBucketAccessEntries(prev);
      const sameShape =
        Object.keys(prev).length === Object.keys(sanitized).length &&
        Object.entries(prev).every(([bucket, entry]) => {
          const nextEntry = sanitized[bucket];
          return (
            nextEntry?.status === entry.status &&
            nextEntry?.detail === entry.detail
          );
        });
      if (sameShape) {
        return prev;
      }
      if (bucketAccessContextKey) {
        bucketAccessCacheRef.current.set(bucketAccessContextKey, sanitized);
      }
      return sanitized;
    });
  }, [bucketAccessContextKey]);

  const drainBucketAccessQueue = useCallback(() => {
    if (!hasS3AccountContext || !accountIdForApi) {
      return;
    }
    const requestSession = bucketAccessSessionRef.current;
    while (
      bucketAccessInFlightRef.current < BUCKET_ACCESS_PROBE_CONCURRENCY &&
      bucketAccessQueueRef.current.length > 0
    ) {
      const targetBucketName = bucketAccessQueueRef.current.shift();
      if (!targetBucketName) {
        continue;
      }
      bucketAccessQueuedRef.current.delete(targetBucketName);
      bucketAccessInFlightRef.current += 1;
      const controller = new AbortController();
      bucketAccessAbortControllersRef.current.set(targetBucketName, controller);
      void listBrowserObjects(accountIdForApi, targetBucketName, {
        maxKeys: 1,
        signal: controller.signal,
      })
        .then(() => {
          if (requestSession !== bucketAccessSessionRef.current) {
            return;
          }
          updateBucketAccessEntry(targetBucketName, {
            status: "available",
            detail: null,
          });
        })
        .catch((error) => {
          if (
            isAbortError(error) ||
            requestSession !== bucketAccessSessionRef.current
          ) {
            return;
          }
          const issue = normalizeBrowserListingIssue(
            error,
            "Unable to list bucket.",
          );
          updateBucketAccessEntry(
            targetBucketName,
            issue.kind === "access_denied"
              ? {
                  status: "unavailable",
                  detail: issue.technicalDetail,
                }
              : UNKNOWN_BUCKET_ACCESS,
          );
        })
        .finally(() => {
          bucketAccessAbortControllersRef.current.delete(targetBucketName);
          bucketAccessInFlightRef.current = Math.max(
            0,
            bucketAccessInFlightRef.current - 1,
          );
          if (requestSession === bucketAccessSessionRef.current) {
            drainBucketAccessQueue();
          }
        });
    }
  }, [accountIdForApi, hasS3AccountContext, updateBucketAccessEntry]);

  const scheduleBucketAccessProbe = useCallback(
    (targetBucketName: string) => {
      if (
        !targetBucketName ||
        !hasS3AccountContext ||
        !accountIdForApi ||
        targetBucketName === bucketName
      ) {
        return;
      }
      const currentAccess = resolveBucketAccessEntry(
        targetBucketName,
        bucketAccessByName,
      );
      if (currentAccess.status !== "unknown") {
        return;
      }
      if (
        bucketAccessQueuedRef.current.has(targetBucketName) ||
        bucketAccessAbortControllersRef.current.has(targetBucketName)
      ) {
        return;
      }
      bucketAccessQueuedRef.current.add(targetBucketName);
      bucketAccessQueueRef.current.push(targetBucketName);
      updateBucketAccessEntry(targetBucketName, {
        status: "checking",
        detail: null,
      });
      drainBucketAccessQueue();
    },
    [
      accountIdForApi,
      bucketAccessByName,
      bucketName,
      drainBucketAccessQueue,
      hasS3AccountContext,
      updateBucketAccessEntry,
    ],
  );

  useEffect(() => {
    resetBucketAccessQueue();
    if (!bucketAccessContextKey || !hasS3AccountContext) {
      setBucketAccessByName({});
      return;
    }
    const cached = sanitizeBucketAccessEntries(
      bucketAccessCacheRef.current.get(bucketAccessContextKey) ?? {},
    );
    bucketAccessCacheRef.current.set(bucketAccessContextKey, cached);
    setBucketAccessByName(cached);
  }, [bucketAccessContextKey, hasS3AccountContext, resetBucketAccessQueue]);

  const openSseCustomerModal = useCallback(() => {
    if (!sseFeatureEnabled || !sseCustomerScopeKey) return;
    setSseCustomerKeyInput(sseCustomerKeyBase64 ?? "");
    setSseCustomerKeyError(null);
    setSseCustomerKeyNotice(null);
    setSseCustomerKeyVisible(false);
    setShowSseCustomerModal(true);
  }, [sseCustomerKeyBase64, sseCustomerScopeKey, sseFeatureEnabled]);
  const handleActivateSseCustomerKey = useCallback(() => {
    if (!sseCustomerScopeKey) return;
    try {
      const result = activateSseCustomerKeyForScope(
        sseCustomerKeysByScope,
        sseCustomerScopeKey,
        sseCustomerKeyInput,
      );
      setSseCustomerKeysByScope(result.next);
      setSseCustomerKeyError(null);
      setSseCustomerKeyNotice(null);
      setShowSseCustomerModal(false);
      setStatusMessage("SSE-C key enabled for this bucket.");
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Unable to activate SSE-C key.";
      setSseCustomerKeyError(message);
    }
  }, [sseCustomerKeyInput, sseCustomerKeysByScope, sseCustomerScopeKey]);
  const handleGenerateSseCustomerKey = useCallback(async () => {
    if (!sseCustomerScopeKey) return;
    let generatedKey = "";
    try {
      const result = generateAndActivateSseCustomerKeyForScope(
        sseCustomerKeysByScope,
        sseCustomerScopeKey,
      );
      generatedKey = result.normalizedKey;
      setSseCustomerKeysByScope(result.next);
      setSseCustomerKeyInput(generatedKey);
      setSseCustomerKeyError(null);
      setSseCustomerKeyVisible(false);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Unable to generate SSE-C key.";
      setSseCustomerKeyError(message);
      setSseCustomerKeyNotice(null);
      return;
    }
    const copyOutcome = await copySseCustomerKeyWithFallback(
      generatedKey,
      navigator.clipboard?.writeText?.bind(navigator.clipboard),
      () => {
        setCopyDialog({
          title: "Copy SSE-C key",
          label: "SSE-C key",
          value: generatedKey,
          successMessage: "SSE-C key copied to clipboard.",
        });
      },
    );
    if (copyOutcome === "copied") {
      setSseCustomerKeyNotice(
        "SSE-C key generated and enabled. Copy and save this key now; it will be lost on browser refresh.",
      );
      setStatusMessage(
        "SSE-C key generated, enabled, and copied to clipboard.",
      );
      return;
    }
    setSseCustomerKeyNotice(
      "SSE-C key generated and enabled. Clipboard access failed: copy and save the key now using the manual dialog.",
    );
    setStatusMessage(
      "SSE-C key generated and enabled. Copy it manually from the dialog.",
    );
  }, [sseCustomerKeysByScope, sseCustomerScopeKey]);
  const handleClearSseCustomerKey = useCallback(() => {
    if (!sseCustomerScopeKey) return;
    setSseCustomerKeysByScope((prev) => {
      const next = { ...prev };
      delete next[sseCustomerScopeKey];
      return next;
    });
    setSseCustomerKeyInput("");
    setSseCustomerKeyError(null);
    setSseCustomerKeyNotice(null);
    setSseCustomerKeyVisible(false);
    setShowSseCustomerModal(false);
    setStatusMessage("SSE-C key cleared for this bucket.");
  }, [sseCustomerScopeKey]);
  useEffect(() => {
    if (!sseFeatureEnabled && showSseCustomerModal) {
      setShowSseCustomerModal(false);
    }
  }, [showSseCustomerModal, sseFeatureEnabled]);

  const normalizedPrefix = useMemo(() => normalizePrefix(prefix), [prefix]);
  const isVersioningEnabled = bucketVersioningEnabled;
  useEffect(() => {
    bucketNameRef.current = bucketName;
    prefixRef.current = prefix;
  }, [bucketName, prefix]);
  useEffect(() => {
    if (!isMainBrowserPath || !browserRootContextId || !hasS3AccountContext)
      return;
    if (!browserRootSelectionPersistenceReadyRef.current) return;
    if (browserRootSelectionContextIdRef.current !== browserRootContextId)
      return;
    writeBrowserRootContextSelection(browserRootContextId, {
      bucketName,
      prefix,
    });
  }, [
    browserRootContextId,
    bucketName,
    hasS3AccountContext,
    isMainBrowserPath,
    prefix,
  ]);
  const uiOrigin = useMemo(
    () => (typeof window === "undefined" ? undefined : window.location.origin),
    [],
  );
  const uploadParallelism = useMemo(() => {
    const direct =
      browserSettings?.direct_upload_parallelism ??
      DEFAULT_DIRECT_UPLOAD_PARALLELISM;
    const proxy =
      browserSettings?.proxy_upload_parallelism ??
      DEFAULT_PROXY_UPLOAD_PARALLELISM;
    const fallback = useProxyTransfers
      ? DEFAULT_PROXY_UPLOAD_PARALLELISM
      : DEFAULT_DIRECT_UPLOAD_PARALLELISM;
    return clampParallelism(useProxyTransfers ? proxy : direct, fallback);
  }, [browserSettings, useProxyTransfers]);
  const uploadParallelismRef = useRef(uploadParallelism);
  useEffect(() => {
    uploadParallelismRef.current = uploadParallelism;
  }, [uploadParallelism]);
  const downloadParallelism = useMemo(() => {
    const direct =
      browserSettings?.direct_download_parallelism ??
      DEFAULT_DIRECT_DOWNLOAD_PARALLELISM;
    const proxy =
      browserSettings?.proxy_download_parallelism ??
      DEFAULT_PROXY_DOWNLOAD_PARALLELISM;
    const fallback = useProxyTransfers
      ? DEFAULT_PROXY_DOWNLOAD_PARALLELISM
      : DEFAULT_DIRECT_DOWNLOAD_PARALLELISM;
    return clampParallelism(useProxyTransfers ? proxy : direct, fallback);
  }, [browserSettings, useProxyTransfers]);
  const downloadParallelismRef = useRef(downloadParallelism);
  useEffect(() => {
    downloadParallelismRef.current = downloadParallelism;
  }, [downloadParallelism]);
  useEffect(() => {
    stsCredentialsRef.current = stsCredentials;
  }, [stsCredentials]);
  const otherOperationsParallelism = useMemo(() => {
    const value =
      browserSettings?.other_operations_parallelism ??
      DEFAULT_OTHER_OPERATIONS_PARALLELISM;
    return clampParallelism(value, DEFAULT_OTHER_OPERATIONS_PARALLELISM);
  }, [browserSettings]);
  const otherOperationsParallelismRef = useRef(otherOperationsParallelism);
  useEffect(() => {
    otherOperationsParallelismRef.current = otherOperationsParallelism;
  }, [otherOperationsParallelism]);
  const proxyAllowed = browserSettings?.allow_proxy_transfers ?? false;
  const isStsCredentialsExpiring = (value: StsCredentials | null) => {
    if (!value?.expiration) return true;
    const expiresAt = new Date(value.expiration).getTime();
    if (Number.isNaN(expiresAt)) return true;
    return expiresAt - Date.now() <= 2 * 60 * 1000;
  };
  const ensureStsCredentials = useCallback(
    async (force = false) => {
      if (!hasS3AccountContext || !stsEnabled || !stsStatus?.available) {
        setStsCredentials(null);
        setStsCredentialsError(null);
        return null;
      }
      const current = stsCredentialsRef.current;
      if (!force && current && !isStsCredentialsExpiring(current)) {
        return current;
      }
      if (stsRefreshRef.current) {
        return stsRefreshRef.current;
      }
      const request = getStsCredentials(accountIdForApi)
        .then((creds) => {
          setStsCredentials(creds);
          setStsCredentialsError(null);
          return creds;
        })
        .catch((err) => {
          setStsCredentials(null);
          setStsCredentialsError(
            extractApiError(err, "Unable to load STS credentials."),
          );
          return null;
        })
        .finally(() => {
          stsRefreshRef.current = null;
        });
      stsRefreshRef.current = request;
      return request;
    },
    [accountIdForApi, hasS3AccountContext, stsEnabled, stsStatus?.available],
  );
  const stsAvailable = Boolean(stsEnabled && stsStatus?.available);
  const useStsPresigner = shouldUseStsPresigner({ stsAvailable, sseActive });
  const presignObjectRequest = useCallback(
    async (targetBucket: string, payload: PresignRequest) => {
      if (useStsPresigner) {
        const credentials = await ensureStsCredentials();
        if (credentials) {
          try {
            return await presignObjectWithSts(
              credentials,
              targetBucket,
              payload,
            );
          } catch {
            const refreshed = await ensureStsCredentials(true);
            if (refreshed) {
              try {
                return await presignObjectWithSts(
                  refreshed,
                  targetBucket,
                  payload,
                );
              } catch {
                // ignore and fall back to backend presign
              }
            }
          }
        }
      }
      return presignObject(
        accountIdForApi,
        targetBucket,
        payload,
        sseCustomerKeyBase64,
      );
    },
    [
      accountIdForApi,
      ensureStsCredentials,
      sseCustomerKeyBase64,
      useStsPresigner,
    ],
  );
  const presignPartRequest = useCallback(
    async (
      targetBucket: string,
      uploadId: string,
      payload: PresignPartRequest,
    ) => {
      if (useStsPresigner) {
        const credentials = await ensureStsCredentials();
        if (credentials) {
          try {
            return await presignPartWithSts(
              credentials,
              targetBucket,
              uploadId,
              payload,
            );
          } catch {
            const refreshed = await ensureStsCredentials(true);
            if (refreshed) {
              try {
                return await presignPartWithSts(
                  refreshed,
                  targetBucket,
                  uploadId,
                  payload,
                );
              } catch {
                // ignore and fall back to backend presign
              }
            }
          }
        }
      }
      return presignPart(
        accountIdForApi,
        targetBucket,
        uploadId,
        payload,
        sseCustomerKeyBase64,
      );
    },
    [
      accountIdForApi,
      ensureStsCredentials,
      sseCustomerKeyBase64,
      useStsPresigner,
    ],
  );
  const warnings = useMemo(() => {
    const items: string[] = [];
    if (warningMessage) {
      items.push(warningMessage);
    }
    if (corsFixError) {
      items.push(corsFixError);
    }
    if (stsCredentialsError) {
      items.push(stsCredentialsError);
    }
    const corsDisabled = Boolean(corsStatus && !corsStatus.enabled);
    if (corsDisabled) {
      items.push(CORS_DIRECT_TRANSFER_WARNING);
      if (!proxyAllowed) {
        items.push("Proxy transfers are disabled in settings.");
      }
    }
    return items;
  }, [
    corsFixError,
    corsStatus,
    proxyAllowed,
    stsCredentialsError,
    warningMessage,
  ]);
  const hasCorsAction = Boolean(corsStatus && !corsStatus.enabled && uiOrigin);
  const stsExpirationLabel = useMemo(() => {
    if (!stsCredentials?.expiration) return "";
    const formatted = formatDateTime(stsCredentials.expiration);
    return formatted === "-" ? "" : formatted;
  }, [stsCredentials?.expiration]);
  const legacyStsTooltip = useMemo(() => {
    if (!isLegacyContext) return "";
    return isLegacyConnectionContext
      ? "STS is not available for legacy S3 connections. Presigned URLs are used instead."
      : "STS is not available for legacy S3 users. Presigned URLs are used instead.";
  }, [isLegacyConnectionContext, isLegacyContext]);
  const accessBadge = useMemo(() => {
    if (!hasS3AccountContext) return null;
    const corsDisabled = Boolean(corsStatus && !corsStatus.enabled);
    const transfersBlocked = corsDisabled && !proxyAllowed;
    if (transfersBlocked) {
      return {
        label: "Unavailable",
        title:
          "Download/Upload unavailable: CORS is disabled and proxy transfers are disabled.",
        tone: "danger" as const,
        indicatorClassName:
          "border-rose-200/70 bg-rose-200/60 dark:border-rose-400/40 dark:bg-rose-400/25",
      };
    }
    if (useProxyTransfers) {
      return {
        label: "Proxy",
        title: "Download/Upload mode: Backend proxy transfers are active.",
        tone: "warning" as const,
        indicatorClassName:
          "border-amber-200/70 bg-amber-200/60 dark:border-amber-400/40 dark:bg-amber-400/25",
      };
    }
    if (sseActive) {
      return {
        label: "SSE-C",
        title:
          "Download/Upload mode: SSE-C customer key is active for this bucket.",
        tone: "info" as const,
        indicatorClassName:
          "border-sky-200/70 bg-sky-200/60 dark:border-sky-400/40 dark:bg-sky-400/25",
      };
    }
    if (stsCredentials) {
      return {
        label: "STS",
        title: stsExpirationLabel
          ? `Download/Upload mode: STS credentials active (expires at ${stsExpirationLabel}).`
          : "Download/Upload mode: STS credentials are active.",
        tone: "success" as const,
        indicatorClassName:
          "border-emerald-200/70 bg-emerald-200/60 dark:border-emerald-400/40 dark:bg-emerald-400/25",
      };
    }
    return {
      label: "Presign",
      title: legacyStsTooltip
        ? `Download/Upload mode: Presigned URLs are active. ${legacyStsTooltip}`
        : "Download/Upload mode: Presigned URLs are active.",
      tone: "success" as const,
      indicatorClassName:
        "border-emerald-200/70 bg-emerald-200/60 dark:border-emerald-400/40 dark:bg-emerald-400/25",
    };
  }, [
    corsStatus,
    hasS3AccountContext,
    legacyStsTooltip,
    proxyAllowed,
    sseActive,
    stsCredentials,
    stsExpirationLabel,
    useProxyTransfers,
  ]);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const clampContextMenuPosition = useCallback(
    (
      x: number,
      y: number,
      menuWidth = CONTEXT_MENU_FALLBACK_WIDTH_PX,
      menuHeight = CONTEXT_MENU_FALLBACK_HEIGHT_PX,
    ) => {
      if (typeof window === "undefined") {
        return { x, y };
      }
      const safeWidth =
        Number.isFinite(menuWidth) && menuWidth > 0
          ? menuWidth
          : CONTEXT_MENU_FALLBACK_WIDTH_PX;
      const safeHeight =
        Number.isFinite(menuHeight) && menuHeight > 0
          ? menuHeight
          : CONTEXT_MENU_FALLBACK_HEIGHT_PX;
      const maxX = Math.max(
        CONTEXT_MENU_PADDING_PX,
        window.innerWidth - safeWidth - CONTEXT_MENU_PADDING_PX,
      );
      const maxY = Math.max(
        CONTEXT_MENU_PADDING_PX,
        window.innerHeight - safeHeight - CONTEXT_MENU_PADDING_PX,
      );
      const clamp = (value: number, min: number, max: number) =>
        Math.min(Math.max(value, min), max);
      return {
        x: clamp(x, CONTEXT_MENU_PADDING_PX, maxX),
        y: clamp(y, CONTEXT_MENU_PADDING_PX, maxY),
      };
    },
    [],
  );
  const repositionContextMenu = useCallback(() => {
    setContextMenu((previous) => {
      if (!previous) return previous;
      const menuNode = contextMenuRef.current;
      if (!menuNode) return previous;
      const menuRect = menuNode.getBoundingClientRect();
      const nextPosition = clampContextMenuPosition(
        previous.x,
        previous.y,
        menuRect.width,
        menuRect.height,
      );
      if (
        Math.abs(nextPosition.x - previous.x) < 0.5 &&
        Math.abs(nextPosition.y - previous.y) < 0.5
      ) {
        return previous;
      }
      return { ...previous, ...nextPosition };
    });
  }, [clampContextMenuPosition]);
  const getContextMenuPosition = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const { clientX, clientY } = event;
      return clampContextMenuPosition(clientX, clientY);
    },
    [clampContextMenuPosition],
  );

  useEffect(() => {
    if (!folderInputRef.current) return;
    folderInputRef.current.setAttribute("webkitdirectory", "");
    folderInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    browserPathRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as {
        browserPage?: boolean;
        bucketName?: string;
        prefix?: string;
      } | null;
      if (state?.browserPage) {
        const nextBucket = state.bucketName ?? "";
        const nextPrefix = state.prefix ?? "";
        const isSame =
          nextBucket === bucketNameRef.current &&
          nextPrefix === prefixRef.current;
        skipHistoryPushRef.current = !isSame;
        if (nextBucket !== bucketNameRef.current) {
          setBucketName(nextBucket);
        }
        setPrefix(nextPrefix);
        setActiveItem(null);
        setIsEditingPath(false);
        return;
      }
      const safeState = {
        ...(window.history.state ?? {}),
        browserPage: true,
        bucketName: bucketNameRef.current,
        prefix: prefixRef.current,
      };
      window.history.pushState(
        safeState,
        "",
        browserPathRef.current ||
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (skipHistoryPushRef.current) {
      skipHistoryPushRef.current = false;
      browserHistoryStateRef.current = { bucketName, prefix };
      return;
    }
    const last = browserHistoryStateRef.current;
    if (last && last.bucketName === bucketName && last.prefix === prefix) {
      return;
    }
    const baseState = window.history.state ?? {};
    const nextState = { ...baseState, browserPage: true, bucketName, prefix };
    if (!baseState?.browserPage) {
      window.history.replaceState(
        nextState,
        "",
        browserPathRef.current ||
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
      browserHistoryStateRef.current = { bucketName, prefix };
      return;
    }
    window.history.pushState(
      nextState,
      "",
      browserPathRef.current ||
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    browserHistoryStateRef.current = { bucketName, prefix };
  }, [bucketName, prefix]);

  useEffect(() => {
    setInspectorTab("context");
  }, [bucketName, prefix]);

  useEffect(() => {
    setShowSearchOptionsMenu(false);
  }, [bucketName, prefix]);

  useEffect(() => {
    setShowToolbarMoreMenu(false);
  }, [bucketName, prefix, selectedIds]);

  useEffect(() => {
    setShowCorsActionPopover(false);
  }, [accountIdForApi, bucketName]);

  useEffect(() => {
    bucketInspectorRequestIdRef.current += 1;
    setBucketInspectorLoading(false);
    setBucketInspectorError(null);
  }, [bucketName, hasS3AccountContext]);

  useEffect(() => {
    if (!showBucketMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (
        bucketMenuRef.current &&
        !bucketMenuRef.current.contains(event.target as Node)
      ) {
        setShowBucketMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowBucketMenu(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showBucketMenu]);

  useEffect(() => {
    if (showBucketMenu) {
      bucketMenuFilterRef.current?.focus();
    }
  }, [showBucketMenu]);

  useEffect(() => {
    const queuedBuckets = bucketAccessQueuedRef.current;
    const abortControllers = bucketAccessAbortControllersRef.current;
    return () => {
      bucketAccessSessionRef.current += 1;
      bucketAccessQueueRef.current = [];
      queuedBuckets.clear();
      abortControllers.forEach((controller) => controller.abort());
      abortControllers.clear();
      bucketAccessInFlightRef.current = 0;
      if (bucketSearchDebounceRef.current !== null) {
        window.clearTimeout(bucketSearchDebounceRef.current);
        bucketSearchDebounceRef.current = null;
      }
      if (objectsSearchDebounceRef.current !== null) {
        window.clearTimeout(objectsSearchDebounceRef.current);
        objectsSearchDebounceRef.current = null;
      }
      objectsAbortControllerRef.current?.abort();
      objectsAbortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!showSearchOptionsMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (searchOptionsButtonRef.current?.contains(event.target as Node)) {
        return;
      }
      if (
        searchOptionsMenuRef.current &&
        !searchOptionsMenuRef.current.contains(event.target as Node)
      ) {
        setShowSearchOptionsMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowSearchOptionsMenu(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSearchOptionsMenu]);

  useEffect(() => {
    if (!showCorsActionPopover) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (corsActionTriggerRef.current?.contains(target)) return;
      if (corsActionPopoverRef.current?.contains(target)) return;
      setShowCorsActionPopover(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowCorsActionPopover(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showCorsActionPopover]);

  useEffect(() => {
    if (!showToolbarMoreMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (toolbarMoreButtonRef.current?.contains(target)) return;
      if (toolbarMoreMenuRef.current?.contains(target)) return;
      if (toolbarColumnsButtonRef.current?.contains(target)) return;
      if (toolbarColumnsMenuRef.current?.contains(target)) return;
      setShowToolbarColumnsMenu(false);
      setShowToolbarMoreMenu(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowToolbarColumnsMenu(false);
        setShowToolbarMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showToolbarMoreMenu]);

  useEffect(() => {
    if (!showUploadQuickMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (uploadQuickButtonRef.current?.contains(target)) return;
      if (uploadQuickMenuRef.current?.contains(target)) return;
      setShowUploadQuickMenu(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowUploadQuickMenu(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showUploadQuickMenu]);

  useEffect(() => {
    setShowToolbarMoreMenu(false);
    setShowUploadQuickMenu(false);
  }, [showActionBar]);

  useEffect(() => {
    if (!hasCorsAction) {
      setShowCorsActionPopover(false);
    }
  }, [hasCorsAction]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target as Node)
      ) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    const handleScroll = () => {
      setContextMenu(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu || typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      repositionContextMenu();
    });
    window.addEventListener("resize", repositionContextMenu);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", repositionContextMenu);
    };
  }, [contextMenu, repositionContextMenu]);

  useEffect(() => {
    if (operations.length === 0) return;
    const knownIds = operationIdsRef.current;
    const newOps = operations.filter((op) => !knownIds.has(op.id));
    if (newOps.length === 0) return;
    newOps.forEach((op) => knownIds.add(op.id));
    const primaryOps = newOps.filter((op) => op.kind !== "upload");
    if (primaryOps.length === 0) return;
    const latest = primaryOps[0];
    setStatusMessage(`Queued: ${latest.label}.`);
  }, [operations]);

  useEffect(() => {
    contextCountIdRef.current += 1;
    setContextCounts(null);
    setContextCountsError(null);
    setContextCountsLoading(false);
  }, [bucketName, prefix]);

  const refreshBucketList = useCallback(
    async (options?: { preferredBucket?: string | null }) => {
      resetBucketAccessQueue();
      if (isMainBrowserPath) {
        browserRootSelectionPersistenceReadyRef.current = false;
        browserRootSelectionContextIdRef.current = browserRootContextId;
      }
      if (!hasS3AccountContext) {
        setBucketMenuItems([]);
        setBucketMenuPage(1);
        setBucketMenuHasNext(false);
        setBucketMenuTotal(0);
        setBucketTotalCount(0);
        bucketSearchValueRef.current = "";
        setBucketAccessByName({});
        setBucketName("");
        setPrefix("");
        setDeletedObjects([]);
        setDeletedPrefixes([]);
        setDeletedObjectsNextKeyMarker(null);
        setDeletedObjectsNextVersionIdMarker(null);
        setDeletedObjectsIsTruncated(false);
        return;
      }
      setLoadingBuckets(true);
      setBucketMenuLoadingMore(false);
      setBucketError(null);
      try {
        const firstPage = await searchBrowserBuckets(accountIdForApi, {
          page: 1,
          pageSize: BUCKET_MENU_LIMIT,
        });
        bucketSearchValueRef.current = "";
        setBucketMenuItems(firstPage.items);
        setBucketMenuPage(firstPage.page);
        setBucketMenuHasNext(firstPage.has_next);
        setBucketMenuTotal(firstPage.total);
        setBucketTotalCount(firstPage.total);
        const previousBucket = bucketNameRef.current;
        const previousPrefix = prefixRef.current;
        const preferredBucket = options?.preferredBucket?.trim() ?? "";
        const storedSelection = isMainBrowserPath
          ? readBrowserRootContextSelection(browserRootContextId)
          : null;
        const exactMatchCache = new Map<string, boolean>();

        const bucketExists = async (value: string): Promise<boolean> => {
          if (!value) return false;
          if (exactMatchCache.has(value)) {
            return Boolean(exactMatchCache.get(value));
          }
          const includedInFirstPage = firstPage.items.some(
            (bucket) => bucket.name === value,
          );
          if (includedInFirstPage) {
            exactMatchCache.set(value, true);
            return true;
          }
          const exactResult = await searchBrowserBuckets(accountIdForApi, {
            search: value,
            exact: true,
            page: 1,
            pageSize: 1,
          });
          const exists = exactResult.total > 0;
          exactMatchCache.set(value, exists);
          return exists;
        };

        let nextBucket = "";
        let nextPrefix = previousPrefix;
        let bucketSource:
          | "preferred"
          | "requested"
          | "stored"
          | "previous"
          | "single"
          | "ceph-requested"
          | "none" = "none";
        if (preferredBucket && (await bucketExists(preferredBucket))) {
          nextBucket = preferredBucket;
          bucketSource = "preferred";
        } else if (isCephAdminContext && requestedBucket) {
          nextBucket = requestedBucket;
          bucketSource = "ceph-requested";
        } else if (requestedBucket && (await bucketExists(requestedBucket))) {
          nextBucket = requestedBucket;
          bucketSource = "requested";
        } else if (
          storedSelection?.bucketName &&
          (await bucketExists(storedSelection.bucketName))
        ) {
          nextBucket = storedSelection.bucketName;
          nextPrefix = normalizePrefix(storedSelection.prefix);
          bucketSource = "stored";
        } else if (previousBucket && (await bucketExists(previousBucket))) {
          nextBucket = previousBucket;
          bucketSource = "previous";
        } else if (firstPage.total === 1 && firstPage.items.length === 1) {
          nextBucket = firstPage.items[0].name;
          bucketSource = "single";
        }
        if (bucketSource !== "stored") {
          nextPrefix =
            bucketSource === "preferred" ||
            bucketSource === "requested" ||
            bucketSource === "ceph-requested" ||
            nextBucket !== previousBucket
              ? ""
              : previousPrefix;
        }
        setBucketName(nextBucket);
        setPrefix(nextPrefix);
        if (isMainBrowserPath) {
          browserRootSelectionContextIdRef.current = browserRootContextId;
          browserRootSelectionPersistenceReadyRef.current = true;
        }
      } catch (err) {
        bucketSearchValueRef.current = "";
        setBucketError(
          extractApiError(err, "Unable to list buckets for this account."),
        );
        setBucketMenuItems([]);
        setBucketMenuPage(1);
        setBucketMenuHasNext(false);
        setBucketMenuTotal(0);
        setBucketTotalCount(0);
        if (isCephAdminContext && requestedBucket) {
          setBucketName(requestedBucket);
        } else {
          setBucketName("");
        }
        setPrefix("");
        setDeletedObjects([]);
        setDeletedPrefixes([]);
        setDeletedObjectsNextKeyMarker(null);
        setDeletedObjectsNextVersionIdMarker(null);
        setDeletedObjectsIsTruncated(false);
        browserRootSelectionContextIdRef.current = browserRootContextId;
      } finally {
        setLoadingBuckets(false);
      }
    },
    [
      accountIdForApi,
      browserRootContextId,
      hasS3AccountContext,
      isCephAdminContext,
      isMainBrowserPath,
      requestedBucket,
      resetBucketAccessQueue,
    ],
  );

  useEffect(() => {
    void refreshBucketList();
  }, [accessMode, refreshBucketList]);

  const loadBucketSearchPage = useCallback(
    async (options?: { search?: string; page?: number; append?: boolean }) => {
      if (!hasS3AccountContext) {
        setBucketMenuItems([]);
        setBucketMenuPage(1);
        setBucketMenuHasNext(false);
        setBucketMenuTotal(0);
        return;
      }
      const searchValue = (options?.search ?? "").trim();
      const targetPage = Math.max(1, options?.page ?? 1);
      const append = Boolean(options?.append && targetPage > 1);
      if (!append) {
        resetBucketAccessQueue();
      }
      const requestId = bucketSearchRequestIdRef.current + 1;
      bucketSearchRequestIdRef.current = requestId;
      if (append) {
        setBucketMenuLoadingMore(true);
      } else {
        setLoadingBuckets(true);
      }
      setBucketError(null);
      try {
        const data = await searchBrowserBuckets(accountIdForApi, {
          search: searchValue || undefined,
          page: targetPage,
          pageSize: BUCKET_MENU_LIMIT,
        });
        if (requestId !== bucketSearchRequestIdRef.current) {
          return;
        }
        bucketSearchValueRef.current = searchValue;
        setBucketMenuItems((prev) => {
          return mergeBucketSearchItems(prev, data.items, append);
        });
        setBucketMenuPage(data.page);
        setBucketMenuHasNext(data.has_next);
        setBucketMenuTotal(data.total);
        if (!searchValue) {
          setBucketTotalCount(data.total);
        }
      } catch (err) {
        if (requestId !== bucketSearchRequestIdRef.current) {
          return;
        }
        setBucketError(
          extractApiError(err, "Unable to list buckets for this account."),
        );
        if (!append) {
          setBucketMenuItems([]);
          setBucketMenuPage(1);
          setBucketMenuHasNext(false);
          setBucketMenuTotal(0);
        }
      } finally {
        const isLatestRequest = requestId === bucketSearchRequestIdRef.current;
        if (isLatestRequest) {
          if (append) {
            setBucketMenuLoadingMore(false);
          } else {
            setLoadingBuckets(false);
          }
        }
      }
    },
    [accountIdForApi, hasS3AccountContext, resetBucketAccessQueue],
  );

  const bucketSearchUiActive =
    showBucketMenu || (isMainBrowserPath && isFoldersPanelVisible);

  useEffect(() => {
    if (!bucketSearchUiActive) return;
    const nextSearchValue = bucketFilter.trim();
    if (nextSearchValue === bucketSearchValueRef.current) {
      return;
    }
    if (bucketSearchDebounceRef.current !== null) {
      window.clearTimeout(bucketSearchDebounceRef.current);
      bucketSearchDebounceRef.current = null;
    }
    bucketSearchDebounceRef.current = window.setTimeout(() => {
      void loadBucketSearchPage({
        search: nextSearchValue,
        page: 1,
        append: false,
      });
    }, BROWSER_QUERY_DEBOUNCE_MS);
    return () => {
      if (bucketSearchDebounceRef.current !== null) {
        window.clearTimeout(bucketSearchDebounceRef.current);
        bucketSearchDebounceRef.current = null;
      }
    };
  }, [
    bucketFilter,
    bucketSearchUiActive,
    isFoldersPanelVisible,
    isMainBrowserPath,
    loadBucketSearchPage,
  ]);

  useEffect(() => {
    if (!hasS3AccountContext || !accountIdForApi) {
      setBrowserSettings(null);
      return;
    }
    let isMounted = true;
    fetchBrowserSettings(accountIdForApi)
      .then((data) => {
        if (isMounted) {
          setBrowserSettings(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setBrowserSettings(null);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, accessMode, hasS3AccountContext]);

  const listDeletedObjectsForPrefix = useCallback(
    async (
      targetPrefix: string,
      existingObjects: BrowserObject[],
      existingPrefixes: string[],
      queryValue: string,
      opts?: {
        recursive?: boolean;
        exactMatch?: boolean;
        caseSensitive?: boolean;
        keyMarker?: string | null;
        versionIdMarker?: string | null;
      },
    ) => {
      if (
        !bucketName ||
        !hasS3AccountContext ||
        !isVersioningEnabled ||
        !showDeletedObjects
      ) {
        return {
          deletedObjects: [] as BrowserObject[],
          deletedPrefixes: [] as string[],
          nextKeyMarker: null as string | null,
          nextVersionIdMarker: null as string | null,
          isTruncated: false,
        };
      }
      if (storageFilter !== "all") {
        return {
          deletedObjects: [] as BrowserObject[],
          deletedPrefixes: [] as string[],
          nextKeyMarker: null as string | null,
          nextVersionIdMarker: null as string | null,
          isTruncated: false,
        };
      }
      const activeKeys = new Set(existingObjects.map((item) => item.key));
      const activePrefixes = new Set(existingPrefixes);
      const latestMarkersByKey = new Map<string, BrowserObjectVersion>();
      const markerPrefixes = new Set<string>();
      const isRecursiveSearch = Boolean(opts?.recursive);
      const exactMatch = Boolean(opts?.exactMatch);
      const caseSensitive = Boolean(opts?.caseSensitive);
      const normalizedQuery = caseSensitive
        ? queryValue
        : queryValue.toLowerCase();

      const matchesQuery = (key: string) => {
        if (!normalizedQuery) return true;
        let relative = key;
        if (targetPrefix && relative.startsWith(targetPrefix)) {
          relative = relative.slice(targetPrefix.length);
        }
        if (relative.endsWith("/")) {
          relative = relative.slice(0, -1);
        }
        const comparable = caseSensitive ? relative : relative.toLowerCase();
        if (exactMatch) {
          return comparable === normalizedQuery;
        }
        return comparable.includes(normalizedQuery);
      };

      const data = await listObjectVersions(accountIdForApi, bucketName, {
        prefix: targetPrefix,
        keyMarker: opts?.keyMarker ?? undefined,
        versionIdMarker: opts?.versionIdMarker ?? undefined,
        maxKeys: VERSIONS_PAGE_SIZE,
      });
      data.delete_markers.forEach((marker) => {
        if (!marker.is_latest) return;
        if (!marker.key || !marker.key.startsWith(targetPrefix)) return;
        const relative = marker.key.slice(targetPrefix.length);
        if (!relative) return;
        const isFolderMarker = marker.key.endsWith("/");
        if (relative.includes("/") && !isRecursiveSearch) {
          if (typeFilter === "file") return;
          const child = relative.split("/")[0];
          if (!child) return;
          const childPrefix = `${targetPrefix}${child}/`;
          if (activePrefixes.has(childPrefix)) return;
          if (!matchesQuery(childPrefix)) return;
          markerPrefixes.add(childPrefix);
          return;
        }
        if (typeFilter !== "file") {
          if (isRecursiveSearch) {
            const segments = relative.split("/").filter(Boolean);
            if (segments.length > 1) {
              let running = targetPrefix;
              for (const segment of segments.slice(0, -1)) {
                running = `${running}${segment}/`;
                if (activePrefixes.has(running)) continue;
                if (!matchesQuery(running)) continue;
                markerPrefixes.add(running);
              }
            }
            if (isFolderMarker) {
              if (!activePrefixes.has(marker.key) && matchesQuery(marker.key)) {
                markerPrefixes.add(marker.key);
              }
            }
          }
        }
        if (typeFilter === "folder") return;
        if (isFolderMarker) return;
        if (activeKeys.has(marker.key)) return;
        if (!matchesQuery(marker.key)) return;
        latestMarkersByKey.set(marker.key, marker);
      });

      const deletedObjectRows = Array.from(latestMarkersByKey.values())
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((marker) => ({
          key: marker.key,
          size: 0,
          last_modified: marker.last_modified ?? null,
          etag: null,
          storage_class: null,
          is_delete_marker: true,
          version_id: marker.version_id ?? null,
        }));
      const deletedFolderRows = Array.from(markerPrefixes.values()).sort((a, b) =>
        a.localeCompare(b),
      );
      const nextKeyMarker = data.next_key_marker ?? null;
      const nextVersionIdMarker = data.next_version_id_marker ?? null;
      return {
        deletedObjects: deletedObjectRows,
        deletedPrefixes: deletedFolderRows,
        nextKeyMarker,
        nextVersionIdMarker,
        isTruncated: Boolean(
          data.is_truncated && (nextKeyMarker || nextVersionIdMarker),
        ),
      };
    },
    [
      accountIdForApi,
      bucketName,
      hasS3AccountContext,
      isVersioningEnabled,
      showDeletedObjects,
      storageFilter,
      typeFilter,
    ],
  );

  const loadObjects = useCallback(
    async (opts?: {
      append?: boolean;
      continuationToken?: string | null;
      prefixOverride?: string;
      silent?: boolean;
      loadDeletedOnly?: boolean;
    }) => {
      if (!bucketName || !hasS3AccountContext) return;
      const targetPrefix = normalizePrefix(opts?.prefixOverride ?? prefix);
      const isAppend = Boolean(opts?.append);
      const isSilent = Boolean(opts?.silent);
      const loadDeletedOnly = Boolean(opts?.loadDeletedOnly);
      const { requestSeq, controller } = prepareLatestRequest(
        objectsAbortControllerRef.current,
        objectsRequestSeqRef.current,
      );
      objectsRequestSeqRef.current = requestSeq;
      objectsAbortControllerRef.current = controller;
      if (!isAppend) {
        if (!isSilent) {
          setObjectsLoading(true);
          setObjectsLoadingMore(false);
          setObjectsIssue(null);
          setShowObjectsIssueTechnicalDetails(false);
        }
      } else {
        setObjectsLoadingMore(true);
      }
      const query = filter.trim();
      const searchFromBucket = searchScope === "bucket" && Boolean(query);
      const requestPrefix = searchFromBucket ? "" : targetPrefix;
      const requestRecursive =
        Boolean(query) && (searchFromBucket || searchRecursive);
      try {
        let loadedObjects: BrowserObject[] = [];
        let loadedPrefixes: string[] = [];
        let loadedObjectsNextToken: string | null = null;
        let loadedObjectsTruncated = false;

        if (!loadDeletedOnly) {
          const data = await listBrowserObjects(accountIdForApi, bucketName, {
            prefix: requestPrefix,
            continuationToken: opts?.continuationToken ?? undefined,
            maxKeys: OBJECTS_PAGE_SIZE,
            query: query || undefined,
            exactMatch: searchExactMatch,
            caseSensitive: searchCaseSensitive,
            type: typeFilter,
            storageClass: storageFilter,
            recursive: requestRecursive,
            sortBy: backendSortBy,
            sortDir: sortDirection,
            signal: controller.signal,
          });
          if (isStaleRequest(requestSeq, objectsRequestSeqRef.current)) {
            return;
          }
          loadedObjects = data.objects;
          loadedPrefixes = data.prefixes;
          loadedObjectsNextToken = data.next_continuation_token ?? null;
          loadedObjectsTruncated = Boolean(data.is_truncated);
          setObjectsIssue(null);
          setShowObjectsIssueTechnicalDetails(false);
          updateBucketAccessEntry(bucketName, {
            status: "available",
            detail: null,
          });
        }

        const currentObjects = objectsRef.current;
        const currentPrefixes = prefixesRef.current;
        const currentDeletedObjects = deletedObjectsRef.current;
        const currentDeletedPrefixes = deletedPrefixesRef.current;
        const currentDeletedKeyMarker = deletedObjectsNextKeyMarkerRef.current;
        const currentDeletedVersionIdMarker =
          deletedObjectsNextVersionIdMarkerRef.current;
        const currentDeletedTruncated = deletedObjectsIsTruncatedRef.current;
        const mergedObjects = isAppend
          ? [...currentObjects, ...loadedObjects]
          : loadedObjects;
        const mergedPrefixesRaw = isAppend
          ? Array.from(new Set([...currentPrefixes, ...loadedPrefixes]))
          : loadedPrefixes;
        const objectsLimitReached =
          mergedObjects.length > OBJECTS_LIST_HARD_LIMIT;
        const prefixesLimitReached =
          mergedPrefixesRaw.length > OBJECTS_LIST_HARD_LIMIT;
        const boundedObjects = mergedObjects.slice(0, OBJECTS_LIST_HARD_LIMIT);
        const boundedPrefixes = mergedPrefixesRaw.slice(
          0,
          OBJECTS_LIST_HARD_LIMIT,
        );

        const shouldLoadDeleted =
          showDeletedObjects && isVersioningEnabled && storageFilter === "all";
        let nextDeletedObjects = isAppend ? currentDeletedObjects : [];
        let nextDeletedPrefixes = isAppend ? currentDeletedPrefixes : [];
        let nextDeletedKeyMarker = isAppend ? currentDeletedKeyMarker : null;
        let nextDeletedVersionIdMarker = isAppend
          ? currentDeletedVersionIdMarker
          : null;
        let nextDeletedTruncated = isAppend ? currentDeletedTruncated : false;
        let deletedLimitReached = false;

        if (shouldLoadDeleted) {
          try {
            const deletedResult = await listDeletedObjectsForPrefix(
              requestPrefix,
              boundedObjects,
              boundedPrefixes,
              query,
              {
                recursive: requestRecursive,
                exactMatch: searchExactMatch,
                caseSensitive: searchCaseSensitive,
                keyMarker: isAppend ? currentDeletedKeyMarker : null,
                versionIdMarker: isAppend
                  ? currentDeletedVersionIdMarker
                  : null,
              },
            );
            if (isStaleRequest(requestSeq, objectsRequestSeqRef.current)) {
              return;
            }
            const deletedObjectsMerged = isAppend
              ? mergeDeletedObjectsWithLimit(
                  currentDeletedObjects,
                  deletedResult.deletedObjects,
                  OBJECTS_LIST_HARD_LIMIT,
                )
              : {
                  items: deletedResult.deletedObjects.slice(
                    0,
                    OBJECTS_LIST_HARD_LIMIT,
                  ),
                  limitReached:
                    deletedResult.deletedObjects.length >
                    OBJECTS_LIST_HARD_LIMIT,
                };
            const deletedPrefixesMerged = isAppend
              ? mergeUniqueStringsWithLimit(
                  currentDeletedPrefixes,
                  deletedResult.deletedPrefixes,
                  OBJECTS_LIST_HARD_LIMIT,
                )
              : {
                  items: deletedResult.deletedPrefixes.slice(
                    0,
                    OBJECTS_LIST_HARD_LIMIT,
                  ),
                  limitReached:
                    deletedResult.deletedPrefixes.length >
                    OBJECTS_LIST_HARD_LIMIT,
                };
            deletedLimitReached =
              deletedObjectsMerged.limitReached ||
              deletedPrefixesMerged.limitReached;
            nextDeletedObjects = deletedObjectsMerged.items;
            nextDeletedPrefixes = deletedPrefixesMerged.items;
            if (deletedLimitReached) {
              nextDeletedKeyMarker = null;
              nextDeletedVersionIdMarker = null;
              nextDeletedTruncated = false;
            } else {
              nextDeletedKeyMarker = deletedResult.nextKeyMarker;
              nextDeletedVersionIdMarker = deletedResult.nextVersionIdMarker;
              nextDeletedTruncated = deletedResult.isTruncated;
            }
          } catch {
            if (!isAppend) {
              nextDeletedObjects = [];
              nextDeletedPrefixes = [];
              nextDeletedKeyMarker = null;
              nextDeletedVersionIdMarker = null;
              nextDeletedTruncated = false;
            }
          }
        } else {
          nextDeletedObjects = [];
          nextDeletedPrefixes = [];
          nextDeletedKeyMarker = null;
          nextDeletedVersionIdMarker = null;
          nextDeletedTruncated = false;
        }

        if (isStaleRequest(requestSeq, objectsRequestSeqRef.current)) {
          return;
        }

        setObjects(boundedObjects);
        setPrefixes(boundedPrefixes);
        setDeletedObjects(nextDeletedObjects);
        setDeletedPrefixes(nextDeletedPrefixes);
        setDeletedObjectsNextKeyMarker(nextDeletedKeyMarker);
        setDeletedObjectsNextVersionIdMarker(nextDeletedVersionIdMarker);
        setDeletedObjectsIsTruncated(nextDeletedTruncated);

        if (objectsLimitReached || prefixesLimitReached) {
          setObjectsNextToken(null);
          setObjectsIsTruncated(false);
          setWarningMessage(
            `Object listing is limited to ${OBJECTS_LIST_HARD_LIMIT.toLocaleString()} entries. Narrow your path or search to continue.`,
          );
        } else {
          setObjectsNextToken(loadedObjectsNextToken);
          setObjectsIsTruncated(!loadDeletedOnly && loadedObjectsTruncated);
        }
        if (deletedLimitReached) {
          setWarningMessage(
            `Deleted markers listing is limited to ${OBJECTS_LIST_HARD_LIMIT.toLocaleString()} entries. Narrow your path or search to continue.`,
          );
        }
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
        if (isStaleRequest(requestSeq, objectsRequestSeqRef.current)) {
          return;
        }
        const issue = normalizeBrowserListingIssue(
          err,
          "Unable to list objects for this prefix.",
        );
        const previousAccess = resolveBucketAccessEntry(
          bucketName,
          bucketAccessByNameRef.current,
        );
        if (issue.kind === "access_denied") {
          updateBucketAccessEntry(bucketName, {
            status: "unavailable",
            detail: issue.technicalDetail,
          });
        } else if (
          previousAccess.status === "unavailable" ||
          previousAccess.status === "checking"
        ) {
          updateBucketAccessEntry(bucketName, UNKNOWN_BUCKET_ACCESS);
        }
        setObjectsIssue(issue);
        setShowObjectsIssueTechnicalDetails(false);
      } finally {
        if (objectsAbortControllerRef.current === controller) {
          objectsAbortControllerRef.current = null;
        }
        const isLatestRequest = !isStaleRequest(
          requestSeq,
          objectsRequestSeqRef.current,
        );
        if (isLatestRequest) {
          if (!isAppend) {
            if (!isSilent) {
              setObjectsLoading(false);
            }
          } else {
            setObjectsLoadingMore(false);
          }
        }
      }
    },
    [
      accountIdForApi,
      backendSortBy,
      bucketName,
      filter,
      hasS3AccountContext,
      isVersioningEnabled,
      listDeletedObjectsForPrefix,
      prefix,
      searchCaseSensitive,
      searchExactMatch,
      searchRecursive,
      searchScope,
      showDeletedObjects,
      storageFilter,
      sortDirection,
      typeFilter,
      updateBucketAccessEntry,
    ],
  );

  const loadPrefixVersions = useCallback(
    async (opts?: {
      append?: boolean;
      keyMarker?: string | null;
      versionIdMarker?: string | null;
    }) => {
      if (!bucketName || !hasS3AccountContext || !isVersioningEnabled) return;
      if (!opts?.append) {
        setPrefixVersionsLoading(true);
        setPrefixVersionsError(null);
      } else {
        setPrefixVersionsLoading(true);
      }
      const resolvedKeyMarker =
        opts?.keyMarker !== undefined
          ? opts.keyMarker
          : prefixVersionKeyMarkerRef.current;
      const resolvedVersionIdMarker =
        opts?.versionIdMarker !== undefined
          ? opts.versionIdMarker
          : prefixVersionIdMarkerRef.current;
      try {
        const data = await listObjectVersions(accountIdForApi, bucketName, {
          prefix: normalizedPrefix,
          keyMarker: resolvedKeyMarker ?? undefined,
          versionIdMarker: resolvedVersionIdMarker ?? undefined,
          maxKeys: VERSIONS_PAGE_SIZE,
        });
        const mergedVersions = opts?.append
          ? [...prefixVersionsRef.current, ...data.versions]
          : data.versions;
        const mergedDeleteMarkers = opts?.append
          ? [...prefixDeleteMarkersRef.current, ...data.delete_markers]
          : data.delete_markers;
        const versionsLimitReached =
          mergedVersions.length > VERSIONS_LIST_HARD_LIMIT ||
          mergedDeleteMarkers.length > VERSIONS_LIST_HARD_LIMIT;
        setPrefixVersions(mergedVersions.slice(0, VERSIONS_LIST_HARD_LIMIT));
        setPrefixDeleteMarkers(
          mergedDeleteMarkers.slice(0, VERSIONS_LIST_HARD_LIMIT),
        );
        if (versionsLimitReached) {
          setPrefixVersionKeyMarker(null);
          setPrefixVersionIdMarker(null);
          setWarningMessage(
            `Versions listing is limited to ${VERSIONS_LIST_HARD_LIMIT.toLocaleString()} entries. Narrow your path to continue.`,
          );
        } else {
          setPrefixVersionKeyMarker(data.next_key_marker ?? null);
          setPrefixVersionIdMarker(data.next_version_id_marker ?? null);
        }
      } catch (err) {
        setPrefixVersionsError(
          extractApiError(err, "Unable to list versions for this prefix."),
        );
        if (!opts?.append) {
          setPrefixVersions([]);
          setPrefixDeleteMarkers([]);
        }
      } finally {
        setPrefixVersionsLoading(false);
      }
    },
    [accountIdForApi, bucketName, hasS3AccountContext, isVersioningEnabled, normalizedPrefix],
  );

  const loadObjectVersions = useCallback(
    async (opts?: {
      append?: boolean;
      keyMarker?: string | null;
      versionIdMarker?: string | null;
      targetKey?: string | null;
    }) => {
      if (!bucketName || !hasS3AccountContext || !isVersioningEnabled) return;
      const targetKey = opts?.targetKey ?? inspectedItemRef.current?.key ?? null;
      if (!targetKey) return;
      if (!opts?.append) {
        setObjectVersionsLoading(true);
        setObjectVersionsError(null);
        setObjectVersionsTargetKey(targetKey);
        objectVersionsTargetKeyRef.current = targetKey;
      } else {
        setObjectVersionsLoading(true);
      }
      const resolvedKeyMarker =
        opts?.keyMarker !== undefined
          ? opts.keyMarker
          : objectVersionKeyMarkerRef.current;
      const resolvedVersionIdMarker =
        opts?.versionIdMarker !== undefined
          ? opts.versionIdMarker
          : objectVersionIdMarkerRef.current;
      try {
        const data = await listObjectVersions(accountIdForApi, bucketName, {
          key: targetKey,
          keyMarker: resolvedKeyMarker ?? undefined,
          versionIdMarker: resolvedVersionIdMarker ?? undefined,
          maxKeys: VERSIONS_PAGE_SIZE,
        });
        if (objectVersionsTargetKeyRef.current !== targetKey) {
          return;
        }
        const mergedVersions = opts?.append
          ? [...objectVersionsRef.current, ...data.versions]
          : data.versions;
        const mergedDeleteMarkers = opts?.append
          ? [...objectDeleteMarkersRef.current, ...data.delete_markers]
          : data.delete_markers;
        const versionsLimitReached =
          mergedVersions.length > VERSIONS_LIST_HARD_LIMIT ||
          mergedDeleteMarkers.length > VERSIONS_LIST_HARD_LIMIT;
        setObjectVersions(mergedVersions.slice(0, VERSIONS_LIST_HARD_LIMIT));
        setObjectDeleteMarkers(
          mergedDeleteMarkers.slice(0, VERSIONS_LIST_HARD_LIMIT),
        );
        if (versionsLimitReached) {
          setObjectVersionKeyMarker(null);
          setObjectVersionIdMarker(null);
          setWarningMessage(
            `Versions listing is limited to ${VERSIONS_LIST_HARD_LIMIT.toLocaleString()} entries. Narrow your path to continue.`,
          );
        } else {
          setObjectVersionKeyMarker(data.next_key_marker ?? null);
          setObjectVersionIdMarker(data.next_version_id_marker ?? null);
        }
      } catch (err) {
        if (objectVersionsTargetKeyRef.current !== targetKey) {
          return;
        }
        setObjectVersionsError(
          extractApiError(err, "Unable to list versions for this object."),
        );
        if (!opts?.append) {
          setObjectVersions([]);
          setObjectDeleteMarkers([]);
        }
      } finally {
        if (objectVersionsTargetKeyRef.current === targetKey) {
          setObjectVersionsLoading(false);
        }
      }
    },
    [accountIdForApi, bucketName, hasS3AccountContext, isVersioningEnabled],
  );

  useLayoutEffect(() => {
    if (previousAccountIdRef.current === accountIdForApi) {
      return;
    }
    previousAccountIdRef.current = accountIdForApi;
    browserRootSelectionPersistenceReadyRef.current = false;
    browserRootSelectionContextIdRef.current = browserRootContextId;
    // Clear selection synchronously on context switch so bucket-scoped effects
    // don't issue stale requests with the next credentials.
    bucketNameRef.current = "";
    prefixRef.current = "";
    setBucketName("");
    setPrefix("");
    setActiveItem(null);
    setDeletedObjects([]);
    setDeletedPrefixes([]);
    setDeletedObjectsNextKeyMarker(null);
    setDeletedObjectsNextVersionIdMarker(null);
    setDeletedObjectsIsTruncated(false);
  }, [accountIdForApi, browserRootContextId]);

  useEffect(() => {
    const resetObjectListingState = () => {
      setObjects([]);
      setDeletedObjects([]);
      setDeletedPrefixes([]);
      setDeletedObjectsNextKeyMarker(null);
      setDeletedObjectsNextVersionIdMarker(null);
      setDeletedObjectsIsTruncated(false);
      setPrefixes([]);
      setObjectsNextToken(null);
      setObjectsIsTruncated(false);
      setObjectsIssue(null);
      setShowObjectsIssueTechnicalDetails(false);
      setObjectsLoadingMore(false);
    };

    if (accountSwitchInFlight) {
      objectsAbortControllerRef.current?.abort();
      objectsAbortControllerRef.current = null;
      objectsNavigationKeyRef.current = null;
      return;
    }
    if (objectsSearchDebounceRef.current !== null) {
      window.clearTimeout(objectsSearchDebounceRef.current);
      objectsSearchDebounceRef.current = null;
    }
    if (!bucketName || !hasS3AccountContext) {
      objectsAbortControllerRef.current?.abort();
      objectsAbortControllerRef.current = null;
      objectsNavigationKeyRef.current = null;
      resetObjectListingState();
      setObjectsLoading(false);
      return;
    }
    const navigationKey = `${String(accountIdForApi ?? "")}::${String(accessMode ?? "")}::${bucketName}::${normalizedPrefix}::${sortId}`;
    const shouldLoadImmediately =
      objectsNavigationKeyRef.current !== navigationKey;
    objectsNavigationKeyRef.current = navigationKey;
    if (shouldLoadImmediately) {
      resetObjectListingState();
      setObjectsLoading(true);
      void loadObjects({ prefixOverride: normalizedPrefix });
      return;
    }
    objectsSearchDebounceRef.current = window.setTimeout(() => {
      void loadObjects({ prefixOverride: normalizedPrefix });
    }, BROWSER_QUERY_DEBOUNCE_MS);
    return () => {
      if (objectsSearchDebounceRef.current !== null) {
        window.clearTimeout(objectsSearchDebounceRef.current);
        objectsSearchDebounceRef.current = null;
      }
    };
  }, [
    accountIdForApi,
    accessMode,
    accountSwitchInFlight,
    bucketName,
    filter,
    hasS3AccountContext,
    isVersioningEnabled,
    normalizedPrefix,
    searchCaseSensitive,
    searchExactMatch,
    searchRecursive,
    searchScope,
    showDeletedObjects,
    storageFilter,
    sortId,
    typeFilter,
    loadObjects,
  ]);

  useEffect(() => {
    if (filter.trim()) return;
    if (searchScope !== "prefix") {
      setSearchScope("prefix");
    }
    if (searchRecursive) {
      setSearchRecursive(false);
    }
    if (searchExactMatch) {
      setSearchExactMatch(false);
    }
    if (searchCaseSensitive) {
      setSearchCaseSensitive(false);
    }
  }, [
    filter,
    searchCaseSensitive,
    searchExactMatch,
    searchRecursive,
    searchScope,
  ]);

  useEffect(() => {
    if (
      !showPrefixVersions ||
      !bucketName ||
      !hasS3AccountContext ||
      !isVersioningEnabled
    ) {
      setPrefixVersions([]);
      setPrefixDeleteMarkers([]);
      setPrefixVersionsError(null);
      setPrefixVersionKeyMarker(null);
      setPrefixVersionIdMarker(null);
      return;
    }
    setPrefixVersionKeyMarker(null);
    setPrefixVersionIdMarker(null);
    loadPrefixVersions({
      append: false,
      keyMarker: null,
      versionIdMarker: null,
    });
  }, [
    accountIdForApi,
    accessMode,
    bucketName,
    hasS3AccountContext,
    isVersioningEnabled,
    loadPrefixVersions,
    normalizedPrefix,
    showPrefixVersions,
  ]);

  useEffect(() => {
    if (accountSwitchInFlight || !bucketName || !hasS3AccountContext) {
      setBucketVersioningEnabled(false);
      return;
    }
    let active = true;
    getBucketVersioning(accountIdForApi, bucketName)
      .then((data) => {
        if (!active) return;
        setBucketVersioningEnabled(Boolean(data.enabled));
      })
      .catch(() => {
        if (!active) return;
        setBucketVersioningEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [accountIdForApi, accountSwitchInFlight, bucketName, hasS3AccountContext]);

  useEffect(() => {
    if (isVersioningEnabled) return;
    setShowDeletedObjects(false);
    setDeletedObjects([]);
    setDeletedPrefixes([]);
    setDeletedObjectsNextKeyMarker(null);
    setDeletedObjectsNextVersionIdMarker(null);
    setDeletedObjectsIsTruncated(false);
    setShowPrefixVersions(false);
    setPrefixVersions([]);
    setPrefixDeleteMarkers([]);
    setPrefixVersionsError(null);
    setPrefixVersionKeyMarker(null);
    setPrefixVersionIdMarker(null);
    setObjectDetailsTarget((prev) =>
      prev?.initialTab === "versions" ? null : prev,
    );
  }, [bucketName, isVersioningEnabled]);

  useEffect(() => {
    if (showDeletedObjects) return;
    setDeletedObjects([]);
    setDeletedPrefixes([]);
    setDeletedObjectsNextKeyMarker(null);
    setDeletedObjectsNextVersionIdMarker(null);
    setDeletedObjectsIsTruncated(false);
  }, [showDeletedObjects]);

  const currentBucketAccess = useMemo<BucketAccessEntry>(
    () =>
      bucketName
        ? resolveBucketAccessEntry(bucketName, bucketAccessByName)
        : {
            status: "unknown",
            detail: null,
          },
    [bucketAccessByName, bucketName],
  );
  const currentBucketUnavailable = bucketName
    ? currentBucketAccess.status === "unavailable"
    : false;
  const objectsIssueDescription = useMemo<ReactNode>(() => {
    if (!objectsIssue) {
      return null;
    }
    return (
      <div className="space-y-2">
        <p>{objectsIssue.description}</p>
        <details
          open={showObjectsIssueTechnicalDetails}
          onToggle={(event) =>
            setShowObjectsIssueTechnicalDetails(event.currentTarget.open)
          }
          className="mx-auto max-w-xl rounded-md border border-rose-200/70 bg-rose-50/70 px-2 py-1.5 text-left dark:border-rose-500/30 dark:bg-rose-900/20"
        >
          <summary className="list-none cursor-pointer ui-caption font-semibold text-rose-700 dark:text-rose-100 [&::-webkit-details-marker]:hidden">
            Show technical details
          </summary>
          {showObjectsIssueTechnicalDetails && (
            <p className="mt-2 break-words ui-caption text-rose-700 dark:text-rose-100">
              {objectsIssue.technicalDetail}
            </p>
          )}
        </details>
      </div>
    );
  }, [objectsIssue, showObjectsIssueTechnicalDetails]);

  const listTreePrefixes = useCallback(
    async (targetPrefix: string) => {
      if (!bucketName || !hasS3AccountContext) {
        return { prefixes: [] as string[], truncated: false };
      }
      const prefixesCollected: string[] = [];
      let continuationToken: string | null = null;
      let hasMore = true;
      let pagesScanned = 0;

      while (
        hasMore &&
        pagesScanned < TREE_PREFIXES_PAGE_BUDGET &&
        prefixesCollected.length < TREE_PREFIXES_HARD_LIMIT
      ) {
        const data = await listBrowserObjects(accountIdForApi, bucketName, {
          prefix: targetPrefix,
          continuationToken: continuationToken ?? undefined,
          maxKeys: TREE_PREFIXES_PAGE_SIZE,
        });
        if (data.prefixes.length > 0) {
          prefixesCollected.push(...data.prefixes);
        }
        continuationToken = data.next_continuation_token ?? null;
        hasMore = Boolean(data.is_truncated && continuationToken);
        pagesScanned += 1;
      }

      const uniquePrefixes = Array.from(new Set(prefixesCollected));
      const reachedHardLimit = uniquePrefixes.length > TREE_PREFIXES_HARD_LIMIT;
      const truncated = hasMore || reachedHardLimit;
      return {
        prefixes: uniquePrefixes.slice(0, TREE_PREFIXES_HARD_LIMIT),
        truncated,
      };
    },
    [accountIdForApi, bucketName, hasS3AccountContext],
  );

  const loadTreeChildren = useCallback(
    async (targetPrefix: string, options?: { expand?: boolean }) => {
      if (!bucketName || !hasS3AccountContext || currentBucketUnavailable) return;
      const normalized = targetPrefix ? normalizePrefix(targetPrefix) : "";
      const shouldExpand = options?.expand ?? true;
      setTreeNodes((prev) =>
        updateTreeNodes(prev, targetPrefix, (node) => ({
          ...node,
          isLoading: true,
        })),
      );
      try {
        const data = await listTreePrefixes(normalized);
        const children = buildTreeNodes(data.prefixes, normalized);
        if (data.truncated) {
          setWarningMessage(
            `Folders panel is limited to ${TREE_PREFIXES_HARD_LIMIT.toLocaleString()} prefixes. Narrow the path to continue.`,
          );
        }
        setTreeNodes((prev) =>
          updateTreeNodes(prev, targetPrefix, (node) => ({
            ...node,
            children,
            isExpanded: shouldExpand ? true : node.isExpanded,
            isLoaded: true,
            isLoading: false,
          })),
        );
      } catch {
        setTreeNodes((prev) =>
          updateTreeNodes(prev, targetPrefix, (node) => ({
            ...node,
            isLoaded: true,
            isLoading: false,
          })),
        );
      }
    },
    [bucketName, currentBucketUnavailable, hasS3AccountContext, listTreePrefixes],
  );

  useEffect(() => {
    if (
      accountSwitchInFlight ||
      !bucketName ||
      !hasS3AccountContext ||
      currentBucketUnavailable
    ) {
      setTreeNodes([]);
      return;
    }
    let isMounted = true;
    const rootNode: TreeNode = {
      id: "root",
      name: bucketName,
      prefix: "",
      children: [],
      isExpanded: true,
      isLoaded: false,
      isLoading: true,
    };
    setTreeNodes([rootNode]);
    const loadRoot = async () => {
      try {
        const data = await listTreePrefixes("");
        if (!isMounted) return;
        const children = buildTreeNodes(data.prefixes, "");
        if (data.truncated) {
          setWarningMessage(
            `Folders panel is limited to ${TREE_PREFIXES_HARD_LIMIT.toLocaleString()} prefixes. Narrow the path to continue.`,
          );
        }
        setTreeNodes([
          {
            ...rootNode,
            children,
            isExpanded: true,
            isLoaded: true,
            isLoading: false,
          },
        ]);
      } catch {
        if (!isMounted) return;
        setTreeNodes([{ ...rootNode, isLoaded: true, isLoading: false }]);
      }
    };
    loadRoot();
    return () => {
      isMounted = false;
    };
  }, [
    accessMode,
    accountSwitchInFlight,
    bucketName,
    currentBucketUnavailable,
    hasS3AccountContext,
    listTreePrefixes,
  ]);

  useEffect(() => {
    if (
      !bucketName ||
      !hasS3AccountContext ||
      currentBucketUnavailable ||
      treeNodes.length === 0
    )
      return;
    const rootNode = treeNodes.find((node) => node.prefix === "");
    if (!rootNode || rootNode.isLoading) return;
    const targetPrefix = prefix ? normalizePrefix(prefix) : "";
    if (!targetPrefix) {
      if (!rootNode.isExpanded) {
        setTreeNodes((prev) =>
          updateTreeNodes(prev, "", (node) => ({ ...node, isExpanded: true })),
        );
      }
      return;
    }
    const segments = targetPrefix.split("/").filter(Boolean);
    let currentPrefix = "";
    const prefixesToExpand: string[] = [];
    for (const segment of segments) {
      currentPrefix = `${currentPrefix}${segment}/`;
      prefixesToExpand.push(currentPrefix);
      const node = findTreeNodeByPrefix(treeNodes, currentPrefix);
      if (!node) return;
      if (!node.isLoaded && !node.isLoading) {
        loadTreeChildren(currentPrefix);
        return;
      }
    }
    const prefixesNeedingExpansion = prefixesToExpand.filter((prefixKey) => {
      const node = findTreeNodeByPrefix(treeNodes, prefixKey);
      return Boolean(node && !node.isExpanded);
    });
    const needsRootExpansion = !rootNode.isExpanded;
    if (!needsRootExpansion && prefixesNeedingExpansion.length === 0) return;
    setTreeNodes((prev) => {
      let next = prev;
      if (needsRootExpansion) {
        next = updateTreeNodes(next, "", (node) => ({
          ...node,
          isExpanded: true,
        }));
      }
      prefixesNeedingExpansion.forEach((prefixKey) => {
        const node = findTreeNodeByPrefix(next, prefixKey);
        if (!node || node.isExpanded) return;
        next = updateTreeNodes(next, prefixKey, (entry) => ({
          ...entry,
          isExpanded: true,
        }));
      });
      return next;
    });
  }, [
    accessMode,
    bucketName,
    currentBucketUnavailable,
    hasS3AccountContext,
    loadTreeChildren,
    prefix,
    treeNodes,
  ]);

  useEffect(() => {
    if (accountSwitchInFlight || !bucketName || !hasS3AccountContext) {
      setCorsStatus(null);
      setUseProxyTransfers(false);
      return;
    }
    let isMounted = true;
    getBucketCorsStatus(accountIdForApi, bucketName, uiOrigin)
      .then((status) => {
        if (!isMounted) return;
        setCorsStatus(status);
        setCorsFixError(null);
      })
      .catch(() => {
        if (!isMounted) return;
        setCorsStatus({
          enabled: false,
          rules: [],
          error: "Unable to check bucket CORS.",
        });
      });
    return () => {
      isMounted = false;
    };
  }, [
    accountIdForApi,
    accessMode,
    accountSwitchInFlight,
    bucketName,
    hasS3AccountContext,
    uiOrigin,
  ]);

  useEffect(() => {
    if (!hasS3AccountContext || !stsEnabled) {
      setStsStatus(null);
      setStsCredentials(null);
      setStsCredentialsError(null);
      return;
    }
    let isMounted = true;
    getStsStatus(accountIdForApi)
      .then((status) => {
        if (!isMounted) return;
        setStsStatus(status);
      })
      .catch((err) => {
        if (!isMounted) return;
        setStsStatus({
          available: false,
          error: extractApiError(err, "Unable to reach STS endpoint."),
        });
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, accessMode, hasS3AccountContext, stsEnabled]);

  useEffect(() => {
    if (!hasS3AccountContext || !stsEnabled || !stsStatus?.available) {
      setStsCredentials(null);
      setStsCredentialsError(null);
      return;
    }
    ensureStsCredentials(true);
  }, [
    accountIdForApi,
    accessMode,
    ensureStsCredentials,
    hasS3AccountContext,
    stsEnabled,
    stsStatus?.available,
  ]);

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext) {
      setUseProxyTransfers(false);
      return;
    }
    if (!proxyAllowed) {
      setUseProxyTransfers(false);
      return;
    }
    if (corsStatus) {
      setUseProxyTransfers(!corsStatus.enabled);
      return;
    }
    setUseProxyTransfers(false);
  }, [bucketName, corsStatus, hasS3AccountContext, proxyAllowed]);

  const displayPrefixForItems = useMemo(() => {
    const query = filter.trim();
    if (!query || searchScope !== "bucket") {
      return normalizedPrefix;
    }
    return "";
  }, [filter, normalizedPrefix, searchScope]);

  const items = useMemo(() => {
    const activePrefixSet = new Set(prefixes);
    const combinedPrefixes = [...prefixes];
    deletedPrefixes.forEach((prefixKey) => {
      if (!activePrefixSet.has(prefixKey)) {
        combinedPrefixes.push(prefixKey);
      }
    });
    const folderItems = combinedPrefixes.map((prefixKey) => {
      const rawName = shortName(prefixKey, displayPrefixForItems);
      const name = rawName.endsWith("/") ? rawName.slice(0, -1) : rawName;
      const isDeletedFolder = !activePrefixSet.has(prefixKey);
      return {
        id: isDeletedFolder ? `${prefixKey}::deleted-prefix` : prefixKey,
        key: prefixKey,
        name: name || prefixKey,
        type: "folder",
        isDeleted: isDeletedFolder,
        size: "-",
        sizeBytes: null,
        modified: "-",
        modifiedAt: null,
        owner: "-",
      } satisfies BrowserItem;
    });
    const objectItems = objects.map((obj) => {
      const modifiedAt = obj.last_modified
        ? new Date(obj.last_modified).getTime()
        : null;
      return {
        id: obj.key,
        key: obj.key,
        name: shortName(obj.key, displayPrefixForItems),
        type: "file",
        size: formatBytes(obj.size),
        sizeBytes: obj.size,
        modified: formatDateTime(obj.last_modified),
        modifiedAt,
        owner: "-",
        storageClass: obj.storage_class ?? undefined,
        etag: normalizeEtag(obj.etag ?? undefined) ?? null,
      } satisfies BrowserItem;
    });
    const deletedItemRows = deletedObjects.map((obj) => {
      const modifiedAt = obj.last_modified
        ? new Date(obj.last_modified).getTime()
        : null;
      return {
        id: `${obj.key}::deleted::${obj.version_id ?? "null"}`,
        key: obj.key,
        name: shortName(obj.key, displayPrefixForItems),
        type: "file",
        isDeleted: true,
        deleteMarkerVersionId: obj.version_id ?? null,
        size: "-",
        sizeBytes: null,
        modified: formatDateTime(obj.last_modified),
        modifiedAt,
        owner: "-",
      } satisfies BrowserItem;
    });
    return [...folderItems, ...objectItems, ...deletedItemRows];
  }, [
    deletedObjects,
    deletedPrefixes,
    displayPrefixForItems,
    objects,
    prefixes,
  ]);

  const listItems = useMemo(
    () =>
      showFolderItems
        ? items
        : items.filter((item) => item.type !== "folder"),
    [items, showFolderItems],
  );
  const listItemById = useMemo(
    () => new Map(listItems.map((item) => [item.id, item])),
    [listItems],
  );
  const effectiveVisibleColumns = visibleColumns;
  const visibleColumnSet = useMemo(
    () => new Set(effectiveVisibleColumns),
    [effectiveVisibleColumns],
  );
  const visibleColumnDefinitions = useMemo(
    () =>
      COLUMN_DEFINITIONS.filter((definition) =>
        visibleColumnSet.has(definition.id),
      ),
    [visibleColumnSet],
  );
  const nameColumnWidthPx = useMemo(
    () => resolveColumnWidthPx("name", columnWidths),
    [columnWidths],
  );
  const visibleColumnWidthsPx = useMemo(
    () =>
      visibleColumnDefinitions.reduce<
        Record<BrowserColumnId, number>
      >((acc, definition) => {
        acc[definition.id] = resolveColumnWidthPx(definition.id, columnWidths);
        return acc;
      }, {} as Record<BrowserColumnId, number>),
    [columnWidths, visibleColumnDefinitions],
  );
  const objectTableMinWidthPx = useMemo(
    () =>
      Math.max(
        720,
        SELECTION_COLUMN_WIDTH_PX +
          nameColumnWidthPx +
          ACTIONS_COLUMN_WIDTH_PX +
          visibleColumnDefinitions.reduce(
            (sum, definition) => sum + visibleColumnWidthsPx[definition.id],
            0,
          ),
      ),
    [nameColumnWidthPx, visibleColumnDefinitions, visibleColumnWidthsPx],
  );
  const lazyMetadataColumnsVisible =
    visibleColumnSet.has("contentType") ||
    visibleColumnSet.has("metadataCount") ||
    visibleColumnSet.has("cacheControl") ||
    visibleColumnSet.has("expires") ||
    visibleColumnSet.has("restoreStatus");
  const lazyTagsColumnsVisible = visibleColumnSet.has("tagsCount");
  const hasActiveLazyColumns =
    lazyMetadataColumnsVisible || lazyTagsColumnsVisible;
  const objectTableColSpan = 3 + visibleColumnDefinitions.length;
  const normalizedSearchQuery = filter.trim();
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const isSearchingInWholeBucket = hasSearchQuery && searchScope === "bucket";
  const hasAdvancedSearchOptionsActive =
    searchScope !== "prefix" ||
    searchRecursive ||
    searchExactMatch ||
    searchCaseSensitive ||
    typeFilter !== "all" ||
    storageFilter !== "all";
  const hasActiveSearchFilters =
    hasSearchQuery ||
    searchScope === "bucket" ||
    searchRecursive ||
    searchExactMatch ||
    searchCaseSensitive ||
    typeFilter !== "all" ||
    storageFilter !== "all";
  const canResetSearchFilters =
    hasSearchQuery ||
    searchScope !== "prefix" ||
    searchRecursive ||
    searchExactMatch ||
    searchCaseSensitive ||
    typeFilter !== "all" ||
    storageFilter !== "all";
  const searchResultScopeLabel = hasSearchQuery
    ? isSearchingInWholeBucket
      ? "Whole bucket"
      : searchRecursive
        ? "Current path + subfolders"
        : "Current path"
    : "Filters applied";
  const activeSearchStatusChips = [
    hasSearchQuery ? { label: "Query", value: filter } : null,
    hasSearchQuery ? { label: "Scope", value: searchResultScopeLabel } : null,
    searchRecursive && !isSearchingInWholeBucket
      ? { label: "Mode", value: "Recursive" }
      : null,
    searchExactMatch ? { label: "Match", value: "Exact" } : null,
    searchCaseSensitive ? { label: "Case", value: "Sensitive" } : null,
    typeFilter !== "all" ? { label: "Type", value: typeFilter } : null,
    storageFilter !== "all" ? { label: "Storage", value: storageFilter } : null,
  ].filter((entry): entry is { label: string; value: string } =>
    Boolean(entry),
  );

  const prefixParts = useMemo(
    () => prefix.split("/").filter(Boolean),
    [prefix],
  );
  const bucketOptions = useMemo(
    () => bucketMenuItems.map((bucket) => bucket.name),
    [bucketMenuItems],
  );
  const bucketButtonLabel = useMemo(() => {
    if (bucketName) return bucketName;
    if (loadingBuckets) return "Loading buckets...";
    if (bucketTotalCount === 0) return "No buckets";
    return "Select bucket";
  }, [bucketName, bucketTotalCount, loadingBuckets]);
  const bucketSelectorNeedsAttention =
    hasS3AccountContext && !bucketName && bucketTotalCount > 0;
  const bucketButtonClassName = cx(
    bucketButtonClasses,
    bucketSelectorNeedsAttention
      ? "border-amber-300 bg-amber-50 text-amber-800 ring-2 ring-amber-200/70 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-400/30"
      : "border-slate-200 bg-white text-slate-700 hover:border-primary/60 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:bg-slate-800",
  );
  const useBucketsPanel = isMainBrowserPath && isFoldersPanelVisible;
  const {
    currentBucket: currentBucketPanelItem,
    otherBuckets: otherBucketPanelItems,
  } = useMemo(
    () => splitBucketPanelBuckets(bucketName, bucketMenuItems),
    [bucketMenuItems, bucketName],
  );
  const otherBucketPanelRows = useMemo(
    () =>
      otherBucketPanelItems.map((bucket) => ({
        bucket,
        access: resolveBucketAccessEntry(bucket.name, bucketAccessByName),
      })),
    [bucketAccessByName, otherBucketPanelItems],
  );
  const treeRootNode = useMemo(
    () => treeNodes.find((node) => node.prefix === "") ?? null,
    [treeNodes],
  );
  const canLoadMoreBucketResults =
    bucketMenuHasNext && !loadingBuckets && !bucketMenuLoadingMore;
  const activePathSuggestion =
    pathSuggestionIndex >= 0 && pathSuggestionIndex < pathSuggestions.length
      ? pathSuggestions[pathSuggestionIndex]
      : null;
  const handleBucketMenuLoadMore = useCallback(() => {
    if (loadingBuckets || bucketMenuLoadingMore || !bucketMenuHasNext) {
      return;
    }
    void loadBucketSearchPage({
      search: bucketFilter,
      page: bucketMenuPage + 1,
      append: true,
    });
  }, [
    bucketFilter,
    bucketMenuHasNext,
    bucketMenuLoadingMore,
    bucketMenuPage,
    loadBucketSearchPage,
    loadingBuckets,
  ]);
  const handleBucketChange = useCallback(
    (value: string) => {
      setShowBucketMenu(false);
      setBucketFilter("");
      if (!value || value === bucketName) return;
      setBucketName(value);
      setPrefix("");
      setActiveItem(null);
    },
    [bucketName],
  );

  useEffect(() => {
    if (sortKey === "size" && !visibleColumnSet.has("size")) {
      setSortId("name-asc");
      return;
    }
    if (sortKey === "modified" && !visibleColumnSet.has("modified")) {
      setSortId("name-asc");
      return;
    }
    if (sortKey === "storageClass" && !visibleColumnSet.has("storageClass")) {
      setSortId("name-asc");
      return;
    }
    if (sortKey === "etag" && !visibleColumnSet.has("etag")) {
      setSortId("name-asc");
    }
  }, [sortKey, visibleColumnSet]);

  useLayoutEffect(() => {
    if (!useBucketsPanel) {
      return;
    }
    const scroller = bucketPanelViewportRef.current;
    if (!scroller) {
      return;
    }
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    scroller.scrollTop = 0;
  }, [bucketName, useBucketsPanel]);

  useEffect(() => {
    if (!useBucketsPanel) {
      return;
    }
    const root = bucketPanelViewportRef.current;
    if (!root) {
      return;
    }
    const rowNodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-bucket-panel-name]"),
    );
    if (rowNodes.length === 0) {
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const rootMarginPx = Number.parseInt(BUCKET_ACCESS_ROOT_MARGIN, 10) || 0;
    const viewportTop = rootRect.top - rootMarginPx;
    const viewportBottom = rootRect.bottom + rootMarginPx;
    rowNodes.forEach((node) => {
      const targetBucketName = node.dataset.bucketPanelName;
      if (!targetBucketName) {
        return;
      }
      if (rootRect.height <= 0 || rootRect.width <= 0) {
        scheduleBucketAccessProbe(targetBucketName);
        return;
      }
      const rowRect = node.getBoundingClientRect();
      const intersectsViewport =
        rowRect.bottom >= viewportTop && rowRect.top <= viewportBottom;
      if (intersectsViewport) {
        scheduleBucketAccessProbe(targetBucketName);
      }
    });

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      rowNodes.forEach((node) => {
        const targetBucketName = node.dataset.bucketPanelName;
        if (targetBucketName) {
          scheduleBucketAccessProbe(targetBucketName);
        }
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          const targetBucketName = (entry.target as HTMLElement).dataset
            .bucketPanelName;
          if (targetBucketName) {
            scheduleBucketAccessProbe(targetBucketName);
          }
          observer.unobserve(entry.target);
        });
      },
      { root, rootMargin: BUCKET_ACCESS_ROOT_MARGIN },
    );
    rowNodes.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
    };
  }, [otherBucketPanelRows, scheduleBucketAccessProbe, useBucketsPanel]);

  useEffect(() => {
    if (!useBucketsPanel || !canLoadMoreBucketResults) {
      return;
    }
    const root = bucketPanelViewportRef.current;
    const sentinel = bucketPanelLoadMoreSentinelRef.current;
    if (
      !root ||
      !sentinel ||
      typeof window === "undefined" ||
      !("IntersectionObserver" in window)
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            handleBucketMenuLoadMore();
          }
        });
      },
      { root, rootMargin: "160px" },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [canLoadMoreBucketResults, handleBucketMenuLoadMore, useBucketsPanel]);

  const breadcrumbs = useMemo(() => {
    let current = "";
    return prefixParts.map((part) => {
      current = `${current}${part}/`;
      return { label: part, prefix: current };
    });
  }, [prefixParts]);

  const parentPrefix = useMemo(() => {
    if (prefixParts.length <= 1) return "";
    return `${prefixParts.slice(0, -1).join("/")}/`;
  }, [prefixParts]);
  const canGoUp = prefixParts.length > 0;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected =
    listItems.length > 0 && listItems.every((item) => selectedSet.has(item.id));
  const selectedItems = useMemo(
    () => items.filter((item) => selectedSet.has(item.id)),
    [items, selectedSet],
  );
  const selectedCount = selectedItems.length;
  const bulkActionFileCount = useMemo(
    () => bulkActionItems.filter((item) => item.type === "file").length,
    [bulkActionItems],
  );
  const bulkActionFolderCount = useMemo(
    () => bulkActionItems.filter((item) => item.type === "folder").length,
    [bulkActionItems],
  );
  const selectedBytes = useMemo(() => {
    return selectedItems.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  }, [selectedItems]);

  const availableStorageClasses = useMemo(() => {
    const classes = new Set<string>();
    items.forEach((item) => {
      if (item.storageClass) {
        classes.add(item.storageClass);
      }
    });
    return Array.from(classes);
  }, [items]);
  const searchableStorageClasses = useMemo(() => {
    const ordered = storageClassOptions.map((option) => option.value);
    const known = new Set(ordered);
    const unknown = availableStorageClasses
      .filter((value) => !known.has(value))
      .sort((a, b) => a.localeCompare(b));
    return [...ordered, ...unknown];
  }, [availableStorageClasses]);

  const pathStats = useMemo(() => {
    let totalBytes = 0;
    let files = 0;
    let deletedFiles = 0;
    let folders = 0;
    let deletedFolders = 0;
    const storageCounts: Record<string, number> = {};
    items.forEach((item) => {
      if (item.type === "folder") {
        folders += 1;
        if (item.isDeleted) {
          deletedFolders += 1;
        }
        return;
      }
      if (item.isDeleted) {
        deletedFiles += 1;
        return;
      }
      files += 1;
      totalBytes += item.sizeBytes ?? 0;
      const storage = item.storageClass ?? "STANDARD";
      storageCounts[storage] = (storageCounts[storage] ?? 0) + 1;
    });
    return {
      totalBytes,
      files,
      deletedFiles,
      folders,
      deletedFolders,
      storageCounts,
    };
  }, [items]);

  const bucketInspectorData = useMemo(
    () => (bucketName ? (bucketInspectorByName[bucketName] ?? null) : null),
    [bucketInspectorByName, bucketName],
  );
  const cephQuotaScopeLabel = isLegacyS3UserContext
    ? "User quota"
    : "Account quota";
  const bucketInspectorFeatures = useMemo(() => {
    const featureMap = bucketInspectorData?.features ?? null;
    if (!featureMap) return [];
    const seen = new Set<string>();
    const keys: string[] = [];
    BUCKET_INSPECTOR_FEATURE_ORDER.forEach((featureKey) => {
      if (featureMap[featureKey]) {
        seen.add(featureKey);
        keys.push(featureKey);
      }
    });
    Object.keys(featureMap).forEach((featureKey) => {
      if (seen.has(featureKey)) return;
      keys.push(featureKey);
    });
    return keys.map((featureKey) => {
      const feature = featureMap[featureKey];
      const label =
        BUCKET_INSPECTOR_FEATURE_LABELS[featureKey] ??
        featureKey
          .split("_")
          .filter(Boolean)
          .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
          .join(" ");
      return {
        key: featureKey,
        label,
        state: feature?.state ?? "Unknown",
        tone: feature?.tone ?? "unknown",
      };
    });
  }, [bucketInspectorData]);

  const inspectedItem = useMemo(() => {
    if (activeItem && items.some((entry) => entry.id === activeItem.id)) {
      return activeItem;
    }
    return null;
  }, [activeItem, items]);

  useEffect(() => {
    selectionStatsRequestIdRef.current += 1;
    setSelectionStats(null);
    setSelectionStatsError(null);
    setSelectionStatsLoading(false);
  }, [bucketName, inspectedItem?.id, prefix, selectedIds]);

  useEffect(() => {
    inspectedItemRef.current = inspectedItem;
  }, [inspectedItem]);

  useEffect(() => {
    if (
      !isInspectorPanelVisible ||
      inspectorTab !== "details" ||
      !bucketName ||
      !hasS3AccountContext ||
      !inspectedItem ||
      inspectedItem.type !== "file" ||
      !isVersioningEnabled
    ) {
      setObjectVersions([]);
      setObjectDeleteMarkers([]);
      setObjectVersionsError(null);
      setObjectVersionKeyMarker(null);
      setObjectVersionIdMarker(null);
      setObjectVersionsLoading(false);
      setObjectVersionsTargetKey(null);
      objectVersionsTargetKeyRef.current = null;
      return;
    }
    setObjectVersions([]);
    setObjectDeleteMarkers([]);
    setObjectVersionsError(null);
    setObjectVersionKeyMarker(null);
    setObjectVersionIdMarker(null);
    setObjectVersionsTargetKey(inspectedItem.key);
    objectVersionsTargetKeyRef.current = inspectedItem.key;
    void loadObjectVersions({
      append: false,
      keyMarker: null,
      versionIdMarker: null,
      targetKey: inspectedItem.key,
    });
  }, [
    bucketName,
    hasS3AccountContext,
    inspectedItem,
    inspectorTab,
    isInspectorPanelVisible,
    isVersioningEnabled,
    loadObjectVersions,
  ]);

  const selectionItems = selectedItems;
  const selectionInfo = getSelectionInfo(selectionItems);
  const selectionFiles = selectionInfo.files;
  const selectionFolders = selectionInfo.folders;
  const selectionIsSingle = selectionInfo.isSingle;
  const selectionPrimary = selectionInfo.primary;
  const canSelectionDownloadFiles = selectionInfo.canDownloadFiles;
  const canSelectionDownloadFolder = selectionInfo.canDownloadFolder;
  const canSelectionOpen = selectionInfo.canOpen;
  const selectionHasDeleted = selectionInfo.hasDeleted;
  const canSelectionActions = selectionInfo.items.length > 0;

  const { resolvedFoldersWidth, resolvedInspectorWidth } = useMemo(
    () =>
      resolveBrowserPanelWidths({
        containerWidth: layoutContainerWidthPx,
        foldersPanelWidthPx,
        inspectorPanelWidthPx,
        isFoldersPanelVisible,
        isInspectorPanelVisible,
      }),
    [
      foldersPanelWidthPx,
      inspectorPanelWidthPx,
      isFoldersPanelVisible,
      isInspectorPanelVisible,
      layoutContainerWidthPx,
    ],
  );
  const layoutTemplateColumns = useMemo(() => {
    if (isFoldersPanelVisible && isInspectorPanelVisible) {
      return `${resolvedFoldersWidth}px minmax(0, 1fr) ${resolvedInspectorWidth}px`;
    }
    if (isFoldersPanelVisible) {
      return `${resolvedFoldersWidth}px minmax(0, 1fr)`;
    }
    if (isInspectorPanelVisible) {
      return `minmax(0, 1fr) ${resolvedInspectorWidth}px`;
    }
    return "minmax(0, 1fr)";
  }, [
    isFoldersPanelVisible,
    isInspectorPanelVisible,
    resolvedFoldersWidth,
    resolvedInspectorWidth,
  ]);
  const rowPadding = compactMode ? "!py-0.5" : "py-2.5";
  const rowHeightClasses = compactMode ? "h-9" : "h-16";
  const rowCellClasses = rowPadding;
  const headerPadding = compactMode ? "!py-1" : "py-3";
  const iconBoxClasses = compactMode ? "h-6 w-6" : "h-9 w-9";
  const nameGapClasses = compactMode ? "gap-1.5" : "gap-3";
  const rowActionButtonClasses = compactMode
    ? `${iconButtonClasses} !h-6 !w-6`
    : iconButtonClasses;
  const rowActionDangerButtonClasses = compactMode
    ? `${iconButtonDangerClasses} !h-6 !w-6`
    : iconButtonDangerClasses;
  const prefixVersionRows = useMemo(
    () => buildVersionRows(prefixVersions, prefixDeleteMarkers),
    [prefixDeleteMarkers, prefixVersions],
  );
  const objectVersionRows = useMemo(
    () => buildVersionRows(objectVersions, objectDeleteMarkers),
    [objectDeleteMarkers, objectVersions],
  );

  const currentPath = useMemo(() => {
    if (!bucketName) return "";
    if (!prefix) return bucketName;
    const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return `${bucketName}/${trimmed}`;
  }, [bucketName, prefix]);
  const copyUrlDisabledReason = "Copy URL is disabled in SSE-C mode.";
  const pathActionStates = useMemo(
    () =>
      resolveBrowserActions({
        scope: "path",
        bucketName,
        hasS3AccountContext,
        versioningEnabled: isVersioningEnabled,
        canPaste,
        clipboardMode: clipboard?.mode ?? null,
        currentPath,
        showFolderItems,
        showDeletedObjects,
      }),
    [
      bucketName,
      canPaste,
      clipboard?.mode,
      currentPath,
      hasS3AccountContext,
      isVersioningEnabled,
      showDeletedObjects,
      showFolderItems,
    ],
  );
  const selectionActionStates = useMemo(
    () =>
      resolveBrowserActions({
        scope: "selection",
        items: selectionItems,
        bucketName,
        hasS3AccountContext,
        versioningEnabled: isVersioningEnabled,
        canPaste,
        clipboardMode: clipboard?.mode ?? null,
        copyUrlDisabled: sseActive,
        copyUrlDisabledReason,
      }),
    [
      bucketName,
      canPaste,
      clipboard?.mode,
      copyUrlDisabledReason,
      hasS3AccountContext,
      isVersioningEnabled,
      selectionItems,
      sseActive,
    ],
  );
  const toolbarPreviewActionState = useMemo(() => {
    if (!selectionIsSingle || !selectionPrimary) {
      return null;
    }
    return resolveBrowserActions({
      scope: "item",
      items: [selectionPrimary],
      bucketName,
      hasS3AccountContext,
      versioningEnabled: isVersioningEnabled,
      canPaste,
      clipboardMode: clipboard?.mode ?? null,
      copyUrlDisabled: sseActive,
      copyUrlDisabledReason,
      inspectorAvailable: canUseInspectorPanel,
    }).preview;
  }, [
    bucketName,
    canPaste,
    canUseInspectorPanel,
    clipboard?.mode,
    copyUrlDisabledReason,
    hasS3AccountContext,
    isVersioningEnabled,
    selectionIsSingle,
    selectionPrimary,
    sseActive,
  ]);
  const toolbarMorePathActions = useMemo(
    () =>
      getVisibleBrowserActions(pathActionStates, TOOLBAR_MORE_PATH_ACTION_IDS),
    [pathActionStates],
  );
  const toolbarMoreSelectionFullActions = useMemo(
    () =>
      getVisibleBrowserActions(
        selectionActionStates,
        TOOLBAR_MORE_SELECTION_FULL_ACTION_IDS,
      ),
    [selectionActionStates],
  );
  const toolbarMoreSelectionOverflowActions = useMemo(
    () =>
      getVisibleBrowserActions(
        selectionActionStates,
        TOOLBAR_MORE_SELECTION_OVERFLOW_ACTION_IDS,
      ),
    [selectionActionStates],
  );
  const inspectorContextActions = useMemo(
    () =>
      getVisibleBrowserActions(pathActionStates, INSPECTOR_CONTEXT_ACTION_IDS),
    [pathActionStates],
  );
  const inspectorSelectionActions = useMemo(
    () =>
      getVisibleBrowserActions(
        selectionActionStates,
        INSPECTOR_SELECTION_ACTION_IDS,
      ),
    [selectionActionStates],
  );
  const inspectorSelectionBulkActions = useMemo(
    () =>
      getVisibleBrowserActions(
        selectionActionStates,
        INSPECTOR_SELECTION_BULK_ACTION_IDS,
      ),
    [selectionActionStates],
  );
  const inspectedPath = inspectedItem
    ? `${bucketName}/${inspectedItem.key}`
    : currentPath;

  const openObjectDetails = (
    item: BrowserItem,
    requestedTab: ObjectDetailsTabId,
  ) => {
    if (item.type !== "file") return;
    let initialTab = requestedTab;
    if (item.isDeleted) {
      setWarningMessage(
        "This object is deleted. Open versions to inspect or restore it.",
      );
      if (!isVersioningEnabled) {
        return;
      }
      initialTab = "versions";
    } else if (requestedTab === "versions" && !isVersioningEnabled) {
      initialTab = "preview";
    }
    setActiveItem(item);
    setObjectDetailsTarget({ item, initialTab });
  };

  const openItemPrimaryAction = (item: BrowserItem) => {
    if (item.type === "folder") {
      handleOpenItem(item);
      return;
    }
    if (item.isDeleted) {
      if (isVersioningEnabled) {
        openObjectDetails(item, "versions");
      }
      return;
    }
    openObjectDetails(item, "preview");
  };

  const startPanelResize = useCallback(
    (side: "folders" | "inspector") =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (
          (side === "folders" && !isFoldersPanelVisibleRef.current) ||
          (side === "inspector" && !isInspectorPanelVisibleRef.current)
        ) {
          return;
        }
        event.preventDefault();
        setActivePanelResize(side);
      },
    [],
  );

  const startColumnResize = useCallback(
    (columnId: BrowserResizableColumnId) =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setActiveColumnResize({
          columnId,
          startX: event.clientX,
          startWidthPx: resolveColumnWidthPx(columnId, columnWidthsRef.current),
        });
      },
    [],
  );

  const resetColumnWidth = useCallback((columnId: BrowserResizableColumnId) => {
    setColumnWidths((prev) => {
      if (!(columnId in prev)) return prev;
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  }, []);

  const resetFoldersPanelWidth = useCallback(() => {
    setFoldersPanelWidthPx(DEFAULT_FOLDERS_PANEL_WIDTH_PX);
  }, []);

  const resetInspectorPanelWidth = useCallback(() => {
    setInspectorPanelWidthPx(DEFAULT_INSPECTOR_PANEL_WIDTH_PX);
  }, []);

  const openItemDetails = (item: BrowserItem) => {
    if (!canUseInspectorPanel) return;
    setSelectedIds([item.id]);
    setSelectionAnchorId(item.id);
    setActiveRowId(item.id);
    setActiveItem(item);
    setInspectorTab("details");
    setShowInspector(true);
  };

  const isInteractiveTarget = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    return Boolean(
      element?.closest("button, a, input, textarea, select, label"),
    );
  };

  const handleItemDoubleClick = (
    event: ReactMouseEvent<HTMLElement>,
    item: BrowserItem,
  ) => {
    if (isInteractiveTarget(event.target)) return;
    openItemPrimaryAction(item);
  };

  const openAdvancedForItem = (item: BrowserItem) => {
    openObjectDetails(item, "properties");
  };

  const openPropertiesForItem = (item: BrowserItem) => {
    openObjectDetails(item, "properties");
  };

  const handlePreviewItem = (item: BrowserItem) => {
    openObjectDetails(item, "preview");
  };

  const handleOpenItem = (item: BrowserItem) => {
    if (item.type !== "folder") return;
    handleSelectPrefix(item.key);
  };

  const handleSelectPrefix = (nextPrefix: string) => {
    setPrefix(nextPrefix);
    setActiveItem(null);
    if (bucketName) {
      setPathHistory(pushBucketPathHistory(bucketName, nextPrefix));
    }
  };

  const startEditingPath = useCallback(() => {
    if (!bucketName) return;
    setPathDraft(prefix);
    setPathSuggestionIndex(-1);
    setIsEditingPath(true);
  }, [bucketName, prefix]);

  const commitPathDraft = () => {
    const trimmed = normalizePathDraftValue(pathDraft);
    const nextPrefix = trimmed ? normalizePrefix(trimmed) : "";
    if (pathSuggestionsDebounceRef.current !== null) {
      window.clearTimeout(pathSuggestionsDebounceRef.current);
      pathSuggestionsDebounceRef.current = null;
    }
    pathSuggestionsRequestIdRef.current += 1;
    setPathSuggestions([]);
    setPathSuggestionsLoading(false);
    setPathSuggestionIndex(-1);
    setIsEditingPath(false);
    if (nextPrefix !== prefix) {
      handleSelectPrefix(nextPrefix);
    }
  };

  const cancelPathEdit = () => {
    if (pathSuggestionsDebounceRef.current !== null) {
      window.clearTimeout(pathSuggestionsDebounceRef.current);
      pathSuggestionsDebounceRef.current = null;
    }
    pathSuggestionsRequestIdRef.current += 1;
    setPathDraft(prefix);
    setPathSuggestions([]);
    setPathSuggestionsLoading(false);
    setPathSuggestionIndex(-1);
    setIsEditingPath(false);
  };

  const applyPathSuggestion = (
    suggestion: PathSuggestion,
    options?: { commit?: boolean },
  ) => {
    const nextPrefix = suggestion.value
      ? normalizePrefix(suggestion.value)
      : "";
    setPathDraft(nextPrefix);
    setPathSuggestionIndex(-1);
    if (!options?.commit) return;
    if (pathSuggestionsDebounceRef.current !== null) {
      window.clearTimeout(pathSuggestionsDebounceRef.current);
      pathSuggestionsDebounceRef.current = null;
    }
    pathSuggestionsRequestIdRef.current += 1;
    setPathSuggestions([]);
    setPathSuggestionsLoading(false);
    setIsEditingPath(false);
    if (nextPrefix !== prefix) {
      handleSelectPrefix(nextPrefix);
    }
  };

  const handlePathKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      if (pathSuggestions.length === 0) return;
      event.preventDefault();
      setPathSuggestionIndex((prev) =>
        prev < pathSuggestions.length - 1 ? prev + 1 : 0,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      if (pathSuggestions.length === 0) return;
      event.preventDefault();
      setPathSuggestionIndex((prev) =>
        prev > 0 ? prev - 1 : pathSuggestions.length - 1,
      );
      return;
    }
    if (event.key === "Tab" && activePathSuggestion) {
      event.preventDefault();
      applyPathSuggestion(activePathSuggestion);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activePathSuggestion) {
        applyPathSuggestion(activePathSuggestion, { commit: true });
        return;
      }
      commitPathDraft();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelPathEdit();
    }
  };

  useEffect(() => {
    setSelectedIds([]);
    setSelectionAnchorId(null);
    setActiveRowId(null);
    setActiveItem(null);
    setLazyColumnCache({});
    lazyQueueRef.current = [];
    lazyQueuedIdsRef.current.clear();
    lazyInFlightRef.current = 0;
    setStatusMessage(null);
    setWarningMessage(null);
    setIsEditingPath(false);
    setObjectDetailsTarget(null);
  }, [accountIdForApi, bucketName, prefix]);

  useEffect(() => {
    lazyColumnCacheRef.current = lazyColumnCache;
  }, [lazyColumnCache]);

  useEffect(() => {
    objectsRef.current = objects;
    prefixesRef.current = prefixes;
    deletedObjectsRef.current = deletedObjects;
    deletedPrefixesRef.current = deletedPrefixes;
    deletedObjectsNextKeyMarkerRef.current = deletedObjectsNextKeyMarker;
    deletedObjectsNextVersionIdMarkerRef.current =
      deletedObjectsNextVersionIdMarker;
    deletedObjectsIsTruncatedRef.current = deletedObjectsIsTruncated;
  }, [
    deletedObjects,
    deletedObjectsIsTruncated,
    deletedObjectsNextKeyMarker,
    deletedObjectsNextVersionIdMarker,
    deletedPrefixes,
    objects,
    prefixes,
  ]);

  useEffect(() => {
    prefixVersionsRef.current = prefixVersions;
    prefixDeleteMarkersRef.current = prefixDeleteMarkers;
    prefixVersionKeyMarkerRef.current = prefixVersionKeyMarker;
    prefixVersionIdMarkerRef.current = prefixVersionIdMarker;
  }, [
    prefixDeleteMarkers,
    prefixVersionIdMarker,
    prefixVersionKeyMarker,
    prefixVersions,
  ]);

  useEffect(() => {
    objectVersionsRef.current = objectVersions;
    objectDeleteMarkersRef.current = objectDeleteMarkers;
    objectVersionKeyMarkerRef.current = objectVersionKeyMarker;
    objectVersionIdMarkerRef.current = objectVersionIdMarker;
    objectVersionsTargetKeyRef.current = objectVersionsTargetKey;
  }, [
    objectDeleteMarkers,
    objectVersionIdMarker,
    objectVersionKeyMarker,
    objectVersions,
    objectVersionsTargetKey,
  ]);

  useEffect(() => {
    accountIdForApiRef.current = accountIdForApi;
  }, [accountIdForApi]);

  useEffect(() => {
    bucketAccessByNameRef.current = bucketAccessByName;
  }, [bucketAccessByName]);

  useEffect(() => {
    lazyListItemsByIdRef.current = listItemById;
  }, [listItemById]);

  useEffect(() => {
    const listItemIds = new Set(listItems.map((item) => item.id));
    setLazyColumnCache((prev) => {
      let changed = false;
      const next: Record<string, LazyColumnCacheEntry> = {};
      Object.entries(prev).forEach(([itemId, entry]) => {
        if (listItemIds.has(itemId)) {
          next[itemId] = entry;
          return;
        }
        changed = true;
      });
      return changed ? next : prev;
    });
    if (lazyQueueRef.current.length > 0) {
      const filteredQueue = lazyQueueRef.current.filter((itemId) =>
        listItemIds.has(itemId),
      );
      if (filteredQueue.length !== lazyQueueRef.current.length) {
        lazyQueueRef.current = filteredQueue;
        lazyQueuedIdsRef.current = new Set(filteredQueue);
      }
    }
  }, [listItems]);

  useEffect(() => {
    if (!isEditingPath) {
      setPathDraft(prefix);
      return;
    }
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [isEditingPath, prefix]);

  useEffect(() => {
    if (!bucketName) {
      setPathHistory([]);
      return;
    }
    setPathHistory(readBucketPathHistory(bucketName));
  }, [bucketName]);

  useEffect(() => {
    if (!isEditingPath || !bucketName || !hasS3AccountContext) {
      if (pathSuggestionsDebounceRef.current !== null) {
        window.clearTimeout(pathSuggestionsDebounceRef.current);
        pathSuggestionsDebounceRef.current = null;
      }
      pathSuggestionsRequestIdRef.current += 1;
      setPathSuggestions([]);
      setPathSuggestionsLoading(false);
      setPathSuggestionIndex(-1);
      return;
    }

    const { parentPrefix, fragment } = resolvePathDraftContext(pathDraft);
    const localCandidates =
      parentPrefix === normalizePrefix(prefix) ? prefixes : [];
    const localSuggestions = buildPathSuggestionEntries(
      localCandidates,
      parentPrefix,
      fragment,
      "local",
    );
    const historySuggestions = buildPathSuggestionEntries(
      pathHistory,
      parentPrefix,
      fragment,
      "history",
    );
    const localOnlySuggestions = mergePathSuggestions(
      fragment,
      historySuggestions,
      localSuggestions,
    );
    setPathSuggestions(localOnlySuggestions);
    setPathSuggestionIndex(-1);

    if (pathSuggestionsDebounceRef.current !== null) {
      window.clearTimeout(pathSuggestionsDebounceRef.current);
    }
    const requestId = pathSuggestionsRequestIdRef.current + 1;
    pathSuggestionsRequestIdRef.current = requestId;
    setPathSuggestionsLoading(true);
    pathSuggestionsDebounceRef.current = window.setTimeout(() => {
      pathSuggestionsDebounceRef.current = null;
      listBrowserObjects(accountIdForApi, bucketName, {
        prefix: parentPrefix,
        query: fragment || undefined,
        type: "folder",
        maxKeys: PATH_SUGGESTIONS_API_LIMIT,
      })
        .then((data) => {
          if (pathSuggestionsRequestIdRef.current !== requestId) return;
          const remoteSuggestions = buildPathSuggestionEntries(
            data.prefixes || [],
            parentPrefix,
            fragment,
            "remote",
          );
          setPathSuggestions(
            mergePathSuggestions(
              fragment,
              historySuggestions,
              localSuggestions,
              remoteSuggestions,
            ),
          );
        })
        .catch(() => {
          if (pathSuggestionsRequestIdRef.current !== requestId) return;
          setPathSuggestions(localOnlySuggestions);
        })
        .finally(() => {
          if (pathSuggestionsRequestIdRef.current === requestId) {
            setPathSuggestionsLoading(false);
          }
        });
    }, PATH_SUGGESTIONS_DEBOUNCE_MS);

    return () => {
      if (pathSuggestionsDebounceRef.current !== null) {
        window.clearTimeout(pathSuggestionsDebounceRef.current);
        pathSuggestionsDebounceRef.current = null;
      }
    };
  }, [
    accountIdForApi,
    bucketName,
    hasS3AccountContext,
    isEditingPath,
    pathDraft,
    pathHistory,
    prefix,
    prefixes,
  ]);

  useEffect(() => {
    if (pathSuggestions.length === 0 && pathSuggestionIndex !== -1) {
      setPathSuggestionIndex(-1);
      return;
    }
    if (pathSuggestionIndex >= pathSuggestions.length) {
      setPathSuggestionIndex(pathSuggestions.length - 1);
    }
  }, [pathSuggestionIndex, pathSuggestions.length]);

  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) => items.some((item) => item.id === id)),
    );
    if (activeItem && !items.some((item) => item.id === activeItem.id)) {
      setActiveItem(null);
    }
  }, [activeItem, items]);

  useEffect(() => {
    if (!isInspectorPanelVisible || inspectorTab !== "details") {
      return;
    }
    if (selectedIds.length !== 1) {
      setActiveItem((prev) => (prev ? null : prev));
      return;
    }
    const [selectedId] = selectedIds;
    const nextItem = items.find((item) => item.id === selectedId) ?? null;
    setActiveItem((prev) => {
      if (!nextItem) {
        return prev ? null : prev;
      }
      if (prev?.id === nextItem.id) {
        return prev;
      }
      return nextItem;
    });
  }, [inspectorTab, isInspectorPanelVisible, items, selectedIds]);

  useEffect(() => {
    setSelectionAnchorId((prev) => {
      if (!prev) return null;
      return listItems.some((item) => item.id === prev) ? prev : null;
    });
    setActiveRowId((prev) => {
      if (prev && listItems.some((item) => item.id === prev)) {
        return prev;
      }
      const firstVisibleSelected = listItems.find((item) =>
        selectedIds.includes(item.id),
      );
      return firstVisibleSelected?.id ?? null;
    });
  }, [listItems, selectedIds]);

  useEffect(() => {
    if (
      storageFilter !== "all" &&
      !searchableStorageClasses.includes(storageFilter)
    ) {
      setStorageFilter("all");
    }
  }, [searchableStorageClasses, storageFilter]);

  const loadBucketInspectorData = useCallback(
    async (force = false) => {
      if (!bucketName || !hasS3AccountContext) return;
      if (!force && bucketInspectorByName[bucketName]) {
        setBucketInspectorError(null);
        return;
      }
      const requestId = bucketInspectorRequestIdRef.current + 1;
      bucketInspectorRequestIdRef.current = requestId;
      setBucketInspectorLoading(true);
      setBucketInspectorError(null);
      try {
        const results = await Promise.allSettled([
          getBucketStats(accountIdForApi, bucketName, {
            with_stats: bucketInspectorUsageEnabled,
          }),
          getBucketProperties(accountIdForApi, bucketName),
          getBucketPolicy(accountIdForApi, bucketName),
          getBucketLogging(accountIdForApi, bucketName),
          bucketInspectorStaticWebsiteEnabled
            ? getBucketWebsite(accountIdForApi, bucketName)
            : Promise.resolve(null),
        ]);
        if (bucketInspectorRequestIdRef.current !== requestId) return;
        const bucketsResult = results[0];
        const propertiesResult = results[1];
        const policyResult = results[2];
        const loggingResult = results[3];
        const websiteResult = results[4];

        const selectedBucket =
          bucketsResult.status === "fulfilled" ? bucketsResult.value : null;

        const unavailableFeature = (
          state = "Unavailable",
        ): BucketInspectorFeature => ({ state, tone: "unknown" });
        const activeFeature = (state: string): BucketInspectorFeature => ({
          state,
          tone: "active",
        });
        const inactiveFeature = (state: string): BucketInspectorFeature => ({
          state,
          tone: "inactive",
        });

        const features: Record<string, BucketInspectorFeature> = {};

        if (propertiesResult.status === "fulfilled") {
          const properties = propertiesResult.value;
          const versioningRaw = (
            properties.versioning_status ?? "Disabled"
          ).trim();
          const versioningNormalized = versioningRaw.toLowerCase();
          if (versioningNormalized === "enabled") {
            features.versioning = activeFeature("Enabled");
          } else if (versioningNormalized === "suspended") {
            features.versioning = unavailableFeature(
              versioningRaw || "Suspended",
            );
          } else {
            features.versioning = inactiveFeature(versioningRaw || "Disabled");
          }

          const objectLockEnabled = Boolean(
            properties.object_lock?.enabled ?? properties.object_lock_enabled,
          );
          features.object_lock = objectLockEnabled
            ? activeFeature("Enabled")
            : inactiveFeature("Disabled");

          const publicBlock = properties.public_access_block;
          if (!publicBlock) {
            features.block_public_access = inactiveFeature("Disabled");
          } else {
            const flags = [
              publicBlock.block_public_acls,
              publicBlock.ignore_public_acls,
              publicBlock.block_public_policy,
              publicBlock.restrict_public_buckets,
            ];
            const fullyEnabled = flags.every((flag) => flag === true);
            const partiallyEnabled =
              !fullyEnabled && flags.some((flag) => flag === true);
            features.block_public_access = fullyEnabled
              ? activeFeature("Enabled")
              : partiallyEnabled
                ? activeFeature("Partial")
                : inactiveFeature("Disabled");
          }

          const lifecycleRules = properties.lifecycle_rules ?? [];
          features.lifecycle_rules =
            lifecycleRules.length > 0
              ? activeFeature("Enabled")
              : inactiveFeature("Disabled");

          const corsRules = properties.cors_rules ?? [];
          features.cors =
            corsRules.length > 0
              ? activeFeature("Configured")
              : inactiveFeature("Not set");
        } else {
          features.versioning = unavailableFeature();
          features.object_lock = unavailableFeature();
          features.block_public_access = unavailableFeature();
          features.lifecycle_rules = unavailableFeature();
          features.cors = unavailableFeature();
        }

        if (policyResult.status === "fulfilled") {
          const policy = policyResult.value.policy;
          const configured = Boolean(policy && Object.keys(policy).length > 0);
          features.bucket_policy = configured
            ? activeFeature("Configured")
            : inactiveFeature("Not set");
        } else {
          features.bucket_policy = unavailableFeature();
        }

        if (loggingResult.status === "fulfilled") {
          const logging = loggingResult.value;
          const enabled = Boolean(
            logging.enabled && (logging.target_bucket ?? "").trim().length > 0,
          );
          features.access_logging = enabled
            ? activeFeature("Enabled")
            : inactiveFeature("Disabled");
        } else {
          features.access_logging = unavailableFeature();
        }

        if (!bucketInspectorStaticWebsiteEnabled) {
          features.static_website = unavailableFeature();
        } else if (websiteResult.status === "fulfilled") {
          const website = websiteResult.value;
          const routingRules = Array.isArray(website?.routing_rules)
            ? website.routing_rules
            : [];
          const configured = Boolean(
            (website?.redirect_all_requests_to?.host_name ?? "").trim() ||
            (website?.index_document ?? "").trim() ||
            routingRules.length > 0,
          );
          features.static_website = configured
            ? activeFeature("Enabled")
            : inactiveFeature("Disabled");
        } else {
          features.static_website = unavailableFeature();
        }

        const quotaConfigured = Boolean(
          (selectedBucket?.quota_max_size_bytes ?? 0) > 0 ||
          (selectedBucket?.quota_max_objects ?? 0) > 0,
        );
        features.quota = selectedBucket
          ? quotaConfigured
            ? activeFeature("Configured")
            : inactiveFeature("Not set")
          : unavailableFeature();

        const payload: BucketInspectorData = {
          creation_date: selectedBucket?.creation_date ?? null,
          used_bytes: selectedBucket?.used_bytes ?? null,
          object_count: selectedBucket?.object_count ?? null,
          quota_max_size_bytes: selectedBucket?.quota_max_size_bytes ?? null,
          quota_max_objects: selectedBucket?.quota_max_objects ?? null,
          features,
        };

        setBucketInspectorByName((prev) => ({
          ...prev,
          [bucketName]: payload,
        }));
      } catch (err) {
        if (bucketInspectorRequestIdRef.current !== requestId) return;
        setBucketInspectorError(
          extractApiError(err, "Unable to load bucket stats and features."),
        );
      } finally {
        if (bucketInspectorRequestIdRef.current === requestId) {
          setBucketInspectorLoading(false);
        }
      }
    },
    [
      accountIdForApi,
      bucketInspectorByName,
      bucketName,
      bucketInspectorStaticWebsiteEnabled,
      bucketInspectorUsageEnabled,
      hasS3AccountContext,
    ],
  );

  const handleOpenBucketInspector = useCallback(() => {
    setInspectorTab("bucket");
    if (!bucketName || !hasS3AccountContext || bucketInspectorLoading) return;
    if (bucketInspectorByName[bucketName]) return;
    void loadBucketInspectorData();
  }, [
    bucketInspectorByName,
    bucketInspectorLoading,
    bucketName,
    hasS3AccountContext,
    loadBucketInspectorData,
  ]);

  const syncInspectorTabWithSelection = useCallback(
    (nextSelectedCount: number) => {
      setInspectorTab((currentTab) => {
        if (isInspectorPanelVisible && currentTab === "details") {
          return "details";
        }
        return nextSelectedCount > 0 ? "selection" : "context";
      });
    },
    [isInspectorPanelVisible],
  );

  const selectRangeBetweenRows = (anchorId: string, targetId: string) => {
    const anchorIndex = listItems.findIndex((item) => item.id === anchorId);
    const targetIndex = listItems.findIndex((item) => item.id === targetId);
    if (anchorIndex < 0 || targetIndex < 0) {
      setSelectedIds([targetId]);
      setSelectionAnchorId(targetId);
      setActiveRowId(targetId);
      syncInspectorTabWithSelection(1);
      return;
    }
    const [start, end] =
      anchorIndex <= targetIndex
        ? [anchorIndex, targetIndex]
        : [targetIndex, anchorIndex];
    const rangeIds = listItems.slice(start, end + 1).map((item) => item.id);
    setSelectedIds(rangeIds);
    setSelectionAnchorId(anchorId);
    setActiveRowId(targetId);
    syncInspectorTabWithSelection(rangeIds.length);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const isSelected = prev.includes(id);
      const next = isSelected
        ? prev.filter((itemId) => itemId !== id)
        : [...prev, id];
      syncInspectorTabWithSelection(next.length);
      return next;
    });
    setSelectionAnchorId(id);
    setActiveRowId(id);
  };

  const selectSingleRow = (id: string) => {
    setSelectedIds([id]);
    setSelectionAnchorId(id);
    setActiveRowId(id);
    syncInspectorTabWithSelection(1);
  };

  const handleItemSelectionClick = (
    event: ReactMouseEvent<HTMLElement>,
    itemId: string,
  ) => {
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
  };

  const handleItemNameClick = (
    event: ReactMouseEvent<HTMLElement>,
    item: BrowserItem,
  ) => {
    handleItemSelectionClick(event, item.id);
  };

  const toggleAllSelection = () => {
    if (allSelected) {
      setSelectedIds([]);
      setSelectionAnchorId(null);
      setActiveRowId(null);
      syncInspectorTabWithSelection(0);
      return;
    }
    const nextIds = listItems.map((item) => item.id);
    setSelectedIds(nextIds);
    setSelectionAnchorId(nextIds[0] ?? null);
    setActiveRowId(nextIds[0] ?? null);
    syncInspectorTabWithSelection(nextIds.length);
  };

  const handleItemContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    item: BrowserItem,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const isSelected = selectedSet.has(item.id);
    const itemsForMenu = isSelected ? selectedItems : [item];
    if (!isSelected) {
      setSelectedIds([item.id]);
      setSelectionAnchorId(item.id);
      setActiveRowId(item.id);
    }
    const { x, y } = getContextMenuPosition(event);
    setContextMenu({
      kind: isSelected && selectedItems.length > 1 ? "selection" : "item",
      x,
      y,
      item,
      items: itemsForMenu,
    });
  };

  const handleItemActionsButtonClick = (
    event: ReactMouseEvent<HTMLButtonElement>,
    item: BrowserItem,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedIds.length !== 1 || selectedIds[0] !== item.id) {
      selectSingleRow(item.id);
    } else {
      setSelectionAnchorId(item.id);
      setActiveRowId(item.id);
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const { x, y } = clampContextMenuPosition(
      rect.right - CONTEXT_MENU_FALLBACK_WIDTH_PX,
      rect.bottom + 6,
      CONTEXT_MENU_FALLBACK_WIDTH_PX,
      CONTEXT_MENU_FALLBACK_HEIGHT_PX,
    );
    setContextMenu({
      kind: "item",
      x,
      y,
      item,
      items: [item],
    });
  };

  const handlePathContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, label")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const { x, y } = getContextMenuPosition(event);
    setContextMenu({ kind: "path", x, y });
  };

  const handleHeaderContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!isMainBrowserPath) return;
    event.preventDefault();
    event.stopPropagation();
    const { x, y } = getContextMenuPosition(event);
    setContextMenu({ kind: "headerConfig", x, y });
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    if (listItems.length === 0) {
      return;
    }
    const getCurrentIndex = () => {
      if (activeRowId) {
        const activeIndex = listItems.findIndex(
          (item) => item.id === activeRowId,
        );
        if (activeIndex >= 0) {
          return activeIndex;
        }
      }
      const selectedIndex = listItems.findIndex((item) =>
        selectedSet.has(item.id),
      );
      return selectedIndex;
    };
    const currentIndex = getCurrentIndex();
    const applyRowSelection = (nextIndex: number, extendRange: boolean) => {
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
      const nextIndex =
        currentIndex < 0 ? 0 : Math.min(listItems.length - 1, currentIndex + 1);
      applyRowSelection(nextIndex, event.shiftKey);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex =
        currentIndex < 0 ? listItems.length - 1 : Math.max(0, currentIndex - 1);
      applyRowSelection(nextIndex, event.shiftKey);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      applyRowSelection(0, event.shiftKey);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      applyRowSelection(listItems.length - 1, event.shiftKey);
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      const targetIndex = currentIndex < 0 ? 0 : currentIndex;
      const targetId = listItems[targetIndex]?.id;
      if (!targetId) return;
      toggleSelection(targetId);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const targetIndex = currentIndex < 0 ? 0 : currentIndex;
      const targetItem = listItems[targetIndex];
      if (!targetItem) return;
      openItemPrimaryAction(targetItem);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedIds([]);
      setSelectionAnchorId(null);
      setActiveRowId(null);
      setActiveItem(null);
      syncInspectorTabWithSelection(0);
    }
  };

  const handleListBackgroundClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, label")) {
      return;
    }
    if (target.closest("[data-browser-item]")) {
      return;
    }
    setSelectedIds([]);
    setSelectionAnchorId(null);
    setActiveRowId(null);
    setActiveItem(null);
    syncInspectorTabWithSelection(0);
  };

  const openBucketConfigurationModal = (targetBucket: string) => {
    if (!bucketConfigurationEnabled) return;
    const normalized = targetBucket.trim();
    if (!normalized) return;
    setShowBucketMenu(false);
    setBucketFilter("");
    setConfigBucketName(normalized);
  };

  const closeBucketConfigurationModal = () => {
    setConfigBucketName(null);
    if (bucketName) {
      void loadBucketInspectorData(true);
    }
  };

  const resetMultipartUploadsState = () => {
    setMultipartUploads([]);
    setMultipartUploadsLoading(false);
    setMultipartUploadsLoadingMore(false);
    setMultipartUploadsError(null);
    setMultipartUploadsNextKey(null);
    setMultipartUploadsNextUploadId(null);
    setMultipartUploadsIsTruncated(false);
    setAbortingMultipartUploadIds(new Set());
  };

  const loadMultipartUploadsPage = async (options?: {
    append?: boolean;
    keyMarker?: string | null;
    uploadIdMarker?: string | null;
  }) => {
    if (!bucketName || !hasS3AccountContext) return;
    const append = Boolean(options?.append);
    if (append) {
      if (!multipartUploadsIsTruncated || multipartUploadsLoadingMore) return;
      setMultipartUploadsLoadingMore(true);
    } else {
      setMultipartUploadsLoading(true);
      setMultipartUploadsError(null);
    }
    try {
      const data = await listMultipartUploads(accountIdForApi, bucketName, {
        keyMarker: append ? (options?.keyMarker ?? undefined) : undefined,
        uploadIdMarker: append
          ? (options?.uploadIdMarker ?? undefined)
          : undefined,
        maxUploads: MULTIPART_UPLOADS_PAGE_SIZE,
      });
      const baseUploads = append ? multipartUploads : [];
      const knownIds = new Set(
        baseUploads.map((upload) => getMultipartUploadEntryId(upload)),
      );
      const incomingUploads = append
        ? data.uploads.filter(
            (upload) => !knownIds.has(getMultipartUploadEntryId(upload)),
          )
        : data.uploads;
      const mergedUploads = append
        ? [...baseUploads, ...incomingUploads]
        : incomingUploads;
      const limitReached = mergedUploads.length > MULTIPART_UPLOADS_HARD_LIMIT;
      setMultipartUploads(mergedUploads.slice(0, MULTIPART_UPLOADS_HARD_LIMIT));
      setMultipartUploadsError(null);
      if (limitReached) {
        setMultipartUploadsNextKey(null);
        setMultipartUploadsNextUploadId(null);
        setMultipartUploadsIsTruncated(false);
        setWarningMessage(
          `Multipart uploads listing is limited to ${MULTIPART_UPLOADS_HARD_LIMIT.toLocaleString()} entries. Narrow your scope to continue.`,
        );
      } else {
        setMultipartUploadsNextKey(data.next_key ?? null);
        setMultipartUploadsNextUploadId(data.next_upload_id ?? null);
        setMultipartUploadsIsTruncated(Boolean(data.is_truncated));
      }
    } catch (err) {
      setMultipartUploadsError(
        extractApiError(err, "Unable to list multipart uploads."),
      );
      if (!append) {
        setMultipartUploads([]);
        setMultipartUploadsNextKey(null);
        setMultipartUploadsNextUploadId(null);
        setMultipartUploadsIsTruncated(false);
      }
    } finally {
      if (append) {
        setMultipartUploadsLoadingMore(false);
      } else {
        setMultipartUploadsLoading(false);
      }
    }
  };

  const openMultipartUploadsModal = () => {
    if (!bucketName || !hasS3AccountContext) return;
    setShowMultipartUploadsModal(true);
    resetMultipartUploadsState();
    void loadMultipartUploadsPage();
  };

  const refreshMultipartUploads = () => {
    if (!bucketName || !hasS3AccountContext) return;
    void loadMultipartUploadsPage();
  };

  const loadMoreMultipartUploads = () => {
    if (!bucketName || !hasS3AccountContext || !multipartUploadsIsTruncated)
      return;
    void loadMultipartUploadsPage({
      append: true,
      keyMarker: multipartUploadsNextKey,
      uploadIdMarker: multipartUploadsNextUploadId,
    });
  };

  const closeMultipartUploadsModal = () => {
    setShowMultipartUploadsModal(false);
  };

  const confirmAbortMultipartUpload = async (upload: MultipartUploadItem) => {
    if (!bucketName || !hasS3AccountContext) return;
    const uploadRowId = getMultipartUploadEntryId(upload);
    setAbortingMultipartUploadIds((prev) => {
      const next = new Set(prev);
      next.add(uploadRowId);
      return next;
    });
    try {
      await abortMultipartUpload(
        accountIdForApi,
        bucketName,
        upload.upload_id,
        upload.key,
      );
      setMultipartUploads((prev) =>
        prev.filter(
          (entry) => getMultipartUploadEntryId(entry) !== uploadRowId,
        ),
      );
      setStatusMessage(`Multipart upload aborted for ${upload.key}.`);
    } catch (err) {
      const message = extractApiError(err, "Unable to abort multipart upload.");
      setMultipartUploadsError(message);
      setStatusMessage(message);
    } finally {
      setAbortingMultipartUploadIds((prev) => {
        const next = new Set(prev);
        next.delete(uploadRowId);
        return next;
      });
    }
  };

  const requestAbortMultipartUpload = (upload: MultipartUploadItem) => {
    openConfirmDialog({
      title: "Abort multipart upload",
      message: `Abort multipart upload for ${upload.key}?`,
      confirmLabel: "Abort",
      tone: "danger",
      onConfirm: () => confirmAbortMultipartUpload(upload),
    });
  };

  useEffect(() => {
    setShowMultipartUploadsModal(false);
    setMultipartUploads([]);
    setMultipartUploadsLoading(false);
    setMultipartUploadsLoadingMore(false);
    setMultipartUploadsError(null);
    setMultipartUploadsNextKey(null);
    setMultipartUploadsNextUploadId(null);
    setMultipartUploadsIsTruncated(false);
    setAbortingMultipartUploadIds(new Set());
  }, [bucketName, hasS3AccountContext]);

  const openCreateBucketDialog = () => {
    if (!bucketManagementEnabled) return;
    setShowBucketMenu(false);
    setBucketFilter("");
    setCreateBucketNameValue("");
    setCreateBucketVersioning(false);
    setCreateBucketError(null);
    setShowCreateBucketModal(true);
  };

  const closeCreateBucketDialog = () => {
    if (createBucketLoading) return;
    setShowCreateBucketModal(false);
    setCreateBucketError(null);
  };

  const handleCreateBucketSubmit = async () => {
    if (!hasS3AccountContext || !bucketManagementEnabled || createBucketLoading)
      return;
    const bucketNameInput = normalizeS3BucketName(createBucketNameValue);
    if (!bucketNameInput) {
      setCreateBucketError("Bucket name is required.");
      return;
    }
    if (!isValidS3BucketName(bucketNameInput)) {
      setCreateBucketError(invalidBucketNameMessage);
      return;
    }
    setCreateBucketLoading(true);
    setCreateBucketError(null);
    setCorsFixError(null);
    try {
      await createBrowserBucket(accountIdForApi, bucketNameInput, {
        versioning: createBucketVersioning,
      });
      let corsApplied = false;
      if (uiOrigin) {
        try {
          const status = await ensureBucketCors(
            accountIdForApi,
            bucketNameInput,
            uiOrigin,
          );
          corsApplied = status.enabled;
          if (bucketName === bucketNameInput) {
            setCorsStatus(status);
          }
          if (!status.enabled && status.error) {
            setCorsFixError(status.error);
          }
        } catch {
          setCorsFixError("Bucket created, but unable to auto-apply CORS.");
        }
      }
      setShowCreateBucketModal(false);
      setStatusMessage(
        uiOrigin
          ? corsApplied
            ? `Bucket ${bucketNameInput} created with CORS enabled.`
            : `Bucket ${bucketNameInput} created. CORS could not be auto-enabled.`
          : `Bucket ${bucketNameInput} created.`,
      );
      await refreshBucketList({ preferredBucket: bucketNameInput });
      void loadBucketInspectorData(true);
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { detail?: string })?.detail ||
          err.message ||
          "Unable to create bucket."
        : err instanceof Error
          ? err.message
          : "Unable to create bucket.";
      setCreateBucketError(message);
    } finally {
      setCreateBucketLoading(false);
    }
  };

  const normalizeVisibleColumns = useCallback(
    (columnIds: BrowserColumnId[]) => {
      const selected = new Set(columnIds);
      return COLUMN_IDS_IN_ORDER.filter((columnId) => selected.has(columnId));
    },
    [],
  );

  const resetAllColumnWidths = useCallback(() => {
    setColumnWidths({});
  }, []);

  const handleToggleVisibleColumn = useCallback(
    (columnId: BrowserColumnId) => {
      setVisibleColumns((prev) => {
        const selected = new Set(prev);
        if (selected.has(columnId)) {
          selected.delete(columnId);
        } else {
          selected.add(columnId);
        }
        return normalizeVisibleColumns(Array.from(selected));
      });
    },
    [normalizeVisibleColumns],
  );

  const handleResetVisibleColumns = useCallback(() => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMN_IDS);
    resetAllColumnWidths();
  }, [resetAllColumnWidths]);

  const loadLazyColumnDataForItems = useCallback(
    async (itemIds: string[]) => {
      const batchIds = Array.from(new Set(itemIds));
      if (batchIds.length === 0) return;

      const loadPlan = new Map<
        string,
        { key: string; loadMetadata: boolean; loadTags: boolean }
      >();
      batchIds.forEach((itemId) => {
        const currentEntry =
          lazyColumnCacheRef.current[itemId] ?? createLazyColumnCacheEntry();
        const loadMetadata =
          lazyMetadataColumnsVisible &&
          (currentEntry.metadataStatus === "loading" ||
            currentEntry.metadataStatus === "idle");
        const loadTags =
          lazyTagsColumnsVisible &&
          (currentEntry.tagsStatus === "loading" ||
            currentEntry.tagsStatus === "idle");
        if (!loadMetadata && !loadTags) {
          return;
        }
        const item = lazyListItemsByIdRef.current.get(itemId);
        if (!item || item.type !== "file" || item.isDeleted) {
          loadPlan.set(itemId, {
            key: itemId,
            loadMetadata,
            loadTags,
          });
          return;
        }
        loadPlan.set(itemId, {
          key: item.key,
          loadMetadata,
          loadTags,
        });
      });
      if (loadPlan.size === 0) return;

      if (!bucketName || !hasS3AccountContext) {
        setLazyColumnCache((prev) => {
          const next = { ...prev };
          loadPlan.forEach((plan, itemId) => {
            const entry = next[itemId];
            if (!entry) return;
            next[itemId] = {
              ...entry,
              metadataStatus:
                plan.loadMetadata && entry.metadataStatus === "loading"
                  ? "error"
                  : entry.metadataStatus,
              tagsStatus:
                plan.loadTags && entry.tagsStatus === "loading"
                  ? "error"
                  : entry.tagsStatus,
            };
          });
          return next;
        });
        return;
      }

      const requestedColumns: Array<
        | "content_type"
        | "tags_count"
        | "metadata_count"
        | "cache_control"
        | "expires"
        | "restore_status"
      > = [];
      if (Array.from(loadPlan.values()).some((plan) => plan.loadMetadata)) {
        requestedColumns.push(
          "content_type",
          "metadata_count",
          "cache_control",
          "expires",
          "restore_status",
        );
      }
      if (Array.from(loadPlan.values()).some((plan) => plan.loadTags)) {
        requestedColumns.push("tags_count");
      }
      if (requestedColumns.length === 0) return;

      const keys = Array.from(
        new Set(
          Array.from(loadPlan.values())
            .map((plan) => plan.key)
            .filter((value) => value.length > 0),
        ),
      );
      try {
        const response = await fetchBrowserObjectColumns(
          accountIdForApi,
          bucketName,
          {
            keys,
            columns: requestedColumns,
          },
          {
            sseCustomerKeyBase64,
          },
        );
        if (
          accountIdForApiRef.current !== accountIdForApi ||
          bucketNameRef.current !== bucketName ||
          prefixRef.current !== prefix
        ) {
          return;
        }

        const valuesByKey = new Map(
          response.items.map((entry) => [entry.key, entry]),
        );
        setLazyColumnCache((prev) => {
          const next = { ...prev };
          loadPlan.forEach((plan, itemId) => {
            const entry = next[itemId] ?? createLazyColumnCacheEntry();
            const values = valuesByKey.get(plan.key);
            let nextEntry = entry;

            if (plan.loadMetadata) {
              if (values && values.metadata_status === "ready") {
                nextEntry = {
                  ...nextEntry,
                  contentType: values.content_type ?? null,
                  metadataCount: values.metadata_count ?? 0,
                  cacheControl: values.cache_control ?? null,
                  expires: values.expires ?? null,
                  restoreStatus: values.restore_status ?? null,
                  metadataStatus: "ready",
                };
              } else {
                nextEntry = { ...nextEntry, metadataStatus: "error" };
              }
            }

            if (plan.loadTags) {
              if (values && values.tags_status === "ready") {
                nextEntry = {
                  ...nextEntry,
                  tagsCount: values.tags_count ?? 0,
                  tagsStatus: "ready",
                };
              } else {
                nextEntry = { ...nextEntry, tagsStatus: "error" };
              }
            }

            next[itemId] = nextEntry;
          });
          return next;
        });
      } catch {
        setLazyColumnCache((prev) => {
          const next = { ...prev };
          loadPlan.forEach((plan, itemId) => {
            const entry = next[itemId];
            if (!entry) return;
            next[itemId] = {
              ...entry,
              metadataStatus:
                plan.loadMetadata && entry.metadataStatus === "loading"
                  ? "error"
                  : entry.metadataStatus,
              tagsStatus:
                plan.loadTags && entry.tagsStatus === "loading"
                  ? "error"
                  : entry.tagsStatus,
            };
          });
          return next;
        });
      }
    },
    [
      accountIdForApi,
      bucketName,
      hasS3AccountContext,
      lazyMetadataColumnsVisible,
      lazyTagsColumnsVisible,
      prefix,
      sseCustomerKeyBase64,
    ],
  );

  const drainLazyColumnQueue = useCallback(() => {
    while (lazyInFlightRef.current < LAZY_COLUMN_CONCURRENCY) {
      const nextItemIds = lazyQueueRef.current.splice(0, LAZY_COLUMN_BATCH_SIZE);
      if (nextItemIds.length === 0) {
        return;
      }
      nextItemIds.forEach((itemId) => {
        lazyQueuedIdsRef.current.delete(itemId);
      });
      lazyInFlightRef.current += 1;
      void loadLazyColumnDataForItems(nextItemIds)
        .catch(() => undefined)
        .finally(() => {
          lazyInFlightRef.current -= 1;
          drainLazyColumnQueue();
        });
    }
  }, [loadLazyColumnDataForItems]);

  const scheduleLazyColumnLoad = useCallback(
    (itemId: string) => {
      if (!hasActiveLazyColumns) return;
      const item = lazyListItemsByIdRef.current.get(itemId);
      if (!item || item.type !== "file" || item.isDeleted) return;

      const currentEntry =
        lazyColumnCacheRef.current[itemId] ?? createLazyColumnCacheEntry();
      const shouldLoadMetadata =
        lazyMetadataColumnsVisible && currentEntry.metadataStatus === "idle";
      const shouldLoadTags =
        lazyTagsColumnsVisible && currentEntry.tagsStatus === "idle";
      if (!shouldLoadMetadata && !shouldLoadTags) return;

      setLazyColumnCache((prev) => {
        const entry = prev[itemId] ?? createLazyColumnCacheEntry();
        let nextEntry = entry;
        if (shouldLoadMetadata && entry.metadataStatus === "idle") {
          nextEntry = { ...nextEntry, metadataStatus: "loading" };
        }
        if (shouldLoadTags && entry.tagsStatus === "idle") {
          nextEntry = { ...nextEntry, tagsStatus: "loading" };
        }
        return { ...prev, [itemId]: nextEntry };
      });

      if (!lazyQueuedIdsRef.current.has(itemId)) {
        lazyQueuedIdsRef.current.add(itemId);
        lazyQueueRef.current.push(itemId);
      }
      drainLazyColumnQueue();
    },
    [
      drainLazyColumnQueue,
      hasActiveLazyColumns,
      lazyMetadataColumnsVisible,
      lazyTagsColumnsVisible,
    ],
  );

  useEffect(() => {
    if (!hasActiveLazyColumns) return;
    const root = objectsListViewportRef.current;
    if (!root) return;

    const rowNodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-lazy-item-id]"),
    );
    if (rowNodes.length === 0) return;

    const rootRect = root.getBoundingClientRect();
    const rootMarginPx = Number.parseInt(LAZY_COLUMN_ROOT_MARGIN, 10) || 0;
    const viewportTop = rootRect.top - rootMarginPx;
    const viewportBottom = rootRect.bottom + rootMarginPx;
    rowNodes.forEach((node) => {
      const itemId = node.dataset.lazyItemId;
      if (!itemId) return;
      if (rootRect.height <= 0 || rootRect.width <= 0) {
        scheduleLazyColumnLoad(itemId);
        return;
      }
      const rowRect = node.getBoundingClientRect();
      const intersectsViewport =
        rowRect.bottom >= viewportTop && rowRect.top <= viewportBottom;
      if (intersectsViewport) {
        scheduleLazyColumnLoad(itemId);
      }
    });

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      rowNodes.forEach((node) => {
        const itemId = node.dataset.lazyItemId;
        if (itemId) {
          scheduleLazyColumnLoad(itemId);
        }
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const itemId = (entry.target as HTMLElement).dataset.lazyItemId;
          if (itemId) {
            scheduleLazyColumnLoad(itemId);
          }
          observer.unobserve(entry.target);
        });
      },
      { root, rootMargin: LAZY_COLUMN_ROOT_MARGIN },
    );
    rowNodes.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
    };
  }, [hasActiveLazyColumns, listItems, scheduleLazyColumnLoad]);

  const listVersionStats = async (opts: {
    prefix?: string;
    key?: string | null;
  }) => {
    if (!isVersioningEnabled) {
      return {
        objectCount: 0,
        totalBytes: 0,
        versionsCount: 0,
        deleteMarkersCount: 0,
      };
    }
    let versionsCount = 0;
    let deleteMarkersCount = 0;
    const latestByKey = new Map<string, { isDelete: boolean; size: number }>();
    let keyMarker: string | null = null;
    let versionIdMarker: string | null = null;
    let isTruncated = true;
    let pageGuard = 0;

    while (isTruncated) {
      const data = await listObjectVersions(accountIdForApi, bucketName, {
        prefix: opts.prefix ?? "",
        key: opts.key ?? undefined,
        keyMarker: keyMarker ?? undefined,
        versionIdMarker: versionIdMarker ?? undefined,
        maxKeys: VERSIONS_PAGE_SIZE,
      });
      versionsCount += data.versions.length;
      deleteMarkersCount += data.delete_markers.length;
      data.versions.forEach((version) => {
        if (!version.is_latest) return;
        latestByKey.set(version.key, {
          isDelete: false,
          size: version.size ?? 0,
        });
      });
      data.delete_markers.forEach((marker) => {
        if (!marker.is_latest) return;
        latestByKey.set(marker.key, { isDelete: true, size: 0 });
      });
      isTruncated = data.is_truncated;
      keyMarker = data.next_key_marker ?? null;
      versionIdMarker = data.next_version_id_marker ?? null;
      pageGuard += 1;
      if (
        !isTruncated ||
        pageGuard > 1000 ||
        (!keyMarker && !versionIdMarker)
      ) {
        break;
      }
    }

    let objectCount = 0;
    let totalBytes = 0;
    latestByKey.forEach((entry) => {
      if (entry.isDelete) return;
      objectCount += 1;
      totalBytes += entry.size;
    });

    return { objectCount, totalBytes, versionsCount, deleteMarkersCount };
  };

  const handleContextCount = async () => {
    if (!bucketName || !hasS3AccountContext) return;
    const requestId = contextCountIdRef.current + 1;
    contextCountIdRef.current = requestId;
    setContextCountsLoading(true);
    setContextCountsError(null);
    try {
      if (!isVersioningEnabled) {
        const objects = await listAllObjectsForPrefix(normalizedPrefix);
        if (contextCountIdRef.current !== requestId) return;
        setContextCounts({
          objects: objects.length,
          versions: 0,
          deleteMarkers: 0,
        });
        return;
      }
      const stats = await listVersionStats({ prefix: normalizedPrefix });
      if (contextCountIdRef.current !== requestId) return;
      setContextCounts({
        objects: stats.objectCount,
        versions: stats.versionsCount,
        deleteMarkers: stats.deleteMarkersCount,
      });
    } catch {
      if (contextCountIdRef.current !== requestId) return;
      setContextCountsError("Unable to count objects for this prefix.");
    } finally {
      if (contextCountIdRef.current === requestId) {
        setContextCountsLoading(false);
      }
    }
  };

  const calculateSelectionStats = async () => {
    if (!bucketName || !hasS3AccountContext) return;
    if (selectionItems.length === 0) return;
    const requestId = selectionStatsRequestIdRef.current + 1;
    selectionStatsRequestIdRef.current = requestId;
    setSelectionStatsLoading(true);
    setSelectionStatsError(null);
    try {
      const folderPrefixes = selectionItems
        .filter((item) => item.type === "folder")
        .map((item) => normalizePrefix(item.key));
      const sortedFolders = [...folderPrefixes].sort(
        (a, b) => a.length - b.length,
      );
      const uniqueFolders: string[] = [];
      sortedFolders.forEach((prefixKey) => {
        if (uniqueFolders.some((parent) => prefixKey.startsWith(parent)))
          return;
        uniqueFolders.push(prefixKey);
      });

      const isFileCoveredByFolder = (key: string) =>
        uniqueFolders.some((prefixKey) => key.startsWith(prefixKey));
      let objectCount = 0;
      let totalBytes = 0;

      const fileItems = selectionItems.filter(
        (item) => item.type === "file" && !isFileCoveredByFolder(item.key),
      );
      for (const item of fileItems) {
        const stats = await listVersionStats({ key: item.key });
        if (selectionStatsRequestIdRef.current !== requestId) return;
        objectCount += stats.objectCount;
        totalBytes += stats.totalBytes;
      }

      for (const prefixKey of uniqueFolders) {
        const stats = await listVersionStats({ prefix: prefixKey });
        if (selectionStatsRequestIdRef.current !== requestId) return;
        objectCount += stats.objectCount;
        totalBytes += stats.totalBytes;
      }

      if (selectionStatsRequestIdRef.current !== requestId) return;
      setSelectionStats({ objectCount, totalBytes });
    } catch {
      if (selectionStatsRequestIdRef.current !== requestId) return;
      setSelectionStatsError("Unable to calculate selection stats.");
    } finally {
      if (selectionStatsRequestIdRef.current === requestId) {
        setSelectionStatsLoading(false);
      }
    }
  };
  const handleSortToggle = (key: BrowserSortKey) => {
    setSortId((prev) => {
      if (!prev.startsWith(key)) {
        return `${key}-asc`;
      }
      return prev.endsWith("asc") ? `${key}-desc` : `${key}-asc`;
    });
  };

  const handleRefresh = () => {
    if (!hasS3AccountContext) return;
    if (!bucketName) {
      void refreshBucketList();
      return;
    }
    loadObjects({ prefixOverride: prefix });
    if (showPrefixVersions) {
      loadPrefixVersions({
        append: false,
        keyMarker: null,
        versionIdMarker: null,
      });
    }
  };

  const canLoadMoreObjectResults = Boolean(
    (objectsIsTruncated && objectsNextToken) || deletedObjectsIsTruncated,
  );

  const handleLoadMoreObjectResults = () => {
    if (objectsLoadingMore) return;
    if (objectsIsTruncated && objectsNextToken) {
      void loadObjects({ append: true, continuationToken: objectsNextToken });
      return;
    }
    if (deletedObjectsIsTruncated) {
      void loadObjects({ append: true, loadDeletedOnly: true });
    }
  };

  const handleToggleTreeNode = (node: TreeNode) => {
    if (node.isExpanded) {
      setTreeNodes((prev) =>
        updateTreeNodes(prev, node.prefix, (entry) => ({
          ...entry,
          isExpanded: false,
        })),
      );
      return;
    }
    if (!node.isLoaded) {
      loadTreeChildren(node.prefix);
      return;
    }
    setTreeNodes((prev) =>
      updateTreeNodes(prev, node.prefix, (entry) => ({
        ...entry,
        isExpanded: true,
      })),
    );
  };

  const handleEnsureCors = async () => {
    if (!bucketName || !hasS3AccountContext || !uiOrigin) return;
    setCorsFixing(true);
    setCorsFixError(null);
    setStatusMessage(null);
    try {
      const status = await ensureBucketCors(
        accountIdForApi,
        bucketName,
        uiOrigin,
      );
      setCorsStatus(status);
      if (status.enabled) {
        setStatusMessage("CORS rules updated for this bucket.");
        setShowCorsActionPopover(false);
      } else {
        setCorsFixError(
          status.error ?? "CORS is still not enabled for this origin.",
        );
      }
    } catch {
      setCorsFixError("Unable to update bucket CORS configuration.");
    } finally {
      setCorsFixing(false);
    }
  };

  const handleGoUp = () => {
    if (!canGoUp) return;
    handleSelectPrefix(parentPrefix);
  };

  const addActivity = (action: string, path: string) => {
    setCompletedOperations((prev) =>
      [
        {
          id: makeId(),
          label: action,
          path,
          when: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, COMPLETED_OPERATIONS_LIMIT),
    );
  };

  const extractErrorDetails = useCallback(
    (payload: unknown): { code?: string; message?: string } | null => {
      if (!payload) return null;
      if (typeof payload === "string") {
        const trimmed = payload.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("{")) {
          try {
            const parsed = JSON.parse(trimmed) as {
              code?: unknown;
              errorCode?: unknown;
              error_code?: unknown;
              message?: unknown;
              detail?: unknown;
              error?: unknown;
            };
            const code =
              typeof parsed.code === "string"
                ? parsed.code
                : typeof parsed.errorCode === "string"
                  ? parsed.errorCode
                  : typeof parsed.error_code === "string"
                    ? parsed.error_code
                    : undefined;
            const message =
              typeof parsed.message === "string"
                ? parsed.message
                : typeof parsed.detail === "string"
                  ? parsed.detail
                  : typeof parsed.error === "string"
                    ? parsed.error
                    : undefined;
            if (code || message) {
              return { code, message };
            }
          } catch {
            // fall through to XML/inline parsing
          }
        }
        const codeMatch = trimmed.match(/<Code>([^<]+)<\/Code>/);
        const messageMatch = trimmed.match(/<Message>([^<]+)<\/Message>/);
        const code = codeMatch?.[1];
        const message = messageMatch?.[1];
        if (code || message) {
          return { code, message };
        }
        return { message: trimmed.slice(0, 300) };
      }
      if (typeof payload === "object") {
        const candidate = payload as {
          code?: unknown;
          errorCode?: unknown;
          error_code?: unknown;
          message?: unknown;
          detail?: unknown;
          error?: unknown;
        };
        const code =
          typeof candidate.code === "string"
            ? candidate.code
            : typeof candidate.errorCode === "string"
              ? candidate.errorCode
              : typeof candidate.error_code === "string"
                ? candidate.error_code
                : undefined;
        const message =
          typeof candidate.message === "string"
            ? candidate.message
            : typeof candidate.detail === "string"
              ? candidate.detail
              : typeof candidate.error === "string"
                ? candidate.error
                : undefined;
        if (code || message) {
          return { code, message };
        }
      }
      return null;
    },
    [],
  );

  const formatOperationError = useCallback(
    (err: unknown, fallback: string, context?: string) => {
      let detail: string | undefined;
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const statusText = err.response?.statusText;
        const statusLabel = status
          ? `HTTP ${status}${statusText ? ` ${statusText}` : ""}`
          : "";
        const parsed = extractErrorDetails(err.response?.data);
        const message =
          parsed?.code && parsed?.message
            ? `${parsed.code}: ${parsed.message}`
            : parsed?.message || parsed?.code;
        const parts = [statusLabel, message || err.message].filter(Boolean);
        detail = parts.length > 0 ? parts.join(" - ") : undefined;
      } else if (err instanceof Error && err.message) {
        detail = err.message;
      } else if (typeof err === "string" && err.trim()) {
        detail = err;
      } else if (err && typeof err === "object" && "message" in err) {
        const message = (err as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) {
          detail = message;
        }
      }
      const message = detail ?? fallback;
      if (context) {
        const normalize = (value: string) =>
          value.trim().replace(/[.:]\s*$/, "");
        const normalizedContext = normalize(context);
        if (!detail && normalizedContext === normalize(fallback)) {
          return fallback;
        }
        return `${normalizedContext}: ${message}`;
      }
      return message;
    },
    [extractErrorDetails],
  );

  const resetBulkAttributesDraft = () => {
    setBulkApplyMetadata(false);
    setBulkApplyTags(false);
    setBulkApplyStorageClass(false);
    setBulkApplyAcl(false);
    setBulkApplyLegalHold(false);
    setBulkApplyRetention(false);
    setBulkMetadataDraft({
      contentType: "",
      cacheControl: "",
      contentDisposition: "",
      contentEncoding: "",
      contentLanguage: "",
      expires: "",
    });
    setBulkMetadataEntries("");
    setBulkTagsDraft("");
    setBulkStorageClass("");
    setBulkAclValue("private");
    setBulkLegalHoldStatus("OFF");
    setBulkRetentionMode("");
    setBulkRetentionDate("");
    setBulkRetentionBypass(false);
    setBulkAttributesError(null);
    setBulkAttributesSummary(null);
  };

  const resetBulkRestoreDraft = () => {
    setBulkRestoreDate(formatLocalDateTime(new Date()));
    setBulkRestoreDeleteMissing(false);
    setBulkRestoreRestoreDeleted(false);
    setBulkRestoreDryRun(false);
    setBulkRestoreError(null);
    setBulkRestoreSummary(null);
    setBulkRestorePreview(null);
    setBulkRestoreTargetPath(null);
  };

  const openBulkAttributesModal = (items: BrowserItem[]) => {
    const eligibleItems = items.filter((item) => !item.isDeleted);
    if (eligibleItems.length === 0) {
      setStatusMessage("Deleted objects cannot receive bulk attributes.");
      return;
    }
    if (eligibleItems.length !== items.length) {
      setWarningMessage("Deleted objects were skipped for bulk attributes.");
    } else {
      setWarningMessage(null);
    }
    setBulkActionItems(eligibleItems);
    resetBulkAttributesDraft();
    setShowBulkAttributesModal(true);
  };

  const buildBulkRestorePathTarget = () => {
    if (!bucketName) return null;
    const key = normalizedPrefix;
    const name = key ? key.replace(/\/$/, "") : bucketName;
    return {
      id: makeId(),
      key,
      name,
      type: "folder",
      size: "",
      modified: "",
      owner: "",
      sizeBytes: null,
      modifiedAt: null,
      storageClass: undefined,
    } as BrowserItem;
  };

  const openBulkRestoreModal = (items: BrowserItem[]) => {
    if (!isVersioningEnabled) return;
    const pathTarget = buildBulkRestorePathTarget();
    const resolvedItems =
      items.length > 0 ? items : pathTarget ? [pathTarget] : [];
    if (resolvedItems.length === 0) return;
    setBulkActionItems(resolvedItems);
    resetBulkRestoreDraft();
    if (items.length === 0 && pathTarget && bucketName) {
      setBulkRestoreTargetPath(currentPath || bucketName);
    }
    setShowBulkRestoreModal(true);
  };

  const handleBulkRestoreRestoreDeletedChange = (value: boolean) => {
    setBulkRestoreRestoreDeleted(value);
    if (value) {
      setBulkRestoreDeleteMissing(false);
    }
  };

  const openObjectVersionsModal = (item: BrowserItem) => {
    openObjectDetails(item, "versions");
  };

  const requestObjectsRefresh = useCallback(
    (prefixOverride: string) => {
      if (typeof window === "undefined") return;
      if (objectsRefreshTimeoutRef.current !== null) return;
      objectsRefreshTimeoutRef.current = window.setTimeout(() => {
        objectsRefreshTimeoutRef.current = null;
        void loadObjects({ prefixOverride, silent: true });
        loadTreeChildren(prefixOverride, { expand: false });
      }, 400);
    },
    [loadObjects, loadTreeChildren],
  );

  const refreshObjectsNow = useCallback(
    async (prefixOverride: string) => {
      await loadObjects({ prefixOverride, silent: true });
      loadTreeChildren(prefixOverride, { expand: false });
    },
    [loadObjects, loadTreeChildren],
  );

  const recordUploadedKey = (bucket: string, key: string) => {
    if (!bucket || !key) return;
    const next = pendingUploadedKeysByBucketRef.current;
    const existing = next.get(bucket);
    if (existing) {
      existing.add(key);
      return;
    }
    next.set(bucket, new Set([key]));
  };

  const flushUploadRefreshIfIdle = () => {
    if (typeof window === "undefined") return;
    if (activeUploadsRef.current > 0) return;
    if (uploadQueueRef.current.length > 0) return;
    if (uploadRefreshTimeoutRef.current !== null) return;
    uploadRefreshTimeoutRef.current = window.setTimeout(() => {
      uploadRefreshTimeoutRef.current = null;
      if (activeUploadsRef.current > 0 || uploadQueueRef.current.length > 0) {
        return;
      }
      const currentBucket = bucketNameRef.current;
      if (!currentBucket) {
        pendingUploadedKeysByBucketRef.current.clear();
        return;
      }
      const currentPrefixValue = prefixRef.current;
      const normalizedCurrentPrefix = normalizePrefix(currentPrefixValue);
      const bucketKeys =
        pendingUploadedKeysByBucketRef.current.get(currentBucket);
      const shouldRefreshCurrentPath = Boolean(
        bucketKeys &&
        Array.from(bucketKeys).some((key) =>
          key.startsWith(normalizedCurrentPrefix),
        ),
      );
      pendingUploadedKeysByBucketRef.current.clear();
      if (!shouldRefreshCurrentPath) return;
      void loadObjects({ prefixOverride: currentPrefixValue, silent: true });
      loadTreeChildren(currentPrefixValue, { expand: false });
    }, 300);
  };

  useEffect(() => {
    const pendingUploadedKeysByBucket = pendingUploadedKeysByBucketRef.current;
    return () => {
      if (objectsRefreshTimeoutRef.current !== null) {
        window.clearTimeout(objectsRefreshTimeoutRef.current);
        objectsRefreshTimeoutRef.current = null;
      }
      if (uploadRefreshTimeoutRef.current !== null) {
        window.clearTimeout(uploadRefreshTimeoutRef.current);
        uploadRefreshTimeoutRef.current = null;
      }
      pendingUploadedKeysByBucket.clear();
    };
  }, []);

  const startOperation = useCallback(
    (
      status: OperationItem["status"],
      label: string,
      path: string,
      options?: {
        kind?: OperationItem["kind"];
        groupId?: string;
        groupLabel?: string;
        groupKind?: OperationItem["groupKind"];
        itemLabel?: string;
        cancelable?: boolean;
        sizeBytes?: number;
      },
      progress = status === "uploading" || status === "downloading" ? 0 : 20,
    ) => {
      const operationId = makeId();
      setOperations((prev) => [
        {
          id: operationId,
          status,
          label,
          path,
          progress,
          sizeBytes: options?.sizeBytes,
          kind: options?.kind ?? "other",
          groupId: options?.groupId,
          groupLabel: options?.groupLabel,
          groupKind: options?.groupKind,
          itemLabel: options?.itemLabel,
          cancelable: options?.cancelable ?? false,
        },
        ...prev,
      ]);
      return operationId;
    },
    [],
  );

  const completeOperation = useCallback(
    (
      operationId: string,
      status: OperationCompletionStatus = "done",
      errorMessage?: string,
    ) => {
      const completedAt = new Date().toLocaleTimeString();
      setOperations((prev) =>
        prev.map((op) =>
          op.id === operationId
            ? {
                ...op,
                progress: 100,
                cancelable: false,
                completedAt,
                completionStatus: status,
                errorMessage:
                  status === "failed"
                    ? (errorMessage ?? op.errorMessage)
                    : undefined,
              }
            : op,
        ),
      );
    },
    [],
  );

  const openConfirmDialog = (dialog: BrowserConfirmDialogState) => {
    setConfirmDialog(dialog);
    setConfirmDialogLoading(false);
  };

  const closeConfirmDialog = () => {
    if (confirmDialogLoading) return;
    setConfirmDialog(null);
  };

  const submitConfirmDialog = async () => {
    if (!confirmDialog) return;
    setConfirmDialogLoading(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmDialogLoading(false);
    }
  };

  const closeNewFolderDialog = () => {
    if (newFolderLoading) return;
    setShowNewFolderModal(false);
    setNewFolderError(null);
  };

  const handleNewFolder = () => {
    if (!bucketName || !hasS3AccountContext) return;
    setNewFolderName("");
    setNewFolderError(null);
    setNewFolderLoading(false);
    setShowNewFolderModal(true);
  };

  const handleCreateFolderFromModal = async () => {
    if (!bucketName || !hasS3AccountContext) return;
    const clean = newFolderName.replace(/^\/+|\/+$/g, "");
    if (!clean) {
      setNewFolderError("Folder name is required.");
      return;
    }
    const folderPrefix = `${normalizedPrefix}${clean}/`;
    setNewFolderLoading(true);
    setNewFolderError(null);
    try {
      await createFolder(accountIdForApi, bucketName, folderPrefix);
      addActivity("Created", `${bucketName}/${folderPrefix}`);
      setStatusMessage(`Folder ${clean} created`);
      setShowNewFolderModal(false);
      setNewFolderName("");
      await loadObjects({ prefixOverride: prefix });
      loadTreeChildren(prefix);
    } catch {
      setNewFolderError("Unable to create folder.");
    } finally {
      setNewFolderLoading(false);
    }
  };

  const updateUploadQueue = (nextQueue: UploadQueueItem[]) => {
    uploadQueueRef.current = nextQueue;
    setUploadQueue([...nextQueue]);
  };

  const removeQueuedUpload = (uploadId: string) => {
    updateUploadQueue(
      uploadQueueRef.current.filter((item) => item.id !== uploadId),
    );
  };

  const removeQueuedUploadsByGroup = (groupId: string) => {
    updateUploadQueue(
      uploadQueueRef.current.filter((item) => item.groupId !== groupId),
    );
  };

  const createOperationController = useCallback((operationId: string) => {
    const controller = new AbortController();
    operationControllersRef.current.set(operationId, controller);
    return controller;
  }, []);

  const clearOperationController = useCallback((operationId: string) => {
    operationControllersRef.current.delete(operationId);
  }, []);

  const abortOperationController = (operationId: string) => {
    const controller = operationControllersRef.current.get(operationId);
    if (controller) {
      controller.abort();
    }
  };

  const isOperationAborted = (
    err: unknown,
    controller?: AbortController | null,
  ) => isAbortError(err) || Boolean(controller?.signal.aborted);

  const cancelUploadOperation = (operationId: string) => {
    abortOperationController(operationId);
  };

  const cancelDownloadOperation = (operationId: string) => {
    abortOperationController(operationId);
  };

  const cancelCopyOperation = (operationId: string) => {
    abortOperationController(operationId);
  };

  const cancelDownloadDetails = (operationId: string) => {
    setDownloadDetails((prev) => {
      const items = prev[operationId];
      if (!items) return prev;
      const nextItems = items.map((item) =>
        item.status === "queued" || item.status === "downloading"
          ? { ...item, status: "cancelled", errorMessage: undefined }
          : item,
      );
      return { ...prev, [operationId]: nextItems };
    });
  };

  const cancelCopyDetails = useCallback((operationId: string) => {
    setCopyDetails((prev) => {
      const items = prev[operationId];
      if (!items) return prev;
      const nextItems = items.map((item) =>
        item.status === "queued" || item.status === "copying"
          ? { ...item, status: "cancelled", errorMessage: undefined }
          : item,
      );
      return { ...prev, [operationId]: nextItems };
    });
  }, []);

  const cancelDeleteDetails = useCallback((operationId: string) => {
    setDeleteDetails((prev) => {
      const items = prev[operationId];
      if (!items) return prev;
      const nextItems = items.map((item) =>
        item.status === "queued" || item.status === "deleting"
          ? { ...item, status: "cancelled", errorMessage: undefined }
          : item,
      );
      return { ...prev, [operationId]: nextItems };
    });
  }, []);

  const cancelOperation = (operationId: string) => {
    cancelUploadOperation(operationId);
    cancelDownloadOperation(operationId);
    cancelCopyOperation(operationId);
    cancelDownloadDetails(operationId);
    cancelCopyDetails(operationId);
    cancelDeleteDetails(operationId);
  };

  const cancelUploadGroup = (groupId: string) => {
    removeQueuedUploadsByGroup(groupId);
    const activeGroupOperations = operations.filter(
      (op) => op.kind === "upload" && op.groupId === groupId && !op.completedAt,
    );
    activeGroupOperations.forEach((op) => cancelUploadOperation(op.id));
  };

  const processUploadQueue = () => {
    if (!hasS3AccountContext) return;
    const parallelism = uploadParallelismRef.current;
    if (activeUploadsRef.current >= parallelism) return;
    if (uploadQueueRef.current.length === 0) return;
    const availableSlots = Math.max(0, parallelism - activeUploadsRef.current);
    const nextBatch = uploadQueueRef.current.splice(0, availableSlots);
    if (nextBatch.length === 0) return;
    updateUploadQueue(uploadQueueRef.current);
    nextBatch.forEach((item) => {
      activeUploadsRef.current += 1;
      startQueuedUpload(item)
        .catch(() => undefined)
        .finally(() => {
          activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
          processUploadQueue();
          flushUploadRefreshIfIdle();
        });
    });
  };

  const handleUploadFiles = (items: UploadCandidate[]) => {
    if (
      !bucketName ||
      !hasS3AccountContext ||
      !accountIdForApi ||
      items.length === 0
    )
      return;
    if (items.length > 1) {
      setShowOperationsModal(true);
    }
    setWarningMessage(null);
    const batchId = makeId();
    const previousQueueCount = uploadQueueRef.current.length;
    const parallelism = uploadParallelismRef.current;
    const availableSlots = Math.max(0, parallelism - activeUploadsRef.current);
    const queuedItems = items.map((item) => {
      const file = item.file;
      const relativePath = normalizeUploadPath(item.relativePath || file.name);
      const key = `${normalizedPrefix}${relativePath}`;
      const grouping = buildUploadGrouping(relativePath, batchId);
      return {
        id: makeId(),
        file,
        relativePath,
        key,
        bucket: bucketName,
        accountId: accountIdForApi,
        groupId: grouping.groupId,
        groupLabel: grouping.groupLabel,
        groupKind: grouping.groupKind,
        itemLabel: grouping.itemLabel,
      };
    });
    const availableForNew = Math.max(0, availableSlots - previousQueueCount);
    const queuedFromBatch = Math.max(0, queuedItems.length - availableForNew);
    uploadQueueRef.current = [...uploadQueueRef.current, ...queuedItems];
    updateUploadQueue(uploadQueueRef.current);
    processUploadQueue();
    if (queuedFromBatch > 0) {
      setStatusMessage(
        queuedFromBatch === 1
          ? "1 upload queued."
          : `${queuedFromBatch} uploads queued.`,
      );
    }
  };

  const uploadSimple = async (
    accountId: string,
    bucket: string,
    file: File,
    key: string,
    onProgress: (event: ProgressEvent) => void,
    controller?: AbortController,
  ) => {
    if (useProxyTransfers) {
      await proxyUpload(
        accountId,
        bucket,
        key,
        file,
        onProgress,
        controller?.signal,
        sseCustomerKeyBase64,
      );
      return;
    }
    const operation = resolveSimpleUploadOperation({ stsAvailable, sseActive });
    const presign = await presignObjectRequest(bucket, {
      key,
      operation,
      content_type: file.type || undefined,
      content_length: file.size,
      expires_in: 1800,
    });
    const method = (presign.method || "").toUpperCase();
    const hasPostFields = Boolean(
      presign.fields && Object.keys(presign.fields).length > 0,
    );
    if (operation === "post_object" || (method === "POST" && hasPostFields)) {
      if (!presign.fields) {
        throw new Error("Missing presigned POST fields.");
      }
      const formData = new FormData();
      Object.entries(presign.fields).forEach(([field, value]) => {
        formData.append(field, value);
      });
      formData.append("file", file);
      await axios.post(presign.url, formData, {
        onUploadProgress: onProgress,
        signal: controller?.signal,
      });
      return;
    }
    await axios.put(presign.url, file, {
      headers: {
        ...(presign.headers || {}),
        "Content-Type": file.type || "application/octet-stream",
      },
      onUploadProgress: onProgress,
      signal: controller?.signal,
    });
  };

  const uploadMultipart = async (
    accountId: string,
    bucket: string,
    file: File,
    key: string,
    operationId: string,
    controller: AbortController,
  ) => {
    let uploadId: string | null = null;
    const totalParts = Math.ceil(file.size / PART_SIZE);
    const partProgress = new Map<number, number>();

    const updateProgress = () => {
      const loaded = Array.from(partProgress.values()).reduce(
        (sum, value) => sum + value,
        0,
      );
      const percent = file.size
        ? Math.min(99, Math.round((loaded / file.size) * 100))
        : 0;
      setOperations((prev) =>
        prev.map((op) =>
          op.id === operationId ? { ...op, progress: percent } : op,
        ),
      );
    };

    const recordProgress = (
      partNumber: number,
      loadedBytes: number,
      partSize: number,
    ) => {
      partProgress.set(partNumber, Math.min(loadedBytes, partSize));
      updateProgress();
    };

    const partsQueue = Array.from({ length: totalParts }, (_, index) => {
      const partNumber = index + 1;
      const start = index * PART_SIZE;
      const end = Math.min(start + PART_SIZE, file.size);
      return { partNumber, start, end, size: end - start };
    });

    const uploadedParts: { part_number: number; etag: string }[] = [];

    const uploadPart = async (part: {
      partNumber: number;
      start: number;
      end: number;
      size: number;
    }) => {
      if (!uploadId) {
        throw new Error("Missing multipart upload ID.");
      }
      const blob = file.slice(part.start, part.end);
      const presignedPart = await presignPartRequest(bucket, uploadId, {
        key,
        part_number: part.partNumber,
        expires_in: 1800,
      });
      const response = await axios.put(presignedPart.url, blob, {
        headers: presignedPart.headers || {},
        signal: controller.signal,
        onUploadProgress: (event) => {
          const loaded = event.loaded ?? 0;
          recordProgress(part.partNumber, loaded, part.size);
        },
      });
      const etag = normalizeEtag(
        response.headers?.etag ||
          response.headers?.ETag ||
          response.headers?.ETAG,
      );
      if (!etag) {
        throw new Error("Missing ETag from multipart upload.");
      }
      uploadedParts.push({ part_number: part.partNumber, etag });
      recordProgress(part.partNumber, part.size, part.size);
    };

    try {
      setOperations((prev) =>
        prev.map((op) =>
          op.id === operationId ? { ...op, label: "Multipart upload" } : op,
        ),
      );
      const init = await initiateMultipartUpload(
        accountId,
        bucket,
        {
          key,
          content_type: file.type || undefined,
        },
        sseCustomerKeyBase64,
      );
      uploadId = init.upload_id;
      let hasError = false;
      const workerCount = Math.min(MULTIPART_CONCURRENCY, partsQueue.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (partsQueue.length > 0 && !hasError) {
          const part = partsQueue.shift();
          if (!part) return;
          try {
            await uploadPart(part);
          } catch (err) {
            hasError = true;
            controller.abort();
            throw err;
          }
        }
      });
      await Promise.all(workers);
      setOperations((prev) =>
        prev.map((op) =>
          op.id === operationId ? { ...op, progress: 95 } : op,
        ),
      );
      uploadedParts.sort((a, b) => a.part_number - b.part_number);
      await completeMultipartUpload(accountId, bucket, uploadId, key, {
        parts: uploadedParts,
      });
      setOperations((prev) =>
        prev.map((op) =>
          op.id === operationId ? { ...op, progress: 100 } : op,
        ),
      );
    } catch (err) {
      if (uploadId) {
        try {
          await abortMultipartUpload(accountId, bucket, uploadId, key);
        } catch {
          // ignore abort failures
        }
      }
      throw err;
    }
  };

  const startQueuedUpload = async (item: UploadQueueItem) => {
    if (!item.bucket || !item.accountId) return;
    const {
      file,
      relativePath,
      key,
      bucket,
      accountId,
      groupId,
      groupLabel,
      groupKind,
      itemLabel,
    } = item;
    const operationId = startOperation(
      "uploading",
      "Uploading",
      `${bucket}/${key}`,
      {
        kind: "upload",
        groupId,
        groupLabel,
        groupKind,
        itemLabel,
        cancelable: true,
        sizeBytes: file.size,
      },
    );
    const controller = createOperationController(operationId);
    try {
      if (!useProxyTransfers && file.size >= MULTIPART_THRESHOLD) {
        await uploadMultipart(
          accountId,
          bucket,
          file,
          key,
          operationId,
          controller,
        );
      } else {
        const onProgress = (event: ProgressEvent) => {
          const total = event.total ?? file.size;
          const progress = total ? Math.round((event.loaded / total) * 100) : 0;
          setOperations((prev) =>
            prev.map((op) =>
              op.id === operationId ? { ...op, progress } : op,
            ),
          );
        };
        await uploadSimple(
          accountId,
          bucket,
          file,
          key,
          onProgress,
          controller,
        );
      }
      completeOperation(operationId, "done");
      setStatusMessage(`Uploaded ${relativePath}`);
      recordUploadedKey(bucket, key);
    } catch (err) {
      if (isAbortError(err)) {
        completeOperation(operationId, "cancelled");
        setStatusMessage(`Upload cancelled for ${relativePath}`);
      } else {
        const completionError = formatOperationError(
          err,
          `Upload failed for ${relativePath}`,
          `Upload failed for ${relativePath}`,
        );
        completeOperation(operationId, "failed", completionError);
        setStatusMessage(completionError);
        if (!useProxyTransfers && isLikelyCorsError(err)) {
          setWarningMessage(
            `Direct transfer failed before S3 returned an HTTP response. Possible causes: network reachability, TLS/certificate issue, CORS policy, or endpoint/proxy configuration.`,
          );
        }
      }
    } finally {
      clearOperationController(operationId);
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    handleUploadFiles(buildUploadCandidates(files));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFolderInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    handleUploadFiles(buildUploadCandidates(files));
    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  };

  const isFileDrag = (event: DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer?.types || []);
    if (types.includes("Files")) return true;
    return Array.from(event.dataTransfer?.items || []).some(
      (item) => item.kind === "file",
    );
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setDragging(false);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const files = await collectDroppedFiles(event.dataTransfer);
    if (files.length === 0) return;
    if (!bucketName || !hasS3AccountContext) {
      setStatusMessage("Select a bucket before uploading.");
      return;
    }
    handleUploadFiles(files);
  };

  async function downloadObjectBlob(key: string, signal?: AbortSignal) {
    if (!bucketName || !hasS3AccountContext) {
      throw new Error("Missing bucket context.");
    }
    if (useProxyTransfers) {
      return proxyDownload(
        accountIdForApi,
        bucketName,
        key,
        signal,
        sseCustomerKeyBase64,
      );
    }
    const presign = await presignObjectRequest(bucketName, {
      key,
      operation: "get_object",
      expires_in: 900,
    });
    const response = await fetch(presign.url, {
      headers: presign.headers || undefined,
      signal,
    });
    if (!response.ok) {
      let detail: string | undefined;
      let code: string | undefined;
      try {
        const text = await response.text();
        const parsed = extractErrorDetails(text);
        code = parsed?.code;
        detail = parsed?.message;
      } catch {
        // ignore body parsing failures
      }
      const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
      const detailLabel =
        code && detail ? `${code}: ${detail}` : detail || code;
      const parts = [statusLabel, detailLabel].filter(Boolean);
      const suffix = parts.length > 0 ? `: ${parts.join(" - ")}` : "";
      throw new Error(`Download failed for ${key}${suffix}`);
    }
    return response.blob();
  }

  const buildAuthHeaders = useCallback((sseKeyBase64?: string | null) => {
    const headers: Record<string, string> = {};
    if (typeof window === "undefined") return headers;
    const token = localStorage.getItem("token");
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const userRaw = localStorage.getItem("user");
    if (userRaw) {
      try {
        const parsed = JSON.parse(userRaw) as { authType?: string };
        if (parsed?.authType === "s3_session") {
          const endpoint = localStorage.getItem("s3SessionEndpoint");
          if (endpoint) {
            headers["X-S3-Endpoint"] = endpoint;
          }
        }
      } catch (err) {
        console.warn("Unable to parse stored user payload", err);
      }
    }
    Object.assign(headers, buildSseCustomerBackendHeaders(sseKeyBase64));
    return headers;
  }, []);

  const buildApiUrl = useCallback(
    (path: string, params?: Record<string, unknown>) => {
      const base = API_BASE_URL.endsWith("/")
        ? API_BASE_URL.slice(0, -1)
        : API_BASE_URL;
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      const url = new URL(`${base}/${normalizedPath}`);
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value === undefined || value === null) return;
          url.searchParams.set(key, String(value));
        });
      }
      return url.toString();
    },
    [],
  );

  const downloadObjectStream = async (
    key: string,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> => {
    if (!bucketName || !hasS3AccountContext) {
      throw new Error("Missing bucket context.");
    }
    if (useProxyTransfers) {
      const params = withS3AccountParam({ key }, accountIdForApi);
      const url = buildApiUrl(
        `/browser/buckets/${encodeURIComponent(bucketName)}/download`,
        params ?? undefined,
      );
      const response = await fetch(url, {
        headers: buildAuthHeaders(sseCustomerKeyBase64),
        credentials: "include",
        signal,
      });
      if (!response.ok) {
        let detail: string | undefined;
        let code: string | undefined;
        try {
          const text = await response.text();
          const parsed = extractErrorDetails(text);
          code = parsed?.code;
          detail = parsed?.message;
        } catch {
          // ignore body parsing failures
        }
        const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
        const detailLabel =
          code && detail ? `${code}: ${detail}` : detail || code;
        const parts = [statusLabel, detailLabel].filter(Boolean);
        const suffix = parts.length > 0 ? `: ${parts.join(" - ")}` : "";
        throw new Error(`Download failed for ${key}${suffix}`);
      }
      if (!response.body) {
        throw new Error("Streaming download is not supported in this browser.");
      }
      return response.body;
    }
    const presign = await presignObjectRequest(bucketName, {
      key,
      operation: "get_object",
      expires_in: 900,
    });
    const response = await fetch(presign.url, {
      headers: presign.headers || undefined,
      signal,
    });
    if (!response.ok) {
      let detail: string | undefined;
      let code: string | undefined;
      try {
        const text = await response.text();
        const parsed = extractErrorDetails(text);
        code = parsed?.code;
        detail = parsed?.message;
      } catch {
        // ignore body parsing failures
      }
      const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
      const detailLabel =
        code && detail ? `${code}: ${detail}` : detail || code;
      const parts = [statusLabel, detailLabel].filter(Boolean);
      const suffix = parts.length > 0 ? `: ${parts.join(" - ")}` : "";
      throw new Error(`Download failed for ${key}${suffix}`);
    }
    if (!response.body) {
      throw new Error("Streaming download is not supported in this browser.");
    }
    return response.body;
  };

  const formatFetchTransferError = useCallback(
    async (response: Response, fallback: string) => {
      let detail: string | undefined;
      let code: string | undefined;
      try {
        const text = await response.text();
        const parsed = extractErrorDetails(text);
        code = parsed?.code;
        detail = parsed?.message;
      } catch {
        // ignore body parsing failures
      }
      const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
      const detailLabel = code && detail ? `${code}: ${detail}` : detail || code;
      const parts = [statusLabel, detailLabel].filter(Boolean);
      const suffix = parts.length > 0 ? `: ${parts.join(" - ")}` : "";
      return `${fallback}${suffix}`;
    },
    [extractErrorDetails],
  );

  const resolveClipboardTransferMode = useCallback(
    async (
      selector: S3AccountSelector,
      targetBucket: string,
    ): Promise<ClipboardTransferMode> => {
      try {
        const status = await getBucketCorsStatus(selector, targetBucket, uiOrigin);
        if (status.enabled) {
          return "direct";
        }
      } catch {
        if (!proxyAllowed) {
          throw new Error(
            `Direct transfer is unavailable for ${targetBucket} and proxy transfers are disabled.`,
          );
        }
        return "proxy";
      }
      if (proxyAllowed) {
        return "proxy";
      }
      throw new Error(
        `Direct transfer is unavailable for ${targetBucket} and proxy transfers are disabled.`,
      );
    },
    [proxyAllowed, uiOrigin],
  );

  const downloadObjectBlobForTransfer = useCallback(
    async ({
      selector,
      bucket,
      key,
      mode,
      sseCustomerKeyBase64: sseKeyBase64,
      signal,
    }: {
      selector: S3AccountSelector;
      bucket: string;
      key: string;
      mode: ClipboardTransferMode;
      sseCustomerKeyBase64?: string | null;
      signal?: AbortSignal;
    }) => {
      if (mode === "proxy") {
        return proxyDownload(selector, bucket, key, signal, sseKeyBase64);
      }
      const presign = await presignObject(
        selector,
        bucket,
        {
          key,
          operation: "get_object",
          expires_in: 900,
        },
        sseKeyBase64,
      );
      const response = await fetch(presign.url, {
        headers: presign.headers || undefined,
        signal,
      });
      if (!response.ok) {
        throw new Error(
          await formatFetchTransferError(response, `Download failed for ${key}`),
        );
      }
      return response.blob();
    },
    [formatFetchTransferError],
  );

  const downloadObjectStreamForTransfer = useCallback(
    async ({
      selector,
      bucket,
      key,
      mode,
      sseCustomerKeyBase64: sseKeyBase64,
      signal,
    }: {
      selector: S3AccountSelector;
      bucket: string;
      key: string;
      mode: ClipboardTransferMode;
      sseCustomerKeyBase64?: string | null;
      signal?: AbortSignal;
    }): Promise<ReadableStream<Uint8Array>> => {
      if (mode === "proxy") {
        const params = withS3AccountParam({ key }, selector);
        const url = buildApiUrl(
          `/browser/buckets/${encodeURIComponent(bucket)}/download`,
          params ?? undefined,
        );
        const response = await fetch(url, {
          headers: buildAuthHeaders(sseKeyBase64),
          credentials: "include",
          signal,
        });
        if (!response.ok) {
          throw new Error(
            await formatFetchTransferError(
              response,
              `Download failed for ${key}`,
            ),
          );
        }
        if (!response.body) {
          throw new Error(
            "Streaming download is not supported in this browser.",
          );
        }
        return response.body;
      }
      const presign = await presignObject(
        selector,
        bucket,
        {
          key,
          operation: "get_object",
          expires_in: 900,
        },
        sseKeyBase64,
      );
      const response = await fetch(presign.url, {
        headers: presign.headers || undefined,
        signal,
      });
      if (!response.ok) {
        throw new Error(
          await formatFetchTransferError(response, `Download failed for ${key}`),
        );
      }
      if (!response.body) {
        throw new Error("Streaming download is not supported in this browser.");
      }
      return response.body;
    },
    [buildApiUrl, buildAuthHeaders, formatFetchTransferError],
  );

  const uploadBlobForTransfer = useCallback(
    async ({
      selector,
      bucket,
      key,
      mode,
      blob,
      contentType,
      sseCustomerKeyBase64: sseKeyBase64,
      signal,
    }: {
      selector: S3AccountSelector;
      bucket: string;
      key: string;
      mode: ClipboardTransferMode;
      blob: Blob;
      contentType?: string | null;
      sseCustomerKeyBase64?: string | null;
      signal?: AbortSignal;
    }) => {
      if (mode === "proxy") {
        await proxyUpload(
          selector,
          bucket,
          key,
          blob,
          undefined,
          signal,
          sseKeyBase64,
          key.split("/").pop() || "upload.bin",
        );
        return;
      }
      const presign = await presignObject(
        selector,
        bucket,
        {
          key,
          operation: "put_object",
          content_type: contentType ?? undefined,
          content_length: blob.size,
          expires_in: 1800,
        },
        sseKeyBase64,
      );
      const response = await fetch(presign.url, {
        method: (presign.method || "PUT").toUpperCase(),
        headers: {
          ...(presign.headers || {}),
          ...(contentType ? { "Content-Type": contentType } : {}),
        },
        body: blob,
        signal,
      });
      if (!response.ok) {
        throw new Error(
          await formatFetchTransferError(response, `Upload failed for ${key}`),
        );
      }
    },
    [formatFetchTransferError],
  );

  const uploadMultipartStreamForTransfer = useCallback(
    async ({
      selector,
      bucket,
      key,
      stream,
      sizeBytes,
      contentType,
      sseCustomerKeyBase64: sseKeyBase64,
      signal,
    }: {
      selector: S3AccountSelector;
      bucket: string;
      key: string;
      stream: ReadableStream<Uint8Array>;
      sizeBytes: number;
      contentType?: string | null;
      sseCustomerKeyBase64?: string | null;
      signal?: AbortSignal;
    }) => {
      let uploadId: string | null = null;
      const completedParts: { part_number: number; etag: string }[] = [];
      const reader = stream.getReader();
      let pending = new Uint8Array(0);
      let partNumber = 1;

      const uploadPartBlob = async (blob: Blob, currentPartNumber: number) => {
        if (!uploadId) {
          throw new Error("Missing multipart upload ID.");
        }
        const presignedPart = await presignPart(
          selector,
          bucket,
          uploadId,
          {
            key,
            part_number: currentPartNumber,
            expires_in: 1800,
          },
          sseKeyBase64,
        );
        const response = await axios.put(presignedPart.url, blob, {
          headers: presignedPart.headers || {},
          signal,
        });
        const etag = normalizeEtag(
          response.headers?.etag ||
            response.headers?.ETag ||
            response.headers?.ETAG,
        );
        if (!etag) {
          throw new Error("Missing ETag from multipart upload.");
        }
        completedParts.push({ part_number: currentPartNumber, etag });
      };

      const flushPart = async (partBytes: Uint8Array) => {
        await uploadPartBlob(
          new Blob([partBytes], {
            type: contentType || "application/octet-stream",
          }),
          partNumber,
        );
        partNumber += 1;
      };

      try {
        const init = await initiateMultipartUpload(
          selector,
          bucket,
          {
            key,
            content_type: contentType ?? undefined,
          },
          sseKeyBase64,
        );
        uploadId = init.upload_id;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) {
            continue;
          }
          const combined = new Uint8Array(pending.byteLength + value.byteLength);
          combined.set(pending, 0);
          combined.set(value, pending.byteLength);
          pending = combined;

          while (pending.byteLength >= PART_SIZE) {
            await flushPart(pending.slice(0, PART_SIZE));
            pending = pending.slice(PART_SIZE);
          }
        }

        if (pending.byteLength > 0 || sizeBytes === 0) {
          await flushPart(pending);
        }

        completedParts.sort((a, b) => a.part_number - b.part_number);
        await completeMultipartUpload(selector, bucket, uploadId, key, {
          parts: completedParts,
        });
      } catch (err) {
        if (uploadId) {
          try {
            await abortMultipartUpload(selector, bucket, uploadId, key);
          } catch {
            // ignore cleanup failures
          }
        }
        throw err;
      } finally {
        reader.releaseLock();
      }
    },
    [],
  );

  const deleteObjectForTransfer = useCallback(
    async ({
      selector,
      bucket,
      key,
    }: {
      selector: S3AccountSelector;
      bucket: string;
      key: string;
    }) => {
      await deleteObjects(selector, bucket, [{ key }]);
    },
    [],
  );

  const listAllObjectsForPrefix = useCallback(
    async (
      targetPrefix: string,
      targetBucket?: string,
      targetSelector?: S3AccountSelector,
      signal?: AbortSignal,
    ) => {
      const bucket = targetBucket ?? bucketName;
      if (!bucket || !hasS3AccountContext) return [];
      const collected: BrowserObject[] = [];
      let continuation: string | null = null;
      let hasMore = true;
      while (hasMore) {
        const data = await listBrowserObjects(
          targetSelector ?? accountIdForApi,
          bucket,
          {
            prefix: targetPrefix,
            continuationToken: continuation,
            maxKeys: 1000,
            type: "file",
            recursive: true,
            signal,
          },
        );
        collected.push(...data.objects);
        continuation = data.next_continuation_token ?? null;
        hasMore = Boolean(data.is_truncated && continuation);
      }
      return collected;
    },
    [accountIdForApi, bucketName, hasS3AccountContext],
  );

  const listAllVersionsForPrefix = async (targetPrefix: string) => {
    if (!bucketName || !hasS3AccountContext || !isVersioningEnabled)
      return { versions: [], deleteMarkers: [] };
    const versions: BrowserObjectVersion[] = [];
    const deleteMarkers: BrowserObjectVersion[] = [];
    let keyMarker: string | null = null;
    let versionIdMarker: string | null = null;
    let hasMore = true;
    while (hasMore) {
      const data = await listObjectVersions(accountIdForApi, bucketName, {
        prefix: targetPrefix,
        keyMarker,
        versionIdMarker,
        maxKeys: 1000,
      });
      versions.push(...data.versions);
      deleteMarkers.push(...data.delete_markers);
      keyMarker = data.next_key_marker ?? null;
      versionIdMarker = data.next_version_id_marker ?? null;
      hasMore = Boolean(data.is_truncated && keyMarker);
    }
    return { versions, deleteMarkers };
  };

  const listAllVersionsForKey = async (key: string) => {
    if (!bucketName || !hasS3AccountContext || !isVersioningEnabled)
      return { versions: [], deleteMarkers: [] };
    const versions: BrowserObjectVersion[] = [];
    const deleteMarkers: BrowserObjectVersion[] = [];
    let keyMarker: string | null = null;
    let versionIdMarker: string | null = null;
    let hasMore = true;
    while (hasMore) {
      const data = await listObjectVersions(accountIdForApi, bucketName, {
        key,
        keyMarker,
        versionIdMarker,
        maxKeys: 1000,
      });
      versions.push(...data.versions);
      deleteMarkers.push(...data.delete_markers);
      keyMarker = data.next_key_marker ?? null;
      versionIdMarker = data.next_version_id_marker ?? null;
      hasMore = Boolean(data.is_truncated && keyMarker);
    }
    return { versions, deleteMarkers };
  };

  const resolveBulkAttributeKeys = async (items: BrowserItem[]) => {
    const keys = new Set<string>();
    items
      .filter((item) => item.type === "file")
      .forEach((item) => keys.add(item.key));
    const folders = items.filter((item) => item.type === "folder");
    for (const folder of folders) {
      const folderPrefix = normalizePrefix(folder.key);
      const objects = await listAllObjectsForPrefix(folderPrefix);
      objects.forEach((obj) => keys.add(obj.key));
    }
    return Array.from(keys);
  };

  const getVersionEntryTime = (entry: BrowserObjectVersion) => {
    if (!entry.last_modified) return 0;
    const parsed = new Date(entry.last_modified).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const sortVersionEntriesByDateDesc = (entries: BrowserObjectVersion[]) =>
    entries
      .slice()
      .sort((a, b) => getVersionEntryTime(b) - getVersionEntryTime(a));

  const findVersionForDate = (
    entries: BrowserObjectVersion[],
    targetTime: number,
  ) => {
    const sorted = sortVersionEntriesByDateDesc(entries);
    return sorted.find((entry) => {
      if (!entry.last_modified) return false;
      return new Date(entry.last_modified).getTime() <= targetTime;
    });
  };

  const findLatestRestorableVersion = (entries: BrowserObjectVersion[]) => {
    const sorted = sortVersionEntriesByDateDesc(entries);
    return (
      sorted.find(
        (entry) =>
          !entry.is_delete_marker &&
          typeof entry.version_id === "string" &&
          entry.version_id.length > 0,
      ) ?? null
    );
  };

  const updateDeleteDetailsStatus = (
    operationId: string,
    keys: string[],
    status: DeleteDetailStatus,
    errorMessage?: string,
  ) => {
    setDeleteDetails((prev) => {
      const items = prev[operationId];
      if (!items) return prev;
      const keySet = new Set(keys);
      const nextItems = items.map((item) => {
        if (!keySet.has(item.key)) return item;
        return {
          ...item,
          status,
          errorMessage:
            status === "failed"
              ? (errorMessage ?? item.errorMessage)
              : undefined,
        };
      });
      return { ...prev, [operationId]: nextItems };
    });
  };

  const deleteObjectsInBatches = async (
    keys: string[],
    onProgress?: (deleted: number, total: number) => void,
    detailOperationId?: string,
    signal?: AbortSignal,
  ) => {
    if (!bucketName || !hasS3AccountContext || keys.length === 0) return 0;
    const uniqueKeys = Array.from(new Set(keys));
    const total = uniqueKeys.length;
    const chunks = chunkItems(uniqueKeys, 1000);
    let deletedCount = 0;
    let hasError: unknown = null;
    const queue = [...chunks];
    const workerCount = Math.max(
      1,
      Math.min(otherOperationsParallelismRef.current, queue.length),
    );
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0 && !hasError) {
        if (signal?.aborted) {
          hasError = new DOMException("Aborted", "AbortError");
          return;
        }
        const chunk = queue.shift();
        if (!chunk) return;
        try {
          if (detailOperationId) {
            updateDeleteDetailsStatus(detailOperationId, chunk, "deleting");
          }
          await deleteObjects(
            accountIdForApi,
            bucketName,
            chunk.map((key) => ({ key })),
            signal,
          );
          if (signal?.aborted) {
            if (detailOperationId) {
              updateDeleteDetailsStatus(detailOperationId, chunk, "cancelled");
            }
            hasError = new DOMException("Aborted", "AbortError");
            return;
          }
          if (detailOperationId) {
            updateDeleteDetailsStatus(detailOperationId, chunk, "done");
          }
          deletedCount += chunk.length;
          onProgress?.(deletedCount, total);
        } catch (err) {
          if (isAbortError(err) || signal?.aborted) {
            if (detailOperationId) {
              updateDeleteDetailsStatus(detailOperationId, chunk, "cancelled");
            }
            hasError = err;
            return;
          }
          if (detailOperationId) {
            updateDeleteDetailsStatus(
              detailOperationId,
              chunk,
              "failed",
              formatOperationError(err, "Delete failed."),
            );
          }
          hasError = err;
        }
      }
    });
    await Promise.all(workers);
    if (hasError) {
      throw hasError;
    }
    return deletedCount;
  };

  const deleteFolderRecursive = async (
    folderItem: BrowserItem,
  ): Promise<OperationCompletionStatus | undefined> => {
    if (!bucketName || !hasS3AccountContext || folderItem.type !== "folder")
      return;
    setShowOperationsModal(true);
    const folderPrefix = normalizePrefix(folderItem.key);
    const operationId = startOperation(
      "deleting",
      "Deleting folder",
      `${bucketName}/${folderPrefix}`,
      { kind: "delete", cancelable: true },
      0,
    );
    const controller = createOperationController(operationId);
    let completionStatus: OperationCompletionStatus = "done";
    let completionError: string | undefined;
    let deletedCount = 0;
    let total = 0;
    try {
      const objects = await listAllObjectsForPrefix(
        folderPrefix,
        undefined,
        undefined,
        controller.signal,
      );
      const keys = Array.from(
        new Set([...objects.map((obj) => obj.key), folderPrefix]),
      );
      total = keys.length;
      if (keys.length === 0) {
        setStatusMessage("Folder is empty.");
        return completionStatus;
      }
      const detailItems = objects.map((obj) => {
        const relativeKey = obj.key.startsWith(folderPrefix)
          ? obj.key.slice(folderPrefix.length)
          : obj.key;
        return {
          id: makeId(),
          key: obj.key,
          label: relativeKey || obj.key,
          status: "queued" as DeleteDetailStatus,
        };
      });
      if (detailItems.length === 0) {
        detailItems.push({
          id: makeId(),
          key: folderPrefix,
          label: folderItem.name || folderPrefix,
          status: "queued",
        });
      }
      if (detailItems.length > 0) {
        setDeleteDetails((prev) => ({ ...prev, [operationId]: detailItems }));
      }
      deletedCount = await deleteObjectsInBatches(
        keys,
        (deleted, total) => {
          const progress =
            total > 0 ? Math.min(100, Math.round((deleted / total) * 100)) : 0;
          setOperations((prev) =>
            prev.map((op) =>
              op.id === operationId ? { ...op, progress } : op,
            ),
          );
        },
        detailItems.length > 0 ? operationId : undefined,
        controller.signal,
      );
      setStatusMessage(`Deleted folder ${folderItem.name}`);
    } catch (err) {
      if (isOperationAborted(err, controller)) {
        completionStatus = "cancelled";
        cancelDeleteDetails(operationId);
        setStatusMessage(
          `Delete cancelled after ${deletedCount} of ${total} item(s).`,
        );
        await refreshObjectsNow(prefix);
      } else {
        completionStatus = "failed";
        completionError = formatOperationError(
          err,
          "Unable to delete folder.",
          "Unable to delete folder.",
        );
        setStatusMessage(completionError);
      }
    } finally {
      clearOperationController(operationId);
      completeOperation(operationId, completionStatus, completionError);
    }
    return completionStatus;
  };

  const updateDownloadDetail = (
    operationId: string,
    detailId: string,
    status: DownloadDetailStatus,
    errorMessage?: string,
  ) => {
    setDownloadDetails((prev) => {
      const items = prev[operationId];
      if (!items) return prev;
      const nextItems = items.map((item) =>
        item.id === detailId
          ? {
              ...item,
              status,
              errorMessage:
                status === "failed"
                  ? (errorMessage ?? item.errorMessage)
                  : undefined,
            }
          : item,
      );
      return { ...prev, [operationId]: nextItems };
    });
  };

  const updateCopyDetailStatus = useCallback(
    (
      operationId: string,
      detailId: string,
      status: CopyDetailStatus,
      errorMessage?: string,
    ) => {
      setCopyDetails((prev) => {
        const items = prev[operationId];
        if (!items) return prev;
        const nextItems = items.map((item) =>
          item.id === detailId
            ? {
                ...item,
                status,
                errorMessage:
                  status === "failed"
                    ? (errorMessage ?? item.errorMessage)
                    : undefined,
              }
            : item,
        );
        return { ...prev, [operationId]: nextItems };
      });
    },
    [],
  );

  const handleDownloadFolder = async (folderItem: BrowserItem) => {
    if (!bucketName || !hasS3AccountContext || folderItem.type !== "folder")
      return;
    setShowOperationsModal(true);
    setWarningMessage(null);
    const folderPrefix = normalizePrefix(folderItem.key);
    const rawLabel =
      folderItem.name || folderPrefix.replace(/\/$/, "") || "folder";
    const folderLabel = rawLabel.replace(/[\\/]/g, "-") || "folder";
    const operationId = startOperation(
      "downloading",
      "Preparing download",
      `${bucketName}/${folderPrefix}`,
      { kind: "download", cancelable: true },
    );
    const controller = createOperationController(operationId);
    let completionStatus: OperationCompletionStatus = "done";
    let completionError: string | undefined;
    try {
      const objects = await listAllObjectsForPrefix(folderPrefix);
      if (controller.signal.aborted) {
        completionStatus = "cancelled";
        setStatusMessage(`Download cancelled for ${folderLabel}`);
        return;
      }
      const downloadTargets = objects
        .map((obj) => {
          const relativeKey = obj.key.startsWith(folderPrefix)
            ? obj.key.slice(folderPrefix.length)
            : obj.key;
          if (!relativeKey) return null;
          if (relativeKey.endsWith("/") && (obj.size ?? 0) === 0) return null;
          return {
            obj,
            relativeKey,
            detailId: makeId(),
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            obj: BrowserObject;
            relativeKey: string;
            detailId: string;
          } => Boolean(entry),
        );
      if (downloadTargets.length === 0) {
        setStatusMessage("Folder is empty.");
        return;
      }
      setDownloadDetails((prev) => ({
        ...prev,
        [operationId]: downloadTargets.map((target) => ({
          id: target.detailId,
          key: target.obj.key,
          label: target.relativeKey,
          status: "queued",
          sizeBytes: target.obj.size,
        })),
      }));
      const totalBytes = downloadTargets.reduce(
        (sum, target) => sum + (target.obj.size ?? 0),
        0,
      );
      const streamingZipThresholdBytes =
        Math.max(
          0,
          browserSettings?.streaming_zip_threshold_mb ??
            DEFAULT_STREAMING_ZIP_THRESHOLD_MB,
        ) *
        1024 *
        1024;
      const totalCount = downloadTargets.length;
      let downloadedBytes = 0;
      let completed = 0;
      let aborted = false;
      const errors: string[] = [];

      const updateProgress = () => {
        const base =
          totalBytes > 0
            ? downloadedBytes / totalBytes
            : completed / totalCount;
        const percent = Math.min(80, Math.round(base * 80));
        setOperations((prev) =>
          prev.map((op) =>
            op.id === operationId ? { ...op, progress: percent } : op,
          ),
        );
      };

      const saveFilePicker =
        typeof window !== "undefined"
          ? (
              window as Window & {
                showSaveFilePicker?: (options?: unknown) => Promise<unknown>;
              }
            ).showSaveFilePicker
          : undefined;
      const supportsStreamingZip = Boolean(
        saveFilePicker &&
        typeof ReadableStream !== "undefined" &&
        typeof WritableStream !== "undefined" &&
        typeof TransformStream !== "undefined",
      );
      const shouldStreamZip =
        supportsStreamingZip && totalBytes >= streamingZipThresholdBytes;

      if (shouldStreamZip && saveFilePicker) {
        let fileStream:
          | (WritableStream<Uint8Array> & { abort?: () => Promise<void> })
          | null = null;
        let zipWriter: ZipWriter | null = null;
        try {
          const handle = (await saveFilePicker({
            suggestedName: `${folderLabel}.zip`,
            types: [
              {
                description: "ZIP archive",
                accept: { "application/zip": [".zip"] },
              },
            ],
          })) as { createWritable: () => Promise<WritableStream<Uint8Array>> };
          fileStream =
            (await handle.createWritable()) as WritableStream<Uint8Array> & {
              abort?: () => Promise<void>;
            };
          zipWriter = new ZipWriter(fileStream);
        } catch (err) {
          if (isAbortError(err)) {
            completionStatus = "cancelled";
            setStatusMessage(`Download cancelled for ${folderLabel}`);
            cancelDownloadDetails(operationId);
            return;
          }
          throw err;
        }

        setOperations((prev) =>
          prev.map((op) =>
            op.id === operationId ? { ...op, label: "Streaming zip" } : op,
          ),
        );

        for (const target of downloadTargets) {
          if (controller.signal.aborted) {
            aborted = true;
            break;
          }
          updateDownloadDetail(operationId, target.detailId, "downloading");
          try {
            const stream = await downloadObjectStream(
              target.obj.key,
              controller.signal,
            );
            const counter = new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, streamController) {
                downloadedBytes += chunk.byteLength;
                updateProgress();
                streamController.enqueue(chunk);
              },
            });
            await zipWriter.add(
              `${folderLabel}/${target.relativeKey}`,
              stream.pipeThrough(counter),
            );
            updateDownloadDetail(operationId, target.detailId, "done");
          } catch (err) {
            if (isAbortError(err) || controller.signal.aborted) {
              updateDownloadDetail(operationId, target.detailId, "cancelled");
              aborted = true;
              controller.abort();
              break;
            }
            console.error(err);
            updateDownloadDetail(
              operationId,
              target.detailId,
              "failed",
              formatOperationError(err, "Download failed."),
            );
            errors.push(target.obj.key);
          } finally {
            completed += 1;
            if (totalBytes <= 0) {
              updateProgress();
            }
          }
        }

        if (aborted || controller.signal.aborted) {
          completionStatus = "cancelled";
          setStatusMessage(`Download cancelled for ${folderLabel}`);
          cancelDownloadDetails(operationId);
          if (fileStream?.abort) {
            await fileStream.abort();
          }
          return;
        }

        if (zipWriter) {
          await zipWriter.close();
        }
        setOperations((prev) =>
          prev.map((op) =>
            op.id === operationId ? { ...op, progress: 100 } : op,
          ),
        );
      } else {
        const zip = new JSZip();
        const queue = [...downloadTargets];
        const workerCount = Math.max(
          1,
          Math.min(downloadParallelismRef.current, queue.length),
        );
        const workers = Array.from({ length: workerCount }, async () => {
          while (queue.length > 0 && !aborted) {
            if (controller.signal.aborted) {
              aborted = true;
              return;
            }
            const obj = queue.shift();
            if (!obj) return;
            updateDownloadDetail(operationId, obj.detailId, "downloading");
            try {
              const blob = await downloadObjectBlob(
                obj.obj.key,
                controller.signal,
              );
              zip.file(`${folderLabel}/${obj.relativeKey}`, blob);
              updateDownloadDetail(operationId, obj.detailId, "done");
            } catch (err) {
              if (isAbortError(err) || controller.signal.aborted) {
                updateDownloadDetail(operationId, obj.detailId, "cancelled");
                aborted = true;
                controller.abort();
                return;
              }
              console.error(err);
              updateDownloadDetail(
                operationId,
                obj.detailId,
                "failed",
                formatOperationError(err, "Download failed."),
              );
              errors.push(obj.obj.key);
            } finally {
              completed += 1;
              downloadedBytes += obj.obj.size ?? 0;
              updateProgress();
            }
          }
        });
        await Promise.all(workers);

        if (aborted || controller.signal.aborted) {
          completionStatus = "cancelled";
          setStatusMessage(`Download cancelled for ${folderLabel}`);
          cancelDownloadDetails(operationId);
          return;
        }

        setOperations((prev) =>
          prev.map((op) =>
            op.id === operationId ? { ...op, label: "Packaging zip" } : op,
          ),
        );
        const zipBlob = await zip.generateAsync(
          { type: "blob" },
          (metadata) => {
            const percent = Math.min(
              99,
              80 + Math.round(metadata.percent * 0.2),
            );
            setOperations((prev) =>
              prev.map((op) =>
                op.id === operationId ? { ...op, progress: percent } : op,
              ),
            );
          },
        );
        if (controller.signal.aborted) {
          setStatusMessage(`Download cancelled for ${folderLabel}`);
          cancelDownloadDetails(operationId);
          return;
        }
        setOperations((prev) =>
          prev.map((op) =>
            op.id === operationId ? { ...op, progress: 100 } : op,
          ),
        );

        const downloadName = `${folderLabel}.zip`;
        const url = window.URL.createObjectURL(zipBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = downloadName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      }

      if (errors.length > 0) {
        completionStatus = "failed";
        completionError = `Downloaded ${folderLabel} with ${errors.length} failed file(s).`;
        setStatusMessage(completionError);
      } else {
        setStatusMessage(`Downloaded ${folderLabel}`);
      }
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        completionStatus = "cancelled";
        setStatusMessage(`Download cancelled for ${folderLabel}`);
      } else {
        completionStatus = "failed";
        console.error(err);
        completionError = formatOperationError(
          err,
          "Unable to download folder.",
          "Unable to download folder.",
        );
        setStatusMessage(completionError);
      }
    } finally {
      clearOperationController(operationId);
      completeOperation(operationId, completionStatus, completionError);
    }
  };

  const handleDownloadMultipleFiles = async (targets: BrowserItem[]) => {
    if (!bucketName || !hasS3AccountContext) return;
    const files = targets.filter(
      (item) => item.type === "file" && !item.isDeleted,
    );
    if (files.length <= 1) {
      await handleDownloadItems(files);
      return;
    }
    setShowOperationsModal(true);
    const operationId = startOperation(
      "downloading",
      `Downloading ${files.length} files`,
      currentPath || bucketName,
      { kind: "download", cancelable: true },
    );
    const controller = createOperationController(operationId);
    let completionStatus: OperationCompletionStatus = "done";
    const downloadTargets = files.map((item) => ({
      item,
      detailId: makeId(),
    }));
    setDownloadDetails((prev) => ({
      ...prev,
      [operationId]: downloadTargets.map((target) => ({
        id: target.detailId,
        key: target.item.key,
        label: target.item.name,
        status: "queued",
        sizeBytes: target.item.sizeBytes ?? undefined,
      })),
    }));
    const totalBytes = downloadTargets.reduce(
      (sum, target) => sum + (target.item.sizeBytes ?? 0),
      0,
    );
    const totalCount = downloadTargets.length;
    let downloadedBytes = 0;
    let completed = 0;
    let aborted = false;
    let failedCount = 0;

    const updateProgress = () => {
      const base =
        totalBytes > 0 ? downloadedBytes / totalBytes : completed / totalCount;
      const percent = Math.min(100, Math.round(base * 100));
      setOperations((prev) =>
        prev.map((op) =>
          op.id === operationId ? { ...op, progress: percent } : op,
        ),
      );
    };

    try {
      const queue = [...downloadTargets];
      const workerCount = Math.max(
        1,
        Math.min(downloadParallelismRef.current, queue.length),
      );
      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0 && !aborted) {
          if (controller.signal.aborted) {
            aborted = true;
            return;
          }
          const target = queue.shift();
          if (!target) return;
          updateDownloadDetail(operationId, target.detailId, "downloading");
          try {
            const blob = await downloadObjectBlob(
              target.item.key,
              controller.signal,
            );
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = target.item.name || "download";
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            updateDownloadDetail(operationId, target.detailId, "done");
          } catch (err) {
            if (isAbortError(err) || controller.signal.aborted) {
              updateDownloadDetail(operationId, target.detailId, "cancelled");
              aborted = true;
              controller.abort();
              return;
            }
            console.error(err);
            updateDownloadDetail(
              operationId,
              target.detailId,
              "failed",
              formatOperationError(err, "Download failed."),
            );
            failedCount += 1;
          } finally {
            completed += 1;
            downloadedBytes += target.item.sizeBytes ?? 0;
            updateProgress();
          }
        }
      });
      await Promise.all(workers);
      if (aborted || controller.signal.aborted) {
        completionStatus = "cancelled";
        setStatusMessage("Download cancelled.");
        cancelDownloadDetails(operationId);
        return;
      }
      setOperations((prev) =>
        prev.map((op) =>
          op.id === operationId ? { ...op, progress: 100 } : op,
        ),
      );
      setStatusMessage(`Downloaded ${files.length} files`);
      if (failedCount > 0) {
        completionStatus = "failed";
        completionError = `Downloaded ${files.length - failedCount} of ${files.length} files.`;
        setStatusMessage(completionError);
      }
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        completionStatus = "cancelled";
        setStatusMessage("Download cancelled.");
      } else {
        completionStatus = "failed";
        completionError = formatOperationError(
          err,
          "Unable to download files.",
          "Unable to download files.",
        );
        setStatusMessage(completionError);
      }
    } finally {
      clearOperationController(operationId);
      completeOperation(operationId, completionStatus, completionError);
    }
  };

  const handleDownloadItems = async (targets: BrowserItem[]) => {
    if (!bucketName || !hasS3AccountContext || targets.length === 0) return;
    const files = targets.filter(
      (item) => item.type === "file" && !item.isDeleted,
    );
    const deletedCount = targets.filter(
      (item) => item.type === "file" && item.isDeleted,
    ).length;
    if (files.length === 0) {
      if (deletedCount > 0) {
        setWarningMessage("Deleted objects cannot be downloaded directly.");
      }
      return;
    }
    if (deletedCount > 0) {
      setWarningMessage(
        "Deleted objects were skipped. Open versions to restore before download.",
      );
    } else {
      setWarningMessage(null);
    }
    if (files.length > 1) {
      await handleDownloadMultipleFiles(files);
      return;
    }
    try {
      for (const item of files) {
        if (useProxyTransfers) {
          const blob = await proxyDownload(
            accountIdForApi,
            bucketName,
            item.key,
            undefined,
            sseCustomerKeyBase64,
          );
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = item.name || "download";
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.URL.revokeObjectURL(url);
        } else {
          if (sseActive) {
            const blob = await downloadObjectBlob(item.key);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = item.name || "download";
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
          } else {
            const presign = await presignObjectRequest(bucketName, {
              key: item.key,
              operation: "get_object",
              expires_in: 900,
            });
            window.open(presign.url, "_blank");
          }
        }
      }
    } catch {
      setStatusMessage(
        useProxyTransfers || sseActive
          ? "Unable to download object."
          : "Unable to generate download URL.",
      );
    }
  };

  const handleDownloadTarget = (item: BrowserItem) => {
    if (item.isDeleted) {
      setWarningMessage(
        "This item is deleted. Open it or use versions to restore content before downloading.",
      );
      if (item.type === "file" && isVersioningEnabled) {
        openObjectDetails(item, "versions");
      }
      return;
    }
    if (item.type === "folder") {
      void handleDownloadFolder(item);
      return;
    }
    void handleDownloadItems([item]);
  };

  const handleDeleteItems = async (
    targets: BrowserItem[],
    options?: { skipConfirm?: boolean },
  ) => {
    if (!bucketName || !hasS3AccountContext || targets.length === 0) return;
    const fileTargets = targets.filter(
      (item) => item.type === "file" && !item.isDeleted,
    );
    const folderTargets = targets.filter(
      (item) => item.type === "folder" && !item.isDeleted,
    );
    const hasDeletedTargets = targets.some((item) => item.isDeleted);
    if (hasDeletedTargets) {
      setWarningMessage(
        "Deleted items are shown from delete markers. Use versions to restore or remove markers.",
      );
    } else {
      setWarningMessage(null);
    }
    if (fileTargets.length === 0 && folderTargets.length === 0) return;
    if (!options?.skipConfirm) {
      const message =
        folderTargets.length > 0
          ? `Delete ${fileTargets.length} object(s) and ${folderTargets.length} folder(s)? This removes all objects within the selected folders.`
          : `Delete ${fileTargets.length} object(s)?`;
      openConfirmDialog({
        title: "Delete objects",
        message,
        confirmLabel: "Delete",
        tone: "danger",
        onConfirm: () => handleDeleteItems(targets, { skipConfirm: true }),
      });
      return;
    }
    if (fileTargets.length > 1 || folderTargets.length > 0) {
      setShowOperationsModal(true);
    }
    try {
      let deleteCancelled = false;
      if (fileTargets.length > 0) {
        const targetPath =
          fileTargets.length === 1
            ? `${bucketName}/${fileTargets[0].key}`
            : currentPath || bucketName;
        const operationLabel =
          fileTargets.length === 1
            ? "Deleting object"
            : `Deleting ${fileTargets.length} objects`;
        const operationKind = fileTargets.length > 1 ? "delete" : "other";
        const operationId = startOperation(
          "deleting",
          operationLabel,
          targetPath,
          {
            kind: operationKind,
            cancelable: fileTargets.length > 1,
          },
          0,
        );
        const controller =
          fileTargets.length > 1
            ? createOperationController(operationId)
            : null;
        let completionStatus: OperationCompletionStatus = "done";
        let completionError: string | undefined;
        let deletedCount = 0;
        try {
          if (fileTargets.length > 1) {
            setDeleteDetails((prev) => ({
              ...prev,
              [operationId]: fileTargets.map((item) => ({
                id: makeId(),
                key: item.key,
                label: item.name,
                status: "queued",
              })),
            }));
          }
          deletedCount = await deleteObjectsInBatches(
            fileTargets.map((item) => item.key),
            (deleted, total) => {
              const progress =
                total > 0
                  ? Math.min(100, Math.round((deleted / total) * 100))
                  : 0;
              setOperations((prev) =>
                prev.map((op) =>
                  op.id === operationId ? { ...op, progress } : op,
                ),
              );
            },
            fileTargets.length > 1 ? operationId : undefined,
            controller?.signal,
          );
          setStatusMessage(`Deleted ${fileTargets.length} object(s)`);
        } catch (err) {
          if (isOperationAborted(err, controller)) {
            completionStatus = "cancelled";
            cancelDeleteDetails(operationId);
            setStatusMessage(
              `Delete cancelled after ${deletedCount} of ${fileTargets.length} item(s).`,
            );
            await refreshObjectsNow(prefix);
            deleteCancelled = true;
          } else {
            completionStatus = "failed";
            completionError = formatOperationError(
              err,
              "Unable to delete selected objects.",
              "Unable to delete selected objects.",
            );
            setStatusMessage(completionError);
          }
        } finally {
          if (controller) {
            clearOperationController(operationId);
          }
          completeOperation(operationId, completionStatus, completionError);
        }
      }
      if (deleteCancelled) {
        return;
      }
      for (const folder of folderTargets) {
        const folderStatus = await deleteFolderRecursive(folder);
        if (folderStatus === "cancelled") {
          return;
        }
      }
      const processedTargets = [...fileTargets, ...folderTargets];
      setSelectedIds((prev) =>
        prev.filter((id) => !processedTargets.some((item) => item.id === id)),
      );
      await loadObjects({ prefixOverride: prefix });
      loadTreeChildren(prefix);
    } catch {
      setStatusMessage("Unable to delete objects.");
    }
  };

  const handleBulkAttributesApply = async () => {
    if (!bucketName || !hasS3AccountContext) return;
    const shouldApplyMetadata = bulkApplyMetadata;
    const shouldApplyTags = bulkApplyTags;
    const shouldApplyStorage = bulkApplyStorageClass;
    const shouldApplyAcl = bulkApplyAcl;
    const shouldApplyLegalHold = bulkApplyLegalHold;
    const shouldApplyRetention = bulkApplyRetention;
    if (
      !shouldApplyMetadata &&
      !shouldApplyTags &&
      !shouldApplyStorage &&
      !shouldApplyAcl &&
      !shouldApplyLegalHold &&
      !shouldApplyRetention
    ) {
      setBulkAttributesError("Select at least one attribute to update.");
      return;
    }

    const metadataPairs = parseKeyValueLines(bulkMetadataEntries);
    const tagsPairs = parseKeyValueLines(bulkTagsDraft);
    const expiresIso = bulkMetadataDraft.expires.trim()
      ? toIsoString(bulkMetadataDraft.expires)
      : "";
    const metadataHasValues =
      Boolean(bulkMetadataDraft.contentType.trim()) ||
      Boolean(bulkMetadataDraft.cacheControl.trim()) ||
      Boolean(bulkMetadataDraft.contentDisposition.trim()) ||
      Boolean(bulkMetadataDraft.contentEncoding.trim()) ||
      Boolean(bulkMetadataDraft.contentLanguage.trim()) ||
      Boolean(expiresIso) ||
      metadataPairs.length > 0;

    if (shouldApplyMetadata && !metadataHasValues) {
      setBulkAttributesError("Provide at least one metadata field.");
      return;
    }
    if (shouldApplyStorage && !bulkStorageClass) {
      setBulkAttributesError("Select a storage class.");
      return;
    }
    if (
      shouldApplyMetadata &&
      bulkMetadataDraft.expires.trim() &&
      !expiresIso
    ) {
      setBulkAttributesError("Provide a valid expires date.");
      return;
    }
    if (shouldApplyTags && tagsPairs.length === 0) {
      setBulkAttributesError("Provide at least one tag.");
      return;
    }
    const retentionIso = bulkRetentionDate
      ? toIsoString(bulkRetentionDate)
      : "";
    if (
      shouldApplyRetention &&
      (!bulkRetentionMode || !bulkRetentionDate || !retentionIso)
    ) {
      setBulkAttributesError("Provide retention mode and date.");
      return;
    }

    setBulkAttributesLoading(true);
    setBulkAttributesError(null);
    setBulkAttributesSummary(null);
    let operationId: string | null = null;
    let controller: AbortController | null = null;
    try {
      const keys = await resolveBulkAttributeKeys(bulkActionItems);
      if (keys.length === 0) {
        setBulkAttributesError("No objects to update.");
        return;
      }
      if (keys.length > 1) {
        setShowOperationsModal(true);
      }
      operationId = startOperation(
        "copying",
        "Updating attributes",
        currentPath || bucketName,
        { kind: "other", cancelable: true },
        0,
      );
      controller = createOperationController(operationId);
      const total = keys.length;
      let completed = 0;
      let succeeded = 0;
      let failures = 0;
      let cancelled = false;

      const updateProgress = () => {
        const percent = total > 0 ? Math.round((completed / total) * 100) : 100;
        setOperations((prev) =>
          prev.map((op) =>
            op.id === operationId ? { ...op, progress: percent } : op,
          ),
        );
      };

      const metadataRecord =
        metadataPairs.length > 0 ? pairsToRecord(metadataPairs) : undefined;

      const applyForKey = async (key: string) => {
        if (shouldApplyMetadata || shouldApplyStorage) {
          const payload = {
            key,
            content_type:
              shouldApplyMetadata && bulkMetadataDraft.contentType.trim()
                ? bulkMetadataDraft.contentType.trim()
                : undefined,
            cache_control:
              shouldApplyMetadata && bulkMetadataDraft.cacheControl.trim()
                ? bulkMetadataDraft.cacheControl.trim()
                : undefined,
            content_disposition:
              shouldApplyMetadata && bulkMetadataDraft.contentDisposition.trim()
                ? bulkMetadataDraft.contentDisposition.trim()
                : undefined,
            content_encoding:
              shouldApplyMetadata && bulkMetadataDraft.contentEncoding.trim()
                ? bulkMetadataDraft.contentEncoding.trim()
                : undefined,
            content_language:
              shouldApplyMetadata && bulkMetadataDraft.contentLanguage.trim()
                ? bulkMetadataDraft.contentLanguage.trim()
                : undefined,
            expires: shouldApplyMetadata && expiresIso ? expiresIso : undefined,
            metadata:
              shouldApplyMetadata && metadataRecord
                ? metadataRecord
                : undefined,
            storage_class: shouldApplyStorage ? bulkStorageClass : undefined,
          };
          await updateObjectMetadata(
            accountIdForApi,
            bucketName,
            payload,
            controller?.signal,
          );
        }
        if (shouldApplyTags) {
          await updateObjectTags(
            accountIdForApi,
            bucketName,
            {
              key,
              tags: tagsPairs,
            },
            controller?.signal,
          );
        }
        if (shouldApplyAcl) {
          await updateObjectAcl(
            accountIdForApi,
            bucketName,
            {
              key,
              acl: bulkAclValue,
            },
            controller?.signal,
          );
        }
        if (shouldApplyLegalHold) {
          await updateObjectLegalHold(
            accountIdForApi,
            bucketName,
            {
              key,
              status: bulkLegalHoldStatus,
            },
            controller?.signal,
          );
        }
        if (shouldApplyRetention) {
          await updateObjectRetention(
            accountIdForApi,
            bucketName,
            {
              key,
              mode: bulkRetentionMode,
              retain_until: retentionIso,
              bypass_governance: bulkRetentionBypass,
            },
            controller?.signal,
          );
        }
      };

      const queue = [...keys];
      const workerCount = Math.max(
        1,
        Math.min(otherOperationsParallelismRef.current, queue.length),
      );
      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0 && !cancelled) {
          if (controller?.signal.aborted) {
            cancelled = true;
            return;
          }
          const key = queue.shift();
          if (!key) return;
          try {
            await applyForKey(key);
            succeeded += 1;
          } catch {
            if (controller?.signal.aborted) {
              cancelled = true;
              return;
            }
            failures += 1;
          } finally {
            completed += 1;
            updateProgress();
          }
        }
      });
      await Promise.all(workers);
      if (cancelled || controller?.signal.aborted) {
        const summary = `Update cancelled after ${succeeded} of ${total} item(s).`;
        completeOperation(operationId, "cancelled");
        setBulkAttributesSummary(summary);
        setStatusMessage(summary);
        await refreshObjectsNow(prefix);
        return;
      }
      const completionError =
        failures > 0 ? "Some objects failed to update attributes." : undefined;
      completeOperation(
        operationId,
        failures > 0 ? "failed" : "done",
        completionError,
      );
      const successCount = Math.max(0, total - failures);
      const summary = `Updated ${successCount} of ${total} object(s).`;
      setBulkAttributesSummary(summary);
      setStatusMessage(summary);
      requestObjectsRefresh(prefix);
    } catch {
      setBulkAttributesError("Unable to update attributes.");
    } finally {
      if (operationId) {
        clearOperationController(operationId);
      }
      setBulkAttributesLoading(false);
    }
  };

  const handleBulkRestoreApply = async () => {
    if (!bucketName || !hasS3AccountContext) return;
    if (!isVersioningEnabled) {
      setBulkRestoreError("Versioning is not enabled for this bucket.");
      return;
    }
    const isLatestRestoreMode = bulkRestoreRestoreDeleted;
    const allowDeleteMissing = !isLatestRestoreMode && bulkRestoreDeleteMissing;
    const targetTime = bulkRestoreDate
      ? new Date(bulkRestoreDate).getTime()
      : Number.NaN;
    if (
      !isLatestRestoreMode &&
      (!bulkRestoreDate || Number.isNaN(targetTime))
    ) {
      setBulkRestoreError("Select a valid date.");
      return;
    }
    setBulkRestoreLoading(true);
    setBulkRestoreError(null);
    setBulkRestoreSummary(null);
    setBulkRestorePreview(null);
    let operationId: string | null = null;
    let controller: AbortController | null = null;
    try {
      const buildRestorePlan = async () => {
        const fileItems = bulkActionItems.filter(
          (item) => item.type === "file",
        );
        const folderItems = bulkActionItems.filter(
          (item) => item.type === "folder",
        );
        const restoreCandidates = new Map<string, string>();
        const presentAtDate = new Set<string>();
        const deleteCandidates = new Set<string>();
        const unchangedKeys = new Set<string>();

        for (const item of fileItems) {
          const { versions, deleteMarkers } = await listAllVersionsForKey(
            item.key,
          );
          const allEntries = [...versions, ...deleteMarkers];
          const latest = allEntries.find((entry) => entry.is_latest);
          const latestRestorable = findLatestRestorableVersion(allEntries);

          if (isLatestRestoreMode) {
            if (latest?.is_delete_marker && latestRestorable?.version_id) {
              restoreCandidates.set(item.key, latestRestorable.version_id);
            }
            continue;
          }

          const match = findVersionForDate(allEntries, targetTime);
          if (match && !match.is_delete_marker && match.version_id) {
            if (
              latest &&
              !latest.is_delete_marker &&
              latest.version_id === match.version_id
            ) {
              unchangedKeys.add(item.key);
            } else {
              restoreCandidates.set(item.key, match.version_id);
            }
            presentAtDate.add(item.key);
          } else if (
            bulkRestoreRestoreDeleted &&
            latest?.is_delete_marker &&
            latestRestorable?.version_id
          ) {
            restoreCandidates.set(item.key, latestRestorable.version_id);
          } else if (allowDeleteMissing) {
            deleteCandidates.add(item.key);
          }
        }

        for (const folder of folderItems) {
          const folderPrefix = normalizePrefix(folder.key);
          const { versions, deleteMarkers } =
            await listAllVersionsForPrefix(folderPrefix);
          const byKey = new Map<string, BrowserObjectVersion[]>();
          [...versions, ...deleteMarkers].forEach((entry) => {
            const list = byKey.get(entry.key) ?? [];
            list.push(entry);
            byKey.set(entry.key, list);
          });
          byKey.forEach((entries, key) => {
            const latest = entries.find((entry) => entry.is_latest);
            const latestRestorable = findLatestRestorableVersion(entries);

            if (isLatestRestoreMode) {
              if (latest?.is_delete_marker && latestRestorable?.version_id) {
                restoreCandidates.set(key, latestRestorable.version_id);
              }
              return;
            }

            const match = findVersionForDate(entries, targetTime);
            if (match && !match.is_delete_marker && match.version_id) {
              if (
                latest &&
                !latest.is_delete_marker &&
                latest.version_id === match.version_id
              ) {
                unchangedKeys.add(key);
              } else {
                restoreCandidates.set(key, match.version_id);
              }
              presentAtDate.add(key);
            } else if (
              bulkRestoreRestoreDeleted &&
              latest?.is_delete_marker &&
              latestRestorable?.version_id
            ) {
              restoreCandidates.set(key, latestRestorable.version_id);
            }
          });
          if (allowDeleteMissing) {
            const currentObjects = await listAllObjectsForPrefix(folderPrefix);
            currentObjects.forEach((obj) => {
              if (!presentAtDate.has(obj.key)) {
                deleteCandidates.add(obj.key);
              }
            });
          }
        }

        const restoreList = Array.from(restoreCandidates.entries()).map(
          ([key, versionId]) => ({
            key,
            versionId,
          }),
        );
        const deleteList = allowDeleteMissing
          ? Array.from(deleteCandidates)
          : [];
        return { restoreList, deleteList, unchangedKeys };
      };

      const { restoreList, deleteList, unchangedKeys } =
        await buildRestorePlan();
      const unchangedCount = unchangedKeys.size;
      const total = restoreList.length + deleteList.length;
      if (total === 0) {
        if (unchangedCount > 0) {
          const summary = bulkRestoreDryRun
            ? `Dry run: unchanged ${unchangedCount} object(s).`
            : `Unchanged ${unchangedCount} object(s).`;
          setBulkRestoreSummary(summary);
          setStatusMessage(summary);
          if (bulkRestoreDryRun) {
            setBulkRestorePreview({
              restoreKeys: [],
              deleteKeys: [],
              unchangedKeys: Array.from(unchangedKeys).slice(0, 20),
              totalRestore: 0,
              totalDelete: 0,
              totalUnchanged: unchangedCount,
            });
          }
        } else {
          setBulkRestoreError(
            isLatestRestoreMode
              ? "No deleted objects can be restored to their latest version."
              : "No objects matched the selected date.",
          );
        }
        return;
      }

      if (bulkRestoreDryRun) {
        const summary = `Dry run: would restore ${restoreList.length} object(s), delete ${deleteList.length} object(s), unchanged ${unchangedCount} object(s).`;
        setBulkRestoreSummary(summary);
        setBulkRestorePreview({
          restoreKeys: restoreList.slice(0, 20).map((item) => item.key),
          deleteKeys: deleteList.slice(0, 20),
          unchangedKeys: Array.from(unchangedKeys).slice(0, 20),
          totalRestore: restoreList.length,
          totalDelete: deleteList.length,
          totalUnchanged: unchangedCount,
        });
        return;
      }

      if (total > 1) {
        setShowOperationsModal(true);
      }
      operationId = startOperation(
        "copying",
        "Restoring snapshot",
        currentPath || bucketName,
        { kind: "other", cancelable: true },
        0,
      );
      controller = createOperationController(operationId);
      let completed = 0;
      let restoredCount = 0;
      let deletedCount = 0;
      let restoreFailures = 0;
      let deleteFailures = 0;
      let cancelled = false;

      const updateProgress = (count: number) => {
        const percent = total > 0 ? Math.round((count / total) * 100) : 100;
        setOperations((prev) =>
          prev.map((op) =>
            op.id === operationId ? { ...op, progress: percent } : op,
          ),
        );
      };

      if (restoreList.length > 0) {
        const queue = [...restoreList];
        const workerCount = Math.max(
          1,
          Math.min(otherOperationsParallelismRef.current, queue.length),
        );
        const workers = Array.from({ length: workerCount }, async () => {
          while (queue.length > 0 && !cancelled) {
            if (controller?.signal.aborted) {
              cancelled = true;
              return;
            }
            const item = queue.shift();
            if (!item) return;
            try {
              await copyObject(accountIdForApi, bucketName, {
                source_key: item.key,
                source_version_id: item.versionId,
                destination_key: item.key,
                replace_metadata: false,
                move: false,
              }, controller?.signal);
              restoredCount += 1;
            } catch {
              if (controller?.signal.aborted) {
                cancelled = true;
                return;
              }
              restoreFailures += 1;
            } finally {
              completed += 1;
              updateProgress(completed);
            }
          }
        });
        await Promise.all(workers);
      }

      if (!cancelled && deleteList.length > 0) {
        try {
          deletedCount = await deleteObjectsInBatches(deleteList, (deleted) => {
            updateProgress(completed + deleted);
          }, undefined, controller?.signal);
        } catch (err) {
          if (isOperationAborted(err, controller)) {
            cancelled = true;
          } else {
            deleteFailures = deleteList.length;
          }
        }
      }

      if (cancelled || controller?.signal.aborted) {
        const summary = `Restore cancelled after ${restoredCount + deletedCount} of ${total} item(s).`;
        completeOperation(operationId, "cancelled");
        setBulkRestoreSummary(summary);
        setStatusMessage(summary);
        await refreshObjectsNow(prefix);
        return;
      }

      const failures = restoreFailures + deleteFailures;
      const completionError =
        failures > 0 ? "Some objects failed to restore or delete." : undefined;
      completeOperation(
        operationId,
        failures > 0 ? "failed" : "done",
        completionError,
      );
      const summary = `Restored ${restoreList.length - restoreFailures} object(s), deleted ${deleteList.length - deleteFailures} object(s), unchanged ${unchangedCount} object(s).`;
      setBulkRestoreSummary(summary);
      setStatusMessage(summary);
      requestObjectsRefresh(prefix);
    } catch {
      setBulkRestoreError("Unable to restore objects.");
    } finally {
      if (operationId) {
        clearOperationController(operationId);
      }
      setBulkRestoreLoading(false);
    }
  };

  const openCleanupModal = () => {
    if (!isVersioningEnabled) return;
    setCleanupError(null);
    setCleanupSummary(null);
    setShowCleanupModal(true);
  };

  const handleCleanupApply = async () => {
    if (!bucketName || !hasS3AccountContext) return;
    const keepLast = Number.parseInt(cleanupKeepLast, 10);
    const olderThan = Number.parseInt(cleanupOlderThanDays, 10);
    const keepLastValue = Number.isNaN(keepLast) ? undefined : keepLast;
    const olderThanValue = Number.isNaN(olderThan) ? undefined : olderThan;
    if (!keepLastValue && !olderThanValue && !cleanupDeleteOrphanMarkers) {
      setCleanupError("Select at least one cleanup rule.");
      return;
    }
    if (keepLastValue !== undefined && keepLastValue < 1) {
      setCleanupError("Keep last versions must be at least 1.");
      return;
    }
    if (olderThanValue !== undefined && olderThanValue < 1) {
      setCleanupError("Older than days must be at least 1.");
      return;
    }
    setCleanupLoading(true);
    setCleanupError(null);
    setCleanupSummary(null);
    setShowOperationsModal(true);
    const operationId = startOperation(
      "deleting",
      "Cleaning old versions",
      currentPath || bucketName,
      { kind: "other", cancelable: true },
      0,
    );
    const controller = createOperationController(operationId);
    let cleanupCompletionStatus: OperationCompletionStatus = "done";
    let cleanupCompletionError: string | undefined;
    try {
      const result = await cleanupObjectVersions(
        accountIdForApi,
        bucketName,
        {
          prefix: normalizedPrefix,
          keep_last_n: keepLastValue,
          older_than_days: olderThanValue,
          delete_orphan_markers: cleanupDeleteOrphanMarkers,
        },
        controller.signal,
      );
      const summary = `Removed ${result.deleted_versions} version(s) and ${result.deleted_delete_markers} delete marker(s).`;
      setCleanupSummary(summary);
      setStatusMessage(summary);
      requestObjectsRefresh(prefix);
    } catch (err) {
      if (isOperationAborted(err, controller)) {
        cleanupCompletionStatus = "cancelled";
        setCleanupSummary("Cleanup cancelled.");
        setStatusMessage("Cleanup cancelled.");
        await refreshObjectsNow(prefix);
      } else {
        cleanupCompletionStatus = "failed";
        cleanupCompletionError = "Unable to clean old versions for this prefix.";
        setCleanupError("Unable to clean old versions for this prefix.");
      }
    } finally {
      clearOperationController(operationId);
      completeOperation(
        operationId,
        cleanupCompletionStatus,
        cleanupCompletionError,
      );
      setCleanupLoading(false);
    }
  };

  const handleCopyItems = useCallback(
    (items: BrowserItem[]) => {
      if (!bucketName || items.length === 0) return;
      const eligible = items.filter((item) => !item.isDeleted);
      if (eligible.length === 0) {
        setWarningMessage("Deleted objects cannot be copied directly.");
        return;
      }
      if (eligible.length !== items.length) {
        setWarningMessage("Deleted objects were skipped.");
      } else {
        setWarningMessage(null);
      }
      setClipboard({
        items: eligible,
        sourceBucket: bucketName,
        sourceSelector: accountIdForApi ?? null,
        mode: "copy",
      });
      setStatusMessage("Items copied.");
    },
    [accountIdForApi, bucketName],
  );

  const handleCutItems = useCallback(
    (items: BrowserItem[]) => {
      if (!bucketName || items.length === 0) return;
      const eligible = items.filter((item) => !item.isDeleted);
      if (eligible.length === 0) {
        setWarningMessage("Deleted objects cannot be moved directly.");
        return;
      }
      if (eligible.length !== items.length) {
        setWarningMessage("Deleted objects were skipped.");
      } else {
        setWarningMessage(null);
      }
      setClipboard({
        items: eligible,
        sourceBucket: bucketName,
        sourceSelector: accountIdForApi ?? null,
        mode: "move",
      });
      setStatusMessage("Items ready to move.");
    },
    [accountIdForApi, bucketName],
  );

  const handlePasteItems = useCallback(async () => {
    if (!clipboard || !bucketName || !hasS3AccountContext) return;
    setWarningMessage(null);
    const destinationBucket = bucketName;
    const destinationPrefix = normalizedPrefix;
    const { items, sourceBucket, sourceSelector, mode } = clipboard;
    const isMove = mode === "move";
    const useServerSideCopy = clipboardMatchesContext;
    const copyTasks: Array<{
      sourceSelector: S3AccountSelector;
      sourceBucket: string;
      sourceKey: string;
      destinationBucket: string;
      destinationKey: string;
      detailId: string;
    }> = [];
    const copyDetailItems: CopyDetailItem[] = [];
    let skipped = 0;

    for (const item of items) {
      if (item.type === "file") {
        const destinationKey = `${destinationPrefix}${item.name}`;
        if (
          useServerSideCopy &&
          sourceBucket === destinationBucket &&
          destinationKey === item.key
        ) {
          skipped += 1;
          continue;
        }
        const detailId = makeId();
        copyTasks.push({
          sourceSelector,
          sourceBucket,
          sourceKey: item.key,
          destinationBucket,
          destinationKey,
          detailId,
        });
        copyDetailItems.push({
          id: detailId,
          key: destinationKey,
          label: shortName(destinationKey, destinationPrefix) || destinationKey,
          status: "queued",
          sizeBytes: item.sizeBytes ?? undefined,
        });
      } else {
        const sourcePrefix = normalizePrefix(item.key);
        const destFolderPrefix = `${destinationPrefix}${item.name}/`;
        if (
          useServerSideCopy &&
          sourceBucket === destinationBucket &&
          destFolderPrefix === sourcePrefix
        ) {
          skipped += 1;
          continue;
        }
        try {
          await createFolder(
            accountIdForApi,
            destinationBucket,
            destFolderPrefix,
          );
        } catch {
          // ignore folder creation failures
        }
        const objects = await listAllObjectsForPrefix(
          sourcePrefix,
          sourceBucket,
          sourceSelector,
        );
        objects.forEach((obj) => {
          const relativeKey = obj.key.startsWith(sourcePrefix)
            ? obj.key.slice(sourcePrefix.length)
            : obj.key;
          if (!relativeKey) return;
          const destinationKey = `${destFolderPrefix}${relativeKey}`;
          if (
            useServerSideCopy &&
            sourceBucket === destinationBucket &&
            destinationKey === obj.key
          ) {
            skipped += 1;
            return;
          }
          const detailId = makeId();
          copyTasks.push({
            sourceSelector,
            sourceBucket,
            sourceKey: obj.key,
            destinationBucket,
            destinationKey,
            detailId,
          });
          copyDetailItems.push({
            id: detailId,
            key: destinationKey,
            label:
              shortName(destinationKey, destinationPrefix) || destinationKey,
            status: "queued",
            sizeBytes: obj.size ?? undefined,
          });
        });
      }
    }

    if (copyTasks.length === 0) {
      setStatusMessage(
        skipped > 0 ? "Nothing new to paste here." : "No items to paste.",
      );
      return;
    }

    if (copyTasks.length > 1) {
      setShowOperationsModal(true);
    }
    const operationId = startOperation(
      "copying",
      isMove ? "Moving items" : "Copying items",
      destinationPrefix
        ? `${destinationBucket}/${destinationPrefix}`
        : destinationBucket,
      { kind: "copy", cancelable: true },
      0,
    );
    const controller = createOperationController(operationId);
    if (copyDetailItems.length > 0) {
      setCopyDetails((prev) => ({ ...prev, [operationId]: copyDetailItems }));
    }
    const total = copyTasks.length;
    let completed = 0;
    let succeeded = 0;
    let failures = 0;
    let cancelled = false;
    const updateProgress = () => {
      const percent = total > 0 ? Math.round((completed / total) * 100) : 100;
      setOperations((prev) =>
        prev.map((op) =>
          op.id === operationId ? { ...op, progress: percent } : op,
        ),
      );
    };

    try {
      const queue = [...copyTasks];
      const transferModeCache = new Map<
        string,
        Promise<ClipboardTransferMode>
      >();
      const resolveTransferModeCached = (
        selector: S3AccountSelector,
        targetBucket: string,
      ) => {
        const cacheKey = `${normalizeSelectorId(selector) ?? ""}::${targetBucket}`;
        const cached = transferModeCache.get(cacheKey);
        if (cached) {
          return cached;
        }
        const request = resolveClipboardTransferMode(selector, targetBucket);
        transferModeCache.set(cacheKey, request);
        return request;
      };
      const workerCount = Math.max(
        1,
        Math.min(otherOperationsParallelismRef.current, queue.length),
      );
      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0 && !cancelled) {
          if (controller.signal.aborted) {
            cancelled = true;
            return;
          }
          const task = queue.shift();
          if (!task) return;
          try {
            updateCopyDetailStatus(operationId, task.detailId, "copying");
            if (useServerSideCopy) {
              await copyObject(
                accountIdForApi,
                destinationBucket,
                {
                  source_bucket: task.sourceBucket,
                  source_key: task.sourceKey,
                  destination_key: task.destinationKey,
                  move: isMove,
                },
                controller.signal,
              );
            } else {
              const sourceSseKeyBase64 = getSseCustomerKeyForScope(
                task.sourceSelector,
                task.sourceBucket,
              );
              const destinationSseKeyBase64 = getSseCustomerKeyForScope(
                accountIdForApi,
                destinationBucket,
              );
              const sourceMeta = await fetchObjectMetadata(
                task.sourceSelector,
                task.sourceBucket,
                task.sourceKey,
                null,
                sourceSseKeyBase64,
                controller.signal,
              );
              await transferClipboardObjectBetweenContexts({
                source: {
                  selector: task.sourceSelector,
                  bucket: task.sourceBucket,
                  key: task.sourceKey,
                  sseCustomerKeyBase64: sourceSseKeyBase64,
                },
                destination: {
                  selector: accountIdForApi,
                  bucket: destinationBucket,
                  key: task.destinationKey,
                  sseCustomerKeyBase64: destinationSseKeyBase64,
                },
                sizeBytes: sourceMeta.size,
                contentType: sourceMeta.content_type ?? undefined,
                move: isMove,
                signal: controller.signal,
                resolveMode: resolveTransferModeCached,
                downloadBlob: downloadObjectBlobForTransfer,
                downloadStream: downloadObjectStreamForTransfer,
                uploadBlob: uploadBlobForTransfer,
                uploadMultipartStream: uploadMultipartStreamForTransfer,
                verifyObject: async ({
                  selector,
                  bucket,
                  key,
                  sseCustomerKeyBase64,
                }) => {
                  const metadata = await fetchObjectMetadata(
                    selector,
                    bucket,
                    key,
                    null,
                    sseCustomerKeyBase64,
                    controller.signal,
                  );
                  return { sizeBytes: metadata.size };
                },
                deleteObject: deleteObjectForTransfer,
              });
            }
            updateCopyDetailStatus(operationId, task.detailId, "done");
            succeeded += 1;
          } catch (err) {
            if (isAbortError(err) || controller.signal.aborted) {
              cancelled = true;
              controller.abort();
              updateCopyDetailStatus(operationId, task.detailId, "cancelled");
              return;
            }
            updateCopyDetailStatus(
              operationId,
              task.detailId,
              "failed",
              formatOperationError(err, "Copy failed."),
            );
            failures += 1;
          } finally {
            completed += 1;
            updateProgress();
          }
        }
      });
      await Promise.all(workers);

      if (cancelled || controller.signal.aborted) {
        cancelCopyDetails(operationId);
        completeOperation(operationId, "cancelled");
        setStatusMessage(
          `${isMove ? "Move" : "Copy"} cancelled after ${succeeded} of ${total} item(s).`,
        );
        await refreshObjectsNow(destinationPrefix);
        return;
      }

      const completionError =
        failures > 0 ? "Some items failed to copy or move." : undefined;
      completeOperation(
        operationId,
        failures > 0 ? "failed" : "done",
        completionError,
      );
      const summary = `${isMove ? "Moved" : "Copied"} ${total - failures} of ${total} item(s).`;
      setStatusMessage(summary);
      await refreshObjectsNow(destinationPrefix);
      if (isMove && failures === 0) {
        setClipboard(null);
      }
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        cancelCopyDetails(operationId);
        completeOperation(operationId, "cancelled");
        setStatusMessage(
          `${isMove ? "Move" : "Copy"} cancelled after ${succeeded} of ${total} item(s).`,
        );
        await refreshObjectsNow(destinationPrefix);
        return;
      }
      const completionError = formatOperationError(
        err,
        "Unable to paste items.",
        "Unable to paste items.",
      );
      completeOperation(operationId, "failed", completionError);
      setStatusMessage(completionError);
    } finally {
      clearOperationController(operationId);
    }
  }, [
    accountIdForApi,
    bucketName,
    cancelCopyDetails,
    clipboard,
    clipboardMatchesContext,
    clearOperationController,
    completeOperation,
    createOperationController,
    deleteObjectForTransfer,
    downloadObjectBlobForTransfer,
    downloadObjectStreamForTransfer,
    formatOperationError,
    getSseCustomerKeyForScope,
    hasS3AccountContext,
    listAllObjectsForPrefix,
    normalizedPrefix,
    refreshObjectsNow,
    resolveClipboardTransferMode,
    normalizeSelectorId,
    startOperation,
    uploadBlobForTransfer,
    uploadMultipartStreamForTransfer,
    updateCopyDetailStatus,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shortcutsBlocked =
      Boolean(objectDetailsTarget) ||
      showNewFolderModal ||
      showOperationsModal ||
      showBulkAttributesModal ||
      showBulkRestoreModal ||
      showSseCustomerModal ||
      showCleanupModal ||
      showPrefixVersions ||
      showMultipartUploadsModal ||
      Boolean(confirmDialog) ||
      Boolean(copyDialog);
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      if (element.isContentEditable) return true;
      return Boolean(
        element.closest(
          "input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']",
        ),
      );
    };
    const handleShortcut = (event: KeyboardEvent) => {
      if (shortcutsBlocked) return;
      if (event.defaultPrevented) return;
      if (event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (!hasS3AccountContext || !bucketName) return;
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier) return;
      const key = event.key.toLowerCase();

      if (key === "a") {
        if (listItems.length === 0) return;
        event.preventDefault();
        const nextIds = listItems.map((item) => item.id);
        setSelectedIds(nextIds);
        setSelectionAnchorId(nextIds[0] ?? null);
        setActiveRowId(nextIds[0] ?? null);
        syncInspectorTabWithSelection(nextIds.length);
        return;
      }

      if (key === "l") {
        event.preventDefault();
        startEditingPath();
        return;
      }

      if (key === "c") {
        const targets = selectedItems;
        if (targets.length === 0) return;
        event.preventDefault();
        handleCopyItems(targets);
        return;
      }

      if (key === "x") {
        const targets = selectedItems;
        if (targets.length === 0) return;
        event.preventDefault();
        handleCutItems(targets);
        return;
      }

      if (key === "v") {
        if (!canPaste) return;
        event.preventDefault();
        void handlePasteItems();
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [
    bucketName,
    canPaste,
    handleCopyItems,
    handleCutItems,
    handlePasteItems,
    hasS3AccountContext,
    listItems,
    selectedItems,
    setActiveRowId,
    setSelectionAnchorId,
    startEditingPath,
    objectDetailsTarget,
    showNewFolderModal,
    showBulkAttributesModal,
    showBulkRestoreModal,
    showSseCustomerModal,
    showCleanupModal,
    confirmDialog,
    copyDialog,
    showMultipartUploadsModal,
    showOperationsModal,
    showPrefixVersions,
    syncInspectorTabWithSelection,
  ]);

  const refreshObjectListing = async (_targetKey: string) => {
    await loadObjects({ prefixOverride: prefix });
    if (showPrefixVersions) {
      await loadPrefixVersions({
        append: false,
        keyMarker: null,
        versionIdMarker: null,
      });
    }
  };

  const refreshVersionsForKey = async (targetKey: string) => {
    if (
      inspectorTab === "details" &&
      inspectedItem?.type === "file" &&
      inspectedItem.key === targetKey
    ) {
      await loadObjectVersions({
        append: false,
        keyMarker: null,
        versionIdMarker: null,
        targetKey,
      });
    }
  };

  const handleRestoreVersion = async (item: BrowserObjectVersion) => {
    if (
      !bucketName ||
      !hasS3AccountContext ||
      !item.version_id ||
      item.is_delete_marker ||
      !isVersioningEnabled
    )
      return;
    setWarningMessage(null);
    const operationId = startOperation(
      "copying",
      "Restoring version",
      `${bucketName}/${item.key}`,
      { cancelable: true },
    );
    const controller = createOperationController(operationId);
    let completionStatus: OperationCompletionStatus = "done";
    let completionError: string | undefined;
    try {
      await copyObject(
        accountIdForApi,
        bucketName,
        {
          source_key: item.key,
          source_version_id: item.version_id,
          destination_key: item.key,
          replace_metadata: false,
          move: false,
        },
        controller.signal,
      );
      setStatusMessage(`Restored version ${item.version_id}`);
      await refreshObjectListing(item.key);
      await refreshVersionsForKey(item.key);
    } catch (err) {
      if (isOperationAborted(err, controller)) {
        completionStatus = "cancelled";
        setStatusMessage("Restore version cancelled.");
        await refreshObjectListing(item.key);
        await refreshVersionsForKey(item.key);
      } else {
        completionStatus = "failed";
        completionError = formatOperationError(
          err,
          "Unable to restore version.",
          "Unable to restore version.",
        );
        setStatusMessage(completionError);
      }
    } finally {
      clearOperationController(operationId);
      completeOperation(operationId, completionStatus, completionError);
    }
  };

  const handleDeleteVersion = async (
    item: BrowserObjectVersion,
    options?: { skipConfirm?: boolean },
  ) => {
    if (
      !bucketName ||
      !hasS3AccountContext ||
      !item.version_id ||
      !isVersioningEnabled
    )
      return;
    setWarningMessage(null);
    const label = item.is_delete_marker ? "delete marker" : "version";
    if (!options?.skipConfirm) {
      openConfirmDialog({
        title: `Delete ${label}`,
        message: `Delete ${label} for ${item.key}?`,
        confirmLabel: "Delete",
        tone: "danger",
        onConfirm: () => handleDeleteVersion(item, { skipConfirm: true }),
      });
      return;
    }
    const operationLabel = item.is_delete_marker
      ? "Removing delete marker"
      : "Deleting version";
    const operationId = startOperation(
      "deleting",
      operationLabel,
      `${bucketName}/${item.key}`,
      { cancelable: true },
    );
    const controller = createOperationController(operationId);
    let completionStatus: OperationCompletionStatus = "done";
    let completionError: string | undefined;
    try {
      await deleteObjects(
        accountIdForApi,
        bucketName,
        [{ key: item.key, version_id: item.version_id }],
        controller.signal,
      );
      setStatusMessage(
        item.is_delete_marker ? "Delete marker removed." : "Version deleted.",
      );
      await refreshObjectListing(item.key);
      await refreshVersionsForKey(item.key);
    } catch (err) {
      if (isOperationAborted(err, controller)) {
        completionStatus = "cancelled";
        setStatusMessage(
          item.is_delete_marker
            ? "Delete marker removal cancelled."
            : "Delete version cancelled.",
        );
        await refreshObjectListing(item.key);
        await refreshVersionsForKey(item.key);
      } else {
        completionStatus = "failed";
        completionError = formatOperationError(
          err,
          item.is_delete_marker
            ? "Unable to delete marker."
            : "Unable to delete version.",
          item.is_delete_marker
            ? "Unable to delete marker."
            : "Unable to delete version.",
        );
        setWarningMessage(completionError);
      }
    } finally {
      clearOperationController(operationId);
      completeOperation(operationId, completionStatus, completionError);
    }
  };

  const handleCopyUrl = async (item: BrowserItem | null) => {
    if (
      !bucketName ||
      !hasS3AccountContext ||
      !item ||
      item.type !== "file" ||
      item.isDeleted
    ) {
      if (item?.isDeleted) {
        setWarningMessage("Deleted objects do not have a direct download URL.");
      }
      return;
    }
    if (sseActive) {
      setWarningMessage(
        "Copy URL is disabled in SSE-C mode: required encryption headers are missing.",
      );
      return;
    }
    try {
      const presign = await presignObjectRequest(bucketName, {
        key: item.key,
        operation: "get_object",
        expires_in: 900,
      });
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(presign.url);
        setStatusMessage("URL copied to clipboard.");
      } else {
        setCopyDialog({
          title: "Copy URL",
          label: "Object URL",
          value: presign.url,
          successMessage: "URL copied to clipboard.",
        });
      }
    } catch {
      setStatusMessage("Unable to copy URL.");
    }
  };

  const handleCopyPath = async (path: string) => {
    if (!path) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(path);
        setStatusMessage("Path copied to clipboard.");
      } else {
        setCopyDialog({
          title: "Copy path",
          label: "Object path",
          value: path,
          successMessage: "Path copied to clipboard.",
        });
      }
    } catch {
      setStatusMessage("Unable to copy path.");
    }
  };

  const runPathAction = (actionId: string) => {
    switch (actionId) {
      case "uploadFiles":
        fileInputRef.current?.click();
        return;
      case "uploadFolder":
        folderInputRef.current?.click();
        return;
      case "newFolder":
        handleNewFolder();
        return;
      case "paste":
        void handlePasteItems();
        return;
      case "versions":
        setShowPrefixVersions(true);
        return;
      case "restoreToDate":
        openBulkRestoreModal([]);
        return;
      case "cleanOldVersions":
        openCleanupModal();
        return;
      case "copyPath":
        void handleCopyPath(currentPath);
        return;
      default:
        return;
    }
  };

  const runSelectionAction = (actionId: string) => {
    switch (actionId) {
      case "download":
        if (
          selectionActionStates.download.label === "Download folder" &&
          selectionPrimary
        ) {
          handleDownloadFolder(selectionPrimary);
          return;
        }
        void handleDownloadItems(selectionFiles);
        return;
      case "open":
        if (selectionPrimary) {
          handleOpenItem(selectionPrimary);
        }
        return;
      case "copyUrl":
        void handleCopyUrl(selectionPrimary);
        return;
      case "copy":
        handleCopyItems(selectionItems);
        return;
      case "cut":
        handleCutItems(selectionItems);
        return;
      case "bulkAttributes":
        openBulkAttributesModal(selectionItems);
        return;
      case "advanced":
        if (selectionPrimary) {
          openAdvancedForItem(selectionPrimary);
        }
        return;
      case "restoreToDate":
        openBulkRestoreModal(selectionItems);
        return;
      case "delete":
        void handleDeleteItems(selectionItems);
        return;
      default:
        return;
    }
  };

  const resolveItemActionStates = (item: BrowserItem) =>
    resolveBrowserActions({
      scope: "item",
      items: [item],
      bucketName,
      hasS3AccountContext,
      versioningEnabled: isVersioningEnabled,
      canPaste,
      clipboardMode: clipboard?.mode ?? null,
      copyUrlDisabled: sseActive,
      copyUrlDisabledReason,
      inspectorAvailable: canUseInspectorPanel,
    });

  const activeOperations = useMemo(
    () => operations.filter((op) => !op.completedAt),
    [operations],
  );
  const uploadGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        label: string;
        kind: "folder" | "files";
        activeItems: OperationItem[];
        completedItems: OperationItem[];
        queuedItems: UploadQueueItem[];
        cancelable: boolean;
        progress: number;
        totalBytes: number;
      }
    >();
    operations
      .filter((op) => op.kind === "upload")
      .forEach((op) => {
        const groupId = op.groupId ?? op.id;
        const label = op.groupLabel ?? "Files";
        const kind = op.groupKind ?? "files";
        const existing = groups.get(groupId);
        const isCompleted = Boolean(op.completedAt);
        if (existing) {
          if (isCompleted) {
            existing.completedItems.push(op);
          } else {
            existing.activeItems.push(op);
          }
          existing.cancelable = existing.cancelable || Boolean(op.cancelable);
        } else {
          groups.set(groupId, {
            id: groupId,
            label,
            kind,
            activeItems: isCompleted ? [] : [op],
            completedItems: isCompleted ? [op] : [],
            queuedItems: [],
            cancelable: Boolean(op.cancelable),
            progress: 0,
            totalBytes: 0,
          });
        }
      });
    uploadQueue.forEach((item) => {
      const existing = groups.get(item.groupId);
      if (existing) {
        existing.queuedItems.push(item);
      } else {
        groups.set(item.groupId, {
          id: item.groupId,
          label: item.groupLabel,
          kind: item.groupKind,
          activeItems: [],
          completedItems: [],
          queuedItems: [item],
          cancelable: false,
          progress: 0,
          totalBytes: 0,
        });
      }
    });
    return Array.from(groups.values()).map((group) => {
      const activeBytes = group.activeItems.reduce(
        (sum, item) => sum + (item.sizeBytes ?? 0),
        0,
      );
      const completedBytes = group.completedItems.reduce(
        (sum, item) => sum + (item.sizeBytes ?? 0),
        0,
      );
      const queuedBytes = group.queuedItems.reduce(
        (sum, item) => sum + item.file.size,
        0,
      );
      const totalBytes = activeBytes + completedBytes + queuedBytes;
      const loadedBytes = group.activeItems.reduce((sum, item) => {
        const size = item.sizeBytes ?? 0;
        const progress = Math.min(100, Math.max(0, item.progress));
        return sum + (size * progress) / 100;
      }, 0);
      const completedLoadedBytes = completedBytes;
      const totalLoadedBytes = loadedBytes + completedLoadedBytes;
      const progress =
        totalBytes > 0 ? Math.round((totalLoadedBytes / totalBytes) * 100) : 0;
      return { ...group, progress, totalBytes };
    });
  }, [operations, uploadQueue]);
  const downloadGroups = useMemo(() => {
    return operations
      .filter((op) => op.kind === "download")
      .map((op) => {
        const items = downloadDetails[op.id] ?? [];
        const counts = items.reduce(
          (acc, item) => {
            acc.total += 1;
            acc[item.status] += 1;
            return acc;
          },
          {
            total: 0,
            queued: 0,
            downloading: 0,
            done: 0,
            failed: 0,
            cancelled: 0,
          } as Record<DownloadDetailStatus | "total", number>,
        );
        return { op, items, counts };
      });
  }, [downloadDetails, operations]);
  const deleteGroups = useMemo(() => {
    return operations
      .filter((op) => op.kind === "delete")
      .map((op) => {
        const items = deleteDetails[op.id] ?? [];
        const counts = items.reduce(
          (acc, item) => {
            acc.total += 1;
            acc[item.status] += 1;
            return acc;
          },
          {
            total: 0,
            queued: 0,
            deleting: 0,
            done: 0,
            failed: 0,
            cancelled: 0,
          } as Record<DeleteDetailStatus | "total", number>,
        );
        return { op, items, counts };
      });
  }, [deleteDetails, operations]);
  const copyGroups = useMemo(() => {
    return operations
      .filter((op) => op.kind === "copy")
      .map((op) => {
        const items = copyDetails[op.id] ?? [];
        const counts = items.reduce(
          (acc, item) => {
            acc.total += 1;
            acc[item.status] += 1;
            return acc;
          },
          {
            total: 0,
            queued: 0,
            copying: 0,
            done: 0,
            failed: 0,
            cancelled: 0,
          } as Record<
            CopyDetailStatus | "total",
            number
          >,
        );
        return { op, items, counts };
      });
  }, [copyDetails, operations]);
  const queuedDownloadCount = useMemo(
    () => downloadGroups.reduce((sum, group) => sum + group.counts.queued, 0),
    [downloadGroups],
  );
  const queuedDeleteCount = useMemo(
    () => deleteGroups.reduce((sum, group) => sum + group.counts.queued, 0),
    [deleteGroups],
  );
  const queuedCopyCount = useMemo(
    () => copyGroups.reduce((sum, group) => sum + group.counts.queued, 0),
    [copyGroups],
  );
  const hasFailedOperations = useMemo(() => {
    if (operations.some((op) => op.completionStatus === "failed")) {
      return true;
    }
    const hasFailedDownloadDetails = Object.values(downloadDetails).some(
      (items) => items.some((item) => item.status === "failed"),
    );
    if (hasFailedDownloadDetails) {
      return true;
    }
    const hasFailedDeleteDetails = Object.values(deleteDetails).some((items) =>
      items.some((item) => item.status === "failed"),
    );
    if (hasFailedDeleteDetails) {
      return true;
    }
    return Object.values(copyDetails).some((items) =>
      items.some((item) => item.status === "failed"),
    );
  }, [operations, downloadDetails, deleteDetails, copyDetails]);
  const failedUploadCount = useMemo(
    () =>
      operations.filter(
        (op) => op.kind === "upload" && op.completionStatus === "failed",
      ).length,
    [operations],
  );
  const failedDownloadCount = useMemo(
    () =>
      downloadGroups.reduce((sum, group) => {
        const failedItems = group.items.filter(
          (item) => item.status === "failed",
        ).length;
        const fallback =
          failedItems === 0 && group.op.completionStatus === "failed" ? 1 : 0;
        return sum + failedItems + fallback;
      }, 0),
    [downloadGroups],
  );
  const failedDeleteCount = useMemo(
    () =>
      deleteGroups.reduce((sum, group) => {
        const failedItems = group.items.filter(
          (item) => item.status === "failed",
        ).length;
        const fallback =
          failedItems === 0 && group.op.completionStatus === "failed" ? 1 : 0;
        return sum + failedItems + fallback;
      }, 0),
    [deleteGroups],
  );
  const failedCopyCount = useMemo(
    () =>
      copyGroups.reduce((sum, group) => {
        const failedItems = group.items.filter(
          (item) => item.status === "failed",
        ).length;
        const fallback =
          failedItems === 0 && group.op.completionStatus === "failed" ? 1 : 0;
        return sum + failedItems + fallback;
      }, 0),
    [copyGroups],
  );
  const failedOtherOperations = useMemo(
    () =>
      operations.filter(
        (op) =>
          op.kind !== "upload" &&
          op.kind !== "download" &&
          op.kind !== "delete" &&
          op.kind !== "copy" &&
          op.completionStatus === "failed",
      ),
    [operations],
  );
  const totalOperationsCount =
    activeOperations.length +
    uploadQueue.length +
    queuedDownloadCount +
    queuedDeleteCount +
    queuedCopyCount;
  const hasPendingOperations = totalOperationsCount > 0;
  const leaveMessage =
    "Operations are in progress (upload, download, copy, delete). Leaving now may interrupt them. Continue?";
  unstable_usePrompt({
    when: hasPendingOperations,
    message: leaveMessage,
  });
  const completedUploadCount = useMemo(
    () =>
      operations.filter(
        (op) =>
          op.kind === "upload" &&
          op.completedAt &&
          op.completionStatus !== "failed",
      ).length,
    [operations],
  );
  const completedDownloadCount = useMemo(
    () =>
      downloadGroups.reduce((sum, group) => {
        const completedItems = group.items.filter(
          (item) => item.status === "done" || item.status === "cancelled",
        ).length;
        const fallback =
          completedItems === 0 &&
          group.op.completedAt &&
          group.op.completionStatus !== "failed"
            ? 1
            : 0;
        return sum + completedItems + fallback;
      }, 0),
    [downloadGroups],
  );
  const completedDeleteCount = useMemo(
    () =>
      deleteGroups.reduce((sum, group) => {
        const completedItems = group.items.filter(
          (item) => item.status === "done" || item.status === "cancelled",
        ).length;
        const fallback =
          completedItems === 0 &&
          group.op.completedAt &&
          group.op.completionStatus !== "failed"
            ? 1
            : 0;
        return sum + completedItems + fallback;
      }, 0),
    [deleteGroups],
  );
  const completedCopyCount = useMemo(
    () =>
      copyGroups.reduce((sum, group) => {
        const completedItems = group.items.filter(
          (item) => item.status === "done" || item.status === "cancelled",
        ).length;
        const fallback =
          completedItems === 0 &&
          group.op.completedAt &&
          group.op.completionStatus !== "failed"
            ? 1
            : 0;
        return sum + completedItems + fallback;
      }, 0),
    [copyGroups],
  );
  const completedOtherOperations = useMemo(
    () =>
      operations.filter(
        (op) =>
          op.kind !== "upload" &&
          op.kind !== "download" &&
          op.kind !== "delete" &&
          op.kind !== "copy" &&
          op.completedAt &&
          op.completionStatus !== "failed",
      ),
    [operations],
  );

  useEffect(() => {
    if (!hasPendingOperations || typeof window === "undefined") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = leaveMessage;
      return leaveMessage;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingOperations, leaveMessage]);
  const failedOperationsCount =
    failedUploadCount +
    failedDownloadCount +
    failedDeleteCount +
    failedCopyCount +
    failedOtherOperations.length;
  const completedOperationsCount =
    completedUploadCount +
    completedDownloadCount +
    completedDeleteCount +
    completedCopyCount +
    completedOtherOperations.length;
  const hasFinishedOperations =
    completedOperationsCount > 0 || failedOperationsCount > 0;
  const filtersAllInactive =
    !showActiveOperations &&
    !showQueuedOperations &&
    !showCompletedOperations &&
    !showFailedOperations;
  const showAllOperations = filtersAllInactive;
  const showActiveFilter = showActiveOperations || showAllOperations;
  const showQueuedFilter = showQueuedOperations || showAllOperations;
  const showCompletedFilter = showCompletedOperations || showAllOperations;
  const showFailedFilter = showFailedOperations || showAllOperations;
  const activeOtherOperations = useMemo(
    () =>
      activeOperations.filter(
        (op) =>
          op.kind !== "upload" &&
          op.kind !== "download" &&
          op.kind !== "delete" &&
          op.kind !== "copy",
      ),
    [activeOperations],
  );
  const visibleOtherOperations = useMemo(() => {
    return [
      ...(showActiveFilter ? activeOtherOperations : []),
      ...(showCompletedFilter ? completedOtherOperations : []),
      ...(showFailedFilter ? failedOtherOperations : []),
    ];
  }, [
    activeOtherOperations,
    completedOtherOperations,
    failedOtherOperations,
    showActiveFilter,
    showCompletedFilter,
    showFailedFilter,
  ]);
  const visibleUploadGroups = useMemo(() => {
    return uploadGroups.filter((group) => {
      const hasActive = group.activeItems.length > 0;
      const hasQueued = group.queuedItems.length > 0;
      const hasCompleted = group.completedItems.some(
        (item) => item.completionStatus !== "failed",
      );
      const hasFailed = group.completedItems.some(
        (item) => item.completionStatus === "failed",
      );
      return (
        (showActiveFilter && hasActive) ||
        (showQueuedFilter && hasQueued) ||
        (showCompletedFilter && hasCompleted) ||
        (showFailedFilter && hasFailed)
      );
    });
  }, [
    uploadGroups,
    showActiveFilter,
    showCompletedFilter,
    showFailedFilter,
    showQueuedFilter,
  ]);
  const visibleDownloadGroups = useMemo(() => {
    return downloadGroups.filter((group) => {
      const hasActive =
        !group.op.completedAt &&
        (group.op.status === "downloading" ||
          group.items.some((item) => item.status === "downloading"));
      const hasQueued = group.items.some((item) => item.status === "queued");
      const hasCompleted = group.items.some(
        (item) => item.status === "done" || item.status === "cancelled",
      );
      const hasFailed =
        group.items.some((item) => item.status === "failed") ||
        group.op.completionStatus === "failed";
      return (
        (showActiveFilter && hasActive) ||
        (showQueuedFilter && hasQueued) ||
        (showCompletedFilter && hasCompleted) ||
        (showCompletedFilter &&
          Boolean(group.op.completedAt) &&
          group.op.completionStatus !== "failed") ||
        (showFailedFilter && hasFailed)
      );
    });
  }, [
    downloadGroups,
    showActiveFilter,
    showCompletedFilter,
    showFailedFilter,
    showQueuedFilter,
  ]);
  const visibleDeleteGroups = useMemo(() => {
    return deleteGroups.filter((group) => {
      const hasActive =
        !group.op.completedAt &&
        (group.op.status === "deleting" ||
          group.items.some((item) => item.status === "deleting"));
      const hasQueued = group.items.some((item) => item.status === "queued");
      const hasCompleted = group.items.some(
        (item) => item.status === "done" || item.status === "cancelled",
      );
      const hasFailed =
        group.items.some((item) => item.status === "failed") ||
        group.op.completionStatus === "failed";
      return (
        (showActiveFilter && hasActive) ||
        (showQueuedFilter && hasQueued) ||
        (showCompletedFilter && hasCompleted) ||
        (showCompletedFilter &&
          Boolean(group.op.completedAt) &&
          group.op.completionStatus !== "failed") ||
        (showFailedFilter && hasFailed)
      );
    });
  }, [
    deleteGroups,
    showActiveFilter,
    showCompletedFilter,
    showFailedFilter,
    showQueuedFilter,
  ]);
  const visibleCopyGroups = useMemo(() => {
    return copyGroups.filter((group) => {
      const hasActive =
        !group.op.completedAt &&
        (group.op.status === "copying" ||
          group.items.some((item) => item.status === "copying"));
      const hasQueued = group.items.some((item) => item.status === "queued");
      const hasCompleted = group.items.some(
        (item) => item.status === "done" || item.status === "cancelled",
      );
      const hasFailed =
        group.items.some((item) => item.status === "failed") ||
        group.op.completionStatus === "failed";
      return (
        (showActiveFilter && hasActive) ||
        (showQueuedFilter && hasQueued) ||
        (showCompletedFilter && hasCompleted) ||
        (showCompletedFilter &&
          Boolean(group.op.completedAt) &&
          group.op.completionStatus !== "failed") ||
        (showFailedFilter && hasFailed)
      );
    });
  }, [
    copyGroups,
    showActiveFilter,
    showCompletedFilter,
    showFailedFilter,
    showQueuedFilter,
  ]);
  const operationSortIndexById = useMemo(() => {
    const next: Record<string, number> = {};
    operations.forEach((op, index) => {
      next[op.id] = operations.length - index;
    });
    return next;
  }, [operations]);
  const uploadQueueOrderByGroup = useMemo(() => {
    const next: Record<string, number> = {};
    uploadQueue.forEach((item, index) => {
      if (next[item.groupId] == null) {
        next[item.groupId] = uploadQueue.length - index;
      }
    });
    return next;
  }, [uploadQueue]);
  const uploadGroupSortIndexById = useMemo(() => {
    const next: Record<string, number> = {};
    uploadGroups.forEach((group) => {
      const opIndices = [...group.activeItems, ...group.completedItems]
        .map((item) => operationSortIndexById[item.id])
        .filter((value): value is number => typeof value === "number");
      if (opIndices.length > 0) {
        next[group.id] = Math.max(...opIndices);
        return;
      }
      next[group.id] = uploadQueueOrderByGroup[group.id] ?? 0;
    });
    return next;
  }, [
    uploadGroups,
    operationSortIndexById,
    uploadQueueOrderByGroup,
  ]);
  const operationSortFallback = operations.length + uploadQueue.length + 1000;
  const isGroupExpanded = (groupId: string) =>
    Boolean(expandedOperationGroups[groupId]);
  const toggleGroupExpanded = (groupId: string) => {
    setExpandedOperationGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };
  const toggleOperationFilter = (
    filter: "active" | "queued" | "completed" | "failed",
  ) => {
    setShowActiveOperations((prev) => (filter === "active" ? !prev : false));
    setShowQueuedOperations((prev) => (filter === "queued" ? !prev : false));
    setShowCompletedOperations((prev) =>
      filter === "completed" ? !prev : false,
    );
    setShowFailedOperations((prev) => (filter === "failed" ? !prev : false));
  };
  const getSectionVisibleCount = (
    groupId: string,
    section: "queued" | "completed" | "failed",
  ) =>
    queuedVisibleCountByGroup[`${groupId}:${section}`] ??
    DEFAULT_QUEUED_VISIBLE_COUNT;
  const showMoreSection = (
    groupId: string,
    section: "queued" | "completed" | "failed",
  ) => {
    setQueuedVisibleCountByGroup((prev) => ({
      ...prev,
      [`${groupId}:${section}`]:
        getSectionVisibleCount(groupId, section) + DEFAULT_QUEUED_VISIBLE_COUNT,
    }));
  };
  const sanitizeFilename = (value: string) => {
    const cleaned = value
      .replace(/[^a-zA-Z0-9-_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return cleaned || "operation";
  };
  const downloadOperationDetails = (
    kind: OperationDetailsKind,
    operationId: string,
  ) => {
    if (typeof window === "undefined") return;
    const exportedAt = new Date().toISOString();
    const timestamp = exportedAt.replace(/[:.]/g, "-");
    const baseName = sanitizeFilename(`operation-${kind}-${operationId}`);
    const normalizeOperation = (op: OperationItem) => ({
      id: op.id,
      kind: op.kind,
      label: op.label,
      path: op.path,
      status: op.status,
      progress: op.progress,
      completionStatus: op.completionStatus,
      completedAt: op.completedAt,
      errorMessage: op.errorMessage,
    });
    let payload: Record<string, unknown> | null = null;

    if (kind === "download") {
      const group = downloadGroups.find((item) => item.op.id === operationId);
      if (group) {
        payload = {
          exportedAt,
          kind,
          operation: normalizeOperation(group.op),
          counts: group.counts,
          items: group.items.map((item) => ({
            id: item.id,
            key: item.key,
            label: item.label,
            status: item.status,
            sizeBytes: item.sizeBytes,
            errorMessage: item.errorMessage,
          })),
        };
      }
    } else if (kind === "delete") {
      const group = deleteGroups.find((item) => item.op.id === operationId);
      if (group) {
        payload = {
          exportedAt,
          kind,
          operation: normalizeOperation(group.op),
          counts: group.counts,
          items: group.items.map((item) => ({
            id: item.id,
            key: item.key,
            label: item.label,
            status: item.status,
            errorMessage: item.errorMessage,
          })),
        };
      }
    } else if (kind === "copy") {
      const group = copyGroups.find((item) => item.op.id === operationId);
      if (group) {
        payload = {
          exportedAt,
          kind,
          operation: normalizeOperation(group.op),
          counts: group.counts,
          items: group.items.map((item) => ({
            id: item.id,
            key: item.key,
            label: item.label,
            status: item.status,
            sizeBytes: item.sizeBytes,
            errorMessage: item.errorMessage,
          })),
        };
      }
    } else if (kind === "upload") {
      const group = uploadGroups.find((item) => item.id === operationId);
      if (group) {
        const uploadItems: Array<{
          id: string;
          label: string;
          path: string;
          state: "queued" | "uploading" | "done" | "failed" | "cancelled";
          progress: number;
          sizeBytes?: number;
          errorMessage?: string;
          completedAt?: string;
        }> = [
          ...group.activeItems.map((item) => ({
            id: item.id,
            label: item.itemLabel ?? item.path,
            path: item.path,
            state: item.status,
            progress: item.progress,
            sizeBytes: item.sizeBytes,
            errorMessage: item.errorMessage,
            completedAt: item.completedAt,
          })),
          ...group.completedItems.map((item) => ({
            id: item.id,
            label: item.itemLabel ?? item.path,
            path: item.path,
            state: item.completionStatus ?? "done",
            progress: item.progress,
            sizeBytes: item.sizeBytes,
            errorMessage: item.errorMessage,
            completedAt: item.completedAt,
          })),
          ...group.queuedItems.map((item) => ({
            id: item.id,
            label: item.itemLabel ?? item.relativePath ?? item.key,
            path: `${item.bucket}/${item.key}`,
            state: "queued",
            progress: 0,
            sizeBytes: item.file.size,
            errorMessage: undefined,
            completedAt: undefined,
          })),
        ];
        const counts = uploadItems.reduce(
          (acc, item) => {
            acc.total += 1;
            const key = item.state as
              | "queued"
              | "uploading"
              | "done"
              | "failed"
              | "cancelled";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          },
          {
            total: 0,
            queued: 0,
            uploading: 0,
            done: 0,
            failed: 0,
            cancelled: 0,
          },
        );
        payload = {
          exportedAt,
          kind,
          group: {
            id: group.id,
            label: group.label,
            kind: group.kind,
            progress: group.progress,
            totalBytes: group.totalBytes,
          },
          counts,
          items: uploadItems,
        };
      }
    } else if (kind === "other") {
      const op = operations.find((item) => item.id === operationId);
      if (op) {
        payload = {
          exportedAt,
          kind,
          operation: normalizeOperation(op),
        };
      }
    }

    if (!payload) {
      setStatusMessage("No details available for this operation.");
      return;
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };
  const clearFinishedOperations = () => {
    const finishedIds = new Set(
      operations
        .filter(
          (op) =>
            op.completedAt &&
            (!op.completionStatus ||
              op.completionStatus === "done" ||
              op.completionStatus === "failed" ||
              op.completionStatus === "cancelled"),
        )
        .map((op) => op.id),
    );
    if (finishedIds.size === 0 && completedOperations.length === 0) {
      return;
    }
    setOperations((prev) => prev.filter((op) => !finishedIds.has(op.id)));
    if (finishedIds.size > 0) {
      setDownloadDetails((prev) => {
        const next = { ...prev };
        finishedIds.forEach((id) => {
          delete next[id];
        });
        return next;
      });
      setDeleteDetails((prev) => {
        const next = { ...prev };
        finishedIds.forEach((id) => {
          delete next[id];
        });
        return next;
      });
      setCopyDetails((prev) => {
        const next = { ...prev };
        finishedIds.forEach((id) => {
          delete next[id];
        });
        return next;
      });
      setExpandedOperationGroups((prev) => {
        const next = { ...prev };
        finishedIds.forEach((id) => {
          delete next[id];
        });
        return next;
      });
      setQueuedVisibleCountByGroup((prev) => {
        const next: Record<string, number> = {};
        Object.entries(prev).forEach(([key, value]) => {
          const groupId = key.split(":")[0];
          if (!finishedIds.has(groupId)) {
            next[key] = value;
          }
        });
        return next;
      });
    }
    setCompletedOperations([]);
  };
  const openOperationsModal = () => {
    setShowOperationsModal(true);
  };
  const operationsButtonToneClasses = hasFailedOperations
    ? "border-rose-300 bg-rose-100 text-rose-800 shadow-sm dark:border-rose-500/60 dark:bg-rose-500/20 dark:text-rose-100"
    : totalOperationsCount > 0
      ? "border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm dark:border-emerald-500/60 dark:bg-emerald-500/20 dark:text-emerald-100"
      : "";
  const chromeChipButtonClasses = filterChipClasses;
  const chromeToolbarButtonClasses = toolbarButtonClasses;
  const chromeToolbarPrimaryClasses = toolbarPrimaryClasses;
  const chromeToolbarIconButtonClasses = toolbarIconButtonClasses;
  const chromeBulkActionClasses = bulkActionClasses;
  const chromeDangerActionClasses = bulkDangerClasses;
  const operationsCountBadgeClasses = `${countBadgeClasses} ui-caption ${
    hasFailedOperations
      ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-100"
      : ""
  }`;
  const isCreateBucketNameValid =
    !createBucketNameValue || isValidS3BucketName(createBucketNameValue);
  const showFolderToggle = showPanelToggles && canUseFoldersPanel;
  const showInspectorToggle = showPanelToggles && canUseInspectorPanel;
  const isActionBarVisible = isMainBrowserPath && showActionBar;
  const isCompactToolbarMode = !isActionBarVisible;
  const browserViewLabel = compactMode ? "Compact view" : "List view";
  const toolbarStatusTextClassName =
    selectedCount > 0
      ? "ui-caption font-semibold text-primary-700 dark:text-primary-100"
      : "ui-caption font-semibold text-slate-500 dark:text-slate-400";
  const toolbarOverflowStatusRowClasses =
    "flex items-start gap-3 px-1 py-1 ui-caption text-slate-600 dark:text-slate-300";
  const toolbarOverflowSectionTitleClasses =
    "px-1 py-1 ui-caption font-semibold text-slate-500 dark:text-slate-400";
  const toolbarSelectionSummary =
    selectedCount > 0 ? `${selectedCount} selected` : "No selection";
  const toolbarPasteLabel = pathActionStates.paste.label || "Paste";
  const toolbarCanPaste = pathActionStates.paste.enabled;
  const toolbarCanPreview = Boolean(
    toolbarPreviewActionState?.visible &&
      toolbarPreviewActionState.enabled,
  );
  const toolbarCanUploadFiles = pathActionStates.uploadFiles.enabled;
  const toolbarCanUploadFolder = pathActionStates.uploadFolder.enabled;
  const toolbarCanCreateFolder = pathActionStates.newFolder.enabled;
  const toolbarCanDownload =
    selectionActionStates.download.visible &&
    selectionActionStates.download.enabled;
  const toolbarCanOpen =
    selectionActionStates.open.visible && selectionActionStates.open.enabled;
  const toolbarCanCopy =
    selectionActionStates.copy.visible && selectionActionStates.copy.enabled;
  const toolbarCanDelete =
    selectionActionStates.delete.visible &&
    selectionActionStates.delete.enabled;
  const toolbarPathActions = isActionBarVisible
    ? toolbarMorePathActions.filter((action) => action.id !== "paste")
    : toolbarMorePathActions;
  const hasToolbarPathActions =
    !canSelectionActions && toolbarPathActions.length > 0;
  const toolbarSelectionActions = isActionBarVisible
    ? toolbarMoreSelectionOverflowActions
    : toolbarMoreSelectionFullActions;
  const hasToolbarSelectionActions =
    canSelectionActions && toolbarSelectionActions.length > 0;
  const hasToolbarStatusSection = isMainBrowserPath || Boolean(accessBadge);
  const hasToolbarLayoutSection =
    showFolderToggle || showInspectorToggle || showActionBarToggle;
  const hasToolbarColumnsSection = true;
  const hasToolbarBucketConfigurationAction = bucketConfigurationEnabled;
  const hasToolbarSecondaryActionsSection =
    hasToolbarPathActions ||
    hasToolbarBucketConfigurationAction ||
    hasToolbarSelectionActions ||
    showSseControls;
  const hasToolbarMoreMenu =
    hasToolbarStatusSection ||
    hasToolbarLayoutSection ||
    hasToolbarColumnsSection ||
    hasToolbarSecondaryActionsSection;
  const closeToolbarMoreMenu = () => {
    setShowToolbarColumnsMenu(false);
    setShowToolbarMoreMenu(false);
  };
  const closeUploadQuickMenu = () => {
    setShowUploadQuickMenu(false);
  };
  const runToolbarMoreAction = (action: () => void) => {
    closeToolbarMoreMenu();
    action();
  };
  const toggleToolbarMoreMenu = () => {
    setShowUploadQuickMenu(false);
    setShowToolbarColumnsMenu(false);
    setShowToolbarMoreMenu((prev) => !prev);
  };
  const toggleUploadQuickMenu = () => {
    closeToolbarMoreMenu();
    setShowUploadQuickMenu((prev) => !prev);
  };
  const toggleToolbarColumnsMenu = () => {
    setShowToolbarColumnsMenu((prev) => !prev);
  };
  const toolbarColumnsSummary = `${visibleColumns.length}/${COLUMN_DEFINITIONS.length} visible`;
  const handleToolbarDownload = () => {
    if (canSelectionDownloadFolder && selectionPrimary) {
      handleDownloadFolder(selectionPrimary);
      return;
    }
    if (canSelectionDownloadFiles) {
      handleDownloadItems(selectionFiles);
    }
  };
  const handleToolbarOpen = () => {
    if (selectionPrimary && canSelectionOpen) {
      handleOpenItem(selectionPrimary);
    }
  };
  const openQuickUploadFiles = () => {
    closeUploadQuickMenu();
    fileInputRef.current?.click();
  };
  const openQuickUploadFolder = () => {
    closeUploadQuickMenu();
    folderInputRef.current?.click();
  };
  const renderUploadQuickMenu = (placement: "bottom-end" | "bottom-start") => (
    <AnchoredPortalMenu
      open={showUploadQuickMenu}
      anchorRef={uploadQuickButtonRef}
      placement={placement}
      offset={6}
      minWidth={224}
      className={`w-56 ${browserFloatingMenuClasses}`}
    >
      <div
        ref={uploadQuickMenuRef}
        role="menu"
        aria-label="Upload"
        className="max-h-[min(70vh,20rem)] overflow-y-auto"
      >
        <button
          type="button"
          role="menuitem"
          className={`${contextMenuItemClasses} ${!toolbarCanUploadFiles ? contextMenuItemDisabledClasses : ""}`}
          onClick={openQuickUploadFiles}
          disabled={!toolbarCanUploadFiles}
        >
          <UploadIcon className="h-3.5 w-3.5" />
          Upload files
        </button>
        <button
          type="button"
          role="menuitem"
          className={`${contextMenuItemClasses} ${!toolbarCanUploadFolder ? contextMenuItemDisabledClasses : ""}`}
          onClick={openQuickUploadFolder}
          disabled={!toolbarCanUploadFolder}
        >
          <FolderIcon className="h-3.5 w-3.5" />
          Upload folder
        </button>
      </div>
    </AnchoredPortalMenu>
  );
  const browserActionIconById: Partial<
    Record<BrowserActionState["id"], ReactNode>
  > = {
    uploadFiles: <UploadIcon className="h-3.5 w-3.5" />,
    uploadFolder: <FolderIcon className="h-3.5 w-3.5" />,
    newFolder: <FolderPlusIcon className="h-3.5 w-3.5" />,
    paste: <PasteIcon className="h-3.5 w-3.5" />,
    versions: <ListIcon className="h-3.5 w-3.5" />,
    restoreToDate: <HistoryIcon className="h-3.5 w-3.5" />,
    cleanOldVersions: <TrashIcon className="h-3.5 w-3.5" />,
    copyPath: <CopyIcon className="h-3.5 w-3.5" />,
    details: <InfoIcon className="h-3.5 w-3.5" />,
    open: <OpenIcon className="h-3.5 w-3.5" />,
    preview: <EyeIcon className="h-3.5 w-3.5" />,
    download: <DownloadIcon className="h-3.5 w-3.5" />,
    copyUrl: <LinkIcon className="h-3.5 w-3.5" />,
    copy: <CopyIcon className="h-3.5 w-3.5" />,
    cut: <CutIcon className="h-3.5 w-3.5" />,
    bulkAttributes: <SlidersIcon className="h-3.5 w-3.5" />,
    advanced: <SettingsIcon className="h-3.5 w-3.5" />,
    delete: <TrashIcon className="h-3.5 w-3.5" />,
  };
  const renderToolbarMoreActionButton = (
    action: BrowserActionState,
    onClick: () => void,
  ) => (
    <button
      key={action.id}
      type="button"
      role="menuitem"
      className={`${contextMenuItemClasses} ${!action.enabled ? contextMenuItemDisabledClasses : ""}`}
      onClick={() => {
        runToolbarMoreAction(onClick);
      }}
      disabled={!action.enabled}
      title={action.disabledReason}
    >
      {browserActionIconById[action.id]}
      {action.label}
    </button>
  );
  const renderInspectorActionButton = (
    action: BrowserActionState,
    onClick: () => void,
    options?: { danger?: boolean },
  ) => (
    <button
      key={action.id}
      type="button"
      className={
        options?.danger ? chromeDangerActionClasses : chromeBulkActionClasses
      }
      onClick={onClick}
      disabled={!action.enabled}
      title={action.disabledReason}
    >
      {browserActionIconById[action.id]}
      {action.label}
    </button>
  );

  useEffect(() => {
    if (!hasToolbarMoreMenu && showToolbarMoreMenu) {
      setShowToolbarMoreMenu(false);
    }
  }, [hasToolbarMoreMenu, showToolbarMoreMenu]);

  useEffect(() => {
    if (showToolbarMoreMenu) return;
    setShowToolbarColumnsMenu(false);
  }, [showToolbarMoreMenu]);

  const renderLazyCellValue = (
    status: LazyFieldStatus,
    value: string | number | null,
  ) => {
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
  };

  const formatExpiresCellValue = (value: string | null) => {
    if (!value) return null;
    return formatDateTime(value);
  };

  const formatRestoreStatusCellValue = (value: string | null) => {
    if (!value) return null;
    const prefixLabel = "Restored until ";
    if (!value.startsWith(prefixLabel)) {
      return value;
    }
    const rawDate = value.slice(prefixLabel.length).trim();
    if (!rawDate) return "Restored";
    return `${prefixLabel}${formatDateTime(rawDate)}`;
  };

  const renderColumnCellValue = (
    item: BrowserItem,
    columnId: BrowserColumnId,
  ) => {
    if (columnId === "type") {
      if (item.type === "folder") {
        return item.isDeleted ? "Deleted folder" : "Folder";
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
    const lazyEntry = lazyColumnCache[item.id] ?? createLazyColumnCacheEntry();
    if (columnId === "contentType") {
      return renderLazyCellValue(
        lazyEntry.metadataStatus,
        lazyEntry.contentType,
      );
    }
    if (columnId === "tagsCount") {
      return renderLazyCellValue(lazyEntry.tagsStatus, lazyEntry.tagsCount);
    }
    if (columnId === "metadataCount") {
      return renderLazyCellValue(
        lazyEntry.metadataStatus,
        lazyEntry.metadataCount,
      );
    }
    if (columnId === "cacheControl") {
      return renderLazyCellValue(
        lazyEntry.metadataStatus,
        lazyEntry.cacheControl,
      );
    }
    if (columnId === "expires") {
      return renderLazyCellValue(
        lazyEntry.metadataStatus,
        formatExpiresCellValue(lazyEntry.expires),
      );
    }
    if (columnId === "restoreStatus") {
      return renderLazyCellValue(
        lazyEntry.metadataStatus,
        formatRestoreStatusCellValue(lazyEntry.restoreStatus),
      );
    }
    return "—";
  };

  const renderColumnHeaderContent = (column: ColumnDefinition) => {
    if (!column.sortable) {
      return <span className="inline-flex h-6 items-center">{column.label}</span>;
    }
    const active = sortKey === column.sortable;
    return (
      <button
        type="button"
        onClick={() => handleSortToggle(column.sortable)}
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
  };

  const renderColumnResizeHandle = (
    columnId: BrowserResizableColumnId,
    label: string,
  ) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      title={`Resize ${label} column`}
      className="absolute inset-y-0 right-0 z-10 translate-x-1/2 cursor-col-resize touch-none select-none"
      style={{ width: `${COLUMN_RESIZER_HITBOX_WIDTH_PX}px` }}
      onPointerDown={startColumnResize(columnId)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        resetColumnWidth(columnId);
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
          activeColumnResize?.columnId === columnId
            ? "bg-primary dark:bg-primary-300"
            : "hover:bg-slate-300 dark:hover:bg-slate-500"
        }`}
      />
    </div>
  );

  const renderNameHeaderContent = () => (
    <div className="flex min-w-0 items-center gap-2 pr-3">
      <button
        type="button"
        onClick={() => handleSortToggle("name")}
        className="group inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100"
      >
        <span>Name</span>
        <ChevronDownIcon
          className={`h-3 w-3 transition ${
            sortKey === "name" ? "opacity-100" : "opacity-30"
          } ${sortKey === "name" && sortDirection === "asc" ? "-rotate-180" : ""}`}
        />
      </button>
      <div
        ref={searchOptionsMenuRef}
        className="relative w-48 min-w-0 flex-1 sm:w-56 md:w-64 normal-case"
      >
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <SearchIcon className="h-3 w-3" />
        </span>
        <input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search objects"
          aria-label="Search objects"
          className={`${browserSearchInputClasses} pl-9 pr-9 normal-case`}
        />
        <button
          ref={searchOptionsButtonRef}
          type="button"
          onClick={() => setShowSearchOptionsMenu((prev) => !prev)}
          className={`absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
            hasAdvancedSearchOptionsActive
              ? "text-primary-700 hover:bg-primary-100 dark:text-primary-200 dark:hover:bg-primary-500/20"
              : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          }`}
          aria-haspopup="menu"
          aria-expanded={showSearchOptionsMenu}
          aria-label="Search options"
          title="Search options"
        >
          <SlidersIcon className="h-3 w-3" />
        </button>
        <AnchoredPortalMenu
          open={showSearchOptionsMenu}
          anchorRef={searchOptionsButtonRef}
          placement="bottom-end"
          offset={8}
          minWidth={288}
          className={`w-72 ${browserFloatingMenuClasses}`}
        >
          <div ref={searchOptionsMenuRef} className="space-y-3">
            <label className="block space-y-1">
              <span className={browserSearchLabelClasses}>Scope</span>
              <select
                value={searchScope}
                onChange={(event) => {
                  const scope = event.target.value as SearchScope;
                  setSearchScope(scope);
                  if (scope === "bucket") {
                    setSearchRecursive(false);
                  }
                }}
                className={browserSelectClasses}
                aria-label="Search scope"
                disabled={!hasSearchQuery}
              >
                <option value="prefix">Current path</option>
                <option value="bucket">Whole bucket</option>
              </select>
            </label>
            <label className={browserOptionCardClasses}>
              <input
                type="checkbox"
                checked={searchRecursive}
                onChange={(event) => setSearchRecursive(event.target.checked)}
                disabled={!hasSearchQuery || searchScope === "bucket"}
                className={uiCheckboxClass}
                aria-label="Search recursively in subfolders"
              />
              <span>Recursive</span>
            </label>
            <label className={browserOptionCardClasses}>
              <input
                type="checkbox"
                checked={searchExactMatch}
                onChange={(event) => setSearchExactMatch(event.target.checked)}
                disabled={!hasSearchQuery}
                className={uiCheckboxClass}
                aria-label="Use exact match"
              />
              <span>Exact match</span>
            </label>
            <label className={browserOptionCardClasses}>
              <input
                type="checkbox"
                checked={searchCaseSensitive}
                onChange={(event) =>
                  setSearchCaseSensitive(event.target.checked)
                }
                disabled={!hasSearchQuery}
                className={uiCheckboxClass}
                aria-label="Case-sensitive search"
              />
              <span>Case-sensitive</span>
            </label>
            <label className="block space-y-1">
              <span className={browserSearchLabelClasses}>Type</span>
              <select
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(
                    event.target.value as "all" | "file" | "folder",
                  )
                }
                className={browserSelectClasses}
                aria-label="Object type filter"
              >
                <option value="all">All</option>
                <option value="file">Files</option>
                <option value="folder">Folders</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className={browserSearchLabelClasses}>Storage class</span>
              <select
                value={storageFilter}
                onChange={(event) => setStorageFilter(event.target.value)}
                className={browserSelectClasses}
                aria-label="Storage class filter"
              >
                <option value="all">All classes</option>
                {searchableStorageClasses.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setFilter("");
                  setSearchScope("prefix");
                  setSearchRecursive(false);
                  setSearchExactMatch(false);
                  setSearchCaseSensitive(false);
                  setTypeFilter("all");
                  setStorageFilter("all");
                }}
                className={chromeChipButtonClasses}
                disabled={!canResetSearchFilters}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setShowSearchOptionsMenu(false)}
                className={chromeChipButtonClasses}
              >
                Close
              </button>
            </div>
          </div>
        </AnchoredPortalMenu>
      </div>
    </div>
  );

  const renderToolbarColumnsSubmenu = () => (
    <AnchoredPortalMenu
      open={showToolbarColumnsMenu}
      anchorRef={toolbarColumnsButtonRef}
      placement="bottom-end"
      offset={6}
      minWidth={256}
      className={`w-72 ${browserFloatingMenuClasses}`}
    >
      <div
        ref={toolbarColumnsMenuRef}
        role="menu"
        aria-label="Columns"
        className="max-h-[min(70vh,24rem)] overflow-y-auto"
      >
        <div className="px-3 pb-2 pt-2">
          <p className="ui-caption font-semibold text-slate-700 dark:text-slate-100">
            Object columns
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Only base listing columns can be sorted.
          </p>
        </div>
        <div className={contextMenuSeparatorClasses} />
        {COLUMN_DEFINITIONS.map((column) => {
          const checked = visibleColumnSet.has(column.id);
          return (
            <button
              key={column.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              className={contextMenuItemClasses}
              onClick={() => handleToggleVisibleColumn(column.id)}
            >
              <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[11px] font-bold">
                {checked ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1">{column.label}</span>
            </button>
          );
        })}
        <div className={contextMenuSeparatorClasses} />
        <button
          type="button"
          role="menuitem"
          className={contextMenuItemClasses}
          onClick={handleResetVisibleColumns}
        >
          <SlidersIcon className="h-3.5 w-3.5" />
          Reset columns
        </button>
      </div>
    </AnchoredPortalMenu>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className={browserShellClasses}>
        <div className="relative z-20 border-b border-slate-200/80 px-3 py-3 dark:border-slate-800">
          <div className="flex flex-col gap-2.5">
            <div
              role="toolbar"
              aria-label="Browser context bar"
              className={browserToolbarShellClasses}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-stretch lg:items-center">
                <div
                  ref={bucketMenuRef}
                  className="relative flex shrink-0 items-stretch"
                >
                  <button
                    type="button"
                    className={`${bucketButtonClassName} min-h-9`}
                    onClick={() => setShowBucketMenu((prev) => !prev)}
                    disabled={!hasS3AccountContext}
                    aria-haspopup="listbox"
                    aria-expanded={showBucketMenu}
                    aria-label="Select bucket"
                    title="Select bucket"
                  >
                    <BucketIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />
                    <span className="max-w-[200px] truncate sm:max-w-[260px]">
                      {bucketButtonLabel}
                    </span>
                    <ChevronDownIcon className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                  {showBucketMenu && (
                    <div
                      className={`absolute left-0 top-[calc(100%+8px)] z-[60] w-80 max-w-[calc(100vw-1rem)] ui-caption ${browserFloatingMenuClasses}`}
                    >
                      <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="min-w-0">
                            <p className={browserSectionEyebrowClasses}>
                              Buckets
                            </p>
                          </div>
                        </div>
                        {bucketManagementEnabled && (
                          <button
                            type="button"
                            onClick={openCreateBucketDialog}
                            disabled={!hasS3AccountContext}
                            className={chromeChipButtonClasses}
                            title="Create bucket"
                            aria-label="Create bucket"
                          >
                            + Bucket
                          </button>
                        )}
                      </div>
                      <div className="px-2 pb-2">
                        <div className="relative">
                          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                          <input
                            ref={bucketMenuFilterRef}
                            type="text"
                            value={bucketFilter}
                            onChange={(event) =>
                              setBucketFilter(event.target.value)
                            }
                            placeholder="Filter buckets"
                            className={`${browserInputClasses} pl-9`}
                            spellCheck={false}
                          />
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto px-1 pb-1">
                        {loadingBuckets && bucketOptions.length === 0 ? (
                          <div className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">
                            Loading buckets...
                          </div>
                        ) : bucketTotalCount === 0 ? (
                          <div className="space-y-2 px-2 py-2">
                            <div className="ui-caption text-slate-500 dark:text-slate-400">
                              {bucketError
                                ? "Unable to load buckets."
                                : "No buckets available."}
                            </div>
                            <button
                              type="button"
                              className={chromeChipButtonClasses}
                              onClick={() => void refreshBucketList()}
                              disabled={loadingBuckets || !hasS3AccountContext}
                            >
                              {loadingBuckets ? "Retrying..." : "Retry"}
                            </button>
                          </div>
                        ) : bucketOptions.length === 0 ? (
                          <div className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">
                            No buckets match this filter.
                          </div>
                        ) : (
                          bucketOptions.map((bucket) => {
                            const isActive = bucket === bucketName;
                            return (
                              <button
                                key={bucket}
                                type="button"
                                onClick={() => handleBucketChange(bucket)}
                                className={`flex w-full min-w-0 items-center justify-between rounded-md border px-3 py-2 text-left font-semibold transition ${
                                  isActive
                                    ? "border-primary-200 bg-primary-50 text-primary-800 shadow-sm dark:border-primary-500/40 dark:bg-primary-500/20 dark:text-primary-100"
                                    : "border-transparent text-slate-700 hover:border-primary-200 hover:bg-slate-50 dark:text-slate-200 dark:hover:border-primary-500/40 dark:hover:bg-slate-800"
                                }`}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <BucketIcon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{bucket}</span>
                                </span>
                                {isActive && (
                                  <span className="ui-caption font-semibold text-primary-600 dark:text-primary-200">
                                    Active
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                      {!loadingBuckets && bucketTotalCount > 0 && (
                        <div className="border-t border-slate-200 px-2.5 py-2 ui-caption text-slate-400 dark:border-slate-700 dark:text-slate-500">
                          {`${bucketOptions.length} of ${bucketMenuTotal} bucket${bucketMenuTotal === 1 ? "" : "s"}`}
                        </div>
                      )}
                      {canLoadMoreBucketResults && (
                        <div className="border-t border-slate-200 px-2.5 py-2 dark:border-slate-700">
                          <button
                            type="button"
                            onClick={handleBucketMenuLoadMore}
                            disabled={bucketMenuLoadingMore}
                            className={chromeChipButtonClasses}
                          >
                            {bucketMenuLoadingMore ? "Loading..." : "Load more"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div
                  className={`${browserToolbarPathStripClasses} ui-caption font-semibold text-slate-500 dark:text-slate-400`}
                  onClick={isEditingPath ? undefined : startEditingPath}
                  onDoubleClick={isEditingPath ? undefined : startEditingPath}
                >
                  {isEditingPath ? (
                    <div className="relative min-w-0 flex-1">
                      <input
                        ref={pathInputRef}
                        type="text"
                        value={pathDraft}
                        onChange={(event) => setPathDraft(event.target.value)}
                        onBlur={commitPathDraft}
                        onKeyDown={handlePathKeyDown}
                        placeholder="root"
                        aria-label="Path"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-controls="browser-path-suggestion-list"
                        aria-expanded={
                          pathSuggestions.length > 0 || pathSuggestionsLoading
                        }
                        aria-activedescendant={
                          activePathSuggestion
                            ? `browser-path-suggestion-${pathSuggestionIndex}`
                            : undefined
                        }
                        className={`${browserInputClasses} min-w-0`}
                        disabled={!bucketName}
                        spellCheck={false}
                      />
                      {(pathSuggestions.length > 0 ||
                        pathSuggestionsLoading) && (
                        <div
                          id="browser-path-suggestion-list"
                          role="listbox"
                          className={`absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden py-1 ui-caption ${browserFloatingMenuClasses}`}
                        >
                          {pathSuggestions.length === 0 ? (
                            <div className="px-2 py-1.5 text-slate-500 dark:text-slate-300">
                              Searching folders...
                            </div>
                          ) : (
                            <div className="max-h-56 overflow-y-auto">
                              {pathSuggestions.map((suggestion, idx) => {
                                const isActive = idx === pathSuggestionIndex;
                                const suggestionId = `browser-path-suggestion-${idx}`;
                                const sourceBadge =
                                  suggestion.source === "history"
                                    ? "Recent"
                                    : suggestion.source === "local"
                                      ? "Visible"
                                      : null;
                                return (
                                  <button
                                    id={suggestionId}
                                    key={`${suggestion.source}-${suggestion.value}`}
                                    type="button"
                                    role="option"
                                    aria-selected={isActive}
                                    onMouseEnter={() =>
                                      setPathSuggestionIndex(idx)
                                    }
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      applyPathSuggestion(suggestion, {
                                        commit: true,
                                      });
                                    }}
                                    className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                                      isActive
                                        ? "bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                                        : "text-slate-700 hover:bg-primary-50/70 dark:text-slate-200 dark:hover:bg-slate-800"
                                    }`}
                                  >
                                    <span className="min-w-0 flex-1">
                                      <span
                                        className="block truncate font-semibold"
                                        title={suggestion.label}
                                      >
                                        {suggestion.label}
                                      </span>
                                      <span
                                        className="mt-0.5 block break-all text-[11px] font-medium leading-tight text-slate-400 dark:text-slate-500"
                                        title={suggestion.value}
                                      >
                                        {suggestion.value}
                                      </span>
                                    </span>
                                    {sourceBadge && (
                                      <span className="ml-2 shrink-0 self-start rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                        {sourceBadge}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {pathSuggestionsLoading &&
                            pathSuggestions.length > 0 && (
                              <div className="border-t border-slate-200 px-2 py-1 text-slate-400 dark:border-slate-700 dark:text-slate-500">
                                Searching more folders...
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleGoUp();
                        }}
                        className={breadcrumbIconButtonClasses}
                        disabled={!canGoUp}
                        aria-label="Parent folder"
                        title="Parent folder"
                      >
                        <UpIcon className="h-3.5 w-3.5" />
                      </button>
                      <div className="min-w-0 flex flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap py-0.5">
                        {breadcrumbs.length === 0 ? (
                          <span className="shrink-0 text-slate-400">
                            (root)
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSelectPrefix("");
                            }}
                            className="shrink-0 rounded-md px-1.5 py-0.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                            title="root"
                          >
                            root
                          </button>
                        )}
                        {breadcrumbs.map((crumb) => (
                          <span
                            key={crumb.prefix}
                            className="flex shrink-0 items-center gap-1"
                          >
                            <span className="text-slate-300">/</span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleSelectPrefix(crumb.prefix);
                              }}
                              className="max-w-[220px] truncate rounded-md px-1.5 py-0.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 sm:max-w-[320px] md:max-w-[420px]"
                              title={crumb.prefix}
                            >
                              {crumb.label}
                            </button>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={openOperationsModal}
                  className={`${chromeChipButtonClasses} min-h-8 ${operationsButtonToneClasses}`}
                  aria-label="Operations"
                  title="Operations"
                >
                  Operations
                  <span className={operationsCountBadgeClasses}>
                    {formatBadgeCount(totalOperationsCount)}
                  </span>
                </button>
                {isCompactToolbarMode && (
                  <div className={browserToolbarControlsGroupClasses}>
                    <button
                      ref={uploadQuickButtonRef}
                      type="button"
                      className={chromeToolbarIconButtonClasses}
                      onClick={toggleUploadQuickMenu}
                      disabled={
                        !toolbarCanUploadFiles && !toolbarCanUploadFolder
                      }
                      aria-haspopup={
                        toolbarCanUploadFiles || toolbarCanUploadFolder
                          ? "menu"
                          : undefined
                      }
                      aria-expanded={
                        toolbarCanUploadFiles || toolbarCanUploadFolder
                          ? showUploadQuickMenu
                          : undefined
                      }
                      aria-label="Upload"
                      title="Upload"
                    >
                      <UploadIcon className="h-3.5 w-3.5" />
                    </button>
                    {renderUploadQuickMenu("bottom-end")}
                    <button
                      type="button"
                      className={chromeToolbarIconButtonClasses}
                      onClick={handleNewFolder}
                      disabled={!toolbarCanCreateFolder}
                      aria-label="New folder"
                      title="New folder"
                    >
                      <FolderPlusIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className={chromeToolbarIconButtonClasses}
                      onClick={handleRefresh}
                      disabled={!bucketName || objectsLoading}
                      aria-label="Refresh"
                      title="Refresh"
                    >
                      <RefreshIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      ref={toolbarMoreButtonRef}
                      type="button"
                      className={chromeToolbarIconButtonClasses}
                      onClick={toggleToolbarMoreMenu}
                      disabled={!hasToolbarMoreMenu}
                      aria-haspopup={hasToolbarMoreMenu ? "menu" : undefined}
                      aria-expanded={
                        hasToolbarMoreMenu ? showToolbarMoreMenu : undefined
                      }
                      aria-label="More"
                      title="More"
                    >
                      <MoreIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
            {isActionBarVisible && (
              <div
                role="toolbar"
                aria-label="Browser actions bar"
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex items-center">
                  <div className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <p className={`${toolbarStatusTextClassName} truncate`}>
                      {toolbarSelectionSummary}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <button
                    type="button"
                    className={chromeToolbarButtonClasses}
                    onClick={handleToolbarOpen}
                    disabled={!toolbarCanOpen}
                  >
                    <OpenIcon className="h-3.5 w-3.5" />
                    Open
                  </button>
                  <button
                    type="button"
                    className={chromeToolbarButtonClasses}
                    onClick={() => {
                      if (selectionPrimary) {
                        handlePreviewItem(selectionPrimary);
                      }
                    }}
                    disabled={!toolbarCanPreview}
                    title="Preview"
                  >
                    <EyeIcon className="h-3.5 w-3.5" />
                    Preview
                  </button>
                  <button
                    type="button"
                    className={chromeToolbarButtonClasses}
                    onClick={handleNewFolder}
                    disabled={!toolbarCanCreateFolder}
                    aria-label="New folder"
                    title="New folder"
                  >
                    <FolderPlusIcon className="h-3.5 w-3.5" />
                    New folder
                  </button>
                  <button
                    type="button"
                    className={chromeToolbarButtonClasses}
                    onClick={() => handleCopyItems(selectionItems)}
                    disabled={!toolbarCanCopy}
                  >
                    <CopyIcon className="h-3.5 w-3.5" />
                    Copy
                  </button>
                  <button
                    type="button"
                    className={chromeToolbarButtonClasses}
                    onClick={() => {
                      void handlePasteItems();
                    }}
                    disabled={!toolbarCanPaste}
                    title={toolbarPasteLabel}
                  >
                    <PasteIcon className="h-3.5 w-3.5" />
                    {toolbarPasteLabel}
                  </button>
                  <button
                    ref={uploadQuickButtonRef}
                    type="button"
                    className={chromeToolbarPrimaryClasses}
                    onClick={toggleUploadQuickMenu}
                    disabled={!toolbarCanUploadFiles && !toolbarCanUploadFolder}
                    aria-haspopup={
                      toolbarCanUploadFiles || toolbarCanUploadFolder
                        ? "menu"
                        : undefined
                    }
                    aria-expanded={
                      toolbarCanUploadFiles || toolbarCanUploadFolder
                        ? showUploadQuickMenu
                        : undefined
                    }
                    aria-label="Upload"
                    title="Upload"
                  >
                    <UploadIcon className="h-3.5 w-3.5" />
                    Upload
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  </button>
                  {renderUploadQuickMenu("bottom-start")}
                  <button
                    type="button"
                    className={chromeToolbarPrimaryClasses}
                    onClick={handleToolbarDownload}
                    disabled={!toolbarCanDownload}
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    Download
                  </button>
                  <button
                    type="button"
                    className={chromeDangerActionClasses}
                    onClick={() => handleDeleteItems(selectionItems)}
                    disabled={!toolbarCanDelete}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Delete
                  </button>
                  <button
                    type="button"
                    className={chromeToolbarButtonClasses}
                    onClick={handleRefresh}
                    disabled={!bucketName || objectsLoading}
                    aria-label="Refresh"
                    title="Refresh"
                  >
                    <RefreshIcon className="h-3.5 w-3.5" />
                    Refresh
                  </button>
                  <button
                    ref={toolbarMoreButtonRef}
                    type="button"
                    className={chromeToolbarButtonClasses}
                    onClick={toggleToolbarMoreMenu}
                    disabled={!hasToolbarMoreMenu}
                    aria-haspopup={hasToolbarMoreMenu ? "menu" : undefined}
                    aria-expanded={
                      hasToolbarMoreMenu ? showToolbarMoreMenu : undefined
                    }
                    aria-label="More"
                    title="More"
                  >
                    <MoreIcon className="h-3.5 w-3.5" />
                    More
                  </button>
                </div>
              </div>
            )}
            {hasToolbarMoreMenu && (
              <AnchoredPortalMenu
                open={showToolbarMoreMenu}
                anchorRef={toolbarMoreButtonRef}
                placement="bottom-end"
                offset={6}
                minWidth={288}
                className={`w-80 ${browserFloatingMenuClasses}`}
              >
                <div
                  ref={toolbarMoreMenuRef}
                  role="menu"
                  aria-label="More"
                  className="max-h-[min(70vh,28rem)] overflow-y-auto"
                >
                  {hasToolbarStatusSection && (
                    <>
                      <p className={toolbarOverflowSectionTitleClasses}>
                        Status
                      </p>
                      {accessBadge && (
                        <div
                          className={toolbarOverflowStatusRowClasses}
                          title={accessBadge.title}
                        >
                          <span
                            className={`mt-0.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full border ${accessBadge.indicatorClassName}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-slate-700 dark:text-slate-100">
                                Transfers
                              </p>
                              <UiBadge
                                tone={accessBadge.tone}
                                className="shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] leading-4"
                                title={accessBadge.title}
                              >
                                {accessBadge.label}
                              </UiBadge>
                            </div>
                            <p className="text-slate-500 dark:text-slate-400">
                              {accessBadge.title}
                            </p>
                          </div>
                        </div>
                      )}
                      {isMainBrowserPath && (
                        <div className={toolbarOverflowStatusRowClasses}>
                          <EyeIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-700 dark:text-slate-100">
                              View
                            </p>
                            <p className="text-slate-500 dark:text-slate-400">
                              {browserViewLabel}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {hasToolbarLayoutSection && (
                    <>
                      {hasToolbarStatusSection && (
                        <div className={contextMenuSeparatorClasses} />
                      )}
                      <p className={toolbarOverflowSectionTitleClasses}>
                        Layout
                      </p>
                      {showFolderToggle && (
                        <ToolbarToggleMenuItem
                          label="Folders panel"
                          icon={<FolderIcon className="h-3.5 w-3.5" />}
                          checked={showFolders}
                          onToggle={toggleFoldersPanel}
                        />
                      )}
                      {showInspectorToggle && (
                        <ToolbarToggleMenuItem
                          label="Inspector panel"
                          icon={<InfoIcon className="h-3.5 w-3.5" />}
                          checked={showInspector}
                          onToggle={toggleInspectorPanel}
                        />
                      )}
                      {showActionBarToggle && (
                        <ToolbarToggleMenuItem
                          label="Action bar"
                          icon={<SlidersIcon className="h-3.5 w-3.5" />}
                          checked={showActionBar}
                          onToggle={() => setShowActionBar((prev) => !prev)}
                        />
                      )}
                    </>
                  )}
                  {hasToolbarColumnsSection && (
                    <>
                      {(hasToolbarStatusSection || hasToolbarLayoutSection) && (
                        <div className={contextMenuSeparatorClasses} />
                      )}
                      <p className={toolbarOverflowSectionTitleClasses}>
                        Columns
                      </p>
                      <button
                        ref={toolbarColumnsButtonRef}
                        type="button"
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={showToolbarColumnsMenu}
                        className={contextMenuItemClasses}
                        onClick={toggleToolbarColumnsMenu}
                      >
                        <SlidersIcon className="h-3.5 w-3.5" />
                        <span className="min-w-0 flex-1">
                          <span className="block">Columns</span>
                          <span className="block text-[11px] font-medium leading-tight text-slate-400 dark:text-slate-500">
                            {toolbarColumnsSummary}
                          </span>
                        </span>
                        <ChevronDownIcon
                          className={`h-3.5 w-3.5 shrink-0 transition ${
                            showToolbarColumnsMenu ? "" : "-rotate-90"
                          }`}
                        />
                      </button>
                      {renderToolbarColumnsSubmenu()}
                    </>
                  )}
                  {hasToolbarSecondaryActionsSection && (
                    <>
                      {(hasToolbarStatusSection ||
                        hasToolbarLayoutSection ||
                        hasToolbarColumnsSection) && (
                        <div className={contextMenuSeparatorClasses} />
                      )}
                      {(hasToolbarPathActions ||
                        hasToolbarBucketConfigurationAction) && (
                        <>
                          <p className={toolbarOverflowSectionTitleClasses}>
                            Current path
                          </p>
                          {hasToolbarBucketConfigurationAction && (
                            <button
                              type="button"
                              role="menuitem"
                              className={`${contextMenuItemClasses} ${
                                !bucketName || !hasS3AccountContext
                                  ? contextMenuItemDisabledClasses
                                  : ""
                              }`}
                              onClick={() =>
                                runToolbarMoreAction(() =>
                                  openBucketConfigurationModal(bucketName),
                                )
                              }
                              disabled={!bucketName || !hasS3AccountContext}
                              title={
                                !bucketName
                                  ? "Select a bucket to configure it."
                                  : undefined
                              }
                            >
                              <SettingsIcon className="h-3.5 w-3.5" />
                              Configure bucket
                            </button>
                          )}
                          {hasToolbarPathActions &&
                            toolbarPathActions.map((action) =>
                              renderToolbarMoreActionButton(action, () =>
                                runPathAction(action.id),
                              ),
                            )}
                        </>
                      )}
                      {hasToolbarSelectionActions && (
                        <>
                          {(hasToolbarPathActions ||
                            hasToolbarBucketConfigurationAction) && (
                            <div className={contextMenuSeparatorClasses} />
                          )}
                          <p className={toolbarOverflowSectionTitleClasses}>
                            {isActionBarVisible
                              ? "Selection overflow"
                              : "Selection actions"}
                          </p>
                          {toolbarSelectionActions.map((action) =>
                            renderToolbarMoreActionButton(action, () =>
                              runSelectionAction(action.id),
                            ),
                          )}
                        </>
                      )}
                      {showSseControls && (
                        <>
                          {(hasToolbarPathActions ||
                            hasToolbarBucketConfigurationAction ||
                            hasToolbarSelectionActions) && (
                            <div className={contextMenuSeparatorClasses} />
                          )}
                          <p className={toolbarOverflowSectionTitleClasses}>
                            Security
                          </p>
                          <button
                            type="button"
                            role="menuitem"
                            className={`${contextMenuItemClasses} ${
                              !bucketName ||
                              !hasS3AccountContext ||
                              !sseFeatureEnabled
                                ? contextMenuItemDisabledClasses
                                : ""
                            }`}
                            onClick={() => {
                              runToolbarMoreAction(openSseCustomerModal);
                            }}
                            disabled={
                              !bucketName ||
                              !hasS3AccountContext ||
                              !sseFeatureEnabled
                            }
                            title={
                              sseActive
                                ? "SSE-C enabled for this bucket."
                                : "Configure SSE-C key for this bucket."
                            }
                          >
                            <SettingsIcon className="h-3.5 w-3.5" />
                            <span className="min-w-0 flex-1">
                              <span className="block">SSE-C</span>
                              <span className="block text-[11px] font-medium leading-tight text-slate-400 dark:text-slate-500">
                                {sseActive
                                  ? "Enabled for this bucket"
                                  : "Configure customer key"}
                              </span>
                            </span>
                            <span
                              className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                sseActive
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100"
                                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"
                              }`}
                            >
                              {sseActive ? "On" : "Off"}
                            </span>
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </AnchoredPortalMenu>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFolderInputChange}
            />
          </div>
        </div>

        {(bucketError || statusMessage || warnings.length > 0) && (
          <div className="shrink-0 px-3 pb-0 pt-3">
            <div
              className={`${browserSubtleSurfaceClasses} px-3 py-2.5 ui-caption text-slate-600 dark:text-slate-300`}
            >
              {bucketError && (
                <p className="font-semibold text-rose-600 dark:text-rose-200">
                  {bucketError}
                </p>
              )}
              {statusMessage && (
                <p className="text-slate-500 dark:text-slate-400">
                  {statusMessage}
                </p>
              )}
              {warnings.map((warning, index) => (
                <p
                  key={`${warning}-${index}`}
                  className="font-semibold text-amber-600 dark:text-amber-200"
                >
                  {warning === CORS_DIRECT_TRANSFER_WARNING && hasCorsAction ? (
                    <span className="inline-flex items-center gap-1">
                      <span>{warning}</span>
                      <button
                        ref={corsActionTriggerRef}
                        type="button"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-amber-700 transition hover:text-amber-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 dark:text-amber-200 dark:hover:text-amber-100 dark:focus-visible:outline-amber-200"
                        onClick={() =>
                          setShowCorsActionPopover((prev) => !prev)
                        }
                        aria-label="CORS actions"
                        title="CORS actions"
                        aria-haspopup="dialog"
                        aria-expanded={showCorsActionPopover}
                      >
                        <InfoIcon className="h-3.5 w-3.5" />
                      </button>
                      <AnchoredPortalMenu
                        open={showCorsActionPopover}
                        anchorRef={corsActionTriggerRef}
                        placement="bottom-start"
                        offset={6}
                        minWidth={288}
                        className={`w-80 ${browserFloatingMenuClasses}`}
                      >
                        <div ref={corsActionPopoverRef}>
                          <p className="ui-caption text-slate-600 dark:text-slate-300">
                            {`Allow direct access from ${uiOrigin} by adding CORS rules to this bucket.`}
                          </p>
                          <button
                            type="button"
                            className={`mt-2 ${chromeChipButtonClasses} border-emerald-200 bg-emerald-100 text-emerald-800 hover:border-emerald-300 hover:text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-100 dark:hover:border-emerald-400`}
                            onClick={handleEnsureCors}
                            disabled={corsFixing}
                            title={`Add ${uiOrigin} to bucket CORS rules.`}
                            aria-label={`Add ${uiOrigin} to CORS`}
                          >
                            {corsFixing
                              ? "Adding..."
                              : `Add ${uiOrigin} to CORS`}
                          </button>
                        </div>
                      </AnchoredPortalMenu>
                    </span>
                  ) : (
                    warning
                  )}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden p-3">
          <div
            ref={layoutContainerRef}
            data-testid="browser-layout"
            className="relative grid min-h-0 flex-1 grid-rows-1 gap-3"
            style={{ gridTemplateColumns: layoutTemplateColumns }}
          >
            {isFoldersPanelVisible && (
              <BrowserBucketsPanel
                hasS3AccountContext={hasS3AccountContext}
                currentBucket={currentBucketPanelItem}
                activePrefix={normalizedPrefix}
                currentBucketAccess={currentBucketAccess}
                treeRootNode={treeRootNode}
                bucketFilter={bucketFilter}
                onBucketFilterChange={setBucketFilter}
                otherBuckets={otherBucketPanelRows}
                loadingBuckets={loadingBuckets}
                bucketError={bucketError}
                onRetryBuckets={() => void refreshBucketList()}
                bucketManagementEnabled={bucketManagementEnabled}
                onCreateBucket={openCreateBucketDialog}
                onSelectBucket={handleBucketChange}
                onSelectPrefix={handleSelectPrefix}
                onToggleTreeNode={handleToggleTreeNode}
                canLoadMore={canLoadMoreBucketResults}
                onLoadMore={handleBucketMenuLoadMore}
                bucketMenuLoadingMore={bucketMenuLoadingMore}
                bucketMenuTotal={bucketMenuTotal}
                bucketTotalCount={bucketTotalCount}
                panelViewportRef={bucketPanelViewportRef}
                loadMoreSentinelRef={bucketPanelLoadMoreSentinelRef}
              />
            )}
            <div className="flex min-h-0 h-full min-w-0 flex-1 flex-col gap-3">
              <div
                className={`${browserExplorerShellClasses} ${
                  dragging
                    ? "border-primary/60 bg-primary/5 dark:border-primary-500/60 dark:bg-primary-500/10"
                    : ""
                }`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onContextMenu={handlePathContextMenu}
              >
                {dragging && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/75 text-center ui-body font-semibold text-slate-700 backdrop-blur-sm dark:bg-slate-950/70 dark:text-slate-100">
                    <div className="rounded-xl border border-primary/20 bg-white/90 px-5 py-4 shadow-sm dark:border-primary-500/30 dark:bg-slate-900/85">
                      <div>Drop files or folders to upload</div>
                      <div className="mt-1 ui-caption font-normal text-slate-500 dark:text-slate-400">
                        {bucketName
                          ? `${bucketName}/${normalizedPrefix}`
                          : "Select a bucket first"}
                      </div>
                    </div>
                  </div>
                )}
                {bucketName && hasActiveSearchFilters && (
                  <div className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className={browserSearchLabelClasses}>Search</p>
                        <p className="mt-1 ui-body font-semibold text-slate-900 dark:text-slate-100">
                          {objectsLoading
                            ? "Searching..."
                            : `${listItems.length} result${listItems.length === 1 ? "" : "s"}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {activeSearchStatusChips.map((chip) => (
                          <span
                            key={`${chip.label}:${chip.value}`}
                            className={browserSearchStatusChipClasses}
                            title={`${chip.label}: ${chip.value}`}
                          >
                            <span className="text-slate-400 dark:text-slate-500">
                              {chip.label}
                            </span>
                            <span className="truncate text-slate-700 dark:text-slate-100">
                              {chip.value}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div
                  ref={objectsListViewportRef}
                  className="relative min-h-0 flex-1 overflow-x-auto overflow-y-auto bg-white/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-transparent"
                  onClick={handleListBackgroundClick}
                  onKeyDown={handleListKeyDown}
                  tabIndex={0}
                  aria-label="Objects list"
                >
                  {objectsLoading && listItems.length > 0 && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-white/45 pt-5 ui-caption font-semibold text-slate-600 backdrop-blur-[1px] dark:bg-slate-900/40 dark:text-slate-200">
                      <span className="rounded-md border border-slate-200 bg-white/90 px-3 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                        Refreshing objects...
                      </span>
                    </div>
                  )}
                  <table
                    className="manager-table min-w-full border-separate border-spacing-0 divide-y divide-slate-200 dark:divide-slate-800"
                    style={{ minWidth: `${objectTableMinWidthPx}px` }}
                  >
                    <colgroup>
                      <col style={{ width: `${SELECTION_COLUMN_WIDTH_PX}px` }} />
                      <col style={{ width: `${nameColumnWidthPx}px` }} />
                      {visibleColumnDefinitions.map((column) => (
                        <col
                          key={column.id}
                          style={{
                            width: `${visibleColumnWidthsPx[column.id]}px`,
                          }}
                        />
                      ))}
                      <col style={{ width: `${ACTIONS_COLUMN_WIDTH_PX}px` }} />
                    </colgroup>
                    <thead
                      className="sticky top-0 z-[1] border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
                      onContextMenu={handleHeaderContextMenu}
                    >
                      <tr>
                        <th
                          aria-label="Select all"
                          className={`px-2 ${headerPadding} !align-middle text-left ui-caption font-semibold text-slate-500 dark:text-slate-400`}
                        >
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAllSelection}
                            aria-label="Select all"
                            className={uiCheckboxClass}
                          />
                        </th>
                        <th
                          aria-label="Name"
                          className={`relative px-4 ${headerPadding} !align-middle text-left ui-caption font-semibold text-slate-500 dark:text-slate-400`}
                        >
                          {renderNameHeaderContent()}
                          {renderColumnResizeHandle("name", "Name")}
                        </th>
                        {visibleColumnDefinitions.map((column) => (
                          <th
                            key={column.id}
                            aria-label={column.label}
                            className={`relative px-2 ${headerPadding} !align-middle ${
                              column.align === "right"
                                ? "text-right"
                                : "text-left"
                            } ui-caption font-semibold text-slate-500 dark:text-slate-400`}
                          >
                            <div
                              className={`pr-3 ${
                                column.align === "right" ? "flex justify-end" : ""
                              }`}
                            >
                              {renderColumnHeaderContent(column)}
                            </div>
                            {renderColumnResizeHandle(column.id, column.label)}
                          </th>
                        ))}
                        <th
                          aria-label="Actions"
                          className={`px-2 ${headerPadding} !align-middle text-right ui-caption font-semibold text-slate-500 dark:text-slate-400`}
                        >
                          <span className="inline-flex h-6 items-center">
                            Actions
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                      {canGoUp &&
                        bucketName &&
                        showFolderItems &&
                        !isSearchingInWholeBucket && (
                          <tr
                            className={`${rowHeightClasses} text-slate-600 transition-colors hover:bg-slate-50/70 dark:text-slate-300 dark:hover:bg-slate-800/40`}
                          >
                            <td
                              className={`px-2 ${rowCellClasses} !align-middle`}
                            />
                            <td
                              className={`manager-table-cell min-w-0 px-4 ${rowCellClasses} !align-middle ui-body`}
                              style={{ maxWidth: `${nameColumnWidthPx}px` }}
                            >
                              <button
                                type="button"
                                onClick={handleGoUp}
                                className="flex min-w-0 items-center gap-3 text-left font-semibold text-slate-700 hover:text-primary-700 dark:text-slate-200 dark:hover:text-primary-200"
                              >
                                <span
                                  className={`inline-flex ${iconBoxClasses} items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200`}
                                >
                                  <UpIcon className="h-3.5 w-3.5" />
                                </span>
                                <span className="truncate">Parent folder</span>
                              </button>
                            </td>
                            {visibleColumnDefinitions.map((column) => (
                              <td
                                key={column.id}
                                className={`px-2 ${rowCellClasses} !align-middle ui-body text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis ${
                                  column.align === "right" ? "text-right" : ""
                                }`}
                              >
                                -
                              </td>
                            ))}
                            <td
                              className={`px-2 ${rowCellClasses} !align-middle text-right ui-caption text-slate-400`}
                            />
                          </tr>
                        )}
                      {objectsLoading && listItems.length === 0 && (
                        <TableEmptyState
                          colSpan={objectTableColSpan}
                          message="Loading objects..."
                          className="py-10 text-center"
                        />
                      )}
                      {!objectsLoading && !bucketName && (
                        <TableEmptyState
                          colSpan={objectTableColSpan}
                          message="Select a bucket to browse objects."
                          className="py-10 text-center"
                        />
                      )}
                      {!objectsLoading &&
                        bucketName &&
                        objectsIssue &&
                        listItems.length === 0 && (
                          <TableEmptyState
                            colSpan={objectTableColSpan}
                            title={objectsIssue.title}
                            description={objectsIssueDescription}
                            tone="error"
                            className="py-10 text-center"
                          />
                        )}
                      {!objectsLoading &&
                        bucketName &&
                        !objectsIssue &&
                        listItems.length === 0 && (
                          <TableEmptyState
                            colSpan={objectTableColSpan}
                            message={
                              hasActiveSearchFilters
                                ? "No objects matched this search."
                                : "No objects found for this path."
                            }
                            className="py-10 text-center"
                          />
                        )}
                      {listItems.map((item) => {
                        const isFocused = inspectedItem?.id === item.id;
                        const isSelected = selectedSet.has(item.id);
                        const isActiveRow = activeRowId === item.id;
                        const isDeleted = Boolean(item.isDeleted);
                        const itemActionStates = resolveItemActionStates(item);
                        return (
                          <tr
                            key={item.id}
                            data-browser-item
                            data-lazy-item-id={
                              item.type === "file" && !item.isDeleted
                                ? item.id
                                : undefined
                            }
                            onClick={(event) => {
                              if (isInteractiveTarget(event.target)) {
                                return;
                              }
                              handleItemSelectionClick(event, item.id);
                            }}
                            onDoubleClick={(event) =>
                              handleItemDoubleClick(event, item)
                            }
                            onContextMenu={(event) =>
                              handleItemContextMenu(event, item)
                            }
                            className={`${rowHeightClasses} transition-colors ${
                              isSelected
                                ? "bg-primary-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] hover:bg-primary-100 dark:bg-primary-500/30 dark:hover:bg-primary-500/40"
                                : isActiveRow
                                  ? "bg-sky-50/90 hover:bg-sky-100/80 dark:bg-sky-900/20 dark:hover:bg-sky-900/30"
                                  : isDeleted
                                    ? "bg-rose-50/60 hover:bg-rose-100/70 dark:bg-rose-900/10 dark:hover:bg-rose-900/20"
                                    : isFocused
                                      ? "bg-primary-50/70 hover:bg-primary-50 dark:bg-primary-500/15 dark:hover:bg-primary-500/20"
                                      : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                            }`}
                          >
                            <td
                              className={`px-2 ${rowCellClasses} !align-middle`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelection(item.id)}
                                aria-label={`Select ${item.name}`}
                                className={uiCheckboxClass}
                              />
                            </td>
                            <td
                              className={`manager-table-cell min-w-0 px-4 ${rowCellClasses} !align-middle ui-body ${
                                isDeleted
                                  ? "text-rose-700 dark:text-rose-200"
                                  : "text-slate-700 dark:text-slate-200"
                              }`}
                              style={{ maxWidth: `${nameColumnWidthPx}px` }}
                            >
                              <div
                                className={`flex min-w-0 items-center ${nameGapClasses}`}
                              >
                                <span
                                  className={`inline-flex ${iconBoxClasses} items-center justify-center rounded-md border shadow-sm ${
                                    isDeleted
                                      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/20 dark:text-rose-200"
                                      : item.type === "folder"
                                        ? "border-amber-200 bg-amber-50/90 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
                                        : "border-sky-200 bg-sky-50/90 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200"
                                  }`}
                                >
                                  {item.type === "folder" ? (
                                    <FolderIcon />
                                  ) : isDeleted ? (
                                    <TrashIcon />
                                  ) : (
                                    <FileIcon />
                                  )}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <button
                                    type="button"
                                    onClick={(event) =>
                                      handleItemNameClick(event, item)
                                    }
                                    onDoubleClick={() =>
                                      openItemPrimaryAction(item)
                                    }
                                    className={`flex w-full min-w-0 items-baseline gap-1 text-left font-semibold ${
                                      isDeleted
                                        ? "text-rose-700 hover:text-rose-800 dark:text-rose-200 dark:hover:text-rose-100"
                                        : "text-slate-900 hover:text-primary-700 dark:text-slate-100 dark:hover:text-primary-200"
                                    }`}
                                    title={item.name}
                                  >
                                    <span className="truncate">
                                      {item.name}
                                    </span>
                                    {isDeleted && (
                                      <span className="shrink-0 ui-caption font-semibold text-rose-500 dark:text-rose-300">
                                        (deleted)
                                      </span>
                                    )}
                                  </button>
                                  {!compactMode && (
                                    <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden ui-caption text-slate-500 dark:text-slate-400">
                                      <span className="rounded-md border border-slate-200 px-2 py-0.5 font-semibold dark:border-slate-700">
                                        {item.type === "folder"
                                          ? isDeleted
                                            ? "Deleted folder"
                                            : "Prefix"
                                          : isDeleted
                                            ? "Deleted object"
                                            : "Object"}
                                      </span>
                                      {isDeleted && (
                                        <span className="rounded-md border border-rose-200 px-2 py-0.5 font-semibold text-rose-700 dark:border-rose-500/40 dark:text-rose-200">
                                          {item.type === "folder"
                                            ? "Delete markers"
                                            : "Delete marker"}
                                        </span>
                                      )}
                                      {item.storageClass && (
                                        <span
                                          className={`rounded-md border px-2 py-0.5 font-semibold ${
                                            storageClassChipClasses[
                                              item.storageClass
                                            ] ??
                                            "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                          }`}
                                        >
                                          {item.storageClass}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            {visibleColumnDefinitions.map((column) => (
                              <td
                                key={column.id}
                                className={`px-2 ${rowCellClasses} !align-middle ui-body text-slate-600 dark:text-slate-300 whitespace-nowrap overflow-hidden text-ellipsis ${
                                  column.align === "right" ? "text-right" : ""
                                }`}
                              >
                                {renderColumnCellValue(item, column.id)}
                              </td>
                            ))}
                            <td
                              className={`px-2 ${rowCellClasses} !align-middle text-right`}
                            >
                              <div className="flex flex-nowrap justify-end gap-1.5">
                                {item.type === "folder" && (
                                  <button
                                    type="button"
                                    className={rowActionButtonClasses}
                                    aria-label="Open"
                                    title="Open"
                                    onClick={() => handleOpenItem(item)}
                                    disabled={!itemActionStates.open.enabled}
                                  >
                                    <OpenIcon />
                                  </button>
                                )}
                                {item.type === "file" && !isDeleted && (
                                  <button
                                    type="button"
                                    className={rowActionButtonClasses}
                                    aria-label="Preview"
                                    title="Preview"
                                    onClick={() => handlePreviewItem(item)}
                                    disabled={!itemActionStates.preview.enabled}
                                  >
                                    <EyeIcon />
                                  </button>
                                )}
                                {item.type === "file" &&
                                  isDeleted &&
                                  isVersioningEnabled && (
                                    <button
                                      type="button"
                                      className={rowActionButtonClasses}
                                      aria-label="Versions"
                                      title="Versions"
                                      onClick={() =>
                                        openObjectVersionsModal(item)
                                      }
                                      disabled={
                                        !itemActionStates.versions.enabled
                                      }
                                    >
                                      <HistoryIcon />
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  className={`${rowActionButtonClasses} ${!itemActionStates.download.enabled ? "opacity-50" : ""}`}
                                  aria-label="Download"
                                  title={
                                    !itemActionStates.download.enabled
                                      ? "Restore from versions before download"
                                      : "Download"
                                  }
                                  onClick={() => handleDownloadTarget(item)}
                                  disabled={!itemActionStates.download.enabled}
                                >
                                  <DownloadIcon />
                                </button>
                                <button
                                  type="button"
                                  className={`${rowActionDangerButtonClasses} ${!itemActionStates.delete.enabled ? "opacity-50" : ""}`}
                                  aria-label="Delete"
                                  title={
                                    !itemActionStates.delete.enabled
                                      ? "Delete marker entries are managed in versions."
                                      : "Delete"
                                  }
                                  onClick={() => handleDeleteItems([item])}
                                  disabled={!itemActionStates.delete.enabled}
                                >
                                  <TrashIcon />
                                </button>
                                <button
                                  type="button"
                                  className={rowActionButtonClasses}
                                  aria-label="More actions"
                                  title="More"
                                  onClick={(event) =>
                                    handleItemActionsButtonClick(event, item)
                                  }
                                >
                                  <MoreIcon />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {canLoadMoreObjectResults && (
                  <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-right dark:border-slate-700 dark:bg-slate-900/40">
                    <button
                      type="button"
                      className={chromeToolbarButtonClasses}
                      onClick={handleLoadMoreObjectResults}
                      disabled={objectsLoadingMore}
                    >
                      {objectsLoadingMore ? "Loading..." : "Load more"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isInspectorPanelVisible && (
              <div className="flex min-h-0 h-full flex-col gap-3">
                <div className="ui-surface-card flex min-h-0 h-full flex-1 flex-col rounded-xl bg-gradient-to-r from-white via-white to-slate-50/80 px-3 py-3 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/70">
                  <div
                    className={inspectorTabListClasses}
                    role="tablist"
                    aria-label="Inspector tabs"
                  >
                    <button
                      type="button"
                      role="tab"
                      id="inspector-tab-details"
                      aria-selected={inspectorTab === "details"}
                      aria-controls="inspector-panel-details"
                      onClick={() => setInspectorTab("details")}
                      className={`${inspectorTabBaseClasses} ${
                        inspectorTab === "details"
                          ? inspectorTabActiveClasses
                          : inspectorTabInactiveClasses
                      }`}
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="inspector-tab-context"
                      aria-selected={inspectorTab === "context"}
                      aria-controls="inspector-panel-context"
                      onClick={() => setInspectorTab("context")}
                      className={`${inspectorTabBaseClasses} ${
                        inspectorTab === "context"
                          ? inspectorTabActiveClasses
                          : inspectorTabInactiveClasses
                      }`}
                    >
                      Context
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="inspector-tab-bucket"
                      aria-selected={inspectorTab === "bucket"}
                      aria-controls="inspector-panel-bucket"
                      onClick={handleOpenBucketInspector}
                      className={`${inspectorTabBaseClasses} ${
                        inspectorTab === "bucket"
                          ? inspectorTabActiveClasses
                          : inspectorTabInactiveClasses
                      }`}
                    >
                      Bucket
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="inspector-tab-selection"
                      aria-selected={inspectorTab === "selection"}
                      aria-controls="inspector-panel-selection"
                      onClick={() => setInspectorTab("selection")}
                      className={`${inspectorTabBaseClasses} ${
                        inspectorTab === "selection"
                          ? inspectorTabActiveClasses
                          : inspectorTabInactiveClasses
                      }`}
                    >
                      Selection
                    </button>
                  </div>

                  <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
                    {inspectorTab === "context" && (
                      <div
                        role="tabpanel"
                        id="inspector-panel-context"
                        aria-labelledby="inspector-tab-context"
                        className={inspectorTabPanelClasses}
                      >
                        <div className={inspectorSectionCardClasses}>
                          <p className={inspectorSectionTitleClasses}>
                            Current location
                          </p>
                          <p className="break-all ui-caption text-slate-500 dark:text-slate-400">
                            {currentPath || "Select a bucket to get started."}
                          </p>
                        </div>
                        <div className="space-y-3">
                          <div className={inspectorSectionCardClasses}>
                            <p className={inspectorSectionTitleClasses}>
                              Actions
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {inspectorContextActions.map((action) =>
                                renderInspectorActionButton(action, () =>
                                  runPathAction(action.id),
                                ),
                              )}
                            </div>
                          </div>
                          <div className={inspectorSectionCardClasses}>
                            <p className={inspectorSectionTitleClasses}>
                              Prefix summary
                            </p>
                            <div className="mt-2 grid gap-2">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">Files</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-100">
                                  {pathStats.files}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">Folders</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-100">
                                  {pathStats.folders}
                                </span>
                              </div>
                              {isVersioningEnabled && showDeletedObjects && (
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500">
                                    Deleted shown
                                  </span>
                                  <span className="font-semibold text-rose-700 dark:text-rose-200">
                                    {pathStats.deletedFiles +
                                      pathStats.deletedFolders}
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">
                                  Total size
                                </span>
                                <span className="font-semibold text-slate-700 dark:text-slate-100">
                                  {formatBytes(pathStats.totalBytes)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className={inspectorSectionCardClasses}>
                            <div className="flex items-center justify-between gap-2">
                              <p className={inspectorSectionTitleClasses}>
                                Counts
                              </p>
                              <button
                                type="button"
                                className={chromeBulkActionClasses}
                                onClick={handleContextCount}
                                disabled={
                                  !bucketName ||
                                  !hasS3AccountContext ||
                                  contextCountsLoading
                                }
                              >
                                <RefreshIcon className="h-3.5 w-3.5" />
                                {contextCountsLoading
                                  ? "Counting..."
                                  : contextCounts
                                    ? "Recount"
                                    : "Count"}
                              </button>
                            </div>
                            {contextCountsError && (
                              <p className="mt-2 ui-caption font-semibold text-rose-600 dark:text-rose-200">
                                {contextCountsError}
                              </p>
                            )}
                            {!isVersioningEnabled && (
                              <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                                Versioning is disabled for this bucket.
                              </p>
                            )}
                            <div className="mt-2 grid gap-2">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">
                                  Current objects
                                </span>
                                <span className="font-semibold text-slate-700 dark:text-slate-100">
                                  {contextCountsLoading
                                    ? "..."
                                    : contextCounts
                                      ? contextCounts.objects
                                      : "-"}
                                </span>
                              </div>
                              {isVersioningEnabled && (
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500">
                                      Versions
                                    </span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {contextCountsLoading
                                        ? "..."
                                        : contextCounts
                                          ? contextCounts.versions
                                          : "-"}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500">
                                      Delete markers
                                    </span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {contextCountsLoading
                                        ? "..."
                                        : contextCounts
                                          ? contextCounts.deleteMarkers
                                          : "-"}
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          <div className={inspectorSectionCardClasses}>
                            <p className={inspectorSectionTitleClasses}>
                              Storage classes
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {Object.keys(pathStats.storageCounts).length ===
                              0 ? (
                                <span className="ui-caption text-slate-500 dark:text-slate-400">
                                  No file data yet.
                                </span>
                              ) : (
                                Object.entries(pathStats.storageCounts).map(
                                  ([storage, count]) => (
                                    <span
                                      key={storage}
                                      className={`rounded-full border px-2 py-1 ui-caption font-semibold ${
                                        storageClassChipClasses[storage] ??
                                        "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                      }`}
                                    >
                                      {storage} ({count})
                                    </span>
                                  ),
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {inspectorTab === "bucket" && (
                      <div
                        role="tabpanel"
                        id="inspector-panel-bucket"
                        aria-labelledby="inspector-tab-bucket"
                        className={inspectorTabPanelClasses}
                      >
                        <div className="space-y-3">
                          <div className={inspectorSectionCardClasses}>
                            <p className={inspectorSectionTitleClasses}>
                              Bucket overview
                            </p>
                            <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                              {bucketName || "Select a bucket to inspect."}
                            </p>
                          </div>

                          <div className={inspectorSectionCardClasses}>
                            <p className={inspectorSectionTitleClasses}>
                              Actions
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {bucketConfigurationEnabled && (
                                <button
                                  type="button"
                                  className={chromeBulkActionClasses}
                                  onClick={() =>
                                    openBucketConfigurationModal(bucketName)
                                  }
                                  disabled={!bucketName || !hasS3AccountContext}
                                >
                                  <SettingsIcon className="h-3.5 w-3.5" />
                                  Configure
                                </button>
                              )}
                              <button
                                type="button"
                                className={chromeBulkActionClasses}
                                onClick={openMultipartUploadsModal}
                                disabled={!bucketName || !hasS3AccountContext}
                              >
                                <UploadIcon className="h-3.5 w-3.5" />
                                Multipart uploads
                              </button>
                              <button
                                type="button"
                                className={chromeBulkActionClasses}
                                onClick={() =>
                                  void loadBucketInspectorData(true)
                                }
                                disabled={
                                  !bucketName ||
                                  !hasS3AccountContext ||
                                  bucketInspectorLoading
                                }
                              >
                                <RefreshIcon className="h-3.5 w-3.5" />
                                {bucketInspectorLoading
                                  ? "Loading..."
                                  : "Refresh"}
                              </button>
                            </div>
                          </div>

                          {!bucketName || !hasS3AccountContext ? (
                            <div className={inspectorEmptyStateClasses}>
                              Select a bucket to load bucket stats and features.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {bucketInspectorLoading &&
                                !bucketInspectorData && (
                                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                                    Loading bucket overview...
                                  </p>
                                )}
                              {bucketInspectorError && (
                                <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                                  {bucketInspectorError}
                                </p>
                              )}
                              <div className={inspectorSectionCardClasses}>
                                <p className={inspectorSectionTitleClasses}>
                                  Stats
                                </p>
                                <div className="mt-2 grid gap-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-500">
                                      Created
                                    </span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {bucketInspectorData?.creation_date
                                        ? formatDateTime(
                                            bucketInspectorData.creation_date,
                                          )
                                        : "-"}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-500">
                                      Used bytes
                                    </span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {formatBytes(
                                        bucketInspectorData?.used_bytes ?? null,
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-500">
                                      Object count
                                    </span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {bucketInspectorData?.object_count != null
                                        ? bucketInspectorData.object_count.toLocaleString()
                                        : "-"}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {isCephContext && (
                                <div className={inspectorSectionCardClasses}>
                                  <p className={inspectorSectionTitleClasses}>
                                    Ceph
                                  </p>
                                  <div className="mt-2 grid gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">
                                        {cephQuotaScopeLabel} size
                                      </span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                                        {cephContextQuotaSizeBytes != null
                                          ? formatBytes(
                                              cephContextQuotaSizeBytes,
                                            )
                                          : "Not set"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">
                                        {cephQuotaScopeLabel} objects
                                      </span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                                        {cephContextQuotaObjects != null
                                          ? cephContextQuotaObjects.toLocaleString()
                                          : "Not set"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">
                                        Bucket quota size
                                      </span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                                        {(bucketInspectorData?.quota_max_size_bytes ??
                                          0) > 0
                                          ? formatBytes(
                                              bucketInspectorData?.quota_max_size_bytes ??
                                                null,
                                            )
                                          : "Not set"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">
                                        Bucket quota objects
                                      </span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                                        {(bucketInspectorData?.quota_max_objects ??
                                          0) > 0
                                          ? (
                                              bucketInspectorData?.quota_max_objects ??
                                              0
                                            ).toLocaleString()
                                          : "Not set"}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className={inspectorSectionCardClasses}>
                                <p className={inspectorSectionTitleClasses}>
                                  Features
                                </p>
                                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                  States mirror the Manager bucket overview when
                                  available.
                                </p>
                                <div className="mt-2 space-y-2">
                                  {bucketInspectorFeatures.length === 0 ? (
                                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                                      No feature data available for this
                                      context.
                                    </p>
                                  ) : (
                                    bucketInspectorFeatures.map((feature) => (
                                      <div
                                        key={feature.key}
                                        className="flex items-center justify-between gap-2"
                                      >
                                        <span className="text-slate-500">
                                          {feature.label}
                                        </span>
                                        <span
                                          className={`rounded-full px-2 py-1 ui-caption font-semibold ${BUCKET_INSPECTOR_FEATURE_CHIP_CLASSES[feature.tone]}`}
                                        >
                                          {feature.state}
                                        </span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {inspectorTab === "selection" && (
                      <div
                        role="tabpanel"
                        id="inspector-panel-selection"
                        aria-labelledby="inspector-tab-selection"
                        className={inspectorTabPanelClasses}
                      >
                        {canSelectionActions ? (
                          <div className="space-y-3">
                            <div
                              className={`${inspectorSectionCardClasses} flex items-start justify-between gap-2`}
                            >
                              <div>
                                <p className={inspectorSectionTitleClasses}>
                                  Selection
                                </p>
                                <p className="mt-1 ui-caption text-slate-400">
                                  {selectedCount > 0
                                    ? `${selectedCount} selected`
                                    : "No selection"}
                                </p>
                                {selectedCount > 0 && (
                                  <p className="ui-caption text-slate-400">
                                    {selectionIsSingle && selectionPrimary
                                      ? selectionPrimary.name
                                      : `${selectionFiles.length} files · ${selectionFolders.length} folders`}
                                  </p>
                                )}
                                {selectionHasDeleted && (
                                  <p className="ui-caption font-semibold text-amber-600 dark:text-amber-200">
                                    Contains deleted items (derived from delete
                                    markers).
                                  </p>
                                )}
                                {selectedCount > 0 && (
                                  <p className="ui-caption text-slate-400">
                                    Total size: {formatBytes(selectedBytes)}
                                  </p>
                                )}
                              </div>
                              {selectedCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedIds([]);
                                    setSelectionAnchorId(null);
                                    setActiveRowId(null);
                                  }}
                                  className={inspectorInlineActionClasses}
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                            <div className="space-y-3">
                              <div className={inspectorSectionCardClasses}>
                                <p className={inspectorSectionTitleClasses}>
                                  Actions
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {inspectorSelectionActions.map((action) =>
                                    renderInspectorActionButton(action, () =>
                                      runSelectionAction(action.id),
                                    ),
                                  )}
                                </div>
                              </div>
                              <div className={inspectorSectionCardClasses}>
                                <p className={inspectorSectionTitleClasses}>
                                  Bulk actions
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {inspectorSelectionBulkActions.map((action) =>
                                    renderInspectorActionButton(
                                      action,
                                      () => runSelectionAction(action.id),
                                      {
                                        danger: action.id === "delete",
                                      },
                                    ),
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className={inspectorSectionCardClasses}>
                              <div className="flex items-center justify-between gap-2">
                                <p className={inspectorSectionTitleClasses}>
                                  Selection stats
                                </p>
                                <button
                                  type="button"
                                  className={chromeBulkActionClasses}
                                  onClick={calculateSelectionStats}
                                  disabled={
                                    !bucketName ||
                                    !hasS3AccountContext ||
                                    selectionStatsLoading
                                  }
                                >
                                  <RefreshIcon className="h-3.5 w-3.5" />
                                  {selectionStatsLoading
                                    ? "Calculating..."
                                    : selectionStats
                                      ? "Recalculate"
                                      : "Calculate"}
                                </button>
                              </div>
                              {selectionStatsError && (
                                <p className="mt-2 ui-caption font-semibold text-rose-600 dark:text-rose-200">
                                  {selectionStatsError}
                                </p>
                              )}
                              {!selectionStats &&
                                !selectionStatsLoading &&
                                !selectionStatsError && (
                                  <p className="mt-2 ui-caption text-slate-400">
                                    Calculates object count and size, including
                                    folder contents.
                                  </p>
                                )}
                              {selectionStats && (
                                <div className="mt-2 grid gap-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500">
                                      Objects
                                    </span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {selectionStats.objectCount.toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500">
                                      Total size
                                    </span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {formatBytes(selectionStats.totalBytes)}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className={inspectorEmptyStateClasses}>
                            Select one or more objects to see selection actions.
                          </div>
                        )}
                      </div>
                    )}

                    {inspectorTab === "details" && (
                      <div
                        role="tabpanel"
                        id="inspector-panel-details"
                        aria-labelledby="inspector-tab-details"
                        className={inspectorTabPanelClasses}
                      >
                        {inspectedItem ? (
                          <div className="space-y-3">
                            <div
                              className={`${inspectorSectionCardClasses} flex items-center justify-between gap-2`}
                            >
                              <p className={inspectorSectionTitleClasses}>
                                Object details
                              </p>
                              <button
                                type="button"
                                onClick={() => setActiveItem(null)}
                                className={inspectorInlineActionClasses}
                              >
                                Clear
                              </button>
                            </div>
                            <div className="rounded-lg border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-sky-50 px-3 py-2.5 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-900/60 dark:to-slate-900">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex h-10 w-10 items-center justify-center rounded-lg border ui-caption font-bold ${
                                    isImageFile(inspectedItem.name)
                                      ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/30 dark:text-sky-200"
                                      : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                  }`}
                                >
                                  {previewLabelForItem(inspectedItem)}
                                </div>
                                <div>
                                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                                    {inspectedItem.name}
                                  </p>
                                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                                    {inspectedItem.type === "folder"
                                      ? inspectedItem.isDeleted
                                        ? "Deleted folder"
                                        : "Prefix"
                                      : inspectedItem.isDeleted
                                        ? "Deleted object"
                                        : "Object"}{" "}
                                    | {inspectedItem.size}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className={inspectorSectionCardClasses}>
                              <p className={inspectorSectionTitleClasses}>
                                Actions
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {inspectedItem.type === "folder" ? (
                                  <button
                                    type="button"
                                    className={chromeBulkActionClasses}
                                    onClick={() => handleOpenItem(inspectedItem)}
                                  >
                                    <OpenIcon className="h-3.5 w-3.5" />
                                    Open
                                  </button>
                                ) : (
                                  <>
                                    {!inspectedItem.isDeleted && (
                                      <button
                                        type="button"
                                        className={chromeBulkActionClasses}
                                        onClick={() =>
                                          openObjectDetails(
                                            inspectedItem,
                                            "preview",
                                          )
                                        }
                                      >
                                        <EyeIcon className="h-3.5 w-3.5" />
                                        Preview
                                      </button>
                                    )}
                                    {isVersioningEnabled && (
                                      <button
                                        type="button"
                                        className={chromeBulkActionClasses}
                                        onClick={() =>
                                          openObjectDetails(
                                            inspectedItem,
                                            "versions",
                                          )
                                        }
                                      >
                                        <ListIcon className="h-3.5 w-3.5" />
                                        Versions
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className={chromeBulkActionClasses}
                                      onClick={() =>
                                        openObjectDetails(
                                          inspectedItem,
                                          inspectedItem.isDeleted
                                            ? "versions"
                                            : "properties",
                                        )
                                      }
                                    >
                                      <SettingsIcon className="h-3.5 w-3.5" />
                                      Open object details
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className={inspectorSectionCardClasses}>
                              <p className={inspectorSectionTitleClasses}>
                                Summary
                              </p>
                              <div className="grid gap-2 ui-caption text-slate-600 dark:text-slate-300">
                                <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                                  <span className="text-slate-500">Path</span>
                                  <span className="min-w-0 break-all text-right font-semibold text-slate-700 dark:text-slate-100">
                                    {inspectedPath}
                                  </span>
                                </div>
                                <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                                  <span className="text-slate-500">Owner</span>
                                  <span className="min-w-0 break-words text-right font-semibold text-slate-700 dark:text-slate-100">
                                    {inspectedItem.owner}
                                  </span>
                                </div>
                                <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                                  <span className="text-slate-500">
                                    Last modified
                                  </span>
                                  <span className="min-w-0 text-right font-semibold text-slate-700 dark:text-slate-100">
                                    {inspectedItem.modified}
                                  </span>
                                </div>
                                <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                                  <span className="text-slate-500">
                                    Type
                                  </span>
                                  <span className="min-w-0 break-words text-right font-semibold text-slate-700 dark:text-slate-100">
                                    {inspectedItem.type === "folder"
                                      ? inspectedItem.isDeleted
                                        ? "Deleted folder"
                                        : "Prefix"
                                      : inspectedItem.isDeleted
                                        ? "Deleted object"
                                        : "Object"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
                                  <span className="text-slate-500">
                                    Storage class
                                  </span>
                                  <span className="min-w-0 break-words text-right font-semibold text-slate-700 dark:text-slate-100">
                                    {inspectedItem.storageClass ?? "-"}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {isVersioningEnabled &&
                              inspectedItem.type === "file" && (
                                <BrowserObjectVersionsList
                                  title="Versions"
                                  containerClassName={inspectorSectionCardClasses}
                                  titleClassName={inspectorSectionTitleClasses}
                                  bodyClassName="mt-2 space-y-2"
                                  versions={objectVersionRows}
                                  loading={objectVersionsLoading}
                                  error={objectVersionsError}
                                  canLoadMore={Boolean(
                                    objectVersionKeyMarker ||
                                      objectVersionIdMarker,
                                  )}
                                  onLoadMore={() =>
                                    void loadObjectVersions({
                                      append: true,
                                      keyMarker: objectVersionKeyMarker,
                                      versionIdMarker: objectVersionIdMarker,
                                      targetKey: inspectedItem.key,
                                    })
                                  }
                                  onRestoreVersion={handleRestoreVersion}
                                  onDeleteVersion={handleDeleteVersion}
                                />
                              )}
                          </div>
                        ) : (
                          <div className={inspectorEmptyStateClasses}>
                            Select a single object to view details.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {isFoldersPanelVisible && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize folders panel"
                title="Resize folders panel"
                className="absolute inset-y-0 z-20 -translate-x-1/2 cursor-col-resize touch-none select-none"
                style={{
                  left: `calc(${resolvedFoldersWidth}px + ${PANEL_LAYOUT_GAP_PX / 2}px)`,
                  width: `${PANEL_RESIZER_HITBOX_WIDTH_PX}px`,
                }}
                onPointerDown={startPanelResize("folders")}
                onDoubleClick={resetFoldersPanelWidth}
              >
                <div
                  className={`mx-auto h-full w-0.5 rounded-full bg-slate-200 transition dark:bg-slate-700 ${
                    activePanelResize === "folders"
                      ? "bg-primary dark:bg-primary-300"
                      : "hover:bg-slate-300 dark:hover:bg-slate-500"
                  }`}
                />
              </div>
            )}
            {isInspectorPanelVisible && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize inspector panel"
                title="Resize inspector panel"
                className="absolute inset-y-0 z-20 translate-x-1/2 cursor-col-resize touch-none select-none"
                style={{
                  right: `calc(${resolvedInspectorWidth}px + ${PANEL_LAYOUT_GAP_PX / 2}px)`,
                  width: `${PANEL_RESIZER_HITBOX_WIDTH_PX}px`,
                }}
                onPointerDown={startPanelResize("inspector")}
                onDoubleClick={resetInspectorPanelWidth}
              >
                <div
                  className={`mx-auto h-full w-0.5 rounded-full bg-slate-200 transition dark:bg-slate-700 ${
                    activePanelResize === "inspector"
                      ? "bg-primary dark:bg-primary-300"
                      : "hover:bg-slate-300 dark:hover:bg-slate-500"
                  }`}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <BrowserContextMenu
        contextMenu={contextMenu}
        contextMenuRef={contextMenuRef}
        bucketName={bucketName}
        currentPath={currentPath}
        hasS3AccountContext={hasS3AccountContext}
        versioningEnabled={isVersioningEnabled}
        showFolderItems={showFolderItems}
        showDeletedObjects={showDeletedObjects}
        allowInspectorPanel={canUseInspectorPanel}
        canPaste={canPaste}
        copyUrlDisabled={sseActive}
        copyUrlDisabledReason={copyUrlDisabledReason}
        clipboard={clipboard}
        fileInputRef={fileInputRef}
        folderInputRef={folderInputRef}
        onClose={closeContextMenu}
        onNewFolder={handleNewFolder}
        onPasteItems={handlePasteItems}
        onOpenPrefixVersions={() => setShowPrefixVersions(true)}
        onOpenCleanupVersions={openCleanupModal}
        onDownloadTarget={handleDownloadTarget}
        onPreviewItem={handlePreviewItem}
        onCopyUrl={handleCopyUrl}
        onCopyPath={(path) => {
          void handleCopyPath(path);
        }}
        onCopyItems={handleCopyItems}
        onCutItems={handleCutItems}
        onOpenBulkAttributes={openBulkAttributesModal}
        onOpenBulkRestore={openBulkRestoreModal}
        onOpenObjectVersions={openObjectVersionsModal}
        onOpenAdvanced={openAdvancedForItem}
        onOpenProperties={openPropertiesForItem}
        onDeleteItems={handleDeleteItems}
        onDownloadFolder={handleDownloadFolder}
        onDownloadItems={handleDownloadItems}
        onOpenItem={handleOpenItem}
        onOpenDetails={openItemDetails}
        onToggleShowFolders={() => setShowFolderItems((prev) => !prev)}
        onToggleShowDeleted={() => setShowDeletedObjects((prev) => !prev)}
        isMainBrowserPath={isMainBrowserPath}
        compactMode={compactMode}
        onSetCompactMode={(value) => {
          if (!isMainBrowserPath) return;
          setCompactMode(value);
        }}
        columnOptions={COLUMN_DEFINITIONS.map((column) => ({
          id: column.id,
          label: column.label,
        }))}
        visibleColumns={visibleColumnSet}
        onToggleVisibleColumn={(columnId) => {
          handleToggleVisibleColumn(columnId as BrowserColumnId);
        }}
        onResetVisibleColumns={() => {
          handleResetVisibleColumns();
        }}
      />
      {objectDetailsTarget && objectDetailsTarget.item.type === "file" && (
        <BrowserObjectDetailsModal
          accountId={accountIdForApi}
          bucketName={bucketName}
          item={objectDetailsTarget.item}
          initialTab={objectDetailsTarget.initialTab}
          versioningEnabled={isVersioningEnabled}
          sseCustomerKeyBase64={sseCustomerKeyBase64}
          useProxyTransfers={useProxyTransfers}
          sseActive={sseActive}
          copyUrlDisabled={sseActive}
          copyUrlDisabledReason={copyUrlDisabledReason}
          presignObjectRequest={presignObjectRequest}
          onClose={() => setObjectDetailsTarget(null)}
          onDownload={handleDownloadTarget}
          onCopyUrl={(item) => handleCopyUrl(item)}
          onRefreshBrowserObjects={refreshObjectListing}
          onRestoreVersion={handleRestoreVersion}
          onDeleteVersion={handleDeleteVersion}
        />
      )}
      {configBucketName && bucketConfigurationEnabled && (
        <Modal
          title={`Configure bucket · ${configBucketName}`}
          onClose={closeBucketConfigurationModal}
          maxWidthClass="max-w-7xl"
          maxBodyHeightClass="h-[88vh]"
        >
          <S3AccountProvider scope={bucketConfigContextScope}>
            <BucketDetailPage
              bucketNameOverride={configBucketName}
              embedded
              hideObjectsTab
            />
          </S3AccountProvider>
        </Modal>
      )}
      {showCreateBucketModal && (
        <Modal
          title="Create bucket"
          onClose={closeCreateBucketDialog}
          maxWidthClass="max-w-lg"
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateBucketSubmit();
            }}
          >
            <label className="block ui-caption font-semibold text-slate-600 dark:text-slate-300">
              Bucket name
              <input
                type="text"
                value={createBucketNameValue}
                onChange={(event) => {
                  setCreateBucketNameValue(
                    normalizeS3BucketNameInput(event.target.value),
                  );
                  if (createBucketError) {
                    setCreateBucketError(null);
                  }
                }}
                placeholder="my-bucket"
                maxLength={S3_BUCKET_NAME_MAX_LENGTH}
                title={
                  !createBucketNameValue || isCreateBucketNameValid
                    ? undefined
                    : invalidBucketNameMessage
                }
                className={`mt-1 w-full rounded-md border bg-white px-3 py-2 ui-body font-semibold shadow-sm focus:outline-none focus:ring-2 ${
                  !createBucketNameValue || isCreateBucketNameValid
                    ? "border-slate-300 text-slate-700 focus:border-primary focus:ring-primary/30 dark:border-slate-700 dark:text-slate-100"
                    : "border-rose-400 text-rose-700 focus:border-rose-500 focus:ring-rose-200 dark:border-rose-500 dark:text-rose-200 dark:focus:ring-rose-900/50"
                } dark:bg-slate-800`}
                disabled={createBucketLoading}
                spellCheck={false}
                autoFocus
              />
            </label>
            {createBucketNameValue && !isCreateBucketNameValid && (
              <p className="ui-caption font-semibold text-rose-600 dark:text-rose-300">
                {invalidBucketNameMessage}
              </p>
            )}
            <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={createBucketVersioning}
                onChange={(event) =>
                  setCreateBucketVersioning(event.target.checked)
                }
                disabled={createBucketLoading}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/40 dark:border-slate-600 dark:bg-slate-800"
              />
              Enable versioning
            </label>
            {createBucketError && (
              <p className="ui-caption font-semibold text-rose-600 dark:text-rose-300">
                {createBucketError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-slate-100"
                onClick={closeCreateBucketDialog}
                disabled={createBucketLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  !hasS3AccountContext ||
                  createBucketLoading ||
                  !createBucketNameValue.trim() ||
                  !isCreateBucketNameValid
                }
              >
                {createBucketLoading ? "Creating..." : "Create bucket"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {showSseCustomerModal && (
        <Modal
          title="SSE-C key"
          onClose={() => setShowSseCustomerModal(false)}
          maxWidthClass="max-w-lg"
        >
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              handleActivateSseCustomerKey();
            }}
          >
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Enter a base64 key that decodes to exactly 32 bytes. The key is
              stored in memory only for this browser session and this bucket.
            </p>
            <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Customer key (base64, 32 bytes)</span>
              <div className="flex items-center gap-2">
                <input
                  type={resolveSseCustomerKeyInputType(sseCustomerKeyVisible)}
                  value={sseCustomerKeyInput}
                  onChange={(event) => {
                    setSseCustomerKeyInput(event.target.value);
                    if (sseCustomerKeyError) {
                      setSseCustomerKeyError(null);
                    }
                    if (sseCustomerKeyNotice) {
                      setSseCustomerKeyNotice(null);
                    }
                  }}
                  placeholder="Base64 key"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 ui-body font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  spellCheck={false}
                  autoFocus
                />
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-slate-100"
                  onClick={() => setSseCustomerKeyVisible((prev) => !prev)}
                >
                  {sseCustomerKeyVisible ? "Masquer" : "Afficher"}
                </button>
              </div>
            </label>
            {sseCustomerKeyError && (
              <p className="ui-caption font-semibold text-rose-600 dark:text-rose-300">
                {sseCustomerKeyError}
              </p>
            )}
            {sseCustomerKeyNotice && (
              <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
                {sseCustomerKeyNotice}
              </p>
            )}
            {sseActive && (
              <p className="ui-caption font-semibold text-emerald-700 dark:text-emerald-200">
                SSE-C is currently enabled for this bucket.
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-slate-100"
                onClick={() => setShowSseCustomerModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md border border-emerald-200 px-3 py-1.5 ui-caption font-semibold text-emerald-700 transition hover:border-emerald-300 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/40 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                onClick={() => void handleGenerateSseCustomerKey()}
                disabled={!sseCustomerScopeKey}
              >
                Generate
              </button>
              <button
                type="button"
                className="rounded-md border border-rose-200 px-3 py-1.5 ui-caption font-semibold text-rose-700 transition hover:border-rose-300 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/40 dark:text-rose-200 dark:hover:border-rose-400 dark:hover:text-rose-100"
                onClick={handleClearSseCustomerKey}
                disabled={!sseActive}
              >
                Clear
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary/90"
              >
                Enable
              </button>
            </div>
          </form>
        </Modal>
      )}
      {showMultipartUploadsModal && bucketName && hasS3AccountContext && (
        <BrowserMultipartUploadsModal
          bucketName={bucketName}
          uploads={multipartUploads}
          loading={multipartUploadsLoading}
          loadingMore={multipartUploadsLoadingMore}
          error={multipartUploadsError}
          canLoadMore={
            multipartUploadsIsTruncated &&
            Boolean(multipartUploadsNextKey || multipartUploadsNextUploadId)
          }
          abortingUploadIds={abortingMultipartUploadIds}
          onRefresh={refreshMultipartUploads}
          onLoadMore={loadMoreMultipartUploads}
          onAbort={requestAbortMultipartUpload}
          onClose={closeMultipartUploadsModal}
        />
      )}
      {showPrefixVersions && isVersioningEnabled && (
        <BrowserPrefixVersionsModal
          bucketName={bucketName}
          normalizedPrefix={normalizedPrefix}
          prefixVersionsLoading={prefixVersionsLoading}
          prefixVersionsError={prefixVersionsError}
          prefixVersionRows={prefixVersionRows}
          prefixVersionKeyMarker={prefixVersionKeyMarker}
          prefixVersionIdMarker={prefixVersionIdMarker}
          onClose={() => setShowPrefixVersions(false)}
          onRefresh={() =>
            loadPrefixVersions({
              append: false,
              keyMarker: null,
              versionIdMarker: null,
            })
          }
          onLoadMore={() => loadPrefixVersions({ append: true })}
          onRestoreVersion={handleRestoreVersion}
          onDeleteVersion={handleDeleteVersion}
        />
      )}
      {showBulkAttributesModal && (
        <BrowserBulkAttributesModal
          bulkActionFileCount={bulkActionFileCount}
          bulkActionFolderCount={bulkActionFolderCount}
          bulkAttributesError={bulkAttributesError}
          bulkAttributesSummary={bulkAttributesSummary}
          bulkApplyMetadata={bulkApplyMetadata}
          setBulkApplyMetadata={setBulkApplyMetadata}
          bulkMetadataDraft={bulkMetadataDraft}
          setBulkMetadataDraft={setBulkMetadataDraft}
          bulkMetadataEntries={bulkMetadataEntries}
          setBulkMetadataEntries={setBulkMetadataEntries}
          bulkApplyTags={bulkApplyTags}
          setBulkApplyTags={setBulkApplyTags}
          bulkTagsDraft={bulkTagsDraft}
          setBulkTagsDraft={setBulkTagsDraft}
          bulkApplyStorageClass={bulkApplyStorageClass}
          setBulkApplyStorageClass={setBulkApplyStorageClass}
          bulkStorageClass={bulkStorageClass}
          setBulkStorageClass={setBulkStorageClass}
          bulkApplyAcl={bulkApplyAcl}
          setBulkApplyAcl={setBulkApplyAcl}
          bulkAclValue={bulkAclValue}
          setBulkAclValue={setBulkAclValue}
          bulkApplyLegalHold={bulkApplyLegalHold}
          setBulkApplyLegalHold={setBulkApplyLegalHold}
          bulkLegalHoldStatus={bulkLegalHoldStatus}
          setBulkLegalHoldStatus={setBulkLegalHoldStatus}
          bulkApplyRetention={bulkApplyRetention}
          setBulkApplyRetention={setBulkApplyRetention}
          bulkRetentionMode={bulkRetentionMode}
          setBulkRetentionMode={setBulkRetentionMode}
          bulkRetentionDate={bulkRetentionDate}
          setBulkRetentionDate={setBulkRetentionDate}
          bulkRetentionBypass={bulkRetentionBypass}
          setBulkRetentionBypass={setBulkRetentionBypass}
          bulkAttributesLoading={bulkAttributesLoading}
          onApply={handleBulkAttributesApply}
          onClose={() => setShowBulkAttributesModal(false)}
        />
      )}
      {showBulkRestoreModal && (
        <BrowserBulkRestoreModal
          bulkActionFileCount={bulkActionFileCount}
          bulkActionFolderCount={bulkActionFolderCount}
          bulkRestoreError={bulkRestoreError}
          bulkRestoreSummary={bulkRestoreSummary}
          bulkRestoreTargetPath={bulkRestoreTargetPath}
          bulkRestoreDryRun={bulkRestoreDryRun}
          setBulkRestoreDryRun={setBulkRestoreDryRun}
          bulkRestorePreview={bulkRestorePreview}
          bulkRestoreDate={bulkRestoreDate}
          setBulkRestoreDate={setBulkRestoreDate}
          bulkRestoreDeleteMissing={bulkRestoreDeleteMissing}
          setBulkRestoreDeleteMissing={setBulkRestoreDeleteMissing}
          bulkRestoreRestoreDeleted={bulkRestoreRestoreDeleted}
          setBulkRestoreRestoreDeleted={handleBulkRestoreRestoreDeletedChange}
          bulkRestoreLoading={bulkRestoreLoading}
          onApply={handleBulkRestoreApply}
          onClose={() => setShowBulkRestoreModal(false)}
        />
      )}
      {showCleanupModal && (
        <BrowserCleanupModal
          currentPath={currentPath}
          cleanupKeepLast={cleanupKeepLast}
          setCleanupKeepLast={setCleanupKeepLast}
          cleanupOlderThanDays={cleanupOlderThanDays}
          setCleanupOlderThanDays={setCleanupOlderThanDays}
          cleanupDeleteOrphanMarkers={cleanupDeleteOrphanMarkers}
          setCleanupDeleteOrphanMarkers={setCleanupDeleteOrphanMarkers}
          cleanupError={cleanupError}
          cleanupSummary={cleanupSummary}
          cleanupLoading={cleanupLoading}
          onApply={handleCleanupApply}
          onClose={() => setShowCleanupModal(false)}
        />
      )}
      {showNewFolderModal && (
        <Modal
          title="Create folder"
          onClose={closeNewFolderDialog}
          maxWidthClass="max-w-md"
          initialFocusRef={newFolderInputRef}
          closeOnBackdropClick={!newFolderLoading}
        >
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateFolderFromModal();
            }}
          >
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Destination:{" "}
              <span className="font-semibold">
                {currentPath || `${bucketName}/`}
              </span>
            </p>
            <label className="block ui-caption font-semibold text-slate-600 dark:text-slate-300">
              Folder name
              <input
                ref={newFolderInputRef}
                type="text"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="my-folder"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 ui-body font-semibold text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                disabled={newFolderLoading}
                spellCheck={false}
              />
            </label>
            {newFolderError && (
              <p className="ui-caption font-semibold text-rose-600 dark:text-rose-300">
                {newFolderError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-slate-100"
                onClick={closeNewFolderDialog}
                disabled={newFolderLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  !bucketName || !hasS3AccountContext || newFolderLoading
                }
              >
                {newFolderLoading ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirmDialog && (
        <BrowserConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          tone={confirmDialog.tone}
          loading={confirmDialogLoading}
          onCancel={closeConfirmDialog}
          onConfirm={() => void submitConfirmDialog()}
        />
      )}
      {copyDialog && (
        <BrowserCopyValueModal
          title={copyDialog.title}
          label={copyDialog.label}
          value={copyDialog.value}
          onCopySuccess={() => {
            if (copyDialog.successMessage) {
              setStatusMessage(copyDialog.successMessage);
            }
          }}
          onClose={() => setCopyDialog(null)}
        />
      )}
      {showOperationsModal && (
        <BrowserOperationsModal
          totalOperationsCount={totalOperationsCount}
          activeOperationsCount={activeOperations.length}
          queuedOperationsCount={
            uploadQueue.length +
            queuedDownloadCount +
            queuedDeleteCount +
            queuedCopyCount
          }
          completedOperationsCount={completedOperationsCount}
          failedOperationsCount={failedOperationsCount}
          showActiveOperations={showActiveOperations}
          showQueuedOperations={showQueuedOperations}
          showCompletedOperations={showCompletedOperations}
          showFailedOperations={showFailedOperations}
          filtersAllInactive={filtersAllInactive}
          onToggleActive={() => toggleOperationFilter("active")}
          onToggleQueued={() => toggleOperationFilter("queued")}
          onToggleCompleted={() => toggleOperationFilter("completed")}
          onToggleFailed={() => toggleOperationFilter("failed")}
          visibleDownloadGroups={visibleDownloadGroups}
          visibleDeleteGroups={visibleDeleteGroups}
          visibleCopyGroups={visibleCopyGroups}
          visibleUploadGroups={visibleUploadGroups}
          visibleOtherOperations={visibleOtherOperations}
          operationSortIndexById={operationSortIndexById}
          uploadGroupSortIndexById={uploadGroupSortIndexById}
          operationSortFallback={operationSortFallback}
          isGroupExpanded={isGroupExpanded}
          toggleGroupExpanded={toggleGroupExpanded}
          getSectionVisibleCount={getSectionVisibleCount}
          showMoreSection={showMoreSection}
          cancelOperation={cancelOperation}
          cancelUploadGroup={cancelUploadGroup}
          cancelUploadOperation={cancelUploadOperation}
          removeQueuedUpload={removeQueuedUpload}
          onDownloadOperationDetails={downloadOperationDetails}
          hasFinishedOperations={hasFinishedOperations}
          onClearFinishedOperations={clearFinishedOperations}
          onClose={() => setShowOperationsModal(false)}
        />
      )}
    </div>
  );
}

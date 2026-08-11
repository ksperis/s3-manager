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
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import JSZip from "jszip";
import { ZipWriter } from "@zip.js/zip.js";
import axios, { type AxiosProgressEvent } from "axios";
import TableEmptyState from "../../components/TableEmptyState";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
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
  uiMenuClass,
  uiMutedTextClass,
} from "../../components/ui/styles";
import { formatBytes } from "../../utils/format";
import { extractApiError } from "../../utils/apiError";
import { triggerBlobDownload } from "../../utils/download";
import {
  CLIENT_STORAGE_KEYS,
  readClientJson,
  readClientStorage,
  writeClientStorage,
} from "../../utils/clientStorage";
import {
  isValidS3BucketName,
  normalizeS3BucketName,
} from "../../utils/s3BucketName";
import { stableSignature } from "../../utils/stableSignature";
import { readStoredUser } from "../../utils/workspaces";
import {
  withS3AccountParam,
  type S3AccountSelector,
} from "../../api/accountParams";
import type { ExecutionContextKind } from "../../api/executionContexts";
import {
  BrowserBucket,
  type BrowserUsageSummary,
  type BrowserRequestOptions,
  BrowserObject,
  BrowserObjectVersion,
  BrowserSettings,
  type BrowserWorkspaceSurface,
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
  fetchBrowserUsageSummary,
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
import {
  useBrowserSidebarSlot,
  type BrowserSidebarBodyRenderer,
} from "./BrowserLayout";
import BrowserBulkAttributesModal from "./BrowserBulkAttributesModal";
import BrowserFoldersPanel from "./BrowserFoldersPanel";
import BrowserWorkspaceSidebar from "./BrowserWorkspaceSidebar";
import BrowserBulkRestoreModal from "./BrowserBulkRestoreModal";
import BrowserCleanupModal from "./BrowserCleanupModal";
import {
  FULL_BROWSER_CAPABILITY_FACTS,
  type BrowserActionId,
  type BrowserCapabilityFacts,
  type BrowserDensity,
  type BrowserFunctionalProfile,
  type BrowserLayoutMode,
  type BrowserActionState,
  getVisibleBrowserActions,
  resolveBrowserActions,
  runBrowserAction,
  resolveItemPrimaryAction,
  isBrowserItemPreviewAvailable,
  TOOLBAR_MORE_PATH_ACTION_IDS,
  TOOLBAR_MORE_SELECTION_FULL_ACTION_IDS,
  TOOLBAR_MORE_SELECTION_OVERFLOW_ACTION_IDS,
} from "./browserActions";
import {
  BrowserConfirmModal,
  BrowserCopyValueModal,
} from "./BrowserDialogModals";
import {
  BrowserBucketConfigurationModal,
  BrowserCreateBucketModal,
  BrowserCreateFolderModal,
  BrowserSseCustomerKeyModal,
} from "./BrowserBucketDialogModals";
import BrowserContextMenu from "./BrowserContextMenu";
import { formatBrowserOperationError as formatOperationError } from "./browserOperationErrors";
import {
  ensureSuccessfulBrowserTransferResponse,
  readBrowserTransferBlob,
  readBrowserTransferStream,
} from "./browserFetchTransferResponse";
import {
  BUCKET_INSPECTOR_FEATURE_CHIP_CLASSES,
  buildBucketInspectorFeatures,
  fetchBucketInspectorData,
  type BucketInspectorData,
} from "./browserBucketInspectorModel";
import BrowserObjectDetailsModal from "./BrowserObjectDetailsModal";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";
import BrowserOperationsModal from "./BrowserOperationsModal";
import BrowserOperationsPanel from "./BrowserOperationsPanel";
import BrowserMultipartUploadsModal from "./BrowserMultipartUploadsModal";
import BrowserPrefixVersionsModal from "./BrowserPrefixVersionsModal";
import {
  transferClipboardObjectBetweenContexts,
  type ClipboardTransferMode,
} from "./browserClipboardTransfer";
import {
  DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
  readBrowserRootContextSelection,
  readBrowserRootUiState,
  readStoredBrowserRootUiState,
  writeBrowserRootActiveLayout,
  writeBrowserRootDensity,
  writeBrowserRootContextSelection,
  writeBrowserRootUiLayout,
  writeBrowserRootUiPanelWidths,
} from "./browserRootUiState";
import { presignObjectWithSts, presignPartWithSts } from "./stsPresigner";
import {
  resolveSimpleUploadOperation,
  shouldUseStsPresigner,
} from "./sseBrowserLogic";
import {
  activateSseCustomerKeyForScope,
  copySseCustomerKeyWithFallback,
  generateAndActivateSseCustomerKeyForScope,
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
  XIcon,
} from "./browserIcons";
import { resolveBrowserContextQuotas } from "./browserQuota";
import {
  BUCKET_MENU_LIMIT,
  COMPLETED_OPERATIONS_LIMIT,
  DELETED_RESULTS_TARGET,
  DELETED_VERSIONS_SCAN_LIMIT,
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
  contextMenuItemClasses,
  contextMenuItemDisabledClasses,
  contextMenuSeparatorClasses,
  filterChipClasses,
  iconButtonClasses,
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
  collectDroppedFiles,
  findTreeNodeByPrefix,
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
  CORS_DIRECT_TRANSFER_WARNING,
  buildBrowserTransferWarnings,
  isStsCredentialsExpiring,
  resolveBrowserTransferAccessBadge,
  resolveBrowserTransferParallelism,
  resolveDirectCredentialStsTooltip,
} from "./browserTransferPresentation";
import {
  BROWSER_QUERY_DEBOUNCE_MS,
  isStaleRequest,
  mergeBucketSearchItems,
  prepareLatestRequest,
} from "./browserSearchHelpers";
import {
  PANEL_LAYOUT_GAP_PX,
  PANEL_RESIZER_HITBOX_WIDTH_PX,
  PANELS_DISABLE_MEDIA_QUERY,
  resolveBrowserPanelWidths,
} from "./browserPanelLayout";
import {
  COLUMN_DEFINITIONS,
  COLUMN_RESIZER_HITBOX_WIDTH_PX,
  COMFORTABLE_ROW_ACTION_TARGET_SIZE_PX,
  COMPACT_ROW_ACTION_TARGET_SIZE_PX,
  DEFAULT_VISIBLE_COLUMN_IDS,
  DIRECT_DELETED_ITEM_ACTION_IDS,
  DIRECT_ITEM_ACTION_IDS,
  DIRECT_PORTAL_ITEM_ACTION_IDS,
  MIN_ACTIONS_COLUMN_WIDTH_PX,
  ROW_ACTION_CELL_HORIZONTAL_PADDING_PX,
  ROW_ACTION_GAP_PX,
  SELECTION_COLUMN_WIDTH_PX,
  buildBrowserItems,
  buildBrowserPathStats,
  clampColumnWidth,
  collectAvailableStorageClasses,
  createLazyColumnCacheEntry,
  loadColumnWidthsForSurface,
  loadVisibleColumnsForSurface,
  normalizeVisibleColumns,
  persistColumnWidthsForSurface,
  persistVisibleColumnsForSurface,
  resolveColumnWidthPx,
  type BrowserColumnId,
  type BrowserObjectColumnWidths,
  type BrowserResizableColumnId,
  type BrowserSortKey,
  type ColumnDefinition,
  type LazyColumnCacheEntry,
  type LazyFieldStatus,
} from "./browserObjectTableModel";
import {
  buildPathSuggestionEntries,
  mergePathSuggestions,
  normalizePathDraftValue,
  pushBucketPathHistory,
  readBucketPathHistory,
  resolvePathDraftContext,
  type PathSuggestion,
} from "./browserPathSuggestions";
import {
  extractBucketListError,
  normalizeBrowserListingIssue,
  resolveBucketAccessEntry,
  sanitizeBucketAccessEntries,
  splitBucketPanelBuckets,
  UNKNOWN_BUCKET_ACCESS,
  type BrowserListingIssue,
  type BucketAccessEntry,
} from "./browserBucketsPanelHelpers";
import {
  getMultipartUploadEntryId,
  mergeDeletedObjectsWithLimit,
  mergeUniqueStringsWithLimit,
} from "./browserListingState";
import { resolveBrowserWorkspaceContext } from "./browserPageContextModel";
import { buildBulkRestorePlan } from "./browserBulkRestorePlan";
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
  TreeNode,
  UploadCandidate,
  UploadQueueItem,
} from "./browserTypes";

const MOBILE_OBJECT_LIST_MEDIA_QUERY = "(max-width: 767px)";

type BrowserPageProps = {
  accountIdForApi?: S3AccountSelector;
  executionContextKind?: BrowserExecutionContextKind | null;
  hasContext?: boolean;
  workspaceSurface?: BrowserWorkspaceSurface;
  functionalProfile?: BrowserFunctionalProfile;
  layoutMode?: BrowserLayoutMode;
  density?: BrowserDensity;
  capabilityFacts?: BrowserCapabilityFacts;
  lockedBucketName?: string;
  lockedBucketLabel?: string;
  storageEndpointCapabilities?: Record<string, boolean> | null;
  contextEndpointProvider?: "ceph" | "aws" | "other" | null;
  contextQuotaMaxSizeGb?: number | null;
  contextQuotaMaxObjects?: number | null;
  allowFoldersPanel?: boolean;
  allowInspectorPanel?: boolean;
  showPanelToggles?: boolean;
  defaultShowFolders?: boolean;
  defaultShowInspector?: boolean;
  onSelectedBucketNameChange?: (bucketName: string) => void;
  onOpenObjectDetailsRoute?: (target: BrowserObjectDetailsRouteTarget) => void;
  onCreatePublicLinkForObject?: (target: BrowserObjectDetailsRouteTarget) => void;
  deletedObjectsOptions?: BrowserDeletedObjectsOptions;
  refreshToken?: number;
  transferReporter?: BrowserTransferReporter;
};

export type BrowserExecutionContextKind = ExecutionContextKind | "ceph_admin";

export type BrowserObjectDetailsRouteTarget = {
  bucketName: string;
  key: string;
  name: string;
  initialTab?: "preview" | "properties" | "versions";
  isDeleted?: boolean;
};

export type BrowserDeletedObjectTarget = BrowserObjectDetailsRouteTarget & {
  deletedAt?: string | null;
  deleteMarkerVersionId?: string | null;
};

export type BrowserDeletedObjectsOptions = {
  visible?: boolean;
  showToggle?: boolean;
  canRestore?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
  onRestoreObject?: (target: BrowserDeletedObjectTarget) => void;
  onRestorePrefix?: (target: BrowserObjectDetailsRouteTarget) => void;
};

export type BrowserTransferReporter = {
  start: (transfer: {
    direction: "Upload" | "Download";
    bucketName: string;
    key: string;
    name: string;
    sizeBytes?: number | null;
  }) => string | null | undefined;
  complete: (id: string, name?: string) => void;
  fail: (id: string, message: string) => void;
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

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
const DEFAULT_STREAMING_ZIP_THRESHOLD_MB = 200;
const PATH_SUGGESTIONS_DEBOUNCE_MS = 200;
const PATH_SUGGESTIONS_API_LIMIT = 50;
const CONTEXT_MENU_PADDING_PX = 8;
const CONTEXT_MENU_FALLBACK_WIDTH_PX = 240;
const CONTEXT_MENU_FALLBACK_HEIGHT_PX = 320;
const TREE_PREFIXES_PAGE_BUDGET = 50;
const BUCKET_ACCESS_PROBE_CONCURRENCY = 4;
const BUCKET_ACCESS_ROOT_MARGIN = "120px";
const LAZY_COLUMN_CONCURRENCY = 4;
const LAZY_COLUMN_BATCH_SIZE = 24;
const LAZY_COLUMN_ROOT_MARGIN = "200px";

const browserSectionEyebrowClasses =
  cx("ui-caption font-semibold", uiMutedTextClass);
const browserShellClasses =
  "flex min-h-0 flex-1 flex-col overflow-hidden";
const browserSubtleSurfaceClasses =
  cx(uiCardMutedClass, "shadow-none");
const browserToolbarShellClasses =
  "flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between";
const browserToolbarPathStripClasses =
  "flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-1.5 shadow-[var(--ui-shadow-soft)]";
const browserToolbarControlsGroupClasses =
  "flex shrink-0 items-center gap-1.5";
const browserFloatingMenuClasses =
  cx(uiMenuClass, "overflow-hidden p-1.5");
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
  "inline-flex items-center gap-2 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-1.5 ui-caption font-medium text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]";
const browserSearchLabelClasses =
  cx("ui-caption font-medium", uiMutedTextClass);
const browserSearchStatusChipClasses =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-2 py-1 ui-caption text-[var(--ui-text-muted)] shadow-[var(--ui-shadow-soft)]";
const browserExplorerShellClasses =
  cx(
    uiCardClass,
    "relative flex min-h-0 flex-1 flex-col overflow-hidden",
  );
const inspectorTabListClasses =
  "flex flex-nowrap gap-1 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-1 shadow-[var(--ui-shadow-soft)]";
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
  "rounded-lg border border-dashed border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-4 ui-caption text-[var(--ui-text-muted)]";
export default function BrowserPage({
  accountIdForApi: accountIdOverride,
  executionContextKind: executionContextKindOverride,
  hasContext: hasContextOverride,
  workspaceSurface: workspaceSurfaceOverride,
  functionalProfile: functionalProfileOverride,
  layoutMode: layoutModeOverride,
  density: densityOverride,
  capabilityFacts: capabilityFactsOverride,
  lockedBucketName,
  lockedBucketLabel,
  storageEndpointCapabilities,
  contextEndpointProvider,
  contextQuotaMaxSizeGb,
  contextQuotaMaxObjects,
  allowFoldersPanel = true,
  allowInspectorPanel = true,
  showPanelToggles = true,
  defaultShowFolders = false,
  defaultShowInspector = false,
  onSelectedBucketNameChange,
  onOpenObjectDetailsRoute,
  onCreatePublicLinkForObject,
  deletedObjectsOptions,
  refreshToken,
  transferReporter,
}: BrowserPageProps = {}) {
  const browserContext = useBrowserContext();
  const { setSidebarBody } = useBrowserSidebarSlot();
  const selectedContext = browserContext.selectedContext;
  const location = useLocation();
  const navigate = useNavigate();
  const workspaceSurface =
    workspaceSurfaceOverride ??
    (selectedContext?.kind === "portal_account" ? "portal" : "browser");
  const {
    normalizedPath,
    isPortalBrowserSurface,
    isMainBrowserPath,
    isEmbeddedBrowserPath,
    usePortalWorkspaceLabels,
    workspaceNoun,
    workspaceNounCapitalized,
    selectorWorkspaceNoun,
    selectorWorkspaceNounPlural,
    selectorWorkspaceNounTitle,
    workspaceObjectNounPlural,
    resolvedLockedBucketName,
    showWorkspaceSidebar,
  } = resolveBrowserWorkspaceContext({
    pathname: location.pathname,
    workspaceSurface,
    lockedBucketName,
  });
  const accountIdForApi = accountIdOverride ?? browserContext.selectorForApi;
  const hasS3AccountContext = hasContextOverride ?? browserContext.hasContext;
  const canOpenRoutedObjectDetails = Boolean(onOpenObjectDetailsRoute);
  const canCreateRoutedPublicLink = Boolean(onCreatePublicLinkForObject);
  const browserRequestOptions = useMemo<BrowserRequestOptions | undefined>(
    () =>
      workspaceSurface === "portal" || workspaceSurface === "manager"
        ? { workspaceSurface }
        : undefined,
    [workspaceSurface],
  );
  const browserRootContextId =
    accountIdForApi == null ? null : String(accountIdForApi);
  const bucketAccessContextKey =
    accountIdForApi == null ? null : `${workspaceSurface}:${String(accountIdForApi)}`;
  const storedUser = useMemo(() => readStoredUser(), []);
  const userBrowserAdvancedFeaturesEnabled = storedUser
    ? storedUser.authType === "s3_session" ||
      Boolean(
        storedUser.effective_access?.browser_advanced_features_enabled ??
          storedUser.browser_advanced_features_enabled,
      )
    : true;
  const rootBrowserAdvancedFeaturesEnabled =
    !isMainBrowserPath || userBrowserAdvancedFeaturesEnabled;
  const initialStoredRootUiState = useMemo(
    () => (isMainBrowserPath ? readStoredBrowserRootUiState() : null),
    [isMainBrowserPath],
  );
  const resolvedFunctionalProfile: BrowserFunctionalProfile =
    functionalProfileOverride ??
    (isPortalBrowserSurface
      ? "portal"
      : rootBrowserAdvancedFeaturesEnabled
        ? "advanced"
        : "standard");
  const initialLayoutMode: BrowserLayoutMode =
    layoutModeOverride ??
    (isMainBrowserPath && rootBrowserAdvancedFeaturesEnabled
      ? (initialStoredRootUiState?.activeLayout ?? "standard")
      : "standard");
  const initialRootUiLayout = isMainBrowserPath
    ? initialStoredRootUiState?.layouts[initialLayoutMode] ?? null
    : null;
  const resolvedCapabilityFacts = useMemo<BrowserCapabilityFacts>(
    () =>
      capabilityFactsOverride ?? {
        ...FULL_BROWSER_CAPABILITY_FACTS,
        canCreatePublicLinks: Boolean(onCreatePublicLinkForObject),
      },
    [capabilityFactsOverride, onCreatePublicLinkForObject],
  );
  const isPortalProfile = resolvedFunctionalProfile === "portal";
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
  const [usageSummary, setUsageSummary] =
    useState<BrowserUsageSummary | null>(null);
  const [usageSummaryLoading, setUsageSummaryLoading] = useState(false);
  const [usageSummaryError, setUsageSummaryError] = useState<string | null>(
    null,
  );
  const [searchParams] = useSearchParams();
  const requestedBucket = useMemo(
    () => searchParams.get("bucket")?.trim() ?? "",
    [searchParams],
  );
  const requestedPrefix = useMemo(
    () => normalizePrefix(searchParams.get("prefix")?.trim() ?? ""),
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
  const [activeLayoutMode, setActiveLayoutMode] =
    useState<BrowserLayoutMode>(initialLayoutMode);
  const [foldersPanelWidthPx, setFoldersPanelWidthPx] = useState(
    () =>
      initialRootUiLayout?.foldersPanelWidthPx ??
      DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  );
  const [inspectorPanelWidthPx, setInspectorPanelWidthPx] = useState(
    () =>
      initialRootUiLayout?.inspectorPanelWidthPx ??
      DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
  );
  const [layoutContainerWidthPx, setLayoutContainerWidthPx] = useState(0);
  const [activePanelResize, setActivePanelResize] = useState<
    "folders" | "inspector" | null
  >(null);
  const [columnWidths, setColumnWidths] = useState<BrowserObjectColumnWidths>(
    () => loadColumnWidthsForSurface(isMainBrowserPath, initialLayoutMode),
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
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_OBJECT_LIST_MEDIA_QUERY).matches;
  });
  const [inspectorTab, setInspectorTab] = useState<
    "context" | "bucket" | "selection" | "details"
  >("context");
  const enforcedRootProfileDensity: BrowserDensity | null =
    isMainBrowserPath && resolvedFunctionalProfile !== "advanced"
      ? resolvedFunctionalProfile === "portal"
        ? "compact"
        : "comfortable"
      : null;
  const [density, setDensity] = useState<BrowserDensity>(
    () =>
      densityOverride ??
      enforcedRootProfileDensity ??
      (isMainBrowserPath
        ? (initialStoredRootUiState?.density ?? "comfortable")
        : "compact"),
  );
  const effectiveDensity: BrowserDensity =
    densityOverride ?? enforcedRootProfileDensity ?? density;
  const compactMode = effectiveDensity === "compact";
  const canConfigureRootBrowserView =
    isMainBrowserPath && resolvedFunctionalProfile === "advanced";
  const rowActionTargetSizePx = compactMode
    ? COMPACT_ROW_ACTION_TARGET_SIZE_PX
    : COMFORTABLE_ROW_ACTION_TARGET_SIZE_PX;
  const maximumDirectItemActionCount =
    1 +
    Number(resolvedCapabilityFacts.canDeleteObjects) +
    Number(
      isPortalProfile &&
        resolvedCapabilityFacts.canCreatePublicLinks &&
        canCreateRoutedPublicLink,
    );
  const actionsColumnButtonCount = 1 + maximumDirectItemActionCount;
  const actionsColumnWidthPx = Math.max(
    MIN_ACTIONS_COLUMN_WIDTH_PX,
    ROW_ACTION_CELL_HORIZONTAL_PADDING_PX +
      actionsColumnButtonCount * rowActionTargetSizePx +
      (actionsColumnButtonCount - 1) * ROW_ACTION_GAP_PX,
  );
  const setCompactMode = (value: boolean) =>
    setDensity(value ? "compact" : "comfortable");
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
  const [bucketVersioningAvailable, setBucketVersioningAvailable] =
    useState(false);
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
  const [sseCustomerInitialSignature, setSseCustomerInitialSignature] = useState(() =>
    stableSignature({ sseCustomerKeyInput: "" })
  );
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
  const [showMobileActionsSheet, setShowMobileActionsSheet] = useState(false);
  const [showToolbarColumnsMenu, setShowToolbarColumnsMenu] = useState(false);
  const [showUploadQuickMenu, setShowUploadQuickMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<BrowserColumnId[]>(
    () => loadVisibleColumnsForSurface(isMainBrowserPath, initialLayoutMode),
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
  const [internalShowDeletedObjects, setInternalShowDeletedObjects] =
    useState(false);
  const showDeletedObjects =
    deletedObjectsOptions?.visible ?? internalShowDeletedObjects;
  const setDeletedObjectsVisibility = useCallback(
    (visible: boolean) => {
      if (deletedObjectsOptions?.visible === undefined) {
        setInternalShowDeletedObjects(visible);
      }
      deletedObjectsOptions?.onVisibilityChange?.(visible);
    },
    [deletedObjectsOptions],
  );
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
  const [createBucketInitialSignature, setCreateBucketInitialSignature] = useState(() =>
    stableSignature({ createBucketNameValue: "", createBucketVersioning: false })
  );
  const [createBucketLoading, setCreateBucketLoading] = useState(false);
  const [createBucketError, setCreateBucketError] = useState<string | null>(
    null,
  );
  const invalidBucketNameMessage =
    "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.";
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderInitialSignature, setNewFolderInitialSignature] = useState(() =>
    stableSignature({ newFolderName: "" })
  );
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [newFolderLoading, setNewFolderLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] =
    useState<BrowserConfirmDialogState | null>(null);
  const [confirmDialogLoading, setConfirmDialogLoading] = useState(false);
  const [copyDialog, setCopyDialog] = useState<BrowserCopyDialogState | null>(
    null,
  );
  const [operationsPanelOpen, setOperationsPanelOpen] = useState(false);
  const [operationsPanelDismissed, setOperationsPanelDismissed] = useState(false);
  const operationsPanelVisibleRef = useRef(false);
  const [showOperationsDetailsModal, setShowOperationsDetailsModal] = useState(false);
  const showOperationsBar = useCallback(() => {
    setOperationsPanelOpen((open) => (operationsPanelVisibleRef.current ? open : false));
    setOperationsPanelDismissed(false);
  }, []);
  const dismissOperationsPanel = useCallback(() => {
    setOperationsPanelOpen(false);
    setOperationsPanelDismissed(true);
  }, []);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const [pathSuggestionsLoading, setPathSuggestionsLoading] = useState(false);
  const [pathSuggestionIndex, setPathSuggestionIndex] = useState(-1);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
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
  const mobileMoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileActionsSheetRef = useRef<HTMLDivElement | null>(null);
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
  const newFolderInputRef = useRef<HTMLInputElement>(null);
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
  const {
    quotaSizeBytes: cephContextQuotaSizeBytes,
    quotaObjects: cephContextQuotaObjects,
  } = resolveBrowserContextQuotas(
    effectiveContextQuotaSizeGb,
    effectiveContextQuotaObjects,
    usageSummary
  );
  const isCephContext = effectiveContextEndpointProvider === "ceph";
  const showLayoutModeToggle =
    showPanelToggles && isMainBrowserPath && rootBrowserAdvancedFeaturesEnabled;
  const bucketManagementEnabled =
    normalizedPath.endsWith("/browser") &&
    !isEmbeddedBrowserPath &&
    resolvedFunctionalProfile === "advanced";
  const bucketConfigurationEnabled =
    resolvedFunctionalProfile === "advanced";
  const executionContextKind =
    executionContextKindOverride ?? selectedContext?.kind ?? null;
  const isCephAdminContext = executionContextKind === "ceph_admin";
  const isS3UserContext = executionContextKind === "s3_user";
  const isConnectionContext = executionContextKind === "connection";
  const directCredentialContextKind = isConnectionContext
    ? "connection"
    : isS3UserContext
      ? "s3_user"
      : null;
  const stsEnabled =
    Boolean(effectiveCaps?.sts) &&
    directCredentialContextKind === null &&
    !isPortalProfile;
  const sseFeatureEnabled =
    Boolean(effectiveCaps?.sse) && resolvedFunctionalProfile === "advanced";
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
  const canPasteInFunctionalProfile =
    canPaste &&
    (resolvedFunctionalProfile === "advanced" || clipboardMatchesContext);
  const {
    canUseFoldersPanel,
    canUseInspectorPanel,
    isFoldersPanelVisible,
    isInspectorPanelVisible,
  } = resolveBrowserPanelVisibility({
    allowFoldersPanel:
      allowFoldersPanel &&
      activeLayoutMode === "workbench" &&
      resolvedFunctionalProfile === "advanced",
    allowInspectorPanel:
      allowInspectorPanel &&
      activeLayoutMode === "workbench" &&
      resolvedFunctionalProfile === "advanced",
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
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(MOBILE_OBJECT_LIST_MEDIA_QUERY);
    const syncViewportWidth = () => setIsMobileViewport(mediaQuery.matches);
    syncViewportWidth();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewportWidth);
      return () => mediaQuery.removeEventListener("change", syncViewportWidth);
    }
    mediaQuery.addListener(syncViewportWidth);
    return () => mediaQuery.removeListener(syncViewportWidth);
  }, []);

  useEffect(() => {
    if (!isMainBrowserPath) return;
    writeBrowserRootUiLayout({
      showFolders,
      showInspector,
    }, activeLayoutMode);
  }, [activeLayoutMode, isMainBrowserPath, showFolders, showInspector]);

  useEffect(() => {
    if (!isMainBrowserPath || resolvedFunctionalProfile !== "advanced") return;
    writeBrowserRootActiveLayout(activeLayoutMode);
  }, [activeLayoutMode, isMainBrowserPath, resolvedFunctionalProfile]);

  useEffect(() => {
    if (!isMainBrowserPath || resolvedFunctionalProfile !== "advanced") return;
    writeBrowserRootDensity(density);
  }, [density, isMainBrowserPath, resolvedFunctionalProfile]);

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
    if (!isMainBrowserPath) return;
    writeBrowserRootUiPanelWidths({
      foldersPanelWidthPx,
      inspectorPanelWidthPx,
    });
  }, [activePanelResize, foldersPanelWidthPx, inspectorPanelWidthPx, isMainBrowserPath]);

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
    setVisibleColumns(loadVisibleColumnsForSurface(isMainBrowserPath, activeLayoutMode));
  }, [activeLayoutMode, isMainBrowserPath]);

  useEffect(() => {
    persistVisibleColumnsForSurface(isMainBrowserPath, visibleColumns, activeLayoutMode);
  }, [activeLayoutMode, isMainBrowserPath, visibleColumns]);

  useEffect(() => {
    setColumnWidths(loadColumnWidthsForSurface(isMainBrowserPath, activeLayoutMode));
  }, [activeLayoutMode, isMainBrowserPath]);

  useEffect(() => {
    if (activeColumnResize) return;
    persistColumnWidthsForSurface(isMainBrowserPath, columnWidths, activeLayoutMode);
  }, [activeColumnResize, activeLayoutMode, columnWidths, isMainBrowserPath]);

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

  const changeLayoutMode = useCallback(
    (nextMode: BrowserLayoutMode) => {
      if (!isMainBrowserPath || resolvedFunctionalProfile !== "advanced") return;
      const nextLayout = readBrowserRootUiState().layouts[nextMode];
      setShowFolders(nextLayout.showFolders);
      setShowInspector(nextLayout.showInspector);
      setFoldersPanelWidthPx(nextLayout.foldersPanelWidthPx);
      setInspectorPanelWidthPx(nextLayout.inspectorPanelWidthPx);
      setVisibleColumns(loadVisibleColumnsForSurface(true, nextMode));
      setColumnWidths(loadColumnWidthsForSurface(true, nextMode));
      setActiveLayoutMode(nextMode);
    },
    [isMainBrowserPath, resolvedFunctionalProfile],
  );

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
        ...browserRequestOptions,
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
  }, [
    accountIdForApi,
    browserRequestOptions,
    hasS3AccountContext,
    updateBucketAccessEntry,
  ]);

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
    const nextInput = sseCustomerKeyBase64 ?? "";
    setSseCustomerKeyInput(nextInput);
    setSseCustomerInitialSignature(stableSignature({ sseCustomerKeyInput: nextInput }));
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
      setSseCustomerInitialSignature(stableSignature({ sseCustomerKeyInput }));
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
      setSseCustomerInitialSignature(stableSignature({ sseCustomerKeyInput: generatedKey }));
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
    setSseCustomerInitialSignature(stableSignature({ sseCustomerKeyInput: "" }));
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
  const isVersioningEnabled = bucketVersioningAvailable;
  useEffect(() => {
    bucketNameRef.current = bucketName;
    prefixRef.current = prefix;
  }, [bucketName, prefix]);
  useEffect(() => {
    onSelectedBucketNameChange?.(bucketName);
  }, [bucketName, onSelectedBucketNameChange]);
  useEffect(() => {
    return () => {
      onSelectedBucketNameChange?.("");
    };
  }, [onSelectedBucketNameChange]);
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
  const transferParallelism = useMemo(
    () =>
      resolveBrowserTransferParallelism(browserSettings, useProxyTransfers),
    [browserSettings, useProxyTransfers],
  );
  const uploadParallelism = transferParallelism.upload;
  const uploadParallelismRef = useRef(uploadParallelism);
  useEffect(() => {
    uploadParallelismRef.current = uploadParallelism;
  }, [uploadParallelism]);
  const downloadParallelism = transferParallelism.download;
  const downloadParallelismRef = useRef(downloadParallelism);
  useEffect(() => {
    downloadParallelismRef.current = downloadParallelism;
  }, [downloadParallelism]);
  useEffect(() => {
    stsCredentialsRef.current = stsCredentials;
  }, [stsCredentials]);
  const otherOperationsParallelism = transferParallelism.otherOperations;
  const otherOperationsParallelismRef = useRef(otherOperationsParallelism);
  useEffect(() => {
    otherOperationsParallelismRef.current = otherOperationsParallelism;
  }, [otherOperationsParallelism]);
  const proxyAllowed = browserSettings?.allow_proxy_transfers ?? false;
  const ensureStsCredentials = useCallback(
    async (force = false) => {
      if (!hasS3AccountContext || !stsEnabled || !stsStatus?.available) {
        setStsCredentials(null);
        setStsCredentialsError(null);
        return null;
      }
      const current = stsCredentialsRef.current;
      if (
        !force &&
        current &&
        !isStsCredentialsExpiring(current.expiration)
      ) {
        return current;
      }
      if (stsRefreshRef.current) {
        return stsRefreshRef.current;
      }
      const request = getStsCredentials(accountIdForApi, browserRequestOptions)
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
    [
      accountIdForApi,
      browserRequestOptions,
      hasS3AccountContext,
      stsEnabled,
      stsStatus?.available,
    ],
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
        browserRequestOptions,
      );
    },
    [
      accountIdForApi,
      browserRequestOptions,
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
        browserRequestOptions,
      );
    },
    [
      accountIdForApi,
      browserRequestOptions,
      ensureStsCredentials,
      sseCustomerKeyBase64,
      useStsPresigner,
    ],
  );
  const warnings = useMemo(
    () =>
      buildBrowserTransferWarnings({
        warningMessage,
        corsFixError,
        stsCredentialsError,
        corsEnabled: corsStatus?.enabled ?? null,
        proxyAllowed,
      }),
    [
      corsFixError,
      corsStatus?.enabled,
      proxyAllowed,
      stsCredentialsError,
      warningMessage,
    ],
  );
  const hasCorsAction = Boolean(
    !isPortalProfile && corsStatus && !corsStatus.enabled && uiOrigin,
  );
  const stsExpirationLabel = useMemo(() => {
    if (!stsCredentials?.expiration) return "";
    const formatted = formatDateTime(stsCredentials.expiration);
    return formatted === "-" ? "" : formatted;
  }, [stsCredentials?.expiration]);
  const directCredentialStsTooltip = useMemo(
    () => resolveDirectCredentialStsTooltip(directCredentialContextKind),
    [directCredentialContextKind],
  );
  const accessBadge = useMemo(
    () =>
      resolveBrowserTransferAccessBadge({
        hasContext: hasS3AccountContext,
        corsEnabled: corsStatus?.enabled ?? null,
        proxyAllowed,
        useProxyTransfers,
        sseActive,
        hasStsCredentials: Boolean(stsCredentials),
        stsExpirationLabel,
        directCredentialStsTooltip,
      }),
    [
      corsStatus?.enabled,
      hasS3AccountContext,
      directCredentialStsTooltip,
      proxyAllowed,
      sseActive,
      stsCredentials,
      stsExpirationLabel,
      useProxyTransfers,
    ],
  );
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
    if (!showMobileActionsSheet) return;
    const sheet = mobileActionsSheetRef.current;
    const focusable = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowMobileActionsSheet(false);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const triggerButton = mobileMoreButtonRef.current;
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerButton?.focus();
    };
  }, [showMobileActionsSheet]);

  useEffect(() => {
    if (!isMobileViewport || selectedIds.length === 0) {
      setShowMobileActionsSheet(false);
    }
  }, [isMobileViewport, selectedIds.length]);

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
      if (resolvedLockedBucketName) {
        const previousBucket = bucketNameRef.current;
        const previousPrefix = prefixRef.current;
        setLoadingBuckets(false);
        setBucketMenuLoadingMore(false);
        setBucketError(null);
        setBucketMenuItems([{ name: resolvedLockedBucketName }]);
        setBucketMenuPage(1);
        setBucketMenuHasNext(false);
        setBucketMenuTotal(1);
        setBucketTotalCount(1);
        bucketSearchValueRef.current = "";
        setBucketAccessByName({});
        setBucketName(resolvedLockedBucketName);
        setPrefix(
          requestedPrefix || (previousBucket === resolvedLockedBucketName ? previousPrefix : ""),
        );
        if (isMainBrowserPath) {
          browserRootSelectionContextIdRef.current = browserRootContextId;
          browserRootSelectionPersistenceReadyRef.current = true;
        }
        return;
      }
      setLoadingBuckets(true);
      setBucketMenuLoadingMore(false);
      setBucketError(null);
      try {
        const firstPage = await searchBrowserBuckets(accountIdForApi, {
          page: 1,
          pageSize: BUCKET_MENU_LIMIT,
          ...browserRequestOptions,
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
            ...browserRequestOptions,
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
          if (bucketSource === "requested" || bucketSource === "ceph-requested") {
            nextPrefix = requestedPrefix;
          } else {
            nextPrefix = bucketSource === "preferred" || nextBucket !== previousBucket ? "" : previousPrefix;
          }
        }
        setBucketName(nextBucket);
        setPrefix(nextPrefix);
        if (isMainBrowserPath) {
          browserRootSelectionContextIdRef.current = browserRootContextId;
          browserRootSelectionPersistenceReadyRef.current = true;
        }
      } catch (err) {
        bucketSearchValueRef.current = "";
        setBucketError(extractBucketListError(err, usePortalWorkspaceLabels));
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
      browserRequestOptions,
      hasS3AccountContext,
      isCephAdminContext,
      isMainBrowserPath,
      requestedBucket,
      requestedPrefix,
      resolvedLockedBucketName,
      resetBucketAccessQueue,
      usePortalWorkspaceLabels,
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
      if (resolvedLockedBucketName) {
        setBucketMenuItems([{ name: resolvedLockedBucketName }]);
        setBucketMenuPage(1);
        setBucketMenuHasNext(false);
        setBucketMenuTotal(1);
        setBucketTotalCount(1);
        setLoadingBuckets(false);
        setBucketMenuLoadingMore(false);
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
          ...browserRequestOptions,
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
        setBucketError(extractBucketListError(err, usePortalWorkspaceLabels));
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
    [
      accountIdForApi,
      browserRequestOptions,
      hasS3AccountContext,
      resolvedLockedBucketName,
      resetBucketAccessQueue,
      usePortalWorkspaceLabels,
    ],
  );

  const bucketSearchUiActive =
    showBucketMenu || showWorkspaceSidebar;

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
    loadBucketSearchPage,
  ]);

  useEffect(() => {
    if (!hasS3AccountContext || !accountIdForApi) {
      setBrowserSettings(null);
      return;
    }
    let isMounted = true;
    fetchBrowserSettings(accountIdForApi, browserRequestOptions)
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
  }, [accountIdForApi, accessMode, browserRequestOptions, hasS3AccountContext]);

  useEffect(() => {
    if (!showWorkspaceSidebar || !hasS3AccountContext || !accountIdForApi) {
      setUsageSummary(null);
      setUsageSummaryLoading(false);
      setUsageSummaryError(null);
      return;
    }
    let isMounted = true;
    setUsageSummaryLoading(true);
    setUsageSummaryError(null);
    fetchBrowserUsageSummary(accountIdForApi, browserRequestOptions)
      .then((data) => {
        if (!isMounted) return;
        setUsageSummary(data.available ? data : null);
      })
      .catch((err) => {
        if (!isMounted) return;
        setUsageSummary(null);
        setUsageSummaryError(extractApiError(err, "Usage is not available."));
      })
      .finally(() => {
        if (isMounted) {
          setUsageSummaryLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [
    accountIdForApi,
    browserRequestOptions,
    hasS3AccountContext,
    showWorkspaceSidebar,
  ]);

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
        signal?: AbortSignal;
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
      const requestedVersionPrefix =
        isPortalProfile && queryValue
          ? `${targetPrefix}${queryValue.replace(/^\/+/, "")}`
          : targetPrefix;

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

      let nextKeyMarker = opts?.keyMarker ?? null;
      let nextVersionIdMarker = opts?.versionIdMarker ?? null;
      let isTruncated = true;
      let scannedEntries = 0;
      let firstPage = true;
      while (
        isTruncated &&
        scannedEntries < DELETED_VERSIONS_SCAN_LIMIT &&
        (firstPage ||
          latestMarkersByKey.size + markerPrefixes.size <
            DELETED_RESULTS_TARGET)
      ) {
        const data = await listObjectVersions(accountIdForApi, bucketName, {
          prefix: requestedVersionPrefix,
          delimiter: isRecursiveSearch ? undefined : "/",
          keyMarker: nextKeyMarker ?? undefined,
          versionIdMarker: nextVersionIdMarker ?? undefined,
          maxKeys: VERSIONS_PAGE_SIZE,
          signal: opts?.signal,
          requestOptions: browserRequestOptions,
        });
        firstPage = false;
        scannedEntries +=
          data.versions.length +
          data.delete_markers.length +
          (data.common_prefixes?.length ?? 0);
        (data.common_prefixes ?? []).forEach((prefixKey) => {
          if (typeFilter === "file") return;
          if (!prefixKey.startsWith(targetPrefix)) return;
          if (activePrefixes.has(prefixKey)) return;
          if (!matchesQuery(prefixKey)) return;
          markerPrefixes.add(prefixKey);
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
          if (typeFilter !== "file" && isRecursiveSearch) {
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
            if (
              isFolderMarker &&
              !activePrefixes.has(marker.key) &&
              matchesQuery(marker.key)
            ) {
              markerPrefixes.add(marker.key);
            }
          }
          if (typeFilter === "folder" || isFolderMarker) return;
          if (activeKeys.has(marker.key)) return;
          if (!matchesQuery(marker.key)) return;
          latestMarkersByKey.set(marker.key, marker);
        });
        nextKeyMarker = data.next_key_marker ?? null;
        nextVersionIdMarker = data.next_version_id_marker ?? null;
        isTruncated = Boolean(
          data.is_truncated && (nextKeyMarker || nextVersionIdMarker),
        );
      }

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
      return {
        deletedObjects: deletedObjectRows,
        deletedPrefixes: deletedFolderRows,
        nextKeyMarker,
        nextVersionIdMarker,
        isTruncated,
      };
    },
    [
      accountIdForApi,
      browserRequestOptions,
      bucketName,
      hasS3AccountContext,
      isPortalProfile,
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
      forceRefresh?: boolean;
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
            forceRefresh: opts?.forceRefresh,
            ...browserRequestOptions,
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
                signal: controller.signal,
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
      browserRequestOptions,
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
          requestOptions: browserRequestOptions,
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
    [
      accountIdForApi,
      browserRequestOptions,
      bucketName,
      hasS3AccountContext,
      isVersioningEnabled,
      normalizedPrefix,
    ],
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
          requestOptions: browserRequestOptions,
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
    [
      accountIdForApi,
      browserRequestOptions,
      bucketName,
      hasS3AccountContext,
      isVersioningEnabled,
    ],
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
    browserRequestOptions,
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
    if (isPortalProfile) {
      setShowSearchOptionsMenu(false);
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
      if (typeFilter !== "all") {
        setTypeFilter("all");
      }
      if (storageFilter !== "all") {
        setStorageFilter("all");
      }
      return;
    }
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
    isPortalProfile,
    searchCaseSensitive,
    searchExactMatch,
    searchRecursive,
    searchScope,
    storageFilter,
    typeFilter,
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
      setBucketVersioningAvailable(false);
      return;
    }
    let active = true;
    getBucketVersioning(accountIdForApi, bucketName, browserRequestOptions)
      .then((data) => {
        if (!active) return;
        setBucketVersioningAvailable(
          data.status === "Enabled" || data.status === "Suspended",
        );
      })
      .catch(() => {
        if (!active) return;
        setBucketVersioningAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [
    accountIdForApi,
    accountSwitchInFlight,
    bucketName,
    browserRequestOptions,
    hasS3AccountContext,
  ]);

  useEffect(() => {
    if (isVersioningEnabled) return;
    setInternalShowDeletedObjects(false);
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
          ...browserRequestOptions,
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
    [accountIdForApi, browserRequestOptions, bucketName, hasS3AccountContext],
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
    getBucketCorsStatus(accountIdForApi, bucketName, uiOrigin, browserRequestOptions)
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
    browserRequestOptions,
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
    getStsStatus(accountIdForApi, browserRequestOptions)
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
  }, [accountIdForApi, accessMode, browserRequestOptions, hasS3AccountContext, stsEnabled]);

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

  const items = useMemo(
    () =>
      buildBrowserItems(
        prefixes,
        deletedPrefixes,
        objects,
        deletedObjects,
        displayPrefixForItems,
      ),
    [
      deletedObjects,
      deletedPrefixes,
      displayPrefixForItems,
      objects,
      prefixes,
    ],
  );
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
  const effectiveVisibleColumns = isPortalProfile
    ? DEFAULT_VISIBLE_COLUMN_IDS
    : visibleColumns;
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
          actionsColumnWidthPx +
          visibleColumnDefinitions.reduce(
            (sum, definition) => sum + visibleColumnWidthsPx[definition.id],
            0,
          ),
      ),
    [
      actionsColumnWidthPx,
      nameColumnWidthPx,
      visibleColumnDefinitions,
      visibleColumnWidthsPx,
    ],
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
      !isPortalProfile &&
    (searchScope !== "prefix" ||
      searchRecursive ||
      searchExactMatch ||
      searchCaseSensitive ||
      typeFilter !== "all" ||
      storageFilter !== "all");
  const hasActiveSearchFilters =
    hasSearchQuery ||
      (!isPortalProfile &&
      (searchScope === "bucket" ||
        searchRecursive ||
        searchExactMatch ||
        searchCaseSensitive ||
        typeFilter !== "all" ||
        storageFilter !== "all"));
  const canResetSearchFilters =
    hasSearchQuery ||
      (!isPortalProfile &&
      (searchScope !== "prefix" ||
        searchRecursive ||
        searchExactMatch ||
        searchCaseSensitive ||
        typeFilter !== "all" ||
        storageFilter !== "all"));
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
  const bucketDisplayNameByName = useMemo(() => {
    const next = new Map<string, string>();
    bucketMenuItems.forEach((bucket) => {
      const displayName =
        usePortalWorkspaceLabels
          ? bucket.display_name?.trim() || bucket.workspace_label?.trim() || bucket.name
          : bucket.display_name?.trim() || bucket.name;
      next.set(bucket.name, displayName);
    });
    if (resolvedLockedBucketName && lockedBucketLabel?.trim()) {
      next.set(resolvedLockedBucketName, lockedBucketLabel.trim());
    }
    return next;
  }, [bucketMenuItems, lockedBucketLabel, resolvedLockedBucketName, usePortalWorkspaceLabels]);
  const bucketButtonLabel = useMemo(() => {
    if (resolvedLockedBucketName) {
      return lockedBucketLabel?.trim() || resolvedLockedBucketName;
    }
    if (bucketName) return bucketDisplayNameByName.get(bucketName) ?? bucketName;
    if (loadingBuckets) return `Loading ${selectorWorkspaceNounPlural}...`;
    if (bucketTotalCount === 0) return `No ${selectorWorkspaceNounPlural}`;
    return `Select ${selectorWorkspaceNoun}`;
  }, [
    bucketDisplayNameByName,
    bucketName,
    bucketTotalCount,
    loadingBuckets,
    lockedBucketLabel,
    resolvedLockedBucketName,
    selectorWorkspaceNoun,
    selectorWorkspaceNounPlural,
  ]);
  const bucketSelectorNeedsAttention =
    hasS3AccountContext && !bucketName && bucketTotalCount > 0;
  const bucketButtonClassName = cx(
    bucketButtonClasses,
    bucketSelectorNeedsAttention
      ? "border-amber-300 bg-amber-50 text-amber-800 ring-2 ring-amber-200/70 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-400/30"
      : "border-slate-200 bg-white text-slate-700 hover:border-primary/60 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:bg-slate-800",
  );
  const bucketButtonActionLabel = resolvedLockedBucketName
    ? `Selected ${selectorWorkspaceNoun}`
    : `Select ${selectorWorkspaceNoun}`;
  const useBucketsPanel = showWorkspaceSidebar;
  const { currentBucket: currentBucketPanelItem } = useMemo(
    () => splitBucketPanelBuckets(bucketName, bucketMenuItems),
    [bucketMenuItems, bucketName],
  );
  const workspaceSidebarRows = useMemo(
    () =>
      bucketMenuItems.map((bucket) => ({
        bucket,
        access: resolveBucketAccessEntry(bucket.name, bucketAccessByName),
      })),
    [bucketAccessByName, bucketMenuItems],
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
      if (resolvedLockedBucketName) return;
      if (!value || value === bucketName) return;
      setBucketName(value);
      setPrefix("");
      setActiveItem(null);
    },
    [bucketName, resolvedLockedBucketName],
  );
  const workspaceAccountActionTarget = useMemo<"manager" | "portal" | null>(() => {
    if (
      selectedContext?.manager_account_is_admin === true ||
      selectedContext?.kind === "s3_user"
    ) {
      return "manager";
    }
    if (selectedContext?.kind === "portal_account" || isPortalBrowserSurface) {
      return accountIdForApi != null ? "portal" : null;
    }
    return null;
  }, [accountIdForApi, isPortalBrowserSurface, selectedContext]);
  const handleOpenWorkspaceAccount = useCallback(() => {
    if (!workspaceAccountActionTarget) return;
    if (workspaceAccountActionTarget === "manager") {
      const contextId = selectedContext?.id ?? (typeof accountIdForApi === "string" ? accountIdForApi : null);
      if (!contextId) return;
      writeClientStorage(CLIENT_STORAGE_KEYS.selectedManagerExecutionContext, contextId);
      writeClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace, "manager");
      navigate(`/manager?ctx=${encodeURIComponent(contextId)}`);
      return;
    }
    if (accountIdForApi == null) return;
    writeClientStorage(CLIENT_STORAGE_KEYS.selectedPortalAccount, String(accountIdForApi));
    writeClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace, "portal");
    navigate(`/portal?project=${encodeURIComponent(String(accountIdForApi))}`);
  }, [accountIdForApi, navigate, selectedContext, workspaceAccountActionTarget]);
  const workspaceAccountAction = useMemo(() => {
    if (workspaceAccountActionTarget === "manager") {
      return {
        label: "Open in Manager",
        title: "Open this account in Manager",
        onClick: handleOpenWorkspaceAccount,
      };
    }
    if (workspaceAccountActionTarget === "portal") {
      return {
        label: "Open in Portal",
        title: "Open this account in Portal",
        onClick: handleOpenWorkspaceAccount,
      };
    }
    return undefined;
  }, [handleOpenWorkspaceAccount, workspaceAccountActionTarget]);

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
  }, [scheduleBucketAccessProbe, useBucketsPanel, workspaceSidebarRows]);

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

  const availableStorageClasses = useMemo(
    () => collectAvailableStorageClasses(items),
    [items],
  );
  const searchableStorageClasses = useMemo(() => {
    const ordered = storageClassOptions.map((option) => option.value);
    const known = new Set(ordered);
    const unknown = availableStorageClasses
      .filter((value) => !known.has(value))
      .sort((a, b) => a.localeCompare(b));
    return [...ordered, ...unknown];
  }, [availableStorageClasses]);

  const pathStats = useMemo(() => buildBrowserPathStats(items), [items]);

  const bucketInspectorData = useMemo(
    () => (bucketName ? (bucketInspectorByName[bucketName] ?? null) : null),
    [bucketInspectorByName, bucketName],
  );
  const cephQuotaScopeLabel = isS3UserContext
    ? "User quota"
    : "Account quota";
  const bucketInspectorFeatures = useMemo(
    () => buildBucketInspectorFeatures(bucketInspectorData),
    [bucketInspectorData],
  );
  const inspectedItem = useMemo(() => {
    if (activeItem && items.some((entry) => entry.id === activeItem.id)) {
      return activeItem;
    }
    return null;
  }, [activeItem, items]);

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
  const primaryItemButtonHeightClasses = compactMode ? "" : "min-h-11";
  const rowActionButtonClasses = compactMode
    ? `${iconButtonClasses} !h-6 !w-6`
    : iconButtonClasses;
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
        canPaste: canPasteInFunctionalProfile,
        clipboardMode: clipboard?.mode ?? null,
        currentPath,
        showFolderItems,
        showDeletedObjects,
        restoreAvailable: Boolean(deletedObjectsOptions?.onRestorePrefix),
        refreshPending: objectsLoading,
        functionalProfile: resolvedFunctionalProfile,
        capabilityFacts: resolvedCapabilityFacts,
        multipartUploadsAvailable: resolvedFunctionalProfile === "advanced",
        bucketConfigurationAvailable: bucketConfigurationEnabled,
      }),
    [
      bucketName,
      canPasteInFunctionalProfile,
      clipboard?.mode,
      currentPath,
      hasS3AccountContext,
      isVersioningEnabled,
      deletedObjectsOptions?.onRestorePrefix,
      objectsLoading,
      resolvedCapabilityFacts,
      resolvedFunctionalProfile,
      bucketConfigurationEnabled,
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
        canPaste: canPasteInFunctionalProfile,
        clipboardMode: clipboard?.mode ?? null,
        copyUrlDisabled: sseActive,
        copyUrlDisabledReason,
        functionalProfile: resolvedFunctionalProfile,
        capabilityFacts: resolvedCapabilityFacts,
      }),
    [
      bucketName,
      canPasteInFunctionalProfile,
      clipboard?.mode,
      copyUrlDisabledReason,
      hasS3AccountContext,
      isVersioningEnabled,
      resolvedCapabilityFacts,
      resolvedFunctionalProfile,
      selectionItems,
      sseActive,
    ],
  );
  const resolveItemActionStates = useCallback(
    (item: BrowserItem) =>
      resolveBrowserActions({
        scope: "item",
        items: [item],
        bucketName,
        hasS3AccountContext,
        versioningEnabled: isVersioningEnabled,
        canPaste: canPasteInFunctionalProfile,
        clipboardMode: clipboard?.mode ?? null,
        copyUrlDisabled: sseActive,
        copyUrlDisabledReason,
        publicLinkAvailable: canCreateRoutedPublicLink,
        restoreAvailable: Boolean(deletedObjectsOptions?.onRestoreObject),
        inspectorAvailable:
          canUseInspectorPanel || canOpenRoutedObjectDetails,
        functionalProfile: resolvedFunctionalProfile,
        capabilityFacts: resolvedCapabilityFacts,
        previewAvailable: isBrowserItemPreviewAvailable(item),
      }),
    [
      bucketName,
      canCreateRoutedPublicLink,
      canOpenRoutedObjectDetails,
      canPasteInFunctionalProfile,
      canUseInspectorPanel,
      clipboard?.mode,
      copyUrlDisabledReason,
      deletedObjectsOptions?.onRestoreObject,
      hasS3AccountContext,
      isVersioningEnabled,
      resolvedCapabilityFacts,
      resolvedFunctionalProfile,
      sseActive,
    ],
  );
  const toolbarMorePathActions = useMemo(
    () =>
      getVisibleBrowserActions(
        pathActionStates,
        isPortalProfile && deletedObjectsOptions?.showToggle
          ? [...TOOLBAR_MORE_PATH_ACTION_IDS, "toggleShowDeleted"]
          : TOOLBAR_MORE_PATH_ACTION_IDS,
      ),
    [deletedObjectsOptions?.showToggle, isPortalProfile, pathActionStates],
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
  const inspectedPath = inspectedItem
    ? `${bucketName}/${inspectedItem.key}`
    : currentPath;

  const openObjectDetails = (
    item: BrowserItem,
    requestedTab: ObjectDetailsTabId,
  ) => {
    if (item.type !== "file") return;
    if (onOpenObjectDetailsRoute) {
      const routedInitialTab =
        item.isDeleted
          ? "versions"
          : requestedTab === "preview" ||
              requestedTab === "properties" ||
              requestedTab === "versions"
            ? requestedTab
            : "properties";
      onOpenObjectDetailsRoute({
        bucketName,
        key: item.key,
        name: item.name || item.key,
        initialTab: routedInitialTab,
        isDeleted: Boolean(item.isDeleted),
      });
      return;
    }
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
    const primaryAction = resolveItemPrimaryAction(item, {
      versioningEnabled: isVersioningEnabled,
      previewAvailable: isBrowserItemPreviewAvailable(item),
    });
    if (primaryAction.kind === "open-folder") {
      handleOpenItem(item);
    } else if (primaryAction.kind === "open-versions") {
      openObjectDetails(item, "versions");
    } else if (primaryAction.kind === "open-file") {
      openObjectDetails(item, primaryAction.initialTab);
    }
  };

  const createPublicLinkForItem = (item: BrowserItem) => {
    if (!onCreatePublicLinkForObject || item.type !== "file" || item.isDeleted) return;
    onCreatePublicLinkForObject({
      bucketName,
      key: item.key,
      name: item.name || item.key,
    });
  };

  const restoreDeletedItem = (item: BrowserItem) => {
    if (!item.isDeleted || !deletedObjectsOptions?.onRestoreObject) return;
    deletedObjectsOptions.onRestoreObject({
      bucketName,
      key: item.key,
      name: item.name || item.key,
      deletedAt:
        item.modifiedAt != null ? new Date(item.modifiedAt).toISOString() : null,
      deleteMarkerVersionId: item.deleteMarkerVersionId,
    });
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
    if (onOpenObjectDetailsRoute && item.type === "file") {
      onOpenObjectDetailsRoute({
        bucketName,
        key: item.key,
        name: item.name || item.key,
        initialTab: item.isDeleted ? "versions" : "properties",
        isDeleted: Boolean(item.isDeleted),
      });
      return;
    }
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
        ...browserRequestOptions,
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
    browserRequestOptions,
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
        const payload = await fetchBucketInspectorData({
          accountId: accountIdForApi,
          bucketName,
          includeUsage: bucketInspectorUsageEnabled,
          includeStaticWebsite: bucketInspectorStaticWebsiteEnabled,
        });
        if (bucketInspectorRequestIdRef.current !== requestId) return;
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
    if (event.detail > 1) return;
    openItemPrimaryAction(item);
  };

  const toggleAllSelection = () => {
    if (allSelected) {
      setSelectedIds([]);
      setSelectionAnchorId(null);
      setActiveRowId(null);
      syncInspectorTabWithSelection(0);
      return;
    }
    const nextIds = selectableListItems.map((item) => item.id);
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
    if (!isSelected && !item.isDeleted) {
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
    if (!item.isDeleted && (selectedIds.length !== 1 || selectedIds[0] !== item.id)) {
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
        ...browserRequestOptions,
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
        browserRequestOptions,
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

  const openCreateBucketDialog = useCallback(() => {
    if (!bucketManagementEnabled) return;
    setShowBucketMenu(false);
    setBucketFilter("");
    setCreateBucketNameValue("");
    setCreateBucketVersioning(false);
    setCreateBucketInitialSignature(stableSignature({ createBucketNameValue: "", createBucketVersioning: false }));
    setCreateBucketError(null);
    setShowCreateBucketModal(true);
  }, [bucketManagementEnabled]);

  const renderWorkspaceSidebarBody = useCallback<BrowserSidebarBodyRenderer>(
    ({ compact, variant, closeMobile }) => (
      <BrowserWorkspaceSidebar
        compact={compact}
        variant={variant}
        closeMobile={closeMobile}
        isPortalContext={isPortalBrowserSurface}
        rows={workspaceSidebarRows}
        activeBucketName={bucketName}
        bucketFilter={bucketFilter}
        loadingBuckets={loadingBuckets}
        bucketError={bucketError}
        bucketManagementEnabled={bucketManagementEnabled}
        canLoadMore={canLoadMoreBucketResults}
        bucketMenuLoadingMore={bucketMenuLoadingMore}
        bucketMenuTotal={bucketMenuTotal}
        bucketTotalCount={bucketTotalCount}
        usageSummary={usageSummary}
        usageLoading={usageSummaryLoading}
        usageError={usageSummaryError}
        panelViewportRef={
          variant === "desktop" ? bucketPanelViewportRef : undefined
        }
        loadMoreSentinelRef={
          variant === "desktop" ? bucketPanelLoadMoreSentinelRef : undefined
        }
        onBucketFilterChange={setBucketFilter}
        onRetryBuckets={() => void refreshBucketList()}
        onCreateBucket={openCreateBucketDialog}
        onSelectBucket={handleBucketChange}
        onLoadMore={handleBucketMenuLoadMore}
        workspaceAccountAction={workspaceAccountAction}
      />
    ),
    [
      bucketError,
      bucketFilter,
      bucketManagementEnabled,
      bucketMenuLoadingMore,
      bucketMenuTotal,
      bucketName,
      bucketPanelLoadMoreSentinelRef,
      bucketPanelViewportRef,
      bucketTotalCount,
      canLoadMoreBucketResults,
      handleBucketChange,
      handleBucketMenuLoadMore,
      isPortalBrowserSurface,
      loadingBuckets,
      openCreateBucketDialog,
      refreshBucketList,
      usageSummary,
      usageSummaryError,
      usageSummaryLoading,
      workspaceAccountAction,
      workspaceSidebarRows,
    ],
  );

  useLayoutEffect(() => {
    if (!showWorkspaceSidebar) {
      setSidebarBody(null);
      return;
    }
    setSidebarBody(renderWorkspaceSidebarBody);
    return () => {
      setSidebarBody(null);
    };
  }, [renderWorkspaceSidebarBody, setSidebarBody, showWorkspaceSidebar]);

  const closeCreateBucketDialog = () => {
    if (createBucketLoading) return;
    setShowCreateBucketModal(false);
    setCreateBucketNameValue("");
    setCreateBucketVersioning(false);
    setCreateBucketInitialSignature(stableSignature({ createBucketNameValue: "", createBucketVersioning: false }));
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
        ...browserRequestOptions,
      });
      let corsApplied = false;
      if (uiOrigin) {
        try {
          const status = await ensureBucketCors(
            accountIdForApi,
            bucketNameInput,
            uiOrigin,
            browserRequestOptions,
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
      setCreateBucketNameValue("");
      setCreateBucketVersioning(false);
      setCreateBucketInitialSignature(stableSignature({ createBucketNameValue: "", createBucketVersioning: false }));
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
      const message = extractApiError(err, "Unable to create bucket.");
      setCreateBucketError(message);
    } finally {
      setCreateBucketLoading(false);
    }
  };

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
    [],
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
            ...browserRequestOptions,
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
      browserRequestOptions,
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
        requestOptions: browserRequestOptions,
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
    loadObjects({ prefixOverride: prefix, forceRefresh: true });
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
        browserRequestOptions,
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
      await loadObjects({ prefixOverride, silent: true, forceRefresh: true });
      loadTreeChildren(prefixOverride, { expand: false });
    },
    [loadObjects, loadTreeChildren],
  );
  const previousRefreshTokenRef = useRef(refreshToken);
  useEffect(() => {
    if (
      refreshToken === undefined ||
      refreshToken === previousRefreshTokenRef.current
    ) {
      return;
    }
    previousRefreshTokenRef.current = refreshToken;
    if (bucketName && hasS3AccountContext) {
      void refreshObjectsNow(prefix);
    }
  }, [
    bucketName,
    hasS3AccountContext,
    prefix,
    refreshObjectsNow,
    refreshToken,
  ]);

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
      void loadObjects({
        prefixOverride: currentPrefixValue,
        silent: true,
        forceRefresh: true,
      });
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
      showOperationsBar();
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
    [showOperationsBar],
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
    setNewFolderName("");
    setNewFolderInitialSignature(stableSignature({ newFolderName: "" }));
    setNewFolderError(null);
  };

  const handleNewFolder = () => {
    if (!bucketName || !hasS3AccountContext) return;
    setNewFolderName("");
    setNewFolderInitialSignature(stableSignature({ newFolderName: "" }));
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
      await createFolder(accountIdForApi, bucketName, folderPrefix, browserRequestOptions);
      addActivity("Created", `${bucketName}/${folderPrefix}`);
      setStatusMessage(`Folder ${clean} created`);
      setShowNewFolderModal(false);
      setNewFolderName("");
      setNewFolderInitialSignature(stableSignature({ newFolderName: "" }));
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
          ? { ...item, status: "cancelled" as const, errorMessage: undefined }
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
          ? { ...item, status: "cancelled" as const, errorMessage: undefined }
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
          ? { ...item, status: "cancelled" as const, errorMessage: undefined }
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
      showOperationsBar();
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
        accountId: String(accountIdForApi),
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
    onProgress: (event: AxiosProgressEvent) => void,
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
        undefined,
        browserRequestOptions,
      );
      return;
    }
    const operation = resolveSimpleUploadOperation();
    const presign = await presignObjectRequest(bucket, {
      key,
      operation,
      content_type: file.type || undefined,
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
        browserRequestOptions,
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
      await completeMultipartUpload(
        accountId,
        bucket,
        uploadId,
        key,
        { parts: uploadedParts },
        browserRequestOptions,
      );
      setOperations((prev) =>
        prev.map((op) =>
          op.id === operationId ? { ...op, progress: 100 } : op,
        ),
      );
    } catch (err) {
      if (uploadId) {
        try {
          await abortMultipartUpload(accountId, bucket, uploadId, key, browserRequestOptions);
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
    const reportedTransferId = startReportedTransfer({
      direction: "Upload",
      bucketName: bucket,
      key,
      name: itemLabel || relativePath || file.name,
      sizeBytes: file.size,
    });
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
        const onProgress = (event: AxiosProgressEvent) => {
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
      completeReportedTransfer(reportedTransferId, itemLabel || relativePath || file.name);
      setStatusMessage(`Uploaded ${relativePath}`);
      recordUploadedKey(bucket, key);
    } catch (err) {
      if (isAbortError(err)) {
        completeOperation(operationId, "cancelled");
        failReportedTransfer(reportedTransferId, `Upload cancelled for ${relativePath}`);
        setStatusMessage(`Upload cancelled for ${relativePath}`);
      } else {
        const completionError = formatOperationError(
          err,
          `Upload failed for ${relativePath}`,
          `Upload failed for ${relativePath}`,
        );
        completeOperation(operationId, "failed", completionError);
        failReportedTransfer(reportedTransferId, completionError);
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
      setStatusMessage(`Select a ${workspaceNoun} before uploading.`);
      return;
    }
    handleUploadFiles(files);
  };

  const startReportedTransfer = (input: {
    direction: "Upload" | "Download";
    bucketName: string;
    key: string;
    name: string;
    sizeBytes?: number | null;
  }) => transferReporter?.start(input) ?? null;

  const completeReportedTransfer = (id: string | null | undefined, name?: string) => {
    if (id) transferReporter?.complete(id, name);
  };

  const failReportedTransfer = (id: string | null | undefined, message: string) => {
    if (id) transferReporter?.fail(id, message);
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
        browserRequestOptions,
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
    return readBrowserTransferBlob(response, `Download failed for ${key}`);
  }

  const buildAuthHeaders = useCallback((sseKeyBase64?: string | null) => {
    const headers: Record<string, string> = {};
    if (typeof window === "undefined") return headers;
    const token = readClientStorage(CLIENT_STORAGE_KEYS.authToken);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const parsed = readClientJson<{ authType?: string }>(CLIENT_STORAGE_KEYS.sessionUser);
    if (parsed?.authType === "s3_session") {
      const endpoint = readClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint);
      if (endpoint) {
        headers["X-S3-Endpoint"] = endpoint;
      }
    }
    if (workspaceSurface === "portal") {
      headers["X-S3-Workspace"] = "portal";
    } else if (workspaceSurface === "manager") {
      headers["X-S3-Workspace"] = "manager-browser";
    }
    Object.assign(headers, buildSseCustomerBackendHeaders(sseKeyBase64));
    return headers;
  }, [workspaceSurface]);

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
      return readBrowserTransferStream(response, `Download failed for ${key}`);
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
    return readBrowserTransferStream(response, `Download failed for ${key}`);
  };

  const resolveClipboardTransferMode = useCallback(
    async (
      selector: S3AccountSelector,
      targetBucket: string,
    ): Promise<ClipboardTransferMode> => {
      try {
        const status = await getBucketCorsStatus(
          selector,
          targetBucket,
          uiOrigin,
          browserRequestOptions,
        );
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
    [browserRequestOptions, proxyAllowed, uiOrigin],
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
        return proxyDownload(selector, bucket, key, signal, sseKeyBase64, browserRequestOptions);
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
        browserRequestOptions,
      );
      const response = await fetch(presign.url, {
        headers: presign.headers || undefined,
        signal,
      });
      return readBrowserTransferBlob(response, `Download failed for ${key}`);
    },
    [browserRequestOptions],
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
        return readBrowserTransferStream(response, `Download failed for ${key}`);
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
        browserRequestOptions,
      );
      const response = await fetch(presign.url, {
        headers: presign.headers || undefined,
        signal,
      });
      return readBrowserTransferStream(response, `Download failed for ${key}`);
    },
    [browserRequestOptions, buildApiUrl, buildAuthHeaders],
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
          browserRequestOptions,
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
        browserRequestOptions,
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
      await ensureSuccessfulBrowserTransferResponse(
        response,
        `Upload failed for ${key}`,
      );
    },
    [browserRequestOptions],
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
          browserRequestOptions,
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
        const partBuffer = new Uint8Array(partBytes).buffer;
        await uploadPartBlob(
          new Blob([partBuffer], {
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
          browserRequestOptions,
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
        await completeMultipartUpload(
          selector,
          bucket,
          uploadId,
          key,
          { parts: completedParts },
          browserRequestOptions,
        );
      } catch (err) {
        if (uploadId) {
          try {
            await abortMultipartUpload(selector, bucket, uploadId, key, browserRequestOptions);
          } catch {
            // ignore cleanup failures
          }
        }
        throw err;
      } finally {
        reader.releaseLock();
      }
    },
    [browserRequestOptions],
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
      await deleteObjects(selector, bucket, [{ key }], undefined, browserRequestOptions);
    },
    [browserRequestOptions],
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
            ...browserRequestOptions,
          },
        );
        collected.push(...data.objects);
        continuation = data.next_continuation_token ?? null;
        hasMore = Boolean(data.is_truncated && continuation);
      }
      return collected;
    },
    [accountIdForApi, browserRequestOptions, bucketName, hasS3AccountContext],
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
        requestOptions: browserRequestOptions,
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
        requestOptions: browserRequestOptions,
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
            browserRequestOptions,
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
    showOperationsBar();
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
    showOperationsBar();
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
        let zipWriter: ZipWriter<Uint8Array> | null = null;
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

        triggerBlobDownload(`${folderLabel}.zip`, zipBlob);
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
    showOperationsBar();
    const operationId = startOperation(
      "downloading",
      `Downloading ${files.length} files`,
      currentPath || bucketName,
      { kind: "download", cancelable: true },
    );
    const controller = createOperationController(operationId);
    let completionStatus: OperationCompletionStatus = "done";
    let completionError: string | undefined;
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
          const reportedTransferId = startReportedTransfer({
            direction: "Download",
            bucketName,
            key: target.item.key,
            name: target.item.name || target.item.key,
            sizeBytes: target.item.sizeBytes,
          });
          try {
            const blob = await downloadObjectBlob(
              target.item.key,
              controller.signal,
            );
            triggerBlobDownload(target.item.name || "download", blob);
            updateDownloadDetail(operationId, target.detailId, "done");
            completeReportedTransfer(reportedTransferId, target.item.name || "download");
          } catch (err) {
            if (isAbortError(err) || controller.signal.aborted) {
              updateDownloadDetail(operationId, target.detailId, "cancelled");
              failReportedTransfer(reportedTransferId, "Download cancelled.");
              aborted = true;
              controller.abort();
              return;
            }
            console.error(err);
            const errorMessage = formatOperationError(err, "Download failed.");
            updateDownloadDetail(
              operationId,
              target.detailId,
              "failed",
              errorMessage,
            );
            failReportedTransfer(reportedTransferId, errorMessage);
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
        const reportsControlledDownload = useProxyTransfers || sseActive;
        const reportedTransferId = reportsControlledDownload
          ? startReportedTransfer({
              direction: "Download",
              bucketName,
              key: item.key,
              name: item.name || item.key,
              sizeBytes: item.sizeBytes,
            })
          : null;
        if (useProxyTransfers) {
          try {
            const blob = await proxyDownload(
              accountIdForApi,
              bucketName,
              item.key,
              undefined,
              sseCustomerKeyBase64,
              browserRequestOptions,
            );
            triggerBlobDownload(item.name || "download", blob);
            completeReportedTransfer(reportedTransferId, item.name || "download");
          } catch (err) {
            failReportedTransfer(reportedTransferId, formatOperationError(err, "Unable to download object."));
            throw err;
          }
        } else {
          if (sseActive) {
            try {
              const blob = await downloadObjectBlob(item.key);
              triggerBlobDownload(item.name || "download", blob);
              completeReportedTransfer(reportedTransferId, item.name || "download");
            } catch (err) {
              failReportedTransfer(reportedTransferId, formatOperationError(err, "Unable to download object."));
              throw err;
            }
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
      showOperationsBar();
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
        showOperationsBar();
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
            browserRequestOptions,
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
            browserRequestOptions,
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
            browserRequestOptions,
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
            browserRequestOptions,
          );
        }
        if (shouldApplyRetention) {
          await updateObjectRetention(
            accountIdForApi,
            bucketName,
            {
              key,
              mode: bulkRetentionMode || null,
              retain_until: retentionIso,
              bypass_governance: bulkRetentionBypass,
            },
            controller?.signal,
            browserRequestOptions,
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
      const { restoreList, deleteList, unchangedKeys } =
        await buildBulkRestorePlan({
          items: bulkActionItems,
          restoreLatestDeleted: isLatestRestoreMode,
          targetTime,
          deleteMissing: allowDeleteMissing,
          listVersionsForKey: listAllVersionsForKey,
          listVersionsForPrefix: listAllVersionsForPrefix,
          listObjectsForPrefix: (targetPrefix) =>
            listAllObjectsForPrefix(targetPrefix),
        });
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
        showOperationsBar();
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
              }, controller?.signal, browserRequestOptions);
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
    showOperationsBar();
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
        browserRequestOptions,
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
    if (resolvedFunctionalProfile !== "advanced" && !clipboardMatchesContext) {
      setWarningMessage(
        "Cross-context copy and move require the Advanced Browser profile.",
      );
      return;
    }
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
      showOperationsBar();
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
                browserRequestOptions,
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
                browserRequestOptions,
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
                    browserRequestOptions,
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
    browserRequestOptions,
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
    getSseCustomerKeyForScope,
    hasS3AccountContext,
    listAllObjectsForPrefix,
    normalizedPrefix,
    showOperationsBar,
    refreshObjectsNow,
    resolveClipboardTransferMode,
    resolvedFunctionalProfile,
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
      showBulkAttributesModal ||
      showBulkRestoreModal ||
      showOperationsDetailsModal ||
      showSseCustomerModal ||
      showCleanupModal ||
      showPrefixVersions ||
      showMultipartUploadsModal ||
      Boolean(confirmDialog) ||
      Boolean(copyDialog);
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const element = target as HTMLElement;
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
        if (selectableListItems.length === 0) return;
        event.preventDefault();
        const nextIds = selectableListItems.map((item) => item.id);
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
        if (resolvedFunctionalProfile === "portal" || !resolvedCapabilityFacts.canWriteObjects) return;
        const targets = selectedItems;
        if (targets.length === 0) return;
        event.preventDefault();
        handleCopyItems(targets);
        return;
      }

      if (key === "x") {
        if (resolvedFunctionalProfile === "portal" || !resolvedCapabilityFacts.canWriteObjects) return;
        const targets = selectedItems;
        if (targets.length === 0) return;
        event.preventDefault();
        handleCutItems(targets);
        return;
      }

      if (key === "v") {
        if (!canPasteInFunctionalProfile) return;
        event.preventDefault();
        void handlePasteItems();
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [
    bucketName,
    canPasteInFunctionalProfile,
    handleCopyItems,
    handleCutItems,
    handlePasteItems,
    hasS3AccountContext,
    resolvedCapabilityFacts.canWriteObjects,
    resolvedFunctionalProfile,
    selectableListItems,
    selectedItems,
    setActiveRowId,
    setSelectionAnchorId,
    startEditingPath,
    objectDetailsTarget,
    showNewFolderModal,
    showBulkAttributesModal,
    showBulkRestoreModal,
    showOperationsDetailsModal,
    showSseCustomerModal,
    showCleanupModal,
    confirmDialog,
    copyDialog,
    showMultipartUploadsModal,
    showPrefixVersions,
    syncInspectorTabWithSelection,
  ]);

  const refreshObjectListing = async (_targetKey: string) => {
    await loadObjects({ prefixOverride: prefix, forceRefresh: true });
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
        browserRequestOptions,
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

  const runPathAction = (actionId: BrowserActionId) => {
    runBrowserAction(pathActionStates[actionId], {
      uploadFiles: () => fileInputRef.current?.click(),
      uploadFolder: () => folderInputRef.current?.click(),
      newFolder: handleNewFolder,
      paste: handlePasteItems,
      versions: () => setShowPrefixVersions(true),
      restoreToDate: () => openBulkRestoreModal([]),
      cleanOldVersions: openCleanupModal,
      multipartUploads: openMultipartUploadsModal,
      configureBucket: () => openBucketConfigurationModal(bucketName),
      copyPath: () => handleCopyPath(currentPath),
      refresh: handleRefresh,
      restore: () =>
        deletedObjectsOptions?.onRestorePrefix?.({
          bucketName,
          key: normalizedPrefix,
          name:
            normalizedPrefix.split("/").filter(Boolean).at(-1) ??
            normalizedPrefix,
        }),
      toggleShowFolders: () => setShowFolderItems((prev) => !prev),
      toggleShowDeleted: () => setDeletedObjectsVisibility(!showDeletedObjects),
    });
  };

  const runSelectionAction = (actionId: BrowserActionId) => {
    runBrowserAction(selectionActionStates[actionId], {
      details: () => {
        if (selectionPrimary?.type === "file") {
          openObjectDetails(
            selectionPrimary,
            selectionPrimary.isDeleted ? "versions" : "properties",
          );
        }
      },
      download: () => {
        if (
          selectionActionStates.download.label === "Download folder" &&
          selectionPrimary
        ) {
          handleDownloadFolder(selectionPrimary);
          return;
        }
        return handleDownloadItems(selectionFiles);
      },
      open: () => {
        if (selectionPrimary) {
          openItemPrimaryAction(selectionPrimary);
        }
      },
      copyUrl: () => handleCopyUrl(selectionPrimary),
      copy: () => handleCopyItems(selectionItems),
      cut: () => handleCutItems(selectionItems),
      bulkAttributes: () => openBulkAttributesModal(selectionItems),
      advanced: () => {
        if (selectionPrimary) {
          openAdvancedForItem(selectionPrimary);
        }
      },
      restoreToDate: () => openBulkRestoreModal(selectionItems),
      delete: () => handleDeleteItems(selectionItems),
    });
  };

  const runItemAction = (item: BrowserItem, actionId: BrowserActionId) => {
    const itemActions = resolveItemActionStates(item);
    const result = runBrowserAction(itemActions[actionId], {
      details: () => openItemDetails(item),
      versions: () => openObjectVersionsModal(item),
      properties: () => openPropertiesForItem(item),
      open: () => handleOpenItem(item),
      preview: () => handlePreviewItem(item),
      download: () => handleDownloadTarget(item),
      createPublicLink: () => createPublicLinkForItem(item),
      restore: () => restoreDeletedItem(item),
      copyUrl: () => handleCopyUrl(item),
      copy: () => handleCopyItems([item]),
      cut: () => handleCutItems([item]),
      bulkAttributes: () => openBulkAttributesModal([item]),
      restoreToDate: () => openBulkRestoreModal([item]),
      advanced: () => openAdvancedForItem(item),
      delete: () => handleDeleteItems([item]),
    });
    if (!result.executed) {
      setWarningMessage(result.reason);
    }
  };

  const runInspectedFullDetailsAction = () => {
    if (!inspectedItem || inspectedItem.type !== "file") return;
    const actionId: BrowserActionId = inspectedItem.isDeleted
      ? "versions"
      : "properties";
    runItemAction(inspectedItem, actionId);
  };

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
  const operationsPanelTotalCount =
    totalOperationsCount + completedOperationsCount + failedOperationsCount;
  const hasOperationsPanelContent = operationsPanelTotalCount > 0;
  const showOperationsPanel =
    hasOperationsPanelContent && (!operationsPanelDismissed || hasPendingOperations);
  useEffect(() => {
    operationsPanelVisibleRef.current = showOperationsPanel;
  }, [showOperationsPanel]);
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
            state: item.status === "downloading" || item.status === "copying" || item.status === "deleting" ? "uploading" : item.status,
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
            state: "queued" as const,
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

    triggerBlobDownload(
      `${baseName}-${timestamp}.json`,
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
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
  const chromeChipButtonClasses = filterChipClasses;
  const chromeToolbarButtonClasses = toolbarButtonClasses;
  const chromeToolbarPrimaryClasses = toolbarPrimaryClasses;
  const chromeToolbarIconButtonClasses = toolbarIconButtonClasses;
  const chromeBulkActionClasses = bulkActionClasses;
  const chromeDangerActionClasses = bulkDangerClasses;
  const isCreateBucketNameValid =
    !createBucketNameValue || isValidS3BucketName(createBucketNameValue);
  const createBucketCurrentSignature = useMemo(
    () => stableSignature({ createBucketNameValue, createBucketVersioning }),
    [createBucketNameValue, createBucketVersioning],
  );
  const newFolderCurrentSignature = useMemo(
    () => stableSignature({ newFolderName }),
    [newFolderName],
  );
  const sseCustomerCurrentSignature = useMemo(
    () => stableSignature({ sseCustomerKeyInput }),
    [sseCustomerKeyInput],
  );
  const closeSseCustomerModal = () => {
    const nextInput = sseCustomerKeyBase64 ?? "";
    setShowSseCustomerModal(false);
    setSseCustomerKeyInput(nextInput);
    setSseCustomerInitialSignature(stableSignature({ sseCustomerKeyInput: nextInput }));
    setSseCustomerKeyError(null);
    setSseCustomerKeyNotice(null);
    setSseCustomerKeyVisible(false);
  };
  const createBucketCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showCreateBucketModal && createBucketCurrentSignature !== createBucketInitialSignature,
    onClose: closeCreateBucketDialog,
    disabled: createBucketLoading,
  });
  const newFolderCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showNewFolderModal && newFolderCurrentSignature !== newFolderInitialSignature,
    onClose: closeNewFolderDialog,
    disabled: newFolderLoading,
  });
  const sseCustomerCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showSseCustomerModal && sseCustomerCurrentSignature !== sseCustomerInitialSignature,
    onClose: closeSseCustomerModal,
  });
  const showFolderToggle = showPanelToggles && canUseFoldersPanel;
  const showInspectorToggle = showPanelToggles && canUseInspectorPanel;
  const isActionBarVisible = selectedCount > 0;
  const isCompactToolbarMode = !isActionBarVisible;
  const browserViewLabel = compactMode ? "Compact view" : "List view";
  const browserChromeShellClasses =
    "relative z-20 shrink-0 pb-2";
  const browserNoticeShellClasses = "shrink-0 pb-2";
  const browserContentShellClasses =
    "relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden pb-3";
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
  const toolbarPathActions = toolbarMorePathActions;
  const hasToolbarPathActions =
    toolbarPathActions.length > 0;
  const toolbarSelectionActions = (
    isActionBarVisible
      ? toolbarMoreSelectionOverflowActions
      : toolbarMoreSelectionFullActions
  ).filter(
    (selectionAction) =>
      !toolbarPathActions.some(
        (pathAction) => pathAction.id === selectionAction.id,
      ),
  );
  const hasToolbarSelectionActions =
    canSelectionActions && toolbarSelectionActions.length > 0;
  const hasToolbarOperationsAction = hasOperationsPanelContent;
  const hasToolbarStatusSection =
    (isMainBrowserPath && rootBrowserAdvancedFeaturesEnabled) ||
    Boolean(accessBadge) ||
    hasToolbarOperationsAction;
  const hasToolbarLayoutSection =
    showFolderToggle || showInspectorToggle || showLayoutModeToggle;
  const hasToolbarColumnsSection = !isPortalProfile;
  const hasToolbarSecondaryActionsSection =
    hasToolbarPathActions ||
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
  const toolbarColumnsSummary = `${effectiveVisibleColumns.length}/${COLUMN_DEFINITIONS.length} visible`;
  const handleToolbarDownload = () => {
    runSelectionAction("download");
  };
  const handleToolbarOpen = () => {
    runSelectionAction("open");
  };
  const openQuickUploadFiles = () => {
    closeUploadQuickMenu();
    runPathAction("uploadFiles");
  };
  const openQuickUploadFolder = () => {
    closeUploadQuickMenu();
    runPathAction("uploadFolder");
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
    toggleShowDeleted: <TrashIcon className="h-3.5 w-3.5" />,
    multipartUploads: <UploadIcon className="h-3.5 w-3.5" />,
    configureBucket: <SettingsIcon className="h-3.5 w-3.5" />,
    copyPath: <CopyIcon className="h-3.5 w-3.5" />,
    details: <InfoIcon className="h-3.5 w-3.5" />,
    open: <OpenIcon className="h-3.5 w-3.5" />,
    preview: <EyeIcon className="h-3.5 w-3.5" />,
    download: <DownloadIcon className="h-3.5 w-3.5" />,
    createPublicLink: <LinkIcon className="h-3.5 w-3.5" />,
    restore: <HistoryIcon className="h-3.5 w-3.5" />,
    copyUrl: <LinkIcon className="h-3.5 w-3.5" />,
    copy: <CopyIcon className="h-3.5 w-3.5" />,
    cut: <CutIcon className="h-3.5 w-3.5" />,
    bulkAttributes: <SlidersIcon className="h-3.5 w-3.5" />,
    advanced: <SettingsIcon className="h-3.5 w-3.5" />,
    delete: <TrashIcon className="h-3.5 w-3.5" />,
  };
  const renderDirectItemActionButton = (
    item: BrowserItem,
    action: BrowserActionState,
  ) => {
    const accessibleLabel = `${action.label} ${item.name}`;
    const disabledLabel =
      !action.enabled && action.disabledReason
        ? `${accessibleLabel}. Unavailable: ${action.disabledReason}`
        : accessibleLabel;
    return (
      <button
        key={action.id}
        type="button"
        className={`${rowActionButtonClasses} ${
          action.id === "delete"
            ? "text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
            : ""
        }`}
        aria-label={disabledLabel}
        title={action.enabled ? action.label : action.disabledReason}
        disabled={!action.enabled}
        onClick={(event) => {
          event.stopPropagation();
          runItemAction(item, action.id);
        }}
      >
        {browserActionIconById[action.id]}
      </button>
    );
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
        onClick={() => handleSortToggle(column.sortable as BrowserSortKey)}
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
          placeholder={`Search ${workspaceObjectNounPlural}`}
          aria-label={`Search ${workspaceObjectNounPlural}`}
          className={`${browserSearchInputClasses} pl-9 ${
            isPortalProfile ? "pr-3" : "pr-9"
          } normal-case`}
        />
        {!isPortalProfile && (
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
        )}
        <AnchoredPortalMenu
          open={!isPortalProfile && showSearchOptionsMenu}
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
      <h1 className="sr-only">{isPortalBrowserSurface ? "Portal browser" : "Browser"}</h1>
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <div className={browserShellClasses}>
        <div className={browserChromeShellClasses}>
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
                    onClick={
                      resolvedLockedBucketName
                        ? undefined
                        : () => setShowBucketMenu((prev) => !prev)
                    }
                    disabled={!hasS3AccountContext}
                    aria-haspopup={resolvedLockedBucketName ? undefined : "listbox"}
                    aria-expanded={resolvedLockedBucketName ? undefined : showBucketMenu}
                    aria-label={bucketButtonActionLabel}
                    title={bucketButtonActionLabel}
                  >
                    <BucketIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />
                    <span className="max-w-[200px] truncate sm:max-w-[260px]">
                      {bucketButtonLabel}
                    </span>
                    {!resolvedLockedBucketName && (
                      <ChevronDownIcon className="h-3.5 w-3.5 text-slate-400" />
                    )}
                  </button>
                  {showBucketMenu && !resolvedLockedBucketName && (
                    <div
                      className={`absolute left-0 top-[calc(100%+8px)] z-[60] w-80 max-w-[calc(100vw-1rem)] ui-caption ${browserFloatingMenuClasses}`}
                    >
                      <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="min-w-0">
                            <p className={browserSectionEyebrowClasses}>
                              {selectorWorkspaceNounTitle}
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
                            placeholder={
                              `Filter ${selectorWorkspaceNounPlural}`
                            }
                            className={`${browserInputClasses} pl-9`}
                            spellCheck={false}
                          />
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto px-1 pb-1">
                        {loadingBuckets && bucketOptions.length === 0 ? (
                          <div className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">
                            {`Loading ${selectorWorkspaceNounPlural}...`}
                          </div>
                        ) : bucketTotalCount === 0 ? (
                          <div className="space-y-2 px-2 py-2">
                            <div className="ui-caption text-slate-500 dark:text-slate-400">
                              {bucketError
                                ? `Unable to load ${selectorWorkspaceNounPlural}.`
                                : `No ${selectorWorkspaceNounPlural} available.`}
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
                            {`No ${selectorWorkspaceNounPlural} match this filter.`}
                          </div>
                        ) : (
                          bucketMenuItems.map((bucket) => {
                            const isActive = bucket.name === bucketName;
                            const label =
                              bucketDisplayNameByName.get(bucket.name) ??
                              bucket.name;
                            return (
                              <button
                                key={bucket.name}
                                type="button"
                                onClick={() => handleBucketChange(bucket.name)}
                                className={`flex w-full min-w-0 items-center justify-between rounded-md border px-3 py-2 text-left font-semibold transition ${
                                  isActive
                                    ? "border-primary-200 bg-primary-50 text-primary-800 shadow-sm dark:border-primary-500/40 dark:bg-primary-500/20 dark:text-primary-100"
                                    : "border-transparent text-slate-700 hover:border-primary-200 hover:bg-slate-50 dark:text-slate-200 dark:hover:border-primary-500/40 dark:hover:bg-slate-800"
                                }`}
                              >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <BucketIcon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{label}</span>
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
                          {`${bucketOptions.length} of ${bucketMenuTotal} ${
                            `${selectorWorkspaceNoun}${bucketMenuTotal === 1 ? "" : "s"}`
                          }`}
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
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {!isPortalProfile &&
                  deletedObjectsOptions?.showToggle &&
                  isVersioningEnabled &&
                  bucketName && (
                    <button
                      type="button"
                      className={chromeToolbarButtonClasses}
                      aria-pressed={showDeletedObjects}
                      onClick={() => runPathAction("toggleShowDeleted")}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">
                        {showDeletedObjects
                          ? "Hide deleted files"
                          : "Show deleted files"}
                      </span>
                      <span className="sm:hidden">
                        {showDeletedObjects ? "Hide deleted" : "Show deleted"}
                      </span>
                    </button>
                  )}
                {deletedObjectsOptions?.onRestorePrefix &&
                  pathActionStates.restore.visible &&
                  showDeletedObjects &&
                  isVersioningEnabled &&
                  bucketName &&
                  normalizedPrefix && (
                    <button
                      type="button"
                      className={chromeToolbarButtonClasses}
                      onClick={() => runPathAction("restore")}
                      disabled={!pathActionStates.restore.enabled}
                    >
                      <HistoryIcon className="h-3.5 w-3.5" />
                      <span className="hidden lg:inline">
                        Restore deleted files in this folder
                      </span>
                      <span className="lg:hidden">Restore folder</span>
                    </button>
                  )}
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
                      onClick={() => runPathAction("newFolder")}
                      disabled={!toolbarCanCreateFolder}
                      aria-label="New folder"
                      title="New folder"
                    >
                      <FolderPlusIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className={chromeToolbarIconButtonClasses}
                      onClick={() => runPathAction("refresh")}
                      disabled={!pathActionStates.refresh.enabled}
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
            {isActionBarVisible && !isMobileViewport && (
              <div
                role="toolbar"
                aria-label="Browser actions bar"
                className="sticky top-0 z-20 hidden gap-3 rounded-xl border border-slate-200 bg-slate-50/95 px-3 py-2.5 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 md:flex md:items-center md:justify-between"
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
                    onClick={() => runSelectionAction("copy")}
                    disabled={!toolbarCanCopy}
                  >
                    <CopyIcon className="h-3.5 w-3.5" />
                    Copy
                  </button>
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
                    onClick={() => runSelectionAction("delete")}
                    disabled={!toolbarCanDelete}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Delete
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
                      {hasToolbarOperationsAction && (
                        <button
                          type="button"
                          role="menuitem"
                          aria-label="Operations overview"
                          className={contextMenuItemClasses}
                          onClick={() => {
                            runToolbarMoreAction(() =>
                              setShowOperationsDetailsModal(true),
                            );
                          }}
                        >
                          <ListIcon className="h-3.5 w-3.5" />
                          <span className="min-w-0 flex-1">
                            <span className="block">Operations overview</span>
                            <span
                              aria-hidden="true"
                              className="block text-[11px] font-medium leading-tight text-slate-400 dark:text-slate-500"
                            >
                              {operationsPanelTotalCount === 1
                                ? "1 operation"
                                : `${operationsPanelTotalCount} operations`}
                            </span>
                          </span>
                        </button>
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
                      {showLayoutModeToggle && (
                        <ToolbarToggleMenuItem
                          label="Workbench layout"
                          icon={<SlidersIcon className="h-3.5 w-3.5" />}
                          checked={activeLayoutMode === "workbench"}
                          onToggle={() =>
                            changeLayoutMode(
                              activeLayoutMode === "workbench" ? "standard" : "workbench",
                            )
                          }
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
                      {hasToolbarPathActions && (
                        <>
                          <p className={toolbarOverflowSectionTitleClasses}>
                            Current path
                          </p>
                          {toolbarPathActions.map((action) =>
                            renderToolbarMoreActionButton(action, () =>
                              runPathAction(action.id),
                            ),
                          )}
                        </>
                      )}
                      {hasToolbarSelectionActions && (
                        <>
                          {hasToolbarPathActions && (
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
          <div className={browserNoticeShellClasses}>
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

        <div className={browserContentShellClasses}>
          <div
            ref={layoutContainerRef}
            data-testid="browser-layout"
            className="relative grid min-h-0 flex-1 grid-rows-1 gap-3"
            style={{ gridTemplateColumns: layoutTemplateColumns }}
          >
            {isFoldersPanelVisible && (
              <BrowserFoldersPanel
                currentBucket={currentBucketPanelItem}
                activePrefix={normalizedPrefix}
                currentBucketAccess={currentBucketAccess}
                treeRootNode={treeRootNode}
                workspaceNoun={workspaceNoun}
                onRefresh={handleRefresh}
                onSelectPrefix={handleSelectPrefix}
                onToggleTreeNode={handleToggleTreeNode}
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
                          : `Select a ${workspaceNoun} first`}
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
                  className={`relative min-h-0 flex-1 overflow-y-auto bg-white/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-transparent ${isMobileViewport ? "overflow-x-hidden pb-24" : "overflow-x-auto"}`}
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
                  {isMobileViewport ? (
                    <div role="list" aria-label="Objects" className="divide-y divide-slate-200/80 dark:divide-slate-800">
                      {canGoUp && bucketName && showFolderItems && !isSearchingInWholeBucket && (
                        <button
                          type="button"
                          onClick={handleGoUp}
                          className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200"
                        >
                          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                            <UpIcon className="h-4 w-4" />
                          </span>
                          Parent folder
                        </button>
                      )}
                      {!objectsLoading && !bucketName && (
                        <p className="px-4 py-10 text-center ui-body text-slate-500">
                          {`Select a ${workspaceNoun} to browse ${workspaceObjectNounPlural}.`}
                        </p>
                      )}
                      {!objectsLoading && bucketName && listItems.length === 0 && (
                        <p className="px-4 py-10 text-center ui-body text-slate-500">
                          {objectsIssue?.title ?? (hasActiveSearchFilters ? "No objects matched this search." : "No objects found for this path.")}
                        </p>
                      )}
                      {listItems.map((item) => {
                        const isSelected = selectedSet.has(item.id);
                        const isDeleted = Boolean(item.isDeleted);
                        const isHistorical = Boolean(item.isHistorical);
                        return (
                          <div
                            key={item.id}
                            role="listitem"
                            data-browser-item
                            data-lazy-item-id={item.type === "file" && !isDeleted ? item.id : undefined}
                            onClick={(event) => {
                              if (isInteractiveTarget(event.target) || isDeleted) return;
                              handleItemSelectionClick(event, item.id);
                            }}
                            onDoubleClick={(event) => handleItemDoubleClick(event, item)}
                            onContextMenu={(event) => handleItemContextMenu(event, item)}
                            className={`grid min-h-16 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-1 px-2 py-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-primary ${isSelected ? "bg-primary-100/90 dark:bg-primary-500/30" : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"}`}
                          >
                            <label className="flex h-11 w-11 items-center justify-center">
                              <input
                                type="checkbox"
                                checked={!isDeleted && isSelected}
                                onChange={() => toggleSelection(item.id)}
                                aria-label={`Select ${item.name}`}
                                className={uiCheckboxClass}
                                disabled={isDeleted}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={(event) => handleItemNameClick(event, item)}
                              onDoubleClick={(event) => event.preventDefault()}
                              aria-label={
                                isDeleted
                                  ? `Open versions for ${item.name}`
                                  : item.type === "folder"
                                    ? `Open folder ${item.name}`
                                    : `Open file ${item.name}`
                              }
                              className="flex min-h-11 min-w-0 items-center gap-3 text-left"
                            >
                              <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${isDeleted ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/20 dark:text-rose-200" : item.type === "folder" ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200" : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200"}`}>
                                {item.type === "folder" ? <FolderIcon /> : isDeleted ? <TrashIcon /> : <FileIcon />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">{item.name}</span>
                                <span className="mt-0.5 flex min-w-0 items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
                                  <span className="truncate">{item.type === "folder" ? "Folder" : item.size}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="truncate">{item.modified}</span>
                                  {(isDeleted || isHistorical) && (
                                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 font-semibold ${isDeleted ? "border-rose-200 text-rose-700 dark:border-rose-500/40 dark:text-rose-200" : "border-amber-200 text-amber-700 dark:border-amber-500/40 dark:text-amber-200"}`}>
                                      {isDeleted ? "Deleted" : "History"}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              className={`${rowActionButtonClasses} min-h-11 min-w-11`}
                              aria-label={`More actions for ${item.name}`}
                              onClick={(event) => handleItemActionsButtonClick(event, item)}
                            >
                              <MoreIcon />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
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
                      <col style={{ width: `${actionsColumnWidthPx}px` }} />
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
                            disabled={selectableListItems.length === 0}
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
                          message={`Loading ${workspaceObjectNounPlural}...`}
                          className="py-10 text-center"
                        />
                      )}
                      {!objectsLoading && !bucketName && (
                        <TableEmptyState
                          colSpan={objectTableColSpan}
                          message={`Select a ${workspaceNoun} to browse ${workspaceObjectNounPlural}.`}
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
                                : showDeletedObjects &&
                                    deletedObjectsIsTruncated
                                  ? "No deleted files found yet. Continue loading to search more history."
                                : "No objects found for this path."
                            }
                            className="py-10 text-center"
                          />
                        )}
                      {listItems.map((item) => {
                        const isSelected = selectedSet.has(item.id);
                        const isDeleted = Boolean(item.isDeleted);
                        const isHistorical = Boolean(item.isHistorical);
                        const itemActionStates = resolveItemActionStates(item);
                        const directItemActions = getVisibleBrowserActions(
                          itemActionStates,
                          isDeleted
                            ? DIRECT_DELETED_ITEM_ACTION_IDS
                            : isPortalProfile
                              ? DIRECT_PORTAL_ITEM_ACTION_IDS
                              : DIRECT_ITEM_ACTION_IDS,
                        );
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
                              if (isDeleted) {
                                return;
                              }
                              handleItemSelectionClick(event, item.id);
                            }}
                            onDoubleClick={(event) =>
                              handleItemDoubleClick(event, item)
                            }
                            onContextMenu={(event) => {
                              handleItemContextMenu(event, item);
                            }}
                            className={`${rowHeightClasses} transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-primary ${
                              isSelected
                                ? "bg-primary-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] hover:bg-primary-100 dark:bg-primary-500/30 dark:hover:bg-primary-500/40"
                                : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                            }`}
                          >
                            <td
                              className={`px-2 ${rowCellClasses} !align-middle`}
                            >
                              <input
                                type="checkbox"
                                checked={!isDeleted && isSelected}
                                onChange={() => toggleSelection(item.id)}
                                aria-label={`Select ${item.name}`}
                                className={uiCheckboxClass}
                                disabled={isDeleted}
                              />
                            </td>
                            <td
                              className={`manager-table-cell min-w-0 px-4 ${rowCellClasses} !align-middle ui-body ${
                                isHistorical
                                  ? "text-amber-800 dark:text-amber-200"
                                : isDeleted
                                  ? "text-rose-700 dark:text-rose-200"
                                  : "text-slate-700 dark:text-slate-200"
                              }`}
                              style={{ maxWidth: `${nameColumnWidthPx}px` }}
                            >
                              <button
                                type="button"
                                onClick={(event) => handleItemNameClick(event, item)}
                                onDoubleClick={(event) => event.preventDefault()}
                                aria-label={
                                  item.isDeleted
                                    ? `Open versions for ${item.name}`
                                    : item.type === "folder"
                                      ? `Open folder ${item.name}`
                                      : `Open file ${item.name}`
                                }
                                className={`flex ${primaryItemButtonHeightClasses} w-full min-w-0 items-center ${nameGapClasses} text-left`}
                                title={item.name}
                              >
                                <span
                                  className={`inline-flex ${iconBoxClasses} items-center justify-center rounded-md border shadow-sm ${
                                    isHistorical
                                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
                                    : isDeleted
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
                                  <span
                                    className={`flex w-full min-w-0 items-baseline gap-1 text-left font-semibold ${
                                      isHistorical
                                        ? "text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
                                      : isDeleted
                                        ? "text-rose-700 hover:text-rose-800 dark:text-rose-200 dark:hover:text-rose-100"
                                        : "text-slate-900 hover:text-primary-700 dark:text-slate-100 dark:hover:text-primary-200"
                                    }`}
                                  >
                                    <span className="truncate">
                                      {item.name}
                                    </span>
                                    {(isDeleted || isHistorical) && (
                                      <span
                                        className={`shrink-0 ui-caption font-semibold ${
                                          isHistorical
                                            ? "text-amber-600 dark:text-amber-300"
                                            : "text-rose-500 dark:text-rose-300"
                                        }`}
                                      >
                                        {isHistorical ? "(history)" : "(deleted)"}
                                      </span>
                                    )}
                                  </span>
                                  {!compactMode && (
                                    <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden ui-caption text-slate-500 dark:text-slate-400">
                                      <span className="rounded-md border border-slate-200 px-2 py-0.5 font-semibold dark:border-slate-700">
                                        {item.type === "folder"
                                          ? isHistorical
                                            ? "Historical folder"
                                            : isDeleted
                                              ? "Deleted folder"
                                            : "Prefix"
                                          : isDeleted
                                            ? "Deleted object"
                                            : "Object"}
                                      </span>
                                      {(isDeleted || isHistorical) && (
                                        <span
                                          className={`rounded-md border px-2 py-0.5 font-semibold ${
                                            isHistorical
                                              ? "border-amber-200 text-amber-700 dark:border-amber-500/40 dark:text-amber-200"
                                              : "border-rose-200 text-rose-700 dark:border-rose-500/40 dark:text-rose-200"
                                          }`}
                                        >
                                          {isHistorical
                                            ? "Version history"
                                            : item.type === "folder"
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
                              </button>
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
                              <div className="flex items-center justify-end gap-1">
                                {directItemActions.map((action) =>
                                  renderDirectItemActionButton(item, action),
                                )}
                                <button
                                  type="button"
                                  className={rowActionButtonClasses}
                                  aria-label={`More actions for ${item.name}`}
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
                  )}
                </div>
                {canLoadMoreObjectResults && (
                  <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-right dark:border-slate-700 dark:bg-slate-900/40">
                    <button
                      type="button"
                      className={chromeToolbarButtonClasses}
                      onClick={handleLoadMoreObjectResults}
                      disabled={objectsLoadingMore}
                    >
                      {objectsLoadingMore
                        ? "Loading..."
                        : !objectsIsTruncated && deletedObjectsIsTruncated
                          ? "Continue loading deleted files"
                          : "Load more"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isInspectorPanelVisible && (
              <div className="flex min-h-0 h-full flex-col gap-3">
                <div className="ui-surface-card flex min-h-0 h-full flex-1 flex-col px-3 py-3">
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
                      {workspaceNounCapitalized}
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
                            {currentPath || `Select a ${workspaceNoun} to get started.`}
                          </p>
                        </div>
                        <div className="space-y-3">
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
                                {usePortalWorkspaceLabels
                                  ? "File history is not available in this view."
                                  : "Versioning is disabled for this bucket."}
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
                              {`${workspaceNounCapitalized} overview`}
                            </p>
                            <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                              {bucketName || `Select a ${workspaceNoun} to inspect.`}
                            </p>
                          </div>

                          {!bucketName || !hasS3AccountContext ? (
                            <div className={inspectorEmptyStateClasses}>
                              {`Select a ${workspaceNoun} to load ${workspaceNoun} stats and features.`}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {bucketInspectorLoading &&
                                !bucketInspectorData && (
                                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                                    {`Loading ${workspaceNoun} overview...`}
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
                                      {usePortalWorkspaceLabels
                                        ? "File count"
                                        : "Object count"}
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
                                  {usePortalWorkspaceLabels
                                    ? "Only user-facing storage details are shown in this Portal view."
                                    : "States mirror the Manager bucket overview when available."}
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
                            </div>
                            {selectionIsSingle && selectionPrimary?.type === "file" && (
                              <button
                                type="button"
                                className={chromeBulkActionClasses}
                                onClick={() => runSelectionAction("details")}
                              >
                                Open full details
                              </button>
                            )}
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
                            <div className={inspectorSectionCardClasses}>
                              <p className={inspectorSectionTitleClasses}>
                                Object details
                              </p>
                            </div>
                            <div className="rounded-lg border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-muted)] px-3 py-2.5 shadow-[var(--ui-shadow-soft)]">
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
                            {inspectedItem.type === "file" && (
                              <button
                                type="button"
                                className={chromeBulkActionClasses}
                                onClick={runInspectedFullDetailsAction}
                              >
                                Open full details
                              </button>
                            )}
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
      </div>
      {isMobileViewport && selectedCount > 0 && (
        <div
          role="toolbar"
          aria-label="Selected object actions"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 gap-2 border-t border-slate-200 bg-white/95 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur dark:border-slate-700 dark:bg-slate-950/95"
        >
          <button
            type="button"
            className={`${chromeToolbarButtonClasses} min-h-11 justify-center`}
            onClick={handleToolbarOpen}
            disabled={!toolbarCanOpen}
          >
            <OpenIcon className="h-4 w-4" />
            Open
          </button>
          <button
            type="button"
            className={`${chromeToolbarPrimaryClasses} min-h-11 justify-center`}
            onClick={handleToolbarDownload}
            disabled={!toolbarCanDownload}
          >
            <DownloadIcon className="h-4 w-4" />
            Download
          </button>
          <button
            ref={mobileMoreButtonRef}
            type="button"
            className={`${chromeToolbarButtonClasses} min-h-11 justify-center`}
            onClick={() => setShowMobileActionsSheet(true)}
            aria-haspopup="dialog"
            aria-expanded={showMobileActionsSheet}
          >
            <MoreIcon className="h-4 w-4" />
            More
          </button>
        </div>
      )}
      {showMobileActionsSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-slate-950/45"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowMobileActionsSheet(false);
            }
          }}
        >
          <div
            ref={mobileActionsSheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="browser-mobile-actions-title"
            className="max-h-[75vh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl dark:bg-slate-900"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 id="browser-mobile-actions-title" className="font-semibold text-slate-900 dark:text-slate-100">
                  {toolbarSelectionSummary}
                </h2>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Available actions for the current selection
                </p>
              </div>
              <button
                type="button"
                className={`${chromeToolbarIconButtonClasses} min-h-11 min-w-11`}
                onClick={() => setShowMobileActionsSheet(false)}
                aria-label="Close actions"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-2">
              {toolbarMoreSelectionFullActions
                .filter((action) => action.id !== "open" && action.id !== "download")
                .map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={`${action.id === "delete" ? chromeDangerActionClasses : chromeToolbarButtonClasses} min-h-11 w-full justify-start`}
                    disabled={!action.enabled}
                    title={action.disabledReason}
                    onClick={() => {
                      runSelectionAction(action.id);
                      setShowMobileActionsSheet(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 text-left">{action.label}</span>
                    {!action.enabled && action.disabledReason && (
                      <span className="ml-3 max-w-[55%] text-right ui-caption font-normal text-slate-500 dark:text-slate-400">
                        {action.disabledReason}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
      <BrowserContextMenu
        contextMenu={contextMenu}
        contextMenuRef={contextMenuRef}
        bucketName={bucketName}
        currentPath={currentPath}
        hasS3AccountContext={hasS3AccountContext}
        versioningEnabled={isVersioningEnabled}
        showFolderItems={showFolderItems}
        showDeletedObjects={showDeletedObjects}
        canPaste={canPasteInFunctionalProfile}
        copyUrlDisabled={sseActive}
        copyUrlDisabledReason={copyUrlDisabledReason}
        multipartUploadsAvailable={resolvedFunctionalProfile === "advanced"}
        bucketConfigurationAvailable={bucketConfigurationEnabled}
        functionalProfile={resolvedFunctionalProfile}
        capabilityFacts={resolvedCapabilityFacts}
        clipboard={clipboard}
        fileInputRef={fileInputRef}
        folderInputRef={folderInputRef}
        onClose={closeContextMenu}
        onNewFolder={handleNewFolder}
        onPasteItems={handlePasteItems}
        onOpenPrefixVersions={() => setShowPrefixVersions(true)}
        onOpenCleanupVersions={openCleanupModal}
        onOpenMultipartUploads={openMultipartUploadsModal}
        onConfigureBucket={() => openBucketConfigurationModal(bucketName)}
        onResolveItemActions={resolveItemActionStates}
        onRunItemAction={runItemAction}
        onCopyUrl={handleCopyUrl}
        onCopyPath={(path) => {
          void handleCopyPath(path);
        }}
        onCopyItems={handleCopyItems}
        onCutItems={handleCutItems}
        onOpenBulkAttributes={openBulkAttributesModal}
        onOpenBulkRestore={openBulkRestoreModal}
        onOpenAdvanced={openAdvancedForItem}
        onDeleteItems={handleDeleteItems}
        onDownloadFolder={handleDownloadFolder}
        onDownloadItems={handleDownloadItems}
        onOpenItem={handleOpenItem}
        onToggleShowFolders={() => setShowFolderItems((prev) => !prev)}
        onToggleShowDeleted={() =>
          setDeletedObjectsVisibility(!showDeletedObjects)
        }
        isMainBrowserPath={canConfigureRootBrowserView}
        compactMode={compactMode}
        onSetCompactMode={(value) => {
          if (!canConfigureRootBrowserView) return;
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
          readOnly={resolvedFunctionalProfile !== "advanced"}
          requestOptions={browserRequestOptions}
        />
      )}
      {configBucketName && bucketConfigurationEnabled && (
        <BrowserBucketConfigurationModal
          bucketName={configBucketName}
          workspaceSurface={workspaceSurface}
          onClose={closeBucketConfigurationModal}
        />
      )}
      {showCreateBucketModal && (
        <BrowserCreateBucketModal
          name={createBucketNameValue}
          versioning={createBucketVersioning}
          loading={createBucketLoading}
          error={createBucketError}
          isNameValid={isCreateBucketNameValid}
          invalidNameMessage={invalidBucketNameMessage}
          hasS3AccountContext={hasS3AccountContext}
          confirmationDialog={createBucketCloseGuard.confirmationDialog}
          onNameChange={(value) => {
            setCreateBucketNameValue(value);
            if (createBucketError) {
              setCreateBucketError(null);
            }
          }}
          onVersioningChange={setCreateBucketVersioning}
          onSubmit={() => void handleCreateBucketSubmit()}
          onClose={createBucketCloseGuard.requestClose}
        />
      )}
      {showSseCustomerModal && (
        <BrowserSseCustomerKeyModal
          value={sseCustomerKeyInput}
          visible={sseCustomerKeyVisible}
          error={sseCustomerKeyError}
          notice={sseCustomerKeyNotice}
          active={sseActive}
          canGenerate={Boolean(sseCustomerScopeKey)}
          confirmationDialog={sseCustomerCloseGuard.confirmationDialog}
          onValueChange={(value) => {
            setSseCustomerKeyInput(value);
            if (sseCustomerKeyError) {
              setSseCustomerKeyError(null);
            }
            if (sseCustomerKeyNotice) {
              setSseCustomerKeyNotice(null);
            }
          }}
          onToggleVisibility={() => setSseCustomerKeyVisible((prev) => !prev)}
          onGenerate={() => void handleGenerateSseCustomerKey()}
          onClear={handleClearSseCustomerKey}
          onActivate={handleActivateSseCustomerKey}
          onClose={sseCustomerCloseGuard.requestClose}
        />
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
        <BrowserCreateFolderModal
          inputRef={newFolderInputRef}
          name={newFolderName}
          loading={newFolderLoading}
          error={newFolderError}
          currentPath={currentPath}
          bucketName={bucketName}
          hasS3AccountContext={hasS3AccountContext}
          confirmationDialog={newFolderCloseGuard.confirmationDialog}
          onNameChange={setNewFolderName}
          onSubmit={() => void handleCreateFolderFromModal()}
          onClose={newFolderCloseGuard.requestClose}
        />
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
      {showOperationsPanel && (
        <BrowserOperationsPanel
          open={operationsPanelOpen}
          totalOperationsCount={operationsPanelTotalCount}
          activeOperationsCount={activeOperations.length}
          queuedOperationsCount={
            uploadQueue.length +
            queuedDownloadCount +
            queuedDeleteCount +
            queuedCopyCount
          }
          completedOperationsCount={completedOperationsCount}
          failedOperationsCount={failedOperationsCount}
          downloadGroups={downloadGroups}
          deleteGroups={deleteGroups}
          copyGroups={copyGroups}
          uploadGroups={uploadGroups}
          otherOperations={[
            ...activeOtherOperations,
            ...completedOtherOperations,
            ...failedOtherOperations,
          ]}
          operationSortIndexById={operationSortIndexById}
          uploadGroupSortIndexById={uploadGroupSortIndexById}
          operationSortFallback={operationSortFallback}
          cancelOperation={cancelOperation}
          cancelUploadGroup={cancelUploadGroup}
          hasFinishedOperations={hasFinishedOperations}
          canDismiss={!hasPendingOperations}
          onClearFinishedOperations={clearFinishedOperations}
          onDismiss={dismissOperationsPanel}
          onOpenDetails={() => setShowOperationsDetailsModal(true)}
          onToggleOpen={() => setOperationsPanelOpen((open) => !open)}
        />
      )}
      {showOperationsDetailsModal && hasOperationsPanelContent && (
        <BrowserOperationsModal
          totalOperationsCount={operationsPanelTotalCount}
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
          onClose={() => setShowOperationsDetailsModal(false)}
        />
      )}
    </div>
  );
}

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
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  unstable_usePrompt,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import { useDismissibleLayer } from "../../components/ui/useDismissibleLayer";
import {
  cx,
  uiCardMutedClass,
  uiMenuClass,
} from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import {
  CLIENT_STORAGE_KEYS,
  writeClientStorage,
} from "../../utils/clientStorage";
import { readStoredUser } from "../../utils/workspaces";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  type BrowserUsageSummary,
  type BrowserRequestOptions,
  BrowserObject,
  BrowserSettings,
  PresignPartRequest,
  PresignRequest,
  listBrowserObjects,
  fetchBrowserUsageSummary,
  fetchBrowserSettings,
  presignPart,
  presignObject,
} from "../../api/browser";
import { useBrowserContext } from "./BrowserContext";
import {
  useBrowserSidebarSlot,
  type BrowserSidebarBodyRenderer,
} from "./BrowserLayout";
import BrowserBulkAttributesModal from "./BrowserBulkAttributesModal";
import BrowserObjectExplorer from "./BrowserObjectExplorer";
import BrowserObjectSearchHeader from "./BrowserObjectSearchHeader";
import BrowserFoldersPanel from "./BrowserFoldersPanel";
import BrowserWorkspaceSidebar from "./BrowserWorkspaceSidebar";
import BrowserToolbar from "./BrowserToolbar";
import { useBrowserBucketCors } from "./useBrowserBucketCors";
import { useBrowserBucketInspector } from "./useBrowserBucketInspector";
import { useBrowserBulkAttributes } from "./useBrowserBulkAttributes";
import { useBrowserBulkRestore } from "./useBrowserBulkRestore";
import { useBrowserBucketCatalog } from "./useBrowserBucketCatalog";
import { useBrowserClipboard } from "./useBrowserClipboard";
import { useBrowserContextMenu } from "./useBrowserContextMenu";
import { useBrowserContextCounts } from "./useBrowserContextCounts";
import {
  useBrowserCopyActions,
  type BrowserCopyDialogState,
} from "./useBrowserCopyActions";
import { useBrowserCreateBucket } from "./useBrowserCreateBucket";
import { useBrowserCreateFolder } from "./useBrowserCreateFolder";
import { useBrowserDeleteItems } from "./useBrowserDeleteItems";
import { useBrowserDownloads } from "./useBrowserDownloads";
import { useBrowserFolderTree } from "./useBrowserFolderTree";
import { useBrowserLazyColumns } from "./useBrowserLazyColumns";
import { useBrowserMultipartUploads } from "./useBrowserMultipartUploads";
import { useBrowserNavigationHistory } from "./useBrowserNavigationHistory";
import { useBrowserObjectColumns } from "./useBrowserObjectColumns";
import { useBrowserObjectListing } from "./useBrowserObjectListing";
import { useBrowserOperationOverview } from "./useBrowserOperationOverview";
import { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import { useBrowserPanelLayout } from "./useBrowserPanelLayout";
import { useBrowserPathEditor } from "./useBrowserPathEditor";
import { useBrowserQueuedUpload } from "./useBrowserQueuedUpload";
import { useBrowserSseCustomerKeys } from "./useBrowserSseCustomerKeys";
import { useBrowserStsSession } from "./useBrowserStsSession";
import { useBrowserUploadQueue } from "./useBrowserUploadQueue";
import { useBrowserVersionListing } from "./useBrowserVersionListing";
import { useBrowserVersionCleanup } from "./useBrowserVersionCleanup";
import { useBrowserVersionActions } from "./useBrowserVersionActions";
import BrowserBulkRestoreModal from "./BrowserBulkRestoreModal";
import BrowserCleanupModal from "./BrowserCleanupModal";
import {
  FULL_BROWSER_CAPABILITY_FACTS,
  type BrowserActionId,
  type BrowserCapabilityFacts,
  type BrowserDensity,
  type BrowserFunctionalProfile,
  type BrowserLayoutMode,
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
import BrowserInspectorPanel, {
  type BrowserInspectorTab,
} from "./BrowserInspectorPanel";
import BrowserObjectDetailsModal from "./BrowserObjectDetailsModal";
import BrowserOperationsModal from "./BrowserOperationsModal";
import BrowserOperationsPanel from "./BrowserOperationsPanel";
import BrowserMultipartUploadsModal from "./BrowserMultipartUploadsModal";
import BrowserMobileSelectionActions from "./BrowserMobileSelectionActions";
import BrowserPrefixVersionsModal from "./BrowserPrefixVersionsModal";
import {
  DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
  readBrowserRootUiState,
  readStoredBrowserRootUiState,
  writeBrowserRootActiveLayout,
  writeBrowserRootDensity,
  writeBrowserRootUiLayout,
} from "./browserRootUiState";
import { presignObjectWithSts, presignPartWithSts } from "./stsPresigner";
import { shouldUseStsPresigner } from "./sseBrowserLogic";
import { InfoIcon } from "./browserIcons";
import { resolveBrowserContextQuotas } from "./browserQuota";
import {
  VERSIONS_LIST_HARD_LIMIT,
  VERSIONS_PAGE_SIZE,
  bulkActionClasses,
  filterChipClasses,
  iconButtonClasses,
  storageClassOptions,
  toolbarButtonClasses,
} from "./browserConstants";
import type { BrowserPageProps } from "./browserPageContract";
import {
  formatDateTime,
  getSelectionInfo,
  normalizePrefix,
} from "./browserUtils";
import {
  CORS_DIRECT_TRANSFER_WARNING,
  buildBrowserTransferWarnings,
  resolveBrowserTransferAccessBadge,
  resolveBrowserTransferParallelism,
  resolveDirectCredentialStsTooltip,
} from "./browserTransferPresentation";
import {
  PANEL_LAYOUT_GAP_PX,
  PANEL_RESIZER_HITBOX_WIDTH_PX,
} from "./browserPanelLayout";
import {
  COLUMN_DEFINITIONS,
  COMFORTABLE_ROW_ACTION_TARGET_SIZE_PX,
  COMPACT_ROW_ACTION_TARGET_SIZE_PX,
  DEFAULT_VISIBLE_COLUMN_IDS,
  MIN_ACTIONS_COLUMN_WIDTH_PX,
  ROW_ACTION_CELL_HORIZONTAL_PADDING_PX,
  ROW_ACTION_GAP_PX,
  SELECTION_COLUMN_WIDTH_PX,
  buildBrowserItems,
  buildBrowserPathStats,
  collectAvailableStorageClasses,
  resolveColumnWidthPx,
  type BrowserColumnId,
  type BrowserSortKey,
} from "./browserObjectTableModel";
import { isBrowserInteractiveTarget } from "./browserObjectItemPresentation";
import {
  pushBucketPathHistory,
  readBucketPathHistory,
} from "./browserPathSuggestions";
import {
  resolveBucketAccessEntry,
  splitBucketPanelBuckets,
  type BucketAccessEntry,
} from "./browserBucketsPanelHelpers";
import { resolveBrowserWorkspaceContext } from "./browserPageContextModel";
import type {
  BrowserItem,
  ObjectDetailsTabId,
  UploadQueueItem,
} from "./browserTypes";

const MOBILE_OBJECT_LIST_MEDIA_QUERY = "(max-width: 767px)";

type ObjectDetailsTarget = {
  item: BrowserItem;
  initialTab: ObjectDetailsTabId;
};

type SearchScope = "prefix" | "bucket";
type BrowserConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<void> | void;
};
const DEFAULT_STREAMING_ZIP_THRESHOLD_MB = 200;
const BUCKET_ACCESS_ROOT_MARGIN = "120px";

const browserShellClasses =
  "flex min-h-0 flex-1 flex-col overflow-hidden";
const browserSubtleSurfaceClasses =
  cx(uiCardMutedClass, "shadow-none");
const browserFloatingMenuClasses =
  cx(uiMenuClass, "overflow-hidden p-1.5");
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
  const executionContextKind =
    executionContextKindOverride ?? selectedContext?.kind ?? null;
  const isCephAdminContext = executionContextKind === "ceph_admin";
  const isS3UserContext = executionContextKind === "s3_user";
  const isConnectionContext = executionContextKind === "connection";
  const [showBucketMenu, setShowBucketMenu] = useState(false);
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
  const {
    accessByName: bucketAccessByName,
    accountSwitchInFlight,
    bucketError,
    bucketFilter,
    bucketMenuItems,
    bucketMenuLoadingMore,
    bucketMenuTotal,
    bucketName,
    bucketTotalCount,
    canLoadMore: canLoadMoreBucketResults,
    getBucketAccessEntry,
    loadMore: handleBucketMenuLoadMore,
    loadingBuckets,
    prefix,
    refreshBucketList,
    scheduleBucketAccessProbe,
    selectBucket,
    setBucketFilter,
    setBucketName,
    setPrefix,
    updateBucketAccessEntry,
  } = useBrowserBucketCatalog({
    accountId: accountIdForApi,
    accessContextKey: bucketAccessContextKey,
    browserRootContextId,
    enabled: hasS3AccountContext,
    isCephAdminContext,
    isMainBrowserPath,
    lockedBucketName: resolvedLockedBucketName,
    onSelectedBucketNameChange,
    requestOptions: browserRequestOptions,
    requestedBucket,
    requestedPrefix,
    searchActive: showBucketMenu || showWorkspaceSidebar,
    usePortalWorkspaceLabels,
  });
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
  const {
    activeColumnResize,
    columnWidths,
    resetColumnWidth,
    resetColumns: handleResetVisibleColumns,
    startColumnResize,
    toggleVisibleColumn: handleToggleVisibleColumn,
    visibleColumns,
  } = useBrowserObjectColumns({
    isMainBrowserPath,
    layoutMode: activeLayoutMode,
  });
  const isMobileViewport = useMediaQuery(MOBILE_OBJECT_LIST_MEDIA_QUERY);
  const [inspectorTab, setInspectorTab] =
    useState<BrowserInspectorTab>("context");
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [browserSettings, setBrowserSettings] =
    useState<BrowserSettings | null>(null);
  const [useProxyTransfers, setUseProxyTransfers] = useState(false);
  const [filter, setFilter] = useState("");
  const [showSearchOptionsMenu, setShowSearchOptionsMenu] = useState(false);
  const [showToolbarMoreMenu, setShowToolbarMoreMenu] = useState(false);
  const [showToolbarColumnsMenu, setShowToolbarColumnsMenu] = useState(false);
  const [showUploadQuickMenu, setShowUploadQuickMenu] = useState(false);
  const [searchScope, setSearchScope] = useState<SearchScope>("prefix");
  const [searchRecursive, setSearchRecursive] = useState(false);
  const [searchExactMatch, setSearchExactMatch] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
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
  const {
    deletedObjects,
    deletedObjectsIsTruncated,
    deletedPrefixes,
    isVersioningEnabled,
    loadObjects,
    objects,
    objectsIsTruncated,
    objectsIssue,
    objectsLoading,
    objectsLoadingMore,
    objectsNextToken,
    prefixes,
    setShowObjectsIssueTechnicalDetails,
    showObjectsIssueTechnicalDetails,
  } = useBrowserObjectListing({
    accountId: accountIdForApi,
    accountSwitchInFlight,
    bucketName,
    caseSensitive: searchCaseSensitive,
    enabled: hasS3AccountContext,
    exactMatch: searchExactMatch,
    filter,
    getBucketAccessEntry,
    isPortalProfile,
    onWarning: setWarningMessage,
    prefix,
    recursive: searchRecursive,
    requestOptions: browserRequestOptions,
    searchScope,
    showDeletedObjects,
    sortBy: backendSortBy,
    sortDirection,
    sortId,
    storageFilter,
    typeFilter,
    updateBucketAccessEntry,
  });
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const {
    cancelCopyDetails,
    cancelDeleteDetails,
    cancelDownloadDetails,
    cancelOperation,
    cancelOperationController,
    clearOperationController,
    completeOperation,
    copyDetails,
    createOperationController,
    deleteDetails,
    downloadDetails,
    isOperationAborted,
    operations,
    recordCompletedActivity,
    setCopyDetails,
    setDeleteDetails,
    setDownloadDetails,
    setOperations,
    startOperation: startRegisteredOperation,
    updateOperation,
  } = useBrowserOperationRegistry();
  const {
    activeOperationsCount,
    allOtherOperations,
    clearFinishedOperations,
    closeOperationsDetailsModal,
    completedOperationsCount,
    copyGroups,
    deleteGroups,
    dismissOperationsPanel,
    downloadGroups,
    downloadOperationDetails,
    failedOperationsCount,
    filtersAllInactive,
    getSectionVisibleCount,
    hasFinishedOperations,
    hasOperationsPanelContent,
    hasPendingOperations,
    isGroupExpanded,
    openOperationsDetailsModal,
    operationsPanelOpen,
    operationsPanelTotalCount,
    operationSortFallback,
    operationSortIndexById,
    queuedOperationsCount,
    showActiveOperations,
    showCompletedOperations,
    showFailedOperations,
    showMoreSection,
    showOperationsBar,
    showOperationsDetailsModal,
    showOperationsPanel,
    showQueuedOperations,
    toggleGroupExpanded,
    toggleOperationFilter,
    toggleOperationsPanel,
    uploadGroups,
    uploadGroupSortIndexById,
    visibleCopyGroups,
    visibleDeleteGroups,
    visibleDownloadGroups,
    visibleOtherOperations,
    visibleUploadGroups,
  } = useBrowserOperationOverview({
    operations,
    setOperations,
    uploadQueue,
    downloadDetails,
    setDownloadDetails,
    deleteDetails,
    setDeleteDetails,
    copyDetails,
    setCopyDetails,
    setStatusMessage,
  });
  const startOperation = useCallback(
    (...args: Parameters<typeof startRegisteredOperation>) => {
      showOperationsBar();
      return startRegisteredOperation(...args);
    },
    [showOperationsBar, startRegisteredOperation],
  );
  const [objectDetailsTarget, setObjectDetailsTarget] =
    useState<ObjectDetailsTarget | null>(null);
  const [configBucketName, setConfigBucketName] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] =
    useState<BrowserConfirmDialogState | null>(null);
  const [confirmDialogLoading, setConfirmDialogLoading] = useState(false);
  const [copyDialog, setCopyDialog] = useState<BrowserCopyDialogState | null>(
    null,
  );
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const {
    closeContextMenu,
    contextMenu,
    contextMenuRef,
    openContextMenu,
  } = useBrowserContextMenu();
  const bucketMenuRef = useRef<HTMLDivElement | null>(null);
  const searchOptionsMenuRef = useRef<HTMLDivElement | null>(null);
  const searchControlRef = useRef<HTMLDivElement | null>(null);
  const searchOptionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const objectsListViewportRef = useRef<HTMLDivElement | null>(null);
  const bucketMenuFilterRef = useRef<HTMLInputElement | null>(null);
  const bucketPanelViewportRef = useRef<HTMLDivElement | null>(null);
  const bucketPanelLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const objectsRefreshTimeoutRef = useRef<number | null>(null);
  const accountIdForApiRef = useRef(accountIdForApi);
  const operationIdsRef = useRef(new Set<string>());
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
  const effectiveContextQuotaSizeGb = contextQuotaMaxSizeGb ?? null;
  const effectiveContextQuotaObjects = contextQuotaMaxObjects ?? null;
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
  const directCredentialContextKind = isConnectionContext
    ? "connection"
    : isS3UserContext
      ? "s3_user"
      : null;
  const stsEnabled =
    Boolean(effectiveCaps?.sts) &&
    directCredentialContextKind === null &&
    !isPortalProfile;
  const {
    available: stsAvailable,
    credentials: stsCredentials,
    credentialsError: stsCredentialsError,
    ensureCredentials: ensureStsCredentials,
  } = useBrowserStsSession({
    accountIdForApi,
    enabled: stsEnabled,
    hasContext: hasS3AccountContext,
    requestOptions: browserRequestOptions,
  });
  const sseFeatureEnabled =
    Boolean(effectiveCaps?.sse) && resolvedFunctionalProfile === "advanced";
  const bucketInspectorUsageEnabled = effectiveCaps
    ? effectiveCaps.metrics !== false
    : true;
  const bucketInspectorStaticWebsiteEnabled =
    effectiveCaps?.static_website ?? true;
  const {
    data: bucketInspectorData,
    error: bucketInspectorError,
    features: bucketInspectorFeatures,
    load: loadBucketInspectorData,
    loading: bucketInspectorLoading,
  } = useBrowserBucketInspector({
    accountId: accountIdForApi,
    bucketName,
    enabled: hasS3AccountContext,
    includeStaticWebsite: bucketInspectorStaticWebsiteEnabled,
    includeUsage: bucketInspectorUsageEnabled,
  });
  const openSseCustomerKeyCopyDialog = useCallback((keyBase64: string) => {
    setCopyDialog({
      title: "Copy SSE-C key",
      label: "SSE-C key",
      value: keyBase64,
      successMessage: "SSE-C key copied to clipboard.",
    });
  }, []);
  const {
    keyBase64: sseCustomerKeyBase64,
    active: sseActive,
    getKeyForScope: getSseCustomerKeyForScope,
    showModal: showSseCustomerModal,
    input: sseCustomerKeyInput,
    visible: sseCustomerKeyVisible,
    error: sseCustomerKeyError,
    notice: sseCustomerKeyNotice,
    canGenerate: canGenerateSseCustomerKey,
    open: openSseCustomerModal,
    updateInput: updateSseCustomerKeyInput,
    toggleVisibility: toggleSseCustomerKeyVisibility,
    generate: generateSseCustomerKey,
    clear: clearSseCustomerKey,
    activate: activateSseCustomerKey,
    requestClose: requestSseCustomerModalClose,
    confirmationDialog: sseCustomerConfirmationDialog,
  } = useBrowserSseCustomerKeys({
    accountIdForApi,
    bucketName,
    enabled: sseFeatureEnabled,
    onManualCopyRequired: openSseCustomerKeyCopyDialog,
    setStatusMessage,
  });
  const showSseControls = Boolean(
    sseFeatureEnabled && hasS3AccountContext && bucketName,
  );
  const {
    activePanelResize,
    canUseFoldersPanel,
    canUseInspectorPanel,
    isFoldersPanelVisible,
    isInspectorPanelVisible,
    layoutContainerRef,
    layoutTemplateColumns,
    resolvedFoldersWidth,
    resolvedInspectorWidth,
    resetFoldersPanelWidth,
    resetInspectorPanelWidth,
    setPanelWidths,
    startPanelResize,
  } = useBrowserPanelLayout({
    allowFoldersPanel:
      allowFoldersPanel &&
      activeLayoutMode === "workbench" &&
      resolvedFunctionalProfile === "advanced",
    allowInspectorPanel:
      allowInspectorPanel &&
      activeLayoutMode === "workbench" &&
      resolvedFunctionalProfile === "advanced",
    initialFoldersPanelWidthPx:
      initialRootUiLayout?.foldersPanelWidthPx ??
      DEFAULT_FOLDERS_PANEL_WIDTH_PX,
    initialInspectorPanelWidthPx:
      initialRootUiLayout?.inspectorPanelWidthPx ??
      DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
    layoutMode: activeLayoutMode,
    persistWidths: isMainBrowserPath,
    showFolders,
    showInspector,
  });

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
      setPanelWidths(
        nextLayout.foldersPanelWidthPx,
        nextLayout.inspectorPanelWidthPx,
      );
      setActiveLayoutMode(nextMode);
    },
    [isMainBrowserPath, resolvedFunctionalProfile, setPanelWidths],
  );

  const normalizedPrefix = useMemo(() => normalizePrefix(prefix), [prefix]);
  const uiOrigin = useMemo(
    () => (typeof window === "undefined" ? undefined : window.location.origin),
    [],
  );
  const {
    status: corsStatus,
    error: corsFixError,
    fixing: corsFixing,
    actionAvailable: hasCorsAction,
    popoverOpen: showCorsActionPopover,
    triggerRef: corsActionTriggerRef,
    popoverRef: corsActionPopoverRef,
    togglePopover: toggleCorsActionPopover,
    ensureCors: handleEnsureCors,
    setStatus: setCorsStatus,
    setError: setCorsFixError,
  } = useBrowserBucketCors({
    accountIdForApi,
    allowAction: !isPortalProfile,
    bucketName,
    enabled:
      !accountSwitchInFlight && Boolean(bucketName) && hasS3AccountContext,
    origin: uiOrigin,
    requestOptions: browserRequestOptions,
    setStatusMessage,
  });
  const transferParallelism = useMemo(
    () =>
      resolveBrowserTransferParallelism(browserSettings, useProxyTransfers),
    [browserSettings, useProxyTransfers],
  );
  const uploadParallelism = transferParallelism.upload;
  const downloadParallelism = transferParallelism.download;
  const otherOperationsParallelism = transferParallelism.otherOperations;
  const proxyAllowed = browserSettings?.allow_proxy_transfers ?? false;
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
  const { copyPath: handleCopyPath, copyUrl: handleCopyUrl } =
    useBrowserCopyActions({
      bucketName,
      enabled: hasS3AccountContext,
      onFallback: setCopyDialog,
      onStatus: setStatusMessage,
      onWarning: setWarningMessage,
      presignObject: presignObjectRequest,
      sseActive,
    });
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
  useEffect(() => {
    setInspectorTab("context");
  }, [bucketName, prefix]);

  useEffect(() => {
    setShowSearchOptionsMenu(false);
  }, [bucketName, prefix]);

  useEffect(() => {
    setShowToolbarMoreMenu(false);
  }, [bucketName, prefix, selectedIds]);

  useDismissibleLayer({
    open: showBucketMenu,
    insideRefs: [bucketMenuRef],
    onDismiss: () => setShowBucketMenu(false),
  });

  useEffect(() => {
    if (showBucketMenu) {
      bucketMenuFilterRef.current?.focus();
    }
  }, [showBucketMenu]);

  useDismissibleLayer({
    open: showSearchOptionsMenu,
    insideRefs: [searchControlRef, searchOptionsMenuRef],
    onDismiss: () => setShowSearchOptionsMenu(false),
  });

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
  }, [accountIdForApi, browserRequestOptions, hasS3AccountContext]);

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

  useLayoutEffect(() => {
    if (!accountSwitchInFlight) return;
    setActiveItem(null);
  }, [accountSwitchInFlight]);

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
    if (isVersioningEnabled) return;
    setInternalShowDeletedObjects(false);
    setShowPrefixVersions(false);
    setObjectDetailsTarget((prev) =>
      prev?.initialTab === "versions" ? null : prev,
    );
  }, [bucketName, isVersioningEnabled]);

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
  const {
    loadTreeChildren,
    toggleTreeNode: handleToggleTreeNode,
    treeRootNode,
  } = useBrowserFolderTree({
    accountId: accountIdForApi,
    accountSwitchInFlight,
    bucketName,
    currentBucketUnavailable,
    enabled: hasS3AccountContext,
    onWarning: setWarningMessage,
    prefix,
    requestOptions: browserRequestOptions,
  });
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
  }, [
    objectsIssue,
    setShowObjectsIssueTechnicalDetails,
    showObjectsIssueTechnicalDetails,
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
  const lazyColumnCache = useBrowserLazyColumns({
    accountId: accountIdForApi,
    bucketName,
    enabled: hasS3AccountContext,
    items: listItems,
    metadataColumnsVisible: lazyMetadataColumnsVisible,
    prefix,
    requestOptions: browserRequestOptions,
    sseCustomerKeyBase64,
    tagsColumnVisible: lazyTagsColumnsVisible,
    viewportRef: objectsListViewportRef,
  });
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
    hasSearchQuery || hasAdvancedSearchOptionsActive;
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
  const handleBucketChange = useCallback(
    (value: string) => {
      setShowBucketMenu(false);
      if (selectBucket(value)) setActiveItem(null);
    },
    [selectBucket],
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

  const cephQuotaScopeLabel = isS3UserContext
    ? "User quota"
    : "Account quota";
  const inspectedItem = useMemo(() => {
    if (activeItem && items.some((entry) => entry.id === activeItem.id)) {
      return activeItem;
    }
    return null;
  }, [activeItem, items]);

  const handleVersionsHardLimit = useCallback(() => {
    setWarningMessage(
      `Versions listing is limited to ${VERSIONS_LIST_HARD_LIMIT.toLocaleString()} entries. Narrow your path to continue.`,
    );
  }, []);
  const {
    error: prefixVersionsError,
    keyMarker: prefixVersionKeyMarker,
    load: loadPrefixVersions,
    loading: prefixVersionsLoading,
    rows: prefixVersionRows,
    versionIdMarker: prefixVersionIdMarker,
  } = useBrowserVersionListing({
    accountId: accountIdForApi,
    autoLoad: true,
    bucketName,
    enabled:
      showPrefixVersions &&
      hasS3AccountContext &&
      isVersioningEnabled,
    errorMessage: "Unable to list versions for this prefix.",
    hardLimit: VERSIONS_LIST_HARD_LIMIT,
    onHardLimit: handleVersionsHardLimit,
    pageSize: VERSIONS_PAGE_SIZE,
    prefix: normalizedPrefix,
    requestOptions: browserRequestOptions,
  });
  const inspectedObjectKey =
    inspectedItem?.type === "file" ? inspectedItem.key : null;
  const {
    canLoadMore: canLoadMoreObjectVersions,
    error: objectVersionsError,
    load: loadObjectVersions,
    loading: objectVersionsLoading,
    rows: objectVersionRows,
  } = useBrowserVersionListing({
    accountId: accountIdForApi,
    autoLoad: true,
    bucketName,
    enabled:
      isInspectorPanelVisible &&
      inspectorTab === "details" &&
      hasS3AccountContext &&
      Boolean(inspectedObjectKey) &&
      isVersioningEnabled,
    errorMessage: "Unable to list versions for this object.",
    hardLimit: VERSIONS_LIST_HARD_LIMIT,
    objectKey: inspectedObjectKey,
    onHardLimit: handleVersionsHardLimit,
    pageSize: VERSIONS_PAGE_SIZE,
    requestOptions: browserRequestOptions,
  });

  const selectionItems = selectedItems;
  const selectionInfo = getSelectionInfo(selectionItems);
  const selectionFiles = selectionInfo.files;
  const selectionFolders = selectionInfo.folders;
  const selectionIsSingle = selectionInfo.isSingle;
  const selectionPrimary = selectionInfo.primary;
  const selectionHasDeleted = selectionInfo.hasDeleted;
  const canSelectionActions = selectionInfo.items.length > 0;

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
  const currentPath = useMemo(() => {
    if (!bucketName) return "";
    if (!prefix) return bucketName;
    const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return `${bucketName}/${trimmed}`;
  }, [bucketName, prefix]);

  const refreshObjectsNow = useCallback(
    async (prefixOverride: string) => {
      await loadObjects({ prefixOverride, silent: true, forceRefresh: true });
      loadTreeChildren(prefixOverride, { expand: false });
    },
    [loadObjects, loadTreeChildren],
  );

  const reloadObjects = useCallback(
    async (prefixOverride: string) => {
      await loadObjects({ prefixOverride });
      loadTreeChildren(prefixOverride);
    },
    [loadObjects, loadTreeChildren],
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

  const {
    count: handleContextCount,
    counts: contextCounts,
    error: contextCountsError,
    loading: contextCountsLoading,
  } = useBrowserContextCounts({
    accountId: accountIdForApi,
    bucketName,
    enabled: hasS3AccountContext,
    listAllObjectsForPrefix,
    prefix: normalizedPrefix,
    requestOptions: browserRequestOptions,
    versioningEnabled: isVersioningEnabled,
  });

  const {
    canPaste: canPasteInFunctionalProfile,
    clipboard,
    copy: handleCopyItems,
    cut: handleCutItems,
    paste: handlePasteItems,
  } = useBrowserClipboard({
    accountId: accountIdForApi,
    bucketName,
    cancelCopyDetails,
    clearOperationController,
    completeOperation,
    createOperationController,
    enabled: hasS3AccountContext,
    functionalProfile: resolvedFunctionalProfile,
    getSseCustomerKeyForScope,
    listAllObjectsForPrefix,
    normalizedPrefix,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    parallelism: otherOperationsParallelism,
    proxyAllowed,
    requestOptions: browserRequestOptions,
    setCopyDetails,
    showOperations: showOperationsBar,
    startOperation,
    uiOrigin,
    updateOperation,
  });

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

  const handleItemDoubleClick = (
    event: ReactMouseEvent<HTMLElement>,
    item: BrowserItem,
  ) => {
    if (isBrowserInteractiveTarget(event.target)) return;
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

  const handleSelectPrefix = useCallback(
    (nextPrefix: string) => {
      setPrefix(nextPrefix);
      setActiveItem(null);
      if (bucketName) {
        setPathHistory(pushBucketPathHistory(bucketName, nextPrefix));
      }
    },
    [bucketName, setPrefix],
  );
  const {
    activeSuggestionIndex: pathSuggestionIndex,
    applySuggestion: applyPathSuggestion,
    cancel: cancelPathEdit,
    commit: commitPathDraft,
    editing: isEditingPath,
    handleKeyDown: handlePathKeyDown,
    inputRef: pathInputRef,
    setActiveSuggestionIndex: setPathSuggestionIndex,
    setValue: setPathDraft,
    startEditing: startEditingPath,
    suggestions: pathSuggestions,
    suggestionsLoading: pathSuggestionsLoading,
    value: pathDraft,
  } = useBrowserPathEditor({
    accountId: accountIdForApi,
    bucketName,
    enabled: hasS3AccountContext,
    history: pathHistory,
    localPrefixes: prefixes,
    onCommit: handleSelectPrefix,
    prefix,
    requestOptions: browserRequestOptions,
  });
  useBrowserNavigationHistory({
    bucketName,
    prefix,
    onNavigate: ({ bucketName: nextBucket, prefix: nextPrefix }) => {
      setBucketName(nextBucket);
      setPrefix(nextPrefix);
      setActiveItem(null);
      cancelPathEdit();
    },
  });

  useEffect(() => {
    setSelectedIds([]);
    setSelectionAnchorId(null);
    setActiveRowId(null);
    setActiveItem(null);
    setStatusMessage(null);
    setWarningMessage(null);
    setObjectDetailsTarget(null);
  }, [accountIdForApi, bucketName, prefix]);

  useEffect(() => {
    accountIdForApiRef.current = accountIdForApi;
  }, [accountIdForApi]);

  useEffect(() => {
    if (!bucketName) {
      setPathHistory([]);
      return;
    }
    setPathHistory(readBucketPathHistory(bucketName));
  }, [bucketName]);

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

  const handleOpenBucketInspector = useCallback(() => {
    setInspectorTab("bucket");
    void loadBucketInspectorData();
  }, [loadBucketInspectorData]);

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
    openContextMenu(
      {
        kind: isSelected && selectedItems.length > 1 ? "selection" : "item",
        item,
        items: itemsForMenu,
      },
      { x: event.clientX, y: event.clientY },
    );
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
    openContextMenu(
      { kind: "item", item, items: [item] },
      {
        x: rect.right,
        y: rect.bottom + 6,
        horizontalAlignment: "end",
      },
    );
  };

  const handlePathContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, label")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(
      { kind: "path" },
      { x: event.clientX, y: event.clientY },
    );
  };

  const handleHeaderContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!isMainBrowserPath) return;
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(
      { kind: "headerConfig" },
      { x: event.clientX, y: event.clientY },
    );
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isBrowserInteractiveTarget(event.target)) {
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

  const handleBrowserBucketCreated = useCallback(
    async (createdBucketName: string) => {
      await refreshBucketList({ preferredBucket: createdBucketName });
      void loadBucketInspectorData(true);
    },
    [loadBucketInspectorData, refreshBucketList],
  );
  const {
    showModal: showCreateBucketModal,
    name: createBucketNameValue,
    versioning: createBucketVersioning,
    loading: createBucketLoading,
    error: createBucketError,
    isNameValid: isCreateBucketNameValid,
    invalidNameMessage: invalidBucketNameMessage,
    open: openCreateBucketForm,
    updateName: updateCreateBucketName,
    setVersioning: setCreateBucketVersioning,
    submit: submitCreateBucket,
    requestClose: requestCreateBucketClose,
    confirmationDialog: createBucketConfirmationDialog,
  } = useBrowserCreateBucket({
    accountIdForApi,
    currentBucketName: bucketName,
    enabled: bucketManagementEnabled,
    hasContext: hasS3AccountContext,
    requestOptions: browserRequestOptions,
    uiOrigin,
    onCreated: handleBrowserBucketCreated,
    setCorsError: setCorsFixError,
    setCorsStatus,
    setStatusMessage,
  });
  const openCreateBucketDialog = useCallback(() => {
    if (!bucketManagementEnabled) return;
    setShowBucketMenu(false);
    setBucketFilter("");
    openCreateBucketForm();
  }, [bucketManagementEnabled, openCreateBucketForm, setBucketFilter]);

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
      setBucketFilter,
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
      void loadPrefixVersions({ force: true });
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

  const handleGoUp = () => {
    if (!canGoUp) return;
    handleSelectPrefix(parentPrefix);
  };

  const addActivity = (action: string, path: string) => {
    showOperationsBar();
    recordCompletedActivity(action, path);
  };

  const handleBrowserFolderCreated = async ({
    name,
    prefix: createdFolderPrefix,
  }: {
    name: string;
    prefix: string;
  }) => {
    addActivity("Created", `${bucketName}/${createdFolderPrefix}`);
    setStatusMessage(`Folder ${name} created`);
    await loadObjects({ prefixOverride: prefix });
    loadTreeChildren(prefix);
  };
  const {
    showModal: showNewFolderModal,
    inputRef: newFolderInputRef,
    name: newFolderName,
    loading: newFolderLoading,
    error: newFolderError,
    open: handleNewFolder,
    setName: setNewFolderName,
    submit: submitNewFolder,
    requestClose: requestNewFolderClose,
    confirmationDialog: newFolderConfirmationDialog,
  } = useBrowserCreateFolder({
    accountIdForApi,
    bucketName,
    hasContext: hasS3AccountContext,
    parentPrefix: normalizedPrefix,
    requestOptions: browserRequestOptions,
    onCreated: handleBrowserFolderCreated,
  });

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

  const startQueuedUpload = useBrowserQueuedUpload({
    clearOperationController,
    completeOperation,
    createOperationController,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    presignObject: presignObjectRequest,
    presignPart: presignPartRequest,
    requestOptions: browserRequestOptions,
    sseCustomerKeyBase64,
    startOperation,
    transferReporter,
    updateOperation,
    useProxyTransfers,
  });

  const refreshUploadedListing = useCallback(
    (targetPrefix: string) => {
      void loadObjects({
        prefixOverride: targetPrefix,
        silent: true,
        forceRefresh: true,
      });
      loadTreeChildren(targetPrefix, { expand: false });
    },
    [loadObjects, loadTreeChildren],
  );

  const {
    cancelUploadGroup,
    dragging,
    fileInputRef,
    folderInputRef,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileInputChange,
    handleFolderInputChange,
    removeQueuedUpload,
  } = useBrowserUploadQueue({
    accountId: accountIdForApi,
    bucketName,
    cancelOperationController,
    enabled: hasS3AccountContext,
    normalizedPrefix,
    onRefreshListing: refreshUploadedListing,
    onShowOperations: showOperationsBar,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    operations,
    parallelism: uploadParallelism,
    prefix,
    setUploadQueue,
    startUpload: startQueuedUpload,
    workspaceNoun,
  });

  useEffect(() => {
    return () => {
      if (objectsRefreshTimeoutRef.current !== null) {
        window.clearTimeout(objectsRefreshTimeoutRef.current);
        objectsRefreshTimeoutRef.current = null;
      }
    };
  }, []);

  const openConfirmDialog = (dialog: BrowserConfirmDialogState) => {
    setConfirmDialog(dialog);
    setConfirmDialogLoading(false);
  };

  const {
    showModal: showMultipartUploadsModal,
    uploads: multipartUploads,
    loading: multipartUploadsLoading,
    loadingMore: multipartUploadsLoadingMore,
    error: multipartUploadsError,
    canLoadMore: canLoadMoreMultipartUploads,
    abortingUploadIds: abortingMultipartUploadIds,
    open: openMultipartUploadsModal,
    refresh: refreshMultipartUploads,
    loadMore: loadMoreMultipartUploads,
    close: closeMultipartUploadsModal,
    requestAbort: requestAbortMultipartUpload,
  } = useBrowserMultipartUploads({
    accountIdForApi,
    bucketName,
    hasContext: hasS3AccountContext,
    requestOptions: browserRequestOptions,
    requestConfirmation: openConfirmDialog,
    setStatusMessage,
    setWarningMessage,
  });

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

  const {
    apply: handleBulkAttributesApply,
    close: closeBulkAttributesModal,
    draft: bulkAttributesDraft,
    error: bulkAttributesError,
    fileCount: bulkAttributesFileCount,
    folderCount: bulkAttributesFolderCount,
    loading: bulkAttributesLoading,
    open: showBulkAttributesModal,
    setDraft: setBulkAttributesDraft,
    show: openBulkAttributesModal,
    summary: bulkAttributesSummary,
  } = useBrowserBulkAttributes({
    accountId: accountIdForApi,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    enabled: hasS3AccountContext,
    listAllObjectsForPrefix,
    onRefresh: requestObjectsRefresh,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    parallelism: otherOperationsParallelism,
    prefix,
    requestOptions: browserRequestOptions,
    showOperations: showOperationsBar,
    startOperation,
    updateOperation,
  });

  const {
    deleteObjectsInBatches,
    remove: handleDeleteItems,
  } = useBrowserDeleteItems({
    accountId: accountIdForApi,
    bucketName,
    cancelDeleteDetails,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    enabled: hasS3AccountContext,
    isOperationAborted,
    listAllObjectsForPrefix,
    onConfirm: openConfirmDialog,
    onProcessed: (processedItems) => {
      setSelectedIds((previous) =>
        previous.filter(
          (id) => !processedItems.some((item) => item.id === id),
        ),
      );
    },
    onRefresh: reloadObjects,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    parallelism: otherOperationsParallelism,
    prefix,
    requestOptions: browserRequestOptions,
    setDeleteDetails,
    showOperations: showOperationsBar,
    startOperation,
    updateOperation,
  });

  const {
    apply: handleBulkRestoreApply,
    close: closeBulkRestoreModal,
    draft: bulkRestoreDraft,
    error: bulkRestoreError,
    fileCount: bulkRestoreFileCount,
    folderCount: bulkRestoreFolderCount,
    loading: bulkRestoreLoading,
    open: showBulkRestoreModal,
    preview: bulkRestorePreview,
    setDraft: setBulkRestoreDraft,
    show: openBulkRestoreModal,
    summary: bulkRestoreSummary,
    targetPath: bulkRestoreTargetPath,
  } = useBrowserBulkRestore({
    accountId: accountIdForApi,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    deleteObjectsInBatches,
    enabled: hasS3AccountContext,
    isOperationAborted,
    listAllObjectsForPrefix,
    normalizedPrefix,
    onRefresh: requestObjectsRefresh,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    parallelism: otherOperationsParallelism,
    prefix,
    requestOptions: browserRequestOptions,
    showOperations: showOperationsBar,
    startOperation,
    updateOperation,
    versioningEnabled: isVersioningEnabled,
  });

  const {
    apply: handleCleanupApply,
    close: closeCleanupModal,
    draft: cleanupDraft,
    error: cleanupError,
    loading: cleanupLoading,
    open: showCleanupModal,
    setDraft: setCleanupDraft,
    show: openCleanupModal,
    summary: cleanupSummary,
  } = useBrowserVersionCleanup({
    accountId: accountIdForApi,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    enabled: hasS3AccountContext,
    isOperationAborted,
    normalizedPrefix,
    onRefresh: requestObjectsRefresh,
    onRefreshNow: refreshObjectsNow,
    onStatus: setStatusMessage,
    prefix,
    requestOptions: browserRequestOptions,
    showOperations: showOperationsBar,
    startOperation,
    versioningEnabled: isVersioningEnabled,
  });

  const {
    downloadFolder: handleDownloadFolder,
    downloadItems: handleDownloadItems,
  } = useBrowserDownloads({
    accountId: accountIdForApi,
    bucketName,
    cancelDownloadDetails,
    clearOperationController,
    completeOperation,
    createOperationController,
    currentPath,
    enabled: hasS3AccountContext,
    listAllObjectsForPrefix,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    parallelism: downloadParallelism,
    presignDownload: presignObjectRequest,
    requestOptions: browserRequestOptions,
    setDownloadDetails,
    showOperations: showOperationsBar,
    sseActive,
    sseCustomerKeyBase64,
    startOperation,
    streamingZipThresholdMb:
      browserSettings?.streaming_zip_threshold_mb ??
      DEFAULT_STREAMING_ZIP_THRESHOLD_MB,
    transferReporter,
    updateOperation,
    useProxyTransfers,
  });

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
      await loadPrefixVersions({ force: true });
    }
  };

  const refreshVersionsForKey = async (targetKey: string) => {
    if (
      inspectorTab === "details" &&
      inspectedItem?.type === "file" &&
      inspectedItem.key === targetKey
    ) {
      await loadObjectVersions({ force: true });
    }
  };

  const {
    remove: handleDeleteVersion,
    restore: handleRestoreVersion,
  } = useBrowserVersionActions({
    accountId: accountIdForApi,
    bucketName,
    clearOperationController,
    completeOperation,
    createOperationController,
    enabled: hasS3AccountContext,
    isOperationAborted,
    onConfirm: openConfirmDialog,
    onRefreshListing: refreshObjectListing,
    onRefreshVersions: refreshVersionsForKey,
    onStatus: setStatusMessage,
    onWarning: setWarningMessage,
    requestOptions: browserRequestOptions,
    startOperation,
    versioningEnabled: isVersioningEnabled,
  });

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

  const leaveMessage =
    "Operations are in progress (upload, download, copy, delete). Leaving now may interrupt them. Continue?";
  unstable_usePrompt({
    when: hasPendingOperations,
    message: leaveMessage,
  });
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
  const chromeChipButtonClasses = filterChipClasses;
  const chromeToolbarButtonClasses = toolbarButtonClasses;
  const chromeBulkActionClasses = bulkActionClasses;
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
  const hasToolbarColumnsSection = !isPortalProfile;
  const toolbarColumnsSummary = `${effectiveVisibleColumns.length}/${COLUMN_DEFINITIONS.length} visible`;
  const handleToolbarDownload = () => {
    runSelectionAction("download");
  };
  const handleToolbarOpen = () => {
    runSelectionAction("open");
  };

  const handleSearchScopeChange = (scope: SearchScope) => {
    setSearchScope(scope);
    if (scope === "bucket") {
      setSearchRecursive(false);
    }
  };

  const clearSearchFilters = () => {
    setFilter("");
    setSearchScope("prefix");
    setSearchRecursive(false);
    setSearchExactMatch(false);
    setSearchCaseSensitive(false);
    setTypeFilter("all");
    setStorageFilter("all");
  };

  const renderNameHeaderContent = () => (
    <BrowserObjectSearchHeader
      rootRef={searchControlRef}
      optionsButtonRef={searchOptionsButtonRef}
      optionsMenuRef={searchOptionsMenuRef}
      portalProfile={isPortalProfile}
      optionsOpen={showSearchOptionsMenu}
      filter={filter}
      objectNounPlural={workspaceObjectNounPlural}
      nameSortActive={sortKey === "name"}
      sortDirection={sortDirection}
      advancedOptionsActive={hasAdvancedSearchOptionsActive}
      hasSearchQuery={hasSearchQuery}
      searchScope={searchScope}
      recursive={searchRecursive}
      exactMatch={searchExactMatch}
      caseSensitive={searchCaseSensitive}
      typeFilter={typeFilter}
      storageFilter={storageFilter}
      storageClasses={searchableStorageClasses}
      canReset={hasActiveSearchFilters}
      onSortName={() => handleSortToggle("name")}
      onFilterChange={setFilter}
      onToggleOptions={() => setShowSearchOptionsMenu((current) => !current)}
      onScopeChange={handleSearchScopeChange}
      onRecursiveChange={setSearchRecursive}
      onExactMatchChange={setSearchExactMatch}
      onCaseSensitiveChange={setSearchCaseSensitive}
      onTypeFilterChange={setTypeFilter}
      onStorageFilterChange={setStorageFilter}
      onClear={clearSearchFilters}
      onClose={() => setShowSearchOptionsMenu(false)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {isEmbeddedBrowserPath ? (
        <h2 className="sr-only">{isPortalBrowserSurface ? "Portal browser" : "Browser"}</h2>
      ) : (
        <h1 className="sr-only">{isPortalBrowserSurface ? "Portal browser" : "Browser"}</h1>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <div className={browserShellClasses}>
        <div className={browserChromeShellClasses}>
          <BrowserToolbar
            bucketSelector={{
              rootRef: bucketMenuRef,
              filterInputRef: bucketMenuFilterRef,
              lockedBucketName: resolvedLockedBucketName,
              hasContext: hasS3AccountContext,
              open: showBucketMenu,
              buttonLabel: bucketButtonLabel,
              buttonActionLabel: bucketButtonActionLabel,
              needsAttention: bucketSelectorNeedsAttention,
              workspaceNoun: selectorWorkspaceNoun,
              workspaceNounPlural: selectorWorkspaceNounPlural,
              workspaceNounTitle: selectorWorkspaceNounTitle,
              bucketManagementEnabled,
              filter: bucketFilter,
              loading: loadingBuckets,
              hasError: Boolean(bucketError),
              totalCount: bucketTotalCount,
              total: bucketMenuTotal,
              items: bucketMenuItems,
              activeBucketName: bucketName,
              displayNameByBucket: bucketDisplayNameByName,
              canLoadMore: canLoadMoreBucketResults,
              loadingMore: bucketMenuLoadingMore,
              onToggle: () => setShowBucketMenu((current) => !current),
              onCreateBucket: openCreateBucketDialog,
              onFilterChange: setBucketFilter,
              onRetry: () => void refreshBucketList(),
              onSelectBucket: handleBucketChange,
              onLoadMore: handleBucketMenuLoadMore,
            }}
            pathNavigator={{
              inputRef: pathInputRef,
              editing: isEditingPath,
              value: pathDraft,
              disabled: !bucketName,
              suggestions: pathSuggestions,
              suggestionsLoading: pathSuggestionsLoading,
              activeSuggestionIndex: pathSuggestionIndex,
              breadcrumbs,
              canGoUp,
              onStartEditing: startEditingPath,
              onChange: setPathDraft,
              onBlur: commitPathDraft,
              onKeyDown: handlePathKeyDown,
              onHoverSuggestion: setPathSuggestionIndex,
              onSelectSuggestion: (suggestion) =>
                applyPathSuggestion(suggestion, { commit: true }),
              onGoUp: handleGoUp,
              onSelectPrefix: handleSelectPrefix,
            }}
            deletedObjects={{
              showToggle: Boolean(
                !isPortalProfile &&
                  deletedObjectsOptions?.showToggle &&
                  isVersioningEnabled &&
                  bucketName,
              ),
              showDeleted: showDeletedObjects,
              showRestore: Boolean(
                deletedObjectsOptions?.onRestorePrefix &&
                  pathActionStates.restore.visible &&
                  showDeletedObjects &&
                  isVersioningEnabled &&
                  bucketName &&
                  normalizedPrefix,
              ),
              restoreEnabled: pathActionStates.restore.enabled,
            }}
            compactActions={{
              visible: isCompactToolbarMode,
              uploadMenuOpen: showUploadQuickMenu,
              canUploadFiles: toolbarCanUploadFiles,
              canUploadFolder: toolbarCanUploadFolder,
              canCreateFolder: toolbarCanCreateFolder,
              canRefresh: pathActionStates.refresh.enabled,
              onUploadMenuOpenChange: setShowUploadQuickMenu,
            }}
            selectionActions={{
              visible: isActionBarVisible,
              mobileViewport: isMobileViewport,
              summary: toolbarSelectionSummary,
              canOpen: toolbarCanOpen,
              canCopy: toolbarCanCopy,
              canDownload: toolbarCanDownload,
              canDelete: toolbarCanDelete,
            }}
            moreMenu={{
              open: showToolbarMoreMenu,
              onOpenChange: setShowToolbarMoreMenu,
              status: {
                visible: hasToolbarStatusSection,
                accessBadge,
                viewLabel: isMainBrowserPath ? browserViewLabel : undefined,
                operationsCount: hasToolbarOperationsAction
                  ? operationsPanelTotalCount
                  : undefined,
                onOpenOperations: openOperationsDetailsModal,
              },
              layout: {
                folders: showFolderToggle
                  ? { checked: showFolders, onToggle: toggleFoldersPanel }
                  : undefined,
                inspector: showInspectorToggle
                  ? { checked: showInspector, onToggle: toggleInspectorPanel }
                  : undefined,
                workbench: showLayoutModeToggle
                  ? {
                      checked: activeLayoutMode === "workbench",
                      onToggle: () =>
                        changeLayoutMode(
                          activeLayoutMode === "workbench"
                            ? "standard"
                            : "workbench",
                        ),
                    }
                  : undefined,
              },
              columns: hasToolbarColumnsSection
                ? {
                    open: showToolbarColumnsMenu,
                    summary: toolbarColumnsSummary,
                    columns: COLUMN_DEFINITIONS,
                    visibleColumnIds: visibleColumnSet,
                    onOpenChange: setShowToolbarColumnsMenu,
                    onToggleColumn: handleToggleVisibleColumn,
                    onReset: handleResetVisibleColumns,
                  }
                : undefined,
              pathActions: toolbarPathActions,
              selectionActions: hasToolbarSelectionActions
                ? toolbarSelectionActions
                : [],
              selectionOverflow: isActionBarVisible,
              sse: showSseControls
                ? {
                    enabled: Boolean(
                      bucketName &&
                        hasS3AccountContext &&
                        sseFeatureEnabled,
                    ),
                    active: sseActive,
                    onOpen: openSseCustomerModal,
                  }
                : undefined,
            }}
            fileInputRef={fileInputRef}
            folderInputRef={folderInputRef}
            onFileInputChange={handleFileInputChange}
            onFolderInputChange={handleFolderInputChange}
            onRunPathAction={runPathAction}
            onRunSelectionAction={runSelectionAction}
          />
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
                        onClick={toggleCorsActionPopover}
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
              <BrowserObjectExplorer
                viewportRef={objectsListViewportRef}
                dragging={dragging}
                mobile={isMobileViewport}
                bucketName={bucketName}
                normalizedPrefix={normalizedPrefix}
                workspaceNoun={workspaceNoun}
                workspaceObjectNounPlural={workspaceObjectNounPlural}
                items={listItems}
                selectedIds={selectedSet}
                loading={objectsLoading}
                loadingMore={objectsLoadingMore}
                canLoadMore={canLoadMoreObjectResults}
                objectsIsTruncated={objectsIsTruncated}
                deletedObjectsIsTruncated={deletedObjectsIsTruncated}
                showDeletedObjects={showDeletedObjects}
                showParentFolder={Boolean(
                  canGoUp &&
                    bucketName &&
                    showFolderItems &&
                    !isSearchingInWholeBucket,
                )}
                hasActiveSearchFilters={hasActiveSearchFilters}
                searchStatusChips={activeSearchStatusChips}
                issue={
                  objectsIssue
                    ? {
                        title: objectsIssue.title,
                        description: objectsIssueDescription,
                      }
                    : null
                }
                lazyColumnCache={lazyColumnCache}
                isPortalProfile={isPortalProfile}
                table={{
                  scaffold: {
                    minWidthPx: objectTableMinWidthPx,
                    selectionColumnWidthPx: SELECTION_COLUMN_WIDTH_PX,
                    nameColumnWidthPx,
                    actionsColumnWidthPx,
                    columns: visibleColumnDefinitions,
                    columnWidthsPx: visibleColumnWidthsPx,
                    headerPaddingClasses: headerPadding,
                    allSelected,
                    selectionDisabled: selectableListItems.length === 0,
                    nameHeader: renderNameHeaderContent(),
                    sortKey,
                    sortDirection,
                    activeResizeColumnId:
                      activeColumnResize?.columnId ?? null,
                    onToggleAll: toggleAllSelection,
                    onSort: handleSortToggle,
                    onStartResize: startColumnResize,
                    onResetColumnWidth: resetColumnWidth,
                    onHeaderContextMenu: handleHeaderContextMenu,
                  },
                  row: {
                    compactMode,
                    rowHeightClasses,
                    rowCellClasses,
                    iconBoxClasses,
                    nameGapClasses,
                    primaryItemButtonHeightClasses,
                    rowActionButtonClasses,
                  },
                }}
                loadMoreButtonClasses={chromeToolbarButtonClasses}
                resolveItemActions={resolveItemActionStates}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onPathContextMenu={handlePathContextMenu}
                onListBackgroundClick={handleListBackgroundClick}
                onListKeyDown={handleListKeyDown}
                onGoUp={handleGoUp}
                onSelectItem={(event, item) =>
                  handleItemSelectionClick(event, item.id)
                }
                onItemDoubleClick={handleItemDoubleClick}
                onItemContextMenu={handleItemContextMenu}
                onToggleSelection={(item) => toggleSelection(item.id)}
                onItemNameClick={handleItemNameClick}
                onRunItemAction={runItemAction}
                onOpenActions={handleItemActionsButtonClick}
                onLoadMore={handleLoadMoreObjectResults}
              />
            </div>

            {isInspectorPanelVisible && (
              <BrowserInspectorPanel
                activeTab={inspectorTab}
                workspaceNoun={workspaceNoun}
                workspaceNounCapitalized={workspaceNounCapitalized}
                usePortalWorkspaceLabels={usePortalWorkspaceLabels}
                actionButtonClasses={chromeBulkActionClasses}
                context={{
                  currentPath,
                  pathStats,
                  versioningEnabled: isVersioningEnabled,
                  showDeletedObjects,
                  counts: contextCounts,
                  countsLoading: contextCountsLoading,
                  countsError: contextCountsError,
                  canCount: Boolean(bucketName && hasS3AccountContext),
                  onCount: () => void handleContextCount(),
                }}
                bucket={{
                  name: bucketName,
                  hasContext: hasS3AccountContext,
                  loading: bucketInspectorLoading,
                  error: bucketInspectorError,
                  data: bucketInspectorData,
                  features: bucketInspectorFeatures,
                  isCephContext,
                  cephQuotaScopeLabel,
                  cephContextQuotaSizeBytes,
                  cephContextQuotaObjects,
                }}
                selection={{
                  hasActions: canSelectionActions,
                  selectedCount,
                  isSingle: selectionIsSingle,
                  primary: selectionPrimary,
                  fileCount: selectionFiles.length,
                  folderCount: selectionFolders.length,
                  hasDeleted: selectionHasDeleted,
                  selectedBytes,
                  onOpenFullDetails: () => runSelectionAction("details"),
                }}
                details={{
                  item: inspectedItem,
                  path: inspectedPath,
                  versioningEnabled: isVersioningEnabled,
                  versions: {
                    versions: objectVersionRows,
                    loading: objectVersionsLoading,
                    error: objectVersionsError,
                    canLoadMore: Boolean(
                      inspectedItem && canLoadMoreObjectVersions,
                    ),
                    onLoadMore: inspectedItem
                      ? () =>
                          void loadObjectVersions({ append: true })
                      : undefined,
                    onRestoreVersion: handleRestoreVersion,
                    onDeleteVersion: handleDeleteVersion,
                  },
                  onOpenFullDetails: runInspectedFullDetailsAction,
                }}
                onSelectTab={setInspectorTab}
                onOpenBucketTab={handleOpenBucketInspector}
              />
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
        <BrowserMobileSelectionActions
          actions={toolbarMoreSelectionFullActions}
          canDownload={toolbarCanDownload}
          canOpen={toolbarCanOpen}
          onDownload={handleToolbarDownload}
          onOpen={handleToolbarOpen}
          onRunAction={runSelectionAction}
          summary={toolbarSelectionSummary}
        />
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
          confirmationDialog={createBucketConfirmationDialog}
          onNameChange={updateCreateBucketName}
          onVersioningChange={setCreateBucketVersioning}
          onSubmit={() => void submitCreateBucket()}
          onClose={requestCreateBucketClose}
        />
      )}
      {showSseCustomerModal && (
        <BrowserSseCustomerKeyModal
          value={sseCustomerKeyInput}
          visible={sseCustomerKeyVisible}
          error={sseCustomerKeyError}
          notice={sseCustomerKeyNotice}
          active={sseActive}
          canGenerate={canGenerateSseCustomerKey}
          confirmationDialog={sseCustomerConfirmationDialog}
          onValueChange={updateSseCustomerKeyInput}
          onToggleVisibility={toggleSseCustomerKeyVisibility}
          onGenerate={() => void generateSseCustomerKey()}
          onClear={clearSseCustomerKey}
          onActivate={activateSseCustomerKey}
          onClose={requestSseCustomerModalClose}
        />
      )}
      {showMultipartUploadsModal && bucketName && hasS3AccountContext && (
        <BrowserMultipartUploadsModal
          bucketName={bucketName}
          uploads={multipartUploads}
          loading={multipartUploadsLoading}
          loadingMore={multipartUploadsLoadingMore}
          error={multipartUploadsError}
          canLoadMore={canLoadMoreMultipartUploads}
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
          onRefresh={() => loadPrefixVersions({ force: true })}
          onLoadMore={() => loadPrefixVersions({ append: true })}
          onRestoreVersion={handleRestoreVersion}
          onDeleteVersion={handleDeleteVersion}
        />
      )}
      {showBulkAttributesModal && (
        <BrowserBulkAttributesModal
          draft={bulkAttributesDraft}
          error={bulkAttributesError}
          fileCount={bulkAttributesFileCount}
          folderCount={bulkAttributesFolderCount}
          loading={bulkAttributesLoading}
          onApply={handleBulkAttributesApply}
          onClose={closeBulkAttributesModal}
          setDraft={setBulkAttributesDraft}
          summary={bulkAttributesSummary}
        />
      )}
      {showBulkRestoreModal && (
        <BrowserBulkRestoreModal
          draft={bulkRestoreDraft}
          error={bulkRestoreError}
          fileCount={bulkRestoreFileCount}
          folderCount={bulkRestoreFolderCount}
          loading={bulkRestoreLoading}
          onApply={handleBulkRestoreApply}
          onClose={closeBulkRestoreModal}
          preview={bulkRestorePreview}
          setDraft={setBulkRestoreDraft}
          summary={bulkRestoreSummary}
          targetPath={bulkRestoreTargetPath}
        />
      )}
      {showCleanupModal && (
        <BrowserCleanupModal
          currentPath={currentPath}
          draft={cleanupDraft}
          error={cleanupError}
          loading={cleanupLoading}
          onApply={handleCleanupApply}
          onClose={closeCleanupModal}
          setDraft={setCleanupDraft}
          summary={cleanupSummary}
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
          confirmationDialog={newFolderConfirmationDialog}
          onNameChange={setNewFolderName}
          onSubmit={() => void submitNewFolder()}
          onClose={requestNewFolderClose}
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
          activeOperationsCount={activeOperationsCount}
          queuedOperationsCount={queuedOperationsCount}
          completedOperationsCount={completedOperationsCount}
          failedOperationsCount={failedOperationsCount}
          downloadGroups={downloadGroups}
          deleteGroups={deleteGroups}
          copyGroups={copyGroups}
          uploadGroups={uploadGroups}
          otherOperations={allOtherOperations}
          operationSortIndexById={operationSortIndexById}
          uploadGroupSortIndexById={uploadGroupSortIndexById}
          operationSortFallback={operationSortFallback}
          cancelOperation={cancelOperation}
          cancelUploadGroup={cancelUploadGroup}
          hasFinishedOperations={hasFinishedOperations}
          canDismiss={!hasPendingOperations}
          onClearFinishedOperations={clearFinishedOperations}
          onDismiss={dismissOperationsPanel}
          onOpenDetails={openOperationsDetailsModal}
          onToggleOpen={toggleOperationsPanel}
        />
      )}
      {showOperationsDetailsModal && hasOperationsPanelContent && (
        <BrowserOperationsModal
          totalOperationsCount={operationsPanelTotalCount}
          activeOperationsCount={activeOperationsCount}
          queuedOperationsCount={queuedOperationsCount}
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
          cancelUploadOperation={cancelOperationController}
          removeQueuedUpload={removeQueuedUpload}
          onDownloadOperationDetails={downloadOperationDetails}
          hasFinishedOperations={hasFinishedOperations}
          onClearFinishedOperations={clearFinishedOperations}
          onClose={closeOperationsDetailsModal}
        />
      )}
    </div>
  );
}

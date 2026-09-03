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
import {
  CLIENT_STORAGE_KEYS,
  writeClientStorage,
} from "../../utils/clientStorage";
import { readStoredUser } from "../../utils/workspaces";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { BrowserRequestOptions } from "../../api/browser";
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
import { useBrowserConfirmDialog } from "./useBrowserConfirmDialog";
import { useBrowserContextMenu } from "./useBrowserContextMenu";
import { useBrowserContextCounts } from "./useBrowserContextCounts";
import { useBrowserCopyActions } from "./useBrowserCopyActions";
import { useBrowserCopyDialog } from "./useBrowserCopyDialog";
import { useBrowserCreateBucket } from "./useBrowserCreateBucket";
import { useBrowserCreateFolder } from "./useBrowserCreateFolder";
import { useBrowserDeleteItems } from "./useBrowserDeleteItems";
import { useBrowserDensity } from "./useBrowserDensity";
import { useBrowserDownloads } from "./useBrowserDownloads";
import { useBrowserFolderTree } from "./useBrowserFolderTree";
import { useBrowserLazyColumns } from "./useBrowserLazyColumns";
import { useBrowserKeyboardShortcuts } from "./useBrowserKeyboardShortcuts";
import { useBrowserListingRefresh } from "./useBrowserListingRefresh";
import { useBrowserListingVisibility } from "./useBrowserListingVisibility";
import { useBrowserMultipartUploads } from "./useBrowserMultipartUploads";
import { useBrowserNavigationHistory } from "./useBrowserNavigationHistory";
import { useBrowserNotices } from "./useBrowserNotices";
import { useBrowserObjectColumns } from "./useBrowserObjectColumns";
import { useBrowserObjectDetailsTarget } from "./useBrowserObjectDetailsTarget";
import { useBrowserObjectListing } from "./useBrowserObjectListing";
import { useBrowserObjectSort } from "./useBrowserObjectSort";
import { useBrowserOperationOverview } from "./useBrowserOperationOverview";
import { useBrowserOperationRegistry } from "./useBrowserOperationRegistry";
import { useBrowserPanelLayout } from "./useBrowserPanelLayout";
import { useBrowserPathEditor } from "./useBrowserPathEditor";
import { useBrowserPathHistory } from "./useBrowserPathHistory";
import { useBrowserPresignRequests } from "./useBrowserPresignRequests";
import { useBrowserPrefixVersions } from "./useBrowserPrefixVersions";
import { useBrowserQueuedUpload } from "./useBrowserQueuedUpload";
import { useBrowserRuntimeData } from "./useBrowserRuntimeData";
import { useBrowserRecursiveObjectListing } from "./useBrowserRecursiveObjectListing";
import { useBrowserSearch } from "./useBrowserSearch";
import { useBrowserSelection } from "./useBrowserSelection";
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
  readStoredBrowserRootUiState,
} from "./browserRootUiState";
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
  resolveBrowserCorsAvailability,
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
} from "./browserObjectTableModel";
import { isBrowserInteractiveTarget } from "./browserObjectItemPresentation";
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
    (isMainBrowserPath && resolvedFunctionalProfile === "advanced"
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
  const {
    settings: browserSettings,
    usageError: usageSummaryError,
    usageLoading: usageSummaryLoading,
    usageSummary,
  } = useBrowserRuntimeData({
    accountId: accountIdForApi,
    enabled: hasS3AccountContext,
    requestOptions: browserRequestOptions,
    showUsage: showWorkspaceSidebar,
  });
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
  const {
    activeLayoutMode,
    activePanelResize,
    canUseFoldersPanel,
    canUseInspectorPanel,
    changeLayoutMode,
    isFoldersPanelVisible,
    isInspectorPanelVisible,
    layoutContainerRef,
    layoutTemplateColumns,
    openInspectorPanel,
    resolvedFoldersWidth,
    resolvedInspectorWidth,
    resetFoldersPanelWidth,
    resetInspectorPanelWidth,
    showFolders,
    showInspector,
    startPanelResize,
    toggleFoldersPanel,
    toggleInspectorPanel,
  } = useBrowserPanelLayout({
    allowFoldersPanel:
      allowFoldersPanel && resolvedFunctionalProfile === "advanced",
    allowInspectorPanel:
      allowInspectorPanel && resolvedFunctionalProfile === "advanced",
    canChangeLayout:
      isMainBrowserPath && resolvedFunctionalProfile === "advanced",
    initialFoldersPanelWidthPx:
      initialRootUiLayout?.foldersPanelWidthPx ??
      DEFAULT_FOLDERS_PANEL_WIDTH_PX,
    initialInspectorPanelWidthPx:
      initialRootUiLayout?.inspectorPanelWidthPx ??
      DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
    initialLayoutMode,
    initialShowFolders: isMainBrowserPath
      ? (initialRootUiLayout?.showFolders ?? defaultShowFolders)
      : defaultShowFolders,
    initialShowInspector: isMainBrowserPath
      ? (initialRootUiLayout?.showInspector ?? defaultShowInspector)
      : defaultShowInspector,
    persistLayout: isMainBrowserPath,
  });
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
  const effectiveVisibleColumns = isPortalProfile
    ? DEFAULT_VISIBLE_COLUMN_IDS
    : visibleColumns;
  const visibleColumnSet = useMemo(
    () => new Set(effectiveVisibleColumns),
    [effectiveVisibleColumns],
  );
  const {
    backendSortBy,
    sortDirection,
    sortId,
    sortKey,
    toggleSort: handleSortToggle,
  } = useBrowserObjectSort({ visibleColumns: visibleColumnSet });
  const isMobileViewport = useMediaQuery(MOBILE_OBJECT_LIST_MEDIA_QUERY);
  const [inspectorTab, setInspectorTab] =
    useState<BrowserInspectorTab>("context");
  const {
    canConfigure: canConfigureRootBrowserDensity,
    compactMode,
    setCompactMode,
  } = useBrowserDensity({
    densityOverride,
    initialStoredDensity: initialStoredRootUiState?.density,
    isMainBrowserPath,
  });
  const canConfigureRootBrowserColumns =
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
  const {
    setStatusMessage,
    setWarningMessage,
    statusMessage,
    warningMessage,
  } = useBrowserNotices({
    scopeKey: JSON.stringify([accountIdForApi, bucketName, prefix]),
  });
  const {
    close: closeCopyDialog,
    dialog: copyDialog,
    notifyCopySuccess,
    open: openCopyDialog,
    openSseCustomerKey: openSseCustomerKeyCopyDialog,
  } = useBrowserCopyDialog({ onStatus: setStatusMessage });
  const {
    activeSearchStatusChips,
    changeSearchScope,
    clearSearchFilters,
    filter,
    hasActiveSearchFilters,
    hasAdvancedSearchOptionsActive,
    hasSearchQuery,
    isSearchingInWholeBucket,
    searchCaseSensitive,
    searchExactMatch,
    searchRecursive,
    searchScope,
    setFilter,
    setSearchCaseSensitive,
    setSearchExactMatch,
    setSearchRecursive,
    setShowSearchOptionsMenu,
    setStorageFilter,
    setTypeFilter,
    showSearchOptionsMenu,
    storageFilter,
    toggleSearchOptionsMenu,
    typeFilter,
  } = useBrowserSearch({
    isPortalProfile,
    scopeKey: JSON.stringify([bucketName, prefix]),
  });
  const {
    hideDeletedObjects,
    showDeletedObjects,
    showFolderItems,
    toggleDeletedObjects,
    toggleFolderItems,
  } = useBrowserListingVisibility({
    deletedObjectsOptions,
  });
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
  const {
    close: closeObjectDetails,
    open: openObjectDetailsTarget,
    target: objectDetailsTarget,
  } = useBrowserObjectDetailsTarget({
    scopeKey: JSON.stringify([accountIdForApi, bucketName, prefix]),
    versioningEnabled: isVersioningEnabled,
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
  const [configBucketName, setConfigBucketName] = useState<string | null>(null);
  const {
    close: closeConfirmDialog,
    dialog: confirmDialog,
    loading: confirmDialogLoading,
    open: openConfirmDialog,
    submit: submitConfirmDialog,
  } = useBrowserConfirmDialog();
  const { history: pathHistory, record: recordPathHistory } =
    useBrowserPathHistory({ bucketName });
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
    showPanelToggles &&
    isMainBrowserPath &&
    resolvedFunctionalProfile === "advanced";
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
  const proxyAllowed = browserSettings?.allow_proxy_transfers ?? false;
  const corsAvailability = resolveBrowserCorsAvailability(corsStatus);
  const corsEnabled =
    corsAvailability === "unknown" ? null : corsAvailability === "enabled";
  const useProxyTransfers = Boolean(
    bucketName &&
      hasS3AccountContext &&
      proxyAllowed &&
      corsAvailability === "disabled",
  );
  const transferParallelism = useMemo(
    () =>
      resolveBrowserTransferParallelism(browserSettings, useProxyTransfers),
    [browserSettings, useProxyTransfers],
  );
  const uploadParallelism = transferParallelism.upload;
  const downloadParallelism = transferParallelism.download;
  const otherOperationsParallelism = transferParallelism.otherOperations;
  const useStsPresigner = shouldUseStsPresigner({ stsAvailable, sseActive });
  const { presignObjectRequest, presignPartRequest } =
    useBrowserPresignRequests({
      accountId: accountIdForApi,
      ensureStsCredentials,
      requestOptions: browserRequestOptions,
      sseCustomerKeyBase64,
      useStsPresigner,
    });
  const { copyPath: handleCopyPath, copyUrl: handleCopyUrl } =
    useBrowserCopyActions({
      bucketName,
      enabled: hasS3AccountContext,
      onFallback: openCopyDialog,
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
        corsEnabled,
        proxyAllowed,
      }),
    [
      corsFixError,
      corsEnabled,
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
        corsEnabled,
        proxyAllowed,
        useProxyTransfers,
        sseActive,
        hasStsCredentials: Boolean(stsCredentials),
        stsExpirationLabel,
        directCredentialStsTooltip,
      }),
    [
      corsEnabled,
      hasS3AccountContext,
      directCredentialStsTooltip,
      proxyAllowed,
      sseActive,
      stsCredentials,
      stsExpirationLabel,
      useProxyTransfers,
    ],
  );
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
  }, [operations, setStatusMessage]);

  useEffect(() => {
    if (isVersioningEnabled) return;
    hideDeletedObjects();
  }, [bucketName, hideDeletedObjects, isVersioningEnabled]);

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
  const {
    activateItem,
    allSelected,
    clearActiveItem,
    handleItemSelectionClick,
    handleListBackgroundClick,
    handleListKeyDown: handleSelectionKeyDown,
    inspectedItem,
    prepareItemActionsMenu,
    prepareItemContextMenu,
    removeItemsFromSelection,
    selectAllItems,
    selectableListItems,
    selectedBytes,
    selectedCount,
    selectedIds,
    selectedItems,
    selectedSet,
    selectItemDetails,
    toggleAllSelection,
    toggleSelection,
  } = useBrowserSelection({
    inspectorTab,
    inspectorVisible: isInspectorPanelVisible,
    items,
    listItems,
    scopeKey: JSON.stringify([accountIdForApi, bucketName, prefix]),
    setInspectorTab,
  });

  useLayoutEffect(() => {
    if (!accountSwitchInFlight) return;
    clearActiveItem();
  }, [accountSwitchInFlight, clearActiveItem]);

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
      if (selectBucket(value)) clearActiveItem();
    },
    [clearActiveItem, selectBucket],
  );
  const workspaceAccountActionTarget = useMemo<"manager" | "portal" | null>(() => {
    if (
      selectedContext?.manager_role === "account_administrator" ||
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
  const handleVersionsHardLimit = useCallback(() => {
    setWarningMessage(
      `Versions listing is limited to ${VERSIONS_LIST_HARD_LIMIT.toLocaleString()} entries. Narrow your path to continue.`,
    );
  }, [setWarningMessage]);
  const {
    canLoadMore: canLoadMorePrefixVersions,
    close: closePrefixVersions,
    error: prefixVersionsError,
    loadMore: loadMorePrefixVersions,
    loading: prefixVersionsLoading,
    open: openPrefixVersions,
    refresh: refreshPrefixVersions,
    refreshIfVisible: refreshPrefixVersionsIfVisible,
    rows: prefixVersionRows,
    visible: showPrefixVersions,
  } = useBrowserPrefixVersions({
    accountId: accountIdForApi,
    bucketName,
    contextEnabled: hasS3AccountContext,
    onHardLimit: handleVersionsHardLimit,
    prefix: normalizedPrefix,
    requestOptions: browserRequestOptions,
    versioningEnabled: isVersioningEnabled,
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

  const {
    refreshAfterUpload: refreshUploadedListing,
    refreshNow: refreshObjectsNow,
    reload: reloadObjects,
    requestRefresh: requestObjectsRefresh,
  } = useBrowserListingRefresh({
    bucketName,
    contextKey: bucketAccessContextKey,
    enabled: hasS3AccountContext,
    loadObjects,
    loadTreeChildren,
    prefix,
    refreshToken,
  });

  const listAllObjectsForPrefix = useBrowserRecursiveObjectListing({
    accountId: accountIdForApi,
    bucketName,
    enabled: hasS3AccountContext,
    requestOptions: browserRequestOptions,
  });

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
    activateItem(item);
    openObjectDetailsTarget(item, initialTab);
  };

  const openItemPrimaryAction = (item: BrowserItem) => {
    const primaryAction = resolveItemPrimaryAction(item, {
      versioningEnabled: isVersioningEnabled,
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
    selectItemDetails(item);
    openInspectorPanel();
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
      clearActiveItem();
      recordPathHistory(nextPrefix);
    },
    [clearActiveItem, recordPathHistory, setPrefix],
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
      clearActiveItem();
      cancelPathEdit();
    },
  });

  useEffect(() => {
    accountIdForApiRef.current = accountIdForApi;
  }, [accountIdForApi]);

  useEffect(() => {
    if (
      storageFilter !== "all" &&
      !searchableStorageClasses.includes(storageFilter)
    ) {
      setStorageFilter("all");
    }
  }, [searchableStorageClasses, setStorageFilter, storageFilter]);

  const handleOpenBucketInspector = useCallback(() => {
    setInspectorTab("bucket");
    void loadBucketInspectorData();
  }, [loadBucketInspectorData]);

  const handleItemNameClick = (
    event: ReactMouseEvent<HTMLElement>,
    item: BrowserItem,
  ) => {
    if (event.detail > 1) return;
    openItemPrimaryAction(item);
  };

  const handleItemContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    item: BrowserItem,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const menuSelection = prepareItemContextMenu(item);
    openContextMenu(
      menuSelection,
      { x: event.clientX, y: event.clientY },
    );
  };

  const handleItemActionsButtonClick = (
    event: ReactMouseEvent<HTMLButtonElement>,
    item: BrowserItem,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    prepareItemActionsMenu(item);
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
    handleSelectionKeyDown(event, openItemPrimaryAction);
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

  const handleRefresh = () => {
    if (!hasS3AccountContext) return;
    if (!bucketName) {
      void refreshBucketList();
      return;
    }
    loadObjects({ prefixOverride: prefix, forceRefresh: true });
    void refreshPrefixVersionsIfVisible();
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
    onProcessed: removeItemsFromSelection,
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

  const keyboardShortcutsBlocked =
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
  useBrowserKeyboardShortcuts({
    blocked: keyboardShortcutsBlocked,
    canCopyAndCut:
      resolvedFunctionalProfile !== "portal" &&
      resolvedCapabilityFacts.canWriteObjects,
    canPaste: canPasteInFunctionalProfile,
    enabled: hasS3AccountContext && Boolean(bucketName),
    hasSelectableItems: selectableListItems.length > 0,
    onCopy: handleCopyItems,
    onCut: handleCutItems,
    onEditPath: startEditingPath,
    onPaste: handlePasteItems,
    onSelectAll: selectAllItems,
    selectedItems,
  });

  const refreshObjectListing = async (_targetKey: string) => {
    await loadObjects({ prefixOverride: prefix, forceRefresh: true });
    await refreshPrefixVersionsIfVisible();
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
      versions: openPrefixVersions,
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
      toggleShowFolders: toggleFolderItems,
      toggleShowDeleted: toggleDeletedObjects,
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
    Boolean(accessBadge) || hasToolbarOperationsAction;
  const hasToolbarColumnsSection = !isPortalProfile;
  const toolbarColumnsSummary = `${effectiveVisibleColumns.length}/${COLUMN_DEFINITIONS.length} visible`;
  const handleToolbarDownload = () => {
    runSelectionAction("download");
  };
  const handleToolbarOpen = () => {
    runSelectionAction("open");
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
      onToggleOptions={toggleSearchOptionsMenu}
      onScopeChange={changeSearchScope}
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
              canUploadFiles: toolbarCanUploadFiles,
              canUploadFolder: toolbarCanUploadFolder,
              canCreateFolder: toolbarCanCreateFolder,
              canRefresh: pathActionStates.refresh.enabled,
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
            menuResetKey={JSON.stringify([
              bucketName,
              prefix,
              Array.from(selectedIds),
            ])}
            moreMenu={{
              view: canConfigureRootBrowserDensity
                ? {
                    compactMode,
                    onSetCompactMode: setCompactMode,
                  }
                : undefined,
              status: {
                visible: hasToolbarStatusSection,
                accessBadge,
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
                    summary: toolbarColumnsSummary,
                    columns: COLUMN_DEFINITIONS,
                    visibleColumnIds: visibleColumnSet,
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
        onOpenPrefixVersions={openPrefixVersions}
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
        onToggleShowFolders={toggleFolderItems}
        onToggleShowDeleted={toggleDeletedObjects}
        canConfigureDensity={canConfigureRootBrowserDensity}
        canConfigureColumns={canConfigureRootBrowserColumns}
        compactMode={compactMode}
        onSetCompactMode={setCompactMode}
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
          onClose={closeObjectDetails}
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
          canLoadMore={canLoadMorePrefixVersions}
          onClose={closePrefixVersions}
          onRefresh={refreshPrefixVersions}
          onLoadMore={loadMorePrefixVersions}
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
          onCopySuccess={notifyCopySuccess}
          onClose={closeCopyDialog}
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

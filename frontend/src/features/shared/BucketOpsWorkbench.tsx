/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import {
  toolbarCompactButtonClasses,
} from "../../components/toolbarControlClasses";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import PaginationControls from "../../components/PaginationControls";
import {
  cx,
  type UiTone,
} from "../../components/ui/styles";
import {
  backupCephAdminBucketConfigs,
  CephAdminBucket,
  type CephAdminBucketConfigBackupFeature,
} from "../../api/cephAdmin";
import {
  STORAGE_OPS_SCOPE_ID,
  type StorageOpsBucket,
} from "../../api/storageOps";
import { RefreshIcon } from "../browser/browserIcons";
import CephAdminAdminOpsModal, {
  type CephAdminAdminOpsAction,
  type BucketAdminOpsKind,
} from "../cephAdmin/CephAdminAdminOpsModal";
import { useCephAdminEndpoint } from "../cephAdmin/CephAdminEndpointContext";
import CephAdminBucketCompareModal from "../cephAdmin/CephAdminBucketCompareModal";
import CephAdminBucketIndexCheckPage from "../cephAdmin/CephAdminBucketIndexCheckPage";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import BucketConfigBackupModal from "./BucketConfigBackupModal";
import type { BucketConfigBackupFeatureOption } from "./BucketConfigBackupModal";
import BucketOpsBulkUpdatePage from "./BucketOpsBulkUpdatePage";
import BucketOpsAdvancedFilterDrawer from "./BucketOpsAdvancedFilterDrawer";
import BucketOpsBulkConfigurationFields from "./BucketOpsBulkConfigurationFields";
import BucketOpsBulkExecutionPanel from "./BucketOpsBulkExecutionPanel";
import BucketOpsBulkTransferFields from "./BucketOpsBulkTransferFields";
import BucketOpsColumnControls from "./BucketOpsColumnControls";
import {
  BucketOpsQuickFilter,
  BucketOpsTagAndAdvancedFilters,
} from "./BucketOpsListFilters";
import BucketOpsTable from "./BucketOpsTable";
import {
  BucketOpsFeatureCell,
  BucketOpsNameCell,
  BucketOpsOwnerCell,
  BucketOpsS3TagsCell,
  BucketOpsSelectionCell,
  BucketOpsSelectionHeader,
  getBucketOpsS3TagsTooltipKey,
} from "./BucketOpsTableCells";
import BucketOpsRowActionsMenu from "./BucketOpsRowActionsMenu";
import BucketOpsRunModals from "./BucketOpsRunModals";
import BucketSelectionActionsBar from "./BucketSelectionActionsBar";
import BucketOpsUiTagsCell from "./BucketOpsUiTagsCell";
import ActionProgressCard from "./ActionProgressCard";
import { useBucketOpsListing } from "./useBucketOpsListing";
import { useBucketOpsRowTags } from "./useBucketOpsRowTags";
import { useBucketOpsTooltips } from "./useBucketOpsTooltips";
import { buildBucketOpsListingProjection } from "./bucketOpsListingProjection";
import { buildBucketOpsTableColumns } from "./bucketOpsTableColumns";
import {
  buildBucketOpsListOrigin,
  buildBucketOpsNavigationTarget,
  type BucketOpsNavigationAction,
} from "./bucketOpsTableNavigation";
import {
  buildBucketOpsBulkInput,
  prepareBucketOpsBulkInput,
  resolveBucketOpsBulkActionAvailability,
} from "./bucketOpsBulkInput";
import { prepareBucketOpsSelectionExport } from "./bucketOpsSelectionExport";
import { resolveBucketOpsApi } from "./bucketOpsApi";
import { resolveBucketOpsSurface, type BucketOpsMode } from "./bucketOpsSurface";
import { useBucketOpsBulkApply } from "./useBucketOpsBulkApply";
import { useBucketOpsBulkForm } from "./useBucketOpsBulkForm";
import { useBucketOpsBulkPreview } from "./useBucketOpsBulkPreview";
import { useBucketOpsCacheRefresh } from "./useBucketOpsCacheRefresh";
import { useBucketOpsConfigCopy } from "./useBucketOpsConfigCopy";
import { useBucketOpsFilterController } from "./useBucketOpsFilterController";
import { useBucketOpsListState } from "./useBucketOpsListState";
import { useBucketOpsSelection } from "./useBucketOpsSelection";
import { useBucketOpsSelectionActions } from "./useBucketOpsSelectionActions";
import { useBucketOpsStorageScopeFilters } from "./useBucketOpsStorageScopeFilters";
import {
  createBucketUiTagTarget,
  useBucketUiTags,
  type BucketUiTagTarget as BucketTagTarget,
} from "./bucketUiTags";
import {
  buildBucketDetailLocationState,
  loadBucketListReturnContext,
  saveBucketListReturnContext,
} from "./bucketListReturnContext";
import {
  buildBucketOpsActiveFilterSummaryItems,
  buildBucketOpsDraftFilterSummaryItems,
} from "./bucketOpsFilterSummary";
import {
  renderAdvancedSearchProgress,
} from "../cephAdmin/filtering/advancedFilterShared";
import { FEATURE_STATE_OPTIONS, type FeatureKey } from "./bucketOpsAdvancedFilterModel";
import { type ColumnId, type SortField } from "./bucketOpsListState";
import { extractApiError } from "../../utils/apiError";
import { triggerDownload } from "../../utils/download";
import {
  BUCKET_CONFIG_BACKUP_FEATURE_LABELS,
} from "./bucketBulkOperationsModel";
import {
  buildBulkPreviewExportPayload,
} from "./bucketBulkPreviewModel";
import {
  buildBulkPastePlan,
  isBulkClipboardSameEndpoint,
  reconcileBulkPasteMapping,
} from "./bucketBulkPasteModel";
import {
  buildBucketUiTagKey,
  getStorageOpsBucketName,
  isStatsSortField,
  ownerFilterFromSearch,
  sanitizeExportFilenamePart,
} from "./bucketOpsPresentation";

const extractError = (err: unknown): string => {
  return extractApiError(err, "Unexpected error");
};

type BucketOpsWorkbenchProps = {
  mode: BucketOpsMode;
  shell: {
    pageDescription: ReactNode;
    emptyState?: {
      title: string;
      description: ReactNode;
      primaryAction?: {
        label: string;
        to?: string;
        onClick?: () => void;
        variant?: "primary" | "secondary" | "ghost";
      };
      secondaryAction?: {
        label: string;
        to?: string;
        onClick?: () => void;
        variant?: "primary" | "secondary" | "ghost";
      };
      tone?: UiTone;
    };
  };
};

export default function BucketOpsWorkbench({ mode, shell }: BucketOpsWorkbenchProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { generalSettings } = useGeneralSettings();
  const {
    selectedEndpointId: cephSelectedEndpointId,
    selectedEndpoint: cephSelectedEndpoint,
    selectedEndpointAccess,
    endpoints,
  } = useCephAdminEndpoint();
  const surface = useMemo(() => resolveBucketOpsSurface(mode), [mode]);
  const isStorageOps = surface.mode === "storage-ops";
  const selectedEndpointId = isStorageOps ? STORAGE_OPS_SCOPE_ID : cephSelectedEndpointId;
  const selectedEndpoint = useMemo(
    () =>
      isStorageOps
        ? {
            id: STORAGE_OPS_SCOPE_ID,
            name: "All contexts",
            capabilities: {
              metrics: true,
              static_website: true,
              sns: true,
              sse: true,
            },
          }
        : cephSelectedEndpoint,
    [isStorageOps, cephSelectedEndpoint]
  );
  const cephAdminBrowserEnabled = !isStorageOps && generalSettings.browser_enabled && generalSettings.browser_ceph_admin_enabled;
  const [cephBucketStatsAvailable, setCephBucketStatsAvailable] = useState<boolean | null>(null);
  const [cephBucketStatsEndpointId, setCephBucketStatsEndpointId] = useState<number | null>(null);
  const usageFeatureEnabled =
    isStorageOps ||
    cephBucketStatsEndpointId !== selectedEndpointId ||
    cephBucketStatsAvailable !== false;
  const staticWebsiteFeatureEnabled = isStorageOps ? true : selectedEndpoint?.capabilities?.static_website === true;
  const snsFeatureEnabled = isStorageOps ? true : selectedEndpoint?.capabilities?.sns === true;
  const sseFeatureEnabled = isStorageOps ? true : selectedEndpoint?.capabilities?.sse !== false;
  const quotaOperationDisabledReason = !usageFeatureEnabled ? "bucket stats unavailable" : null;

  const {
    listBuckets,
    streamBuckets,
    refreshBucketListingCache,
    getBucketProperties,
    getBucketPublicAccessBlock,
    updateBucketPublicAccessBlock,
    getBucketLifecycle,
    putBucketLifecycle,
    deleteBucketLifecycle,
    getBucketCors,
    putBucketCors,
    deleteBucketCors,
    getBucketPolicy,
    putBucketPolicy,
    deleteBucketPolicy,
    getBucketLogging,
    putBucketLogging,
    deleteBucketLogging,
    getBucketNotifications,
    putBucketNotifications,
    deleteBucketNotifications,
    getBucketWebsite,
    getBucketEncryption,
    setBucketVersioning,
    updateBucketObjectLock,
    updateBucketQuota,
  } = resolveBucketOpsApi(surface.mode);

  const columnsStorageKey = surface.storageKeys.columns;
  const bucketsStateStorageKey = surface.storageKeys.bucketListState;
  const bulkClipboardStorageKey = surface.storageKeys.bulkConfigClipboard;
  const ownerQueryFilter = useMemo(() => ownerFilterFromSearch(location.search), [location.search]);
  const defaultVisibleColumns = useMemo(() => [...surface.defaultVisibleColumns] as ColumnId[], [surface]);
  const useExplicitBucketName = surface.useExplicitBucketName;
  const scopeDisplayName = surface.scopeDisplayName;
  const exportPrefix = surface.exportPrefix;
  const exportScopeKey = surface.exportScopeKey;
  const missingScopeError = surface.missingScopeError;
  const missingScopeHint = surface.missingScopeHint;

  const featureSupport = useMemo<Record<FeatureKey, boolean>>(
    () => ({
      versioning: true,
      object_lock: true,
      block_public_access: true,
      lifecycle_rules: true,
      static_website: staticWebsiteFeatureEnabled,
      bucket_policy: true,
      cors: true,
      access_logging: true,
      notifications: snsFeatureEnabled,
      server_side_encryption: sseFeatureEnabled,
    }),
    [snsFeatureEnabled, staticWebsiteFeatureEnabled, sseFeatureEnabled]
  );
  const featureStateOptions = useMemo(
    () => FEATURE_STATE_OPTIONS.map((option) => ({ ...option, supported: featureSupport[option.id] !== false })),
    [featureSupport]
  );
  const {
    advancedApplied,
    advancedDraft,
    filter,
    filterValue,
    page,
    pageSize,
    persistCurrentListState,
    quickFilterMode,
    setAdvancedApplied,
    setAdvancedDraft,
    setFilter,
    setFilterValue,
    setPage,
    setPageSize,
    setQuickFilterMode,
    setSort,
    setTagFilterMode,
    setTagFilters,
    setVisibleColumns,
    sort,
    tagFilterMode,
    tagFilters,
    visibleColumns,
  } = useBucketOpsListState({
    bucketsStateStorageKey,
    columnsStorageKey,
    defaultVisibleColumns,
    featureSupport,
    isStorageOps,
    ownerQueryFilter,
    selectedScopeId: selectedEndpointId,
    snsFeatureEnabled,
    sseFeatureEnabled,
    staticWebsiteFeatureEnabled,
  });
  const filterController = useBucketOpsFilterController({
    advancedApplied,
    advancedDraft,
    featureSupport,
    filter,
    filterValue,
    isStorageOps,
    quickFilterMode,
    setAdvancedApplied,
    setAdvancedDraft,
    setFilter,
    setFilterValue,
    setPage,
    setQuickFilterMode,
    setTagFilterMode,
    setTagFilters,
    usageFeatureEnabled,
  });
  const {
    advancedFilterParam,
    advancedFiltersApplied,
    effectiveQuickFilterMode,
    effectiveQuickSearchValue,
    quickFilterAppliedParsed,
    removeActiveFilterItem,
    resetAllFilters,
    showAdvancedFilter,
  } = filterController;
  const storageScopeFilterController = useBucketOpsStorageScopeFilters({
    advancedDraft,
    extractError,
    isStorageOps,
    setAdvancedDraft,
  });
  const { storageOpsContextLabelById } = storageScopeFilterController;
  const {
    definitions: availableUiTags,
    ready: uiTagsReady,
    error: uiTagsError,
    reload: reloadUiTags,
    applyTags: persistUiTagChanges,
    updateDefinition: persistUiTagDefinition,
    updatingDefinitionIds,
  } = useBucketUiTags(surface.mode, isStorageOps ? null : selectedEndpointId);
  const resolveBucketTagTarget = useCallback(
    (bucket: CephAdminBucket): BucketTagTarget | null => {
      if (isStorageOps) {
        const storageBucket = bucket as StorageOpsBucket;
        return createBucketUiTagTarget(
          surface.mode,
          storageBucket.endpoint_id,
          storageBucket.bucket_identity,
          getStorageOpsBucketName(bucket),
          bucket.tenant,
          storageBucket.context_id
        );
      }
      return createBucketUiTagTarget(
        surface.mode,
        selectedEndpointId,
        buildBucketUiTagKey(bucket.name, bucket.tenant),
        bucket.name,
        bucket.tenant
      );
    },
    [isStorageOps, selectedEndpointId, surface.mode]
  );
  useEffect(() => {
    if (!uiTagsReady) return;
    const visibleIds = new Set(availableUiTags.map((tag) => tag.id));
    setTagFilters((current) => {
      const next = current.filter((tagId) => visibleIds.has(tagId));
      return next.length === current.length ? current : next;
    });
  }, [availableUiTags, setTagFilters, uiTagsReady]);
  const [adminOpsAction, setAdminOpsAction] = useState<Extract<CephAdminAdminOpsAction, { bucket: CephAdminBucket }> | null>(null);
  const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showIntegrityModal, setShowIntegrityModal] = useState(false);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [showUsageStatsModal, setShowUsageStatsModal] = useState(false);
  const [showConfigBackupModal, setShowConfigBackupModal] = useState(false);
  const bulkFormController = useBucketOpsBulkForm();
  const {
    bulkCopyFeatures,
    bulkCorsUpdateOnlyExisting,
    bulkLifecycleUpdateOnlyExisting,
    bulkOperation,
    bulkPasteMapping,
    bulkPolicyUpdateOnlyExisting,
    bulkQuotaSkipConfigured,
    formState: bulkFormState,
    resetBulkForm,
    setBulkOperation,
    setBulkPasteMapping,
  } = bulkFormController;
  const {
    activeFeatureTooltipKey,
    activeOwnerTooltipKey,
    featureTooltipCacheKey,
    featureTooltipState,
    loadFeatureTooltip,
    loadOwnerTooltip,
    ownerTooltipCacheKey,
    ownerTooltipState,
    resetBucketTooltipState,
    setActiveFeatureTooltipKey,
    setActiveOwnerTooltipKey,
  } = useBucketOpsTooltips({
    extractError,
    getBucketEncryption,
    getBucketLogging,
    getBucketNotifications,
    getBucketPolicy,
    getBucketProperties,
    getBucketWebsite,
    listBuckets,
    missingScopeError,
    selectedScopeId: selectedEndpointId,
  });
  const [activeTagsTooltipKey, setActiveTagsTooltipKey] = useState<string | null>(null);
  const clearTagsTooltip = useCallback(() => setActiveTagsTooltipKey(null), []);
  const restoredReturnContextRef = useRef<number | null>(null);
  useEffect(() => {
    clearTagsTooltip();
  }, [bucketsStateStorageKey, clearTagsTooltip, ownerQueryFilter, selectedEndpointId]);

  const featureColumnOptions = useMemo(
    () => featureStateOptions.filter((option) => option.supported).map((option) => ({ ...option, key: option.id })),
    [featureStateOptions]
  );
  const {
    baseRequiresStats,
    detailLoadingColumnIds,
    exportWithStats,
    includeParams,
    requiresStats,
  } = useMemo(
    () =>
      buildBucketOpsListingProjection({
        advancedApplied,
        featureColumnIds: featureColumnOptions.map(({ id }) => id),
        isStorageOps,
        sortField: sort.field,
        usageFeatureEnabled,
        visibleColumns,
      }),
    [
      advancedApplied,
      featureColumnOptions,
      isStorageOps,
      sort.field,
      usageFeatureEnabled,
      visibleColumns,
    ],
  );

  const {
    items,
    total,
    loading,
    loadingDetails,
    advancedProgress,
    error,
    statsAvailable,
    statsWarning,
    setError,
    refresh: refreshBuckets,
  } = useBucketOpsListing({
    selectedScopeId: selectedEndpointId,
    page,
    pageSize,
    filterValue: effectiveQuickSearchValue,
    advancedFilterParam,
    advancedSearchEnabled: Boolean(advancedFilterParam),
    sort,
    includeParams,
    requiresStats,
    baseRequiresStats,
    uiTagIds: tagFilters,
    uiTagMatch: tagFilterMode,
    extractError,
    listBuckets,
    streamBuckets,
  });
  const {
    fullyResolvedFilteredSelection,
    headerChecked,
    hiddenSelectedCount,
    invalidateSelectionCache,
    resetSelectedBuckets,
    selectAllLoading,
    selectAllProgress,
    selectedBucketList,
    selectedBuckets,
    selectedCount,
    selectedOperationTargets,
    selectedUiTagSuggestions,
    selectionHeaderRef,
    setSelectionForFilteredResults,
    toggleSelection,
  } = useBucketOpsSelection({
    advancedFilterParam,
    extractError,
    filterValue: effectiveQuickSearchValue,
    isStorageOps,
    items,
    listBuckets,
    quickFilterMode: effectiveQuickFilterMode,
    scopeId: selectedEndpointId,
    setError,
    sort,
    tagFilters,
    tagFilterMode,
    total,
    withStats: baseRequiresStats,
  });
  const {
    cacheRefreshLoading,
    clearBucketListingUiCaches,
    refreshBucketListing,
  } = useBucketOpsCacheRefresh({
    clearTagTooltip: clearTagsTooltip,
    extractError,
    invalidateSelectionCache,
    refreshBucketListingCache,
    refreshBuckets,
    reloadUiTags,
    resetBucketTooltipState,
    scopeId: selectedEndpointId,
    setError,
  });
  const {
    bulkConfigClipboard,
    bulkCopyError,
    bulkCopyLoading,
    bulkCopyProgress,
    bulkCopySummary,
    cancelBulkCopy,
    copyBulkConfigs,
    fetchBucketQuota,
    resetBulkCopy,
  } = useBucketOpsConfigCopy({
    bucketNames: selectedBucketList,
    extractError,
    features: bulkCopyFeatures,
    getBucketCors,
    getBucketLifecycle,
    getBucketLogging,
    getBucketPolicy,
    getBucketProperties,
    getBucketPublicAccessBlock,
    isStorageOps,
    listBuckets,
    sourceEndpointId: selectedEndpointId,
    sourceEndpointName: selectedEndpoint?.name ?? null,
    storageKey: bulkClipboardStorageKey,
    usageFeatureEnabled,
  });

  useEffect(() => {
    resetSelectedBuckets();
  }, [
    bucketsStateStorageKey,
    ownerQueryFilter,
    resetSelectedBuckets,
    selectedEndpointId,
  ]);

  const rowTagsController = useBucketOpsRowTags({
    availableUiTags,
    extractError,
    persistUiTagChanges,
    persistUiTagDefinition,
    refreshBuckets,
    scopeKey: `${surface.mode}:${selectedEndpointId ?? ""}`,
    setError,
  });

  useEffect(() => {
    if (loading || items.length === 0 || !selectedEndpointId) return;
    const scopeKey = isStorageOps ? "storage-ops" : String(selectedEndpointId);
    const returnContext = loadBucketListReturnContext(surface.mode, scopeKey);
    if (!returnContext || returnContext.listUrl !== `${location.pathname}${location.search}`) return;
    if (restoredReturnContextRef.current === returnContext.savedAt) return;
    restoredReturnContextRef.current = returnContext.savedAt;

    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: returnContext.scrollY, behavior: "auto" });
      const rowButton = Array.from(document.querySelectorAll<HTMLElement>("[data-bucket-row-key]")).find(
        (element) => element.dataset.bucketRowKey === returnContext.rowKey
      );
      if (!rowButton) return;
      rowButton.focus({ preventScroll: true });
      const bounds = rowButton.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
        rowButton.scrollIntoView({ block: "center", behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isStorageOps, items, loading, location.pathname, location.search, selectedEndpointId, surface.mode]);

  const usageUnavailableBadge = statsWarning ? "Bucket stats unavailable" : "Storage metrics unavailable";
  const usageUnavailableDescription = statsWarning
    ? statsWarning
    : "Storage metrics are unavailable for this listing, so range filters and quota actions are disabled.";
  const configBackupFeatureOptions = useMemo<BucketConfigBackupFeatureOption[]>(
    () =>
      (Object.keys(BUCKET_CONFIG_BACKUP_FEATURE_LABELS) as CephAdminBucketConfigBackupFeature[]).map((feature) => {
        if (feature === "quota" && !usageFeatureEnabled) {
          return {
            key: feature,
            label: BUCKET_CONFIG_BACKUP_FEATURE_LABELS[feature],
            available: false,
            unavailableReason: usageUnavailableBadge,
          };
        }
        return {
          key: feature,
          label: BUCKET_CONFIG_BACKUP_FEATURE_LABELS[feature],
          available: true,
        };
      }),
    [usageFeatureEnabled, usageUnavailableBadge]
  );

  useEffect(() => {
    if (isStorageOps) {
      setCephBucketStatsAvailable(true);
      setCephBucketStatsEndpointId(STORAGE_OPS_SCOPE_ID);
      return;
    }
    setCephBucketStatsAvailable(null);
    setCephBucketStatsEndpointId(null);
  }, [isStorageOps, selectedEndpointId]);

  useEffect(() => {
    if (isStorageOps || statsAvailable === null) return;
    setCephBucketStatsAvailable(statsAvailable);
    setCephBucketStatsEndpointId(selectedEndpointId ?? null);
  }, [isStorageOps, selectedEndpointId, statsAvailable]);

  const toggleSort = (field: SortField) => {
    if (!usageFeatureEnabled && isStatsSortField(field)) return;
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "asc" };
    });
    setPage(1);
  };

  useEffect(() => {
    if (usageFeatureEnabled || !isStatsSortField(sort.field)) return;
    setSort({ field: "name", direction: "asc" });
    setPage(1);
  }, [setPage, setSort, sort.field, usageFeatureEnabled]);

  const toggleColumn = (id: ColumnId) => {
    setVisibleColumns((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const resetColumns = () => {
    setVisibleColumns(defaultVisibleColumns);
  };

  const clearSelection = () => {
    resetSelectedBuckets();
    resetBulkForm();
    resetBulkCopy();
    resetBulkPreview();
    resetBulkApply();
    resetSelectionActions();
    setShowConfigBackupModal(false);
  };

  const {
    applyUiTagToSelection,
    closeSelectedBucketIndexChecks,
    exportSelectedBuckets,
    indexCheckTargets,
    openSelectedBucketIndexChecks,
    parsedSelectionTagAddInput,
    resetSelectionActions,
    selectionActionProgress,
    selectionExportLoading,
    selectionTagActionLoading,
    selectionTagAddInput,
    setSelectionTagAddInput,
  } = useBucketOpsSelectionActions({
    bucketNames: selectedBucketList,
    extractError,
    isStorageOps,
    listBuckets,
    persistUiTagChanges,
    prepareExport: (format, onProgress) =>
      prepareBucketOpsSelectionExport({
        bucketNames: selectedBucketList,
        exportPrefix,
        exportScopeKey,
        exportWithStats,
        featureColumns: featureColumnOptions,
        filteredQuery: {
          filter: effectiveQuickSearchValue.trim() || undefined,
          advanced_filter: advancedFilterParam,
          sort_by: sort.field,
          sort_dir: sort.direction,
          ui_tag_ids: tagFilters.length > 0 ? tagFilters : undefined,
          ui_tag_match: tagFilterMode,
        },
        format,
        fullyResolvedFilteredSelection,
        include: includeParams,
        isStorageOps,
        listBuckets,
        onProgress,
        scopeDisplayName,
        scopeId: selectedEndpointId,
        scopeName: selectedEndpoint?.name ?? null,
        total,
        useExplicitBucketName,
        visibleBuckets: items,
        visibleColumns,
      }),
    refreshBuckets,
    resolveTarget: resolveBucketTagTarget,
    scopeId: selectedEndpointId,
    scopeKey: `${surface.mode}:${selectedEndpointId ?? ""}`,
    setError,
  });

  const bulkClipboardSameEndpoint = isBulkClipboardSameEndpoint(
    bulkConfigClipboard,
    selectedEndpointId
  );
  const bulkPastePlan = useMemo(
    () =>
      buildBulkPastePlan({
        clipboard: bulkConfigClipboard,
        destinationBucketNames: selectedBucketList,
        mapping: bulkPasteMapping,
        missingScopeHint,
        selectedEndpointId,
      }),
    [
      bulkConfigClipboard,
      bulkPasteMapping,
      missingScopeHint,
      selectedBucketList,
      selectedEndpointId,
    ]
  );
  const preparedBulkInput = useMemo(
    () => prepareBucketOpsBulkInput(buildBucketOpsBulkInput(bulkFormState)),
    [bulkFormState],
  );
  const {
    applyBulkUpdate,
    bulkApplyError,
    bulkApplyLoading,
    bulkApplyProgress,
    bulkApplySummary,
    resetBulkApply,
  } = useBucketOpsBulkApply({
    bucketNames: selectedBucketList,
    clipboard: bulkConfigClipboard,
    corsUpdateOnlyExisting: bulkCorsUpdateOnlyExisting,
    deleteBucketCors,
    deleteBucketLifecycle,
    deleteBucketLogging,
    deleteBucketNotifications,
    deleteBucketPolicy,
    endpointId: selectedEndpointId,
    extractError,
    fetchBucketQuota,
    getBucketCors,
    getBucketLifecycle,
    getBucketLogging,
    getBucketNotifications,
    getBucketPolicy,
    getBucketProperties,
    getBucketPublicAccessBlock,
    isStorageOps,
    lifecycleUpdateOnlyExisting: bulkLifecycleUpdateOnlyExisting,
    operation: bulkOperation,
    pastePlan: bulkPastePlan,
    policyUpdateOnlyExisting: bulkPolicyUpdateOnlyExisting,
    prepared: preparedBulkInput,
    putBucketCors,
    putBucketLifecycle,
    putBucketLogging,
    putBucketNotifications,
    putBucketPolicy,
    quotaDisabledReason: quotaOperationDisabledReason,
    quotaSkipConfigured: bulkQuotaSkipConfigured,
    refreshBuckets,
    setBucketVersioning,
    updateBucketObjectLock,
    updateBucketPublicAccessBlock,
    updateBucketQuota,
  });
  const {
    bulkPreview,
    bulkPreviewError,
    bulkPreviewLoading,
    bulkPreviewProgress,
    bulkPreviewReady,
    resetBulkPreview,
    runBulkPreview,
  } = useBucketOpsBulkPreview({
    bucketNames: selectedBucketList,
    clipboard: bulkConfigClipboard,
    corsUpdateOnlyExisting: bulkCorsUpdateOnlyExisting,
    endpointId: selectedEndpointId,
    extractError,
    fetchBucketQuota,
    getBucketCors,
    getBucketLifecycle,
    getBucketLogging,
    getBucketNotifications,
    getBucketPolicy,
    getBucketProperties,
    getBucketPublicAccessBlock,
    isStorageOps,
    lifecycleUpdateOnlyExisting: bulkLifecycleUpdateOnlyExisting,
    onPreviewStart: resetBulkApply,
    operation: bulkOperation,
    pastePlan: bulkPastePlan,
    policyUpdateOnlyExisting: bulkPolicyUpdateOnlyExisting,
    prepared: preparedBulkInput,
    quotaDisabledReason: quotaOperationDisabledReason,
    quotaSkipConfigured: bulkQuotaSkipConfigured,
  });

  useEffect(() => {
    if (!showBulkUpdateModal || bulkOperation !== "paste_configs" || !bulkConfigClipboard) return;
    const sourceBuckets = bulkConfigClipboard.buckets.map((bucket) => bucket.name);
    setBulkPasteMapping((previousMapping) =>
      reconcileBulkPasteMapping({
        destinationBucketNames: selectedBucketList,
        previousMapping,
        sameEndpoint: bulkClipboardSameEndpoint,
        sourceBucketNames: sourceBuckets,
      })
    );
  }, [
    bulkConfigClipboard,
    bulkClipboardSameEndpoint,
    bulkOperation,
    selectedBucketList,
    setBulkPasteMapping,
    showBulkUpdateModal,
  ]);

  const createConfigBackup = async (features: CephAdminBucketConfigBackupFeature[]) => {
    if (isStorageOps || !selectedEndpointId || selectedBucketList.length === 0) return;
    const generatedAt = new Date().toISOString();
    const timestamp = generatedAt.replace(/[:.]/g, "-");
    const endpointPart = sanitizeExportFilenamePart(
      selectedEndpoint?.name ?? (selectedEndpointId ? `endpoint-${selectedEndpointId}` : "endpoint")
    );
    const backup = await backupCephAdminBucketConfigs(selectedEndpointId, {
      buckets: selectedBucketList,
      features,
    });
    triggerDownload(
      `ceph-admin-bucket-config-backup-${endpointPart}-${timestamp}.json`,
      JSON.stringify(backup, null, 2),
      "application/json"
    );
  };

  useEffect(() => {
    if (!showBulkUpdateModal) return;
    resetBulkPreview();
    cancelBulkCopy();
    resetBulkApply();
  }, [
    bulkConfigClipboard,
    bulkFormState,
    cancelBulkCopy,
    resetBulkApply,
    resetBulkPreview,
    selectedBuckets,
    showBulkUpdateModal,
  ]);

  useEffect(() => {
    if ((quotaOperationDisabledReason || !usageFeatureEnabled) && bulkOperation === "set_quota") {
      setBulkOperation("");
    }
    if (!snsFeatureEnabled && (bulkOperation === "add_notifications" || bulkOperation === "delete_notifications")) {
      setBulkOperation("");
    }
  }, [
    bulkOperation,
    quotaOperationDisabledReason,
    setBulkOperation,
    snsFeatureEnabled,
    usageFeatureEnabled,
  ]);

  const openBulkUpdateModal = () => {
    setShowBulkUpdateModal(true);
    resetBulkForm();
    resetBulkCopy();
    resetBulkPreview();
    resetBulkApply();
  };

  const closeBulkUpdateModal = () => {
    setShowBulkUpdateModal(false);
    resetBulkPreview();
    resetBulkCopy();
    resetBulkApply();
  };

  const quickFilterActive = filterValue.trim().length > 0;
  const activeFilterSummaryItems = useMemo(
    () =>
      buildBucketOpsActiveFilterSummaryItems({
        quickFilterValue: filterValue,
        quickFilterMode: effectiveQuickFilterMode,
        tagFilters,
        tagFilterMode,
        tagLabelById: new Map(
          availableUiTags.map((tag) => [tag.id, tag.label])
        ),
        advanced: advancedApplied,
        isStorageOps,
        usageFeatureEnabled,
        featureSupport,
        contextLabelById: storageOpsContextLabelById,
      }),
    [
      filterValue,
      effectiveQuickFilterMode,
      tagFilters,
      tagFilterMode,
      availableUiTags,
      advancedApplied,
      isStorageOps,
      usageFeatureEnabled,
      featureSupport,
      storageOpsContextLabelById,
    ],
  );
  const showActiveFiltersCard =
    activeFilterSummaryItems.length > 0 &&
    !(
      activeFilterSummaryItems.length === 1 &&
      quickFilterActive &&
      !advancedFiltersApplied &&
      tagFilters.length === 0 &&
      !quickFilterAppliedParsed.listProvided
    );
  const advancedDraftSummaryItems = useMemo(
    () =>
      buildBucketOpsDraftFilterSummaryItems(advancedDraft, {
        isStorageOps,
        usageFeatureEnabled,
        featureSupport,
        contextLabelById: storageOpsContextLabelById,
      }),
    [
      advancedDraft,
      isStorageOps,
      usageFeatureEnabled,
      featureSupport,
      storageOpsContextLabelById,
    ],
  );
  const {
    applyDisabled: bulkApplyDisabled,
    hasSelectedCopyFeatures,
    previewDisabled: bulkPreviewDisabled,
  } = resolveBucketOpsBulkActionAvailability({
    applyLoading: bulkApplyLoading,
    formState: bulkFormState,
    pasteError: bulkPastePlan.error,
    previewLoading: bulkPreviewLoading,
    previewReady: bulkPreviewReady,
    quotaDisabledReason: quotaOperationDisabledReason,
  });
  const exportBulkPreviewChanges = () => {
    if (bulkPreview.length === 0) return;
    const exportedAt = new Date().toISOString();
    const timestamp = exportedAt.replace(/[:.]/g, "-");
    const endpointPart = sanitizeExportFilenamePart(
      selectedEndpoint?.name ??
        (selectedEndpointId ? `${scopeDisplayName.toLowerCase()}-${selectedEndpointId}` : scopeDisplayName.toLowerCase())
    );
    const operationPart = sanitizeExportFilenamePart(bulkOperation || "operation");

    const payload = buildBulkPreviewExportPayload({
      generatedAt: exportedAt,
      items: bulkPreview,
      operation: bulkOperation,
      scopeKey: exportScopeKey,
      scope: {
        id: selectedEndpointId ?? null,
        name: selectedEndpoint?.name ?? null,
      },
    });

    triggerDownload(
      `${exportPrefix}-bulk-preview-${endpointPart}-${operationPart}-${timestamp}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  };

  const renderTagList = (bucket: CephAdminBucket) => {
    const tooltipKey = getBucketOpsS3TagsTooltipKey(bucket);
    return (
      <BucketOpsS3TagsCell
        bucket={bucket}
        open={activeTagsTooltipKey === tooltipKey}
        onOpen={() => setActiveTagsTooltipKey(tooltipKey)}
        onClose={() => setActiveTagsTooltipKey((prev) => (prev === tooltipKey ? null : prev))}
      />
    );
  };

  const renderUiTags = (bucket: CephAdminBucket) => {
    const bucketTarget = resolveBucketTagTarget(bucket);
    return (
      <BucketOpsUiTagsCell
        assignedTags={bucket.ui_tags ?? []}
        controller={rowTagsController}
        isStorageOps={isStorageOps}
        target={bucketTarget}
        updatingDefinitionIds={updatingDefinitionIds}
      />
    );
  };

  const renderOwnerCell = (bucket: CephAdminBucket) => {
    const tooltipKey = ownerTooltipCacheKey(bucket);
    return (
      <BucketOpsOwnerCell
        bucket={bucket}
        tooltip={ownerTooltipState[tooltipKey]}
        open={activeOwnerTooltipKey === tooltipKey}
        onOpen={() => {
          setActiveOwnerTooltipKey(tooltipKey);
          loadOwnerTooltip(bucket);
        }}
        onClose={() => {
          setActiveOwnerTooltipKey((prev) => (prev === tooltipKey ? null : prev));
        }}
      />
    );
  };

  const renderFeatureChip = (featureKey: FeatureKey, bucket: CephAdminBucket) => {
    const tooltipKey = featureTooltipCacheKey(bucket, featureKey);
    return (
      <BucketOpsFeatureCell
        bucket={bucket}
        cacheKey={tooltipKey}
        featureKey={featureKey}
        tooltip={featureTooltipState[tooltipKey]}
        open={activeFeatureTooltipKey === tooltipKey}
        onOpen={() => {
          setActiveFeatureTooltipKey(tooltipKey);
          loadFeatureTooltip(bucket, featureKey);
        }}
        onClose={() => setActiveFeatureTooltipKey((prev) => (prev === tooltipKey ? null : prev))}
      />
    );
  };

  const navigateToBucketAction = (
    action: BucketOpsNavigationAction,
    bucket: CephAdminBucket,
  ) => {
    const target = buildBucketOpsNavigationTarget({
      action,
      bucket,
      mode: surface.mode,
      selectedEndpointId,
    });
    if (target) navigate(target);
  };

  const openBucketConfiguration = (bucket: CephAdminBucket) => {
    const listUrl = `${location.pathname}${location.search}`;
    const origin = buildBucketOpsListOrigin({
      listUrl,
      mode: surface.mode,
      selectedEndpointId,
    });
    if (!origin) return;
    persistCurrentListState();
    saveBucketListReturnContext(origin, bucket.name, window.scrollY);
    const target = buildBucketOpsNavigationTarget({
      action: "configure",
      bucket,
      mode: surface.mode,
      selectedEndpointId,
    });
    if (!target) return;
    navigate(target, { state: buildBucketDetailLocationState(origin) });
  };

  const bucketTableColumns = buildBucketOpsTableColumns({
    featureColumns: featureColumnOptions,
    renderActions: (bucket) => (
      <BucketOpsRowActionsMenu
        bucket={bucket}
        isStorageOps={isStorageOps}
        selectedEndpointId={selectedEndpointId}
        cephAdminBrowserEnabled={cephAdminBrowserEnabled}
        onOpenInBrowser={(currentBucket) =>
          navigateToBucketAction("browser", currentBucket)
        }
        onConfigure={openBucketConfiguration}
        onAdminOps={(currentBucket, kind: BucketAdminOpsKind) => {
          if (isStorageOps) return;
          setAdminOpsAction({ kind, bucket: currentBucket });
        }}
        onOpenInManager={(currentBucket) =>
          navigateToBucketAction("manager", currentBucket)
        }
      />
    ),
    renderFeatureChip,
    renderName: (bucket) => (
      <BucketOpsNameCell
        bucket={bucket}
        onConfigure={() => openBucketConfiguration(bucket)}
        useExplicitBucketName={useExplicitBucketName}
      />
    ),
    renderOwnerCell,
    renderS3Tags: renderTagList,
    renderSelection: (bucket) => (
      <BucketOpsSelectionCell
        bucket={bucket}
        isStorageOps={isStorageOps}
        onToggle={() => toggleSelection(bucket.name)}
        selected={selectedBuckets.has(bucket.name)}
        useExplicitBucketName={useExplicitBucketName}
      />
    ),
    renderUiTags,
    selectionHeader: (
      <BucketOpsSelectionHeader
        checked={headerChecked}
        disabled={
          loading || selectAllLoading || !selectedEndpointId || total === 0
        }
        inputRef={selectionHeaderRef}
        onChange={(checked) => {
          void setSelectionForFilteredResults(checked);
        }}
      />
    ),
    visibleColumns,
  });
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: items.length,
  });

  return (
    <div
      className={workflowPageHostClass(
        Boolean(
          showCompareModal ||
            showIntegrityModal ||
            showPurgeModal ||
            showUsageStatsModal ||
            showBulkUpdateModal ||
            Boolean(indexCheckTargets)
        )
      )}
    >
      <PageHeader
        title="Buckets"
        description={shell.pageDescription}
        breadcrumbs={[surface.breadcrumb, { label: "Buckets" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {uiTagsError && <PageBanner tone="error">Bucket UI tags: {uiTagsError}</PageBanner>}
      {statsWarning && <PageBanner tone="warning">{statsWarning}</PageBanner>}

      {!selectedEndpointId && shell.emptyState ? <PageEmptyState {...shell.emptyState} /> : null}
      <ListPageSection
          className="space-y-4"
          title="Buckets"
          description={shell.pageDescription}
          countLabel={`${total} result(s)`}
          search={
            <BucketOpsQuickFilter controller={filterController} value={filter} />
          }
          filters={
            <BucketOpsTagAndAdvancedFilters
              availableUiTags={availableUiTags}
              controller={filterController}
              tagFilterMode={tagFilterMode}
              tagFilters={tagFilters}
            />
          }
          columns={
            <BucketOpsColumnControls
              defaultVisibleColumns={defaultVisibleColumns}
              featureColumnOptions={featureColumnOptions}
              isStorageOps={isStorageOps}
              onReset={resetColumns}
              onToggle={toggleColumn}
              visibleColumns={visibleColumns}
            />
          }
          actions={
            <button
              type="button"
              onClick={() => void refreshBucketListing()}
              disabled={
                !selectedEndpointId ||
                cacheRefreshLoading ||
                loading ||
                loadingDetails ||
                advancedProgress.active
              }
              className={cx(toolbarCompactButtonClasses, "inline-flex items-center gap-2")}
              title="Flush cached bucket listings and reload"
            >
              <RefreshIcon className={`h-3.5 w-3.5 ${cacheRefreshLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          }
          secondaryContent={
            showAdvancedFilter || showActiveFiltersCard ? (
            <>
              <BucketOpsAdvancedFilterDrawer
                advancedApplied={advancedApplied}
                advancedDraft={advancedDraft}
                controller={filterController}
                draftSummaryItems={advancedDraftSummaryItems}
                featureStateOptions={featureStateOptions}
                isStorageOps={isStorageOps}
                sseFeatureEnabled={sseFeatureEnabled}
                storageScopeController={
                  isStorageOps ? storageScopeFilterController : undefined
                }
                usageFeatureEnabled={usageFeatureEnabled}
                usageUnavailableBadge={usageUnavailableBadge}
                usageUnavailableDescription={usageUnavailableDescription}
              />

              <ActiveFiltersBar
                items={
                  showActiveFiltersCard
                    ? activeFilterSummaryItems.map((item) => ({
                        id: item.id,
                        label: item.label,
                        onRemove: () => removeActiveFilterItem(item.remove),
                        removeLabel: `Remove ${item.label}`,
                      }))
                    : []
                }
                onClearAll={resetAllFilters}
              />
            </>
            ) : null
          }
      >
          <BucketSelectionActionsBar
            selectedCount={selectedCount}
            hiddenSelectedCount={hiddenSelectedCount}
            clearSelection={clearSelection}
            availableUiTags={availableUiTags}
            selectedUiTagSuggestions={selectedUiTagSuggestions}
            selectionTagAddInput={selectionTagAddInput}
            setSelectionTagAddInput={setSelectionTagAddInput}
            parsedSelectionTagAddInput={parsedSelectionTagAddInput}
            selectionTagActionLoading={selectionTagActionLoading}
            applyUiTagToSelection={applyUiTagToSelection}
            updateUiTagDefinition={rowTagsController.updateBucketUiTagDefinition}
            updatingDefinitionIds={updatingDefinitionIds}
            selectionExportLoading={selectionExportLoading}
            exportSelectedBuckets={exportSelectedBuckets}
            selectionActionProgress={selectionActionProgress}
            isStorageOps={isStorageOps}
            onShowConfigBackupModal={!isStorageOps ? () => setShowConfigBackupModal(true) : undefined}
            onShowCompareModal={() => setShowCompareModal(true)}
            onShowIndexCheckModal={!isStorageOps ? () => void openSelectedBucketIndexChecks() : undefined}
            onShowIntegrityModal={() => setShowIntegrityModal(true)}
            onShowPurgeModal={
              generalSettings.bucket_purge_enabled ? () => setShowPurgeModal(true) : undefined
            }
            onShowUsageStatsModal={() => setShowUsageStatsModal(true)}
            openBulkUpdateModal={openBulkUpdateModal}
          />

        {selectAllProgress && <ActionProgressCard progress={selectAllProgress} busy className="mb-3" />}

        {renderAdvancedSearchProgress(advancedProgress)}

        <BucketOpsTable
          columns={bucketTableColumns}
          detailLoadingColumnIds={detailLoadingColumnIds}
          items={items}
          loadingDetails={loadingDetails}
          onSort={toggleSort}
          showAdvancedFilter={showAdvancedFilter}
          sort={sort}
          status={tableStatus}
          usageFeatureEnabled={usageFeatureEnabled}
        />

        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(next) => setPage(next)}
          onPageSizeChange={(next) => {
            setPageSize(next);
            setPage(1);
          }}
          disabled={loading || !selectedEndpointId}
        />
      </ListPageSection>
      {!isStorageOps && selectedEndpointId && adminOpsAction && (
        <CephAdminAdminOpsModal
          endpointId={selectedEndpointId}
          endpointName={selectedEndpoint?.name}
          action={adminOpsAction}
          canAccounts={Boolean(selectedEndpointAccess?.can_accounts)}
          onClose={() => setAdminOpsAction(null)}
          onSuccess={() => {
            clearBucketListingUiCaches();
            void refreshBuckets();
          }}
        />
      )}
      {!isStorageOps && showCompareModal && selectedEndpointId && (
        <CephAdminBucketCompareModal
          sourceEndpointId={selectedEndpointId}
          sourceEndpointName={selectedEndpoint?.name}
          sourceBuckets={selectedBucketList}
          endpoints={endpoints}
          onClose={() => setShowCompareModal(false)}
        />
      )}
      {!isStorageOps && indexCheckTargets && selectedEndpointId && (
        <CephAdminBucketIndexCheckPage
          endpointId={selectedEndpointId}
          endpointName={selectedEndpoint?.name}
          targets={indexCheckTargets}
          onClose={closeSelectedBucketIndexChecks}
        />
      )}
      <BucketOpsRunModals
        endpointId={selectedEndpointId}
        endpointName={selectedEndpoint?.name}
        isStorageOps={isStorageOps}
        onCloseIntegrity={() => setShowIntegrityModal(false)}
        onClosePurge={() => setShowPurgeModal(false)}
        onCloseUsageStats={() => setShowUsageStatsModal(false)}
        showIntegrity={showIntegrityModal}
        showPurge={showPurgeModal}
        showUsageStats={showUsageStatsModal}
        targets={selectedOperationTargets}
      />
      {!isStorageOps && showConfigBackupModal && selectedEndpointId && selectedBucketList.length > 0 && (
        <BucketConfigBackupModal
          bucketCount={selectedBucketList.length}
          featureOptions={configBackupFeatureOptions}
          onClose={() => setShowConfigBackupModal(false)}
          onCreate={createConfigBackup}
        />
      )}
      <BucketOpsBulkUpdatePage mode={mode} open={showBulkUpdateModal} onClose={closeBulkUpdateModal}>
        <div className="space-y-4">
            <BucketOpsBulkTransferFields
              clipboard={bulkConfigClipboard}
              clipboardSameEndpoint={bulkClipboardSameEndpoint}
              controller={bulkFormController}
              isStorageOps={isStorageOps}
              pastePlan={bulkPastePlan}
              quotaDisabledReason={quotaOperationDisabledReason}
              scopeDisplayName={scopeDisplayName}
              selectedBucketNames={selectedBucketList}
              selectedCount={selectedCount}
              snsFeatureEnabled={snsFeatureEnabled}
            />
            <BucketOpsBulkConfigurationFields
              controller={bulkFormController}
            />
            <BucketOpsBulkExecutionPanel
              applyDisabled={bulkApplyDisabled}
              applyError={bulkApplyError}
              applyLoading={bulkApplyLoading}
              applyProgress={bulkApplyProgress}
              applySummary={bulkApplySummary}
              copyDisabled={bulkCopyLoading || !hasSelectedCopyFeatures}
              copyError={bulkCopyError}
              copyLoading={bulkCopyLoading}
              copyProgress={bulkCopyProgress}
              copySummary={bulkCopySummary}
              onApply={applyBulkUpdate}
              onClose={closeBulkUpdateModal}
              onCopy={copyBulkConfigs}
              onExport={exportBulkPreviewChanges}
              onPreview={runBulkPreview}
              operation={bulkOperation}
              pasteError={bulkPastePlan.error}
              previewDisabled={bulkPreviewDisabled}
              previewError={bulkPreviewError}
              previewItems={bulkPreview}
              previewLoading={bulkPreviewLoading}
              previewProgress={bulkPreviewProgress}
              previewReady={bulkPreviewReady}
            />
        </div>
      </BucketOpsBulkUpdatePage>
    </div>
  );
}

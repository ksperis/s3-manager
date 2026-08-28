/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
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
import PropertySummaryChip from "../../components/PropertySummaryChip";
import { UiTagBadge } from "../../components/UiTagSettings";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import {
  cx,
  uiCheckboxClass,
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
import { BucketFeatureSummaryChip, BucketSummaryTooltip } from "./BucketFeatureSummaryTooltip";
import type { BucketFeatureTooltipState } from "./BucketFeatureSummaryTooltip";
import BucketOpsBulkUpdatePage from "./BucketOpsBulkUpdatePage";
import BucketOpsAdvancedFilterDrawer from "./BucketOpsAdvancedFilterDrawer";
import BucketOpsBulkConfigurationFields from "./BucketOpsBulkConfigurationFields";
import BucketOpsBulkExecutionPanel from "./BucketOpsBulkExecutionPanel";
import BucketOpsBulkTransferFields from "./BucketOpsBulkTransferFields";
import BucketOpsColumnControls from "./BucketOpsColumnControls";
import BucketOpsOrphanedTagsBanner, {
  type OrphanedTagBucketDetail,
} from "./BucketOpsOrphanedTagsBanner";
import {
  BucketOpsQuickFilter,
  BucketOpsTagAndAdvancedFilters,
} from "./BucketOpsListFilters";
import BucketOpsTable, { type BucketOpsTableColumn } from "./BucketOpsTable";
import BucketOpsRowActionsMenu from "./BucketOpsRowActionsMenu";
import BucketOpsRunModals from "./BucketOpsRunModals";
import BucketSelectionActionsBar from "./BucketSelectionActionsBar";
import BucketUiTagSettingsBadge from "./BucketUiTagSettingsBadge";
import ActionProgressCard from "./ActionProgressCard";
import { useBucketOpsListing } from "./useBucketOpsListing";
import { useBucketOpsRowTags } from "./useBucketOpsRowTags";
import { useBucketOpsTooltips } from "./useBucketOpsTooltips";
import { buildBucketOpsListingProjection } from "./bucketOpsListingProjection";
import { prepareBucketOpsBulkInput } from "./bucketOpsBulkInput";
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
import { buildBucketTagSummaryLines } from "./bucketFeatureSummaries";
import {
  buildBucketOpsActiveFilterSummaryItems,
  buildBucketOpsDraftFilterSummaryItems,
} from "./bucketOpsFilterSummary";
import {
  renderAdvancedSearchProgress,
} from "../cephAdmin/filtering/advancedFilterShared";
import {
  FEATURE_LABELS,
  FEATURE_STATE_OPTIONS,
  type FeatureKey,
} from "./bucketOpsAdvancedFilterModel";
import {
  FEATURE_DETAIL_COLUMN_OPTIONS,
  type ColumnId,
  type SortField,
} from "./bucketOpsListState";
import { extractApiError } from "../../utils/apiError";
import { triggerDownload } from "../../utils/download";
import { formatBytes, formatNumber } from "../../utils/format";
import {
  BUCKET_CONFIG_BACKUP_FEATURE_LABELS,
  type BulkCopyFeatureKey,
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
  formatBucketColumnDetail,
  formatOptionalBytes,
  formatOptionalCount,
  formatOwnerSuspended,
  formatQuotaBytes,
  formatQuotaObjects,
  formatQuotaUsageValue,
  getBucketDisplayName,
  getStorageOpsBucketName,
  getStorageOpsContextId,
  getTagColors,
  isBucketQuotaConfigured,
  isStatsSortField,
  ownerFilterFromSearch,
  sanitizeExportFilenamePart,
} from "./bucketOpsPresentation";

const extractError = (err: unknown): string => {
  return extractApiError(err, "Unexpected error");
};

const toAnchorRef = (node: HTMLElement | null): RefObject<HTMLElement | null> => ({ current: node });

function SpinnerIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`${className} animate-spin`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" className="opacity-30" stroke="currentColor" strokeWidth="2.5" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

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
    orphanEntries: uiTagOrphanEntries,
    definitions: availableUiTags,
    ready: uiTagsReady,
    error: uiTagsError,
    reload: reloadUiTags,
    applyTags: persistUiTagChanges,
    updateDefinition: persistUiTagDefinition,
    updatingDefinitionIds,
    removeTargets: removeUiTagTargets,
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
    bulkCorsDeleteIds,
    bulkCorsDeleteTypes,
    bulkCorsRuleText,
    bulkCorsUpdateOnlyExisting,
    bulkLifecycleDeleteIds,
    bulkLifecycleDeleteTypes,
    bulkLifecycleRuleText,
    bulkLifecycleUpdateOnlyExisting,
    bulkNotificationDeleteIds,
    bulkNotificationDeleteTypes,
    bulkNotificationText,
    bulkOperation,
    bulkPasteMapping,
    bulkPolicyDeleteIds,
    bulkPolicyDeleteTypes,
    bulkPolicyText,
    bulkPolicyUpdateOnlyExisting,
    bulkPublicAccessBlockTargets,
    bulkQuotaApplyObjects,
    bulkQuotaApplySize,
    bulkQuotaObjects,
    bulkQuotaSizeUnit,
    bulkQuotaSizeValue,
    bulkQuotaSkipConfigured,
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
    ownerTooltipAnchorRefs,
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

  const {
    addExistingTagForBucket,
    addTagDraftForBucket,
    getRowTagProjection,
    removeTagCreationDraft,
    removeTagForBucket,
    setTagSuggestionBucket,
    stageTagsForBucket,
    updateBucketUiTagDefinition,
    updateTagCreationDraft,
    updateTagDraft,
  } = useBucketOpsRowTags({
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
    () =>
      prepareBucketOpsBulkInput({
        operation: bulkOperation,
        quota: {
          applyObjects: bulkQuotaApplyObjects,
          applySize: bulkQuotaApplySize,
          objects: bulkQuotaObjects,
          sizeUnit: bulkQuotaSizeUnit,
          sizeValue: bulkQuotaSizeValue,
        },
        lifecycle: {
          deleteIds: bulkLifecycleDeleteIds,
          deleteTypes: bulkLifecycleDeleteTypes,
          ruleText: bulkLifecycleRuleText,
          updateOnlyExisting: bulkLifecycleUpdateOnlyExisting,
        },
        notifications: {
          configurationText: bulkNotificationText,
          deleteIds: bulkNotificationDeleteIds,
          deleteTypes: bulkNotificationDeleteTypes,
        },
        cors: {
          deleteIds: bulkCorsDeleteIds,
          deleteTypes: bulkCorsDeleteTypes,
          ruleText: bulkCorsRuleText,
          updateOnlyExisting: bulkCorsUpdateOnlyExisting,
        },
        policy: {
          deleteIds: bulkPolicyDeleteIds,
          deleteTypes: bulkPolicyDeleteTypes,
          policyText: bulkPolicyText,
          updateOnlyExisting: bulkPolicyUpdateOnlyExisting,
        },
        publicAccessBlockTargets: bulkPublicAccessBlockTargets,
      }),
    [
      bulkCorsDeleteIds,
      bulkCorsDeleteTypes,
      bulkCorsRuleText,
      bulkCorsUpdateOnlyExisting,
      bulkLifecycleDeleteIds,
      bulkLifecycleDeleteTypes,
      bulkLifecycleRuleText,
      bulkLifecycleUpdateOnlyExisting,
      bulkNotificationDeleteIds,
      bulkNotificationDeleteTypes,
      bulkNotificationText,
      bulkOperation,
      bulkPolicyDeleteIds,
      bulkPolicyDeleteTypes,
      bulkPolicyText,
      bulkPolicyUpdateOnlyExisting,
      bulkPublicAccessBlockTargets,
      bulkQuotaApplyObjects,
      bulkQuotaApplySize,
      bulkQuotaObjects,
      bulkQuotaSizeUnit,
      bulkQuotaSizeValue,
    ],
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
    bulkOperation,
    bulkQuotaSizeValue,
    bulkQuotaSizeUnit,
    bulkQuotaObjects,
    bulkQuotaApplySize,
    bulkQuotaApplyObjects,
    bulkQuotaSkipConfigured,
    bulkPublicAccessBlockTargets,
    bulkLifecycleRuleText,
    bulkLifecycleUpdateOnlyExisting,
    bulkLifecycleDeleteIds,
    bulkLifecycleDeleteTypes,
    bulkNotificationText,
    bulkNotificationDeleteIds,
    bulkNotificationDeleteTypes,
    bulkCorsRuleText,
    bulkCorsUpdateOnlyExisting,
    bulkCorsDeleteIds,
    bulkCorsDeleteTypes,
    bulkPolicyText,
    bulkPolicyUpdateOnlyExisting,
    bulkPolicyDeleteIds,
    bulkPolicyDeleteTypes,
    bulkCopyFeatures,
    bulkPasteMapping,
    bulkConfigClipboard,
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
  const orphanedTagBuckets = useMemo(
    () => Object.keys(uiTagOrphanEntries).sort((a, b) => a.localeCompare(b)),
    [uiTagOrphanEntries]
  );
  const clearOrphanedTags = async () => {
    if (orphanedTagBuckets.length === 0) return;
    try {
      await removeUiTagTargets(orphanedTagBuckets);
      refreshBuckets();
    } catch (err) {
      setError(extractError(err));
      refreshBuckets();
    }
  };
  const orphanedTagDetails = useMemo<OrphanedTagBucketDetail[]>(
    () =>
      orphanedTagBuckets
        .map((bucketKey) => {
          const entry = uiTagOrphanEntries[bucketKey];
          return {
            key: bucketKey,
            endpointId: entry?.target.endpointId ?? 0,
            name: entry?.target.name ?? bucketKey,
            tenant: entry?.target.tenant ?? null,
            tags: (entry?.tags ?? []).map((tag) => tag.label),
          };
        })
        .sort((a, b) => {
          const tenantCompare = (a.tenant ?? "").localeCompare(b.tenant ?? "");
          if (tenantCompare !== 0) return tenantCompare;
          return a.name.localeCompare(b.name);
        }),
    [orphanedTagBuckets, uiTagOrphanEntries]
  );
  const hasDeleteCriteria =
    bulkLifecycleDeleteIds.trim().length > 0 || Object.values(bulkLifecycleDeleteTypes).some(Boolean);
  const hasNotificationDeleteCriteria =
    bulkNotificationDeleteIds.trim().length > 0 || Object.values(bulkNotificationDeleteTypes).some(Boolean);
  const hasCorsDeleteCriteria =
    bulkCorsDeleteIds.trim().length > 0 || Object.values(bulkCorsDeleteTypes).some(Boolean);
  const hasPolicyDeleteCriteria =
    bulkPolicyDeleteIds.trim().length > 0 || Object.values(bulkPolicyDeleteTypes).some(Boolean);
  const hasPublicAccessBlockTargetCriteria = Object.values(bulkPublicAccessBlockTargets).some(Boolean);
  const bulkPreviewDisabled =
    bulkPreviewLoading ||
    bulkApplyLoading ||
    !bulkOperation ||
    ((bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") &&
      !hasPublicAccessBlockTargetCriteria) ||
    (bulkOperation === "add_lifecycle" && !bulkLifecycleRuleText.trim()) ||
    (bulkOperation === "delete_lifecycle" && !hasDeleteCriteria) ||
    (bulkOperation === "add_notifications" && !bulkNotificationText.trim()) ||
    (bulkOperation === "delete_notifications" && !hasNotificationDeleteCriteria) ||
    (bulkOperation === "add_cors" && !bulkCorsRuleText.trim()) ||
    (bulkOperation === "delete_cors" && !hasCorsDeleteCriteria) ||
    (bulkOperation === "add_policy" && !bulkPolicyText.trim()) ||
    (bulkOperation === "delete_policy" && !hasPolicyDeleteCriteria) ||
    (bulkOperation === "set_quota" && Boolean(quotaOperationDisabledReason)) ||
    (bulkOperation === "paste_configs" && Boolean(bulkPastePlan.error));
  const bulkApplyDisabled =
    !bulkPreviewReady ||
    bulkApplyLoading ||
    (bulkOperation === "set_quota" && Boolean(quotaOperationDisabledReason));
  const hasSelectedCopyFeatures = useMemo(
    () => (Object.keys(bulkCopyFeatures) as BulkCopyFeatureKey[]).some((feature) => bulkCopyFeatures[feature]),
    [bulkCopyFeatures]
  );
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

  const renderTagList = (tags: CephAdminBucket["tags"] | undefined, bucket: CephAdminBucket) => {
    const safeTags = Array.isArray(tags) ? tags.filter((t) => (t.key ?? "").trim()) : [];
    if (safeTags.length === 0) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    const maxShown = 3;
    const shown = safeTags.slice(0, maxShown);
    const remaining = safeTags.length - shown.length;
    const tooltipKey = `${bucket.tenant ?? ""}:${bucket.name}:tags`;
    const tooltip: BucketFeatureTooltipState = { status: "ready", lines: buildBucketTagSummaryLines(safeTags) };
    return (
      <BucketSummaryTooltip
        label="S3 tags"
        tooltip={tooltip}
        open={activeTagsTooltipKey === tooltipKey}
        onOpen={() => setActiveTagsTooltipKey(tooltipKey)}
        onClose={() => setActiveTagsTooltipKey((prev) => (prev === tooltipKey ? null : prev))}
        cacheKey={tooltipKey}
        buttonClassName="inline-flex max-w-full cursor-default text-left"
      >
        <div className="flex flex-wrap gap-1.5">
          {shown.map((t) => {
            const label = `${t.key}=${t.value}`;
            const colors = getTagColors(label);
            return (
              <span
                key={`${t.key}:${t.value}`}
                className="rounded-full border px-2 py-0.5 ui-caption font-semibold"
                style={{ backgroundColor: colors.background, color: colors.text, borderColor: colors.border }}
              >
                {label}
              </span>
            );
          })}
          {remaining > 0 && (
            <span className="rounded-full border border-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
              +{remaining}
            </span>
          )}
        </div>
      </BucketSummaryTooltip>
    );
  };

  const renderUiTags = (bucket: CephAdminBucket) => {
    const bucketTarget = resolveBucketTagTarget(bucket);
    if (!bucketTarget) {
      return (
        <span className="ui-caption text-slate-500 dark:text-slate-400" title="UI tags require a configured storage endpoint.">
          Endpoint required
        </span>
      );
    }
    const {
      creationDrafts,
      draft,
      showSuggestions,
      suggestions,
      tags,
    } = getRowTagProjection(bucketTarget, bucket.ui_tags ?? []);
    return (
      <div className="group relative flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <BucketUiTagSettingsBadge
            key={`${bucketTarget.key}:${tag.id}`}
            tag={tag}
            isStorageOps={isStorageOps}
            disabled={updatingDefinitionIds.has(tag.id)}
            onChange={(changes) => updateBucketUiTagDefinition(tag, changes)}
            onRemove={() => void removeTagForBucket(bucketTarget, tag)}
          />
        ))}
        {creationDrafts.map((draft, index) => (
          <BucketUiTagSettingsBadge
            key={draft.draftId}
            tag={draft}
            isStorageOps={isStorageOps}
            initiallyOpen={index === creationDrafts.length - 1}
            onChange={(changes) =>
              updateTagCreationDraft(bucketTarget.key, draft.draftId, changes)
            }
            onRemove={() =>
              removeTagCreationDraft(bucketTarget.key, draft.draftId)
            }
            onCommit={() => addTagDraftForBucket(bucketTarget, draft)}
          />
        ))}
        <div className="flex w-28 shrink-0 items-center gap-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => updateTagDraft(bucketTarget.key, e.target.value)}
            onFocus={() => setTagSuggestionBucket(bucketTarget.key)}
            onBlur={() => {
              window.setTimeout(() => {
                setTagSuggestionBucket((prev) => (prev === bucketTarget.key ? null : prev));
              }, 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                stageTagsForBucket(bucketTarget, draft);
              }
            }}
            placeholder="+"
            className={`w-full border-0 bg-transparent p-0 ui-caption text-slate-500 placeholder:text-slate-400 transition-opacity duration-150 focus:outline-none focus:ring-0 dark:text-slate-300 ${
              draft ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
            }`}
          />
        </div>
        {showSuggestions && (
          <div
            className="absolute left-0 top-full z-20 mt-1 max-h-40 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.map((tag) => (
              <button
                key={`${bucketTarget.key}:suggest:${tag.id}`}
                type="button"
                onClick={() => {
                  void addExistingTagForBucket(bucketTarget, tag);
                  updateTagDraft(bucketTarget.key, "");
                }}
                className="flex w-full items-center rounded-md px-2 py-1 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <UiTagBadge
                  label={tag.label}
                  colorKey={tag.color_key}
                  visibility={tag.visibility}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderOwnerCell = (bucket: CephAdminBucket) => {
    const owner = (bucket.owner || "").trim();
    if (!owner) return "-";
    const tooltipKey = ownerTooltipCacheKey(bucket);
    const tooltip = ownerTooltipState[tooltipKey];
    const isTooltipVisible = activeOwnerTooltipKey === tooltipKey;
    return (
      <div
        className="relative inline-flex"
        onMouseEnter={() => {
          setActiveOwnerTooltipKey(tooltipKey);
          loadOwnerTooltip(bucket);
        }}
        onMouseLeave={() => {
          setActiveOwnerTooltipKey((prev) => (prev === tooltipKey ? null : prev));
        }}
      >
        <button
          ref={(node) => {
            ownerTooltipAnchorRefs.current[tooltipKey] = node;
          }}
          type="button"
          className="inline-flex cursor-help text-left decoration-dotted underline-offset-2 hover:underline focus:underline"
          onFocus={() => {
            setActiveOwnerTooltipKey(tooltipKey);
            loadOwnerTooltip(bucket);
          }}
          onBlur={() => {
            setActiveOwnerTooltipKey((prev) => (prev === tooltipKey ? null : prev));
          }}
          aria-label="Resolve owner name"
        >
          {owner}
        </button>
        <AnchoredPortalMenu
          open={isTooltipVisible}
          anchorRef={toAnchorRef(ownerTooltipAnchorRefs.current[tooltipKey])}
          placement="bottom-start"
          offset={4}
          minWidth={288}
          className="pointer-events-none w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div>
            <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">Owner</p>
            <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">UID: {owner}</p>
            {(!tooltip || tooltip.status === "loading") && (
              <div className="mt-1.5 inline-flex items-center gap-1.5 ui-caption text-slate-500 dark:text-slate-300">
                <SpinnerIcon />
                Resolving owner name...
              </div>
            )}
            {tooltip?.status === "error" && (
              <p className="mt-1.5 ui-caption text-rose-600 dark:text-rose-300">{tooltip.message}</p>
            )}
            {tooltip?.status === "ready" && (
              <p className="mt-1.5 ui-caption text-slate-600 dark:text-slate-300">
                Owner name: {tooltip.ownerName ? tooltip.ownerName : "Not found"}
              </p>
            )}
          </div>
        </AnchoredPortalMenu>
      </div>
    );
  };

  const renderFeatureChip = (featureKey: FeatureKey, bucket: CephAdminBucket) => {
    const status = bucket.features?.[featureKey] ?? null;
    if (!status) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    const tooltipKey = featureTooltipCacheKey(bucket, featureKey);
    const tooltip = featureTooltipState[tooltipKey];
    const isTooltipVisible = activeFeatureTooltipKey === tooltipKey;
    return (
      <BucketFeatureSummaryChip
        label={FEATURE_LABELS[featureKey]}
        state={status.state}
        tone={status.tone}
        tooltip={tooltip}
        open={isTooltipVisible}
        onOpen={() => {
          setActiveFeatureTooltipKey(tooltipKey);
          loadFeatureTooltip(bucket, featureKey);
        }}
        onClose={() => setActiveFeatureTooltipKey((prev) => (prev === tooltipKey ? null : prev))}
        cacheKey={tooltipKey}
      />
    );
  };

  const openBucketConfiguration = (bucket: CephAdminBucket) => {
    if (!selectedEndpointId) return;
    persistCurrentListState();
    const listUrl = `${location.pathname}${location.search}`;
    const scopeKey = isStorageOps ? "storage-ops" : String(selectedEndpointId);
    const origin = { surface: surface.mode, scopeKey, listUrl };
    saveBucketListReturnContext(origin, bucket.name, window.scrollY);

    if (isStorageOps) {
      const contextId = getStorageOpsContextId(bucket);
      const bucketName = getStorageOpsBucketName(bucket);
      if (!contextId || !bucketName) return;
      const params = new URLSearchParams();
      params.set("ctx", contextId);
      navigate({
        pathname: `/storage-ops/buckets/${encodeURIComponent(bucketName)}`,
        search: `?${params.toString()}`,
      }, {
        state: {
          ...buildBucketDetailLocationState(origin),
        },
      });
      return;
    }
    const params = new URLSearchParams();
    params.set("ep", String(selectedEndpointId));
    navigate({
      pathname: `/ceph-admin/buckets/${encodeURIComponent(bucket.name)}`,
      search: `?${params.toString()}`,
    }, { state: buildBucketDetailLocationState(origin) });
  };

  const bucketTableColumns: BucketOpsTableColumn[] = (() => {
    const cols: BucketOpsTableColumn[] = [
      {
        id: "select",
        label: "",
        field: null,
        header: (
          <input
            ref={selectionHeaderRef}
            type="checkbox"
            aria-label="Select all filtered buckets"
            checked={headerChecked}
            onChange={(e) => {
              void setSelectionForFilteredResults(e.target.checked);
            }}
            disabled={loading || selectAllLoading || !selectedEndpointId || total === 0}
            className={uiCheckboxClass}
          />
        ),
        align: "left",
        render: (bucket) => (
          <input
            type="checkbox"
            aria-label={`Select bucket ${getBucketDisplayName(bucket, useExplicitBucketName)}${
              isStorageOps && (bucket as StorageOpsBucket).context_name
                ? ` in ${(bucket as StorageOpsBucket).context_name}`
                : ""
            }`}
            checked={selectedBuckets.has(bucket.name)}
            onChange={() => toggleSelection(bucket.name)}
            className={uiCheckboxClass}
          />
        ),
      },
      {
        id: "name",
        label: "Name",
        field: "name",
        headerClassName: "w-[12rem] min-w-[10rem] max-w-[20rem]",
        cellClassName: "w-[12rem] min-w-[10rem] max-w-[20rem]",
        render: (bucket) => (
          <button
            type="button"
            onClick={() => openBucketConfiguration(bucket)}
            data-bucket-row-key={bucket.name}
            className="block w-full truncate text-left hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:hover:text-primary-200"
            title={`Configure ${getBucketDisplayName(bucket, useExplicitBucketName)} with the S3 API`}
          >
            {getBucketDisplayName(bucket, useExplicitBucketName)}
          </button>
        ),
      },
    ];

    const visible = new Set(visibleColumns);
    if (visible.has("context_name")) {
      cols.push({
        id: "context_name",
        label: "Context",
        field: null,
        headerClassName: "min-w-[10rem] max-w-[16rem]",
        cellClassName: "min-w-[10rem] max-w-[16rem]",
        render: (bucket) => ((bucket as { context_name?: string | null }).context_name ?? "-"),
      });
    }
    if (visible.has("context_kind")) {
      cols.push({
        id: "context_kind",
        label: "Kind",
        field: null,
        headerClassName: "w-28",
        render: (bucket) => {
          const kind = (bucket as { context_kind?: string | null }).context_kind;
          if (kind === "account") return "Account";
          if (kind === "connection") return "Connection";
          if (kind === "s3_user") return "S3 user";
          return "-";
        },
      });
    }
    if (visible.has("endpoint_name")) {
      cols.push({
        id: "endpoint_name",
        label: "Endpoint",
        field: null,
        headerClassName: "min-w-[10rem] max-w-[16rem]",
        cellClassName: "min-w-[10rem] max-w-[16rem]",
        render: (bucket) => ((bucket as { endpoint_name?: string | null }).endpoint_name ?? "-"),
      });
    }
    if (visible.has("ui_tags")) {
      cols.push({
        id: "ui_tags",
        label: "UI tags",
        field: null,
        header: <span>UI tags</span>,
        headerClassName: "min-w-[12rem] max-w-[24rem]",
        cellClassName: "min-w-[12rem] max-w-[24rem]",
        render: (bucket) => renderUiTags(bucket),
      });
    }
    if (visible.has("tenant")) {
      cols.push({
        id: "tenant",
        label: "Tenant",
        field: "tenant",
        headerClassName: "min-w-[8rem] max-w-[12rem]",
        cellClassName: "min-w-[8rem] max-w-[12rem]",
        render: (bucket) => bucket.tenant ?? "-",
      });
    }
    if (visible.has("owner")) {
      cols.push({
        id: "owner",
        label: "Owner",
        field: "owner",
        headerClassName: "min-w-[14rem]",
        cellClassName: "min-w-[12rem] max-w-[24rem]",
        render: (bucket) => renderOwnerCell(bucket),
      });
    }
    if (visible.has("owner_name")) {
      cols.push({
        id: "owner_name",
        label: "Owner name",
        field: null,
        expensive: true,
        headerClassName: "min-w-[12rem] max-w-[24rem]",
        cellClassName: "min-w-[12rem] max-w-[24rem]",
        render: (bucket) => bucket.owner_name ?? "-",
      });
    }
    if (visible.has("owner_suspended")) {
      cols.push({
        id: "owner_suspended",
        label: "Owner suspended",
        field: null,
        expensive: true,
        headerClassName: "w-36",
        render: (bucket) => formatOwnerSuspended(bucket.owner_suspended),
      });
    }
    if (visible.has("owner_used_bytes")) {
      cols.push({
        id: "owner_used_bytes",
        label: "Owner used",
        field: null,
        expensive: true,
        headerClassName: "w-36",
        render: (bucket) => formatOptionalBytes(bucket.owner_used_bytes),
      });
    }
    if (visible.has("owner_quota_max_size_bytes")) {
      cols.push({
        id: "owner_quota_max_size_bytes",
        label: "Owner quota",
        field: null,
        expensive: true,
        headerClassName: "w-36",
        render: (bucket) => formatQuotaBytes(bucket.owner_quota_max_size_bytes),
      });
    }
    if (visible.has("owner_quota_usage_size_percent")) {
      cols.push({
        id: "owner_quota_usage_size_percent",
        label: "Owner quota %",
        field: null,
        expensive: true,
        headerClassName: "w-32",
        render: (bucket) => formatQuotaUsageValue(bucket.owner_used_bytes, bucket.owner_quota_max_size_bytes),
      });
    }
    if (visible.has("used_bytes")) {
      cols.push({
        id: "used_bytes",
        label: "Used",
        field: "used_bytes",
        headerClassName: "w-28",
        render: (bucket) => formatBytes(bucket.used_bytes),
      });
    }
    if (visible.has("quota_max_size_bytes")) {
      cols.push({
        id: "quota_max_size_bytes",
        label: "Quota",
        field: null,
        headerClassName: "w-36",
        render: (bucket) => {
          return formatQuotaBytes(bucket.quota_max_size_bytes);
        },
      });
    }
    if (visible.has("quota_usage_size_percent")) {
      cols.push({
        id: "quota_usage_size_percent",
        label: "Quota %",
        field: null,
        headerClassName: "w-28",
        render: (bucket) => formatQuotaUsageValue(bucket.used_bytes, bucket.quota_max_size_bytes),
      });
    }
    if (visible.has("object_count")) {
      cols.push({
        id: "object_count",
        label: "Objects",
        field: "object_count",
        headerClassName: "w-24",
        render: (bucket) => formatNumber(bucket.object_count),
      });
    }
    if (visible.has("quota_max_objects")) {
      cols.push({
        id: "quota_max_objects",
        label: "Object quota",
        field: null,
        headerClassName: "w-36",
        render: (bucket) => {
          return formatQuotaObjects(bucket.quota_max_objects);
        },
      });
    }
    if (visible.has("quota_usage_object_percent")) {
      cols.push({
        id: "quota_usage_object_percent",
        label: "Object quota %",
        field: null,
        headerClassName: "w-36",
        render: (bucket) => formatQuotaUsageValue(bucket.object_count, bucket.quota_max_objects),
      });
    }
    if (visible.has("owner_object_count")) {
      cols.push({
        id: "owner_object_count",
        label: "Owner objects",
        field: null,
        expensive: true,
        headerClassName: "w-36",
        render: (bucket) => formatOptionalCount(bucket.owner_object_count),
      });
    }
    if (visible.has("owner_quota_max_objects")) {
      cols.push({
        id: "owner_quota_max_objects",
        label: "Owner object quota",
        field: null,
        expensive: true,
        headerClassName: "w-40",
        render: (bucket) => formatQuotaObjects(bucket.owner_quota_max_objects),
      });
    }
    if (visible.has("owner_quota_usage_object_percent")) {
      cols.push({
        id: "owner_quota_usage_object_percent",
        label: "Owner object quota %",
        field: null,
        expensive: true,
        headerClassName: "w-40",
        render: (bucket) => formatQuotaUsageValue(bucket.owner_object_count, bucket.owner_quota_max_objects),
      });
    }
    if (visible.has("tags")) {
      cols.push({
        id: "tags",
        label: "Tags",
        field: null,
        expensive: true,
        headerClassName: "min-w-[12rem] max-w-[24rem]",
        cellClassName: "min-w-[12rem] max-w-[24rem]",
        render: (bucket) => renderTagList(bucket.tags, bucket),
      });
    }

    featureColumnOptions.forEach((c) => {
      if (!visible.has(c.id)) return;
      cols.push({
        id: c.id,
        label: c.label,
        field: null,
        expensive: true,
        headerClassName: "w-36",
        render: (bucket) => renderFeatureChip(c.key, bucket),
      });
    });

    FEATURE_DETAIL_COLUMN_OPTIONS.forEach((detail) => {
      if (!visible.has(detail.id)) return;
      cols.push({
        id: detail.id,
        label: detail.label,
        field: null,
        expensive: true,
        headerClassName: "min-w-[10rem] max-w-[18rem]",
        cellClassName: "min-w-[10rem] max-w-[20rem]",
        render: (bucket) => {
          const value = formatBucketColumnDetail(bucket, detail.id);
          return (
            <span className="block truncate" title={value}>
              {value}
            </span>
          );
        },
      });
    });

    if (visible.has("quota_status")) {
      cols.push({
        id: "quota_status",
        label: "Quota status",
        field: null,
        headerClassName: "w-32",
        render: (bucket) => (
          <PropertySummaryChip
            compact
            state={isBucketQuotaConfigured(bucket) ? "Configured" : "Not set"}
            tone={isBucketQuotaConfigured(bucket) ? "active" : "inactive"}
            title={`Quota: ${isBucketQuotaConfigured(bucket) ? "Configured" : "Not set"}`}
          />
        ),
      });
    }

    cols.push({
      id: "actions",
      label: "Act.",
      field: null,
      align: "right",
      headerClassName: "w-16",
      cellClassName: "!py-1.5",
      render: (bucket) => {
        return (
          <BucketOpsRowActionsMenu
            bucket={bucket}
            isStorageOps={isStorageOps}
            selectedEndpointId={selectedEndpointId}
            cephAdminBrowserEnabled={cephAdminBrowserEnabled}
            onOpenInBrowser={(currentBucket) => {
              if (!selectedEndpointId) return;
              const params = new URLSearchParams();
              params.set("ep", String(selectedEndpointId));
              params.set("bucket", currentBucket.name);
              navigate({ pathname: "/ceph-admin/browser", search: `?${params.toString()}` });
            }}
            onConfigure={openBucketConfiguration}
            onAdminOps={(currentBucket, kind: BucketAdminOpsKind) => {
              if (isStorageOps) return;
              setAdminOpsAction({ kind, bucket: currentBucket });
            }}
            onOpenInManager={(currentBucket) => {
              if (!isStorageOps) return;
              const contextId = getStorageOpsContextId(currentBucket);
              const bucketName = getStorageOpsBucketName(currentBucket);
              if (!contextId || !bucketName) return;
              const params = new URLSearchParams();
              params.set("ctx", contextId);
              navigate({
                pathname: `/manager/buckets/${encodeURIComponent(bucketName)}`,
                search: `?${params.toString()}`,
              });
            }}
          />
        );
      },
    });

    return cols;
  })();
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
      <BucketOpsOrphanedTagsBanner
        details={orphanedTagDetails}
        onClear={clearOrphanedTags}
      />

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
            updateUiTagDefinition={updateBucketUiTagDefinition}
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

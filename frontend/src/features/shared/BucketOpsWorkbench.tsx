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
import TableEmptyState from "../../components/TableEmptyState";
import {
  toolbarCompactButtonClasses,
  toolbarCompactInputClasses,
  toolbarCompactSelectClasses,
} from "../../components/toolbarControlClasses";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import SortableHeader from "../../components/SortableHeader";
import PaginationControls from "../../components/PaginationControls";
import PropertySummaryChip from "../../components/PropertySummaryChip";
import ColumnVisibilityPicker from "../../components/ColumnVisibilityPicker";
import { UiTagBadge } from "../../components/UiTagSettings";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiDetails from "../../components/ui/UiDetails";
import UiButton from "../../components/ui/UiButton";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiCheckboxClass,
  uiMenuClass,
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
import { ChevronDownIcon, RefreshIcon } from "../browser/browserIcons";
import {
  NOTIFICATION_CONFIGURATION_ARRAY_KEYS,
  NOTIFICATION_EVENTBRIDGE_KEY,
} from "../cephAdmin/bucketJsonParsers";
import CephAdminAdminOpsModal, {
  type CephAdminAdminOpsAction,
  type BucketAdminOpsKind,
} from "../cephAdmin/CephAdminAdminOpsModal";
import { useCephAdminEndpoint } from "../cephAdmin/CephAdminEndpointContext";
import CephAdminBucketCompareModal from "../cephAdmin/CephAdminBucketCompareModal";
import CephAdminBucketIndexCheckPage from "../cephAdmin/CephAdminBucketIndexCheckPage";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import BucketIntegrityCheckModal from "./BucketIntegrityCheckModal";
import BucketPurgeRunModal from "./BucketPurgeRunModal";
import BucketUsageStatsRunModal from "./BucketUsageStatsRunModal";
import BucketConfigBackupModal from "./BucketConfigBackupModal";
import type { BucketConfigBackupFeatureOption } from "./BucketConfigBackupModal";
import { BucketFeatureSummaryChip, BucketSummaryTooltip } from "./BucketFeatureSummaryTooltip";
import type { BucketFeatureTooltipState } from "./BucketFeatureSummaryTooltip";
import BucketOpsBulkUpdatePage from "./BucketOpsBulkUpdatePage";
import BucketOpsFeatureDetailFilterFields from "./BucketOpsFeatureDetailFilterFields";
import BucketOpsFeatureStateFilterFields from "./BucketOpsFeatureStateFilterFields";
import BucketOpsIdentityFilterFields from "./BucketOpsIdentityFilterFields";
import BucketOpsMetricFilterFields from "./BucketOpsMetricFilterFields";
import BucketOpsRowActionsMenu from "./BucketOpsRowActionsMenu";
import BucketSelectionActionsBar from "./BucketSelectionActionsBar";
import BucketOpsStorageScopeFilterFields from "./BucketOpsStorageScopeFilterFields";
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
import { calculateActionProgressPercent } from "./actionProgress";
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
  advancedFilterAccordionClass,
  advancedFilterBackdropClass,
  advancedFilterBodyClass,
  advancedFilterDrawerClass,
  advancedFilterFooterClass,
  advancedFilterHeaderClass,
  formatAdvancedFilterSyncLabel,
  advancedFilterSyncBadgeClass,
  advancedFilterRootClass,
  advancedFilterSectionClass,
  renderAdvancedFilterCostBadge,
  renderAdvancedFilterDraftSummary,
  renderAdvancedFilterRuleCountBadge,
  renderAdvancedSearchProgress,
  renderFilterCostIndicator,
  type FilterCostLevel,
} from "../cephAdmin/filtering/advancedFilterShared";
import {
  FEATURE_LABELS,
  FEATURE_STATE_OPTIONS,
  type AdvancedFilterSecondarySectionId,
  type FeatureKey,
  type TextMatchMode,
} from "./bucketOpsAdvancedFilterModel";
import {
  BUCKET_CORE_COLUMN_OPTIONS,
  BUCKET_QUOTA_COLUMN_GROUPS,
  FEATURE_DETAIL_COLUMN_OPTIONS,
  type ColumnId,
  type FeatureDetailColumnOption,
  type SortField,
} from "./bucketOpsListState";
import { extractApiError } from "../../utils/apiError";
import { triggerDownload } from "../../utils/download";
import { formatBytes, formatNumber } from "../../utils/format";
import {
  CORS_TYPE_OPTIONS,
  LIFECYCLE_TYPE_OPTIONS,
  NOTIFICATION_TYPE_OPTIONS,
  POLICY_TYPE_OPTIONS,
} from "./bucketConfigMerge";
import {
  BULK_COPY_FEATURE_LABELS,
  BUCKET_CONFIG_BACKUP_FEATURE_LABELS,
  PUBLIC_ACCESS_BLOCK_OPTIONS,
  type BulkCopyFeatureKey,
  type BulkOperation,
  type BulkPreviewItem,
  type BulkPreviewLine,
  type BulkPreviewTone,
  type QuotaSizeUnit,
} from "./bucketBulkOperationsModel";
import {
  buildBulkPreviewExportPayload,
  buildBulkPreviewSections,
  summarizeBulkPreview,
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
  normalizeBucketName,
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

type OrphanedTagBucketDetail = {
  key: string;
  endpointId: number;
  name: string;
  tenant: string | null;
  tags: string[];
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
    addTagFilter,
    advancedDraftActiveCount,
    advancedDraftFeatureCount,
    advancedDraftFeatureDetailCount,
    advancedDraftGlobalCostLevel,
    advancedDraftGlobalCostTooltip,
    advancedDraftRangeCount,
    advancedFilterCloseGuard,
    advancedFilterParam,
    advancedFilterSecondarySections,
    advancedFiltersApplied,
    applyAdvancedFilter,
    contextDraftIds,
    contextFieldState,
    effectiveQuickFilterMode,
    effectiveQuickSearchValue,
    endpointDraftNames,
    endpointFieldState,
    hasAnyAdvancedToClear,
    hasPendingAdvancedChanges,
    openAdvancedFilterDrawer,
    quickFilterAppliedParsed,
    quickFilterDraftForcesExact,
    quickFilterFieldState,
    quickFilterModeForDisplay,
    quickFilterPending,
    removeActiveFilterItem,
    removeTagFilter,
    resetAdvancedFilter,
    resetAllFilters,
    showAdvancedFilter,
    toggleAdvancedFilterSecondarySection,
    toggleQuickFilterMode,
    updateAdvancedField,
    updateFeatureDetailFilter,
    updateFeatureFilter,
  } = filterController;
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement | null>(null);
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
    setBulkCopyFeatures,
    setBulkCorsDeleteIds,
    setBulkCorsDeleteTypes,
    setBulkCorsRuleText,
    setBulkCorsUpdateOnlyExisting,
    setBulkLifecycleDeleteIds,
    setBulkLifecycleDeleteTypes,
    setBulkLifecycleRuleText,
    setBulkLifecycleUpdateOnlyExisting,
    setBulkNotificationDeleteIds,
    setBulkNotificationDeleteTypes,
    setBulkNotificationText,
    setBulkOperation,
    setBulkPasteMapping,
    setBulkPolicyDeleteIds,
    setBulkPolicyDeleteTypes,
    setBulkPolicyText,
    setBulkPolicyUpdateOnlyExisting,
    setBulkPublicAccessBlockTargets,
    setBulkQuotaApplyObjects,
    setBulkQuotaApplySize,
    setBulkQuotaObjects,
    setBulkQuotaSizeUnit,
    setBulkQuotaSizeValue,
    setBulkQuotaSkipConfigured,
  } = useBucketOpsBulkForm();
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

  useEffect(() => {
    if (!showColumnPicker) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!columnPickerRef.current) return;
      if (!columnPickerRef.current.contains(target)) {
        setShowColumnPicker(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [showColumnPicker]);

  const featureColumnOptions = useMemo(
    () => featureStateOptions.filter((option) => option.supported).map((option) => ({ ...option, key: option.id })),
    [featureStateOptions]
  );
  const featureDetailColumnsByFeature = useMemo(() => {
    const supported = new Set(featureColumnOptions.map((option) => option.id));
    const groups: Partial<Record<FeatureKey, FeatureDetailColumnOption[]>> = {};
    FEATURE_DETAIL_COLUMN_OPTIONS.forEach((option) => {
      if (!supported.has(option.feature)) return;
      const current = groups[option.feature] ?? [];
      groups[option.feature] = [...current, option];
    });
    return groups;
  }, [featureColumnOptions]);
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

  const bulkClipboardSourceBuckets = useMemo(
    () => (bulkConfigClipboard ? bulkConfigClipboard.buckets.map((bucket) => bucket.name) : []),
    [bulkConfigClipboard]
  );
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
  const columnsCustomized = useMemo(() => {
    if (visibleColumns.length !== defaultVisibleColumns.length) return true;
    const current = new Set(visibleColumns);
    return defaultVisibleColumns.some((column) => !current.has(column));
  }, [defaultVisibleColumns, visibleColumns]);
  const availableTagFilters = useMemo(() => {
    const selected = new Set(tagFilters);
    return availableUiTags.filter((tag) => !selected.has(tag.id));
  }, [availableUiTags, tagFilters]);
  const showTagFilterBar = availableUiTags.length > 0 || tagFilters.length > 0;
  const modeToggleBaseClass =
    "absolute right-1 top-1 rounded border px-1 py-0 ui-caption font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-0";
  const modeToggleClass = (mode: TextMatchMode, isPending: boolean, locked: boolean = false) => {
    if (locked) {
      return `${modeToggleBaseClass} cursor-not-allowed border-primary-400 bg-primary-100 text-primary-700 opacity-80 dark:border-primary-400/60 dark:bg-primary-500/20 dark:text-primary-100`;
    }
    if (isPending) {
      return `${modeToggleBaseClass} border-amber-400 bg-amber-100 text-amber-700 focus:ring-amber-300 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200`;
    }
    if (mode === "exact") {
      return `${modeToggleBaseClass} border-primary-400 bg-primary-100 text-primary-700 focus:ring-primary/35 dark:border-primary-400/60 dark:bg-primary-500/20 dark:text-primary-100`;
    }
    return `${modeToggleBaseClass} border-slate-200 bg-white text-slate-500 hover:border-primary hover:text-primary focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100`;
  };
  const renderAdvancedFilterSecondarySection = ({
    id,
    title,
    costLevel,
    costTooltip,
    activeCount,
    badge,
    children,
  }: {
    id: AdvancedFilterSecondarySectionId;
    title: string;
    costLevel: FilterCostLevel;
    costTooltip: string;
    activeCount: number;
    badge?: ReactNode;
    children: ReactNode;
  }) => {
    const open = advancedFilterSecondarySections[id];
    const contentId = `advanced-filter-${id}-content`;
    return (
      <section className={advancedFilterAccordionClass}>
        <button
          type="button"
          onClick={() => toggleAdvancedFilterSecondarySection(id)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:hover:bg-neutral-800/70"
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <ChevronDownIcon
              className={cx(
                "h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-slate-400",
                open ? "" : "-rotate-90"
              )}
            />
            <span className="inline-flex min-w-0 items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <span className="truncate">{title}</span>
              {renderFilterCostIndicator(costLevel, costTooltip)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {badge}
            <span className="ui-caption text-slate-500 dark:text-slate-400">
              {activeCount} active
            </span>
          </span>
        </button>
        {open && (
          <div id={contentId} className="px-3 pb-3">
            {children}
          </div>
        )}
      </section>
    );
  };
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
  const previewStats = useMemo(() => summarizeBulkPreview(bulkPreview), [bulkPreview]);
  const bulkCopyProgressPercent = calculateActionProgressPercent(bulkCopyProgress);
  const bulkPreviewProgressPercent = calculateActionProgressPercent(bulkPreviewProgress);
  const bulkApplyProgressPercent = calculateActionProgressPercent(bulkApplyProgress);
  const hasDeleteCriteria =
    bulkLifecycleDeleteIds.trim().length > 0 || Object.values(bulkLifecycleDeleteTypes).some(Boolean);
  const hasNotificationDeleteCriteria =
    bulkNotificationDeleteIds.trim().length > 0 || Object.values(bulkNotificationDeleteTypes).some(Boolean);
  const hasCorsDeleteCriteria =
    bulkCorsDeleteIds.trim().length > 0 || Object.values(bulkCorsDeleteTypes).some(Boolean);
  const hasPolicyDeleteCriteria =
    bulkPolicyDeleteIds.trim().length > 0 || Object.values(bulkPolicyDeleteTypes).some(Boolean);
  const hasPublicAccessBlockTargetCriteria = Object.values(bulkPublicAccessBlockTargets).some(Boolean);
  const hasSelectedCopyFeatures = useMemo(
    () => (Object.keys(bulkCopyFeatures) as BulkCopyFeatureKey[]).some((feature) => bulkCopyFeatures[feature]),
    [bulkCopyFeatures]
  );
  const bulkClipboardCopiedAtLabel = useMemo(() => {
    if (!bulkConfigClipboard) return null;
    const parsed = new Date(bulkConfigClipboard.copiedAt);
    if (Number.isNaN(parsed.getTime())) return bulkConfigClipboard.copiedAt;
    return parsed.toLocaleString();
  }, [bulkConfigClipboard]);
  const bulkClipboardFeatureLabels = useMemo(() => {
    if (!bulkConfigClipboard) return [];
    return (Object.keys(bulkConfigClipboard.features) as BulkCopyFeatureKey[])
      .filter((feature) => bulkConfigClipboard.features[feature])
      .map((feature) => BULK_COPY_FEATURE_LABELS[feature]);
  }, [bulkConfigClipboard]);

  const diffToneClasses = (tone?: BulkPreviewTone) => {
    if (tone === "added") {
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100";
    }
    if (tone === "removed") {
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100";
    }
    return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";
  };

  const renderPreviewLines = (lines: BulkPreviewLine[]) => (
    <div className="space-y-2">
      {lines.map((line, idx) => (
        <pre
          key={`${line.text}-${idx}`}
          className={`whitespace-pre-wrap break-words rounded-md border px-2 py-1 font-mono text-[11px] leading-relaxed ${diffToneClasses(
            line.tone
          )}`}
        >
          {line.text}
        </pre>
      ))}
    </div>
  );

  const bucketPreviewBadgeClasses = (item: BulkPreviewItem) => {
    if (item.error) {
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100";
    }
    if (item.changed) {
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100";
    }
    return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";
  };

  const sectionPreviewBadgeClasses = (changed: boolean) =>
    changed
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
      : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";

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

  type ColumnDef = {
    id: string;
    label: string;
    field?: SortField | null;
    align?: "left" | "right";
    expensive?: boolean;
    header?: ReactNode;
    headerClassName?: string;
    cellClassName?: string;
    render: (bucket: CephAdminBucket) => ReactNode;
  };

  const expensiveColumnClass = "bg-amber-50/60 dark:bg-amber-900/20";
  const defaultColumnMinWidthClass = "min-w-[9rem]";

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

  const bucketTableColumns: ColumnDef[] = (() => {
    const cols: ColumnDef[] = [
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
      {orphanedTagDetails.length > 0 && (
        <PageBanner tone="warning">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                UI tags exist for {orphanedTagDetails.length} bucket{orphanedTagDetails.length > 1 ? "s" : ""} no longer
                present on {orphanedTagDetails.length > 1 ? "their recorded endpoints" : "its recorded endpoint"}.
              </span>
              <button
                type="button"
                onClick={clearOrphanedTags}
                className="rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 ui-caption font-semibold text-amber-800 hover:border-amber-400 dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100"
              >
                Remove tags
              </button>
            </div>
            <details className="rounded-md border border-amber-300/70 bg-amber-50/70 px-2 py-1.5 dark:border-amber-700/50 dark:bg-amber-950/20">
              <summary className="list-none cursor-pointer ui-caption font-semibold text-amber-900 dark:text-amber-100 [&::-webkit-details-marker]:hidden">
                Show affected bucket/tag details
              </summary>
              <div className="mt-2 max-h-40 space-y-2 overflow-auto pr-1">
                {orphanedTagDetails.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-md border border-amber-200/80 bg-white/80 px-2 py-1.5 dark:border-amber-700/40 dark:bg-slate-900/50"
                  >
                    <p className="ui-caption font-semibold text-amber-900 dark:text-amber-100">
                      {item.name}
                      {item.tenant ? (
                        <span className="ml-1 font-normal text-amber-800/90 dark:text-amber-200/90">(tenant: {item.tenant})</span>
                      ) : null}
                      <span className="ml-1 font-normal text-amber-800/90 dark:text-amber-200/90">
                        (endpoint: {item.endpointId})
                      </span>
                    </p>
                    {item.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.tags.map((tag) => {
                          const colors = getTagColors(tag);
                          return (
                            <span
                              key={`${item.key}:${tag}`}
                              className="rounded-full border px-2 py-0.5 ui-caption font-semibold"
                              style={{ backgroundColor: colors.background, color: colors.text, borderColor: colors.border }}
                            >
                              {tag}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-1 ui-caption text-amber-800/90 dark:text-amber-200/90">No tag values found.</p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </div>
        </PageBanner>
      )}

      {!selectedEndpointId && shell.emptyState ? <PageEmptyState {...shell.emptyState} /> : null}
      <ListPageSection
          className="space-y-4"
          title="Buckets"
          description={shell.pageDescription}
          countLabel={`${total} result(s)`}
          search={
            <div className="relative w-full min-w-[16rem] sm:w-72">
              <textarea
                aria-label="Quick filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Bucket name(s)"
                rows={1}
                className={cx(
                  toolbarCompactInputClasses,
                  "min-h-[2rem] w-full resize-y pr-9",
                  quickFilterFieldState.fieldClass || "border-slate-200 dark:border-slate-700"
                )}
              />
              <button
                type="button"
                onClick={toggleQuickFilterMode}
                disabled={quickFilterDraftForcesExact}
                className={modeToggleClass(quickFilterModeForDisplay, quickFilterPending, quickFilterDraftForcesExact)}
                title={
                  quickFilterDraftForcesExact
                    ? "Quick filter mode: exact (locked by list input)"
                    : `Quick filter mode: ${quickFilterModeForDisplay === "contains" ? "contains" : "exact"}`
                }
                aria-label="Toggle quick filter match mode"
              >
                {quickFilterModeForDisplay === "contains" ? "~" : "="}
              </button>
            </div>
          }
          filters={
            <>
              {showTagFilterBar ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {tagFilters.map((tagId) => {
                      const tag = availableUiTags.find((item) => item.id === tagId);
                      if (!tag) return null;
                      return (
                        <UiTagBadge
                          key={`filter:${tag.id}`}
                          label={tag.label}
                          colorKey={tag.color_key}
                          visibility={tag.visibility}
                          selectionState="selected"
                          className="text-xs"
                          ariaLabel={`Selected UI tag filter ${tag.label}, ${tag.visibility === "shared" ? "Shared" : "Private"}`}
                          title={`Selected UI tag filter: ${tag.label}, ${tag.visibility === "shared" ? "Shared" : "Private"}`}
                          onRemove={() => removeTagFilter(tag.id)}
                          removeAriaLabel={`Remove UI tag filter ${tag.label}, ${tag.visibility === "shared" ? "Shared" : "Private"}`}
                        />
                      );
                    })}
                    {availableTagFilters.map((tag) => (
                      <UiTagBadge
                        key={`available:${tag.id}`}
                        label={tag.label}
                        colorKey={tag.color_key}
                        visibility={tag.visibility}
                        selectionState="available"
                        onClick={() => addTagFilter(tag.id)}
                        ariaLabel={`Add UI tag filter ${tag.label}, ${tag.visibility === "shared" ? "Shared" : "Private"}`}
                        title={`Available UI tag filter: ${tag.label}, ${tag.visibility === "shared" ? "Shared" : "Private"}. Click to add.`}
                      />
                    ))}
                  </div>
                  <select
                    value={tagFilterMode}
                    onChange={(e) => {
                      setTagFilterMode(e.target.value as "any" | "all");
                      setPage(1);
                    }}
                    className={cx(toolbarCompactSelectClasses, "w-auto px-2 py-1")}
                  >
                    <option value="any">OR</option>
                    <option value="all">AND</option>
                  </select>
                </div>
              ) : null}
              <button
                type="button"
                onClick={openAdvancedFilterDrawer}
                className={cx(
                  toolbarCompactButtonClasses,
                  showAdvancedFilter || advancedFiltersApplied
                    ? "border-primary/40 bg-primary-50 text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/10 dark:text-primary-100"
                    : ""
                )}
              >
                Advanced filter{advancedFiltersApplied ? " · Active" : ""}
              </button>
            </>
          }
          columns={
            <>
              <div className="relative" ref={columnPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowColumnPicker((prev) => !prev)}
                  className={toolbarCompactButtonClasses}
                >
                  Columns
                </button>
                {showColumnPicker && (
                  <div className={cx(uiMenuClass, "absolute right-0 z-30 mt-2 w-96 max-w-[calc(100vw-2rem)] p-3")}>
                    <ColumnVisibilityPicker
                      selectedCount={visibleColumns.length}
                      onReset={resetColumns}
                      coreGroups={[
                        {
                          id: "core",
                          label: "Core",
                          options: BUCKET_CORE_COLUMN_OPTIONS.filter((option) =>
                            isStorageOps
                              ? true
                              : option.id !== "context_name" && option.id !== "context_kind" && option.id !== "endpoint_name"
                          ).map((option) => ({
                            id: option.id,
                            label: option.label,
                            checked: visibleColumns.includes(option.id),
                            onToggle: () => toggleColumn(option.id),
                          })),
                        },
                      ]}
                      detailGroups={BUCKET_QUOTA_COLUMN_GROUPS.map((group) => ({
                        id: group.id,
                        label: group.label,
                        details: group.options.map((option) => ({
                          id: option.id,
                          label: option.label,
                          checked: visibleColumns.includes(option.id),
                          onToggle: () => toggleColumn(option.id),
                        })),
                      }))}
                      featureGroups={featureColumnOptions.map((option) => ({
                        id: option.id,
                        label: option.label,
                        checked: visibleColumns.includes(option.id),
                        onToggle: () => toggleColumn(option.id),
                        details: (featureDetailColumnsByFeature[option.id] ?? []).map((detail) => ({
                          id: detail.id,
                          label: detail.label,
                          checked: visibleColumns.includes(detail.id),
                          onToggle: () => toggleColumn(detail.id),
                        })),
                      }))}
                      footerNote="Feature checks and detail values are loaded only for enabled columns."
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={resetColumns}
                disabled={!columnsCustomized}
                className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
                  columnsCustomized
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                    : "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                }`}
              >
                Reset Columns
              </button>
            </>
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
              {showAdvancedFilter && (
                <div className={advancedFilterRootClass}>
                  <button
                    type="button"
                    onClick={advancedFilterCloseGuard.requestClose}
                    className={advancedFilterBackdropClass}
                    aria-label="Close advanced filter drawer"
                  />
                  <div className={advancedFilterDrawerClass}>
                    <div className={advancedFilterHeaderClass}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Advanced filter</p>
                          <p className="ui-caption text-slate-500 dark:text-slate-400">Buckets listing</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {renderAdvancedFilterRuleCountBadge(advancedDraftActiveCount)}
                            {renderAdvancedFilterCostBadge(advancedDraftGlobalCostLevel, advancedDraftGlobalCostTooltip)}
                            <span className={advancedFilterSyncBadgeClass(hasPendingAdvancedChanges)}>
                              {formatAdvancedFilterSyncLabel(hasPendingAdvancedChanges)}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={advancedFilterCloseGuard.requestClose}
                          className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "rounded-md px-2.5 py-1.5 ui-caption")}
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className={advancedFilterBodyClass}>
                      <div className="space-y-4">
                        {renderAdvancedFilterDraftSummary(advancedDraftSummaryItems)}

                        <section className={advancedFilterSectionClass}>
                          <div className="mb-3 flex items-center justify-between">
                            <p className="inline-flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <span>Identity and tags</span>
                            </p>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            {isStorageOps && (
                              <BucketOpsStorageScopeFilterFields
                                contextDraftIds={contextDraftIds}
                                contextFieldState={contextFieldState}
                                controller={storageScopeFilterController}
                                endpointDraftNames={endpointDraftNames}
                                endpointFieldState={endpointFieldState}
                              />
                            )}

                            <BucketOpsIdentityFilterFields
                              advancedDraft={advancedDraft}
                              controller={filterController}
                            />

                          </div>
                        </section>

                        {renderAdvancedFilterSecondarySection({
                          id: "metrics",
                          title: "Storage Metrics and Quota",
                          costLevel: "medium",
                          costTooltip:
                            "Medium cost: owner quota filters require owner metadata lookups; usage and percentage filters also require bucket stats.",
                          activeCount: advancedDraftRangeCount,
                          badge: !usageFeatureEnabled ? (
                            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 ui-caption font-semibold text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-200">
                              {usageUnavailableBadge}
                            </span>
                          ) : null,
                          children: (
                            <BucketOpsMetricFilterFields
                              advancedApplied={advancedApplied}
                              advancedDraft={advancedDraft}
                              onFieldChange={updateAdvancedField}
                              usageFeatureEnabled={usageFeatureEnabled}
                              usageUnavailableDescription={usageUnavailableDescription}
                            />
                          ),
                        })}

                        {renderAdvancedFilterSecondarySection({
                          id: "featureStates",
                          title: "Feature states",
                          costLevel: "high",
                          costTooltip: "High cost: feature-state filters may trigger extra checks.",
                          activeCount: advancedDraftFeatureCount,
                          children: (
                            <BucketOpsFeatureStateFilterFields
                              advancedApplied={advancedApplied}
                              advancedDraft={advancedDraft}
                              featureStateOptions={featureStateOptions}
                              onFeatureChange={updateFeatureFilter}
                            />
                          ),
                        })}

                        {renderAdvancedFilterSecondarySection({
                          id: "featureDetails",
                          title: "Feature details",
                          costLevel: "high",
                          costTooltip: "High cost: feature-detail filters may trigger additional per-bucket data retrieval.",
                          activeCount: advancedDraftFeatureDetailCount,
                          children: (
                            <BucketOpsFeatureDetailFilterFields
                              filters={advancedDraft.featureDetails}
                              onFieldChange={updateFeatureDetailFilter}
                              sseFeatureEnabled={sseFeatureEnabled}
                            />
                          ),
                        })}
                      </div>
                    </div>

                    <div className={advancedFilterFooterClass}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          {hasPendingAdvancedChanges
                            ? "Draft has unapplied changes."
                            : advancedDraftActiveCount > 0
                              ? "Draft matches applied filters."
                              : "No advanced filter configured."}
                        </p>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <UiButton
                            type="button"
                            onClick={resetAdvancedFilter}
                            disabled={!hasAnyAdvancedToClear}
                            variant="secondary"
                            size="sm"
                          >
                            Clear
                          </UiButton>
                          <UiButton
                            type="button"
                            onClick={advancedFilterCloseGuard.requestClose}
                            variant="secondary"
                            size="sm"
                          >
                            Close
                          </UiButton>
                          <UiButton
                            type="button"
                            onClick={applyAdvancedFilter}
                            disabled={!hasPendingAdvancedChanges}
                            variant="primary"
                            size="sm"
                          >
                            Apply filters
                          </UiButton>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

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

        <div className={showAdvancedFilter ? "overflow-x-hidden" : "overflow-x-auto"}>
          <table className="manager-table !table-auto !w-max min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {bucketTableColumns.map((col) => {
                  const detailLoadingClass = loadingDetails && detailLoadingColumnIds.has(col.id) ? "animate-pulse" : "";
                  const minWidthClass =
                    col.id !== "select" && !col.headerClassName ? defaultColumnMinWidthClass : "";
                  const stickyHeaderClass =
                    col.id === "select"
                      ? "sticky left-0 z-40 bg-slate-100 dark:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),10px_0_14px_-12px_rgba(15,23,42,0.4)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),10px_0_14px_-12px_rgba(2,6,23,0.85)]"
                      : col.id === "name"
                        ? "sticky left-10 z-30 bg-slate-100 dark:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),12px_0_16px_-12px_rgba(15,23,42,0.45)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),12px_0_16px_-12px_rgba(2,6,23,0.85)]"
                        : "";
                  const headerClass = `${minWidthClass} ${col.headerClassName ?? ""} ${col.expensive ? expensiveColumnClass : ""} ${detailLoadingClass} ${stickyHeaderClass}`;
                  if (col.header || !col.field) {
                    return (
                    <th
                      key={col.id}
                      className={`py-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                        col.align === "right" ? "text-right" : "text-left"
                      } ${col.id === "select" ? "w-10 px-3" : "px-6"} ${headerClass}`}
                    >
                      <div className="flex items-start">{col.header ?? col.label}</div>
                    </th>
                    );
                  }
                  return (
                    <SortableHeader
                      key={col.id}
                      label={col.label}
                      field={col.field}
                      activeField={sort.field}
                      direction={sort.direction}
                      align={col.align ?? (col.label === "Actions" ? "right" : "left")}
                      className={headerClass}
                      onSort={
                        col.field && (usageFeatureEnabled || !isStatsSortField(col.field as SortField))
                          ? (field) => toggleSort(field as SortField)
                          : undefined
                      }
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tableStatus === "loading" && <TableEmptyState colSpan={bucketTableColumns.length} message="Loading buckets..." />}
              {tableStatus === "error" && (
                <TableEmptyState colSpan={bucketTableColumns.length} message="Unable to load buckets." tone="error" />
              )}
              {tableStatus === "empty" && <TableEmptyState colSpan={bucketTableColumns.length} message="No buckets." />}
              {items.map((bucket) => (
                  <tr key={`${bucket.tenant ?? ""}:${bucket.name}`} className="group hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    {bucketTableColumns.map((col) => {
                      const align = col.align ?? (col.id === "actions" ? "right" : "left");
                      const cellBase =
                        align === "right"
                          ? "px-6 py-4 text-right"
                          : col.id === "select"
                            ? "w-10 px-3 py-4"
                            : "px-6 py-4";
                      const isSelect = col.id === "select";
                      const textClass =
                        isSelect
                          ? ""
                          : col.id === "name"
                          ? "manager-table-cell ui-body font-semibold text-slate-900 dark:text-slate-100"
                          : "ui-body text-slate-600 dark:text-slate-300";
                      const isDetailLoadingColumn = loadingDetails && detailLoadingColumnIds.has(col.id);
                      const detailLoadingCellClass = isDetailLoadingColumn
                        ? col.expensive
                          ? "animate-pulse bg-amber-100/70 dark:bg-amber-900/30"
                          : "animate-pulse bg-slate-100/70 dark:bg-slate-800/60"
                        : "";
                      const stickyCellClass =
                        col.id === "select"
                          ? "sticky left-0 z-20 bg-white dark:bg-slate-900 group-hover:bg-slate-100 dark:group-hover:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),10px_0_14px_-12px_rgba(15,23,42,0.4)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),10px_0_14px_-12px_rgba(2,6,23,0.85)]"
                          : col.id === "name"
                            ? "sticky left-10 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-100 dark:group-hover:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),12px_0_16px_-12px_rgba(15,23,42,0.45)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),12px_0_16px_-12px_rgba(2,6,23,0.85)]"
                            : "";
                      return (
                        <td
                          key={`${bucket.name}:${col.id}`}
                          className={`${cellBase} ${textClass} ${col.cellClassName ?? ""} ${col.expensive ? expensiveColumnClass : ""} ${detailLoadingCellClass} ${stickyCellClass}`}
                        >
                          {col.render(bucket)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

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
      {!isStorageOps && showIntegrityModal && selectedEndpointId && selectedOperationTargets.length > 0 && (
        <BucketIntegrityCheckModal
          mode="ceph-admin"
          endpointId={selectedEndpointId}
          endpointName={selectedEndpoint?.name}
          targets={selectedOperationTargets}
          onClose={() => setShowIntegrityModal(false)}
        />
      )}
      {isStorageOps && showIntegrityModal && selectedOperationTargets.length > 0 && (
        <BucketIntegrityCheckModal
          mode="storage-ops"
          targets={selectedOperationTargets}
          onClose={() => setShowIntegrityModal(false)}
        />
      )}
      {!isStorageOps && showPurgeModal && selectedEndpointId && selectedOperationTargets.length > 0 && (
        <BucketPurgeRunModal
          mode="ceph-admin"
          endpointId={selectedEndpointId}
          endpointName={selectedEndpoint?.name}
          targets={selectedOperationTargets}
          onClose={() => setShowPurgeModal(false)}
        />
      )}
      {isStorageOps && showPurgeModal && selectedOperationTargets.length > 0 && (
        <BucketPurgeRunModal
          mode="storage-ops"
          targets={selectedOperationTargets}
          onClose={() => setShowPurgeModal(false)}
        />
      )}
      {!isStorageOps && showUsageStatsModal && selectedEndpointId && selectedOperationTargets.length > 0 && (
        <BucketUsageStatsRunModal
          mode="ceph-admin"
          endpointId={selectedEndpointId}
          endpointName={selectedEndpoint?.name}
          targets={selectedOperationTargets}
          onClose={() => setShowUsageStatsModal(false)}
        />
      )}
      {isStorageOps && showUsageStatsModal && selectedOperationTargets.length > 0 && (
        <BucketUsageStatsRunModal
          mode="storage-ops"
          targets={selectedOperationTargets}
          onClose={() => setShowUsageStatsModal(false)}
        />
      )}
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
            <p className="ui-body text-slate-700 dark:text-slate-200">
              Apply configuration to{" "}
              <span className="font-semibold">
                {selectedCount} bucket{selectedCount > 1 ? "s" : ""}
              </span>
              .
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Operation
                </label>
                <select
                  value={bulkOperation}
                  onChange={(e) => setBulkOperation(e.target.value as BulkOperation)}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Select an S3 API operation</option>
                  <optgroup label="Configuration transfer">
                    <option value="copy_configs">Copy configurations</option>
                    <option value="paste_configs" disabled={!bulkConfigClipboard}>
                      {bulkConfigClipboard ? "Paste copied configurations" : "Paste copied configurations (nothing copied)"}
                    </option>
                  </optgroup>
                  <optgroup label="Access and quota">
                    {!isStorageOps && (
                      <option value="set_quota" disabled={Boolean(quotaOperationDisabledReason)}>
                        {quotaOperationDisabledReason
                          ? `Set bucket quota (${quotaOperationDisabledReason})`
                          : "Set bucket quota"}
                      </option>
                    )}
                    <option value="add_public_access_block">Add block public access</option>
                    <option value="remove_public_access_block">Remove block public access</option>
                  </optgroup>
                  <optgroup label="Versioning">
                    <option value="enable_versioning">Enable versioning</option>
                    <option value="disable_versioning">Disable versioning</option>
                  </optgroup>
                  <optgroup label="Rules and policies">
                    <option value="add_lifecycle">Add or update lifecycle rules</option>
                    <option value="delete_lifecycle">Delete lifecycle rules</option>
                    <option value="add_notifications" disabled={!snsFeatureEnabled}>
                      {snsFeatureEnabled
                        ? "Add or update notification configurations"
                        : "Add or update notification configurations (SNS unavailable)"}
                    </option>
                    <option value="delete_notifications" disabled={!snsFeatureEnabled}>
                      {snsFeatureEnabled
                        ? "Delete notification configurations"
                        : "Delete notification configurations (SNS unavailable)"}
                    </option>
                    <option value="add_cors">Add or update CORS rules</option>
                    <option value="delete_cors">Delete CORS rules</option>
                    <option value="add_policy">Add or update policy statements</option>
                    <option value="delete_policy">Delete policy statements</option>
                  </optgroup>
                </select>
              </div>
            </div>
            {bulkOperation === "copy_configs" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Configurations to copy
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(Object.keys(BULK_COPY_FEATURE_LABELS) as BulkCopyFeatureKey[])
                      .filter((feature) => !isStorageOps || feature !== "quota")
                      .map((feature) => (
                      <UiCheckboxField
                        key={feature}
                        checked={bulkCopyFeatures[feature]}
                        onChange={(event) =>
                          setBulkCopyFeatures((prev) => ({ ...prev, [feature]: event.target.checked }))
                        }
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        {BULK_COPY_FEATURE_LABELS[feature]}
                      </UiCheckboxField>
                      ))}
                  </div>
                </div>
                {bulkConfigClipboard && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                    <p className="ui-caption text-slate-600 dark:text-slate-300">
                      Clipboard currently contains config from{" "}
                      <span className="font-semibold">{bulkConfigClipboard.buckets.length}</span> bucket
                      {bulkConfigClipboard.buckets.length > 1 ? "s" : ""} on{" "}
                      <span className="font-semibold">
                        {bulkConfigClipboard.sourceEndpointName ?? `${scopeDisplayName} #${bulkConfigClipboard.sourceEndpointId}`}
                      </span>
                      {bulkClipboardCopiedAtLabel ? ` (copied ${bulkClipboardCopiedAtLabel})` : ""}.
                    </p>
                    {bulkClipboardFeatureLabels.length > 0 && (
                      <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                        Features: {bulkClipboardFeatureLabels.join(", ")}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {bulkOperation === "paste_configs" && (
              <div className="space-y-4">
                {!bulkConfigClipboard ? (
                  <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                    No copied configuration available. Use "Copy configs" first.
                  </p>
                ) : (
                  <>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                      <p className="ui-caption text-slate-700 dark:text-slate-200">
                        Source:{" "}
                        <span className="font-semibold">
                          {bulkConfigClipboard.sourceEndpointName ?? `${scopeDisplayName} #${bulkConfigClipboard.sourceEndpointId}`}
                        </span>{" "}
                        · {bulkConfigClipboard.buckets.length} bucket{bulkConfigClipboard.buckets.length > 1 ? "s" : ""} ·
                        {bulkClipboardCopiedAtLabel ? ` copied ${bulkClipboardCopiedAtLabel}` : " copied recently"}
                      </p>
                      <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                        Destination selection: {selectedBucketList.length} bucket{selectedBucketList.length > 1 ? "s" : ""}.
                      </p>
                      {bulkClipboardFeatureLabels.length > 0 && (
                        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                          Pasted features: {bulkClipboardFeatureLabels.join(", ")}.
                        </p>
                      )}
                    </div>
                    {bulkPastePlan.mode === "one_to_many" && (
                      <div className="space-y-1 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                        <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                          Proposed mapping: 1 source to all selected destinations.
                        </p>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Source bucket:{" "}
                          <span className="font-semibold">{bulkConfigClipboard.buckets[0]?.name ?? "-"}</span>
                        </p>
                      </div>
                    )}
                    {bulkPastePlan.mode === "one_to_one" && (
                      <div className="space-y-2">
                        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Proposed mapping (1:1)
                        </p>
                        <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                          <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                            <thead className="bg-slate-100 dark:bg-slate-900/60">
                              <tr>
                                <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Source bucket
                                </th>
                                <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Destination bucket
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                              {bulkClipboardSourceBuckets.map((sourceBucket) => {
                                const usedByOther = new Set(
                                  Object.entries(bulkPasteMapping)
                                    .filter(([otherSource, destination]) => otherSource !== sourceBucket && destination.trim())
                                    .map(([, destination]) => normalizeBucketName(destination))
                                );
                                return (
                                  <tr key={sourceBucket}>
                                    <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{sourceBucket}</td>
                                    <td className="px-3 py-2">
                                      <select
                                        value={bulkPasteMapping[sourceBucket] ?? ""}
                                        onChange={(event) =>
                                          setBulkPasteMapping((prev) => ({ ...prev, [sourceBucket]: event.target.value }))
                                        }
                                        className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      >
                                        <option value="">Select destination bucket</option>
                                        {selectedBucketList.map((destinationBucket) => {
                                          const normalizedDestination = normalizeBucketName(destinationBucket);
                                          const isUsed = usedByOther.has(normalizedDestination);
                                          const isSameBucketConflict =
                                            bulkClipboardSameEndpoint &&
                                            normalizeBucketName(sourceBucket) === normalizedDestination;
                                          return (
                                            <option
                                              key={`${sourceBucket}-${destinationBucket}`}
                                              value={destinationBucket}
                                              disabled={isUsed || isSameBucketConflict}
                                            >
                                              {destinationBucket}
                                              {isSameBucketConflict ? " (same bucket not allowed)" : isUsed ? " (already used)" : ""}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {!bulkPastePlan.mode && (
                      <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                        Mapping impossible with current source/destination selections.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            {bulkOperation === "set_quota" && (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <UiCheckboxField
                    checked={bulkQuotaApplySize}
                    onChange={(event) => setBulkQuotaApplySize(event.target.checked)}
                    className="ui-caption text-slate-600 dark:text-slate-300"
                  >
                    Update storage quota
                  </UiCheckboxField>
                  <UiCheckboxField
                    checked={bulkQuotaApplyObjects}
                    onChange={(event) => setBulkQuotaApplyObjects(event.target.checked)}
                    className="ui-caption text-slate-600 dark:text-slate-300"
                  >
                    Update object quota
                  </UiCheckboxField>
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                  <div className="space-y-1">
                    <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Storage quota
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={bulkQuotaSizeValue}
                      onChange={(event) => setBulkQuotaSizeValue(event.target.value)}
                      placeholder="Leave empty to clear"
                      disabled={!bulkQuotaApplySize}
                      className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Unit
                    </label>
                    <select
                      value={bulkQuotaSizeUnit}
                      onChange={(event) => setBulkQuotaSizeUnit(event.target.value as QuotaSizeUnit)}
                      disabled={!bulkQuotaApplySize}
                      className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="MiB">MiB</option>
                      <option value="GiB">GiB</option>
                      <option value="TiB">TiB</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Object quota
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={bulkQuotaObjects}
                    onChange={(event) => setBulkQuotaObjects(event.target.value)}
                    placeholder="Leave empty to clear"
                    disabled={!bulkQuotaApplyObjects}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <UiCheckboxField
                  checked={bulkQuotaSkipConfigured}
                  onChange={(event) => setBulkQuotaSkipConfigured(event.target.checked)}
                  className="ui-caption text-slate-600 dark:text-slate-300"
                >
                  Do not change buckets that already have a quota.
                </UiCheckboxField>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Leave both fields empty to remove quotas from the selected buckets.
                </p>
              </div>
            )}
            {(bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") && (
              <div className="space-y-3">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Options to {bulkOperation === "add_public_access_block" ? "block" : "unblock"}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PUBLIC_ACCESS_BLOCK_OPTIONS.map((option) => (
                    <UiCheckboxField
                      key={option.key}
                      checked={bulkPublicAccessBlockTargets[option.key]}
                      onChange={(event) =>
                        setBulkPublicAccessBlockTargets((prev) => ({ ...prev, [option.key]: event.target.checked }))
                      }
                      className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                    >
                      {option.label}
                    </UiCheckboxField>
                  ))}
                </div>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Only selected options are updated. Unselected options remain unchanged.
                </p>
              </div>
            )}
            {bulkOperation === "add_lifecycle" && (
              <div className="space-y-2">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Lifecycle rules (JSON)
                </label>
                <textarea
                  value={bulkLifecycleRuleText}
                  onChange={(event) => setBulkLifecycleRuleText(event.target.value)}
                  rows={8}
                  placeholder='{"ID":"rule-1","Status":"Enabled","Filter":{"Prefix":"logs/"}}'
                  className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Provide a JSON object or array. Rules will be appended, or will replace existing rules with the same ID.
                </p>
                <UiCheckboxField
                  checked={bulkLifecycleUpdateOnlyExisting}
                  onChange={(event) => setBulkLifecycleUpdateOnlyExisting(event.target.checked)}
                  className="ui-caption text-slate-600 dark:text-slate-300"
                >
                  Only update rules that already exist (do not add new rules).
                </UiCheckboxField>
              </div>
            )}
            {bulkOperation === "delete_lifecycle" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Rule IDs (comma, newline, or JSON array)
                  </label>
                  <textarea
                    value={bulkLifecycleDeleteIds}
                    onChange={(event) => setBulkLifecycleDeleteIds(event.target.value)}
                    rows={4}
                    placeholder='rule-1, rule-2 or ["rule-1","rule-2"]'
                    className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Rule types
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {LIFECYCLE_TYPE_OPTIONS.map((option) => (
                      <UiCheckboxField
                        key={option.key}
                        checked={bulkLifecycleDeleteTypes[option.key]}
                        onChange={(event) =>
                          setBulkLifecycleDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                        }
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        {option.label}
                      </UiCheckboxField>
                    ))}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Rules are deleted if the ID matches or if any selected type is present in the rule.
                  </p>
                </div>
              </div>
            )}
            {bulkOperation === "add_notifications" && (
              <div className="space-y-2">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Notification configuration (JSON)
                </label>
                <textarea
                  value={bulkNotificationText}
                  onChange={(event) => setBulkNotificationText(event.target.value)}
                  rows={8}
                  placeholder={`{"${NOTIFICATION_CONFIGURATION_ARRAY_KEYS.topic}":[{"Id":"topic-created","TopicArn":"arn:aws:sns:default:ACCOUNT:topic","Events":["s3:ObjectCreated:*"]}],"${NOTIFICATION_EVENTBRIDGE_KEY}":{}}`}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Provide a bucket notification configuration object. Entries replace existing entries with the same ID;
                  anonymous entries are appended when they are not already present.
                </p>
              </div>
            )}
            {bulkOperation === "delete_notifications" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Notification IDs (comma, newline, or JSON array)
                  </label>
                  <textarea
                    value={bulkNotificationDeleteIds}
                    onChange={(event) => setBulkNotificationDeleteIds(event.target.value)}
                    rows={4}
                    placeholder='topic-created, queue-created or ["topic-created","queue-created"]'
                    className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Notification types
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {NOTIFICATION_TYPE_OPTIONS.map((option) => (
                      <UiCheckboxField
                        key={option.key}
                        checked={bulkNotificationDeleteTypes[option.key]}
                        onChange={(event) =>
                          setBulkNotificationDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                        }
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        {option.label}
                      </UiCheckboxField>
                    ))}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Entries are deleted if the ID matches or if their notification type is selected.
                  </p>
                </div>
              </div>
            )}
            {bulkOperation === "add_cors" && (
              <div className="space-y-2">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  CORS rules (JSON)
                </label>
                <textarea
                  value={bulkCorsRuleText}
                  onChange={(event) => setBulkCorsRuleText(event.target.value)}
                  rows={8}
                  placeholder='{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"]}'
                  className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Provide a JSON object or array. Rules are merged by rule ID (if present) or by AllowedOrigins +
                  AllowedMethods.
                </p>
                <UiCheckboxField
                  checked={bulkCorsUpdateOnlyExisting}
                  onChange={(event) => setBulkCorsUpdateOnlyExisting(event.target.checked)}
                  className="ui-caption text-slate-600 dark:text-slate-300"
                >
                  Only update rules that already exist (do not add new rules).
                </UiCheckboxField>
              </div>
            )}
            {bulkOperation === "delete_cors" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Rule IDs (comma, newline, or JSON array)
                  </label>
                  <textarea
                    value={bulkCorsDeleteIds}
                    onChange={(event) => setBulkCorsDeleteIds(event.target.value)}
                    rows={4}
                    placeholder='rule-1, rule-2 or ["rule-1","rule-2"]'
                    className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Rule types
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CORS_TYPE_OPTIONS.map((option) => (
                      <UiCheckboxField
                        key={option.key}
                        checked={bulkCorsDeleteTypes[option.key]}
                        onChange={(event) =>
                          setBulkCorsDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                        }
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        {option.label}
                      </UiCheckboxField>
                    ))}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Rules are deleted if the ID matches or if any selected type is present in the rule.
                  </p>
                </div>
              </div>
            )}
            {bulkOperation === "add_policy" && (
              <div className="space-y-2">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Policy (JSON)
                </label>
                <textarea
                  value={bulkPolicyText}
                  onChange={(event) => setBulkPolicyText(event.target.value)}
                  rows={8}
                  placeholder='{"Version":"2012-10-17","Statement":[{"Sid":"AllowRead","Effect":"Allow","Action":["s3:GetObject"],"Resource":"*","Principal":"*"}]}'
                  className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Provide a policy object, a statement array, or a single statement. Statements are merged by Sid or by
                  Effect/Action/Principal/Resource.
                </p>
                <UiCheckboxField
                  checked={bulkPolicyUpdateOnlyExisting}
                  onChange={(event) => setBulkPolicyUpdateOnlyExisting(event.target.checked)}
                  className="ui-caption text-slate-600 dark:text-slate-300"
                >
                  Only update statements that already exist (do not add new statements).
                </UiCheckboxField>
              </div>
            )}
            {bulkOperation === "delete_policy" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Statement IDs (Sid) (comma, newline, or JSON array)
                  </label>
                  <textarea
                    value={bulkPolicyDeleteIds}
                    onChange={(event) => setBulkPolicyDeleteIds(event.target.value)}
                    rows={4}
                    placeholder='AllowRead, DenyWrite or ["AllowRead","DenyWrite"]'
                    className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Statement types
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {POLICY_TYPE_OPTIONS.map((option) => (
                      <UiCheckboxField
                        key={option.key}
                        checked={bulkPolicyDeleteTypes[option.key]}
                        onChange={(event) =>
                          setBulkPolicyDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                        }
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        {option.label}
                      </UiCheckboxField>
                    ))}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Statements are deleted if the Sid matches or if any selected type is present.
                  </p>
                </div>
              </div>
            )}
            {bulkOperation === "paste_configs" && bulkPastePlan.error && (
              <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{bulkPastePlan.error}</p>
            )}
            {bulkCopyError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{bulkCopyError}</p>}
            {bulkCopySummary && <p className="ui-caption font-semibold text-emerald-600 dark:text-emerald-200">{bulkCopySummary}</p>}
            {bulkPreviewError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{bulkPreviewError}</p>}
            {bulkApplyError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{bulkApplyError}</p>}
            {bulkApplySummary && <p className="ui-caption font-semibold text-emerald-600 dark:text-emerald-200">{bulkApplySummary}</p>}
            {bulkCopyLoading && bulkCopyProgress && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
                  <span>
                    {bulkCopyProgress.label} · {bulkCopyProgress.completed} / {bulkCopyProgress.total} buckets
                  </span>
                  <span>{bulkCopyProgressPercent}%</span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full bg-primary-500 transition-[width] duration-200" style={{ width: `${bulkCopyProgressPercent}%` }} />
                </div>
                {bulkCopyProgress.failed > 0 && (
                  <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                    Failures so far: {bulkCopyProgress.failed}
                  </p>
                )}
              </div>
            )}
            {bulkPreviewLoading && bulkPreviewProgress && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
                  <span>
                    {bulkPreviewProgress.label} · {bulkPreviewProgress.completed} / {bulkPreviewProgress.total} buckets
                  </span>
                  <span>{bulkPreviewProgressPercent}%</span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-primary-500 transition-[width] duration-200"
                    style={{ width: `${bulkPreviewProgressPercent}%` }}
                  />
                </div>
                {bulkPreviewProgress.failed > 0 && (
                  <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                    Failures so far: {bulkPreviewProgress.failed}
                  </p>
                )}
              </div>
            )}
            {bulkApplyLoading && bulkApplyProgress && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
                  <span>
                    {bulkApplyProgress.label} · {bulkApplyProgress.completed} / {bulkApplyProgress.total} buckets
                  </span>
                  <span>{bulkApplyProgressPercent}%</span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full bg-primary-500 transition-[width] duration-200" style={{ width: `${bulkApplyProgressPercent}%` }} />
                </div>
                {bulkApplyProgress.failed > 0 && (
                  <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                    Failures so far: {bulkApplyProgress.failed}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {bulkOperation === "copy_configs" ? (
                <button
                  type="button"
                  onClick={() => {
                    void copyBulkConfigs();
                  }}
                  disabled={bulkCopyLoading || !hasSelectedCopyFeatures}
                  className="rounded-md bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkCopyLoading ? "Copying..." : "Copy selected configs"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={runBulkPreview}
                    disabled={
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
                      (bulkOperation === "paste_configs" && Boolean(bulkPastePlan.error))
                    }
                    className="rounded-md bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {bulkPreviewLoading ? "Previewing..." : "Preview"}
                  </button>
                  <button
                    type="button"
                    onClick={exportBulkPreviewChanges}
                    disabled={bulkPreviewLoading || bulkPreview.length === 0}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
                  >
                    Export changes
                  </button>
                  {bulkPreviewReady && (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      Changes: {previewStats.changed} / Unchanged: {previewStats.unchanged} / Errors: {previewStats.errors}
                    </p>
                  )}
                </>
              )}
            </div>
            {bulkPreview.length > 0 && (
              <div className="max-h-[420px] space-y-2 overflow-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                {bulkPreview.map((item) => {
                  const sections = buildBulkPreviewSections(item, bulkOperation);
                  const changedSections = sections.filter((section) => section.changed).length;
                  return (
                    <UiDetails
                      key={item.bucket}
                      defaultOpen={Boolean(item.error || item.changed)}
                      className="rounded-lg border border-slate-200 dark:border-slate-800"
                    >
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{item.bucket}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${bucketPreviewBadgeClasses(item)}`}
                          >
                            {item.error ? "Error" : item.changed ? "Change" : "No change"}
                          </span>
                          <span className="ui-caption text-slate-500 dark:text-slate-400">
                            Changed sections {changedSections}/{sections.length}
                          </span>
                        </div>
                      </summary>
                      <div className="space-y-2 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                        {sections.map((section) => (
                          <UiDetails
                            key={`${item.bucket}:${section.key}`}
                            defaultOpen={Boolean(section.error || section.changed)}
                            className="rounded-md border border-slate-200 dark:border-slate-800"
                          >
                            <summary className="cursor-pointer list-none px-2.5 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{section.label}</span>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sectionPreviewBadgeClasses(
                                    section.changed
                                  )}`}
                                >
                                  {section.changed ? "Changed" : "Unchanged"}
                                </span>
                              </div>
                            </summary>
                            <div className="space-y-2 border-t border-slate-200 px-2.5 py-2 dark:border-slate-800">
                              {section.error ? (
                                <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{section.error}</p>
                              ) : (
                                <div className="grid gap-2 lg:grid-cols-2">
                                  <div className="space-y-1">
                                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                      Before
                                    </p>
                                    {renderPreviewLines(section.before)}
                                  </div>
                                  <div className="space-y-1">
                                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                      After
                                    </p>
                                    {renderPreviewLines(section.after)}
                                  </div>
                                </div>
                              )}
                            </div>
                          </UiDetails>
                        ))}
                      </div>
                    </UiDetails>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200"
                onClick={closeBulkUpdateModal}
              >
                Cancel
              </button>
              {bulkOperation !== "copy_configs" && (
                <button
                  type="button"
                  className="rounded-full bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={applyBulkUpdate}
                  disabled={!bulkPreviewReady || bulkApplyLoading || (bulkOperation === "set_quota" && Boolean(quotaOperationDisabledReason))}
                >
                  {bulkApplyLoading ? "Applying..." : "Apply changes"}
                </button>
              )}
            </div>
        </div>
      </BucketOpsBulkUpdatePage>
      {advancedFilterCloseGuard.confirmationDialog}
    </div>
  );
}

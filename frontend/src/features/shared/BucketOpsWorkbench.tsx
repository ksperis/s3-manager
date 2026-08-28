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
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { runWithConcurrencySettled } from "../../utils/concurrency";
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
import UiTagBadgeList from "../../components/UiTagBadgeList";
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
  BucketProperties,
  CephAdminBucket,
  type CephAdminBucketConfigBackupFeature,
} from "../../api/cephAdmin";
import {
  STORAGE_OPS_SCOPE_ID,
  type StorageOpsBucket,
} from "../../api/storageOps";
import { listExecutionContexts, type ExecutionContext } from "../../api/executionContexts";
import type { BucketIndexCheckTarget } from "../../api/bucketIndexCheck";
import type {
  BucketUiTagDefinition,
} from "../../api/bucketUiTags";
import { ChevronDownIcon, RefreshIcon } from "../browser/browserIcons";
import {
  deleteNotificationConfigurations,
  isNotificationConfigurationEmpty,
  mergeNotificationConfigurations,
  NOTIFICATION_CONFIGURATION_ARRAY_KEYS,
  NOTIFICATION_EVENTBRIDGE_KEY,
  parseCorsRules,
  parseLifecycleRules,
  parseNotificationConfiguration,
  parsePolicyStatements,
  parseRuleIds,
  stableStringify,
  type NotificationConfigurationTypeKey,
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
import BucketOpsRowActionsMenu from "./BucketOpsRowActionsMenu";
import BucketSelectionActionsBar from "./BucketSelectionActionsBar";
import BucketUiTagSettingsBadge from "./BucketUiTagSettingsBadge";
import ActionProgressCard from "./ActionProgressCard";
import { useBucketOpsListing } from "./useBucketOpsListing";
import { useBucketOpsRowTags } from "./useBucketOpsRowTags";
import { useBucketOpsTooltips } from "./useBucketOpsTooltips";
import { buildBucketOpsListingProjection } from "./bucketOpsListingProjection";
import { copyBucketOpsConfigs } from "./bucketOpsConfigCopy";
import {
  buildBucketExportColumns,
  buildBucketSelectionJsonPayload,
  serializeBucketSelectionCsv,
} from "./bucketOpsExportModel";
import { loadBucketOpsBucketsByNames } from "./bucketOpsNamedBucketLoader";
import { loadBucketOpsFilteredBuckets } from "./bucketOpsFilteredBucketLoader";
import { buildBucketOpsSelectionProjection } from "./bucketOpsSelectionModel";
import type { BucketUiTagDraft } from "./bucketOpsRowTagModel";
import { buildBucketOpsStorageScopeProjection } from "./bucketOpsStorageScopeProjection";
import { resolveBucketOpsApi } from "./bucketOpsApi";
import { resolveBucketOpsSurface, type BucketOpsMode } from "./bucketOpsSurface";
import {
  createBucketUiTagTarget,
  useBucketUiTags,
  type BucketUiTagTarget as BucketTagTarget,
} from "./bucketUiTags";
import { calculateActionProgressPercent, type ActionProgressState } from "./actionProgress";
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
  clearFeatureDetailField,
  type FeatureDetailFilterKey,
  type FeatureDetailFilters,
  type NumericComparisonOpUi,
} from "../cephAdmin/filtering/bucketAdvancedFilter";
import {
  advancedFilterAccordionClass,
  advancedFilterBackdropClass,
  advancedFilterBodyClass,
  advancedFilterControlClass,
  advancedFilterDrawerClass,
  advancedFilterFooterClass,
  advancedFilterFieldCardClass,
  advancedFilterHeaderClass,
  advancedFilterMatchModeButtonClass,
  formatAdvancedFilterSyncLabel,
  advancedFilterSyncBadgeClass,
  advancedFilterRootClass,
  advancedFilterSectionClass,
  parseExactListInput,
  renderAdvancedFilterCostBadge,
  renderAdvancedFilterDraftSummary,
  renderAdvancedFilterRuleCountBadge,
  renderAdvancedSearchProgress,
  renderFilterCostIndicator,
  type FilterCostLevel,
} from "../cephAdmin/filtering/advancedFilterShared";
import {
  BOOLEAN_FILTER_OPTIONS,
  FEATURE_LABELS,
  FEATURE_STATE_OPTIONS,
  NUMERIC_FILTER_OPTIONS,
  buildAdvancedFilterPayload,
  buildAdvancedFilterSecondarySectionState,
  defaultAdvancedFilter,
  hasAdvancedFilters,
  normalizeAdvancedSelectionValues,
  stripUnsupportedAdvancedFeatureFilters,
  type ActiveFilterRemoveAction,
  type AdvancedFilterSecondarySectionId,
  type AdvancedFilterSecondarySectionState,
  type AdvancedFilterState,
  type AdvancedTextOrNumericField,
  type BooleanFilterState,
  type FeatureFilterState,
  type FeatureKey,
  type OwnerNameScope,
  type TextMatchMode,
} from "./bucketOpsAdvancedFilterModel";
import {
  buildAdvancedFilterFieldState,
  buildBucketOpsAdvancedFilterUiProjection,
} from "./bucketOpsAdvancedFilterUiProjection";
import {
  BUCKET_CORE_COLUMN_OPTIONS,
  BUCKET_QUOTA_COLUMN_GROUPS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  FEATURE_DETAIL_COLUMN_OPTIONS,
  loadBucketListState,
  loadVisibleColumns,
  parseUiTags,
  persistBucketListState,
  persistVisibleColumns,
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
  formatCorsRule,
  formatLifecycleRule,
  formatNotificationConfiguration,
  formatPolicyRule,
  getCorsRuleKey,
  getCorsRuleTypes,
  getLifecycleRuleId,
  getLifecycleRuleTypes,
  getPolicyStatementSid,
  getPolicyStatementTypes,
  mergeCorsRules,
  mergeLifecycleRules,
  mergePolicyStatements,
  type CorsRuleTypeKey,
  type LifecycleRuleTypeKey,
  type PolicyRuleTypeKey,
} from "./bucketConfigMerge";
import {
  BULK_CONCURRENCY_LIMIT,
  BULK_COPY_FEATURE_LABELS,
  BUCKET_CONFIG_BACKUP_FEATURE_LABELS,
  DEFAULT_BULK_COPY_FEATURE_SELECTION,
  PUBLIC_ACCESS_BLOCK_OPTIONS,
  applyPublicAccessBlockTargets,
  bytesToGiB,
  formatObjectLockSnapshot,
  formatPublicAccessBlockFlag,
  formatPublicAccessBlockState,
  hasConfiguredQuota,
  isAccessLoggingSnapshotEqual,
  isObjectLockSnapshotEqual,
  isPublicAccessBlockEquivalent,
  loadBulkConfigClipboard,
  normalizeAccessLoggingSnapshot,
  normalizeObjectLockSnapshot,
  normalizePublicAccessBlockState,
  normalizeQuotaLimit,
  parseQuotaInput,
  persistBulkConfigClipboard,
  type BulkConfigClipboard,
  type BulkCopyFeatureKey,
  type BulkCopyFeatureSelection,
  type BulkOperation,
  type BulkPastePlanItem,
  type BulkPreviewItem,
  type BulkPreviewLine,
  type BulkPreviewTone,
  type ParsedQuotaInput,
  type PublicAccessBlockOptionKey,
  type QuotaSizeUnit,
  type SelectionExportFormat,
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
  formatBucketNamesPreview,
  formatOptionalBytes,
  formatOptionalCount,
  formatOwnerSuspended,
  formatQuotaBytes,
  formatQuotaObjects,
  formatQuotaUsageValue,
  formatVersioningStatus,
  getBucketDisplayName,
  getStorageOpsBucketName,
  getStorageOpsContextId,
  getTagColors,
  isBucketQuotaConfigured,
  isStatsSortField,
  normalizeBucketName,
  normalizeVersioningStatus,
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
  const initialStoredBucketListState = useMemo(
    () => loadBucketListState(bucketsStateStorageKey, selectedEndpointId),
    [bucketsStateStorageKey, selectedEndpointId]
  );
  const initialOwnerFilter = useMemo<AdvancedFilterState | null>(
    () =>
      ownerQueryFilter
        ? {
            ...defaultAdvancedFilter,
            owner: ownerQueryFilter,
            ownerMatchMode: "exact",
          }
        : null,
    [ownerQueryFilter]
  );
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
  const [filter, setFilter] = useState(() => (ownerQueryFilter ? "" : initialStoredBucketListState?.filter ?? ""));
  const [filterValue, setFilterValue] = useState(() =>
    ownerQueryFilter ? "" : initialStoredBucketListState?.filter.trim() ?? ""
  );
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>(() =>
    ownerQueryFilter ? "contains" : initialStoredBucketListState?.quickFilterMode ?? "contains"
  );
  const [page, setPage] = useState(() => (ownerQueryFilter ? 1 : initialStoredBucketListState?.page ?? 1));
  const [pageSize, setPageSize] = useState(() => initialStoredBucketListState?.pageSize ?? DEFAULT_PAGE_SIZE);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() =>
    loadVisibleColumns(columnsStorageKey, defaultVisibleColumns, isStorageOps)
  );
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement | null>(null);
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [advancedFilterSecondarySections, setAdvancedFilterSecondarySections] =
    useState<AdvancedFilterSecondarySectionState>(() => buildAdvancedFilterSecondarySectionState());
  const advancedFilterWasOpenRef = useRef(false);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedFilterState>(() =>
    initialOwnerFilter ?? initialStoredBucketListState?.advancedApplied ?? defaultAdvancedFilter
  );
  const [advancedApplied, setAdvancedApplied] = useState<AdvancedFilterState | null>(() =>
    initialOwnerFilter ?? initialStoredBucketListState?.advancedApplied ?? null
  );
  const [storageOpsContexts, setStorageOpsContexts] = useState<ExecutionContext[]>([]);
  const [storageOpsContextsLoading, setStorageOpsContextsLoading] = useState(false);
  const [storageOpsContextsError, setStorageOpsContextsError] = useState<string | null>(null);
  const [storageOpsContextFilter, setStorageOpsContextFilter] = useState("");
  const [storageOpsEndpointFilter, setStorageOpsEndpointFilter] = useState("");
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
  const [tagFilters, setTagFilters] = useState<number[]>(() =>
    ownerQueryFilter ? [] : initialStoredBucketListState?.tagFilters ?? []
  );
  const [tagFilterMode, setTagFilterMode] = useState<"any" | "all">(() =>
    ownerQueryFilter ? "any" : initialStoredBucketListState?.tagFilterMode ?? "any"
  );
  useEffect(() => {
    if (!uiTagsReady) return;
    const visibleIds = new Set(availableUiTags.map((tag) => tag.id));
    setTagFilters((current) => {
      const next = current.filter((tagId) => visibleIds.has(tagId));
      return next.length === current.length ? current : next;
    });
  }, [availableUiTags, uiTagsReady]);
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(
    () => new Set()
  );
  const [adminOpsAction, setAdminOpsAction] = useState<Extract<CephAdminAdminOpsAction, { bucket: CephAdminBucket }> | null>(null);
  const [allFilteredBucketNames, setAllFilteredBucketNames] = useState<string[] | null>(null);
  const [allFilteredBucketNamesKey, setAllFilteredBucketNamesKey] = useState<string | null>(null);
  const [selectAllProgress, setSelectAllProgress] = useState<ActionProgressState | null>(null);
  const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showIntegrityModal, setShowIntegrityModal] = useState(false);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [showUsageStatsModal, setShowUsageStatsModal] = useState(false);
  const [showConfigBackupModal, setShowConfigBackupModal] = useState(false);
  const [indexCheckTargets, setIndexCheckTargets] = useState<BucketIndexCheckTarget[] | null>(null);
  const [bulkOperation, setBulkOperation] = useState<BulkOperation>("");
  const [bulkConfigClipboard, setBulkConfigClipboard] = useState<BulkConfigClipboard | null>(() =>
    loadBulkConfigClipboard(bulkClipboardStorageKey)
  );
  const [bulkCopyFeatures, setBulkCopyFeatures] = useState<BulkCopyFeatureSelection>(DEFAULT_BULK_COPY_FEATURE_SELECTION);
  const [bulkCopyLoading, setBulkCopyLoading] = useState(false);
  const [bulkCopyProgress, setBulkCopyProgress] = useState<ActionProgressState | null>(null);
  const [bulkCopyError, setBulkCopyError] = useState<string | null>(null);
  const [bulkCopySummary, setBulkCopySummary] = useState<string | null>(null);
  const [bulkPasteMapping, setBulkPasteMapping] = useState<Record<string, string>>({});
  const [bulkQuotaSizeValue, setBulkQuotaSizeValue] = useState("");
  const [bulkQuotaSizeUnit, setBulkQuotaSizeUnit] = useState<QuotaSizeUnit>("GiB");
  const [bulkQuotaObjects, setBulkQuotaObjects] = useState("");
  const [bulkQuotaApplySize, setBulkQuotaApplySize] = useState(true);
  const [bulkQuotaApplyObjects, setBulkQuotaApplyObjects] = useState(true);
  const [bulkQuotaSkipConfigured, setBulkQuotaSkipConfigured] = useState(false);
  const [bulkPublicAccessBlockTargets, setBulkPublicAccessBlockTargets] = useState<
    Record<PublicAccessBlockOptionKey, boolean>
  >(() => ({
    block_public_acls: true,
    ignore_public_acls: true,
    block_public_policy: true,
    restrict_public_buckets: true,
  }));
  const [bulkLifecycleRuleText, setBulkLifecycleRuleText] = useState("");
  const [bulkLifecycleUpdateOnlyExisting, setBulkLifecycleUpdateOnlyExisting] = useState(false);
  const [bulkLifecycleDeleteIds, setBulkLifecycleDeleteIds] = useState("");
  const [bulkLifecycleDeleteTypes, setBulkLifecycleDeleteTypes] = useState<Record<LifecycleRuleTypeKey, boolean>>(() => {
    return LIFECYCLE_TYPE_OPTIONS.reduce(
      (acc, option) => ({ ...acc, [option.key]: false }),
      {} as Record<LifecycleRuleTypeKey, boolean>
    );
  });
  const [bulkNotificationText, setBulkNotificationText] = useState("");
  const [bulkNotificationDeleteIds, setBulkNotificationDeleteIds] = useState("");
  const [bulkNotificationDeleteTypes, setBulkNotificationDeleteTypes] = useState<
    Record<NotificationConfigurationTypeKey, boolean>
  >(() => {
    return NOTIFICATION_TYPE_OPTIONS.reduce(
      (acc, option) => ({ ...acc, [option.key]: false }),
      {} as Record<NotificationConfigurationTypeKey, boolean>
    );
  });
  const [bulkCorsRuleText, setBulkCorsRuleText] = useState("");
  const [bulkCorsUpdateOnlyExisting, setBulkCorsUpdateOnlyExisting] = useState(false);
  const [bulkCorsDeleteIds, setBulkCorsDeleteIds] = useState("");
  const [bulkCorsDeleteTypes, setBulkCorsDeleteTypes] = useState<Record<CorsRuleTypeKey, boolean>>(() => {
    return CORS_TYPE_OPTIONS.reduce(
      (acc, option) => ({ ...acc, [option.key]: false }),
      {} as Record<CorsRuleTypeKey, boolean>
    );
  });
  const [bulkPolicyText, setBulkPolicyText] = useState("");
  const [bulkPolicyUpdateOnlyExisting, setBulkPolicyUpdateOnlyExisting] = useState(false);
  const [bulkPolicyDeleteIds, setBulkPolicyDeleteIds] = useState("");
  const [bulkPolicyDeleteTypes, setBulkPolicyDeleteTypes] = useState<Record<PolicyRuleTypeKey, boolean>>(() => {
    return POLICY_TYPE_OPTIONS.reduce(
      (acc, option) => ({ ...acc, [option.key]: false }),
      {} as Record<PolicyRuleTypeKey, boolean>
    );
  });
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewItem[]>([]);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkPreviewProgress, setBulkPreviewProgress] = useState<ActionProgressState | null>(null);
  const [bulkPreviewError, setBulkPreviewError] = useState<string | null>(null);
  const [bulkPreviewReady, setBulkPreviewReady] = useState(false);
  const [bulkApplyLoading, setBulkApplyLoading] = useState(false);
  const [bulkApplyError, setBulkApplyError] = useState<string | null>(null);
  const [bulkApplySummary, setBulkApplySummary] = useState<string | null>(null);
  const [bulkApplyProgress, setBulkApplyProgress] = useState<ActionProgressState | null>(null);
  const [selectionTagActionLoading, setSelectionTagActionLoading] = useState<"add" | "remove" | null>(null);
  const [selectionTagAddInput, setSelectionTagAddInput] = useState("");
  const [selectionExportLoading, setSelectionExportLoading] = useState<SelectionExportFormat | null>(null);
  const [cacheRefreshLoading, setCacheRefreshLoading] = useState(false);
  const [selectionActionProgress, setSelectionActionProgress] = useState<ActionProgressState | null>(null);
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
  const selectionHeaderRef = useRef<HTMLInputElement | null>(null);
  const bulkCopyRunTokenRef = useRef(0);
  const bulkPreviewRunTokenRef = useRef(0);
  const selectionActionRunTokenRef = useRef(0);
  const restoreFilterRef = useRef<string | null>(null);
  const restoredReturnContextRef = useRef<number | null>(null);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>(
    () => initialStoredBucketListState?.sort ?? DEFAULT_SORT
  );
  const {
    contextItems: storageOpsContextItems,
    contextLabelById: storageOpsContextLabelById,
    filteredContextItems: filteredStorageOpsContextItems,
    contextSelectionSet: storageOpsContextSelectionSet,
    allFilteredContextsSelected: allFilteredStorageOpsContextsSelected,
    hasFilteredContextSelection: hasFilteredStorageOpsContextSelection,
    endpointItems: storageOpsEndpointItems,
    filteredEndpointItems: filteredStorageOpsEndpointItems,
    endpointSelectionSet: storageOpsEndpointSelectionSet,
    allFilteredEndpointsSelected: allFilteredStorageOpsEndpointsSelected,
    hasFilteredEndpointSelection: hasFilteredStorageOpsEndpointSelection,
  } = useMemo(
    () =>
      buildBucketOpsStorageScopeProjection({
        contexts: storageOpsContexts,
        contextFilter: storageOpsContextFilter,
        endpointFilter: storageOpsEndpointFilter,
        selectedContextIds: advancedDraft.contextIds,
        selectedEndpointNames: advancedDraft.endpointNames,
      }),
    [
      advancedDraft.contextIds,
      advancedDraft.endpointNames,
      storageOpsContextFilter,
      storageOpsContexts,
      storageOpsEndpointFilter,
    ]
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setFilterValue(filter.trim());
      if (restoreFilterRef.current !== null) {
        const shouldSkipReset = restoreFilterRef.current === filter;
        restoreFilterRef.current = null;
        if (shouldSkipReset) {
          return;
        }
      }
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [filter]);

  useEffect(() => {
    persistVisibleColumns(columnsStorageKey, visibleColumns);
  }, [columnsStorageKey, visibleColumns]);

  useEffect(() => {
    setAdvancedDraft((prev) => stripUnsupportedAdvancedFeatureFilters(prev, featureSupport));
    setAdvancedApplied((prev) => (prev ? stripUnsupportedAdvancedFeatureFilters(prev, featureSupport) : prev));
  }, [featureSupport]);

  useEffect(() => {
    if (!isStorageOps) {
      setStorageOpsContexts([]);
      setStorageOpsContextsLoading(false);
      setStorageOpsContextsError(null);
      return;
    }

    let canceled = false;
    setStorageOpsContextsLoading(true);
    setStorageOpsContextsError(null);
    listExecutionContexts("manager")
      .then((items) => {
        if (canceled) return;
        setStorageOpsContexts(items);
      })
      .catch((error) => {
        if (canceled) return;
        setStorageOpsContexts([]);
        setStorageOpsContextsError(extractError(error));
      })
      .finally(() => {
        if (!canceled) setStorageOpsContextsLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [isStorageOps]);

  useEffect(() => {
    setVisibleColumns((prev) => {
      const next = prev.filter((column) => {
        if (column === "static_website") return staticWebsiteFeatureEnabled;
        if (column === "notifications") return snsFeatureEnabled;
        if (column === "server_side_encryption") return sseFeatureEnabled;
        const detail = FEATURE_DETAIL_COLUMN_OPTIONS.find((option) => option.id === column);
        if (detail?.feature === "static_website") return staticWebsiteFeatureEnabled;
        if (detail?.feature === "notifications") return snsFeatureEnabled;
        if (detail?.feature === "server_side_encryption") return sseFeatureEnabled;
        return true;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [snsFeatureEnabled, staticWebsiteFeatureEnabled, sseFeatureEnabled]);

  useEffect(() => {
    if (!showAdvancedFilter) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAdvancedFilter(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showAdvancedFilter]);

  useEffect(() => {
    if (!showAdvancedFilter) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showAdvancedFilter]);

  useEffect(() => {
    setSelectionTagActionLoading(null);
    setSelectionTagAddInput("");
    setSelectionExportLoading(null);
    setActiveTagsTooltipKey(null);
    const stored = loadBucketListState(bucketsStateStorageKey, selectedEndpointId);
    if (ownerQueryFilter) {
      const ownerPrefill: AdvancedFilterState = {
        ...defaultAdvancedFilter,
        owner: ownerQueryFilter,
        ownerMatchMode: "exact",
      };
      restoreFilterRef.current = null;
      setFilter("");
      setFilterValue("");
      setQuickFilterMode("contains");
      setAdvancedApplied(ownerPrefill);
      setAdvancedDraft(ownerPrefill);
      setTagFilters([]);
      setTagFilterMode("any");
      setSelectedBuckets(new Set());
      setPage(1);
      setPageSize(stored?.pageSize ?? DEFAULT_PAGE_SIZE);
      setSort(stored?.sort ?? DEFAULT_SORT);
    } else if (stored) {
      restoreFilterRef.current = stored.filter;
      setFilter(stored.filter);
      setFilterValue(stored.filter.trim());
      setQuickFilterMode(stored.quickFilterMode);
      setAdvancedApplied(stored.advancedApplied);
      setAdvancedDraft(stored.advancedApplied ? stored.advancedApplied : defaultAdvancedFilter);
      setTagFilters(stored.tagFilters);
      setTagFilterMode(stored.tagFilterMode);
      setSelectedBuckets(new Set());
      setPage(stored.page);
      setPageSize(stored.pageSize);
      setSort(stored.sort);
    } else {
      restoreFilterRef.current = "";
      setFilter("");
      setFilterValue("");
      setQuickFilterMode("contains");
      setAdvancedApplied(null);
      setAdvancedDraft(defaultAdvancedFilter);
      setTagFilters([]);
      setTagFilterMode("any");
      setSelectedBuckets(new Set());
      setPage(1);
      setPageSize(DEFAULT_PAGE_SIZE);
      setSort(DEFAULT_SORT);
    }
  }, [bucketsStateStorageKey, ownerQueryFilter, selectedEndpointId]);

  useEffect(() => {
    persistBulkConfigClipboard(bulkClipboardStorageKey, bulkConfigClipboard);
  }, [bulkClipboardStorageKey, bulkConfigClipboard]);

  useEffect(() => {
    if (!selectedEndpointId) return;
    persistBucketListState(bucketsStateStorageKey, selectedEndpointId, {
      filter,
      quickFilterMode,
      advancedApplied,
      tagFilters,
      tagFilterMode,
      page,
      pageSize,
      sort,
    });
  }, [
    bucketsStateStorageKey,
    selectedEndpointId,
    filter,
    quickFilterMode,
    advancedApplied,
    tagFilters,
    tagFilterMode,
    page,
    pageSize,
    sort,
  ]);

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

  const quickFilterDraftParsed = useMemo(() => parseExactListInput(filter), [filter]);
  const quickFilterAppliedParsed = useMemo(() => parseExactListInput(filterValue), [filterValue]);
  const quickFilterDraftForcesExact = quickFilterDraftParsed.listProvided && quickFilterDraftParsed.values.length > 0;
  const quickFilterAppliedForcesExact = quickFilterAppliedParsed.listProvided && quickFilterAppliedParsed.values.length > 0;
  const quickFilterModeForDisplay: TextMatchMode = quickFilterDraftForcesExact ? "exact" : quickFilterMode;
  const effectiveQuickFilterMode: TextMatchMode = quickFilterAppliedForcesExact ? "exact" : quickFilterMode;
  const effectiveQuickSearchValue = effectiveQuickFilterMode === "contains" ? filterValue : "";
  const advancedFilterParam = useMemo(
    () =>
      buildAdvancedFilterPayload(
        effectiveQuickFilterMode === "exact" ? filterValue : "",
        effectiveQuickFilterMode,
        advancedApplied,
        null,
        isStorageOps,
        usageFeatureEnabled,
        featureSupport
      ),
    [advancedApplied, filterValue, effectiveQuickFilterMode, isStorageOps, usageFeatureEnabled, featureSupport]
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

  const clearBucketListingUiCaches = () => {
    resetBucketTooltipState();
    setActiveTagsTooltipKey(null);
    setAllFilteredBucketNames(null);
    setAllFilteredBucketNamesKey(null);
    setSelectAllProgress(null);
  };

  const refreshBucketListing = async () => {
    if (!selectedEndpointId || cacheRefreshLoading) return;
    setCacheRefreshLoading(true);
    setError(null);
    try {
      await refreshBucketListingCache(selectedEndpointId);
      await reloadUiTags();
      clearBucketListingUiCaches();
      refreshBuckets();
    } catch (err) {
      console.error(err);
      setError(extractError(err));
    } finally {
      setCacheRefreshLoading(false);
    }
  };

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

  const selectionQueryKey = useMemo(
    () =>
      JSON.stringify({
        endpoint: selectedEndpointId ?? null,
        filter: effectiveQuickSearchValue.trim() || null,
        quickFilterMode: effectiveQuickFilterMode,
        advanced: advancedFilterParam || null,
        uiTagIds: tagFilters,
        uiTagMatch: tagFilterMode,
        withStats: baseRequiresStats,
      }),
    [
      selectedEndpointId,
      effectiveQuickSearchValue,
      effectiveQuickFilterMode,
      advancedFilterParam,
      tagFilters,
      tagFilterMode,
      baseRequiresStats,
    ]
  );

  useEffect(() => {
    setAllFilteredBucketNames(null);
    setAllFilteredBucketNamesKey(null);
    setSelectAllProgress(null);
  }, [selectionQueryKey]);

  useEffect(() => {
    if (allFilteredBucketNamesKey !== selectionQueryKey || !allFilteredBucketNames) return;
    if (total !== allFilteredBucketNames.length) {
      setAllFilteredBucketNames(null);
      setAllFilteredBucketNamesKey(null);
    }
  }, [allFilteredBucketNamesKey, allFilteredBucketNames, selectionQueryKey, total]);

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
  }, [sort.field, usageFeatureEnabled]);

  const toggleColumn = (id: ColumnId) => {
    setVisibleColumns((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const resetColumns = () => {
    setVisibleColumns(defaultVisibleColumns);
  };

  const toggleSelection = (name: string) => {
    setSelectedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAllLoading = selectAllProgress !== null;

  const loadAllFilteredBucketNames = async (options?: { onProgress?: (completed: number, total: number) => void }) => {
    if (!selectedEndpointId) return [];
    if (allFilteredBucketNamesKey === selectionQueryKey && allFilteredBucketNames) {
      options?.onProgress?.(allFilteredBucketNames.length, allFilteredBucketNames.length);
      return allFilteredBucketNames;
    }
    const bucketsByName = await loadBucketOpsFilteredBuckets({
      initialTotal: total > 0 ? total : null,
      listBuckets,
      onProgress: options?.onProgress,
      params: {
        filter: effectiveQuickSearchValue.trim() || undefined,
        advanced_filter: advancedFilterParam,
        sort_by: sort.field,
        sort_dir: sort.direction,
        with_stats: baseRequiresStats,
        ui_tag_ids: tagFilters.length > 0 ? tagFilters : undefined,
        ui_tag_match: tagFilterMode,
      },
      scopeId: selectedEndpointId,
    });
    const resolved = Array.from(bucketsByName.keys());
    setAllFilteredBucketNames(resolved);
    setAllFilteredBucketNamesKey(selectionQueryKey);
    return resolved;
  };

  const setSelectionForFilteredResults = async (checked: boolean) => {
    if (!selectedEndpointId) return;
    setSelectAllProgress({
      label: checked ? "Selecting filtered buckets" : "Clearing filtered selection",
      completed: 0,
      total: Math.max(total, 0),
      failed: 0,
    });
    try {
      const names = await loadAllFilteredBucketNames({
        onProgress: (completed, progressTotal) => {
          setSelectAllProgress((prev) =>
            prev
              ? {
                  ...prev,
                  completed,
                  total: progressTotal,
                }
              : prev
          );
        },
      });
      setSelectedBuckets((prev) => {
        const next = new Set(prev);
        names.forEach((name) => {
          if (checked) {
            next.add(name);
          } else {
            next.delete(name);
          }
        });
        return next;
      });
    } catch (err) {
      console.error(err);
      setError(extractError(err));
    } finally {
      setSelectAllProgress(null);
    }
  };

  const clearSelection = () => {
    setSelectedBuckets(new Set());
    setBulkOperation("");
    setBulkCopyFeatures(DEFAULT_BULK_COPY_FEATURE_SELECTION);
    setBulkLifecycleRuleText("");
    setBulkLifecycleUpdateOnlyExisting(false);
    setBulkLifecycleDeleteIds("");
    setBulkLifecycleDeleteTypes(
      LIFECYCLE_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<LifecycleRuleTypeKey, boolean>
      )
    );
    setBulkNotificationText("");
    setBulkNotificationDeleteIds("");
    setBulkNotificationDeleteTypes(
      NOTIFICATION_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<NotificationConfigurationTypeKey, boolean>
      )
    );
    setBulkCorsRuleText("");
    setBulkCorsUpdateOnlyExisting(false);
    setBulkCorsDeleteIds("");
    setBulkCorsDeleteTypes(
      CORS_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<CorsRuleTypeKey, boolean>
      )
    );
    setBulkPolicyText("");
    setBulkPolicyUpdateOnlyExisting(false);
    setBulkPolicyDeleteIds("");
    setBulkPolicyDeleteTypes(
      POLICY_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<PolicyRuleTypeKey, boolean>
      )
    );
    setBulkPasteMapping({});
    setBulkCopyError(null);
    setBulkCopySummary(null);
    setBulkPreview([]);
    setBulkPreviewError(null);
    setBulkPreviewReady(false);
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setSelectionTagActionLoading(null);
    setSelectionTagAddInput("");
    setSelectionExportLoading(null);
    setShowConfigBackupModal(false);
  };

  const addTagFilter = (tag: BucketUiTagDefinition) => {
    setTagFilters((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]));
    setPage(1);
  };

  const removeTagFilter = (tagId: number) => {
    setTagFilters((prev) => prev.filter((item) => item !== tagId));
    setPage(1);
  };

  const {
    fullyResolvedFilteredSelection,
    headerChecked,
    headerIndeterminate,
    hiddenSelectedCount,
    selectedBucketList,
    selectedCount,
    selectedOperationTargets,
    selectedUiTagSuggestions,
  } = useMemo(
    () =>
      buildBucketOpsSelectionProjection({
        allFilteredBucketNames,
        allFilteredBucketNamesKey,
        isStorageOps,
        items,
        selectedBuckets,
        selectionQueryKey,
        total,
      }),
    [
      allFilteredBucketNames,
      allFilteredBucketNamesKey,
      isStorageOps,
      items,
      selectedBuckets,
      selectionQueryKey,
      total,
    ],
  );

  useEffect(() => {
    if (!selectionHeaderRef.current) return;
    selectionHeaderRef.current.indeterminate = headerIndeterminate;
  }, [headerIndeterminate]);

  const resolveBucketTargetsByNames = async (
    bucketNames: string[],
    options?: {
      onProgress?: (event: { completed: number; total: number; failed: number }) => void;
    }
  ) => {
    if (!selectedEndpointId || bucketNames.length === 0) {
      return { targets: [] as BucketTagTarget[], missingNames: bucketNames };
    }
    const bucketsByName = await loadBucketOpsBucketsByNames({
      bucketNames,
      concurrency: 4,
      listBuckets,
      onProgress: options?.onProgress,
      scopeId: selectedEndpointId,
      withStats: false,
    });
    const targetByKey = new Map<string, BucketTagTarget>();
    const existingNames = new Set<string>();
    bucketsByName.forEach((bucket) => {
      const target = resolveBucketTagTarget(bucket);
      if (target) {
        targetByKey.set(target.key, target);
        existingNames.add(target.name);
      }
    });
    const missingNames = bucketNames.filter((name) => !existingNames.has(name));
    const targets = Array.from(targetByKey.values()).sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return (a.tenant ?? "").localeCompare(b.tenant ?? "");
    });
    return { targets, missingNames };
  };

  const openSelectedBucketIndexChecks = async () => {
    if (isStorageOps || !selectedEndpointId || selectedBucketList.length === 0 || selectedBucketList.length > 200) return;
    setSelectionActionProgress({
      label: "Resolving RGW bucket identities",
      completed: 0,
      total: selectedBucketList.length,
      failed: 0,
    });
    try {
      const { targets, missingNames } = await resolveBucketTargetsByNames(selectedBucketList, {
        onProgress: (progress) => {
          setSelectionActionProgress({
            label: "Resolving RGW bucket identities",
            completed: progress.completed,
            total: progress.total,
            failed: progress.failed,
          });
        },
      });
      if (missingNames.length > 0) {
        setError(`Some selected buckets no longer exist: ${formatBucketNamesPreview(missingNames)}.`);
      }
      if (targets.length === 0) {
        setError("Unable to resolve selected buckets for the RGW index check.");
        return;
      }
      if (targets.length > 200) {
        setError("Bucket index checks are limited to 200 resolved buckets. Narrow the selection to continue.");
        return;
      }
      setIndexCheckTargets(targets.map((target) => ({ name: target.name, tenant: target.tenant })));
    } catch (resolveError) {
      setError(extractError(resolveError));
    } finally {
      setSelectionActionProgress(null);
    }
  };

  const parsedSelectionTagAddInput = useMemo(() => parseUiTags(selectionTagAddInput), [selectionTagAddInput]);

  const applyUiTagToSelection = async (
    tag: BucketUiTagDefinition | BucketUiTagDraft[],
    action: "add" | "remove"
  ) => {
    if (!selectedEndpointId || selectedBucketList.length === 0 || selectionTagActionLoading) return;
    const parsedTagValues = Array.isArray(tag) ? tag : [tag];
    if (
      parsedTagValues.length === 0 ||
      (action === "remove" && Array.isArray(tag))
    ) {
      return;
    }
    const runToken = selectionActionRunTokenRef.current + 1;
    selectionActionRunTokenRef.current = runToken;
    const progressLabel = action === "add" ? "Applying UI tags" : "Removing UI tags";
    setSelectionActionProgress({
      label: progressLabel,
      completed: 0,
      total: selectedBucketList.length,
      failed: 0,
    });
    setSelectionTagActionLoading(action);
    try {
      const { targets, missingNames } = await resolveBucketTargetsByNames(selectedBucketList, {
        onProgress: (progress) => {
          if (selectionActionRunTokenRef.current !== runToken) return;
          setSelectionActionProgress((prev) =>
            prev
              ? {
                  ...prev,
                  completed: progress.completed,
                  total: progress.total,
                  failed: progress.failed,
                }
              : prev
          );
        },
      });
      if (targets.length === 0) {
        setError("Unable to resolve selected buckets for UI tag update.");
        return;
      }
      if (missingNames.length > 0) {
        setError(`Some selected buckets no longer exist: ${formatBucketNamesPreview(missingNames)}.`);
      }
      if (action === "add") {
        await persistUiTagChanges(targets, parsedTagValues, [], {
          onProgress: ({ completed, total }) =>
            setSelectionActionProgress({ label: progressLabel, completed, total, failed: 0 }),
        });
      } else {
        await persistUiTagChanges(targets, [], parsedTagValues as BucketUiTagDefinition[], {
          onProgress: ({ completed, total }) =>
            setSelectionActionProgress({ label: progressLabel, completed, total, failed: 0 }),
        });
      }
      refreshBuckets();
    } catch (err) {
      setError(extractError(err));
      refreshBuckets();
    } finally {
      setSelectionTagActionLoading(null);
      if (selectionActionRunTokenRef.current === runToken) {
        setSelectionActionProgress(null);
      }
    }
  };

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
  }, [bulkConfigClipboard, bulkClipboardSameEndpoint, bulkOperation, selectedBucketList, showBulkUpdateModal]);

  const loadBucketsForCurrentFilteredExport = async (options?: { onProgress?: (completed: number, total: number) => void }) => {
    if (!selectedEndpointId || total <= 0) {
      return new Map<string, CephAdminBucket>();
    }
    return loadBucketOpsFilteredBuckets({
      initialTotal: total,
      listBuckets,
      onProgress: options?.onProgress,
      params: {
        filter: effectiveQuickSearchValue.trim() || undefined,
        advanced_filter: advancedFilterParam,
        sort_by: sort.field,
        sort_dir: sort.direction,
        include: includeParams.length > 0 ? includeParams : undefined,
        with_stats: exportWithStats,
        ui_tag_ids: tagFilters.length > 0 ? tagFilters : undefined,
        ui_tag_match: tagFilterMode,
      },
      scopeId: selectedEndpointId,
    });
  };

  const loadSelectedBucketsForExport = async (options?: { onProgress?: (completed: number, total: number) => void }) => {
    if (fullyResolvedFilteredSelection) {
      return loadBucketsForCurrentFilteredExport(options);
    }

    const bucketsByName = new Map<string, CephAdminBucket>();
    items.forEach((bucket) => {
      if (selectedBuckets.has(bucket.name)) {
        bucketsByName.set(bucket.name, bucket);
      }
    });
    if (!selectedEndpointId || selectedBucketList.length === 0) {
      return bucketsByName;
    }

    const loadedBuckets = await loadBucketOpsBucketsByNames({
      bucketNames: selectedBucketList,
      include: includeParams,
      listBuckets,
      onProgress: ({ completed, total }) => options?.onProgress?.(completed, total),
      scopeId: selectedEndpointId,
      withStats: exportWithStats,
    });
    loadedBuckets.forEach((bucket) => {
      if (selectedBuckets.has(bucket.name)) bucketsByName.set(bucket.name, bucket);
    });

    return bucketsByName;
  };

  const exportSelectedBuckets = async (format: SelectionExportFormat) => {
    if (selectedBucketList.length === 0 || selectionExportLoading) return;
    const withProgress = format === "csv" || format === "json";
    const runToken = withProgress ? selectionActionRunTokenRef.current + 1 : null;
    if (withProgress) {
      selectionActionRunTokenRef.current = runToken ?? selectionActionRunTokenRef.current;
      setSelectionActionProgress({
        label: format === "csv" ? "Preparing CSV export" : "Preparing JSON export",
        completed: 0,
        total: selectedBucketList.length,
        failed: 0,
      });
    }
    setSelectionExportLoading(format);
    try {
      const exportedAt = new Date().toISOString();
      const timestamp = exportedAt.replace(/[:.]/g, "-");
      const endpointPart = sanitizeExportFilenamePart(
        selectedEndpoint?.name ??
          (selectedEndpointId ? `${scopeDisplayName.toLowerCase()}-${selectedEndpointId}` : scopeDisplayName.toLowerCase())
      );

      if (format === "text") {
        triggerDownload(
          `${exportPrefix}-buckets-${endpointPart}-${timestamp}.txt`,
          selectedBucketList.join("\n"),
          "text/plain;charset=utf-8"
        );
        return;
      }

      const bucketsByName = await loadSelectedBucketsForExport({
        onProgress: (completed, total) => {
          if (!withProgress || runToken === null || selectionActionRunTokenRef.current !== runToken) return;
          setSelectionActionProgress((prev) =>
            prev
              ? {
                  ...prev,
                  completed,
                  total,
                }
              : prev
          );
        },
      });
      const exportColumns = buildBucketExportColumns({
        columnIds: visibleColumns,
        featureColumns: featureColumnOptions,
        isStorageOps,
        useExplicitBucketName,
      });
      if (format === "csv") {
        triggerDownload(
          `${exportPrefix}-buckets-${endpointPart}-${timestamp}.csv`,
          serializeBucketSelectionCsv({
            bucketNames: selectedBucketList,
            bucketsByName,
            columns: exportColumns,
          }),
          "text/csv;charset=utf-8"
        );
        return;
      }

      const jsonPayload = buildBucketSelectionJsonPayload({
        bucketNames: selectedBucketList,
        bucketsByName,
        columns: exportColumns,
        generatedAt: exportedAt,
        scopeKey: exportScopeKey,
        scope: {
          id: selectedEndpointId ?? null,
          name: selectedEndpoint?.name ?? null,
        },
      });
      triggerDownload(
        `${exportPrefix}-buckets-${endpointPart}-${timestamp}.json`,
        JSON.stringify(jsonPayload, null, 2),
        "application/json"
      );
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSelectionExportLoading(null);
      if (withProgress && runToken !== null && selectionActionRunTokenRef.current === runToken) {
        setSelectionActionProgress(null);
      }
    }
  };

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

  const resetBulkPreview = () => {
    bulkPreviewRunTokenRef.current += 1;
    setBulkPreviewLoading(false);
    setBulkPreview([]);
    setBulkPreviewError(null);
    setBulkPreviewReady(false);
    setBulkPreviewProgress(null);
  };

  useEffect(() => {
    if (!showBulkUpdateModal) return;
    resetBulkPreview();
    bulkCopyRunTokenRef.current += 1;
    setBulkCopyLoading(false);
    setBulkCopyProgress(null);
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress(null);
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
  }, [bulkOperation, quotaOperationDisabledReason, snsFeatureEnabled, usageFeatureEnabled]);

  const openBulkUpdateModal = () => {
    bulkCopyRunTokenRef.current += 1;
    setShowBulkUpdateModal(true);
    setBulkOperation("");
    setBulkCopyFeatures(DEFAULT_BULK_COPY_FEATURE_SELECTION);
    setBulkCopyError(null);
    setBulkCopySummary(null);
    setBulkCopyLoading(false);
    setBulkCopyProgress(null);
    setBulkPasteMapping({});
    setBulkQuotaSizeValue("");
    setBulkQuotaSizeUnit("GiB");
    setBulkQuotaObjects("");
    setBulkQuotaApplySize(true);
    setBulkQuotaApplyObjects(true);
    setBulkQuotaSkipConfigured(false);
    setBulkPublicAccessBlockTargets({
      block_public_acls: true,
      ignore_public_acls: true,
      block_public_policy: true,
      restrict_public_buckets: true,
    });
    setBulkLifecycleRuleText("");
    setBulkLifecycleUpdateOnlyExisting(false);
    setBulkLifecycleDeleteIds("");
    setBulkLifecycleDeleteTypes(
      LIFECYCLE_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<LifecycleRuleTypeKey, boolean>
      )
    );
    setBulkNotificationText("");
    setBulkNotificationDeleteIds("");
    setBulkNotificationDeleteTypes(
      NOTIFICATION_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<NotificationConfigurationTypeKey, boolean>
      )
    );
    setBulkCorsRuleText("");
    setBulkCorsUpdateOnlyExisting(false);
    setBulkCorsDeleteIds("");
    setBulkCorsDeleteTypes(
      CORS_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<CorsRuleTypeKey, boolean>
      )
    );
    setBulkPolicyText("");
    setBulkPolicyUpdateOnlyExisting(false);
    setBulkPolicyDeleteIds("");
    setBulkPolicyDeleteTypes(
      POLICY_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<PolicyRuleTypeKey, boolean>
      )
    );
    resetBulkPreview();
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress(null);
  };

  const closeBulkUpdateModal = () => {
    bulkCopyRunTokenRef.current += 1;
    setShowBulkUpdateModal(false);
    resetBulkPreview();
    setBulkCopyError(null);
    setBulkCopySummary(null);
    setBulkCopyLoading(false);
    setBulkCopyProgress(null);
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress(null);
  };

  const buildVersioningPreview = async (bucketName: string, desiredEnabled: boolean): Promise<BulkPreviewItem> => {
    const props = await getBucketProperties(selectedEndpointId!, bucketName);
    const currentStatus = formatVersioningStatus(props.versioning_status);
    const currentEnabled = normalizeVersioningStatus(props.versioning_status);
    const changed = currentEnabled === null ? true : currentEnabled !== desiredEnabled;
    const afterStatus = changed ? (desiredEnabled ? "Enabled" : "Suspended") : currentStatus;
    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: currentStatus,
          tone: changed && currentEnabled !== null ? "removed" : undefined,
        },
      ],
      after: [
        {
          text: afterStatus,
          tone: changed ? "added" : undefined,
        },
      ],
    };
  };

  const buildPublicAccessBlockPreview = async (
    bucketName: string,
    desiredEnabled: boolean,
    targets: PublicAccessBlockOptionKey[]
  ): Promise<BulkPreviewItem> => {
    const current = normalizePublicAccessBlockState(await getBucketPublicAccessBlock(selectedEndpointId!, bucketName));
    const target = applyPublicAccessBlockTargets(current, desiredEnabled, targets);
    const changed = !isPublicAccessBlockEquivalent(current, target);
    const beforeState = formatPublicAccessBlockState(current);
    const afterState = formatPublicAccessBlockState(target);
    return {
      bucket: bucketName,
      changed,
      before: [
        { text: `State: ${beforeState}`, tone: changed ? "removed" : undefined },
        ...PUBLIC_ACCESS_BLOCK_OPTIONS.map((option): BulkPreviewLine => ({
          text: `${option.label}: ${formatPublicAccessBlockFlag(current[option.key])}`,
          tone: current[option.key] !== target[option.key] ? "removed" : undefined,
        })),
      ],
      after: [
        { text: `State: ${afterState}`, tone: changed ? "added" : undefined },
        ...PUBLIC_ACCESS_BLOCK_OPTIONS.map((option): BulkPreviewLine => ({
          text: `${option.label}: ${formatPublicAccessBlockFlag(target[option.key])}`,
          tone: current[option.key] !== target[option.key] ? "added" : undefined,
        })),
      ],
    };
  };

  const fetchBucketQuota = async (bucketName: string) => {
    const advancedFilter = JSON.stringify({
      match: "all",
      rules: [{ field: "name", op: "in", value: [bucketName] }],
    });
    const response = await listBuckets(selectedEndpointId!, {
      page: 1,
      page_size: 5,
      advanced_filter: advancedFilter,
      with_stats: usageFeatureEnabled,
    });
    const match =
      response.items.find((item) => normalizeBucketName(item.name) === normalizeBucketName(bucketName)) ??
      response.items[0] ??
      null;
    return {
      maxSizeBytes: normalizeQuotaLimit(match?.quota_max_size_bytes),
      maxObjects: normalizeQuotaLimit(match?.quota_max_objects),
    };
  };

  const buildQuotaPreview = async (
    bucketName: string,
    payload: ParsedQuotaInput,
    skipConfigured: boolean
  ): Promise<BulkPreviewItem> => {
    const currentQuota = await fetchBucketQuota(bucketName);
    if (skipConfigured && hasConfiguredQuota(currentQuota)) {
      return {
        bucket: bucketName,
        changed: false,
        before: [
          { text: `Size: ${currentQuota.maxSizeBytes != null ? formatBytes(currentQuota.maxSizeBytes) : "Not set"}` },
          { text: `Objects: ${currentQuota.maxObjects != null ? formatNumber(currentQuota.maxObjects) : "Not set"}` },
        ],
        after: [
          { text: `Size: ${currentQuota.maxSizeBytes != null ? formatBytes(currentQuota.maxSizeBytes) : "Not set"}` },
          { text: `Objects: ${currentQuota.maxObjects != null ? formatNumber(currentQuota.maxObjects) : "Not set"}` },
          { text: "(existing quota preserved)" },
        ],
      };
    }
    const beforeSize = currentQuota.maxSizeBytes;
    const beforeObjects = currentQuota.maxObjects;
    const afterSize = payload.applySize ? payload.maxSizeBytes : currentQuota.maxSizeBytes;
    const afterObjects = payload.applyObjects ? payload.maxObjects : currentQuota.maxObjects;
    const sizeChanged = beforeSize !== afterSize;
    const objectsChanged = beforeObjects !== afterObjects;
    const changed = sizeChanged || objectsChanged;

    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: `Size: ${beforeSize != null ? formatBytes(beforeSize) : "Not set"}`,
          tone: sizeChanged ? "removed" : undefined,
        },
        {
          text: `Objects: ${beforeObjects != null ? formatNumber(beforeObjects) : "Not set"}`,
          tone: objectsChanged ? "removed" : undefined,
        },
      ],
      after: [
        {
          text: `Size: ${afterSize != null ? formatBytes(afterSize) : "Not set"}`,
          tone: sizeChanged ? "added" : undefined,
        },
        {
          text: `Objects: ${afterObjects != null ? formatNumber(afterObjects) : "Not set"}`,
          tone: objectsChanged ? "added" : undefined,
        },
      ],
    };
  };

  const buildLifecyclePreview = async (
    bucketName: string,
    rules: Record<string, unknown>[]
  ): Promise<BulkPreviewItem> => {
    const lifecycle = await getBucketLifecycle(selectedEndpointId!, bucketName);
    const existingRules = lifecycle.rules ?? [];
    const { nextRules, changes } = mergeLifecycleRules(
      existingRules as Record<string, unknown>[],
      rules,
      { onlyUpdateExisting: bulkLifecycleUpdateOnlyExisting }
    );
    const changed = changes.length > 0;
    const beforeLines: BulkPreviewLine[] =
      existingRules.length === 0
        ? [{ text: "(no rules)" }]
        : existingRules.map((existing, idx) => {
            const isReplaced = changes.some((change) => change.action === "replace" && change.index === idx);
            return {
              text: formatLifecycleRule(existing as Record<string, unknown>),
              tone: isReplaced ? "removed" : undefined,
            };
          });
    const afterLines: BulkPreviewLine[] =
      nextRules.length === 0
        ? [{ text: "(no rules)" }]
        : nextRules.map((existing, idx) => {
            const isAdded = changes.some(
              (change) => (change.action === "replace" || change.action === "add") && change.index === idx
            );
            return {
              text: formatLifecycleRule(existing as Record<string, unknown>),
              tone: isAdded ? "added" : undefined,
            };
          });
    return {
      bucket: bucketName,
      changed,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildLifecycleDeletePreview = async (
    bucketName: string,
    deleteIds: Set<string>,
    deleteTypes: Set<LifecycleRuleTypeKey>
  ): Promise<BulkPreviewItem> => {
    const lifecycle = await getBucketLifecycle(selectedEndpointId!, bucketName);
    const existingRules = lifecycle.rules ?? [];
    const shouldDeleteRule = (rule: Record<string, unknown>) => {
      const ruleId = getLifecycleRuleId(rule);
      if (ruleId && deleteIds.has(ruleId)) return true;
      if (deleteTypes.size === 0) return false;
      const ruleTypes = getLifecycleRuleTypes(rule);
      return ruleTypes.some((type) => deleteTypes.has(type));
    };
    const removedIndices = new Set<number>();
    existingRules.forEach((rule, idx) => {
      if (shouldDeleteRule(rule as Record<string, unknown>)) {
        removedIndices.add(idx);
      }
    });
    const nextRules = existingRules.filter((_, idx) => !removedIndices.has(idx));
    const beforeLines: BulkPreviewLine[] =
      existingRules.length === 0
        ? [{ text: "(no rules)" }]
        : existingRules.map((existing, idx) => ({
            text: formatLifecycleRule(existing as Record<string, unknown>),
            tone: removedIndices.has(idx) ? "removed" : undefined,
          }));
    const afterLines: BulkPreviewLine[] =
      nextRules.length === 0
        ? [{ text: "(no rules)" }]
        : nextRules.map((existing) => ({ text: formatLifecycleRule(existing as Record<string, unknown>) }));
    return {
      bucket: bucketName,
      changed: removedIndices.size > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildNotificationsPreview = async (
    bucketName: string,
    configuration: Record<string, unknown>
  ): Promise<BulkPreviewItem> => {
    const notifications = await getBucketNotifications(selectedEndpointId!, bucketName);
    const currentConfiguration = notifications.configuration ?? {};
    const { configuration: nextConfiguration, changes } = mergeNotificationConfigurations(
      currentConfiguration,
      configuration
    );
    const changed = changes.length > 0;
    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: formatNotificationConfiguration(currentConfiguration),
          tone: changed ? "removed" : undefined,
        },
      ],
      after: [
        {
          text: formatNotificationConfiguration(nextConfiguration),
          tone: changed ? "added" : undefined,
        },
      ],
    };
  };

  const buildNotificationsDeletePreview = async (
    bucketName: string,
    deleteIds: Set<string>,
    deleteTypes: Set<NotificationConfigurationTypeKey>
  ): Promise<BulkPreviewItem> => {
    const notifications = await getBucketNotifications(selectedEndpointId!, bucketName);
    const currentConfiguration = notifications.configuration ?? {};
    const { configuration: nextConfiguration, changes } = deleteNotificationConfigurations(
      currentConfiguration,
      deleteIds,
      deleteTypes
    );
    const changed = changes.length > 0;
    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: formatNotificationConfiguration(currentConfiguration),
          tone: changed ? "removed" : undefined,
        },
      ],
      after: [
        {
          text: formatNotificationConfiguration(nextConfiguration),
          tone: changed ? "added" : undefined,
        },
      ],
    };
  };

  const buildCorsPreview = async (
    bucketName: string,
    rules: Record<string, unknown>[]
  ): Promise<BulkPreviewItem> => {
    const cors = await getBucketCors(selectedEndpointId!, bucketName);
    const existingRules = cors.rules ?? [];
    const { nextRules, changes } = mergeCorsRules(
      existingRules as Record<string, unknown>[],
      rules,
      { onlyUpdateExisting: bulkCorsUpdateOnlyExisting }
    );
    const beforeLines: BulkPreviewLine[] =
      existingRules.length === 0
        ? [{ text: "(no rules)" }]
        : existingRules.map((existing, idx) => {
            const isReplaced = changes.some((change) => change.action === "replace" && change.index === idx);
            return {
              text: formatCorsRule(existing as Record<string, unknown>),
              tone: isReplaced ? "removed" : undefined,
            };
          });
    const afterLines: BulkPreviewLine[] =
      nextRules.length === 0
        ? [{ text: "(no rules)" }]
        : nextRules.map((existing, idx) => {
            const isAdded = changes.some(
              (change) => (change.action === "replace" || change.action === "add") && change.index === idx
            );
            return {
              text: formatCorsRule(existing as Record<string, unknown>),
              tone: isAdded ? "added" : undefined,
            };
          });
    return {
      bucket: bucketName,
      changed: changes.length > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildCorsDeletePreview = async (
    bucketName: string,
    deleteIds: Set<string>,
    deleteTypes: Set<CorsRuleTypeKey>
  ): Promise<BulkPreviewItem> => {
    const cors = await getBucketCors(selectedEndpointId!, bucketName);
    const existingRules = cors.rules ?? [];
    const shouldDeleteRule = (rule: Record<string, unknown>) => {
      const ruleId = getLifecycleRuleId(rule);
      if (ruleId && deleteIds.has(ruleId)) return true;
      if (deleteTypes.size === 0) return false;
      const ruleTypes = getCorsRuleTypes(rule);
      return ruleTypes.some((type) => deleteTypes.has(type));
    };
    const removedIndices = new Set<number>();
    existingRules.forEach((rule, idx) => {
      if (shouldDeleteRule(rule as Record<string, unknown>)) {
        removedIndices.add(idx);
      }
    });
    const nextRules = existingRules.filter((_, idx) => !removedIndices.has(idx));
    const beforeLines: BulkPreviewLine[] =
      existingRules.length === 0
        ? [{ text: "(no rules)" }]
        : existingRules.map((existing, idx) => ({
            text: formatCorsRule(existing as Record<string, unknown>),
            tone: removedIndices.has(idx) ? "removed" : undefined,
          }));
    const afterLines: BulkPreviewLine[] =
      nextRules.length === 0
        ? [{ text: "(no rules)" }]
        : nextRules.map((existing) => ({ text: formatCorsRule(existing as Record<string, unknown>) }));
    return {
      bucket: bucketName,
      changed: removedIndices.size > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildPolicyPreview = async (
    bucketName: string,
    statements: Record<string, unknown>[]
  ): Promise<BulkPreviewItem> => {
    const policy = await getBucketPolicy(selectedEndpointId!, bucketName);
    const existingPolicy = policy.policy ?? {};
    const existingStatements = Array.isArray((existingPolicy as Record<string, unknown>).Statement)
      ? ((existingPolicy as Record<string, unknown>).Statement as Record<string, unknown>[])
      : [];
    const { nextStatements, changes } = mergePolicyStatements(
      existingStatements,
      statements,
      { onlyUpdateExisting: bulkPolicyUpdateOnlyExisting }
    );
    const beforeLines: BulkPreviewLine[] =
      existingStatements.length === 0
        ? [{ text: "(no statements)" }]
        : existingStatements.map((statement, idx) => {
            const isReplaced = changes.some((change) => change.action === "replace" && change.index === idx);
            return {
              text: formatPolicyRule(statement as Record<string, unknown>),
              tone: isReplaced ? "removed" : undefined,
            };
          });
    const afterLines: BulkPreviewLine[] =
      nextStatements.length === 0
        ? [{ text: "(no statements)" }]
        : nextStatements.map((statement, idx) => {
            const isAdded = changes.some(
              (change) => (change.action === "replace" || change.action === "add") && change.index === idx
            );
            return {
              text: formatPolicyRule(statement as Record<string, unknown>),
              tone: isAdded ? "added" : undefined,
            };
          });
    return {
      bucket: bucketName,
      changed: changes.length > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildPolicyDeletePreview = async (
    bucketName: string,
    deleteIds: Set<string>,
    deleteTypes: Set<PolicyRuleTypeKey>
  ): Promise<BulkPreviewItem> => {
    const policy = await getBucketPolicy(selectedEndpointId!, bucketName);
    const existingPolicy = policy.policy ?? {};
    const existingStatements = Array.isArray((existingPolicy as Record<string, unknown>).Statement)
      ? ((existingPolicy as Record<string, unknown>).Statement as Record<string, unknown>[])
      : [];
    const shouldDeleteStatement = (statement: Record<string, unknown>) => {
      const sid = getPolicyStatementSid(statement);
      if (sid && deleteIds.has(sid)) return true;
      if (deleteTypes.size === 0) return false;
      const types = getPolicyStatementTypes(statement);
      return types.some((type) => deleteTypes.has(type));
    };
    const removedIndices = new Set<number>();
    existingStatements.forEach((statement, idx) => {
      if (shouldDeleteStatement(statement as Record<string, unknown>)) {
        removedIndices.add(idx);
      }
    });
    const nextStatements = existingStatements.filter((_, idx) => !removedIndices.has(idx));
    const beforeLines: BulkPreviewLine[] =
      existingStatements.length === 0
        ? [{ text: "(no statements)" }]
        : existingStatements.map((statement, idx) => ({
            text: formatPolicyRule(statement as Record<string, unknown>),
            tone: removedIndices.has(idx) ? "removed" : undefined,
          }));
    const afterLines: BulkPreviewLine[] =
      nextStatements.length === 0
        ? [{ text: "(no statements)" }]
        : nextStatements.map((statement) => ({ text: formatPolicyRule(statement as Record<string, unknown>) }));
    return {
      bucket: bucketName,
      changed: removedIndices.size > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const copyBulkConfigs = async () => {
    if (!selectedEndpointId || selectedBucketList.length === 0) return;
    const runToken = bulkCopyRunTokenRef.current + 1;
    bulkCopyRunTokenRef.current = runToken;
    setBulkCopyLoading(true);
    setBulkCopyError(null);
    setBulkCopySummary(null);
    setBulkCopyProgress({
      label: "Copying selected configs",
      completed: 0,
      total: selectedBucketList.length,
      failed: 0,
    });
    try {
      const result = await copyBucketOpsConfigs({
        bucketNames: selectedBucketList,
        copiedAt: new Date().toISOString(),
        features: bulkCopyFeatures,
        fetchBucketQuota,
        getBucketCors,
        getBucketLifecycle,
        getBucketLogging,
        getBucketPolicy,
        getBucketProperties,
        getBucketPublicAccessBlock,
        isStorageOps,
        onProgress: (progress) => {
          if (bulkCopyRunTokenRef.current !== runToken) return;
          setBulkCopyProgress({ label: "Copying selected configs", ...progress });
        },
        sourceEndpointId: selectedEndpointId,
        sourceEndpointName: selectedEndpoint?.name ?? null,
      });
      if (bulkCopyRunTokenRef.current !== runToken) return;
      if (result.kind === "error") {
        setBulkCopyError(result.error);
        return;
      }
      setBulkConfigClipboard(result.clipboard);
      setBulkCopySummary(result.summary);
    } catch (err) {
      if (bulkCopyRunTokenRef.current !== runToken) return;
      setBulkCopyError(extractError(err));
    } finally {
      if (bulkCopyRunTokenRef.current === runToken) {
        setBulkCopyLoading(false);
        setBulkCopyProgress(null);
      }
    }
  };

  const buildPasteConfigPreview = async (mapping: BulkPastePlanItem): Promise<BulkPreviewItem> => {
    const features = bulkConfigClipboard?.features;
    const source = mapping.sourceConfig;
    if (!features) {
      return {
        bucket: mapping.destinationBucket,
        changed: false,
        before: [{ text: "Clipboard unavailable." }],
        after: [{ text: "Clipboard unavailable." }],
      };
    }
    let changed = false;
    const before: BulkPreviewLine[] = [{ text: `Source bucket: ${mapping.sourceBucket}` }];
    const after: BulkPreviewLine[] = [{ text: `Source bucket: ${mapping.sourceBucket}` }];
    const pushSection = (label: string, beforeLines: BulkPreviewLine[], afterLines: BulkPreviewLine[]) => {
      before.push({ text: `[${label}]` }, ...beforeLines);
      after.push({ text: `[${label}]` }, ...afterLines);
    };

    let props: BucketProperties | null = null;
    if (features.versioning || features.object_lock) {
      props = await getBucketProperties(selectedEndpointId!, mapping.destinationBucket);
    }

    if (!isStorageOps && features.quota && source.quota) {
      const currentQuota = await fetchBucketQuota(mapping.destinationBucket);
      const sectionChanged =
        currentQuota.maxSizeBytes !== source.quota.maxSizeBytes || currentQuota.maxObjects !== source.quota.maxObjects;
      changed = changed || sectionChanged;
      pushSection(
        "Quota",
        [
          {
            text: `Size: ${currentQuota.maxSizeBytes != null ? formatBytes(currentQuota.maxSizeBytes) : "Not set"}`,
            tone: sectionChanged ? "removed" : undefined,
          },
          {
            text: `Objects: ${currentQuota.maxObjects != null ? formatNumber(currentQuota.maxObjects) : "Not set"}`,
            tone: sectionChanged ? "removed" : undefined,
          },
        ],
        [
          {
            text: `Size: ${source.quota.maxSizeBytes != null ? formatBytes(source.quota.maxSizeBytes) : "Not set"}`,
            tone: sectionChanged ? "added" : undefined,
          },
          {
            text: `Objects: ${source.quota.maxObjects != null ? formatNumber(source.quota.maxObjects) : "Not set"}`,
            tone: sectionChanged ? "added" : undefined,
          },
        ]
      );
    }

    if (features.versioning && source.versioningEnabled !== null) {
      const currentEnabled = normalizeVersioningStatus(props?.versioning_status);
      const currentStatus = formatVersioningStatus(props?.versioning_status);
      const targetStatus = source.versioningEnabled ? "Enabled" : "Suspended";
      const sectionChanged = currentEnabled === null ? true : currentEnabled !== source.versioningEnabled;
      changed = changed || sectionChanged;
      pushSection(
        "Versioning",
        [{ text: currentStatus, tone: sectionChanged ? "removed" : undefined }],
        [{ text: targetStatus, tone: sectionChanged ? "added" : undefined }]
      );
    }

    if (features.object_lock && source.objectLock) {
      const rawCurrentObjectLock =
        props?.object_lock && typeof props.object_lock === "object"
          ? (props.object_lock as Record<string, unknown>)
          : {};
      const currentObjectLock = normalizeObjectLockSnapshot({
        ...rawCurrentObjectLock,
        enabled: Boolean(props?.object_lock_enabled ?? rawCurrentObjectLock.enabled),
      });
      const sectionChanged = !isObjectLockSnapshotEqual(currentObjectLock, source.objectLock);
      changed = changed || sectionChanged;
      pushSection(
        "Object Lock",
        [{ text: formatObjectLockSnapshot(currentObjectLock), tone: sectionChanged ? "removed" : undefined }],
        [{ text: formatObjectLockSnapshot(source.objectLock), tone: sectionChanged ? "added" : undefined }]
      );
    }

    if (features.public_access_block && source.publicAccessBlock) {
      const currentPublicAccessBlock = normalizePublicAccessBlockState(
        await getBucketPublicAccessBlock(selectedEndpointId!, mapping.destinationBucket)
      );
      const sectionChanged = !isPublicAccessBlockEquivalent(currentPublicAccessBlock, source.publicAccessBlock);
      changed = changed || sectionChanged;
      pushSection(
        "Block Public Access",
        [{ text: JSON.stringify(currentPublicAccessBlock, null, 2), tone: sectionChanged ? "removed" : undefined }],
        [{ text: JSON.stringify(source.publicAccessBlock, null, 2), tone: sectionChanged ? "added" : undefined }]
      );
    }

    if (features.lifecycle && source.lifecycleRules) {
      const currentLifecycle = ((await getBucketLifecycle(selectedEndpointId!, mapping.destinationBucket)).rules ??
        []) as Record<string, unknown>[];
      const sectionChanged = stableStringify(currentLifecycle) !== stableStringify(source.lifecycleRules);
      changed = changed || sectionChanged;
      pushSection(
        "Lifecycle",
        currentLifecycle.length === 0
          ? [{ text: "(no rules)" }]
          : currentLifecycle.map((rule) => ({ text: formatLifecycleRule(rule), tone: sectionChanged ? "removed" : undefined })),
        source.lifecycleRules.length === 0
          ? [{ text: "(no rules)" }]
          : source.lifecycleRules.map((rule) => ({ text: formatLifecycleRule(rule), tone: sectionChanged ? "added" : undefined }))
      );
    }

    if (features.cors && source.corsRules) {
      const currentCors = ((await getBucketCors(selectedEndpointId!, mapping.destinationBucket)).rules ??
        []) as Record<string, unknown>[];
      const sectionChanged = stableStringify(currentCors) !== stableStringify(source.corsRules);
      changed = changed || sectionChanged;
      pushSection(
        "CORS",
        currentCors.length === 0
          ? [{ text: "(no rules)" }]
          : currentCors.map((rule) => ({ text: formatCorsRule(rule), tone: sectionChanged ? "removed" : undefined })),
        source.corsRules.length === 0
          ? [{ text: "(no rules)" }]
          : source.corsRules.map((rule) => ({ text: formatCorsRule(rule), tone: sectionChanged ? "added" : undefined }))
      );
    }

    if (features.policy) {
      const currentPolicy = ((await getBucketPolicy(selectedEndpointId!, mapping.destinationBucket)).policy ??
        null) as Record<string, unknown> | null;
      const sectionChanged = stableStringify(currentPolicy) !== stableStringify(source.policy);
      changed = changed || sectionChanged;
      pushSection(
        "Bucket Policy",
        [{ text: currentPolicy ? JSON.stringify(currentPolicy, null, 2) : "(no policy)", tone: sectionChanged ? "removed" : undefined }],
        [{ text: source.policy ? JSON.stringify(source.policy, null, 2) : "(no policy)", tone: sectionChanged ? "added" : undefined }]
      );
    }

    if (features.access_logging && source.accessLogging) {
      const currentAccessLogging = normalizeAccessLoggingSnapshot(
        (await getBucketLogging(selectedEndpointId!, mapping.destinationBucket)) as unknown as Record<string, unknown>
      );
      const sectionChanged = !isAccessLoggingSnapshotEqual(currentAccessLogging, source.accessLogging);
      changed = changed || sectionChanged;
      pushSection(
        "Access logging",
        [{ text: JSON.stringify(currentAccessLogging, null, 2), tone: sectionChanged ? "removed" : undefined }],
        [{ text: JSON.stringify(source.accessLogging, null, 2), tone: sectionChanged ? "added" : undefined }]
      );
    }

    return {
      bucket: mapping.destinationBucket,
      changed,
      before,
      after,
    };
  };

  const runBulkPreview = async () => {
    if (!selectedEndpointId || selectedBucketList.length === 0) return;
    if (!bulkOperation) {
      setBulkPreviewError("Select an operation first.");
      return;
    }
    if (bulkOperation === "copy_configs") {
      setBulkPreviewError("Use 'Copy selected configs' for this operation.");
      return;
    }
    if (bulkOperation === "set_quota" && quotaOperationDisabledReason) {
      setBulkPreviewError(`Set bucket quota is unavailable: ${quotaOperationDisabledReason}.`);
      return;
    }
    if (bulkOperation === "paste_configs") {
      if (bulkPastePlan.error) {
        setBulkPreviewError(bulkPastePlan.error);
        return;
      }
      const runToken = bulkPreviewRunTokenRef.current + 1;
      bulkPreviewRunTokenRef.current = runToken;
      setBulkPreviewLoading(true);
      setBulkPreviewError(null);
      setBulkPreview([]);
      setBulkPreviewReady(false);
      setBulkPreviewProgress({
        label: "Previewing changes",
        completed: 0,
        total: bulkPastePlan.mappings.length,
        failed: 0,
      });
      setBulkApplyError(null);
      setBulkApplySummary(null);
      try {
        const previewResults = await runWithConcurrencySettled(
          bulkPastePlan.mappings,
          BULK_CONCURRENCY_LIMIT,
          async (mapping) => buildPasteConfigPreview(mapping),
          (result) => {
            if (bulkPreviewRunTokenRef.current !== runToken) return;
            setBulkPreviewProgress((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                completed: Math.min(prev.total, prev.completed + 1),
                failed: prev.failed + (result.status === "rejected" ? 1 : 0),
              };
            });
          }
        );
        if (bulkPreviewRunTokenRef.current !== runToken) return;
        const previewItems = previewResults.map((result, index) => {
          const mapping = bulkPastePlan.mappings[index];
          if (result.status === "fulfilled") return result.value;
          return {
            bucket: mapping.destinationBucket,
            before: [{ text: `Source bucket: ${mapping.sourceBucket}` }, { text: "Preview failed." }],
            after: [{ text: `Source bucket: ${mapping.sourceBucket}` }, { text: "Preview failed." }],
            changed: false,
            error: extractError(result.reason),
          };
        });
        setBulkPreview(previewItems);
        setBulkPreviewReady(true);
      } finally {
        if (bulkPreviewRunTokenRef.current === runToken) {
          setBulkPreviewLoading(false);
          setBulkPreviewProgress(null);
        }
      }
      return;
    }
    let parsedQuota: ParsedQuotaInput | null = null;
    let parsedRules: Record<string, unknown>[] | null = null;
    let parsedNotificationConfiguration: Record<string, unknown> | null = null;
    let parsedCorsRules: Record<string, unknown>[] | null = null;
    let parsedPolicyStatements: Record<string, unknown>[] | null = null;
    let deleteIds: Set<string> | null = null;
    let deleteTypes: Set<LifecycleRuleTypeKey> | null = null;
    let deleteNotificationIds: Set<string> | null = null;
    let deleteNotificationTypes: Set<NotificationConfigurationTypeKey> | null = null;
    let deleteCorsIds: Set<string> | null = null;
    let deleteCorsTypes: Set<CorsRuleTypeKey> | null = null;
    let deletePolicyIds: Set<string> | null = null;
    let deletePolicyTypes: Set<PolicyRuleTypeKey> | null = null;
    let publicAccessBlockTargets: PublicAccessBlockOptionKey[] | null = null;
    if (bulkOperation === "set_quota") {
      const parsed = parseQuotaInput(
        bulkQuotaSizeValue,
        bulkQuotaSizeUnit,
        bulkQuotaObjects,
        bulkQuotaApplySize,
        bulkQuotaApplyObjects
      );
      if ("error" in parsed) {
        setBulkPreviewError(parsed.error);
        return;
      }
      parsedQuota = parsed;
    }
    if (bulkOperation === "add_lifecycle") {
      const parsed = parseLifecycleRules(bulkLifecycleRuleText);
      if ("error" in parsed) {
        setBulkPreviewError(parsed.error);
        return;
      }
      if (bulkLifecycleUpdateOnlyExisting && parsed.rules.every((rule) => !getLifecycleRuleId(rule))) {
        setBulkPreviewError("Provide rule IDs when 'only update existing' is enabled.");
        return;
      }
      parsedRules = parsed.rules;
    }
    if (bulkOperation === "add_notifications") {
      const parsed = parseNotificationConfiguration(bulkNotificationText);
      if ("error" in parsed) {
        setBulkPreviewError(parsed.error);
        return;
      }
      parsedNotificationConfiguration = parsed.configuration;
    }
    if (bulkOperation === "delete_notifications") {
      const parsedIds = parseRuleIds(bulkNotificationDeleteIds);
      const parsedTypes = NOTIFICATION_TYPE_OPTIONS.filter((option) => bulkNotificationDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkPreviewError("Provide at least one notification ID or notification type.");
        return;
      }
      deleteNotificationIds = new Set(parsedIds);
      deleteNotificationTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "add_cors") {
      const parsed = parseCorsRules(bulkCorsRuleText);
      if ("error" in parsed) {
        setBulkPreviewError(parsed.error);
        return;
      }
      if (
        bulkCorsUpdateOnlyExisting &&
        parsed.rules.every((rule) => !getLifecycleRuleId(rule) && !getCorsRuleKey(rule))
      ) {
        setBulkPreviewError("Provide rule IDs or matching origins/methods when 'only update existing' is enabled.");
        return;
      }
      parsedCorsRules = parsed.rules;
    }
    if (bulkOperation === "add_policy") {
      const parsed = parsePolicyStatements(bulkPolicyText);
      if ("error" in parsed) {
        setBulkPreviewError(parsed.error);
        return;
      }
      parsedPolicyStatements = parsed.statements;
    }
    if (bulkOperation === "delete_lifecycle") {
      const parsedIds = parseRuleIds(bulkLifecycleDeleteIds);
      const parsedTypes = LIFECYCLE_TYPE_OPTIONS.filter((option) => bulkLifecycleDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkPreviewError("Provide at least one rule ID or rule type.");
        return;
      }
      deleteIds = new Set(parsedIds);
      deleteTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "delete_cors") {
      const parsedIds = parseRuleIds(bulkCorsDeleteIds);
      const parsedTypes = CORS_TYPE_OPTIONS.filter((option) => bulkCorsDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkPreviewError("Provide at least one rule ID or rule type.");
        return;
      }
      deleteCorsIds = new Set(parsedIds);
      deleteCorsTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "delete_policy") {
      const parsedIds = parseRuleIds(bulkPolicyDeleteIds);
      const parsedTypes = POLICY_TYPE_OPTIONS.filter((option) => bulkPolicyDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkPreviewError("Provide at least one statement ID or statement type.");
        return;
      }
      deletePolicyIds = new Set(parsedIds);
      deletePolicyTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") {
      const parsedTargets = PUBLIC_ACCESS_BLOCK_OPTIONS.filter((option) => bulkPublicAccessBlockTargets[option.key]).map(
        (option) => option.key
      );
      if (parsedTargets.length === 0) {
        setBulkPreviewError("Select at least one block public access option.");
        return;
      }
      publicAccessBlockTargets = parsedTargets;
    }

    const runToken = bulkPreviewRunTokenRef.current + 1;
    bulkPreviewRunTokenRef.current = runToken;
    setBulkPreviewLoading(true);
    setBulkPreviewError(null);
    setBulkPreview([]);
    setBulkPreviewReady(false);
    setBulkPreviewProgress({
      label: "Previewing changes",
      completed: 0,
      total: selectedBucketList.length,
      failed: 0,
    });
    setBulkApplyError(null);
    setBulkApplySummary(null);
    try {
      const desiredEnabled = bulkOperation === "enable_versioning";
      const desiredPublicAccessBlockEnabled = bulkOperation === "add_public_access_block";
      const previewResults = await runWithConcurrencySettled(
        selectedBucketList,
        BULK_CONCURRENCY_LIMIT,
        async (bucketName) => {
          if (bulkOperation === "set_quota" && parsedQuota) {
            return await buildQuotaPreview(bucketName, parsedQuota, bulkQuotaSkipConfigured);
          }
          if (
            (bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") &&
            publicAccessBlockTargets
          ) {
            return await buildPublicAccessBlockPreview(bucketName, desiredPublicAccessBlockEnabled, publicAccessBlockTargets);
          }
          if (bulkOperation === "enable_versioning" || bulkOperation === "disable_versioning") {
            return await buildVersioningPreview(bucketName, desiredEnabled);
          }
          if (bulkOperation === "add_lifecycle" && parsedRules) {
            return await buildLifecyclePreview(bucketName, parsedRules);
          }
          if (bulkOperation === "delete_lifecycle" && deleteIds && deleteTypes) {
            return await buildLifecycleDeletePreview(bucketName, deleteIds, deleteTypes);
          }
          if (bulkOperation === "add_notifications" && parsedNotificationConfiguration) {
            return await buildNotificationsPreview(bucketName, parsedNotificationConfiguration);
          }
          if (bulkOperation === "delete_notifications" && deleteNotificationIds && deleteNotificationTypes) {
            return await buildNotificationsDeletePreview(bucketName, deleteNotificationIds, deleteNotificationTypes);
          }
          if (bulkOperation === "add_cors" && parsedCorsRules) {
            return await buildCorsPreview(bucketName, parsedCorsRules);
          }
          if (bulkOperation === "delete_cors" && deleteCorsIds && deleteCorsTypes) {
            return await buildCorsDeletePreview(bucketName, deleteCorsIds, deleteCorsTypes);
          }
          if (bulkOperation === "add_policy" && parsedPolicyStatements) {
            return await buildPolicyPreview(bucketName, parsedPolicyStatements);
          }
          if (bulkOperation === "delete_policy" && deletePolicyIds && deletePolicyTypes) {
            return await buildPolicyDeletePreview(bucketName, deletePolicyIds, deletePolicyTypes);
          }
          return {
            bucket: bucketName,
            before: [{ text: "-" }],
            after: [{ text: "-" }],
            changed: false,
          };
        },
        (result) => {
          if (bulkPreviewRunTokenRef.current !== runToken) return;
          setBulkPreviewProgress((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              completed: Math.min(prev.total, prev.completed + 1),
              failed: prev.failed + (result.status === "rejected" ? 1 : 0),
            };
          });
        }
      );
      if (bulkPreviewRunTokenRef.current !== runToken) return;
      const previewItems = previewResults.map((result, index) => {
        const bucketName = selectedBucketList[index];
        if (result.status === "fulfilled") return result.value;
        return {
          bucket: bucketName,
          before: [{ text: "Preview failed." }],
          after: [{ text: "Preview failed." }],
          changed: false,
          error: extractError(result.reason),
        };
      });
      setBulkPreview(previewItems);
      setBulkPreviewReady(true);
    } finally {
      if (bulkPreviewRunTokenRef.current === runToken) {
        setBulkPreviewLoading(false);
        setBulkPreviewProgress(null);
      }
    }
  };

  const applyBulkUpdate = async () => {
    if (!selectedEndpointId || selectedBucketList.length === 0) return;
    if (!bulkOperation) {
      setBulkApplyError("Select an operation first.");
      return;
    }
    if (bulkOperation === "copy_configs") {
      setBulkApplyError("Use 'Copy selected configs' for this operation.");
      return;
    }
    if (bulkOperation === "set_quota" && quotaOperationDisabledReason) {
      setBulkApplyError(`Set bucket quota is unavailable: ${quotaOperationDisabledReason}.`);
      return;
    }
    if (bulkOperation === "paste_configs") {
      if (bulkPastePlan.error) {
        setBulkApplyError(bulkPastePlan.error);
        return;
      }
      setBulkApplyLoading(true);
      setBulkApplyError(null);
      setBulkApplySummary(null);
      setBulkApplyProgress({
        label: "Applying changes",
        completed: 0,
        total: bulkPastePlan.mappings.length,
        failed: 0,
      });

      const results = await runWithConcurrencySettled(
        bulkPastePlan.mappings,
        BULK_CONCURRENCY_LIMIT,
        async (mapping) => {
          const features = bulkConfigClipboard?.features;
          if (!features) {
            throw new Error("Copied configuration is no longer available.");
          }
          const source = mapping.sourceConfig;
          let changed = false;

          let props: BucketProperties | null = null;
          if (features.versioning || features.object_lock) {
            props = await getBucketProperties(selectedEndpointId, mapping.destinationBucket);
          }

          if (!isStorageOps && features.quota && source.quota && updateBucketQuota) {
            const currentQuota = await fetchBucketQuota(mapping.destinationBucket);
            const quotaChanged =
              currentQuota.maxSizeBytes !== source.quota.maxSizeBytes || currentQuota.maxObjects !== source.quota.maxObjects;
            if (quotaChanged) {
              const payloadSizeGb = source.quota.maxSizeBytes != null ? bytesToGiB(source.quota.maxSizeBytes) : null;
              await updateBucketQuota(selectedEndpointId, mapping.destinationBucket, {
                max_size_gb: payloadSizeGb,
                max_size_unit: payloadSizeGb != null ? "GiB" : null,
                max_objects: source.quota.maxObjects,
              });
              changed = true;
            }
          }

          if (features.versioning && source.versioningEnabled !== null) {
            const currentEnabled = normalizeVersioningStatus(props?.versioning_status);
            const versioningChanged = currentEnabled === null ? true : currentEnabled !== source.versioningEnabled;
            if (versioningChanged) {
              await setBucketVersioning(selectedEndpointId, mapping.destinationBucket, source.versioningEnabled);
              changed = true;
            }
          }

          if (features.object_lock && source.objectLock) {
            const rawCurrentObjectLock =
              props?.object_lock && typeof props.object_lock === "object"
                ? (props.object_lock as Record<string, unknown>)
                : {};
            const currentObjectLock = normalizeObjectLockSnapshot({
              ...rawCurrentObjectLock,
              enabled: Boolean(props?.object_lock_enabled ?? rawCurrentObjectLock.enabled),
            });
            if (!isObjectLockSnapshotEqual(currentObjectLock, source.objectLock)) {
              await updateBucketObjectLock(selectedEndpointId, mapping.destinationBucket, source.objectLock);
              changed = true;
            }
          }

          if (features.public_access_block && source.publicAccessBlock) {
            const currentPublicAccessBlock = normalizePublicAccessBlockState(
              await getBucketPublicAccessBlock(selectedEndpointId, mapping.destinationBucket)
            );
            if (!isPublicAccessBlockEquivalent(currentPublicAccessBlock, source.publicAccessBlock)) {
              await updateBucketPublicAccessBlock(selectedEndpointId, mapping.destinationBucket, source.publicAccessBlock);
              changed = true;
            }
          }

          if (features.lifecycle && source.lifecycleRules) {
            const currentLifecycle = (
              (await getBucketLifecycle(selectedEndpointId, mapping.destinationBucket)).rules ?? []
            ) as Record<string, unknown>[];
            if (stableStringify(currentLifecycle) !== stableStringify(source.lifecycleRules)) {
              if (source.lifecycleRules.length === 0) {
                if (currentLifecycle.length > 0) {
                  await deleteBucketLifecycle(selectedEndpointId, mapping.destinationBucket);
                  changed = true;
                }
              } else {
                await putBucketLifecycle(selectedEndpointId, mapping.destinationBucket, source.lifecycleRules);
                changed = true;
              }
            }
          }

          if (features.cors && source.corsRules) {
            const currentCors = (
              (await getBucketCors(selectedEndpointId, mapping.destinationBucket)).rules ?? []
            ) as Record<string, unknown>[];
            if (stableStringify(currentCors) !== stableStringify(source.corsRules)) {
              if (source.corsRules.length === 0) {
                if (currentCors.length > 0) {
                  await deleteBucketCors(selectedEndpointId, mapping.destinationBucket);
                  changed = true;
                }
              } else {
                await putBucketCors(selectedEndpointId, mapping.destinationBucket, source.corsRules);
                changed = true;
              }
            }
          }

          if (features.policy) {
            const currentPolicy = (
              (await getBucketPolicy(selectedEndpointId, mapping.destinationBucket)).policy ?? null
            ) as Record<string, unknown> | null;
            if (stableStringify(currentPolicy) !== stableStringify(source.policy)) {
              if (!source.policy) {
                if (currentPolicy) {
                  await deleteBucketPolicy(selectedEndpointId, mapping.destinationBucket);
                  changed = true;
                }
              } else {
                await putBucketPolicy(selectedEndpointId, mapping.destinationBucket, source.policy);
                changed = true;
              }
            }
          }

          if (features.access_logging && source.accessLogging) {
            const currentAccessLogging = normalizeAccessLoggingSnapshot(
              (await getBucketLogging(selectedEndpointId, mapping.destinationBucket)) as unknown as Record<string, unknown>
            );
            if (!isAccessLoggingSnapshotEqual(currentAccessLogging, source.accessLogging)) {
              const hasTargetBucket = Boolean(source.accessLogging.target_bucket);
              if (!source.accessLogging.enabled || !hasTargetBucket) {
                if (currentAccessLogging.enabled || currentAccessLogging.target_bucket) {
                  await deleteBucketLogging(selectedEndpointId, mapping.destinationBucket);
                  changed = true;
                }
              } else {
                await putBucketLogging(selectedEndpointId, mapping.destinationBucket, {
                  enabled: source.accessLogging.enabled,
                  target_bucket: source.accessLogging.target_bucket,
                  target_prefix: source.accessLogging.target_prefix ?? "",
                });
                changed = true;
              }
            }
          }

          return { changed };
        },
        (result) => {
          setBulkApplyProgress((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              completed: Math.min(prev.total, prev.completed + 1),
              failed: prev.failed + (result.status === "rejected" ? 1 : 0),
            };
          });
        }
      );

      const failed = results.filter((result) => result.status === "rejected");
      const changedCount = results.filter(
        (result): result is PromiseFulfilledResult<{ changed: boolean }> =>
          result.status === "fulfilled" && result.value.changed
      ).length;
      const unchangedCount = results.filter(
        (result): result is PromiseFulfilledResult<{ changed: boolean }> =>
          result.status === "fulfilled" && !result.value.changed
      ).length;
      if (failed.length > 0) {
        setBulkApplyError(`${failed.length} bucket(s) failed to update.`);
      }
      setBulkApplySummary(
        `Updated ${changedCount} bucket${changedCount !== 1 ? "s" : ""}${unchangedCount > 0 ? ` (${unchangedCount} unchanged)` : ""}.`
      );
      setBulkApplyLoading(false);
      refreshBuckets();
      return;
    }
    let parsedQuota: ParsedQuotaInput | null = null;
    let parsedRules: Record<string, unknown>[] | null = null;
    let parsedNotificationConfiguration: Record<string, unknown> | null = null;
    let parsedCorsRules: Record<string, unknown>[] | null = null;
    let parsedPolicyStatements: Record<string, unknown>[] | null = null;
    let parsedPolicy: Record<string, unknown> | null = null;
    let deleteIds: Set<string> | null = null;
    let deleteTypes: Set<LifecycleRuleTypeKey> | null = null;
    let deleteNotificationIds: Set<string> | null = null;
    let deleteNotificationTypes: Set<NotificationConfigurationTypeKey> | null = null;
    let deleteCorsIds: Set<string> | null = null;
    let deleteCorsTypes: Set<CorsRuleTypeKey> | null = null;
    let deletePolicyIds: Set<string> | null = null;
    let deletePolicyTypes: Set<PolicyRuleTypeKey> | null = null;
    let publicAccessBlockTargets: PublicAccessBlockOptionKey[] | null = null;
    if (bulkOperation === "set_quota") {
      const parsed = parseQuotaInput(
        bulkQuotaSizeValue,
        bulkQuotaSizeUnit,
        bulkQuotaObjects,
        bulkQuotaApplySize,
        bulkQuotaApplyObjects
      );
      if ("error" in parsed) {
        setBulkApplyError(parsed.error);
        return;
      }
      parsedQuota = parsed;
    }
    if (bulkOperation === "add_lifecycle") {
      const parsed = parseLifecycleRules(bulkLifecycleRuleText);
      if ("error" in parsed) {
        setBulkApplyError(parsed.error);
        return;
      }
      if (bulkLifecycleUpdateOnlyExisting && parsed.rules.every((rule) => !getLifecycleRuleId(rule))) {
        setBulkApplyError("Provide rule IDs when 'only update existing' is enabled.");
        return;
      }
      parsedRules = parsed.rules;
    }
    if (bulkOperation === "add_notifications") {
      const parsed = parseNotificationConfiguration(bulkNotificationText);
      if ("error" in parsed) {
        setBulkApplyError(parsed.error);
        return;
      }
      parsedNotificationConfiguration = parsed.configuration;
    }
    if (bulkOperation === "delete_notifications") {
      const parsedIds = parseRuleIds(bulkNotificationDeleteIds);
      const parsedTypes = NOTIFICATION_TYPE_OPTIONS.filter((option) => bulkNotificationDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkApplyError("Provide at least one notification ID or notification type.");
        return;
      }
      deleteNotificationIds = new Set(parsedIds);
      deleteNotificationTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "add_cors") {
      const parsed = parseCorsRules(bulkCorsRuleText);
      if ("error" in parsed) {
        setBulkApplyError(parsed.error);
        return;
      }
      if (
        bulkCorsUpdateOnlyExisting &&
        parsed.rules.every((rule) => !getLifecycleRuleId(rule) && !getCorsRuleKey(rule))
      ) {
        setBulkApplyError("Provide rule IDs or matching origins/methods when 'only update existing' is enabled.");
        return;
      }
      parsedCorsRules = parsed.rules;
    }
    if (bulkOperation === "add_policy") {
      const parsed = parsePolicyStatements(bulkPolicyText);
      if ("error" in parsed) {
        setBulkApplyError(parsed.error);
        return;
      }
      parsedPolicyStatements = parsed.statements;
      parsedPolicy = parsed.policy as Record<string, unknown>;
    }
    if (bulkOperation === "delete_lifecycle") {
      const parsedIds = parseRuleIds(bulkLifecycleDeleteIds);
      const parsedTypes = LIFECYCLE_TYPE_OPTIONS.filter((option) => bulkLifecycleDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkApplyError("Provide at least one rule ID or rule type.");
        return;
      }
      deleteIds = new Set(parsedIds);
      deleteTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "delete_cors") {
      const parsedIds = parseRuleIds(bulkCorsDeleteIds);
      const parsedTypes = CORS_TYPE_OPTIONS.filter((option) => bulkCorsDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkApplyError("Provide at least one rule ID or rule type.");
        return;
      }
      deleteCorsIds = new Set(parsedIds);
      deleteCorsTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "delete_policy") {
      const parsedIds = parseRuleIds(bulkPolicyDeleteIds);
      const parsedTypes = POLICY_TYPE_OPTIONS.filter((option) => bulkPolicyDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkApplyError("Provide at least one statement ID or statement type.");
        return;
      }
      deletePolicyIds = new Set(parsedIds);
      deletePolicyTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") {
      const parsedTargets = PUBLIC_ACCESS_BLOCK_OPTIONS.filter((option) => bulkPublicAccessBlockTargets[option.key]).map(
        (option) => option.key
      );
      if (parsedTargets.length === 0) {
        setBulkApplyError("Select at least one block public access option.");
        return;
      }
      publicAccessBlockTargets = parsedTargets;
    }

    setBulkApplyLoading(true);
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress({
      label: "Applying changes",
      completed: 0,
      total: selectedBucketList.length,
      failed: 0,
    });

    const desiredEnabled = bulkOperation === "enable_versioning";
    const desiredPublicAccessBlockEnabled = bulkOperation === "add_public_access_block";
    const results = await runWithConcurrencySettled(
      selectedBucketList,
      BULK_CONCURRENCY_LIMIT,
      async (bucketName) => {
        if (bulkOperation === "set_quota" && parsedQuota && updateBucketQuota) {
          const currentQuota = await fetchBucketQuota(bucketName);
          if (bulkQuotaSkipConfigured && hasConfiguredQuota(currentQuota)) {
            return { changed: false };
          }
          const currentSize = currentQuota.maxSizeBytes;
          const currentObjects = currentQuota.maxObjects;
          const nextSize = parsedQuota.applySize ? parsedQuota.maxSizeBytes : currentSize;
          const nextObjects = parsedQuota.applyObjects ? parsedQuota.maxObjects : currentObjects;
          if (currentSize === nextSize && currentObjects === nextObjects) {
            return { changed: false };
          }
          const payloadSizeGb =
            nextSize != null
              ? parsedQuota.applySize && parsedQuota.maxSizeValue != null
                ? parsedQuota.maxSizeValue
                : bytesToGiB(nextSize)
              : null;
          const payloadSizeUnit =
            nextSize != null
              ? parsedQuota.applySize && parsedQuota.maxSizeValue != null
                ? parsedQuota.maxSizeUnit
                : "GiB"
              : null;
          await updateBucketQuota(selectedEndpointId, bucketName, {
            max_size_gb: payloadSizeGb,
            max_size_unit: payloadSizeUnit,
            max_objects: nextObjects,
          });
          return { changed: true };
        }
        if (
          (bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") &&
          publicAccessBlockTargets
        ) {
          const current = normalizePublicAccessBlockState(
            await getBucketPublicAccessBlock(selectedEndpointId, bucketName)
          );
          const target = applyPublicAccessBlockTargets(current, desiredPublicAccessBlockEnabled, publicAccessBlockTargets);
          if (isPublicAccessBlockEquivalent(current, target)) {
            return { changed: false };
          }
          await updateBucketPublicAccessBlock(selectedEndpointId, bucketName, target);
          return { changed: true };
        }
        if (bulkOperation === "enable_versioning" || bulkOperation === "disable_versioning") {
          const props = await getBucketProperties(selectedEndpointId, bucketName);
          const currentEnabled = normalizeVersioningStatus(props.versioning_status);
          const shouldApply = currentEnabled === null ? true : currentEnabled !== desiredEnabled;
          if (!shouldApply) return { changed: false };
          await setBucketVersioning(selectedEndpointId, bucketName, desiredEnabled);
          return { changed: true };
        }
        if (bulkOperation === "add_lifecycle" && parsedRules) {
          const lifecycle = await getBucketLifecycle(selectedEndpointId, bucketName);
          const existingRules = lifecycle.rules ?? [];
          const { nextRules, changes } = mergeLifecycleRules(
            existingRules as Record<string, unknown>[],
            parsedRules,
            { onlyUpdateExisting: bulkLifecycleUpdateOnlyExisting }
          );
          if (changes.length === 0) return { changed: false };
          await putBucketLifecycle(selectedEndpointId, bucketName, nextRules);
          return { changed: true };
        }
        if (bulkOperation === "delete_lifecycle" && deleteIds && deleteTypes) {
          const lifecycle = await getBucketLifecycle(selectedEndpointId, bucketName);
          const existingRules = lifecycle.rules ?? [];
          const shouldDeleteRule = (rule: Record<string, unknown>) => {
            const ruleId = getLifecycleRuleId(rule);
            if (ruleId && deleteIds.has(ruleId)) return true;
            if (deleteTypes.size === 0) return false;
            const ruleTypes = getLifecycleRuleTypes(rule);
            return ruleTypes.some((type) => deleteTypes.has(type));
          };
          const nextRules = existingRules.filter(
            (rule) => !shouldDeleteRule(rule as Record<string, unknown>)
          ) as Record<string, unknown>[];
          if (nextRules.length === existingRules.length) return { changed: false };
          if (nextRules.length === 0) {
            await deleteBucketLifecycle(selectedEndpointId, bucketName);
            return { changed: true };
          }
          await putBucketLifecycle(selectedEndpointId, bucketName, nextRules);
          return { changed: true };
        }
        if (bulkOperation === "add_notifications" && parsedNotificationConfiguration) {
          const notifications = await getBucketNotifications(selectedEndpointId, bucketName);
          const currentConfiguration = notifications.configuration ?? {};
          const { configuration: nextConfiguration, changes } = mergeNotificationConfigurations(
            currentConfiguration,
            parsedNotificationConfiguration
          );
          if (changes.length === 0) return { changed: false };
          await putBucketNotifications(selectedEndpointId, bucketName, nextConfiguration);
          return { changed: true };
        }
        if (bulkOperation === "delete_notifications" && deleteNotificationIds && deleteNotificationTypes) {
          const notifications = await getBucketNotifications(selectedEndpointId, bucketName);
          const currentConfiguration = notifications.configuration ?? {};
          const { configuration: nextConfiguration, changes } = deleteNotificationConfigurations(
            currentConfiguration,
            deleteNotificationIds,
            deleteNotificationTypes
          );
          if (changes.length === 0) return { changed: false };
          if (isNotificationConfigurationEmpty(nextConfiguration)) {
            await deleteBucketNotifications(selectedEndpointId, bucketName);
            return { changed: true };
          }
          await putBucketNotifications(selectedEndpointId, bucketName, nextConfiguration);
          return { changed: true };
        }
        if (bulkOperation === "add_cors" && parsedCorsRules) {
          const cors = await getBucketCors(selectedEndpointId, bucketName);
          const existingRules = cors.rules ?? [];
          const { nextRules, changes } = mergeCorsRules(
            existingRules as Record<string, unknown>[],
            parsedCorsRules,
            { onlyUpdateExisting: bulkCorsUpdateOnlyExisting }
          );
          if (changes.length === 0) return { changed: false };
          await putBucketCors(selectedEndpointId, bucketName, nextRules);
          return { changed: true };
        }
        if (bulkOperation === "delete_cors" && deleteCorsIds && deleteCorsTypes) {
          const cors = await getBucketCors(selectedEndpointId, bucketName);
          const existingRules = cors.rules ?? [];
          const shouldDeleteRule = (rule: Record<string, unknown>) => {
            const ruleId = getLifecycleRuleId(rule);
            if (ruleId && deleteCorsIds.has(ruleId)) return true;
            if (deleteCorsTypes.size === 0) return false;
            const ruleTypes = getCorsRuleTypes(rule);
            return ruleTypes.some((type) => deleteCorsTypes.has(type));
          };
          const nextRules = existingRules.filter(
            (rule) => !shouldDeleteRule(rule as Record<string, unknown>)
          ) as Record<string, unknown>[];
          if (nextRules.length === existingRules.length) return { changed: false };
          if (nextRules.length === 0) {
            await deleteBucketCors(selectedEndpointId, bucketName);
            return { changed: true };
          }
          await putBucketCors(selectedEndpointId, bucketName, nextRules);
          return { changed: true };
        }
        if (bulkOperation === "add_policy" && parsedPolicyStatements) {
          const policy = await getBucketPolicy(selectedEndpointId, bucketName);
          const existingPolicy = policy.policy ?? {};
          const existingStatements = Array.isArray((existingPolicy as Record<string, unknown>).Statement)
            ? ((existingPolicy as Record<string, unknown>).Statement as Record<string, unknown>[])
            : [];
          const { nextStatements, changes } = mergePolicyStatements(
            existingStatements,
            parsedPolicyStatements,
            { onlyUpdateExisting: bulkPolicyUpdateOnlyExisting }
          );
          if (changes.length === 0) return { changed: false };
          const nextPolicy = {
            ...(Object.keys(existingPolicy).length > 0 ? (existingPolicy as Record<string, unknown>) : (parsedPolicy ?? {})),
            Statement: nextStatements,
          };
          await putBucketPolicy(selectedEndpointId, bucketName, nextPolicy);
          return { changed: true };
        }
        if (bulkOperation === "delete_policy" && deletePolicyIds && deletePolicyTypes) {
          const policy = await getBucketPolicy(selectedEndpointId, bucketName);
          const existingPolicy = policy.policy ?? {};
          const existingStatements = Array.isArray((existingPolicy as Record<string, unknown>).Statement)
            ? ((existingPolicy as Record<string, unknown>).Statement as Record<string, unknown>[])
            : [];
          const shouldDeleteStatement = (statement: Record<string, unknown>) => {
            const sid = getPolicyStatementSid(statement);
            if (sid && deletePolicyIds.has(sid)) return true;
            if (deletePolicyTypes.size === 0) return false;
            const types = getPolicyStatementTypes(statement);
            return types.some((type) => deletePolicyTypes.has(type));
          };
          const nextStatements = existingStatements.filter(
            (statement) => !shouldDeleteStatement(statement as Record<string, unknown>)
          ) as Record<string, unknown>[];
          if (nextStatements.length === existingStatements.length) return { changed: false };
          if (nextStatements.length === 0) {
            await deleteBucketPolicy(selectedEndpointId, bucketName);
            return { changed: true };
          }
          const nextPolicy = {
            ...(existingPolicy as Record<string, unknown>),
            Statement: nextStatements,
          };
          await putBucketPolicy(selectedEndpointId, bucketName, nextPolicy);
          return { changed: true };
        }
        return { changed: false };
      },
      (result) => {
        setBulkApplyProgress((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            completed: Math.min(prev.total, prev.completed + 1),
            failed: prev.failed + (result.status === "rejected" ? 1 : 0),
          };
        });
      }
    );

    const failed = results.filter((result) => result.status === "rejected");
    const changedCount = results.filter(
      (result): result is PromiseFulfilledResult<{ changed: boolean }> =>
        result.status === "fulfilled" && result.value.changed
    ).length;
    const unchangedCount = results.filter(
      (result): result is PromiseFulfilledResult<{ changed: boolean }> =>
        result.status === "fulfilled" && !result.value.changed
    ).length;

    if (failed.length > 0) {
      setBulkApplyError(`${failed.length} bucket(s) failed to update.`);
    }
    setBulkApplySummary(
      `Updated ${changedCount} bucket${changedCount !== 1 ? "s" : ""}${unchangedCount > 0 ? ` (${unchangedCount} unchanged)` : ""}.`
    );
    setBulkApplyLoading(false);
    refreshBuckets();
  };

  const updateAdvancedField = (field: AdvancedTextOrNumericField, value: string) => {
    setAdvancedDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateAdvancedContextIds = (values: string[]) => {
    const contextIds = normalizeAdvancedSelectionValues(values);
    setAdvancedDraft((prev) => ({ ...prev, contextIds }));
  };

  const toggleAdvancedContextId = (contextId: string) => {
    const current = normalizeAdvancedSelectionValues(advancedDraft.contextIds);
    if (current.includes(contextId)) {
      updateAdvancedContextIds(current.filter((id) => id !== contextId));
      return;
    }
    updateAdvancedContextIds([...current, contextId]);
  };

  const selectFilteredStorageOpsContexts = () => {
    const seen = new Set(normalizeAdvancedSelectionValues(advancedDraft.contextIds));
    const next = [...seen];
    filteredStorageOpsContextItems.forEach((context) => {
      if (seen.has(context.id)) return;
      seen.add(context.id);
      next.push(context.id);
    });
    updateAdvancedContextIds(next);
  };

  const deselectFilteredStorageOpsContexts = () => {
    const filteredIds = new Set(filteredStorageOpsContextItems.map((context) => context.id));
    updateAdvancedContextIds(normalizeAdvancedSelectionValues(advancedDraft.contextIds).filter((id) => !filteredIds.has(id)));
  };

  const updateAdvancedEndpointNames = (values: string[]) => {
    setAdvancedDraft((prev) => ({ ...prev, endpointNames: normalizeAdvancedSelectionValues(values) }));
  };

  const toggleAdvancedEndpointName = (endpointName: string) => {
    const current = normalizeAdvancedSelectionValues(advancedDraft.endpointNames);
    if (current.includes(endpointName)) {
      updateAdvancedEndpointNames(current.filter((name) => name !== endpointName));
      return;
    }
    updateAdvancedEndpointNames([...current, endpointName]);
  };

  const selectFilteredStorageOpsEndpoints = () => {
    const seen = new Set(normalizeAdvancedSelectionValues(advancedDraft.endpointNames));
    const next = [...seen];
    filteredStorageOpsEndpointItems.forEach((endpoint) => {
      if (seen.has(endpoint.name)) return;
      seen.add(endpoint.name);
      next.push(endpoint.name);
    });
    updateAdvancedEndpointNames(next);
  };

  const deselectFilteredStorageOpsEndpoints = () => {
    const filteredNames = new Set(filteredStorageOpsEndpointItems.map((endpoint) => endpoint.name));
    updateAdvancedEndpointNames(
      normalizeAdvancedSelectionValues(advancedDraft.endpointNames).filter((name) => !filteredNames.has(name))
    );
  };

  const updateAdvancedMatchMode = (
    field: "tenantMatchMode" | "ownerMatchMode" | "ownerNameMatchMode" | "s3TagsMatchMode",
    value: TextMatchMode
  ) => {
    setAdvancedDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateFeatureFilter = (feature: FeatureKey, value: FeatureFilterState) => {
    setAdvancedDraft((prev) => ({ ...prev, features: { ...prev.features, [feature]: value } }));
  };

  const updateFeatureDetailFilter = (
    field: FeatureDetailFilterKey,
    value: FeatureDetailFilters[FeatureDetailFilterKey]
  ) => {
    setAdvancedDraft((prev) => ({
      ...prev,
      featureDetails: {
        ...prev.featureDetails,
        [field]: value,
      },
    }));
  };

  const closeAdvancedFilterDrawer = () => {
    setShowAdvancedFilter(false);
  };

  const applyAdvancedFilter = () => {
    setAdvancedApplied(advancedDraft);
    setPage(1);
    setShowAdvancedFilter(false);
  };

  const resetAdvancedFilter = () => {
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setPage(1);
  };

  const advancedFiltersApplied = hasAdvancedFilters(advancedApplied, isStorageOps, usageFeatureEnabled, featureSupport);
  const advancedAppliedPayload = useMemo(
    () => buildAdvancedFilterPayload("", "contains", advancedApplied, null, isStorageOps, usageFeatureEnabled, featureSupport),
    [advancedApplied, isStorageOps, usageFeatureEnabled, featureSupport]
  );
  const advancedDraftPayload = useMemo(
    () => buildAdvancedFilterPayload("", "contains", advancedDraft, null, isStorageOps, usageFeatureEnabled, featureSupport),
    [advancedDraft, isStorageOps, usageFeatureEnabled, featureSupport]
  );
  const hasPendingAdvancedChanges = advancedDraftPayload !== advancedAppliedPayload;
  const hasAnyAdvancedToClear = advancedDraftPayload !== undefined || advancedAppliedPayload !== undefined;
  const advancedFilterCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedFilter && hasPendingAdvancedChanges,
    onClose: closeAdvancedFilterDrawer,
    zIndexClass: "z-[70]",
  });
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
  const toggleAdvancedFilterSecondarySection = (sectionId: AdvancedFilterSecondarySectionId) => {
    setAdvancedFilterSecondarySections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
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
  const {
    contextDraftIds,
    endpointDraftNames,
    tenantDraftEffectiveMatchMode,
    tenantDraftForcesExact,
    ownerDraftEffectiveMatchMode,
    ownerDraftForcesExact,
    ownerNameDraftEffectiveMatchMode,
    ownerNameDraftForcesExact,
    s3TagsDraftEffectiveMatchMode,
    s3TagsDraftForcesExact,
    contextFieldState,
    endpointFieldState,
    tenantFieldState,
    ownerFieldState,
    ownerNameFieldState,
    ownerSuspendedFieldState,
    s3TagsFieldState,
    quickFilterFieldState,
    quickFilterPending,
    advancedDraftRangeCount,
    advancedDraftFeatureCount,
    advancedDraftFeatureDetailCount,
    advancedDraftActiveCount,
    advancedDraftGlobalCostLevel,
    advancedDraftGlobalCostTooltip,
  } = useMemo(
    () =>
      buildBucketOpsAdvancedFilterUiProjection({
        advancedApplied,
        advancedDraft,
        featureSupport,
        isStorageOps,
        quickFilterApplied: filterValue,
        quickFilterDraft: filter,
        usageFeatureEnabled,
      }),
    [
      advancedApplied,
      advancedDraft,
      featureSupport,
      filter,
      filterValue,
      isStorageOps,
      usageFeatureEnabled,
    ]
  );
  useEffect(() => {
    if (showAdvancedFilter && !advancedFilterWasOpenRef.current) {
      setAdvancedFilterSecondarySections(
        buildAdvancedFilterSecondarySectionState({
          metrics: advancedDraftRangeCount,
          featureStates: advancedDraftFeatureCount,
          featureDetails: advancedDraftFeatureDetailCount,
        })
      );
    }
    advancedFilterWasOpenRef.current = showAdvancedFilter;
  }, [showAdvancedFilter, advancedDraftRangeCount, advancedDraftFeatureCount, advancedDraftFeatureDetailCount]);
  const toggleQuickFilterMode = () => {
    if (quickFilterDraftForcesExact) return;
    setQuickFilterMode((prev) => (prev === "contains" ? "exact" : "contains"));
    setPage(1);
  };
  const resetAllFilters = () => {
    setFilter("");
    setFilterValue("");
    setQuickFilterMode("contains");
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setTagFilters([]);
    setTagFilterMode("any");
    setShowAdvancedFilter(false);
    setPage(1);
  };
  const clearAdvancedTextOrNumericField = (field: AdvancedTextOrNumericField) => {
    setAdvancedDraft((prev) => ({ ...prev, [field]: "" }));
    setAdvancedApplied((prev) => (prev ? { ...prev, [field]: "" } : prev));
    setPage(1);
  };
  const clearAdvancedContextIds = () => {
    setAdvancedDraft((prev) => ({ ...prev, contextIds: [] }));
    setAdvancedApplied((prev) => (prev ? { ...prev, contextIds: [] } : prev));
    setPage(1);
  };
  const clearAdvancedEndpointNames = () => {
    setAdvancedDraft((prev) => ({ ...prev, endpointNames: [] }));
    setAdvancedApplied((prev) => (prev ? { ...prev, endpointNames: [] } : prev));
    setPage(1);
  };
  const clearAdvancedOwnerScope = () => {
    setAdvancedDraft((prev) => ({ ...prev, ownerNameScope: "any" }));
    setAdvancedApplied((prev) => (prev ? { ...prev, ownerNameScope: "any" } : prev));
    setPage(1);
  };
  const clearAdvancedOwnerSuspended = () => {
    setAdvancedDraft((prev) => ({ ...prev, ownerSuspended: "any" }));
    setAdvancedApplied((prev) => (prev ? { ...prev, ownerSuspended: "any" } : prev));
    setPage(1);
  };
  const clearAdvancedFeatureField = (feature: FeatureKey) => {
    setAdvancedDraft((prev) => ({ ...prev, features: { ...prev.features, [feature]: "any" } }));
    setAdvancedApplied((prev) => (prev ? { ...prev, features: { ...prev.features, [feature]: "any" } } : prev));
    setPage(1);
  };
  const clearAdvancedFeatureDetailFilterField = (field: FeatureDetailFilterKey) => {
    setAdvancedDraft((prev) => ({ ...prev, featureDetails: clearFeatureDetailField(prev.featureDetails, field) }));
    setAdvancedApplied((prev) =>
      prev ? { ...prev, featureDetails: clearFeatureDetailField(prev.featureDetails, field) } : prev
    );
    setPage(1);
  };
  const removeActiveFilterItem = (action: ActiveFilterRemoveAction) => {
    if (action.type === "quick") {
      setFilter("");
      setFilterValue("");
      setPage(1);
      return;
    }
    if (action.type === "tag_mode") {
      setTagFilterMode("any");
      setPage(1);
      return;
    }
    if (action.type === "tag") {
      if (typeof action.tag === "number") removeTagFilter(action.tag);
      return;
    }
    if (action.type === "advanced_owner_scope") {
      clearAdvancedOwnerScope();
      return;
    }
    if (action.type === "advanced_owner_suspended") {
      clearAdvancedOwnerSuspended();
      return;
    }
    if (action.type === "advanced_context_ids") {
      clearAdvancedContextIds();
      return;
    }
    if (action.type === "advanced_endpoint_names") {
      clearAdvancedEndpointNames();
      return;
    }
    if (action.type === "advanced_text" || action.type === "advanced_numeric") {
      clearAdvancedTextOrNumericField(action.field);
      return;
    }
    if (action.type === "advanced_feature_detail") {
      clearAdvancedFeatureDetailFilterField(action.field);
      return;
    }
    clearAdvancedFeatureField(action.feature);
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
    persistBucketListState(bucketsStateStorageKey, selectedEndpointId, {
      filter,
      quickFilterMode,
      advancedApplied,
      tagFilters,
      tagFilterMode,
      page,
      pageSize,
      sort,
    });
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
                        onClick={() => addTagFilter(tag)}
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
                onClick={() => setShowAdvancedFilter(true)}
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
                              <div className={advancedFilterFieldCardClass("md:col-span-2")}>
                                <div className="flex items-center justify-between gap-2">
                                  <label
                                    className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${contextFieldState.labelClass}`}
                                  >
                                    <span className="inline-flex items-center gap-1">
                                      <span>Context</span>
                                      {renderFilterCostIndicator("low", "Low cost: context filter runs on direct listing metadata.")}
                                    </span>
                                  </label>
                                  <span className="ui-caption text-slate-500 dark:text-slate-400">
                                    {contextDraftIds.length}/{storageOpsContextItems.length}
                                  </span>
                                </div>
                                <div className="mt-2 flex items-center gap-1.5">
                                  <input
                                    value={storageOpsContextFilter}
                                    onChange={(event) => setStorageOpsContextFilter(event.target.value)}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    aria-label="Filter contexts"
                                    placeholder="Filter contexts"
                                    className={advancedFilterControlClass(`min-w-0 flex-1 px-2 py-1 font-normal ${contextFieldState.fieldClass}`)}
                                  />
                                  <UiButton
                                    type="button"
                                    onClick={selectFilteredStorageOpsContexts}
                                    disabled={filteredStorageOpsContextItems.length === 0 || allFilteredStorageOpsContextsSelected}
                                    variant="secondary"
                                    size="xs"
                                  >
                                    Select filtered
                                  </UiButton>
                                  <UiButton
                                    type="button"
                                    onClick={deselectFilteredStorageOpsContexts}
                                    disabled={!hasFilteredStorageOpsContextSelection}
                                    variant="secondary"
                                    size="xs"
                                  >
                                    Deselect filtered
                                  </UiButton>
                                </div>
                                <div className="mt-2 max-h-36 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
                                  {storageOpsContextsLoading ? (
                                    <p className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">Loading contexts...</p>
                                  ) : storageOpsContextsError ? (
                                    <p className="px-2 py-2 ui-caption text-rose-600 dark:text-rose-300">{storageOpsContextsError}</p>
                                  ) : filteredStorageOpsContextItems.length === 0 ? (
                                    <p className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">No matching context.</p>
                                  ) : (
                                    filteredStorageOpsContextItems.map((context) => {
                                      const selected = storageOpsContextSelectionSet.has(context.id);
                                      return (
                                        <label
                                          key={context.id}
                                          className={`flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70 ${
                                            selected ? "bg-primary/5 dark:bg-primary-500/10" : ""
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={selected}
                                            onChange={() => toggleAdvancedContextId(context.id)}
                                            className={uiCheckboxClass}
                                          />
                                          <div className="min-w-0 flex-1">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                              <span className="truncate ui-caption font-semibold text-slate-800 dark:text-slate-100">
                                                {context.name}
                                              </span>
                                              <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1 py-0 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                {context.typeLabel}
                                              </span>
                                            </span>
                                            <div className="mt-0.5 flex min-w-0 items-center gap-1">
                                              <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                                                {context.endpointName ?? context.id}
                                              </span>
                                              <UiTagBadgeList
                                                items={context.tagItems}
                                                maxVisible={2}
                                                variant="listing-compact"
                                                layout="inline-compact"
                                                className="max-w-[9rem]"
                                              />
                                            </div>
                                          </div>
                                        </label>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            )}

                            {isStorageOps && (
                              <div className={advancedFilterFieldCardClass("md:col-span-2")}>
                                <div className="flex items-center justify-between gap-2">
                                  <label
                                    className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${endpointFieldState.labelClass}`}
                                  >
                                    <span className="inline-flex items-center gap-1">
                                      <span>Endpoint</span>
                                      {renderFilterCostIndicator("low", "Low cost: endpoint filter runs on direct listing metadata.")}
                                    </span>
                                  </label>
                                  <span className="ui-caption text-slate-500 dark:text-slate-400">
                                    {endpointDraftNames.length}/{storageOpsEndpointItems.length}
                                  </span>
                                </div>
                                <div className="mt-2 flex items-center gap-1.5">
                                  <input
                                    value={storageOpsEndpointFilter}
                                    onChange={(event) => setStorageOpsEndpointFilter(event.target.value)}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    aria-label="Filter endpoints"
                                    placeholder="Filter endpoints"
                                    className={advancedFilterControlClass(`min-w-0 flex-1 px-2 py-1 font-normal ${endpointFieldState.fieldClass}`)}
                                  />
                                  <UiButton
                                    type="button"
                                    onClick={selectFilteredStorageOpsEndpoints}
                                    disabled={filteredStorageOpsEndpointItems.length === 0 || allFilteredStorageOpsEndpointsSelected}
                                    variant="secondary"
                                    size="xs"
                                  >
                                    Select filtered
                                  </UiButton>
                                  <UiButton
                                    type="button"
                                    onClick={deselectFilteredStorageOpsEndpoints}
                                    disabled={!hasFilteredStorageOpsEndpointSelection}
                                    variant="secondary"
                                    size="xs"
                                  >
                                    Deselect filtered
                                  </UiButton>
                                </div>
                                <div className="mt-2 max-h-36 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
                                  {storageOpsContextsLoading ? (
                                    <p className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">Loading endpoints...</p>
                                  ) : storageOpsContextsError ? (
                                    <p className="px-2 py-2 ui-caption text-rose-600 dark:text-rose-300">{storageOpsContextsError}</p>
                                  ) : filteredStorageOpsEndpointItems.length === 0 ? (
                                    <p className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">No matching endpoint.</p>
                                  ) : (
                                    filteredStorageOpsEndpointItems.map((endpoint) => {
                                      const selected = storageOpsEndpointSelectionSet.has(endpoint.name);
                                      return (
                                        <label
                                          key={endpoint.name}
                                          className={`flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70 ${
                                            selected ? "bg-primary/5 dark:bg-primary-500/10" : ""
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={selected}
                                            onChange={() => toggleAdvancedEndpointName(endpoint.name)}
                                            className={uiCheckboxClass}
                                          />
                                          <div className="min-w-0 flex-1">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                              <span className="truncate ui-caption font-semibold text-slate-800 dark:text-slate-100">
                                                {endpoint.name}
                                              </span>
                                              <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1 py-0 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                {endpoint.contextNames.length}
                                              </span>
                                            </span>
                                            <div className="mt-0.5 flex min-w-0 items-center gap-1">
                                              <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                                                {formatBucketNamesPreview(endpoint.contextNames, 2)}
                                              </span>
                                              <UiTagBadgeList
                                                items={endpoint.tagItems}
                                                maxVisible={2}
                                                variant="listing-compact"
                                                layout="inline-compact"
                                                className="max-w-[9rem]"
                                              />
                                            </div>
                                          </div>
                                        </label>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            )}

                            <div className={advancedFilterFieldCardClass()}>
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${tenantFieldState.labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>Tenant</span>
                                    {renderFilterCostIndicator("low", "Low cost: tenant filter runs on direct bucket metadata.")}
                                  </span>
                                </label>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={tenantDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("tenantMatchMode", "contains")}
                                    className={advancedFilterMatchModeButtonClass(tenantDraftEffectiveMatchMode === "contains", tenantDraftForcesExact)}
                                  >
                                    Contains
                                  </button>
                                  <button
                                    type="button"
                                    disabled={tenantDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("tenantMatchMode", "exact")}
                                    className={advancedFilterMatchModeButtonClass(tenantDraftEffectiveMatchMode === "exact", tenantDraftForcesExact)}
                                  >
                                    Exact
                                  </button>
                                </div>
                              </div>
                              <textarea
                                value={advancedDraft.tenant}
                                onChange={(e) => updateAdvancedField("tenant", e.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                                placeholder="tenant-a, tenant-b"
                                rows={2}
                                className={advancedFilterControlClass(`mt-2 w-full resize-y px-2 py-1.5 font-normal ${tenantFieldState.fieldClass}`)}
                              />
                            </div>

                            <div className={advancedFilterFieldCardClass()}>
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${ownerFieldState.labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>Owner</span>
                                    {renderFilterCostIndicator("low", "Low cost: owner filter runs on direct bucket metadata.")}
                                  </span>
                                </label>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={ownerDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("ownerMatchMode", "contains")}
                                    className={advancedFilterMatchModeButtonClass(ownerDraftEffectiveMatchMode === "contains", ownerDraftForcesExact)}
                                  >
                                    Contains
                                  </button>
                                  <button
                                    type="button"
                                    disabled={ownerDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("ownerMatchMode", "exact")}
                                    className={advancedFilterMatchModeButtonClass(ownerDraftEffectiveMatchMode === "exact", ownerDraftForcesExact)}
                                  >
                                    Exact
                                  </button>
                                </div>
                              </div>
                              <textarea
                                value={advancedDraft.owner}
                                onChange={(e) => updateAdvancedField("owner", e.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                                placeholder="owner uid(s)"
                                rows={2}
                                className={advancedFilterControlClass(`mt-2 w-full resize-y px-2 py-1.5 font-normal ${ownerFieldState.fieldClass}`)}
                              />
                            </div>

                            <div className={advancedFilterFieldCardClass("md:col-span-2")}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <label
                                  className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${ownerNameFieldState.labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>Owner name</span>
                                    {renderFilterCostIndicator("medium", "Medium cost: owner-name filters require owner identity lookups.")}
                                  </span>
                                </label>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={ownerNameDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("ownerNameMatchMode", "contains")}
                                    className={advancedFilterMatchModeButtonClass(ownerNameDraftEffectiveMatchMode === "contains", ownerNameDraftForcesExact)}
                                  >
                                    Contains
                                  </button>
                                  <button
                                    type="button"
                                    disabled={ownerNameDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("ownerNameMatchMode", "exact")}
                                    className={advancedFilterMatchModeButtonClass(ownerNameDraftEffectiveMatchMode === "exact", ownerNameDraftForcesExact)}
                                  >
                                    Exact
                                  </button>
                                </div>
                              </div>
                              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
                                <textarea
                                  value={advancedDraft.ownerName}
                                  onChange={(e) => updateAdvancedField("ownerName", e.target.value)}
                                  onKeyDown={(event) => event.stopPropagation()}
                                  placeholder="display name(s)"
                                  rows={2}
                                  className={advancedFilterControlClass(`w-full resize-y px-2 py-1.5 font-normal ${ownerNameFieldState.fieldClass}`)}
                                />
                                <select
                                  value={advancedDraft.ownerNameScope}
                                  onChange={(e) => setAdvancedDraft((prev) => ({ ...prev, ownerNameScope: e.target.value as OwnerNameScope }))}
                                  className={advancedFilterControlClass(`px-2 py-1.5 font-normal ${ownerNameFieldState.fieldClass}`)}
                                  title="Owner entity scope"
                                >
                                  <option value="any">Accounts + Users</option>
                                  <option value="account">Accounts only</option>
                                  <option value="user">Users only</option>
                                </select>
                              </div>
                            </div>

                            <div className={advancedFilterFieldCardClass()}>
                              <label
                                className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${ownerSuspendedFieldState.labelClass}`}
                              >
                                <span className="inline-flex items-center gap-1">
                                  <span>Owner suspended</span>
                                  {renderFilterCostIndicator("medium", "Medium cost: owner-suspended filters require owner status lookups.")}
                                </span>
                              </label>
                              <select
                                value={advancedDraft.ownerSuspended}
                                onChange={(e) =>
                                  setAdvancedDraft((prev) => ({
                                    ...prev,
                                    ownerSuspended: e.target.value as BooleanFilterState,
                                  }))
                                }
                                className={advancedFilterControlClass(`mt-2 w-full px-2 py-1.5 font-normal ${ownerSuspendedFieldState.fieldClass}`)}
                              >
                                {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className={advancedFilterFieldCardClass("md:col-span-2")}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <label
                                  className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${s3TagsFieldState.labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>S3 tags</span>
                                    {renderFilterCostIndicator("high", "High cost: S3 tag filters require bucket tag retrieval.")}
                                  </span>
                                </label>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={s3TagsDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("s3TagsMatchMode", "contains")}
                                    className={advancedFilterMatchModeButtonClass(s3TagsDraftEffectiveMatchMode === "contains", s3TagsDraftForcesExact)}
                                  >
                                    Contains
                                  </button>
                                  <button
                                    type="button"
                                    disabled={s3TagsDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("s3TagsMatchMode", "exact")}
                                    className={advancedFilterMatchModeButtonClass(s3TagsDraftEffectiveMatchMode === "exact", s3TagsDraftForcesExact)}
                                  >
                                    Exact
                                  </button>
                                </div>
                              </div>
                              <textarea
                                value={advancedDraft.s3Tags}
                                onChange={(e) => updateAdvancedField("s3Tags", e.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                                placeholder="env=prod, team=storage"
                                rows={2}
                                className={advancedFilterControlClass(`mt-2 w-full resize-y px-2 py-1.5 font-normal ${s3TagsFieldState.fieldClass}`)}
                              />
                              <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                Comma or newline separated expressions. Format examples: <code>key=value</code>, <code>env</code>.
                              </p>
                            </div>
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
                            <div className="space-y-3">
                            {!usageFeatureEnabled && (
                              <p className="ui-caption text-slate-500 dark:text-slate-400">
                                {usageUnavailableDescription}
                              </p>
                            )}
                            <div className="grid gap-3 lg:grid-cols-2">
                              {[
                                {
                                  title: "Usage",
                                  disabled: !usageFeatureEnabled,
                                  rows: [
                                    { label: "Bytes", minId: "minUsedBytes" as const, maxId: "maxUsedBytes" as const },
                                    { label: "Objects", minId: "minObjects" as const, maxId: "maxObjects" as const },
                                  ],
                                },
                                {
                                  title: "Quota",
                                  disabled: !usageFeatureEnabled,
                                  rows: [
                                    { label: "Bytes", minId: "minQuotaBytes" as const, maxId: "maxQuotaBytes" as const },
                                    { label: "Objects", minId: "minQuotaObjects" as const, maxId: "maxQuotaObjects" as const },
                                  ],
                                },
                                {
                                  title: "Quota usage %",
                                  disabled: !usageFeatureEnabled,
                                  rows: [
                                    {
                                      label: "Size %",
                                      minId: "minQuotaUsageSizePercent" as const,
                                      maxId: "maxQuotaUsageSizePercent" as const,
                                    },
                                    {
                                      label: "Objects %",
                                      minId: "minQuotaUsageObjectPercent" as const,
                                      maxId: "maxQuotaUsageObjectPercent" as const,
                                    },
                                  ],
                                },
                                {
                                  title: "Owner quota",
                                  disabled: false,
                                  rows: [
                                    { label: "Bytes", minId: "minOwnerQuotaBytes" as const, maxId: "maxOwnerQuotaBytes" as const },
                                    { label: "Objects", minId: "minOwnerQuotaObjects" as const, maxId: "maxOwnerQuotaObjects" as const },
                                  ],
                                },
                                {
                                  title: "Owner usage",
                                  disabled: !usageFeatureEnabled,
                                  rows: [
                                    { label: "Bytes", minId: "minOwnerUsedBytes" as const, maxId: "maxOwnerUsedBytes" as const },
                                    { label: "Objects", minId: "minOwnerObjects" as const, maxId: "maxOwnerObjects" as const },
                                  ],
                                },
                                {
                                  title: "Owner usage %",
                                  disabled: !usageFeatureEnabled,
                                  rows: [
                                    {
                                      label: "Size %",
                                      minId: "minOwnerQuotaUsageSizePercent" as const,
                                      maxId: "maxOwnerQuotaUsageSizePercent" as const,
                                    },
                                    {
                                      label: "Objects %",
                                      minId: "minOwnerQuotaUsageObjectPercent" as const,
                                      maxId: "maxOwnerQuotaUsageObjectPercent" as const,
                                    },
                                  ],
                                },
                              ].map((section) => (
                                <div
                                  key={section.title}
                                  className={advancedFilterFieldCardClass(section.disabled ? "opacity-75" : "")}
                                >
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    {section.title}
                                  </p>
                                  {section.disabled && (
                                    <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                      Requires bucket stats.
                                    </p>
                                  )}
                                  <div className="mt-2 space-y-2">
                                    {section.rows.map((row) => {
                                      const minApplied = (advancedApplied?.[row.minId] ?? "").trim();
                                      const minDraft = advancedDraft[row.minId].trim();
                                      const maxApplied = (advancedApplied?.[row.maxId] ?? "").trim();
                                      const maxDraft = advancedDraft[row.maxId].trim();
                                      const rowState = buildAdvancedFilterFieldState(
                                        Boolean(minApplied || maxApplied),
                                        minDraft !== minApplied || maxDraft !== maxApplied
                                      );
                                      const minState = buildAdvancedFilterFieldState(Boolean(minApplied), minDraft !== minApplied);
                                      const maxState = buildAdvancedFilterFieldState(Boolean(maxApplied), maxDraft !== maxApplied);
                                      return (
                                        <div key={`${section.title}:${row.label}`}>
                                          <label className={`ui-caption font-medium text-slate-600 dark:text-slate-300 ${rowState.labelClass}`}>{row.label}</label>
                                          <div className="mt-1 grid grid-cols-2 gap-2">
                                            <input
                                              type="number"
                                              min="0"
                                              inputMode="numeric"
                                              value={advancedDraft[row.minId]}
                                              onChange={(e) => updateAdvancedField(row.minId, e.target.value)}
                                              placeholder="min"
                                              disabled={section.disabled}
                                              className={advancedFilterControlClass(`w-full px-2 py-1.5 font-normal ${minState.fieldClass}`, section.disabled)}
                                            />
                                            <input
                                              type="number"
                                              min="0"
                                              inputMode="numeric"
                                              value={advancedDraft[row.maxId]}
                                              onChange={(e) => updateAdvancedField(row.maxId, e.target.value)}
                                              placeholder="max"
                                              disabled={section.disabled}
                                              className={advancedFilterControlClass(`w-full px-2 py-1.5 font-normal ${maxState.fieldClass}`, section.disabled)}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          ),
                        })}

                        {renderAdvancedFilterSecondarySection({
                          id: "featureStates",
                          title: "Feature states",
                          costLevel: "high",
                          costTooltip: "High cost: feature-state filters may trigger extra checks.",
                          activeCount: advancedDraftFeatureCount,
                          children: (
                            <>
                              {featureStateOptions.some((feature) => !feature.supported) && (
                                <p className="mb-3 ui-caption text-slate-500 dark:text-slate-400">
                                  Some features are disabled on this endpoint and cannot be filtered.
                                </p>
                              )}
                              <div className="grid gap-2 sm:grid-cols-2">
                                {featureStateOptions.map((feature) => {
                                  const disabled = !feature.supported;
                                  const appliedValue = advancedApplied?.features[feature.id] ?? "any";
                                  const draftValue = advancedDraft.features[feature.id];
                                  const state = disabled
                                    ? { labelClass: "", fieldClass: "" }
                                    : buildAdvancedFilterFieldState(appliedValue !== "any", draftValue !== appliedValue);
                                  return (
                                    <div
                                      key={feature.id}
                                      className={`rounded-lg border border-slate-200 p-2.5 dark:border-slate-700 ${disabled ? "opacity-60" : ""}`}
                                    >
                                      <label className={`ui-caption font-medium text-slate-700 dark:text-slate-200 ${state.labelClass}`}>{feature.label}</label>
                                      <select
                                        value={advancedDraft.features[feature.id]}
                                        onChange={(e) => updateFeatureFilter(feature.id, e.target.value as FeatureFilterState)}
                                        className={advancedFilterControlClass(`mt-1 w-full px-2 py-1.5 font-normal ${state.fieldClass}`, disabled)}
                                        disabled={disabled}
                                      >
                                        {feature.id === "versioning" ? (
                                          <>
                                            <option value="any">Any</option>
                                            <option value="enabled">Enabled</option>
                                            <option value="disabled">Disabled</option>
                                            <option value="suspended">Suspended</option>
                                            <option value="disabled_or_suspended">Disabled or Suspended</option>
                                          </>
                                        ) : (
                                          <>
                                            <option value="any">Any</option>
                                            <option value="enabled">Enabled</option>
                                            <option value="disabled">Disabled</option>
                                          </>
                                        )}
                                      </select>
                                      {disabled && (
                                        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                          {feature.label} is disabled on this endpoint.
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          ),
                        })}

                        {renderAdvancedFilterSecondarySection({
                          id: "featureDetails",
                          title: "Feature details",
                          costLevel: "high",
                          costTooltip: "High cost: feature-detail filters may trigger additional per-bucket data retrieval.",
                          activeCount: advancedDraftFeatureDetailCount,
                          children: (
                            <div className="grid gap-3 lg:grid-cols-2">
                            <div className={advancedFilterFieldCardClass()}>
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Lifecycle
                              </p>
                              <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                Rule name, status, type and lifecycle day conditions are evaluated on the same lifecycle rule.
                              </p>
                              <div className="mt-2 space-y-2">
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule name</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleRuleNameMode}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleRuleNameMode",
                                          e.target.value as FeatureDetailFilters["lifecycleRuleNameMode"]
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="any">Any</option>
                                      <option value="has_named">Has named rule</option>
                                      <option value="has_not_named">Has no named rule</option>
                                    </select>
                                    <input
                                      type="text"
                                      value={advancedDraft.featureDetails.lifecycleRuleName}
                                      onChange={(e) => updateFeatureDetailFilter("lifecycleRuleName", e.target.value)}
                                      placeholder="rule-id"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule status</label>
                                  <select
                                    value={advancedDraft.featureDetails.lifecycleRuleStatus}
                                    onChange={(e) =>
                                      updateFeatureDetailFilter(
                                        "lifecycleRuleStatus",
                                        e.target.value as FeatureDetailFilters["lifecycleRuleStatus"]
                                      )
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    <option value="">Any</option>
                                    <option value="Enabled">Enabled</option>
                                    <option value="Disabled">Disabled</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule type</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleRuleTypeMode}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleRuleTypeMode",
                                          e.target.value as FeatureDetailFilters["lifecycleRuleTypeMode"]
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="any">Any</option>
                                      <option value="has">Has rule type</option>
                                      <option value="has_not">Has no rule type</option>
                                    </select>
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleRuleTypeValue}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleRuleTypeValue",
                                          e.target.value as FeatureDetailFilters["lifecycleRuleTypeValue"]
                                        )
                                      }
                                      disabled={advancedDraft.featureDetails.lifecycleRuleTypeMode === "any"}
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="">Select type</option>
                                      {LIFECYCLE_TYPE_OPTIONS.map((option) => (
                                        <option key={option.key} value={option.key}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Expiration days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleExpirationDaysOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleExpirationDaysOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.lifecycleExpirationDays}
                                      onChange={(e) => updateFeatureDetailFilter("lifecycleExpirationDays", e.target.value)}
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Noncurrent expiration days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleNoncurrentExpirationDaysOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleNoncurrentExpirationDaysOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.lifecycleNoncurrentExpirationDays}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter("lifecycleNoncurrentExpirationDays", e.target.value)
                                      }
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Transition days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleTransitionDaysOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleTransitionDaysOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.lifecycleTransitionDays}
                                      onChange={(e) => updateFeatureDetailFilter("lifecycleTransitionDays", e.target.value)}
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Abort days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleAbortDaysOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleAbortDaysOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.lifecycleAbortDays}
                                      onChange={(e) => updateFeatureDetailFilter("lifecycleAbortDays", e.target.value)}
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className={advancedFilterFieldCardClass()}>
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Notifications
                              </p>
                              <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                Rule ID, type, topic, events and key filters are evaluated on the same notification rule.
                              </p>
                              <div className="mt-2 space-y-2">
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule ID</label>
                                  <input
                                    type="text"
                                    value={advancedDraft.featureDetails.notificationRuleId}
                                    onChange={(e) => updateFeatureDetailFilter("notificationRuleId", e.target.value)}
                                    placeholder="rule-id"
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule type</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.notificationRuleTypeMode}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "notificationRuleTypeMode",
                                          e.target.value as FeatureDetailFilters["notificationRuleTypeMode"]
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="any">Any</option>
                                      <option value="has">Has</option>
                                      <option value="has_not">Has not</option>
                                    </select>
                                    <select
                                      value={advancedDraft.featureDetails.notificationRuleTypeValue}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "notificationRuleTypeValue",
                                          e.target.value as FeatureDetailFilters["notificationRuleTypeValue"]
                                        )
                                      }
                                      disabled={advancedDraft.featureDetails.notificationRuleTypeMode === "any"}
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="">Select type</option>
                                      {NOTIFICATION_TYPE_OPTIONS.filter((option) => option.key !== "eventbridge").map((option) => (
                                        <option key={option.key} value={option.key}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Topic name or ARN</label>
                                  <input
                                    type="text"
                                    value={advancedDraft.featureDetails.notificationTopicName}
                                    onChange={(e) => updateFeatureDetailFilter("notificationTopicName", e.target.value)}
                                    placeholder="bucket-events"
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </div>
                                {[
                                  {
                                    modeKey: "notificationEventMode" as const,
                                    valueKey: "notificationEventValue" as const,
                                    label: "Event",
                                    placeholder: "s3:ObjectCreated:*",
                                  },
                                  {
                                    modeKey: "notificationFilterPrefixMode" as const,
                                    valueKey: "notificationFilterPrefixValue" as const,
                                    label: "Filter prefix",
                                    placeholder: "incoming/",
                                  },
                                  {
                                    modeKey: "notificationFilterSuffixMode" as const,
                                    valueKey: "notificationFilterSuffixValue" as const,
                                    label: "Filter suffix",
                                    placeholder: ".csv",
                                  },
                                ].map((entry) => (
                                  <div key={entry.valueKey}>
                                    <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">{entry.label}</label>
                                    <div className="mt-1 grid grid-cols-5 gap-2">
                                      <select
                                        value={advancedDraft.featureDetails[entry.modeKey]}
                                        onChange={(e) =>
                                          updateFeatureDetailFilter(
                                            entry.modeKey,
                                            e.target.value as FeatureDetailFilters[typeof entry.modeKey]
                                          )
                                        }
                                        className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      >
                                        <option value="any">Any</option>
                                        <option value="has">Has</option>
                                        <option value="has_not">Has not</option>
                                      </select>
                                      <input
                                        type="text"
                                        value={advancedDraft.featureDetails[entry.valueKey]}
                                        onChange={(e) => updateFeatureDetailFilter(entry.valueKey, e.target.value)}
                                        placeholder={entry.placeholder}
                                        className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      />
                                    </div>
                                  </div>
                                ))}
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">EventBridge present</label>
                                  <select
                                    value={advancedDraft.featureDetails.notificationEventBridgePresent}
                                    onChange={(e) =>
                                      updateFeatureDetailFilter(
                                        "notificationEventBridgePresent",
                                        e.target.value as FeatureDetailFilters["notificationEventBridgePresent"]
                                      )
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>

                            <div className={advancedFilterFieldCardClass()}>
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Object Lock and BPA
                              </p>
                              <div className="mt-2 space-y-2">
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Object Lock mode</label>
                                  <select
                                    value={advancedDraft.featureDetails.objectLockMode}
                                    onChange={(e) =>
                                      updateFeatureDetailFilter(
                                        "objectLockMode",
                                        e.target.value as FeatureDetailFilters["objectLockMode"]
                                      )
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    <option value="">Any</option>
                                    <option value="GOVERNANCE">GOVERNANCE</option>
                                    <option value="COMPLIANCE">COMPLIANCE</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Object Lock retention days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.objectLockRetentionOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "objectLockRetentionOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.objectLockRetentionDays}
                                      onChange={(e) => updateFeatureDetailFilter("objectLockRetentionDays", e.target.value)}
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Object Lock retention years</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.objectLockRetentionYearsOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "objectLockRetentionYearsOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.objectLockRetentionYears}
                                      onChange={(e) => updateFeatureDetailFilter("objectLockRetentionYears", e.target.value)}
                                      placeholder="years"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  {[
                                    { key: "bpaBlockPublicAcls" as const, label: "Block public ACLs" },
                                    { key: "bpaIgnorePublicAcls" as const, label: "Ignore public ACLs" },
                                    { key: "bpaBlockPublicPolicy" as const, label: "Block public policy" },
                                    { key: "bpaRestrictPublicBuckets" as const, label: "Restrict public buckets" },
                                  ].map((entry) => (
                                    <div key={entry.key}>
                                      <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">{entry.label}</label>
                                      <select
                                        value={advancedDraft.featureDetails[entry.key]}
                                        onChange={(e) =>
                                          updateFeatureDetailFilter(
                                            entry.key,
                                            e.target.value as FeatureDetailFilters[typeof entry.key]
                                          )
                                        }
                                        className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      >
                                        {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className={advancedFilterFieldCardClass()}>
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                CORS and Logging
                              </p>
                              <div className="mt-2 space-y-2">
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">CORS method</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.corsMethodMode}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "corsMethodMode",
                                          e.target.value as FeatureDetailFilters["corsMethodMode"]
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="any">Any</option>
                                      <option value="has">Has</option>
                                      <option value="has_not">Has not</option>
                                    </select>
                                    <input
                                      type="text"
                                      value={advancedDraft.featureDetails.corsMethodValue}
                                      onChange={(e) => updateFeatureDetailFilter("corsMethodValue", e.target.value)}
                                      placeholder="GET"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">CORS origin</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.corsOriginMode}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "corsOriginMode",
                                          e.target.value as FeatureDetailFilters["corsOriginMode"]
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="any">Any</option>
                                      <option value="has">Has</option>
                                      <option value="has_not">Has not</option>
                                    </select>
                                    <input
                                      type="text"
                                      value={advancedDraft.featureDetails.corsOriginValue}
                                      onChange={(e) => updateFeatureDetailFilter("corsOriginValue", e.target.value)}
                                      placeholder="https://example.test"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Logging enabled</label>
                                  <select
                                    value={advancedDraft.featureDetails.loggingEnabled}
                                    onChange={(e) =>
                                      updateFeatureDetailFilter(
                                        "loggingEnabled",
                                        e.target.value as FeatureDetailFilters["loggingEnabled"]
                                      )
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Logging target bucket</label>
                                  <input
                                    type="text"
                                    value={advancedDraft.featureDetails.loggingTargetBucket}
                                    onChange={(e) => updateFeatureDetailFilter("loggingTargetBucket", e.target.value)}
                                    placeholder="audit-bucket"
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Logging target prefix</label>
                                  <input
                                    type="text"
                                    value={advancedDraft.featureDetails.loggingTargetPrefix}
                                    onChange={(e) => updateFeatureDetailFilter("loggingTargetPrefix", e.target.value)}
                                    placeholder="logs/"
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </div>
                              </div>
                            </div>

                            <div className={advancedFilterFieldCardClass()}>
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Website and Policy
                              </p>
                              <div className="mt-2 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website index present</label>
                                    <select
                                      value={advancedDraft.featureDetails.websiteIndexPresent}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "websiteIndexPresent",
                                          e.target.value as FeatureDetailFilters["websiteIndexPresent"]
                                        )
                                      }
                                      className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website redirect host present</label>
                                    <select
                                      value={advancedDraft.featureDetails.websiteRedirectHostPresent}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "websiteRedirectHostPresent",
                                          e.target.value as FeatureDetailFilters["websiteRedirectHostPresent"]
                                        )
                                      }
                                      className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website index document</label>
                                    <input
                                      type="text"
                                      value={advancedDraft.featureDetails.websiteIndexDocument}
                                      onChange={(e) => updateFeatureDetailFilter("websiteIndexDocument", e.target.value)}
                                      placeholder="index.html"
                                      className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                  <div>
                                    <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website error document</label>
                                    <input
                                      type="text"
                                      value={advancedDraft.featureDetails.websiteErrorDocument}
                                      onChange={(e) => updateFeatureDetailFilter("websiteErrorDocument", e.target.value)}
                                      placeholder="error.html"
                                      className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website redirect host</label>
                                  <input
                                    type="text"
                                    value={advancedDraft.featureDetails.websiteRedirectHost}
                                    onChange={(e) => updateFeatureDetailFilter("websiteRedirectHost", e.target.value)}
                                    placeholder="www.example.test"
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website routing rules</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.websiteRoutingRuleCountOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "websiteRoutingRuleCountOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.websiteRoutingRuleCount}
                                      onChange={(e) => updateFeatureDetailFilter("websiteRoutingRuleCount", e.target.value)}
                                      placeholder="count"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Policy statements</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.policyStatementOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "policyStatementOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.policyStatementCount}
                                      onChange={(e) => updateFeatureDetailFilter("policyStatementCount", e.target.value)}
                                      placeholder="count"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Policy has conditions</label>
                                  <select
                                    value={advancedDraft.featureDetails.policyHasConditions}
                                    onChange={(e) =>
                                      updateFeatureDetailFilter(
                                        "policyHasConditions",
                                        e.target.value as FeatureDetailFilters["policyHasConditions"]
                                      )
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>

                            <div className={advancedFilterFieldCardClass(sseFeatureEnabled ? "" : "opacity-60")}>
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Server-side encryption
                              </p>
                              {!sseFeatureEnabled && (
                                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                  Server-side encryption is disabled on this endpoint.
                                </p>
                              )}
                              <div className="mt-2 space-y-2">
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">SSE algorithm</label>
                                  <input
                                    type="text"
                                    value={advancedDraft.featureDetails.sseAlgorithm}
                                    onChange={(e) => updateFeatureDetailFilter("sseAlgorithm", e.target.value)}
                                    placeholder="AES256"
                                    disabled={!sseFeatureEnabled}
                                    className={advancedFilterControlClass("mt-1 w-full px-2 py-1.5", !sseFeatureEnabled)}
                                  />
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">SSE KMS key ID</label>
                                  <input
                                    type="text"
                                    value={advancedDraft.featureDetails.sseKmsKeyId}
                                    onChange={(e) => updateFeatureDetailFilter("sseKmsKeyId", e.target.value)}
                                    placeholder="key-id or ARN"
                                    disabled={!sseFeatureEnabled}
                                    className={advancedFilterControlClass("mt-1 w-full px-2 py-1.5", !sseFeatureEnabled)}
                                  />
                                </div>
                              </div>
                            </div>
                            </div>
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
          onClose={() => setIndexCheckTargets(null)}
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

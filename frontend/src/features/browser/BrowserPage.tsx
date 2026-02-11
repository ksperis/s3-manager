/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { unstable_usePrompt, useSearchParams } from "react-router-dom";
import JSZip from "jszip";
import { ZipWriter } from "@zip.js/zip.js";
import axios from "axios";
import TableEmptyState from "../../components/TableEmptyState";
import { formatBytes } from "../../utils/format";
import { withS3AccountParam, type S3AccountSelector } from "../../api/accountParams";
import { getBucketLogging, getBucketPolicy, getBucketProperties, getBucketWebsite, listBuckets } from "../../api/buckets";
import {
  BrowserBucket,
  BrowserObject,
  BrowserObjectVersion,
  BrowserSettings,
  BucketCorsStatus,
  ObjectMetadata,
  ObjectTag,
  PresignPartRequest,
  PresignRequest,
  StsCredentials,
  StsStatus,
  copyObject,
  cleanupObjectVersions,
  createFolder,
  deleteObjects,
  getBucketVersioning,
  fetchObjectMetadata,
  getBucketCorsStatus,
  ensureBucketCors,
  getStsCredentials,
  getObjectTags,
  getStsStatus,
  initiateMultipartUpload,
  listBrowserBuckets,
  listBrowserObjects,
  listObjectVersions,
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
  abortMultipartUpload,
} from "../../api/browser";
import { useBrowserContext } from "./BrowserContext";
import BrowserBulkAttributesModal from "./BrowserBulkAttributesModal";
import BrowserBulkRestoreModal from "./BrowserBulkRestoreModal";
import BrowserCleanupModal from "./BrowserCleanupModal";
import BrowserContextMenu from "./BrowserContextMenu";
import BrowserOperationsModal from "./BrowserOperationsModal";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";
import BrowserObjectVersionsModal from "./BrowserObjectVersionsModal";
import BrowserPrefixVersionsModal from "./BrowserPrefixVersionsModal";
import BrowserPreviewModal from "./BrowserPreviewModal";
import ObjectAdvancedModal from "./ObjectAdvancedModal";
import { presignObjectWithSts, presignPartWithSts } from "./stsPresigner";
import {
  BucketIcon,
  ChevronDownIcon,
  CompactIcon,
  CopyIcon,
  CutIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  GridIcon,
  HistoryIcon,
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
  MULTIPART_THRESHOLD,
  NAME_COLUMN_CONTROLS_MIN_WIDTH,
  OBJECTS_PAGE_SIZE,
  PART_SIZE,
  VERSIONS_PAGE_SIZE,
  aclOptions,
  bucketButtonClasses,
  bulkActionClasses,
  bulkDangerClasses,
  breadcrumbIconButtonClasses,
  countBadgeClasses,
  filterChipActiveClasses,
  filterChipClasses,
  gridQuickActionClasses,
  gridQuickActionDangerClasses,
  gridTitleClampStyle,
  iconButtonClasses,
  iconButtonDangerClasses,
  storageClassChipClasses,
  storageClassOptions,
  toolbarButtonClasses,
  treeItemActiveClasses,
  treeItemBaseClasses,
  treeItemInactiveClasses,
  treeToggleButtonClasses,
  viewToggleActiveClasses,
  viewToggleBaseClasses,
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
  isAudioFile,
  isImageFile,
  isPdfFile,
  isTextFile,
  isVideoFile,
  makeId,
  normalizeEtag,
  normalizePrefix,
  normalizeUploadPath,
  parseKeyValueLines,
  pairsToRecord,
  previewKindForItem,
  previewLabelForItem,
  shortName,
  toIsoString,
  updateTreeNodes,
} from "./browserUtils";
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
  allowFoldersPanel?: boolean;
  allowInspectorPanel?: boolean;
  showPanelToggles?: boolean;
  defaultShowFolders?: boolean;
  defaultShowInspector?: boolean;
};

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

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
const DEFAULT_STREAMING_ZIP_THRESHOLD_MB = 200;
const PATH_SUGGESTIONS_DEBOUNCE_MS = 200;
const PATH_SUGGESTIONS_LIMIT = 20;
const PATH_SUGGESTIONS_API_LIMIT = 50;
const PATH_HISTORY_LIMIT = 20;
const PATH_HISTORY_STORAGE_KEY = "browser:path-history:v1";
const PATH_SUGGESTION_SOURCE_WEIGHT: Record<PathSuggestionSource, number> = {
  history: 300,
  local: 200,
  remote: 100,
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
const BUCKET_INSPECTOR_FEATURE_CHIP_CLASSES: Record<BucketInspectorTone, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100",
  inactive: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100",
  unknown: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};
const inspectorTabPanelClasses = "space-y-4 ui-caption text-slate-600 dark:text-slate-300";
const inspectorSectionCardClasses =
  "rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/40";
const inspectorSectionTitleClasses = "ui-caption font-semibold uppercase tracking-wide text-slate-400";
const inspectorEmptyStateClasses =
  "rounded-lg border border-dashed border-slate-200 px-3 py-3 ui-caption text-slate-500 dark:border-slate-800 dark:text-slate-400";
const inspectorInlineActionClasses =
  "ui-caption font-semibold text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200 dark:disabled:text-slate-500";
const normalizePathDraftValue = (value: string) => value.trim().replace(/^\/+/, "");

const resolvePathDraftContext = (value: string): PathDraftContext => {
  const cleaned = normalizePathDraftValue(value);
  const hasTrailingSlash = cleaned.endsWith("/");
  const slashIndex = cleaned.lastIndexOf("/");
  const parentRaw = slashIndex >= 0 ? cleaned.slice(0, slashIndex + 1) : "";
  const fragment = hasTrailingSlash ? "" : slashIndex >= 0 ? cleaned.slice(slashIndex + 1) : cleaned;
  return {
    parentPrefix: parentRaw ? normalizePrefix(parentRaw) : "",
    fragment,
  };
};

const buildPathSuggestionEntries = (
  prefixes: string[],
  parentPrefix: string,
  fragment: string,
  source: PathSuggestionSource
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
    if (normalizedFragment && !label.toLowerCase().includes(normalizedFragment)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    entries.push({ value: normalized, label, source });
  });
  return entries;
};

const scorePathSuggestion = (entry: PathSuggestion, fragment: string): number => {
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

const mergePathSuggestions = (fragment: string, ...groups: PathSuggestion[][]): PathSuggestion[] => {
  const byValue = new Map<string, PathSuggestion>();
  groups.forEach((group) => {
    group.forEach((entry) => {
      const existing = byValue.get(entry.value);
      if (!existing) {
        byValue.set(entry.value, entry);
        return;
      }
      if ((PATH_SUGGESTION_SOURCE_WEIGHT[entry.source] ?? 0) > (PATH_SUGGESTION_SOURCE_WEIGHT[existing.source] ?? 0)) {
        byValue.set(entry.value, entry);
      }
    });
  });
  return Array.from(byValue.values())
    .sort((a, b) => {
      const scoreDiff = scorePathSuggestion(b, fragment) - scorePathSuggestion(a, fragment);
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

const pushBucketPathHistory = (bucketName: string, prefixValue: string): string[] => {
  if (!bucketName || typeof window === "undefined") return [];
  const normalized = normalizePrefix(normalizePathDraftValue(prefixValue || ""));
  if (!normalized) return readBucketPathHistory(bucketName);
  const store = readPathHistoryStore();
  const current = readBucketPathHistory(bucketName);
  const next = [normalized, ...current.filter((entry) => entry !== normalized)].slice(0, PATH_HISTORY_LIMIT);
  store[bucketName] = next;
  try {
    window.localStorage.setItem(PATH_HISTORY_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore localStorage write failures (private mode / quota).
  }
  return next;
};

export default function BrowserPage({
  accountIdForApi: accountIdOverride,
  hasContext: hasContextOverride,
  storageEndpointCapabilities,
  allowFoldersPanel = true,
  allowInspectorPanel = true,
  showPanelToggles = true,
  defaultShowFolders = false,
  defaultShowInspector = false,
}: BrowserPageProps = {}) {
  const browserContext = useBrowserContext();
  const accountIdForApi = accountIdOverride ?? browserContext.selectorForApi;
  const hasS3AccountContext = hasContextOverride ?? browserContext.hasContext;
  // /browser is credential-first: no root/portal switching in step 2.
  const accessMode = null;
  const [buckets, setBuckets] = useState<BrowserBucket[]>([]);
  const [bucketName, setBucketName] = useState("");
  const [showBucketMenu, setShowBucketMenu] = useState(false);
  const [bucketFilter, setBucketFilter] = useState("");
  const [searchParams] = useSearchParams();
  const requestedBucket = useMemo(() => searchParams.get("bucket")?.trim() ?? "", [searchParams]);
  const [prefix, setPrefix] = useState("");
  const [objects, setObjects] = useState<BrowserObject[]>([]);
  const [deletedObjects, setDeletedObjects] = useState<BrowserObject[]>([]);
  const [deletedPrefixes, setDeletedPrefixes] = useState<string[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsNextToken, setObjectsNextToken] = useState<string | null>(null);
  const [objectsIsTruncated, setObjectsIsTruncated] = useState(false);
  const [showPrefixVersions, setShowPrefixVersions] = useState(false);
  const [showFolders, setShowFolders] = useState(Boolean(allowFoldersPanel && defaultShowFolders));
  const [showInspector, setShowInspector] = useState(Boolean(allowInspectorPanel && defaultShowInspector));
  const [inspectorTab, setInspectorTab] = useState<"context" | "bucket" | "selection" | "details">("context");
  const [compactMode, setCompactMode] = useState(true);
  const [prefixVersions, setPrefixVersions] = useState<BrowserObjectVersion[]>([]);
  const [prefixDeleteMarkers, setPrefixDeleteMarkers] = useState<BrowserObjectVersion[]>([]);
  const [prefixVersionsLoading, setPrefixVersionsLoading] = useState(false);
  const [prefixVersionsError, setPrefixVersionsError] = useState<string | null>(null);
  const [prefixVersionKeyMarker, setPrefixVersionKeyMarker] = useState<string | null>(null);
  const [prefixVersionIdMarker, setPrefixVersionIdMarker] = useState<string | null>(null);
  const [objectVersions, setObjectVersions] = useState<BrowserObjectVersion[]>([]);
  const [objectDeleteMarkers, setObjectDeleteMarkers] = useState<BrowserObjectVersion[]>([]);
  const [objectVersionsLoading, setObjectVersionsLoading] = useState(false);
  const [objectVersionsError, setObjectVersionsError] = useState<string | null>(null);
  const [objectVersionKeyMarker, setObjectVersionKeyMarker] = useState<string | null>(null);
  const [objectVersionIdMarker, setObjectVersionIdMarker] = useState<string | null>(null);
  const [bucketVersioningEnabled, setBucketVersioningEnabled] = useState(false);
  const [showObjectVersionsModal, setShowObjectVersionsModal] = useState(false);
  const [objectVersionsModalKey, setObjectVersionsModalKey] = useState<string | null>(null);
  const [objectVersionsModalPath, setObjectVersionsModalPath] = useState<string | null>(null);
  const [objectVersionsModal, setObjectVersionsModal] = useState<BrowserObjectVersion[]>([]);
  const [objectDeleteMarkersModal, setObjectDeleteMarkersModal] = useState<BrowserObjectVersion[]>([]);
  const [objectVersionsModalLoading, setObjectVersionsModalLoading] = useState(false);
  const [objectVersionsModalError, setObjectVersionsModalError] = useState<string | null>(null);
  const [objectVersionModalKeyMarker, setObjectVersionModalKeyMarker] = useState<string | null>(null);
  const [objectVersionModalIdMarker, setObjectVersionModalIdMarker] = useState<string | null>(null);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsLoadingMore, setObjectsLoadingMore] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [browserSettings, setBrowserSettings] = useState<BrowserSettings | null>(null);
  const [corsStatus, setCorsStatus] = useState<BucketCorsStatus | null>(null);
  const [stsStatus, setStsStatus] = useState<StsStatus | null>(null);
  const [stsCredentials, setStsCredentials] = useState<StsCredentials | null>(null);
  const [stsCredentialsError, setStsCredentialsError] = useState<string | null>(null);
  const [useProxyTransfers, setUseProxyTransfers] = useState(false);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [corsFixing, setCorsFixing] = useState(false);
  const [corsFixError, setCorsFixError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [contextCounts, setContextCounts] = useState<{
    objects: number;
    versions: number;
    deleteMarkers: number;
  } | null>(null);
  const [contextCountsLoading, setContextCountsLoading] = useState(false);
  const [contextCountsError, setContextCountsError] = useState<string | null>(null);
  const [bucketInspectorByName, setBucketInspectorByName] = useState<Record<string, BucketInspectorData>>({});
  const [bucketInspectorLoading, setBucketInspectorLoading] = useState(false);
  const [bucketInspectorError, setBucketInspectorError] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<BrowserItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [showDeletedObjects, setShowDeletedObjects] = useState(false);
  const [showFolderItems, setShowFolderItems] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | "file" | "folder">("all");
  const [storageFilter, setStorageFilter] = useState<string>("all");
  const [sortId, setSortId] = useState("name-asc");
  const [operations, setOperations] = useState<OperationItem[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const uploadQueueRef = useRef<UploadQueueItem[]>([]);
  const activeUploadsRef = useRef(0);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const downloadControllersRef = useRef(new Map<string, AbortController>());
  const stsCredentialsRef = useRef<StsCredentials | null>(null);
  const stsRefreshRef = useRef<Promise<StsCredentials | null> | null>(null);
  const [showActiveOperations, setShowActiveOperations] = useState(false);
  const [showQueuedOperations, setShowQueuedOperations] = useState(false);
  const [showCompletedOperations, setShowCompletedOperations] = useState(false);
  const [showFailedOperations, setShowFailedOperations] = useState(false);
  const [expandedOperationGroups, setExpandedOperationGroups] = useState<Record<string, boolean>>({});
  const [queuedVisibleCountByGroup, setQueuedVisibleCountByGroup] = useState<Record<string, number>>({});
  const [completedOperations, setCompletedOperations] = useState<CompletedOperationItem[]>([]);
  const [downloadDetails, setDownloadDetails] = useState<Record<string, DownloadDetailItem[]>>({});
  const [deleteDetails, setDeleteDetails] = useState<Record<string, DeleteDetailItem[]>>({});
  const [copyDetails, setCopyDetails] = useState<Record<string, CopyDetailItem[]>>({});
  const [inspectedMetadata, setInspectedMetadata] = useState<ObjectMetadata | null>(null);
  const [inspectedTags, setInspectedTags] = useState<ObjectTag[]>([]);
  const [inspectedTagsVersionId, setInspectedTagsVersionId] = useState<string | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [newFolderLoading, setNewFolderLoading] = useState(false);
  const [showOperationsModal, setShowOperationsModal] = useState(false);
  const [previewItem, setPreviewItem] = useState<BrowserItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewContentType, setPreviewContentType] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const [pathSuggestionsLoading, setPathSuggestionsLoading] = useState(false);
  const [pathSuggestionIndex, setPathSuggestionIndex] = useState(-1);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [showNameColumnControls, setShowNameColumnControls] = useState(true);
  const [selectionStats, setSelectionStats] = useState<SelectionStats | null>(null);
  const [selectionStatsLoading, setSelectionStatsLoading] = useState(false);
  const [selectionStatsError, setSelectionStatsError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showBulkAttributesModal, setShowBulkAttributesModal] = useState(false);
  const [showBulkRestoreModal, setShowBulkRestoreModal] = useState(false);
  const [bulkActionItems, setBulkActionItems] = useState<BrowserItem[]>([]);
  const [bulkAttributesLoading, setBulkAttributesLoading] = useState(false);
  const [bulkAttributesError, setBulkAttributesError] = useState<string | null>(null);
  const [bulkAttributesSummary, setBulkAttributesSummary] = useState<string | null>(null);
  const [bulkApplyMetadata, setBulkApplyMetadata] = useState(false);
  const [bulkApplyTags, setBulkApplyTags] = useState(false);
  const [bulkApplyStorageClass, setBulkApplyStorageClass] = useState(false);
  const [bulkApplyAcl, setBulkApplyAcl] = useState(false);
  const [bulkApplyLegalHold, setBulkApplyLegalHold] = useState(false);
  const [bulkApplyRetention, setBulkApplyRetention] = useState(false);
  const [bulkMetadataDraft, setBulkMetadataDraft] = useState<BulkMetadataDraft>({
    contentType: "",
    cacheControl: "",
    contentDisposition: "",
    contentEncoding: "",
    contentLanguage: "",
    expires: "",
  });
  const [bulkMetadataEntries, setBulkMetadataEntries] = useState("");
  const [bulkTagsDraft, setBulkTagsDraft] = useState("");
  const [bulkStorageClass, setBulkStorageClass] = useState("");
  const [bulkAclValue, setBulkAclValue] = useState("private");
  const [bulkLegalHoldStatus, setBulkLegalHoldStatus] = useState<"ON" | "OFF">("OFF");
  const [bulkRetentionMode, setBulkRetentionMode] = useState<"" | "GOVERNANCE" | "COMPLIANCE">("");
  const [bulkRetentionDate, setBulkRetentionDate] = useState("");
  const [bulkRetentionBypass, setBulkRetentionBypass] = useState(false);
  const [bulkRestoreDate, setBulkRestoreDate] = useState("");
  const [bulkRestoreDeleteMissing, setBulkRestoreDeleteMissing] = useState(false);
  const [bulkRestoreRestoreDeleted, setBulkRestoreRestoreDeleted] = useState(false);
  const [bulkRestoreDryRun, setBulkRestoreDryRun] = useState(false);
  const [bulkRestoreLoading, setBulkRestoreLoading] = useState(false);
  const [bulkRestoreError, setBulkRestoreError] = useState<string | null>(null);
  const [bulkRestoreSummary, setBulkRestoreSummary] = useState<string | null>(null);
  const [bulkRestorePreview, setBulkRestorePreview] = useState<{
    restoreKeys: string[];
    deleteKeys: string[];
    unchangedKeys: string[];
    totalRestore: number;
    totalDelete: number;
    totalUnchanged: number;
  } | null>(null);
  const [bulkRestoreTargetPath, setBulkRestoreTargetPath] = useState<string | null>(null);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupKeepLast, setCleanupKeepLast] = useState("");
  const [cleanupOlderThanDays, setCleanupOlderThanDays] = useState("");
  const [cleanupDeleteOrphanMarkers, setCleanupDeleteOrphanMarkers] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupSummary, setCleanupSummary] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const bucketMenuRef = useRef<HTMLDivElement | null>(null);
  const bucketFilterRef = useRef<HTMLInputElement | null>(null);
  const nameHeaderRef = useRef<HTMLTableCellElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement | null>(null);
  const pathSuggestionsDebounceRef = useRef<number | null>(null);
  const pathSuggestionsRequestIdRef = useRef(0);
  const objectsRefreshTimeoutRef = useRef<number | null>(null);
  const uploadRefreshTimeoutRef = useRef<number | null>(null);
  const pendingUploadedKeysByBucketRef = useRef<Map<string, Set<string>>>(new Map());
  const previewObjectUrlRef = useRef<string | null>(null);
  const previousAccountIdRef = useRef<typeof accountIdForApi>(accountIdForApi);
  const skipNextObjectsLoadRef = useRef(false);
  const contextCountIdRef = useRef(0);
  const bucketInspectorRequestIdRef = useRef(0);
  const selectionStatsRequestIdRef = useRef(0);
  const browserPathRef = useRef("");
  const browserHistoryStateRef = useRef<{ bucketName: string; prefix: string } | null>(null);
  const skipHistoryPushRef = useRef(false);
  const operationIdsRef = useRef(new Set<string>());
  const bucketNameRef = useRef(bucketName);
  const prefixRef = useRef(prefix);
  const selectedContext = useMemo(
    () => browserContext.contexts.find((ctx) => ctx.id === browserContext.selectedContextId) ?? null,
    [browserContext.contexts, browserContext.selectedContextId]
  );
  const storageEndpointCaps = useMemo(() => {
    const raw = selectedContext?.raw;
    if (!raw || typeof raw !== "object") return null;
    if ("storage_endpoint_capabilities" in raw) {
      return (raw as { storage_endpoint_capabilities?: Record<string, boolean> | null }).storage_endpoint_capabilities ?? null;
    }
    return null;
  }, [selectedContext]);
  const effectiveCaps = storageEndpointCapabilities === undefined ? storageEndpointCaps : storageEndpointCapabilities;
  const contextId = typeof accountIdForApi === "string" ? accountIdForApi : null;
  const isLegacyS3UserContext = Boolean(contextId && contextId.startsWith("s3u-"));
  const isLegacyConnectionContext = Boolean(contextId && contextId.startsWith("conn-"));
  const isLegacyContext = isLegacyS3UserContext || isLegacyConnectionContext;
  const stsEnabled = Boolean(effectiveCaps?.sts) && !isLegacyContext;
  const normalizeAccountId = useCallback((value: S3AccountSelector | null | undefined) => {
    if (value == null) return null;
    return String(value);
  }, []);
  const currentAccountId = normalizeAccountId(accountIdForApi);
  const clipboardAccountId = normalizeAccountId(clipboard?.sourceAccountId ?? null);
  const clipboardMatchesContext = Boolean(clipboard && clipboardAccountId === currentAccountId);
  const canPaste = Boolean(clipboard && bucketName && hasS3AccountContext && clipboardMatchesContext);

  useEffect(() => {
    if (!allowFoldersPanel && showFolders) {
      setShowFolders(false);
    }
  }, [allowFoldersPanel, showFolders]);

  useEffect(() => {
    if (!allowInspectorPanel && showInspector) {
      setShowInspector(false);
    }
  }, [allowInspectorPanel, showInspector]);

  const toggleFoldersPanel = useCallback(() => {
    if (!allowFoldersPanel) return;
    setShowFolders((prev) => !prev);
  }, [allowFoldersPanel]);

  const toggleInspectorPanel = useCallback(() => {
    if (!allowInspectorPanel) return;
    setShowInspector((prev) => !prev);
  }, [allowInspectorPanel]);

  const normalizedPrefix = useMemo(() => normalizePrefix(prefix), [prefix]);
  const isVersioningEnabled = bucketVersioningEnabled;
  useEffect(() => {
    bucketNameRef.current = bucketName;
    prefixRef.current = prefix;
  }, [bucketName, prefix]);
  const uiOrigin = useMemo(
    () => (typeof window === "undefined" ? undefined : window.location.origin),
    []
  );
  const uploadParallelism = useMemo(() => {
    const direct = browserSettings?.direct_upload_parallelism ?? DEFAULT_DIRECT_UPLOAD_PARALLELISM;
    const proxy = browserSettings?.proxy_upload_parallelism ?? DEFAULT_PROXY_UPLOAD_PARALLELISM;
    const fallback = useProxyTransfers ? DEFAULT_PROXY_UPLOAD_PARALLELISM : DEFAULT_DIRECT_UPLOAD_PARALLELISM;
    return clampParallelism(useProxyTransfers ? proxy : direct, fallback);
  }, [browserSettings, useProxyTransfers]);
  const uploadParallelismRef = useRef(uploadParallelism);
  useEffect(() => {
    uploadParallelismRef.current = uploadParallelism;
  }, [uploadParallelism]);
  const downloadParallelism = useMemo(() => {
    const direct = browserSettings?.direct_download_parallelism ?? DEFAULT_DIRECT_DOWNLOAD_PARALLELISM;
    const proxy = browserSettings?.proxy_download_parallelism ?? DEFAULT_PROXY_DOWNLOAD_PARALLELISM;
    const fallback = useProxyTransfers ? DEFAULT_PROXY_DOWNLOAD_PARALLELISM : DEFAULT_DIRECT_DOWNLOAD_PARALLELISM;
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
    const value = browserSettings?.other_operations_parallelism ?? DEFAULT_OTHER_OPERATIONS_PARALLELISM;
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
        .catch(() => {
          setStsCredentials(null);
          setStsCredentialsError("Unable to load STS credentials.");
          return null;
        })
        .finally(() => {
          stsRefreshRef.current = null;
        });
      stsRefreshRef.current = request;
      return request;
    },
    [accountIdForApi, hasS3AccountContext, stsEnabled, stsStatus?.available]
  );
  const stsReady = Boolean(stsEnabled && stsStatus?.available && !stsCredentialsError);
  const presignObjectRequest = useCallback(
    async (targetBucket: string, payload: PresignRequest) => {
      if (payload.operation === "post_object") {
        return presignObject(accountIdForApi, targetBucket, payload);
      }
      if (stsReady) {
        const credentials = await ensureStsCredentials();
        if (credentials) {
          try {
            return await presignObjectWithSts(credentials, targetBucket, payload);
          } catch (err) {
            const refreshed = await ensureStsCredentials(true);
            if (refreshed) {
              try {
                return await presignObjectWithSts(refreshed, targetBucket, payload);
              } catch {
                // ignore and fall back to backend presign
              }
            }
          }
        }
      }
      return presignObject(accountIdForApi, targetBucket, payload);
    },
    [accountIdForApi, ensureStsCredentials, stsReady]
  );
  const presignPartRequest = useCallback(
    async (targetBucket: string, uploadId: string, payload: PresignPartRequest) => {
      if (stsReady) {
        const credentials = await ensureStsCredentials();
        if (credentials) {
          try {
            return await presignPartWithSts(credentials, targetBucket, uploadId, payload);
          } catch (err) {
            const refreshed = await ensureStsCredentials(true);
            if (refreshed) {
              try {
                return await presignPartWithSts(refreshed, targetBucket, uploadId, payload);
              } catch {
                // ignore and fall back to backend presign
              }
            }
          }
        }
      }
      return presignPart(accountIdForApi, targetBucket, uploadId, payload);
    },
    [accountIdForApi, ensureStsCredentials, stsReady]
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
      items.push("Direct download/upload is not allowed on this bucket.");
      if (!proxyAllowed) {
        items.push("Proxy transfers are disabled in settings.");
      }
    }
    return items;
  }, [
    corsFixError,
    corsStatus,
    isLegacyConnectionContext,
    isLegacyContext,
    proxyAllowed,
    stsCredentialsError,
    useProxyTransfers,
    warningMessage,
  ]);
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
        title: "Download/Upload unavailable: CORS is disabled and proxy transfers are disabled.",
        className:
          "border-rose-200/70 bg-rose-200/60 text-rose-600/70 dark:border-rose-400/40 dark:bg-rose-400/25 dark:text-rose-200/90",
      };
    }
    if (useProxyTransfers) {
      return {
        label: "Proxy",
        title: "Download/Upload mode: Backend proxy transfers are active.",
        className:
          "border-amber-200/70 bg-amber-200/60 text-amber-600/70 dark:border-amber-400/40 dark:bg-amber-400/25 dark:text-amber-200/90",
      };
    }
    if (stsCredentials) {
      return {
        label: "STS",
        title: stsExpirationLabel
          ? `Download/Upload mode: STS credentials active (expires at ${stsExpirationLabel}).`
          : "Download/Upload mode: STS credentials are active.",
        className:
          "border-emerald-200/70 bg-emerald-200/60 text-emerald-600/70 dark:border-emerald-400/40 dark:bg-emerald-400/25 dark:text-emerald-200/90",
      };
    }
    return {
      label: "Presign",
      title: legacyStsTooltip
        ? `Download/Upload mode: Presigned URLs are active. ${legacyStsTooltip}`
        : "Download/Upload mode: Presigned URLs are active.",
      className:
        "border-emerald-200/70 bg-emerald-200/60 text-emerald-600/70 dark:border-emerald-400/40 dark:bg-emerald-400/25 dark:text-emerald-200/90",
    };
  }, [
    corsStatus,
    hasS3AccountContext,
    legacyStsTooltip,
    proxyAllowed,
    stsCredentials,
    stsExpirationLabel,
    useProxyTransfers,
  ]);

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
      const state = event.state as { browserPage?: boolean; bucketName?: string; prefix?: string } | null;
      if (state?.browserPage) {
        const nextBucket = state.bucketName ?? "";
        const nextPrefix = state.prefix ?? "";
        const isSame = nextBucket === bucketNameRef.current && nextPrefix === prefixRef.current;
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
        browserPathRef.current || `${window.location.pathname}${window.location.search}${window.location.hash}`
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
        browserPathRef.current || `${window.location.pathname}${window.location.search}${window.location.hash}`
      );
      browserHistoryStateRef.current = { bucketName, prefix };
      return;
    }
    window.history.pushState(
      nextState,
      "",
      browserPathRef.current || `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
    browserHistoryStateRef.current = { bucketName, prefix };
  }, [bucketName, prefix]);

  useEffect(() => {
    setInspectorTab("context");
  }, [bucketName, prefix]);

  useEffect(() => {
    bucketInspectorRequestIdRef.current += 1;
    setBucketInspectorLoading(false);
    setBucketInspectorError(null);
  }, [bucketName, hasS3AccountContext]);

  useEffect(() => {
    if (!showBucketMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (bucketMenuRef.current && !bucketMenuRef.current.contains(event.target as Node)) {
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
      bucketFilterRef.current?.focus();
    }
  }, [showBucketMenu]);

  useEffect(() => {
    if (viewMode !== "list") return;
    const header = nameHeaderRef.current;
    if (!header || typeof ResizeObserver === "undefined") return;
    const updateControls = () => {
      const width = header.getBoundingClientRect().width;
      setShowNameColumnControls(width >= NAME_COLUMN_CONTROLS_MIN_WIDTH);
    };
    updateControls();
    const observer = new ResizeObserver(() => updateControls());
    observer.observe(header);
    return () => observer.disconnect();
  }, [viewMode]);



  useEffect(() => {
    if (!contextMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
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

  useEffect(() => {
    if (!hasS3AccountContext) {
      setBuckets([]);
      setBucketName("");
      setPrefix("");
      setDeletedObjects([]);
      setDeletedPrefixes([]);
      return;
    }
    let isMounted = true;
    setLoadingBuckets(true);
    setBucketError(null);
    listBrowserBuckets(accountIdForApi)
      .then((data) => {
        if (!isMounted) return;
        setBuckets(data);
        setBucketName((prev) => {
          if (requestedBucket && data.some((bucket) => bucket.name === requestedBucket)) {
            if (requestedBucket !== prev) {
              setPrefix("");
            }
            return requestedBucket;
          }
          if (prev && data.some((bucket) => bucket.name === prev)) {
            return prev;
          }
          const next = data[0]?.name ?? "";
          if (next !== prev) {
            setPrefix("");
          }
          return next;
        });
      })
      .catch(() => {
        if (!isMounted) return;
        setBucketError("Unable to list buckets for this account.");
        setBuckets([]);
        setBucketName("");
        setPrefix("");
        setDeletedObjects([]);
        setDeletedPrefixes([]);
      })
      .finally(() => {
        if (isMounted) {
          setLoadingBuckets(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, hasS3AccountContext, requestedBucket, accessMode]);

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

  const listDeletedObjectsForPrefix = async (
    targetPrefix: string,
    existingObjects: BrowserObject[],
    existingPrefixes: string[],
    queryValue: string
  ) => {
    if (!bucketName || !hasS3AccountContext || !isVersioningEnabled || !showDeletedObjects) {
      return { deletedObjects: [] as BrowserObject[], deletedPrefixes: [] as string[] };
    }
    if (storageFilter !== "all") {
      return { deletedObjects: [] as BrowserObject[], deletedPrefixes: [] as string[] };
    }
    const activeKeys = new Set(existingObjects.map((item) => item.key));
    const activePrefixes = new Set(existingPrefixes);
    const latestMarkersByKey = new Map<string, BrowserObjectVersion>();
    const markerPrefixes = new Set<string>();
    let keyMarker: string | null = null;
    let versionIdMarker: string | null = null;
    let hasMore = true;
    let pageGuard = 0;

    const matchesQuery = (key: string) => {
      if (!queryValue) return true;
      let relative = key;
      if (targetPrefix && relative.startsWith(targetPrefix)) {
        relative = relative.slice(targetPrefix.length);
      }
      if (relative.endsWith("/")) {
        relative = relative.slice(0, -1);
      }
      return relative.toLowerCase().includes(queryValue);
    };

    while (hasMore) {
      const data = await listObjectVersions(accountIdForApi, bucketName, {
        prefix: targetPrefix,
        keyMarker: keyMarker ?? undefined,
        versionIdMarker: versionIdMarker ?? undefined,
        maxKeys: VERSIONS_PAGE_SIZE,
      });
      data.delete_markers.forEach((marker) => {
        if (!marker.is_latest) return;
        if (!marker.key || !marker.key.startsWith(targetPrefix)) return;
        const relative = marker.key.slice(targetPrefix.length);
        if (!relative) return;
        if (relative.includes("/")) {
          if (typeFilter === "file") return;
          const child = relative.split("/")[0];
          if (!child) return;
          const childPrefix = `${targetPrefix}${child}/`;
          if (activePrefixes.has(childPrefix)) return;
          if (!matchesQuery(childPrefix)) return;
          markerPrefixes.add(childPrefix);
          return;
        }
        if (typeFilter === "folder") return;
        if (activeKeys.has(marker.key)) return;
        if (!matchesQuery(marker.key)) return;
        latestMarkersByKey.set(marker.key, marker);
      });
      keyMarker = data.next_key_marker ?? null;
      versionIdMarker = data.next_version_id_marker ?? null;
      hasMore = Boolean(data.is_truncated && (keyMarker || versionIdMarker));
      pageGuard += 1;
      if (pageGuard > 1000) {
        hasMore = false;
      }
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
    const deletedFolderRows = Array.from(markerPrefixes.values()).sort((a, b) => a.localeCompare(b));
    return { deletedObjects: deletedObjectRows, deletedPrefixes: deletedFolderRows };
  };

  const loadObjects = async (opts?: {
    append?: boolean;
    continuationToken?: string | null;
    prefixOverride?: string;
    silent?: boolean;
  }) => {
    if (!bucketName || !hasS3AccountContext) return;
    const targetPrefix = normalizePrefix(opts?.prefixOverride ?? prefix);
    const isAppend = Boolean(opts?.append);
    const isSilent = Boolean(opts?.silent);
    if (!isAppend) {
      if (!isSilent) {
        setObjectsLoading(true);
        setObjectsLoadingMore(false);
        setObjectsError(null);
        setObjects([]);
        setDeletedObjects([]);
        setDeletedPrefixes([]);
        setPrefixes([]);
        setObjectsNextToken(null);
        setObjectsIsTruncated(false);
      }
    } else {
      setObjectsLoadingMore(true);
    }
    const query = filter.trim();
    try {
      const data = await listBrowserObjects(accountIdForApi, bucketName, {
        prefix: targetPrefix,
        continuationToken: opts?.continuationToken ?? undefined,
        maxKeys: OBJECTS_PAGE_SIZE,
        query: query || undefined,
        type: typeFilter,
        storageClass: storageFilter,
      });
      let deletedObjectsResult: BrowserObject[] = [];
      let deletedPrefixesResult: string[] = [];
      if (!opts?.append) {
        if (showDeletedObjects && isVersioningEnabled && storageFilter === "all") {
          try {
            const deletedResult = await listDeletedObjectsForPrefix(
              targetPrefix,
              data.objects,
              data.prefixes,
              query.toLowerCase()
            );
            deletedObjectsResult = deletedResult.deletedObjects;
            deletedPrefixesResult = deletedResult.deletedPrefixes;
          } catch {
            deletedObjectsResult = [];
            deletedPrefixesResult = [];
          }
        } else {
          deletedObjectsResult = [];
          deletedPrefixesResult = [];
        }
      }
      setObjects((prev) => (opts?.append ? [...prev, ...data.objects] : data.objects));
      if (!opts?.append) {
        setDeletedObjects(deletedObjectsResult);
        setDeletedPrefixes(deletedPrefixesResult);
      }
      setPrefixes((prev) => {
        if (!opts?.append) {
          return data.prefixes;
        }
        const merged = [...prev, ...data.prefixes];
        return Array.from(new Set(merged));
      });
      setObjectsNextToken(data.next_continuation_token ?? null);
      setObjectsIsTruncated(data.is_truncated);
    } catch (err) {
      setObjectsError("Unable to list objects for this prefix.");
      if (!isAppend && !isSilent) {
        setObjects([]);
        setDeletedObjects([]);
        setDeletedPrefixes([]);
        setPrefixes([]);
        setObjectsNextToken(null);
        setObjectsIsTruncated(false);
      }
    } finally {
      if (!isAppend) {
        if (!isSilent) {
          setObjectsLoading(false);
        }
      } else {
        setObjectsLoadingMore(false);
      }
    }
  };

  const loadPrefixVersions = async (opts?: { append?: boolean; keyMarker?: string | null; versionIdMarker?: string | null }) => {
    if (!bucketName || !hasS3AccountContext || !isVersioningEnabled) return;
    if (!opts?.append) {
      setPrefixVersionsLoading(true);
      setPrefixVersionsError(null);
    } else {
      setPrefixVersionsLoading(true);
    }
    const resolvedKeyMarker = opts?.keyMarker !== undefined ? opts.keyMarker : prefixVersionKeyMarker;
    const resolvedVersionIdMarker = opts?.versionIdMarker !== undefined ? opts.versionIdMarker : prefixVersionIdMarker;
    try {
      const data = await listObjectVersions(accountIdForApi, bucketName, {
        prefix: normalizedPrefix,
        keyMarker: resolvedKeyMarker ?? undefined,
        versionIdMarker: resolvedVersionIdMarker ?? undefined,
        maxKeys: VERSIONS_PAGE_SIZE,
      });
      setPrefixVersionKeyMarker(data.next_key_marker ?? null);
      setPrefixVersionIdMarker(data.next_version_id_marker ?? null);
      setPrefixVersions((prev) => (opts?.append ? [...prev, ...data.versions] : data.versions));
      setPrefixDeleteMarkers((prev) => (opts?.append ? [...prev, ...data.delete_markers] : data.delete_markers));
    } catch (err) {
      setPrefixVersionsError("Unable to list versions for this prefix.");
      if (!opts?.append) {
        setPrefixVersions([]);
        setPrefixDeleteMarkers([]);
      }
    } finally {
      setPrefixVersionsLoading(false);
    }
  };

  const loadObjectVersions = async (opts?: {
    append?: boolean;
    keyMarker?: string | null;
    versionIdMarker?: string | null;
    targetKey?: string | null;
  }) => {
    if (!bucketName || !hasS3AccountContext || !isVersioningEnabled) return;
    const targetKey = opts?.targetKey ?? inspectedItem?.key ?? null;
    if (!targetKey) return;
    if (!opts?.append) {
      setObjectVersionsLoading(true);
      setObjectVersionsError(null);
    } else {
      setObjectVersionsLoading(true);
    }
    const resolvedKeyMarker = opts?.keyMarker !== undefined ? opts.keyMarker : objectVersionKeyMarker;
    const resolvedVersionIdMarker = opts?.versionIdMarker !== undefined ? opts.versionIdMarker : objectVersionIdMarker;
    try {
      const data = await listObjectVersions(accountIdForApi, bucketName, {
        key: targetKey,
        keyMarker: resolvedKeyMarker ?? undefined,
        versionIdMarker: resolvedVersionIdMarker ?? undefined,
        maxKeys: VERSIONS_PAGE_SIZE,
      });
      setObjectVersionKeyMarker(data.next_key_marker ?? null);
      setObjectVersionIdMarker(data.next_version_id_marker ?? null);
      setObjectVersions((prev) => (opts?.append ? [...prev, ...data.versions] : data.versions));
      setObjectDeleteMarkers((prev) => (opts?.append ? [...prev, ...data.delete_markers] : data.delete_markers));
    } catch (err) {
      setObjectVersionsError("Unable to list versions for this object.");
      if (!opts?.append) {
        setObjectVersions([]);
        setObjectDeleteMarkers([]);
      }
    } finally {
      setObjectVersionsLoading(false);
    }
  };

  const loadObjectVersionsModal = async (opts?: {
    append?: boolean;
    keyMarker?: string | null;
    versionIdMarker?: string | null;
    targetKey?: string | null;
  }) => {
    if (!bucketName || !hasS3AccountContext || !isVersioningEnabled) return;
    const targetKey = opts?.targetKey ?? objectVersionsModalKey ?? null;
    if (!targetKey) return;
    if (!opts?.append) {
      setObjectVersionsModalLoading(true);
      setObjectVersionsModalError(null);
    } else {
      setObjectVersionsModalLoading(true);
    }
    const resolvedKeyMarker =
      opts?.keyMarker !== undefined ? opts.keyMarker : objectVersionModalKeyMarker;
    const resolvedVersionIdMarker =
      opts?.versionIdMarker !== undefined ? opts.versionIdMarker : objectVersionModalIdMarker;
    try {
      const data = await listObjectVersions(accountIdForApi, bucketName, {
        key: targetKey,
        keyMarker: resolvedKeyMarker ?? undefined,
        versionIdMarker: resolvedVersionIdMarker ?? undefined,
        maxKeys: VERSIONS_PAGE_SIZE,
      });
      setObjectVersionModalKeyMarker(data.next_key_marker ?? null);
      setObjectVersionModalIdMarker(data.next_version_id_marker ?? null);
      setObjectVersionsModal((prev) => (opts?.append ? [...prev, ...data.versions] : data.versions));
      setObjectDeleteMarkersModal((prev) =>
        opts?.append ? [...prev, ...data.delete_markers] : data.delete_markers
      );
    } catch (err) {
      setObjectVersionsModalError("Unable to list versions for this object.");
      if (!opts?.append) {
        setObjectVersionsModal([]);
        setObjectDeleteMarkersModal([]);
      }
    } finally {
      setObjectVersionsModalLoading(false);
    }
  };

  useEffect(() => {
    if (previousAccountIdRef.current === accountIdForApi) {
      return;
    }
    previousAccountIdRef.current = accountIdForApi;
    skipNextObjectsLoadRef.current = true;
    setBucketName("");
    setPrefix("");
    setActiveItem(null);
    setDeletedObjects([]);
    setDeletedPrefixes([]);
  }, [accountIdForApi]);

  useEffect(() => {
    if (skipNextObjectsLoadRef.current) {
      skipNextObjectsLoadRef.current = false;
      return;
    }
    if (!bucketName || !hasS3AccountContext) {
      setObjects([]);
      setDeletedObjects([]);
      setDeletedPrefixes([]);
      setPrefixes([]);
      setObjectsNextToken(null);
      setObjectsIsTruncated(false);
      setObjectsLoadingMore(false);
      return;
    }
    loadObjects({ prefixOverride: prefix });
  }, [accountIdForApi, accessMode, bucketName, filter, hasS3AccountContext, isVersioningEnabled, prefix, showDeletedObjects, storageFilter, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showPrefixVersions || !bucketName || !hasS3AccountContext || !isVersioningEnabled) {
      setPrefixVersions([]);
      setPrefixDeleteMarkers([]);
      setPrefixVersionsError(null);
      setPrefixVersionKeyMarker(null);
      setPrefixVersionIdMarker(null);
      return;
    }
    setPrefixVersionKeyMarker(null);
    setPrefixVersionIdMarker(null);
    loadPrefixVersions({ append: false, keyMarker: null, versionIdMarker: null });
  }, [accountIdForApi, accessMode, bucketName, hasS3AccountContext, normalizedPrefix, showPrefixVersions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext) {
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
  }, [accountIdForApi, bucketName, hasS3AccountContext]);

  useEffect(() => {
    if (isVersioningEnabled) return;
    setShowDeletedObjects(false);
    setDeletedObjects([]);
    setDeletedPrefixes([]);
    setShowPrefixVersions(false);
    closeObjectVersionsModal();
    setPrefixVersions([]);
    setPrefixDeleteMarkers([]);
    setPrefixVersionsError(null);
    setPrefixVersionKeyMarker(null);
    setPrefixVersionIdMarker(null);
    setObjectVersions([]);
    setObjectDeleteMarkers([]);
    setObjectVersionsError(null);
    setObjectVersionKeyMarker(null);
    setObjectVersionIdMarker(null);
  }, [bucketName, isVersioningEnabled]);

  useEffect(() => {
    if (showDeletedObjects) return;
    setDeletedObjects([]);
    setDeletedPrefixes([]);
  }, [showDeletedObjects]);

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext) {
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
        const data = await listBrowserObjects(accountIdForApi, bucketName, { prefix: "" });
        if (!isMounted) return;
        const children = buildTreeNodes(data.prefixes, "");
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
  }, [accountIdForApi, accessMode, bucketName, hasS3AccountContext]);

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext || treeNodes.length === 0) return;
    const rootNode = treeNodes.find((node) => node.prefix === "");
    if (!rootNode || rootNode.isLoading) return;
    const targetPrefix = prefix ? normalizePrefix(prefix) : "";
    if (!targetPrefix) {
      if (!rootNode.isExpanded) {
        setTreeNodes((prev) => updateTreeNodes(prev, "", (node) => ({ ...node, isExpanded: true })));
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
        next = updateTreeNodes(next, "", (node) => ({ ...node, isExpanded: true }));
      }
      prefixesNeedingExpansion.forEach((prefixKey) => {
        const node = findTreeNodeByPrefix(next, prefixKey);
        if (!node || node.isExpanded) return;
        next = updateTreeNodes(next, prefixKey, (entry) => ({ ...entry, isExpanded: true }));
      });
      return next;
    });
  }, [accessMode, bucketName, hasS3AccountContext, prefix, treeNodes]);

  useEffect(() => {
    if (!bucketName || !hasS3AccountContext) {
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
        setCorsStatus({ enabled: false, rules: [], error: "Unable to check bucket CORS." });
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, accessMode, bucketName, hasS3AccountContext, uiOrigin]);

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
      .catch(() => {
        if (!isMounted) return;
        setStsStatus({ available: false, error: "Unable to reach STS endpoint." });
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
  }, [accountIdForApi, accessMode, ensureStsCredentials, hasS3AccountContext, stsEnabled, stsStatus?.available]);

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

  const items = useMemo(() => {
    const activePrefixSet = new Set(prefixes);
    const combinedPrefixes = Array.from(new Set([...prefixes, ...deletedPrefixes]));
    const folderItems = combinedPrefixes.map((prefixKey) => {
      const rawName = shortName(prefixKey, normalizedPrefix);
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
      const modifiedAt = obj.last_modified ? new Date(obj.last_modified).getTime() : null;
      return {
        id: obj.key,
        key: obj.key,
        name: shortName(obj.key, normalizedPrefix),
        type: "file",
        size: formatBytes(obj.size),
        sizeBytes: obj.size,
        modified: formatDateTime(obj.last_modified),
        modifiedAt,
        owner: "-",
        storageClass: obj.storage_class ?? undefined,
      } satisfies BrowserItem;
    });
    const deletedItemRows = deletedObjects.map((obj) => {
      const modifiedAt = obj.last_modified ? new Date(obj.last_modified).getTime() : null;
      return {
        id: `${obj.key}::deleted::${obj.version_id ?? "null"}`,
        key: obj.key,
        name: shortName(obj.key, normalizedPrefix),
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
  }, [deletedObjects, deletedPrefixes, normalizedPrefix, objects, prefixes]);

  const sortOptions = [
    { id: "name-asc", label: "Name (A-Z)", key: "name", direction: "asc" as const },
    { id: "name-desc", label: "Name (Z-A)", key: "name", direction: "desc" as const },
    { id: "modified-desc", label: "Last modified (newest)", key: "modified", direction: "desc" as const },
    { id: "modified-asc", label: "Last modified (oldest)", key: "modified", direction: "asc" as const },
    { id: "size-desc", label: "Size (largest)", key: "size", direction: "desc" as const },
    { id: "size-asc", label: "Size (smallest)", key: "size", direction: "asc" as const },
  ];
  const activeSort = sortOptions.find((option) => option.id === sortId) ?? sortOptions[0];

  const filteredItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      if (activeSort.key === "size") {
        const aSize = a.sizeBytes ?? 0;
        const bSize = b.sizeBytes ?? 0;
        return activeSort.direction === "asc" ? aSize - bSize : bSize - aSize;
      }
      if (activeSort.key === "modified") {
        const result = (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0);
        return activeSort.direction === "asc" ? result : -result;
      }
      const result = a.name.localeCompare(b.name);
      return activeSort.direction === "asc" ? result : -result;
    });
  }, [activeSort.direction, activeSort.key, items]);

  const listItems = useMemo(
    () => (showFolderItems ? filteredItems : filteredItems.filter((item) => item.type !== "folder")),
    [filteredItems, showFolderItems]
  );

  const prefixParts = useMemo(() => prefix.split("/").filter(Boolean), [prefix]);
  const bucketOptions = useMemo(() => buckets.map((bucket) => bucket.name), [buckets]);
  const normalizedBucketFilter = bucketFilter.trim().toLowerCase();
  const filteredBucketOptions = useMemo(() => {
    if (!normalizedBucketFilter) return bucketOptions;
    return bucketOptions.filter((bucket) => bucket.toLowerCase().includes(normalizedBucketFilter));
  }, [bucketOptions, normalizedBucketFilter]);
  const visibleBucketOptions = useMemo(
    () => filteredBucketOptions.slice(0, BUCKET_MENU_LIMIT),
    [filteredBucketOptions]
  );
  const bucketOverflowCount = Math.max(0, filteredBucketOptions.length - visibleBucketOptions.length);
  const bucketButtonLabel = useMemo(() => {
    if (bucketName) return bucketName;
    if (loadingBuckets) return "Loading buckets...";
    if (bucketOptions.length === 0) return "No buckets";
    return "Select bucket";
  }, [bucketName, bucketOptions.length, loadingBuckets]);
  const sortKey = sortId.split("-")[0] as "name" | "size" | "modified";
  const sortDirection = sortId.endsWith("asc") ? "asc" : "desc";
  const activePathSuggestion =
    pathSuggestionIndex >= 0 && pathSuggestionIndex < pathSuggestions.length ? pathSuggestions[pathSuggestionIndex] : null;

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
  const allSelected = listItems.length > 0 && listItems.every((item) => selectedSet.has(item.id));
  const selectedItems = useMemo(() => items.filter((item) => selectedSet.has(item.id)), [items, selectedSet]);
  const selectedCount = selectedItems.length;
  const bulkActionFileCount = useMemo(
    () => bulkActionItems.filter((item) => item.type === "file").length,
    [bulkActionItems]
  );
  const bulkActionFolderCount = useMemo(
    () => bulkActionItems.filter((item) => item.type === "folder").length,
    [bulkActionItems]
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
    return { totalBytes, files, deletedFiles, folders, deletedFolders, storageCounts };
  }, [items]);

  const bucketInspectorData = useMemo(
    () => (bucketName ? bucketInspectorByName[bucketName] ?? null : null),
    [bucketInspectorByName, bucketName]
  );
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
    if (selectedIds.length === 1) {
      return items.find((entry) => entry.id === selectedIds[0]) ?? null;
    }
    return null;
  }, [activeItem, items, selectedIds]);

  useEffect(() => {
    selectionStatsRequestIdRef.current += 1;
    setSelectionStats(null);
    setSelectionStatsError(null);
    setSelectionStatsLoading(false);
  }, [bucketName, inspectedItem?.id, prefix, selectedIds]);

  const selectionItems = selectedCount > 0 ? selectedItems : inspectedItem ? [inspectedItem] : [];
  const selectionInfo = getSelectionInfo(selectionItems);
  const selectionFiles = selectionInfo.files;
  const selectionFolders = selectionInfo.folders;
  const selectionIsSingle = selectionInfo.isSingle;
  const selectionPrimary = selectionInfo.primary;
  const canSelectionDownloadFiles = selectionInfo.canDownloadFiles;
  const canSelectionDownloadFolder = selectionInfo.canDownloadFolder;
  const canSelectionOpen = selectionInfo.canOpen;
  const canSelectionCopyUrl = selectionInfo.canCopyUrl;
  const canSelectionAdvanced = selectionInfo.canAdvanced;
  const canSelectionCopyItems = selectionInfo.canCopyItems;
  const canSelectionCutItems = selectionInfo.canCutItems;
  const canSelectionBulkAttributes = selectionInfo.canBulkAttributes;
  const canSelectionDelete = selectionInfo.canDelete;
  const selectionHasDeleted = selectionInfo.hasDeleted;
  const canSelectionActions = selectionInfo.items.length > 0;

  const previewKind = useMemo(() => {
    if (!previewItem) return null;
    return previewKindForItem(previewItem, previewContentType);
  }, [previewContentType, previewItem]);

  const layoutClass = showFolders && showInspector
    ? "xl:grid-cols-[200px_minmax(0,1fr)_320px]"
    : showFolders
      ? "xl:grid-cols-[200px_minmax(0,1fr)]"
      : showInspector
        ? "xl:grid-cols-[minmax(0,1fr)_320px]"
        : "xl:grid-cols-[minmax(0,1fr)]";
  const rowPadding = compactMode ? "py-1" : "py-2.5";
  const rowHeightClasses = compactMode ? "h-10" : "h-16";
  const rowCellClasses = rowPadding;
  const headerPadding = compactMode ? "py-2" : "py-3";
  const iconBoxClasses = compactMode ? "h-7 w-7" : "h-9 w-9";
  const nameGapClasses = compactMode ? "gap-2" : "gap-3";
  const gridCardHeightClasses = "min-h-[240px]";
  const gridCardGapClasses = "gap-3";

  const prefixVersionRows = useMemo(
    () => buildVersionRows(prefixVersions, prefixDeleteMarkers),
    [prefixDeleteMarkers, prefixVersions]
  );
  const objectVersionRows = useMemo(
    () => buildVersionRows(objectVersions, objectDeleteMarkers),
    [objectDeleteMarkers, objectVersions]
  );
  const objectVersionModalRows = useMemo(
    () => buildVersionRows(objectVersionsModal, objectDeleteMarkersModal),
    [objectDeleteMarkersModal, objectVersionsModal]
  );

  const currentPath = useMemo(() => {
    if (!bucketName) return "";
    if (!prefix) return bucketName;
    const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return `${bucketName}/${trimmed}`;
  }, [bucketName, prefix]);
  const inspectedPath = inspectedItem ? `${bucketName}/${inspectedItem.key}` : currentPath;
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const getContextMenuPosition = (event: ReactMouseEvent<HTMLElement>) => {
    const { clientX, clientY } = event;
    if (typeof window === "undefined") {
      return { x: clientX, y: clientY };
    }
    const menuWidth = 240;
    const menuHeight = 320;
    const padding = 8;
    const maxX = Math.max(padding, window.innerWidth - menuWidth - padding);
    const maxY = Math.max(padding, window.innerHeight - menuHeight - padding);
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    return {
      x: clamp(clientX, padding, maxX),
      y: clamp(clientY, padding, maxY),
    };
  };

  const openItemDetails = (item: BrowserItem) => {
    setActiveItem(item);
    setInspectorTab("details");
  };

  const isInteractiveTarget = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    return Boolean(element?.closest("button, a, input, textarea, select, label"));
  };

  const handleItemDoubleClick = (event: ReactMouseEvent<HTMLElement>, item: BrowserItem) => {
    if (isInteractiveTarget(event.target)) return;
    if (item.type === "folder") {
      handleOpenItem(item);
      return;
    }
    if (item.isDeleted) {
      if (isVersioningEnabled) {
        openObjectVersionsModal(item);
      }
      return;
    }
    handlePreviewItem(item);
  };

  const openAdvancedForItem = (item: BrowserItem) => {
    if (item.isDeleted) return;
    setActiveItem(item);
    setShowAdvancedModal(true);
  };

  const handleOpenItem = (item: BrowserItem) => {
    if (item.type !== "folder") return;
    handleSelectPrefix(item.key);
  };

  const clearPreviewObjectUrl = useCallback(() => {
    if (!previewObjectUrlRef.current) return;
    URL.revokeObjectURL(previewObjectUrlRef.current);
    previewObjectUrlRef.current = null;
  }, []);

  const closePreview = () => {
    clearPreviewObjectUrl();
    setPreviewItem(null);
    setPreviewUrl(null);
    setPreviewContentType(null);
    setPreviewLoading(false);
    setPreviewError(null);
  };

  const handlePreviewItem = (item: BrowserItem) => {
    if (item.type !== "file") return;
    if (item.isDeleted) {
      setWarningMessage("This object is deleted. Open versions to inspect or restore it.");
      if (isVersioningEnabled) {
        openObjectVersionsModal(item);
      }
      return;
    }
    setActiveItem(item);
    clearPreviewObjectUrl();
    setPreviewError(null);
    setPreviewUrl(null);
    setPreviewContentType(null);
    setPreviewLoading(true);
    setPreviewItem(item);
  };

  const handleSelectPrefix = (nextPrefix: string) => {
    setPrefix(nextPrefix);
    setActiveItem(null);
    if (bucketName) {
      setPathHistory(pushBucketPathHistory(bucketName, nextPrefix));
    }
  };

  const startEditingPath = () => {
    if (!bucketName) return;
    setPathDraft(prefix);
    setPathSuggestionIndex(-1);
    setIsEditingPath(true);
  };

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

  const applyPathSuggestion = (suggestion: PathSuggestion, options?: { commit?: boolean }) => {
    const nextPrefix = suggestion.value ? normalizePrefix(suggestion.value) : "";
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
      setPathSuggestionIndex((prev) => (prev < pathSuggestions.length - 1 ? prev + 1 : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      if (pathSuggestions.length === 0) return;
      event.preventDefault();
      setPathSuggestionIndex((prev) => (prev > 0 ? prev - 1 : pathSuggestions.length - 1));
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
    setActiveItem(null);
    setStatusMessage(null);
    setWarningMessage(null);
    setIsEditingPath(false);
    clearPreviewObjectUrl();
    setPreviewItem(null);
    setPreviewUrl(null);
    setPreviewContentType(null);
    setPreviewLoading(false);
    setPreviewError(null);
  }, [bucketName, clearPreviewObjectUrl, prefix]);

  useEffect(() => {
    if (!isEditingPath) {
      setPathDraft(prefix);
      return;
    }
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [isEditingPath, prefix]);

  useEffect(() => {
    if (!showNewFolderModal) return;
    newFolderInputRef.current?.focus();
    newFolderInputRef.current?.select();
  }, [showNewFolderModal]);

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
    const localCandidates = parentPrefix === normalizePrefix(prefix) ? prefixes : [];
    const localSuggestions = buildPathSuggestionEntries(localCandidates, parentPrefix, fragment, "local");
    const historySuggestions = buildPathSuggestionEntries(pathHistory, parentPrefix, fragment, "history");
    const localOnlySuggestions = mergePathSuggestions(fragment, historySuggestions, localSuggestions);
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
          const remoteSuggestions = buildPathSuggestionEntries(data.prefixes || [], parentPrefix, fragment, "remote");
          setPathSuggestions(mergePathSuggestions(fragment, historySuggestions, localSuggestions, remoteSuggestions));
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
    setSelectedIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
    if (activeItem && !items.some((item) => item.id === activeItem.id)) {
      setActiveItem(null);
    }
  }, [activeItem, items]);

  useEffect(() => {
    if (storageFilter !== "all" && !availableStorageClasses.includes(storageFilter)) {
      setStorageFilter("all");
    }
  }, [availableStorageClasses, storageFilter]);

  useEffect(() => {
    if (!bucketName || !inspectedItem || inspectedItem.type === "folder" || !hasS3AccountContext) {
      setInspectedMetadata(null);
      setInspectedTags([]);
      setInspectedTagsVersionId(null);
      setMetadataError(null);
      setMetadataLoading(false);
      return;
    }
    if (inspectedItem.isDeleted) {
      setInspectedMetadata(null);
      setInspectedTags([]);
      setInspectedTagsVersionId(inspectedItem.deleteMarkerVersionId ?? null);
      setMetadataError("Latest state: deleted (delete marker). Open versions to restore or remove marker.");
      setMetadataLoading(false);
      return;
    }
    let isMounted = true;
    setMetadataLoading(true);
    setMetadataError(null);
    Promise.all([
      fetchObjectMetadata(accountIdForApi, bucketName, inspectedItem.key),
      getObjectTags(accountIdForApi, bucketName, inspectedItem.key),
    ])
      .then(([meta, tags]) => {
        if (!isMounted) return;
        setInspectedMetadata(meta);
        setInspectedTags(tags.tags ?? []);
        setInspectedTagsVersionId(tags.version_id ?? null);
      })
      .catch(() => {
        if (!isMounted) return;
        setMetadataError("Unable to load object details.");
        setInspectedMetadata(null);
        setInspectedTags([]);
        setInspectedTagsVersionId(null);
      })
      .finally(() => {
        if (isMounted) {
          setMetadataLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, bucketName, hasS3AccountContext, inspectedItem?.isDeleted, inspectedItem?.key, inspectedItem?.type]);

  useEffect(() => {
    if (!previewItem || !bucketName || !hasS3AccountContext || !accountIdForApi) {
      return;
    }
    if (previewItem.type !== "file" || previewItem.isDeleted) {
      setPreviewError(
        previewItem.isDeleted ? "Preview unavailable for deleted objects." : "Preview is available for files only."
      );
      setPreviewLoading(false);
      return;
    }
    let isMounted = true;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewUrl(null);
    setPreviewContentType(null);
    clearPreviewObjectUrl();

    const loadPreview = async () => {
      const contentTypePromise = fetchObjectMetadata(accountIdForApi, bucketName, previewItem.key)
        .then((meta) => meta.content_type ?? null)
        .catch(() => null);

      if (useProxyTransfers) {
        const blob = await proxyDownload(accountIdForApi, bucketName, previewItem.key);
        if (!isMounted) return;
        const url = URL.createObjectURL(blob);
        previewObjectUrlRef.current = url;
        setPreviewUrl(url);
        const contentType = (await contentTypePromise) ?? (blob.type || null);
        setPreviewContentType(contentType);
        return;
      }

      const [contentType, presign] = await Promise.all([
        contentTypePromise,
        presignObjectRequest(bucketName, {
          key: previewItem.key,
          operation: "get_object",
          expires_in: 900,
        }),
      ]);
      if (!isMounted) return;
      setPreviewContentType(contentType);
      setPreviewUrl(presign.url);
    };

    loadPreview()
      .catch(() => {
        if (!isMounted) return;
        setPreviewError(useProxyTransfers ? "Unable to load preview." : "Unable to generate preview URL.");
      })
      .finally(() => {
        if (isMounted) {
          setPreviewLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [
    accountIdForApi,
    bucketName,
    clearPreviewObjectUrl,
    hasS3AccountContext,
    presignObjectRequest,
    previewItem,
    useProxyTransfers,
  ]);

  useEffect(() => {
    if (!showAdvancedModal) return;
    if (!inspectedItem || inspectedItem.type !== "file") {
      setShowAdvancedModal(false);
    }
  }, [inspectedItem?.key, inspectedItem?.type, showAdvancedModal]);

  useEffect(() => {
    if (
      !bucketName ||
      !hasS3AccountContext ||
      !inspectedItem ||
      inspectedItem.type === "folder" ||
      !isVersioningEnabled
    ) {
      setObjectVersions([]);
      setObjectDeleteMarkers([]);
      setObjectVersionsError(null);
      setObjectVersionKeyMarker(null);
      setObjectVersionIdMarker(null);
      return;
    }
    setObjectVersionKeyMarker(null);
    setObjectVersionIdMarker(null);
    loadObjectVersions({ append: false, keyMarker: null, versionIdMarker: null, targetKey: inspectedItem.key });
  }, [accountIdForApi, bucketName, hasS3AccountContext, inspectedItem?.key, inspectedItem?.type]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const usageFeatureEnabled = effectiveCaps ? effectiveCaps.usage !== false : true;
        const staticWebsiteEnabled = effectiveCaps?.static_website ?? true;
        const results = await Promise.allSettled([
          listBuckets(accountIdForApi, { with_stats: usageFeatureEnabled }),
          getBucketProperties(accountIdForApi, bucketName),
          getBucketPolicy(accountIdForApi, bucketName),
          getBucketLogging(accountIdForApi, bucketName),
          staticWebsiteEnabled ? getBucketWebsite(accountIdForApi, bucketName) : Promise.resolve(null),
        ]);
        if (bucketInspectorRequestIdRef.current !== requestId) return;
        const bucketsResult = results[0];
        const propertiesResult = results[1];
        const policyResult = results[2];
        const loggingResult = results[3];
        const websiteResult = results[4];

        const bucketList = bucketsResult.status === "fulfilled" ? bucketsResult.value : [];
        const selectedBucket = bucketList.find((entry) => entry.name === bucketName) ?? null;

        const unavailableFeature = (state = "Unavailable"): BucketInspectorFeature => ({ state, tone: "unknown" });
        const activeFeature = (state: string): BucketInspectorFeature => ({ state, tone: "active" });
        const inactiveFeature = (state: string): BucketInspectorFeature => ({ state, tone: "inactive" });

        const features: Record<string, BucketInspectorFeature> = {};

        if (propertiesResult.status === "fulfilled") {
          const properties = propertiesResult.value;
          const versioningRaw = (properties.versioning_status ?? "Disabled").trim();
          const versioningNormalized = versioningRaw.toLowerCase();
          if (versioningNormalized === "enabled") {
            features.versioning = activeFeature("Enabled");
          } else if (versioningNormalized === "suspended") {
            features.versioning = unavailableFeature(versioningRaw || "Suspended");
          } else {
            features.versioning = inactiveFeature(versioningRaw || "Disabled");
          }

          const objectLockEnabled = Boolean(properties.object_lock?.enabled ?? properties.object_lock_enabled);
          features.object_lock = objectLockEnabled ? activeFeature("Enabled") : inactiveFeature("Disabled");

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
            const partiallyEnabled = !fullyEnabled && flags.some((flag) => flag === true);
            features.block_public_access = fullyEnabled
              ? activeFeature("Enabled")
              : partiallyEnabled
                ? activeFeature("Partial")
                : inactiveFeature("Disabled");
          }

          const lifecycleRules = properties.lifecycle_rules ?? [];
          features.lifecycle_rules = lifecycleRules.length > 0 ? activeFeature("Enabled") : inactiveFeature("Disabled");

          const corsRules = properties.cors_rules ?? [];
          features.cors = corsRules.length > 0 ? activeFeature("Configured") : inactiveFeature("Not set");
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
          features.bucket_policy = configured ? activeFeature("Configured") : inactiveFeature("Not set");
        } else {
          features.bucket_policy = unavailableFeature();
        }

        if (loggingResult.status === "fulfilled") {
          const logging = loggingResult.value;
          const enabled = Boolean(logging.enabled && (logging.target_bucket ?? "").trim().length > 0);
          features.access_logging = enabled ? activeFeature("Enabled") : inactiveFeature("Disabled");
        } else {
          features.access_logging = unavailableFeature();
        }

        if (!staticWebsiteEnabled) {
          features.static_website = unavailableFeature();
        } else if (websiteResult.status === "fulfilled") {
          const website = websiteResult.value;
          const routingRules = Array.isArray(website?.routing_rules) ? website.routing_rules : [];
          const configured = Boolean(
            (website?.redirect_all_requests_to?.host_name ?? "").trim() ||
              (website?.index_document ?? "").trim() ||
              routingRules.length > 0
          );
          features.static_website = configured ? activeFeature("Enabled") : inactiveFeature("Disabled");
        } else {
          features.static_website = unavailableFeature();
        }

        const quotaConfigured = Boolean(
          (selectedBucket?.quota_max_size_bytes ?? 0) > 0 || (selectedBucket?.quota_max_objects ?? 0) > 0
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
      } catch {
        if (bucketInspectorRequestIdRef.current !== requestId) return;
        setBucketInspectorError("Unable to load bucket stats and features.");
      } finally {
        if (bucketInspectorRequestIdRef.current === requestId) {
          setBucketInspectorLoading(false);
        }
      }
    },
    [accountIdForApi, bucketInspectorByName, bucketName, effectiveCaps?.static_website, hasS3AccountContext]
  );

  const handleOpenBucketInspector = useCallback(() => {
    setInspectorTab("bucket");
    if (!bucketName || !hasS3AccountContext || bucketInspectorLoading) return;
    if (bucketInspectorByName[bucketName]) return;
    void loadBucketInspectorData();
  }, [bucketInspectorByName, bucketInspectorLoading, bucketName, hasS3AccountContext, loadBucketInspectorData]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const isSelected = prev.includes(id);
      const next = isSelected ? prev.filter((itemId) => itemId !== id) : [...prev, id];
      if (!isSelected) {
        setInspectorTab("selection");
      }
      return next;
    });
  };

  const selectSingleRow = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.length === 1 && prev[0] === id) {
        return [];
      }
      setInspectorTab("selection");
      return [id];
    });
  };

  const handleItemSelectionClick = (event: ReactMouseEvent<HTMLElement>, itemId: string) => {
    if (event.detail > 1) return;
    if (event.metaKey || event.ctrlKey) {
      toggleSelection(itemId);
      return;
    }
    selectSingleRow(itemId);
  };

  const handleItemNameClick = (event: ReactMouseEvent<HTMLElement>, item: BrowserItem) => {
    handleItemSelectionClick(event, item.id);
    if (event.detail > 1) return;
    if (event.metaKey || event.ctrlKey) return;
    openItemDetails(item);
  };

  const toggleAllSelection = () => {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(listItems.map((item) => item.id));
    if (listItems.length > 0) {
      setInspectorTab("selection");
    }
  };

  const toggleInspectorForItem = (item: BrowserItem) => {
    if (!allowInspectorPanel) return;
    setActiveItem(item);
    setInspectorTab("details");
  };

  const handleItemContextMenu = (event: ReactMouseEvent<HTMLElement>, item: BrowserItem) => {
    event.preventDefault();
    event.stopPropagation();
    const isSelected = selectedSet.has(item.id);
    const itemsForMenu = isSelected ? selectedItems : [item];
    if (!isSelected) {
      setSelectedIds([item.id]);
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

  const handleListBackgroundClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, label")) {
      return;
    }
    if (target.closest("[data-browser-item]")) {
      return;
    }
    setSelectedIds([]);
    setActiveItem(null);
    setInspectorTab("context");
  };

  const handleBucketChange = (value: string) => {
    setShowBucketMenu(false);
    setBucketFilter("");
    if (!value || value === bucketName) return;
    setBucketName(value);
    setPrefix("");
    setActiveItem(null);
  };

  const listVersionStats = async (opts: { prefix?: string; key?: string | null }) => {
    if (!isVersioningEnabled) {
      return { objectCount: 0, totalBytes: 0, versionsCount: 0, deleteMarkersCount: 0 };
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
        latestByKey.set(version.key, { isDelete: false, size: version.size ?? 0 });
      });
      data.delete_markers.forEach((marker) => {
        if (!marker.is_latest) return;
        latestByKey.set(marker.key, { isDelete: true, size: 0 });
      });
      isTruncated = data.is_truncated;
      keyMarker = data.next_key_marker ?? null;
      versionIdMarker = data.next_version_id_marker ?? null;
      pageGuard += 1;
      if (!isTruncated || pageGuard > 1000 || (!keyMarker && !versionIdMarker)) {
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
    } catch (err) {
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
      const sortedFolders = [...folderPrefixes].sort((a, b) => a.length - b.length);
      const uniqueFolders: string[] = [];
      sortedFolders.forEach((prefixKey) => {
        if (uniqueFolders.some((parent) => prefixKey.startsWith(parent))) return;
        uniqueFolders.push(prefixKey);
      });

      const isFileCoveredByFolder = (key: string) => uniqueFolders.some((prefixKey) => key.startsWith(prefixKey));
      let objectCount = 0;
      let totalBytes = 0;

      const fileItems = selectionItems.filter((item) => item.type === "file" && !isFileCoveredByFolder(item.key));
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
    } catch (err) {
      if (selectionStatsRequestIdRef.current !== requestId) return;
      setSelectionStatsError("Unable to calculate selection stats.");
    } finally {
      if (selectionStatsRequestIdRef.current === requestId) {
        setSelectionStatsLoading(false);
      }
    }
  };
  const handleSortToggle = (key: "name" | "size" | "modified") => {
    setSortId((prev) => {
      if (!prev.startsWith(key)) {
        return `${key}-asc`;
      }
      return prev.endsWith("asc") ? `${key}-desc` : `${key}-asc`;
    });
  };

  const handleRefresh = () => {
    if (!bucketName) return;
    loadObjects({ prefixOverride: prefix });
    if (showPrefixVersions) {
      loadPrefixVersions({ append: false, keyMarker: null, versionIdMarker: null });
    }
    if (inspectedItem?.type === "file") {
      loadObjectVersions({ append: false, keyMarker: null, versionIdMarker: null, targetKey: inspectedItem.key });
    }
  };

  const loadTreeChildren = async (targetPrefix: string, options?: { expand?: boolean }) => {
    if (!bucketName || !hasS3AccountContext) return;
    const normalized = targetPrefix ? normalizePrefix(targetPrefix) : "";
    const shouldExpand = options?.expand ?? true;
    setTreeNodes((prev) =>
      updateTreeNodes(prev, targetPrefix, (node) => ({ ...node, isLoading: true }))
    );
    try {
      const data = await listBrowserObjects(accountIdForApi, bucketName, { prefix: normalized });
      const children = buildTreeNodes(data.prefixes, normalized);
      setTreeNodes((prev) =>
        updateTreeNodes(prev, targetPrefix, (node) => ({
          ...node,
          children,
          isExpanded: shouldExpand ? true : node.isExpanded,
          isLoaded: true,
          isLoading: false,
        }))
      );
    } catch {
      setTreeNodes((prev) =>
        updateTreeNodes(prev, targetPrefix, (node) => ({
          ...node,
          isLoaded: true,
          isLoading: false,
        }))
      );
    }
  };

  const handleToggleTreeNode = (node: TreeNode) => {
    if (node.isExpanded) {
      setTreeNodes((prev) =>
        updateTreeNodes(prev, node.prefix, (entry) => ({ ...entry, isExpanded: false }))
      );
      return;
    }
    if (!node.isLoaded) {
      loadTreeChildren(node.prefix);
      return;
    }
    setTreeNodes((prev) =>
      updateTreeNodes(prev, node.prefix, (entry) => ({ ...entry, isExpanded: true }))
    );
  };

  const renderTreeNodes = (nodes: TreeNode[], depth = 0) => (
    <ul className="min-w-max space-y-1">
      {nodes.map((node) => {
        const isActive = prefix === node.prefix;
        const canToggle = node.isLoaded ? node.children.length > 0 : true;
        const labelClasses = `${treeItemBaseClasses} ${isActive ? treeItemActiveClasses : treeItemInactiveClasses}`;
        return (
          <li key={node.id}>
            <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
              <button
                type="button"
                className={treeToggleButtonClasses}
                onClick={() => handleToggleTreeNode(node)}
                disabled={!canToggle}
                aria-label={node.isExpanded ? "Collapse" : "Expand"}
              >
                {canToggle ? (node.isExpanded ? "-" : "+") : ""}
              </button>
              <button
                type="button"
                className={labelClasses}
                onClick={() => handleSelectPrefix(node.prefix)}
                title={node.name}
              >
                {node.prefix === "" ? <BucketIcon className="h-3.5 w-3.5" /> : <FolderIcon className="h-3.5 w-3.5" />}
                <span className="whitespace-nowrap">{node.name}</span>
              </button>
            </div>
            {node.isExpanded && (node.isLoading || node.children.length > 0) && (
              <div className="mt-1">
                {node.isLoading ? (
                  <div className="pl-6 ui-caption text-slate-400 dark:text-slate-500">Loading...</div>
                ) : (
                  renderTreeNodes(node.children, depth + 1)
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  const handleEnsureCors = async () => {
    if (!bucketName || !hasS3AccountContext || !uiOrigin) return;
    setCorsFixing(true);
    setCorsFixError(null);
    setStatusMessage(null);
    try {
      const status = await ensureBucketCors(accountIdForApi, bucketName, uiOrigin);
      setCorsStatus(status);
      if (status.enabled) {
        setStatusMessage("CORS rules updated for this bucket.");
      } else {
        setCorsFixError(status.error ?? "CORS is still not enabled for this origin.");
      }
    } catch (err) {
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
    setCompletedOperations((prev) => [
      { id: makeId(), label: action, path, when: new Date().toLocaleTimeString() },
      ...prev,
    ].slice(0, COMPLETED_OPERATIONS_LIMIT));
  };

  const extractErrorDetails = (payload: unknown): { code?: string; message?: string } | null => {
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
  };

  const formatOperationError = (err: unknown, fallback: string, context?: string) => {
    let detail: string | undefined;
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const statusText = err.response?.statusText;
      const statusLabel = status ? `HTTP ${status}${statusText ? ` ${statusText}` : ""}` : "";
      const parsed = extractErrorDetails(err.response?.data);
      const message = parsed?.code && parsed?.message ? `${parsed.code}: ${parsed.message}` : parsed?.message || parsed?.code;
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
      const normalize = (value: string) => value.trim().replace(/[.:]\s*$/, "");
      const normalizedContext = normalize(context);
      if (!detail && normalizedContext === normalize(fallback)) {
        return fallback;
      }
      return `${normalizedContext}: ${message}`;
    }
    return message;
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
    const resolvedItems = items.length > 0 ? items : pathTarget ? [pathTarget] : [];
    if (resolvedItems.length === 0) return;
    setBulkActionItems(resolvedItems);
    resetBulkRestoreDraft();
    if (items.length === 0 && pathTarget && bucketName) {
      setBulkRestoreTargetPath(currentPath || bucketName);
    }
    setShowBulkRestoreModal(true);
  };

  const openObjectVersionsModal = (item: BrowserItem) => {
    if (!bucketName || !hasS3AccountContext || item.type !== "file" || !isVersioningEnabled) return;
    setObjectVersionsModalKey(item.key);
    setObjectVersionsModalPath(`${bucketName}/${item.key}`);
    setObjectVersionsModal([]);
    setObjectDeleteMarkersModal([]);
    setObjectVersionsModalError(null);
    setObjectVersionModalKeyMarker(null);
    setObjectVersionModalIdMarker(null);
    setShowObjectVersionsModal(true);
    loadObjectVersionsModal({ append: false, keyMarker: null, versionIdMarker: null, targetKey: item.key });
  };

  const closeObjectVersionsModal = () => {
    setShowObjectVersionsModal(false);
    setObjectVersionsModalKey(null);
    setObjectVersionsModalPath(null);
    setObjectVersionsModal([]);
    setObjectDeleteMarkersModal([]);
    setObjectVersionsModalLoading(false);
    setObjectVersionsModalError(null);
    setObjectVersionModalKeyMarker(null);
    setObjectVersionModalIdMarker(null);
  };

  const requestObjectsRefresh = (prefixOverride: string) => {
    if (typeof window === "undefined") return;
    if (objectsRefreshTimeoutRef.current !== null) return;
    objectsRefreshTimeoutRef.current = window.setTimeout(() => {
      objectsRefreshTimeoutRef.current = null;
      void loadObjects({ prefixOverride, silent: true });
      loadTreeChildren(prefixOverride, { expand: false });
    }, 400);
  };

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
      const bucketKeys = pendingUploadedKeysByBucketRef.current.get(currentBucket);
      const shouldRefreshCurrentPath = Boolean(
        bucketKeys && Array.from(bucketKeys).some((key) => key.startsWith(normalizedCurrentPrefix))
      );
      pendingUploadedKeysByBucketRef.current.clear();
      if (!shouldRefreshCurrentPath) return;
      void loadObjects({ prefixOverride: currentPrefixValue, silent: true });
      loadTreeChildren(currentPrefixValue, { expand: false });
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (objectsRefreshTimeoutRef.current !== null) {
        window.clearTimeout(objectsRefreshTimeoutRef.current);
        objectsRefreshTimeoutRef.current = null;
      }
      if (uploadRefreshTimeoutRef.current !== null) {
        window.clearTimeout(uploadRefreshTimeoutRef.current);
        uploadRefreshTimeoutRef.current = null;
      }
      pendingUploadedKeysByBucketRef.current.clear();
    };
  }, []);

  const startOperation = (
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
    progress = status === "uploading" || status === "downloading" ? 0 : 20
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
  };

  const completeOperation = (
    operationId: string,
    status: OperationCompletionStatus = "done",
    errorMessage?: string
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
              errorMessage: status === "failed" ? errorMessage ?? op.errorMessage : undefined,
            }
          : op
      )
    );
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
    } catch (err) {
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
    updateUploadQueue(uploadQueueRef.current.filter((item) => item.id !== uploadId));
  };

  const removeQueuedUploadsByGroup = (groupId: string) => {
    updateUploadQueue(uploadQueueRef.current.filter((item) => item.groupId !== groupId));
  };

  const cancelUploadOperation = (operationId: string) => {
    const controller = uploadControllersRef.current.get(operationId);
    if (controller) {
      controller.abort();
    }
  };

  const cancelDownloadOperation = (operationId: string) => {
    const controller = downloadControllersRef.current.get(operationId);
    if (controller) {
      controller.abort();
    }
  };

  const cancelDownloadDetails = (operationId: string) => {
    setDownloadDetails((prev) => {
      const items = prev[operationId];
      if (!items) return prev;
      const nextItems = items.map((item) =>
        item.status === "queued" || item.status === "downloading"
          ? { ...item, status: "cancelled", errorMessage: undefined }
          : item
      );
      return { ...prev, [operationId]: nextItems };
    });
  };

  const cancelOperation = (operationId: string) => {
    cancelUploadOperation(operationId);
    cancelDownloadOperation(operationId);
    cancelDownloadDetails(operationId);
  };

  const cancelUploadGroup = (groupId: string) => {
    removeQueuedUploadsByGroup(groupId);
    const activeGroupOperations = operations.filter(
      (op) => op.kind === "upload" && op.groupId === groupId && !op.completedAt
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
    if (!bucketName || !hasS3AccountContext || !accountIdForApi || items.length === 0) return;
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
      setStatusMessage(queuedFromBatch === 1 ? "1 upload queued." : `${queuedFromBatch} uploads queued.`);
    }
  };

  const uploadSimple = async (
    accountId: string,
    bucket: string,
    file: File,
    key: string,
    onProgress: (event: ProgressEvent) => void,
    controller?: AbortController
  ) => {
    if (useProxyTransfers) {
      await proxyUpload(accountId, bucket, key, file, onProgress, controller?.signal);
      return;
    }
    const usePutPresign = stsReady;
    const operation: PresignRequest["operation"] = usePutPresign ? "put_object" : "post_object";
    const presign = await presignObjectRequest(bucket, {
      key,
      operation,
      content_type: file.type || undefined,
      content_length: file.size,
      expires_in: 1800,
    });
    const method = (presign.method || "").toUpperCase();
    const hasPostFields = Boolean(presign.fields && Object.keys(presign.fields).length > 0);
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
      headers: { ...(presign.headers || {}), "Content-Type": file.type || "application/octet-stream" },
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
    controller: AbortController
  ) => {
    let uploadId: string | null = null;
    const totalParts = Math.ceil(file.size / PART_SIZE);
    const partProgress = new Map<number, number>();

    const updateProgress = () => {
      const loaded = Array.from(partProgress.values()).reduce((sum, value) => sum + value, 0);
      const percent = file.size ? Math.min(99, Math.round((loaded / file.size) * 100)) : 0;
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: percent } : op)));
    };

    const recordProgress = (partNumber: number, loadedBytes: number, partSize: number) => {
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

    const uploadPart = async (part: { partNumber: number; start: number; end: number; size: number }) => {
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
      const etag = normalizeEtag(response.headers?.etag || response.headers?.ETag || response.headers?.ETAG);
      if (!etag) {
        throw new Error("Missing ETag from multipart upload.");
      }
      uploadedParts.push({ part_number: part.partNumber, etag });
      recordProgress(part.partNumber, part.size, part.size);
    };

    try {
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, label: "Multipart upload" } : op)));
      const init = await initiateMultipartUpload(accountId, bucket, {
        key,
        content_type: file.type || undefined,
      });
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
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: 95 } : op)));
      uploadedParts.sort((a, b) => a.part_number - b.part_number);
      await completeMultipartUpload(accountId, bucket, uploadId, key, { parts: uploadedParts });
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: 100 } : op)));
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
    const { file, relativePath, key, bucket, accountId, groupId, groupLabel, groupKind, itemLabel } = item;
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
      }
    );
    const controller = new AbortController();
    uploadControllersRef.current.set(operationId, controller);
    try {
      if (!useProxyTransfers && file.size >= MULTIPART_THRESHOLD) {
        await uploadMultipart(accountId, bucket, file, key, operationId, controller);
      } else {
        const onProgress = (event: ProgressEvent) => {
          const total = event.total ?? file.size;
          const progress = total ? Math.round((event.loaded / total) * 100) : 0;
          setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress } : op)));
        };
        await uploadSimple(accountId, bucket, file, key, onProgress, controller);
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
          `Upload failed for ${relativePath}`
        );
        completeOperation(operationId, "failed", completionError);
        setStatusMessage(completionError);
        if (!useProxyTransfers && isLikelyCorsError(err)) {
          setWarningMessage(
            `Possible CORS or endpoint issue. Ensure bucket CORS allows origin ${window.location.origin} with PUT/GET/HEAD and headers like Content-Type or x-amz-*.`
          );
        }
      }
    } finally {
      uploadControllersRef.current.delete(operationId);
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
    return Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file");
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

  const downloadObjectBlob = async (key: string, signal?: AbortSignal) => {
    if (!bucketName || !hasS3AccountContext) {
      throw new Error("Missing bucket context.");
    }
    if (useProxyTransfers) {
      return proxyDownload(accountIdForApi, bucketName, key, signal);
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
      const detailLabel = code && detail ? `${code}: ${detail}` : detail || code;
      const parts = [statusLabel, detailLabel].filter(Boolean);
      const suffix = parts.length > 0 ? `: ${parts.join(" - ")}` : "";
      throw new Error(`Download failed for ${key}${suffix}`);
    }
    return response.blob();
  };

  const buildAuthHeaders = () => {
    const headers: Record<string, string> = {};
    if (typeof window === "undefined") return headers;
    const token = localStorage.getItem("token");
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const accountId = localStorage.getItem("selectedExecutionContextId");
    if (accountId) {
      const mode = localStorage.getItem(`managerAccessMode:${accountId}`);
      if (mode === "admin" || mode === "portal") {
        headers["X-Manager-Access-Mode"] = mode;
      }
    }
    const userRaw = localStorage.getItem("user");
    if (userRaw) {
      try {
        const parsed = JSON.parse(userRaw) as { authType?: string };
        if (parsed?.authType === "rgw_session") {
          const endpoint = localStorage.getItem("s3SessionEndpoint");
          if (endpoint) {
            headers["X-S3-Endpoint"] = endpoint;
          }
        }
      } catch (err) {
        console.warn("Unable to parse stored user payload", err);
      }
    }
    return headers;
  };

  const buildApiUrl = (path: string, params?: Record<string, unknown>) => {
    const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(`${base}/${normalizedPath}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        url.searchParams.set(key, String(value));
      });
    }
    return url.toString();
  };

  const downloadObjectStream = async (key: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> => {
    if (!bucketName || !hasS3AccountContext) {
      throw new Error("Missing bucket context.");
    }
    if (useProxyTransfers) {
      const params = withS3AccountParam({ key }, accountIdForApi);
      const url = buildApiUrl(
        `/browser/buckets/${encodeURIComponent(bucketName)}/proxy-download`,
        params ?? undefined
      );
      const response = await fetch(url, {
        headers: buildAuthHeaders(),
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
        const detailLabel = code && detail ? `${code}: ${detail}` : detail || code;
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
      const detailLabel = code && detail ? `${code}: ${detail}` : detail || code;
      const parts = [statusLabel, detailLabel].filter(Boolean);
      const suffix = parts.length > 0 ? `: ${parts.join(" - ")}` : "";
      throw new Error(`Download failed for ${key}${suffix}`);
    }
    if (!response.body) {
      throw new Error("Streaming download is not supported in this browser.");
    }
    return response.body;
  };

  const listAllObjectsForPrefix = async (targetPrefix: string, targetBucket?: string) => {
    const bucket = targetBucket ?? bucketName;
    if (!bucket || !hasS3AccountContext) return [];
    const collected: BrowserObject[] = [];
    let continuation: string | null = null;
    let hasMore = true;
    while (hasMore) {
      const data = await listBrowserObjects(accountIdForApi, bucket, {
        prefix: targetPrefix,
        continuationToken: continuation,
        maxKeys: 1000,
        type: "file",
        recursive: true,
      });
      collected.push(...data.objects);
      continuation = data.next_continuation_token ?? null;
      hasMore = Boolean(data.is_truncated && continuation);
    }
    return collected;
  };

  const listAllVersionsForPrefix = async (targetPrefix: string) => {
    if (!bucketName || !hasS3AccountContext || !isVersioningEnabled) return { versions: [], deleteMarkers: [] };
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
    if (!bucketName || !hasS3AccountContext || !isVersioningEnabled) return { versions: [], deleteMarkers: [] };
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
    entries.slice().sort((a, b) => getVersionEntryTime(b) - getVersionEntryTime(a));

  const findVersionForDate = (entries: BrowserObjectVersion[], targetTime: number) => {
    const sorted = sortVersionEntriesByDateDesc(entries);
    return sorted.find((entry) => {
      if (!entry.last_modified) return false;
      return new Date(entry.last_modified).getTime() <= targetTime;
    });
  };

  const findLatestRestorableVersion = (entries: BrowserObjectVersion[]) => {
    const sorted = sortVersionEntriesByDateDesc(entries);
    return (
      sorted.find((entry) => !entry.is_delete_marker && typeof entry.version_id === "string" && entry.version_id.length > 0) ??
      null
    );
  };

  const updateDeleteDetailsStatus = (
    operationId: string,
    keys: string[],
    status: DeleteDetailStatus,
    errorMessage?: string
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
          errorMessage: status === "failed" ? errorMessage ?? item.errorMessage : undefined,
        };
      });
      return { ...prev, [operationId]: nextItems };
    });
  };

  const deleteObjectsInBatches = async (
    keys: string[],
    onProgress?: (deleted: number, total: number) => void,
    detailOperationId?: string
  ) => {
    if (!bucketName || !hasS3AccountContext || keys.length === 0) return;
    const uniqueKeys = Array.from(new Set(keys));
    const total = uniqueKeys.length;
    const chunks = chunkItems(uniqueKeys, 1000);
    let deletedCount = 0;
    let hasError: unknown = null;
    const queue = [...chunks];
    const workerCount = Math.max(1, Math.min(otherOperationsParallelismRef.current, queue.length));
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0 && !hasError) {
        const chunk = queue.shift();
        if (!chunk) return;
        try {
          if (detailOperationId) {
            updateDeleteDetailsStatus(detailOperationId, chunk, "deleting");
          }
          await deleteObjects(
            accountIdForApi,
            bucketName,
            chunk.map((key) => ({ key }))
          );
          if (detailOperationId) {
            updateDeleteDetailsStatus(detailOperationId, chunk, "done");
          }
          deletedCount += chunk.length;
          onProgress?.(deletedCount, total);
        } catch (err) {
          if (detailOperationId) {
            updateDeleteDetailsStatus(detailOperationId, chunk, "failed", formatOperationError(err, "Delete failed."));
          }
          hasError = err;
        }
      }
    });
    await Promise.all(workers);
    if (hasError) {
      throw hasError;
    }
  };

  const deleteFolderRecursive = async (folderItem: BrowserItem) => {
    if (!bucketName || !hasS3AccountContext || folderItem.type !== "folder") return;
    setShowOperationsModal(true);
    const folderPrefix = normalizePrefix(folderItem.key);
    const operationId = startOperation(
      "deleting",
      "Deleting folder",
      `${bucketName}/${folderPrefix}`,
      { kind: "delete" },
      0
    );
    let completionStatus: OperationCompletionStatus = "done";
    let completionError: string | undefined;
    try {
      const objects = await listAllObjectsForPrefix(folderPrefix);
      const keys = Array.from(new Set([...objects.map((obj) => obj.key), folderPrefix]));
      if (keys.length === 0) {
        setStatusMessage("Folder is empty.");
        return;
      }
      const detailItems = objects.map((obj) => {
        const relativeKey = obj.key.startsWith(folderPrefix) ? obj.key.slice(folderPrefix.length) : obj.key;
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
      await deleteObjectsInBatches(keys, (deleted, total) => {
        const progress = total > 0 ? Math.min(100, Math.round((deleted / total) * 100)) : 0;
        setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress } : op)));
      }, detailItems.length > 0 ? operationId : undefined);
      setStatusMessage(`Deleted folder ${folderItem.name}`);
    } catch (err) {
      completionStatus = "failed";
      completionError = formatOperationError(err, "Unable to delete folder.", "Unable to delete folder.");
      setStatusMessage(completionError);
    } finally {
      completeOperation(operationId, completionStatus, completionError);
    }
  };

  const updateDownloadDetail = (
    operationId: string,
    detailId: string,
    status: DownloadDetailStatus,
    errorMessage?: string
  ) => {
    setDownloadDetails((prev) => {
      const items = prev[operationId];
      if (!items) return prev;
      const nextItems = items.map((item) =>
        item.id === detailId
          ? {
              ...item,
              status,
              errorMessage: status === "failed" ? errorMessage ?? item.errorMessage : undefined,
            }
          : item
      );
      return { ...prev, [operationId]: nextItems };
    });
  };

  const updateCopyDetailStatus = (
    operationId: string,
    detailId: string,
    status: CopyDetailStatus,
    errorMessage?: string
  ) => {
    setCopyDetails((prev) => {
      const items = prev[operationId];
      if (!items) return prev;
      const nextItems = items.map((item) =>
        item.id === detailId
          ? {
              ...item,
              status,
              errorMessage: status === "failed" ? errorMessage ?? item.errorMessage : undefined,
            }
          : item
      );
      return { ...prev, [operationId]: nextItems };
    });
  };

  const handleDownloadFolder = async (folderItem: BrowserItem) => {
    if (!bucketName || !hasS3AccountContext || folderItem.type !== "folder") return;
    setShowOperationsModal(true);
    setWarningMessage(null);
    const folderPrefix = normalizePrefix(folderItem.key);
    const rawLabel = folderItem.name || folderPrefix.replace(/\/$/, "") || "folder";
    const folderLabel = rawLabel.replace(/[\\/]/g, "-") || "folder";
    const operationId = startOperation(
      "downloading",
      "Preparing download",
      `${bucketName}/${folderPrefix}`,
      { kind: "download", cancelable: true }
    );
    const controller = new AbortController();
    downloadControllersRef.current.set(operationId, controller);
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
          const relativeKey = obj.key.startsWith(folderPrefix) ? obj.key.slice(folderPrefix.length) : obj.key;
          if (!relativeKey) return null;
          if (relativeKey.endsWith("/") && (obj.size ?? 0) === 0) return null;
          return {
            obj,
            relativeKey,
            detailId: makeId(),
          };
        })
        .filter((entry): entry is { obj: BrowserObject; relativeKey: string; detailId: string } => Boolean(entry));
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
      const totalBytes = downloadTargets.reduce((sum, target) => sum + (target.obj.size ?? 0), 0);
      const streamingZipThresholdBytes =
        Math.max(0, (browserSettings?.streaming_zip_threshold_mb ?? DEFAULT_STREAMING_ZIP_THRESHOLD_MB)) *
        1024 *
        1024;
      const totalCount = downloadTargets.length;
      let downloadedBytes = 0;
      let completed = 0;
      let aborted = false;
      const errors: string[] = [];

      const updateProgress = () => {
        const base = totalBytes > 0 ? downloadedBytes / totalBytes : completed / totalCount;
        const percent = Math.min(80, Math.round(base * 80));
        setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: percent } : op)));
      };

      const saveFilePicker =
        typeof window !== "undefined"
          ? (window as Window & { showSaveFilePicker?: (options?: unknown) => Promise<unknown> }).showSaveFilePicker
          : undefined;
      const supportsStreamingZip = Boolean(
        saveFilePicker &&
          typeof ReadableStream !== "undefined" &&
          typeof WritableStream !== "undefined" &&
          typeof TransformStream !== "undefined"
      );
      const shouldStreamZip = supportsStreamingZip && totalBytes >= streamingZipThresholdBytes;

      if (shouldStreamZip && saveFilePicker) {
        let fileStream: (WritableStream<Uint8Array> & { abort?: () => Promise<void> }) | null = null;
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
          fileStream = (await handle.createWritable()) as WritableStream<Uint8Array> & { abort?: () => Promise<void> };
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

        setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, label: "Streaming zip" } : op)));

        for (const target of downloadTargets) {
          if (controller.signal.aborted) {
            aborted = true;
            break;
          }
          updateDownloadDetail(operationId, target.detailId, "downloading");
          try {
            const stream = await downloadObjectStream(target.obj.key, controller.signal);
            const counter = new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, streamController) {
                downloadedBytes += chunk.byteLength;
                updateProgress();
                streamController.enqueue(chunk);
              },
            });
            await zipWriter.add(`${folderLabel}/${target.relativeKey}`, stream.pipeThrough(counter));
            updateDownloadDetail(operationId, target.detailId, "done");
          } catch (err) {
            if (isAbortError(err) || controller.signal.aborted) {
              updateDownloadDetail(operationId, target.detailId, "cancelled");
              aborted = true;
              controller.abort();
              break;
            }
            console.error(err);
            updateDownloadDetail(operationId, target.detailId, "failed", formatOperationError(err, "Download failed."));
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
        setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: 100 } : op)));
      } else {
        const zip = new JSZip();
        const queue = [...downloadTargets];
        const workerCount = Math.max(1, Math.min(downloadParallelismRef.current, queue.length));
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
              const blob = await downloadObjectBlob(obj.obj.key, controller.signal);
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
              updateDownloadDetail(operationId, obj.detailId, "failed", formatOperationError(err, "Download failed."));
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

        setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, label: "Packaging zip" } : op)));
        const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
          const percent = Math.min(99, 80 + Math.round(metadata.percent * 0.2));
          setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: percent } : op)));
        });
        if (controller.signal.aborted) {
          setStatusMessage(`Download cancelled for ${folderLabel}`);
          cancelDownloadDetails(operationId);
          return;
        }
        setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: 100 } : op)));

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
        completionError = formatOperationError(err, "Unable to download folder.", "Unable to download folder.");
        setStatusMessage(completionError);
      }
    } finally {
      downloadControllersRef.current.delete(operationId);
      completeOperation(operationId, completionStatus, completionError);
    }
  };

  const handleDownloadMultipleFiles = async (targets: BrowserItem[]) => {
    if (!bucketName || !hasS3AccountContext) return;
    const files = targets.filter((item) => item.type === "file" && !item.isDeleted);
    if (files.length <= 1) {
      await handleDownloadItems(files);
      return;
    }
    setShowOperationsModal(true);
    const operationId = startOperation(
      "downloading",
      `Downloading ${files.length} files`,
      currentPath || bucketName,
      { kind: "download", cancelable: true }
    );
    const controller = new AbortController();
    downloadControllersRef.current.set(operationId, controller);
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
    const totalBytes = downloadTargets.reduce((sum, target) => sum + (target.item.sizeBytes ?? 0), 0);
    const totalCount = downloadTargets.length;
    let downloadedBytes = 0;
    let completed = 0;
    let aborted = false;
    let failedCount = 0;

    const updateProgress = () => {
      const base = totalBytes > 0 ? downloadedBytes / totalBytes : completed / totalCount;
      const percent = Math.min(100, Math.round(base * 100));
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: percent } : op)));
    };

    try {
      const queue = [...downloadTargets];
      const workerCount = Math.max(1, Math.min(downloadParallelismRef.current, queue.length));
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
            const blob = await downloadObjectBlob(target.item.key, controller.signal);
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
            updateDownloadDetail(operationId, target.detailId, "failed", formatOperationError(err, "Download failed."));
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
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: 100 } : op)));
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
        completionError = formatOperationError(err, "Unable to download files.", "Unable to download files.");
        setStatusMessage(completionError);
      }
    } finally {
      downloadControllersRef.current.delete(operationId);
      completeOperation(operationId, completionStatus, completionError);
    }
  };

  const handleDownloadItems = async (targets: BrowserItem[]) => {
    if (!bucketName || !hasS3AccountContext || targets.length === 0) return;
    const files = targets.filter((item) => item.type === "file" && !item.isDeleted);
    const deletedCount = targets.filter((item) => item.type === "file" && item.isDeleted).length;
    if (files.length === 0) {
      if (deletedCount > 0) {
        setWarningMessage("Deleted objects cannot be downloaded directly.");
      }
      return;
    }
    if (deletedCount > 0) {
      setWarningMessage("Deleted objects were skipped. Open versions to restore before download.");
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
          const blob = await proxyDownload(accountIdForApi, bucketName, item.key);
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
    } catch (err) {
      setStatusMessage(useProxyTransfers ? "Unable to download object." : "Unable to generate download URL.");
    }
  };

  const handleDownloadTarget = (item: BrowserItem) => {
    if (item.isDeleted) {
      setWarningMessage("This item is deleted. Open it or use versions to restore content before downloading.");
      if (item.type === "file" && isVersioningEnabled) {
        openObjectVersionsModal(item);
      }
      return;
    }
    if (item.type === "folder") {
      void handleDownloadFolder(item);
      return;
    }
    void handleDownloadItems([item]);
  };

  const handleDeleteItems = async (targets: BrowserItem[]) => {
    if (!bucketName || !hasS3AccountContext || targets.length === 0) return;
    const fileTargets = targets.filter((item) => item.type === "file" && !item.isDeleted);
    const folderTargets = targets.filter((item) => item.type === "folder" && !item.isDeleted);
    const hasDeletedTargets = targets.some((item) => item.isDeleted);
    if (hasDeletedTargets) {
      setWarningMessage("Deleted items are shown from delete markers. Use versions to restore or remove markers.");
    } else {
      setWarningMessage(null);
    }
    if (fileTargets.length === 0 && folderTargets.length === 0) return;
    const confirmed = window.confirm(
      folderTargets.length > 0
        ? `Delete ${fileTargets.length} object(s) and ${folderTargets.length} folder(s)? This removes all objects within the selected folders.`
        : `Delete ${fileTargets.length} object(s)?`
    );
    if (!confirmed) return;
    if (fileTargets.length > 1 || folderTargets.length > 0) {
      setShowOperationsModal(true);
    }
    try {
      if (fileTargets.length > 0) {
        const targetPath =
          fileTargets.length === 1 ? `${bucketName}/${fileTargets[0].key}` : (currentPath || bucketName);
        const operationLabel =
          fileTargets.length === 1 ? "Deleting object" : `Deleting ${fileTargets.length} objects`;
        const operationKind = fileTargets.length > 1 ? "delete" : "other";
        const operationId = startOperation("deleting", operationLabel, targetPath, { kind: operationKind }, 0);
        let completionStatus: OperationCompletionStatus = "done";
        let completionError: string | undefined;
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
          await deleteObjectsInBatches(
            fileTargets.map((item) => item.key),
            (deleted, total) => {
              const progress = total > 0 ? Math.min(100, Math.round((deleted / total) * 100)) : 0;
              setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress } : op)));
            },
            fileTargets.length > 1 ? operationId : undefined
          );
          setStatusMessage(`Deleted ${fileTargets.length} object(s)`);
        } catch (err) {
          completionStatus = "failed";
          completionError = formatOperationError(
            err,
            "Unable to delete selected objects.",
            "Unable to delete selected objects."
          );
          setStatusMessage(completionError);
        } finally {
          completeOperation(operationId, completionStatus, completionError);
        }
      }
      for (const folder of folderTargets) {
        await deleteFolderRecursive(folder);
      }
      const processedTargets = [...fileTargets, ...folderTargets];
      setSelectedIds((prev) =>
        prev.filter((id) => !processedTargets.some((item) => item.id === id))
      );
      await loadObjects({ prefixOverride: prefix });
      loadTreeChildren(prefix);
    } catch (err) {
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
    if (!shouldApplyMetadata && !shouldApplyTags && !shouldApplyStorage && !shouldApplyAcl && !shouldApplyLegalHold && !shouldApplyRetention) {
      setBulkAttributesError("Select at least one attribute to update.");
      return;
    }

    const metadataPairs = parseKeyValueLines(bulkMetadataEntries);
    const tagsPairs = parseKeyValueLines(bulkTagsDraft);
    const expiresIso = bulkMetadataDraft.expires.trim() ? toIsoString(bulkMetadataDraft.expires) : "";
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
    if (shouldApplyMetadata && bulkMetadataDraft.expires.trim() && !expiresIso) {
      setBulkAttributesError("Provide a valid expires date.");
      return;
    }
    if (shouldApplyTags && tagsPairs.length === 0) {
      setBulkAttributesError("Provide at least one tag.");
      return;
    }
    const retentionIso = bulkRetentionDate ? toIsoString(bulkRetentionDate) : "";
    if (shouldApplyRetention && (!bulkRetentionMode || !bulkRetentionDate || !retentionIso)) {
      setBulkAttributesError("Provide retention mode and date.");
      return;
    }

    setBulkAttributesLoading(true);
    setBulkAttributesError(null);
    setBulkAttributesSummary(null);
    try {
      const keys = await resolveBulkAttributeKeys(bulkActionItems);
      if (keys.length === 0) {
        setBulkAttributesError("No objects to update.");
        return;
      }
      if (keys.length > 1) {
        setShowOperationsModal(true);
      }
      const operationId = startOperation(
        "copying",
        "Updating attributes",
        currentPath || bucketName,
        { kind: "other" },
        0
      );
      const total = keys.length;
      let completed = 0;
      let failures = 0;

      const updateProgress = () => {
        const percent = total > 0 ? Math.round((completed / total) * 100) : 100;
        setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: percent } : op)));
      };

      const metadataRecord = metadataPairs.length > 0 ? pairsToRecord(metadataPairs) : undefined;

      const applyForKey = async (key: string) => {
        if (shouldApplyMetadata || shouldApplyStorage) {
          const payload = {
            key,
            content_type: shouldApplyMetadata && bulkMetadataDraft.contentType.trim() ? bulkMetadataDraft.contentType.trim() : undefined,
            cache_control: shouldApplyMetadata && bulkMetadataDraft.cacheControl.trim() ? bulkMetadataDraft.cacheControl.trim() : undefined,
            content_disposition:
              shouldApplyMetadata && bulkMetadataDraft.contentDisposition.trim()
                ? bulkMetadataDraft.contentDisposition.trim()
                : undefined,
            content_encoding:
              shouldApplyMetadata && bulkMetadataDraft.contentEncoding.trim() ? bulkMetadataDraft.contentEncoding.trim() : undefined,
            content_language:
              shouldApplyMetadata && bulkMetadataDraft.contentLanguage.trim() ? bulkMetadataDraft.contentLanguage.trim() : undefined,
            expires: shouldApplyMetadata && expiresIso ? expiresIso : undefined,
            metadata: shouldApplyMetadata && metadataRecord ? metadataRecord : undefined,
            storage_class: shouldApplyStorage ? bulkStorageClass : undefined,
          };
          await updateObjectMetadata(accountIdForApi, bucketName, payload);
        }
        if (shouldApplyTags) {
          await updateObjectTags(accountIdForApi, bucketName, { key, tags: tagsPairs });
        }
        if (shouldApplyAcl) {
          await updateObjectAcl(accountIdForApi, bucketName, { key, acl: bulkAclValue });
        }
        if (shouldApplyLegalHold) {
          await updateObjectLegalHold(accountIdForApi, bucketName, { key, status: bulkLegalHoldStatus });
        }
        if (shouldApplyRetention) {
          await updateObjectRetention(accountIdForApi, bucketName, {
            key,
            mode: bulkRetentionMode,
            retain_until: retentionIso,
            bypass_governance: bulkRetentionBypass,
          });
        }
      };

      const queue = [...keys];
      const workerCount = Math.max(1, Math.min(otherOperationsParallelismRef.current, queue.length));
      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
          const key = queue.shift();
          if (!key) return;
          try {
            await applyForKey(key);
          } catch (err) {
            failures += 1;
          } finally {
            completed += 1;
            updateProgress();
          }
        }
      });
      await Promise.all(workers);
      const completionError = failures > 0 ? "Some objects failed to update attributes." : undefined;
      completeOperation(operationId, failures > 0 ? "failed" : "done", completionError);
      const successCount = Math.max(0, total - failures);
      const summary = `Updated ${successCount} of ${total} object(s).`;
      setBulkAttributesSummary(summary);
      setStatusMessage(summary);
      requestObjectsRefresh(prefix);
    } catch (err) {
      setBulkAttributesError("Unable to update attributes.");
    } finally {
      setBulkAttributesLoading(false);
    }
  };

  const handleBulkRestoreApply = async () => {
    if (!bucketName || !hasS3AccountContext) return;
    if (!isVersioningEnabled) {
      setBulkRestoreError("Versioning is not enabled for this bucket.");
      return;
    }
    const targetTime = bulkRestoreDate ? new Date(bulkRestoreDate).getTime() : Number.NaN;
    if (!bulkRestoreDate || Number.isNaN(targetTime)) {
      setBulkRestoreError("Select a valid date.");
      return;
    }
    setBulkRestoreLoading(true);
    setBulkRestoreError(null);
    setBulkRestoreSummary(null);
    setBulkRestorePreview(null);
    try {
      const buildRestorePlan = async () => {
        const fileItems = bulkActionItems.filter((item) => item.type === "file");
        const folderItems = bulkActionItems.filter((item) => item.type === "folder");
        const restoreCandidates = new Map<string, string>();
        const presentAtDate = new Set<string>();
        const deleteCandidates = new Set<string>();
        const unchangedKeys = new Set<string>();

        for (const item of fileItems) {
          const { versions, deleteMarkers } = await listAllVersionsForKey(item.key);
          const allEntries = [...versions, ...deleteMarkers];
          const match = findVersionForDate(allEntries, targetTime);
          const latest = allEntries.find((entry) => entry.is_latest);
          const latestRestorable = findLatestRestorableVersion(allEntries);
          if (match && !match.is_delete_marker && match.version_id) {
            if (latest && !latest.is_delete_marker && latest.version_id === match.version_id) {
              unchangedKeys.add(item.key);
            } else {
              restoreCandidates.set(item.key, match.version_id);
            }
            presentAtDate.add(item.key);
          } else if (bulkRestoreRestoreDeleted && latest?.is_delete_marker && latestRestorable?.version_id) {
            restoreCandidates.set(item.key, latestRestorable.version_id);
          } else if (bulkRestoreDeleteMissing) {
            deleteCandidates.add(item.key);
          }
        }

        for (const folder of folderItems) {
          const folderPrefix = normalizePrefix(folder.key);
          const { versions, deleteMarkers } = await listAllVersionsForPrefix(folderPrefix);
          const byKey = new Map<string, BrowserObjectVersion[]>();
          [...versions, ...deleteMarkers].forEach((entry) => {
            const list = byKey.get(entry.key) ?? [];
            list.push(entry);
            byKey.set(entry.key, list);
          });
          byKey.forEach((entries, key) => {
            const match = findVersionForDate(entries, targetTime);
            const latest = entries.find((entry) => entry.is_latest);
            const latestRestorable = findLatestRestorableVersion(entries);
            if (match && !match.is_delete_marker && match.version_id) {
              if (latest && !latest.is_delete_marker && latest.version_id === match.version_id) {
                unchangedKeys.add(key);
              } else {
                restoreCandidates.set(key, match.version_id);
              }
              presentAtDate.add(key);
            } else if (bulkRestoreRestoreDeleted && latest?.is_delete_marker && latestRestorable?.version_id) {
              restoreCandidates.set(key, latestRestorable.version_id);
            }
          });
          if (bulkRestoreDeleteMissing) {
            const currentObjects = await listAllObjectsForPrefix(folderPrefix);
            currentObjects.forEach((obj) => {
              if (!presentAtDate.has(obj.key)) {
                deleteCandidates.add(obj.key);
              }
            });
          }
        }

        const restoreList = Array.from(restoreCandidates.entries()).map(([key, versionId]) => ({
          key,
          versionId,
        }));
        const deleteList = bulkRestoreDeleteMissing ? Array.from(deleteCandidates) : [];
        return { restoreList, deleteList, unchangedKeys };
      };

      const { restoreList, deleteList, unchangedKeys } = await buildRestorePlan();
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
          setBulkRestoreError("No objects matched the selected date.");
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
      const operationId = startOperation(
        "copying",
        "Restoring snapshot",
        currentPath || bucketName,
        { kind: "other" },
        0
      );
      let completed = 0;
      let restoreFailures = 0;
      let deleteFailures = 0;

      const updateProgress = (count: number) => {
        const percent = total > 0 ? Math.round((count / total) * 100) : 100;
        setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: percent } : op)));
      };

      if (restoreList.length > 0) {
        const queue = [...restoreList];
        const workerCount = Math.max(1, Math.min(otherOperationsParallelismRef.current, queue.length));
        const workers = Array.from({ length: workerCount }, async () => {
          while (queue.length > 0) {
            const item = queue.shift();
            if (!item) return;
            try {
              await copyObject(accountIdForApi, bucketName, {
                source_key: item.key,
                source_version_id: item.versionId,
                destination_key: item.key,
                replace_metadata: false,
                move: false,
              });
            } catch (err) {
              restoreFailures += 1;
            } finally {
              completed += 1;
              updateProgress(completed);
            }
          }
        });
        await Promise.all(workers);
      }

      if (deleteList.length > 0) {
        try {
          await deleteObjectsInBatches(deleteList, (deleted) => {
            updateProgress(completed + deleted);
          });
        } catch (err) {
          deleteFailures = deleteList.length;
        }
      }

      const failures = restoreFailures + deleteFailures;
      const completionError = failures > 0 ? "Some objects failed to restore or delete." : undefined;
      completeOperation(operationId, failures > 0 ? "failed" : "done", completionError);
      const summary = `Restored ${restoreList.length - restoreFailures} object(s), deleted ${deleteList.length - deleteFailures} object(s), unchanged ${unchangedCount} object(s).`;
      setBulkRestoreSummary(summary);
      setStatusMessage(summary);
      requestObjectsRefresh(prefix);
    } catch (err) {
      setBulkRestoreError("Unable to restore objects.");
    } finally {
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
    const operationId = startOperation("deleting", "Cleaning versions", currentPath || bucketName, { kind: "other" }, 0);
    let cleanupCompletionStatus: OperationCompletionStatus = "done";
    let cleanupCompletionError: string | undefined;
    try {
      const result = await cleanupObjectVersions(accountIdForApi, bucketName, {
        prefix: normalizedPrefix,
        keep_last_n: keepLastValue,
        older_than_days: olderThanValue,
        delete_orphan_markers: cleanupDeleteOrphanMarkers,
      });
      const summary = `Removed ${result.deleted_versions} version(s) and ${result.deleted_delete_markers} delete marker(s).`;
      setCleanupSummary(summary);
      setStatusMessage(summary);
      requestObjectsRefresh(prefix);
    } catch (err) {
      cleanupCompletionStatus = "failed";
      cleanupCompletionError = "Unable to clean versions for this prefix.";
      setCleanupError("Unable to clean versions for this prefix.");
    } finally {
      completeOperation(operationId, cleanupCompletionStatus, cleanupCompletionError);
      setCleanupLoading(false);
    }
  };

  const handleCopyItems = (items: BrowserItem[]) => {
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
    setClipboard({ items: eligible, sourceBucket: bucketName, sourceAccountId: accountIdForApi ?? null, mode: "copy" });
    setStatusMessage("Items copied.");
  };

  const handleCutItems = (items: BrowserItem[]) => {
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
    setClipboard({ items: eligible, sourceBucket: bucketName, sourceAccountId: accountIdForApi ?? null, mode: "move" });
    setStatusMessage("Items ready to move.");
  };

  const handlePasteItems = async () => {
    if (!clipboard || !bucketName || !hasS3AccountContext) return;
    if (!clipboardMatchesContext) {
      setWarningMessage("Paste between different accounts is blocked for security. Switch back to the source account.");
      return;
    }
    setWarningMessage(null);
    const destinationBucket = bucketName;
    const destinationPrefix = normalizedPrefix;
    const { items, sourceBucket, mode } = clipboard;
    const isMove = mode === "move";
    const copyTasks: Array<{
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
        if (sourceBucket === destinationBucket && destinationKey === item.key) {
          skipped += 1;
          continue;
        }
        const detailId = makeId();
        copyTasks.push({
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
        if (sourceBucket === destinationBucket && destFolderPrefix === sourcePrefix) {
          skipped += 1;
          continue;
        }
        try {
          await createFolder(accountIdForApi, destinationBucket, destFolderPrefix);
        } catch {
          // ignore folder creation failures
        }
        const objects = await listAllObjectsForPrefix(sourcePrefix, sourceBucket);
        objects.forEach((obj) => {
          const relativeKey = obj.key.startsWith(sourcePrefix) ? obj.key.slice(sourcePrefix.length) : obj.key;
          if (!relativeKey) return;
          const destinationKey = `${destFolderPrefix}${relativeKey}`;
          if (sourceBucket === destinationBucket && destinationKey === obj.key) {
            skipped += 1;
            return;
          }
          const detailId = makeId();
          copyTasks.push({
            sourceBucket,
            sourceKey: obj.key,
            destinationBucket,
            destinationKey,
            detailId,
          });
          copyDetailItems.push({
            id: detailId,
            key: destinationKey,
            label: shortName(destinationKey, destinationPrefix) || destinationKey,
            status: "queued",
            sizeBytes: obj.size ?? undefined,
          });
        });
      }
    }

    if (copyTasks.length === 0) {
      setStatusMessage(skipped > 0 ? "Nothing new to paste here." : "No items to paste.");
      return;
    }

    if (copyTasks.length > 1) {
      setShowOperationsModal(true);
    }
    const operationId = startOperation(
      "copying",
      isMove ? "Moving items" : "Copying items",
      destinationPrefix ? `${destinationBucket}/${destinationPrefix}` : destinationBucket,
      { kind: "copy" },
      0
    );
    if (copyDetailItems.length > 0) {
      setCopyDetails((prev) => ({ ...prev, [operationId]: copyDetailItems }));
    }
    const total = copyTasks.length;
    let completed = 0;
    let failures = 0;
    const updateProgress = () => {
      const percent = total > 0 ? Math.round((completed / total) * 100) : 100;
      setOperations((prev) => prev.map((op) => (op.id === operationId ? { ...op, progress: percent } : op)));
    };

    try {
      const queue = [...copyTasks];
      const workerCount = Math.max(1, Math.min(otherOperationsParallelismRef.current, queue.length));
      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
          const task = queue.shift();
          if (!task) return;
          try {
            updateCopyDetailStatus(operationId, task.detailId, "copying");
            await copyObject(accountIdForApi, destinationBucket, {
              source_bucket: task.sourceBucket,
              source_key: task.sourceKey,
              destination_key: task.destinationKey,
              move: isMove,
            });
            updateCopyDetailStatus(operationId, task.detailId, "done");
          } catch (err) {
            updateCopyDetailStatus(operationId, task.detailId, "failed", formatOperationError(err, "Copy failed."));
            failures += 1;
          } finally {
            completed += 1;
            updateProgress();
          }
        }
      });
      await Promise.all(workers);

      const completionError = failures > 0 ? "Some items failed to copy or move." : undefined;
      completeOperation(operationId, failures > 0 ? "failed" : "done", completionError);
      const summary = `${isMove ? "Moved" : "Copied"} ${total - failures} of ${total} item(s).`;
      setStatusMessage(summary);
      requestObjectsRefresh(prefix);
      if (isMove && failures === 0) {
        setClipboard(null);
      }
    } catch (err) {
      const completionError = formatOperationError(err, "Unable to paste items.", "Unable to paste items.");
      completeOperation(operationId, "failed", completionError);
      setStatusMessage(completionError);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shortcutsBlocked =
      showAdvancedModal ||
      showNewFolderModal ||
      showOperationsModal ||
      showBulkAttributesModal ||
      showBulkRestoreModal ||
      showCleanupModal ||
      showPrefixVersions ||
      showObjectVersionsModal ||
      Boolean(previewItem);
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      if (element.isContentEditable) return true;
      return Boolean(
        element.closest(
          "input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']"
        )
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
        setSelectedIds(listItems.map((item) => item.id));
        setInspectorTab("selection");
        return;
      }

      if (key === "l") {
        event.preventDefault();
        startEditingPath();
        return;
      }

      if (key === "c") {
        const targets = selectedItems.length > 0 ? selectedItems : inspectedItem ? [inspectedItem] : [];
        if (targets.length === 0) return;
        event.preventDefault();
        handleCopyItems(targets);
        return;
      }

      if (key === "x") {
        const targets = selectedItems.length > 0 ? selectedItems : inspectedItem ? [inspectedItem] : [];
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
    inspectedItem,
    listItems,
    previewItem,
    selectedItems,
    startEditingPath,
    showAdvancedModal,
    showNewFolderModal,
    showBulkAttributesModal,
    showBulkRestoreModal,
    showCleanupModal,
    showObjectVersionsModal,
    showOperationsModal,
    showPrefixVersions,
  ]);

  const refreshInspectedObject = async (targetKey?: string) => {
    if (!bucketName || !hasS3AccountContext || !targetKey) return;
    setMetadataLoading(true);
    setMetadataError(null);
    try {
      const [meta, tags] = await Promise.all([
        fetchObjectMetadata(accountIdForApi, bucketName, targetKey),
        getObjectTags(accountIdForApi, bucketName, targetKey),
      ]);
      setInspectedMetadata(meta);
      setInspectedTags(tags.tags ?? []);
      setInspectedTagsVersionId(tags.version_id ?? null);
    } catch (err) {
      setMetadataError("Unable to load object details.");
      setInspectedMetadata(null);
      setInspectedTags([]);
      setInspectedTagsVersionId(null);
    } finally {
      setMetadataLoading(false);
    }
  };

  const refreshVersionsForKey = async (targetKey: string) => {
    if (showPrefixVersions) {
      await loadPrefixVersions({ append: false, keyMarker: null, versionIdMarker: null });
    }
    if (inspectedItem?.type === "file" && inspectedItem.key === targetKey) {
      await loadObjectVersions({ append: false, keyMarker: null, versionIdMarker: null, targetKey });
    }
    if (showObjectVersionsModal && objectVersionsModalKey === targetKey) {
      await loadObjectVersionsModal({ append: false, keyMarker: null, versionIdMarker: null, targetKey });
    }
  };

  const handleAdvancedRefresh = async (targetKey: string) => {
    await refreshInspectedObject(targetKey);
    await loadObjects({ prefixOverride: prefix });
    await refreshVersionsForKey(targetKey);
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
    const operationId = startOperation("copying", "Restoring version", `${bucketName}/${item.key}`);
    let completionStatus: OperationCompletionStatus = "done";
    let completionError: string | undefined;
    try {
      await copyObject(accountIdForApi, bucketName, {
        source_key: item.key,
        source_version_id: item.version_id,
        destination_key: item.key,
        replace_metadata: false,
        move: false,
      });
      setStatusMessage(`Restored version ${item.version_id}`);
      await loadObjects({ prefixOverride: prefix });
      await refreshVersionsForKey(item.key);
    } catch (err) {
      completionStatus = "failed";
      completionError = formatOperationError(err, "Unable to restore version.", "Unable to restore version.");
      setStatusMessage(completionError);
    } finally {
      completeOperation(operationId, completionStatus, completionError);
    }
  };

  const handleDeleteVersion = async (item: BrowserObjectVersion) => {
    if (!bucketName || !hasS3AccountContext || !item.version_id || !isVersioningEnabled) return;
    setWarningMessage(null);
    const label = item.is_delete_marker ? "delete marker" : "version";
    const confirmed = window.confirm(`Delete ${label} for ${item.key}?`);
    if (!confirmed) return;
    const operationLabel = item.is_delete_marker ? "Removing delete marker" : "Deleting version";
    const operationId = startOperation("deleting", operationLabel, `${bucketName}/${item.key}`);
    let completionStatus: OperationCompletionStatus = "done";
    let completionError: string | undefined;
    try {
      await deleteObjects(accountIdForApi, bucketName, [{ key: item.key, version_id: item.version_id }]);
      setStatusMessage(item.is_delete_marker ? "Delete marker removed." : "Version deleted.");
      await loadObjects({ prefixOverride: prefix });
      await refreshVersionsForKey(item.key);
    } catch (err) {
      completionStatus = "failed";
      completionError = formatOperationError(
        err,
        item.is_delete_marker ? "Unable to delete marker." : "Unable to delete version.",
        item.is_delete_marker ? "Unable to delete marker." : "Unable to delete version."
      );
      setWarningMessage(completionError);
    } finally {
      completeOperation(operationId, completionStatus, completionError);
    }
  };

  const handleCopyUrl = async (item: BrowserItem | null) => {
    if (!bucketName || !hasS3AccountContext || !item || item.type !== "file" || item.isDeleted) {
      if (item?.isDeleted) {
        setWarningMessage("Deleted objects do not have a direct download URL.");
      }
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
        window.prompt("Copy URL:", presign.url);
      }
    } catch (err) {
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
        window.prompt("Copy path:", path);
      }
    } catch (err) {
      setStatusMessage("Unable to copy path.");
    }
  };

  const activeOperations = useMemo(() => operations.filter((op) => !op.completedAt), [operations]);
  const operationSummary = useMemo(() => {
    return activeOperations.reduce(
      (acc, op) => {
        acc[op.status] += 1;
        return acc;
      },
      { uploading: 0, deleting: 0, copying: 0, downloading: 0 } as Record<OperationItem["status"], number>
    );
  }, [activeOperations]);
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
      const activeBytes = group.activeItems.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
      const completedBytes = group.completedItems.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
      const queuedBytes = group.queuedItems.reduce((sum, item) => sum + item.file.size, 0);
      const totalBytes = activeBytes + completedBytes + queuedBytes;
      const loadedBytes = group.activeItems.reduce((sum, item) => {
        const size = item.sizeBytes ?? 0;
        const progress = Math.min(100, Math.max(0, item.progress));
        return sum + (size * progress) / 100;
      }, 0);
      const completedLoadedBytes = completedBytes;
      const totalLoadedBytes = loadedBytes + completedLoadedBytes;
      const progress = totalBytes > 0 ? Math.round((totalLoadedBytes / totalBytes) * 100) : 0;
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
          } as Record<DownloadDetailStatus | "total", number>
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
          { total: 0, queued: 0, deleting: 0, done: 0, failed: 0 } as Record<DeleteDetailStatus | "total", number>
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
          { total: 0, queued: 0, copying: 0, done: 0, failed: 0 } as Record<CopyDetailStatus | "total", number>
        );
        return { op, items, counts };
      });
  }, [copyDetails, operations]);
  const queuedDownloadCount = useMemo(
    () => downloadGroups.reduce((sum, group) => sum + group.counts.queued, 0),
    [downloadGroups]
  );
  const queuedDeleteCount = useMemo(
    () => deleteGroups.reduce((sum, group) => sum + group.counts.queued, 0),
    [deleteGroups]
  );
  const queuedCopyCount = useMemo(
    () => copyGroups.reduce((sum, group) => sum + group.counts.queued, 0),
    [copyGroups]
  );
  const hasFailedOperations = useMemo(() => {
    if (operations.some((op) => op.completionStatus === "failed")) {
      return true;
    }
    const hasFailedDownloadDetails = Object.values(downloadDetails).some((items) =>
      items.some((item) => item.status === "failed")
    );
    if (hasFailedDownloadDetails) {
      return true;
    }
    const hasFailedDeleteDetails = Object.values(deleteDetails).some((items) =>
      items.some((item) => item.status === "failed")
    );
    if (hasFailedDeleteDetails) {
      return true;
    }
    return Object.values(copyDetails).some((items) => items.some((item) => item.status === "failed"));
  }, [operations, downloadDetails, deleteDetails, copyDetails]);
  const failedUploadCount = useMemo(
    () => operations.filter((op) => op.kind === "upload" && op.completionStatus === "failed").length,
    [operations]
  );
  const failedDownloadCount = useMemo(
    () =>
      downloadGroups.reduce((sum, group) => {
        const failedItems = group.items.filter((item) => item.status === "failed").length;
        const fallback = failedItems === 0 && group.op.completionStatus === "failed" ? 1 : 0;
        return sum + failedItems + fallback;
      }, 0),
    [downloadGroups]
  );
  const failedDeleteCount = useMemo(
    () =>
      deleteGroups.reduce((sum, group) => {
        const failedItems = group.items.filter((item) => item.status === "failed").length;
        const fallback = failedItems === 0 && group.op.completionStatus === "failed" ? 1 : 0;
        return sum + failedItems + fallback;
      }, 0),
    [deleteGroups]
  );
  const failedCopyCount = useMemo(
    () =>
      copyGroups.reduce((sum, group) => {
        const failedItems = group.items.filter((item) => item.status === "failed").length;
        const fallback = failedItems === 0 && group.op.completionStatus === "failed" ? 1 : 0;
        return sum + failedItems + fallback;
      }, 0),
    [copyGroups]
  );
  const failedOtherOperations = useMemo(
    () =>
      operations.filter(
        (op) =>
          op.kind !== "upload" &&
          op.kind !== "download" &&
          op.kind !== "delete" &&
          op.kind !== "copy" &&
          op.completionStatus === "failed"
      ),
    [operations]
  );
  const pasteLabel = clipboard?.mode === "move" ? "Paste (Move)" : "Paste";
  const totalOperationsCount =
    activeOperations.length + uploadQueue.length + queuedDownloadCount + queuedDeleteCount + queuedCopyCount;
  const hasPendingOperations = totalOperationsCount > 0;
  const leaveMessage =
    "Des opérations sont en cours (upload, download, copie, suppression). Quitter maintenant peut les interrompre. Continuer ?";
  unstable_usePrompt({
    when: hasPendingOperations,
    message: leaveMessage,
  });
  const completedUploadCount = useMemo(
    () =>
      operations.filter(
        (op) => op.kind === "upload" && op.completedAt && op.completionStatus !== "failed"
      ).length,
    [operations]
  );
  const completedDownloadCount = useMemo(
    () =>
      downloadGroups.reduce(
        (sum, group) => {
          const completedItems = group.items.filter(
            (item) => item.status === "done" || item.status === "cancelled"
          ).length;
          const fallback =
            completedItems === 0 && group.op.completedAt && group.op.completionStatus !== "failed" ? 1 : 0;
          return sum + completedItems + fallback;
        },
        0
      ),
    [downloadGroups]
  );
  const completedDeleteCount = useMemo(
    () =>
      deleteGroups.reduce(
        (sum, group) => {
          const completedItems = group.items.filter((item) => item.status === "done").length;
          const fallback =
            completedItems === 0 && group.op.completedAt && group.op.completionStatus !== "failed" ? 1 : 0;
          return sum + completedItems + fallback;
        },
        0
      ),
    [deleteGroups]
  );
  const completedCopyCount = useMemo(
    () =>
      copyGroups.reduce(
        (sum, group) => {
          const completedItems = group.items.filter((item) => item.status === "done").length;
          const fallback =
            completedItems === 0 && group.op.completedAt && group.op.completionStatus !== "failed" ? 1 : 0;
          return sum + completedItems + fallback;
        },
        0
      ),
    [copyGroups]
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
          op.completionStatus !== "failed"
      ),
    [operations]
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
    failedUploadCount + failedDownloadCount + failedDeleteCount + failedCopyCount + failedOtherOperations.length;
  const completedOperationsCount =
    completedUploadCount +
    completedDownloadCount +
    completedDeleteCount +
    completedCopyCount +
    completedOtherOperations.length;
  const hasFinishedOperations = completedOperationsCount > 0 || failedOperationsCount > 0;
  const filtersAllInactive =
    !showActiveOperations && !showQueuedOperations && !showCompletedOperations && !showFailedOperations;
  const showAllOperations = filtersAllInactive;
  const showActiveFilter = showActiveOperations || showAllOperations;
  const showQueuedFilter = showQueuedOperations || showAllOperations;
  const showCompletedFilter = showCompletedOperations || showAllOperations;
  const showFailedFilter = showFailedOperations || showAllOperations;
  const activeOtherOperations = useMemo(
    () =>
      activeOperations.filter(
        (op) => op.kind !== "upload" && op.kind !== "download" && op.kind !== "delete" && op.kind !== "copy"
      ),
    [activeOperations]
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
    showActiveOperations,
    showQueuedOperations,
    showCompletedOperations,
    showFailedOperations,
  ]);
  const visibleUploadGroups = useMemo(() => {
    return uploadGroups.filter((group) => {
      const hasActive = group.activeItems.length > 0;
      const hasQueued = group.queuedItems.length > 0;
      const hasCompleted = group.completedItems.some((item) => item.completionStatus !== "failed");
      const hasFailed = group.completedItems.some((item) => item.completionStatus === "failed");
      return (
        (showActiveFilter && hasActive) ||
        (showQueuedFilter && hasQueued) ||
        (showCompletedFilter && hasCompleted) ||
        (showFailedFilter && hasFailed)
      );
    });
  }, [uploadGroups, showActiveOperations, showQueuedOperations, showCompletedOperations, showFailedOperations]);
  const visibleDownloadGroups = useMemo(() => {
    return downloadGroups.filter((group) => {
      const hasActive =
        !group.op.completedAt &&
        (group.op.status === "downloading" || group.items.some((item) => item.status === "downloading"));
      const hasQueued = group.items.some((item) => item.status === "queued");
      const hasCompleted = group.items.some(
        (item) => item.status === "done" || item.status === "cancelled"
      );
      const hasFailed =
        group.items.some((item) => item.status === "failed") || group.op.completionStatus === "failed";
      return (
        (showActiveFilter && hasActive) ||
        (showQueuedFilter && hasQueued) ||
        (showCompletedFilter && hasCompleted) ||
        (showCompletedFilter && Boolean(group.op.completedAt) && group.op.completionStatus !== "failed") ||
        (showFailedFilter && hasFailed)
      );
    });
  }, [downloadGroups, showActiveOperations, showQueuedOperations, showCompletedOperations, showFailedOperations]);
  const visibleDeleteGroups = useMemo(() => {
    return deleteGroups.filter((group) => {
      const hasActive =
        !group.op.completedAt &&
        (group.op.status === "deleting" || group.items.some((item) => item.status === "deleting"));
      const hasQueued = group.items.some((item) => item.status === "queued");
      const hasCompleted = group.items.some((item) => item.status === "done");
      const hasFailed =
        group.items.some((item) => item.status === "failed") || group.op.completionStatus === "failed";
      return (
        (showActiveFilter && hasActive) ||
        (showQueuedFilter && hasQueued) ||
        (showCompletedFilter && hasCompleted) ||
        (showCompletedFilter && Boolean(group.op.completedAt) && group.op.completionStatus !== "failed") ||
        (showFailedFilter && hasFailed)
      );
    });
  }, [deleteGroups, showActiveOperations, showQueuedOperations, showCompletedOperations, showFailedOperations]);
  const visibleCopyGroups = useMemo(() => {
    return copyGroups.filter((group) => {
      const hasActive =
        !group.op.completedAt &&
        (group.op.status === "copying" || group.items.some((item) => item.status === "copying"));
      const hasQueued = group.items.some((item) => item.status === "queued");
      const hasCompleted = group.items.some((item) => item.status === "done");
      const hasFailed =
        group.items.some((item) => item.status === "failed") || group.op.completionStatus === "failed";
      return (
        (showActiveFilter && hasActive) ||
        (showQueuedFilter && hasQueued) ||
        (showCompletedFilter && hasCompleted) ||
        (showCompletedFilter && Boolean(group.op.completedAt) && group.op.completionStatus !== "failed") ||
        (showFailedFilter && hasFailed)
      );
    });
  }, [copyGroups, showActiveOperations, showQueuedOperations, showCompletedOperations, showFailedOperations]);
  const operationSortIndexById = useMemo(() => {
    const next: Record<string, number> = {};
    operations.forEach((op, index) => {
      next[op.id] = index;
    });
    return next;
  }, [operations]);
  const uploadQueueOrderByGroup = useMemo(() => {
    const next: Record<string, number> = {};
    uploadQueue.forEach((item, index) => {
      if (next[item.groupId] == null) {
        next[item.groupId] = index;
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
        next[group.id] = Math.min(...opIndices);
        return;
      }
      next[group.id] = operations.length + (uploadQueueOrderByGroup[group.id] ?? 0);
    });
    return next;
  }, [uploadGroups, operationSortIndexById, operations.length, uploadQueueOrderByGroup]);
  const operationSortFallback = operations.length + uploadQueue.length + 1000;
  const isGroupExpanded = (groupId: string) => Boolean(expandedOperationGroups[groupId]);
  const toggleGroupExpanded = (groupId: string) => {
    setExpandedOperationGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };
  const toggleOperationFilter = (filter: "active" | "queued" | "completed" | "failed") => {
    setShowActiveOperations((prev) => (filter === "active" ? !prev : false));
    setShowQueuedOperations((prev) => (filter === "queued" ? !prev : false));
    setShowCompletedOperations((prev) => (filter === "completed" ? !prev : false));
    setShowFailedOperations((prev) => (filter === "failed" ? !prev : false));
  };
  const getSectionVisibleCount = (groupId: string, section: "queued" | "completed" | "failed") =>
    queuedVisibleCountByGroup[`${groupId}:${section}`] ?? DEFAULT_QUEUED_VISIBLE_COUNT;
  const showMoreSection = (groupId: string, section: "queued" | "completed" | "failed") => {
    setQueuedVisibleCountByGroup((prev) => ({
      ...prev,
      [`${groupId}:${section}`]: getSectionVisibleCount(groupId, section) + DEFAULT_QUEUED_VISIBLE_COUNT,
    }));
  };
  const sanitizeFilename = (value: string) => {
    const cleaned = value.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "");
    return cleaned || "operation";
  };
  const downloadOperationDetails = (kind: OperationDetailsKind, operationId: string) => {
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
            const key = item.state as "queued" | "uploading" | "done" | "failed" | "cancelled";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          },
          { total: 0, queued: 0, uploading: 0, done: 0, failed: 0, cancelled: 0 }
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

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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
            (!op.completionStatus || op.completionStatus === "done" || op.completionStatus === "failed")
        )
        .map((op) => op.id)
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
  const operationsCountBadgeClasses = `${countBadgeClasses} ui-caption ${
    hasFailedOperations ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-100" : ""
  }`;
  const showFolderToggle = showPanelToggles && allowFoldersPanel;
  const showInspectorToggle = showPanelToggles && allowInspectorPanel;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {showFolderToggle && (
        <button
          type="button"
          onClick={toggleFoldersPanel}
          aria-label={showFolders ? "Hide folders panel" : "Show folders panel"}
          aria-pressed={showFolders}
          title={showFolders ? "Hide folders" : "Show folders"}
          className={`fixed left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-xl border px-2 py-3 shadow-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            showFolders
              ? "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/40 dark:text-amber-100"
              : "border-slate-200 bg-white/90 text-slate-600 hover:text-primary dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200"
          }`}
        >
          <FolderIcon className="h-4 w-4" />
        </button>
      )}
      {showInspectorToggle && (
        <button
          type="button"
          onClick={toggleInspectorPanel}
          aria-label={showInspector ? "Hide inspector panel" : "Show inspector panel"}
          aria-pressed={showInspector}
          title={showInspector ? "Hide inspector" : "Show inspector"}
          className={`fixed right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-xl border px-2 py-3 shadow-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            showInspector
              ? "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/40 dark:text-sky-100"
              : "border-slate-200 bg-white/90 text-slate-600 hover:text-primary dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200"
          }`}
        >
          <MoreIcon className="h-4 w-4" />
        </button>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
          <div className="flex items-center gap-1.5">
            <span className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Browser</span>
            {accessBadge && (
              <span
                className={`inline-flex h-3 w-3 rounded-full border shadow-sm ${accessBadge.className}`}
                title={`${accessBadge.label} — ${accessBadge.title}`}
                aria-label={`${accessBadge.label} — ${accessBadge.title}`}
              />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <div ref={bucketMenuRef} className="relative">
              <button
                type="button"
                className={bucketButtonClasses}
                onClick={() => setShowBucketMenu((prev) => !prev)}
                disabled={loadingBuckets || bucketOptions.length === 0}
                aria-haspopup="listbox"
                aria-expanded={showBucketMenu}
                aria-label="Select bucket"
              >
                <BucketIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />
                <span className="max-w-[160px] truncate">{bucketButtonLabel}</span>
                <ChevronDownIcon className="h-3.5 w-3.5 text-slate-400" />
              </button>
              {showBucketMenu && (
                <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-1 ui-caption shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                    <SearchIcon className="h-3.5 w-3.5 text-slate-400" />
                    <input
                      ref={bucketFilterRef}
                      type="text"
                      value={bucketFilter}
                      onChange={(event) => setBucketFilter(event.target.value)}
                      placeholder="Filter buckets"
                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 ui-caption font-semibold text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      spellCheck={false}
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto px-1 pb-1">
                    {loadingBuckets ? (
                      <div className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">
                        Loading buckets...
                      </div>
                    ) : bucketOptions.length === 0 ? (
                      <div className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">No buckets</div>
                    ) : filteredBucketOptions.length === 0 ? (
                      <div className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">
                        No buckets match this filter.
                      </div>
                    ) : (
                      visibleBucketOptions.map((bucket) => {
                        const isActive = bucket === bucketName;
                        return (
                          <button
                            key={bucket}
                            type="button"
                            onClick={() => handleBucketChange(bucket)}
                            className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left font-semibold transition ${
                              isActive
                                ? "bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                            }`}
                          >
                            <span className="truncate">{bucket}</span>
                            {isActive && (
                              <span className="ui-caption font-semibold uppercase text-primary-600 dark:text-primary-200">
                                Active
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                  {!loadingBuckets && filteredBucketOptions.length > 0 && (
                    <div className="border-t border-slate-200 px-2 py-1 ui-caption text-slate-400 dark:border-slate-700 dark:text-slate-500">
                      {bucketOverflowCount > 0
                        ? `Showing ${visibleBucketOptions.length} of ${filteredBucketOptions.length} buckets. Use filter to narrow.`
                        : `${filteredBucketOptions.length} bucket${filteredBucketOptions.length === 1 ? "" : "s"}`}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div
              className="flex min-w-[240px] flex-1 flex-wrap items-center gap-1 ui-caption font-semibold text-slate-500 dark:text-slate-400 sm:min-w-[460px]"
              onClick={isEditingPath ? undefined : startEditingPath}
              onDoubleClick={isEditingPath ? undefined : startEditingPath}
            >
              {isEditingPath ? (
                <div className="relative min-w-[240px] flex-1 sm:min-w-[460px] md:min-w-[640px] lg:min-w-[760px]">
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
                    aria-expanded={pathSuggestions.length > 0 || pathSuggestionsLoading}
                    aria-activedescendant={
                      activePathSuggestion ? `browser-path-suggestion-${pathSuggestionIndex}` : undefined
                    }
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-0.5 ui-caption font-semibold text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={!bucketName}
                    spellCheck={false}
                  />
                  {(pathSuggestions.length > 0 || pathSuggestionsLoading) && (
                    <div
                      id="browser-path-suggestion-list"
                      role="listbox"
                      className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 overflow-hidden rounded-md border border-slate-200 bg-white py-1 ui-caption shadow-lg dark:border-slate-700 dark:bg-slate-900"
                    >
                      {pathSuggestions.length === 0 ? (
                        <div className="px-2 py-1.5 text-slate-500 dark:text-slate-300">Searching folders...</div>
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
                                onMouseEnter={() => setPathSuggestionIndex(idx)}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  applyPathSuggestion(suggestion, { commit: true });
                                }}
                                className={`flex w-full items-start gap-2 px-2 py-1.5 text-left transition ${
                                  isActive
                                    ? "bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                                }`}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-semibold" title={suggestion.label}>
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
                      {pathSuggestionsLoading && pathSuggestions.length > 0 && (
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
                      <span className="shrink-0 text-slate-400">(root)</span>
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
                      <span key={crumb.prefix} className="flex shrink-0 items-center gap-1">
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
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setViewMode("list");
                  setCompactMode(true);
                }}
                className={`${viewToggleBaseClasses} ${viewMode === "list" && compactMode ? viewToggleActiveClasses : ""}`}
                aria-label="Compact list view"
                aria-pressed={viewMode === "list" && compactMode}
              >
                <CompactIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("list");
                  setCompactMode(false);
                }}
                className={`${viewToggleBaseClasses} ${viewMode === "list" && !compactMode ? viewToggleActiveClasses : ""}`}
                aria-label="List view"
                aria-pressed={viewMode === "list" && !compactMode}
              >
                <ListIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`${viewToggleBaseClasses} ${viewMode === "grid" ? viewToggleActiveClasses : ""}`}
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
              >
                <GridIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              className={iconButtonClasses}
              onClick={() => fileInputRef.current?.click()}
              disabled={!bucketName}
              aria-label="Upload files"
              title="Upload files"
            >
              <UploadIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={iconButtonClasses}
              onClick={handleNewFolder}
              disabled={!bucketName || !hasS3AccountContext}
              aria-label="New folder"
              title="New folder"
            >
              <FolderPlusIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={iconButtonClasses}
              onClick={handleRefresh}
              disabled={!bucketName || objectsLoading}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={openOperationsModal}
              className={`${filterChipClasses} ${operationsButtonToneClasses}`}
            >
              Operations
              <span className={operationsCountBadgeClasses}>{formatBadgeCount(totalOperationsCount)}</span>
            </button>
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

        {(bucketError || objectsError || statusMessage || warnings.length > 0) && (
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
            {bucketError && <p className="font-semibold text-rose-600 dark:text-rose-200">{bucketError}</p>}
            {!bucketError && objectsError && <p className="font-semibold text-rose-600 dark:text-rose-200">{objectsError}</p>}
            {statusMessage && <p className="text-slate-500 dark:text-slate-400">{statusMessage}</p>}
            {warnings.map((warning, index) => (
              <p key={`${warning}-${index}`} className="font-semibold text-amber-600 dark:text-amber-200">
                {warning}
              </p>
            ))}
            {corsStatus && !corsStatus.enabled && uiOrigin && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`${filterChipClasses} border-emerald-200 bg-emerald-100 text-emerald-800 hover:border-emerald-300 hover:text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-100 dark:hover:border-emerald-400`}
                  onClick={handleEnsureCors}
                  disabled={corsFixing}
                  title={`Allow direct access from ${uiOrigin} by adding CORS rules to this bucket.`}
                  aria-label={`Allow direct access from ${uiOrigin} by adding CORS rules to this bucket.`}
                >
                  {corsFixing ? "Enabling..." : "Allow"}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
          <div className={`grid min-h-0 flex-1 grid-rows-1 gap-3 ${layoutClass}`}>
            {showFolders && (
              <div className="flex min-h-0 h-full flex-col rounded-xl border border-slate-200 bg-white/80 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Folders</p>
                <div className="mt-3 min-h-0 flex-1 overflow-x-auto overflow-y-auto pr-1">
                  {!bucketName ? (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">Select a bucket to view folders.</p>
                  ) : (
                    renderTreeNodes(treeNodes)
                  )}
                </div>
              </div>
            )}
            <div className="flex min-h-0 h-full flex-1 flex-col gap-3">
                  <div
                    className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border transition ${
                      dragging
                        ? "border-primary/60 bg-primary/5 dark:border-primary-500/60 dark:bg-primary-500/10"
                        : "border-slate-200 dark:border-slate-800"
                    }`}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onContextMenu={handlePathContextMenu}
                  >
                    {dragging && (
                      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-slate-50/80 text-center ui-body font-semibold text-slate-600 backdrop-blur-sm dark:bg-slate-900/70 dark:text-slate-200">
                        <div>
                          <div>Drop files or folders to upload</div>
                          <div className="mt-1 ui-caption font-normal text-slate-500 dark:text-slate-400">
                            {bucketName ? `${bucketName}/${normalizedPrefix}` : "Select a bucket first"}
                          </div>
                        </div>
                      </div>
                    )}
                    {viewMode === "list" ? (
                      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto" onClick={handleListBackgroundClick}>
                        <table className="manager-table min-w-[720px] w-full divide-y divide-slate-200 dark:divide-slate-800">
                          <thead className="bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                              <th className={`w-9 px-2 ${headerPadding} !align-middle text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>
                                <input
                                  type="checkbox"
                                  checked={allSelected}
                                  onChange={toggleAllSelection}
                                  aria-label="Select all"
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                />
                              </th>
                              <th
                                ref={nameHeaderRef}
                                className={`px-4 ${headerPadding} !align-middle text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSortToggle("name")}
                                    className="group inline-flex h-6 items-center gap-1 text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100"
                                  >
                                    <span>Name</span>
                                    <ChevronDownIcon
                                      className={`h-3 w-3 transition ${
                                        sortKey === "name" ? "opacity-100" : "opacity-30"
                                      } ${sortKey === "name" && sortDirection === "asc" ? "-rotate-180" : ""}`}
                                    />
                                  </button>
                                  {showNameColumnControls && (
                                    <div className="flex min-w-0 flex-1 items-center gap-2 normal-case">
                                      <div className="relative w-full max-w-[180px] flex-1">
                                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">
                                          <SearchIcon className="h-3 w-3" />
                                        </span>
                                        <input
                                          type="text"
                                          value={filter}
                                          onChange={(event) => setFilter(event.target.value)}
                                          placeholder="Filter"
                                          aria-label="Filter by name"
                                          className="h-6 w-full rounded-md border border-slate-200 bg-white pl-6 pr-2 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 normal-case"
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </th>
                              <th className={`w-20 px-2 ${headerPadding} !align-middle text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>
                                <button
                                  type="button"
                                  onClick={() => handleSortToggle("size")}
                                  className="group inline-flex h-6 items-center gap-1 text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100"
                                >
                                  <span>Size</span>
                                  <ChevronDownIcon
                                    className={`h-3 w-3 transition ${
                                      sortKey === "size" ? "opacity-100" : "opacity-30"
                                    } ${sortKey === "size" && sortDirection === "asc" ? "-rotate-180" : ""}`}
                                  />
                                </button>
                              </th>
                              <th className={`w-32 px-2 ${headerPadding} !align-middle text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>
                                <button
                                  type="button"
                                  onClick={() => handleSortToggle("modified")}
                                  className="group inline-flex h-6 items-center gap-1 text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100"
                                >
                                  <span>Modified</span>
                                  <ChevronDownIcon
                                    className={`h-3 w-3 transition ${
                                      sortKey === "modified" ? "opacity-100" : "opacity-30"
                                    } ${sortKey === "modified" && sortDirection === "asc" ? "-rotate-180" : ""}`}
                                  />
                                </button>
                              </th>
                              <th className={`w-44 px-2 ${headerPadding} !align-middle text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400`}>
                                <span className="inline-flex h-6 items-center">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {canGoUp && bucketName && showFolderItems && (
                              <tr className={`${rowHeightClasses} text-slate-600 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/40`}>
                                <td className={`w-9 px-2 ${rowCellClasses} !align-middle`} />
                                <td
                                  className={`manager-table-cell min-w-0 px-4 ${rowCellClasses} !align-middle ui-body`}
                                >
                                  <button
                                    type="button"
                                    onClick={handleGoUp}
                                    className="flex min-w-0 items-center gap-3 text-left font-semibold text-slate-700 hover:text-primary-700 dark:text-slate-200 dark:hover:text-primary-200"
                                  >
                                    <span className={`inline-flex ${iconBoxClasses} items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`}>
                                      <UpIcon className="h-3.5 w-3.5" />
                                    </span>
                                    <span className="truncate">Parent folder</span>
                                  </button>
                                </td>
                                <td className={`px-2 ${rowCellClasses} !align-middle ui-body text-slate-400 whitespace-nowrap`}>-</td>
                                <td className={`px-2 ${rowCellClasses} !align-middle ui-body text-slate-400 whitespace-nowrap`}>-</td>
                                <td className={`w-44 px-2 ${rowCellClasses} !align-middle text-right ui-caption text-slate-400`} />
                              </tr>
                            )}
                            {objectsLoading && <TableEmptyState colSpan={5} message="Loading objects..." />}
                            {!objectsLoading && !bucketName && (
                              <TableEmptyState colSpan={5} message="Select a bucket to browse objects." />
                            )}
                            {!objectsLoading && bucketName && objectsError && (
                              <TableEmptyState colSpan={5} message={objectsError} />
                            )}
                            {!objectsLoading && bucketName && !objectsError && listItems.length === 0 && (
                              <TableEmptyState colSpan={5} message="No objects found for this path." />
                            )}
                            {listItems.map((item) => {
                              const isFocused = inspectedItem?.id === item.id;
                              const isSelected = selectedSet.has(item.id);
                              const isDeleted = Boolean(item.isDeleted);
                              return (
                              <tr
                                key={item.id}
                                data-browser-item
                                onClick={(event) => {
                                  if (isInteractiveTarget(event.target)) {
                                    return;
                                  }
                                  handleItemSelectionClick(event, item.id);
                                }}
                                onDoubleClick={(event) => handleItemDoubleClick(event, item)}
                                onContextMenu={(event) => handleItemContextMenu(event, item)}
                                className={`${rowHeightClasses} transition-colors ${
                                  isSelected
                                    ? "bg-primary-100/80 hover:bg-primary-100 dark:bg-primary-500/30 dark:hover:bg-primary-500/40"
                                    : isDeleted
                                      ? "bg-rose-50/60 hover:bg-rose-100/70 dark:bg-rose-900/10 dark:hover:bg-rose-900/20"
                                    : isFocused
                                      ? "bg-primary-50/70 hover:bg-primary-50 dark:bg-primary-500/15 dark:hover:bg-primary-500/20"
                                      : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                }`}
                              >
                                <td className={`w-9 px-2 ${rowCellClasses} !align-middle`}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleSelection(item.id)}
                                    aria-label={`Select ${item.name}`}
                                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                  />
                                </td>
                                <td
                                  className={`manager-table-cell min-w-0 px-4 ${rowCellClasses} align-middle ui-body ${
                                    isDeleted ? "text-rose-700 dark:text-rose-200" : "text-slate-700 dark:text-slate-200"
                                  }`}
                                >
                                  <div className={`flex min-w-0 items-center ${nameGapClasses}`}>
                                    <span
                                      className={`inline-flex ${iconBoxClasses} items-center justify-center rounded-lg border ${
                                        isDeleted
                                          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/20 dark:text-rose-200"
                                          : item.type === "folder"
                                            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
                                          : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200"
                                      }`}
                                    >
                                      {item.type === "folder" ? <FolderIcon /> : isDeleted ? <TrashIcon /> : <FileIcon />}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <button
                                        type="button"
                                        onClick={(event) => handleItemNameClick(event, item)}
                                        onDoubleClick={() => {
                                          if (item.type === "folder") {
                                            handleOpenItem(item);
                                            return;
                                          }
                                          if (item.isDeleted) {
                                            if (isVersioningEnabled) {
                                              openObjectVersionsModal(item);
                                            }
                                            return;
                                          }
                                          handlePreviewItem(item);
                                        }}
                                        className={`flex w-full min-w-0 items-baseline gap-1 text-left font-semibold ${
                                          isDeleted
                                            ? "text-rose-700 hover:text-rose-800 dark:text-rose-200 dark:hover:text-rose-100"
                                            : "text-slate-900 hover:text-primary-700 dark:text-slate-100 dark:hover:text-primary-200"
                                        }`}
                                        title={item.name}
                                      >
                                        <span className="truncate">{item.name}</span>
                                        {isDeleted && (
                                          <span className="shrink-0 ui-caption font-semibold text-rose-500 dark:text-rose-300">
                                            (deleted)
                                          </span>
                                        )}
                                      </button>
                                      {!compactMode && (
                                        <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden ui-caption text-slate-500 dark:text-slate-400">
                                          <span className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold dark:border-slate-700">
                                            {item.type === "folder"
                                              ? isDeleted
                                                ? "Deleted folder"
                                                : "Prefix"
                                              : isDeleted
                                                ? "Deleted object"
                                                : "Object"}
                                          </span>
                                          {isDeleted && (
                                            <span className="rounded-full border border-rose-200 px-2 py-0.5 font-semibold text-rose-700 dark:border-rose-500/40 dark:text-rose-200">
                                              {item.type === "folder" ? "Delete markers" : "Delete marker"}
                                            </span>
                                          )}
                                          {item.storageClass && (
                                            <span
                                              className={`rounded-full border px-2 py-0.5 font-semibold ${
                                                storageClassChipClasses[item.storageClass] ??
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
                                <td className={`px-2 ${rowCellClasses} !align-middle ui-body text-slate-600 dark:text-slate-300 whitespace-nowrap`}>
                                  {item.size}
                                </td>
                                <td className={`px-2 ${rowCellClasses} !align-middle ui-body text-slate-600 dark:text-slate-300 whitespace-nowrap`}>
                                  {item.modified}
                                </td>
                                <td className={`w-44 px-2 ${rowCellClasses} !align-middle text-right`}>
                                  <div className="flex flex-nowrap justify-end gap-1.5">
                                    {item.type === "folder" && (
                                      <button
                                        type="button"
                                        className={iconButtonClasses}
                                        aria-label="Open"
                                        title="Open"
                                        onClick={() => handleOpenItem(item)}
                                      >
                                        <OpenIcon />
                                      </button>
                                    )}
                                    {item.type === "file" && !isDeleted && (
                                      <button
                                        type="button"
                                        className={iconButtonClasses}
                                        aria-label="Preview"
                                        title="Preview"
                                        onClick={() => handlePreviewItem(item)}
                                      >
                                        <EyeIcon />
                                      </button>
                                    )}
                                    {item.type === "file" && isDeleted && isVersioningEnabled && (
                                      <button
                                        type="button"
                                        className={iconButtonClasses}
                                        aria-label="Versions"
                                        title="Versions"
                                        onClick={() => openObjectVersionsModal(item)}
                                      >
                                        <HistoryIcon />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className={`${iconButtonClasses} ${isDeleted ? "opacity-50" : ""}`}
                                      aria-label="Download"
                                      title={isDeleted ? "Restore from versions before download" : "Download"}
                                      onClick={() => handleDownloadTarget(item)}
                                      disabled={isDeleted}
                                    >
                                      <DownloadIcon />
                                    </button>
                                    <button
                                      type="button"
                                      className={`${iconButtonDangerClasses} ${isDeleted ? "opacity-50" : ""}`}
                                      aria-label="Delete"
                                      title={isDeleted ? "Delete marker entries are managed in versions." : "Delete"}
                                      onClick={() => handleDeleteItems([item])}
                                      disabled={isDeleted}
                                    >
                                      <TrashIcon />
                                    </button>
                                    {allowInspectorPanel && (
                                      <button
                                        type="button"
                                        className={iconButtonClasses}
                                        aria-label="More actions"
                                        title="More"
                                        onClick={() => toggleInspectorForItem(item)}
                                      >
                                        <MoreIcon />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div
                        className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                        onClick={handleListBackgroundClick}
                      >
                        {objectsLoading && (
                          <div className="col-span-full rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center ui-body text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            Loading objects...
                          </div>
                        )}
                        {!objectsLoading && !bucketName && (
                          <div className="col-span-full rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center ui-body text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            Select a bucket to browse objects.
                          </div>
                        )}
                        {!objectsLoading && bucketName && objectsError && (
                          <div className="col-span-full rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center ui-body text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {objectsError}
                          </div>
                        )}
                        {!objectsLoading && bucketName && !objectsError && listItems.length === 0 && (
                          <div className="col-span-full rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center ui-body text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            No objects found for this path.
                          </div>
                        )}
                        {listItems.map((item) => {
                          const selected = selectedSet.has(item.id);
                          const isDeleted = Boolean(item.isDeleted);
                          return (
                            <div
                              key={item.id}
                              data-browser-item
                              className={`group relative flex ${gridCardGapClasses} ${gridCardHeightClasses} flex-col overflow-hidden rounded-2xl border p-4 shadow-sm transition ${
                                selected
                                  ? "border-primary-200 bg-primary-50/60 shadow-[0_12px_24px_-16px_rgba(79,70,229,0.45)] dark:border-primary-700/60 dark:bg-primary-500/20"
                                  : isDeleted
                                    ? "border-rose-200 bg-rose-50/70 dark:border-rose-500/40 dark:bg-rose-900/20"
                                  : "border-slate-200 bg-white/90 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-primary-700/60"
                              }`}
                              onDoubleClick={(event) => handleItemDoubleClick(event, item)}
                              onContextMenu={(event) => handleItemContextMenu(event, item)}
                            >
                              <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-slate-50/90 to-transparent dark:from-slate-900/60" />
                              <div className="relative flex items-center justify-between">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleSelection(item.id)}
                                  aria-label={`Select ${item.name}`}
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                />
                                {allowInspectorPanel && (
                                  <button
                                    type="button"
                                    className={iconButtonClasses}
                                    aria-label="Focus"
                                    onClick={() => toggleInspectorForItem(item)}
                                  >
                                    <MoreIcon />
                                  </button>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={(event) => handleItemNameClick(event, item)}
                                onDoubleClick={() => {
                                  if (item.type === "folder") {
                                    handleOpenItem(item);
                                    return;
                                  }
                                  if (item.isDeleted) {
                                    if (isVersioningEnabled) {
                                      openObjectVersionsModal(item);
                                    }
                                    return;
                                  }
                                  handlePreviewItem(item);
                                }}
                                className="relative flex min-w-0 flex-1 items-start gap-3 text-left"
                              >
                                <span
                                  className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border shadow-sm ${
                                    isDeleted
                                      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/20 dark:text-rose-200"
                                      : item.type === "folder"
                                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200"
                                      : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200"
                                  }`}
                                >
                                  {item.type === "folder" ? <FolderIcon /> : isDeleted ? <TrashIcon /> : <FileIcon />}
                                </span>
                                <span className="min-w-0">
                                  <span
                                    className={`flex min-w-0 items-baseline gap-1 break-words ui-body font-semibold leading-snug ${
                                      isDeleted ? "text-rose-700 dark:text-rose-200" : "text-slate-900 dark:text-slate-100"
                                    }`}
                                    style={gridTitleClampStyle}
                                    title={item.name}
                                  >
                                    <span className="min-w-0">{item.name}</span>
                                    {isDeleted && (
                                      <span className="shrink-0 ui-caption font-semibold text-rose-500 dark:text-rose-300">
                                        (deleted)
                                      </span>
                                    )}
                                  </span>
                                  {!isDeleted && (
                                    <span className="mt-1 block ui-caption font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                      {item.type === "folder" ? "Folder" : "File"}
                                    </span>
                                  )}
                                </span>
                              </button>
                              <div className="flex flex-wrap items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
                                <span className="rounded-full border border-slate-200 px-2 py-0.5 font-semibold dark:border-slate-700">
                                  {item.type === "folder"
                                    ? (isDeleted ? "Deleted folder" : "Prefix")
                                    : isDeleted
                                      ? "Deleted object"
                                      : "Object"}
                                </span>
                                {isDeleted && (
                                  <span className="rounded-full border border-rose-200 px-2 py-0.5 font-semibold text-rose-700 dark:border-rose-500/40 dark:text-rose-200">
                                    {item.type === "folder" ? "Delete markers" : "Delete marker"}
                                  </span>
                                )}
                                {item.storageClass && (
                                  <span
                                    className={`rounded-full border px-2 py-0.5 font-semibold ${
                                      storageClassChipClasses[item.storageClass] ??
                                      "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                    }`}
                                  >
                                    {item.storageClass}
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2 ui-caption text-slate-500 dark:text-slate-400">
                                <div className="min-w-0 rounded-lg border border-slate-200/70 bg-slate-50/80 px-2 py-1 dark:border-slate-700/60 dark:bg-slate-900/50">
                                  <div className="ui-caption font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                    Size
                                  </div>
                                  <div className="font-semibold text-slate-700 dark:text-slate-200">{item.size}</div>
                                </div>
                                <div className="min-w-0 rounded-lg border border-slate-200/70 bg-slate-50/80 px-2 py-1 dark:border-slate-700/60 dark:bg-slate-900/50">
                                  <div className="ui-caption font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                    Modified
                                  </div>
                                  <div
                                    className="truncate font-semibold text-slate-700 dark:text-slate-200"
                                    title={item.modified}
                                  >
                                    {item.modified}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-auto flex flex-nowrap gap-1.5">
                                {item.type === "folder" && (
                                  <button
                                    type="button"
                                    className={gridQuickActionClasses}
                                    aria-label="Open"
                                    title="Open"
                                    onClick={() => handleOpenItem(item)}
                                  >
                                    <OpenIcon className="h-3.5 w-3.5" />
                                    <span className="min-w-0 truncate">Open</span>
                                  </button>
                                )}
                                {item.type === "file" && !isDeleted && (
                                  <button
                                    type="button"
                                    className={gridQuickActionClasses}
                                    aria-label="Preview"
                                    title="Preview"
                                    onClick={() => handlePreviewItem(item)}
                                  >
                                    <EyeIcon className="h-3.5 w-3.5" />
                                    <span className="min-w-0 truncate">Preview</span>
                                  </button>
                                )}
                                {item.type === "file" && isDeleted && isVersioningEnabled && (
                                  <button
                                    type="button"
                                    className={gridQuickActionClasses}
                                    aria-label="Versions"
                                    title="Versions"
                                    onClick={() => openObjectVersionsModal(item)}
                                  >
                                    <HistoryIcon className="h-3.5 w-3.5" />
                                    <span className="min-w-0 truncate">Versions</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className={gridQuickActionClasses}
                                  aria-label="Download"
                                  title={isDeleted ? "Restore from versions before download" : "Download"}
                                  onClick={() => handleDownloadTarget(item)}
                                  disabled={isDeleted}
                                >
                                  <DownloadIcon className="h-3.5 w-3.5" />
                                  <span className="min-w-0 truncate">Download</span>
                                </button>
                                <button
                                  type="button"
                                  className={gridQuickActionDangerClasses}
                                  aria-label="Delete"
                                  title={isDeleted ? "Delete marker entries are managed in versions." : "Delete"}
                                  onClick={() => handleDeleteItems([item])}
                                  disabled={isDeleted}
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                  <span className="min-w-0 truncate">Delete</span>
                                </button>
                                {allowInspectorPanel && (
                                  <button
                                    type="button"
                                    className={gridQuickActionClasses}
                                    aria-label="More actions"
                                    title="More"
                                    onClick={() => toggleInspectorForItem(item)}
                                  >
                                    <MoreIcon className="h-3.5 w-3.5" />
                                    <span className="min-w-0 truncate">More</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {objectsIsTruncated && objectsNextToken && (
                      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-900/60">
                        <button
                          type="button"
                          className={toolbarButtonClasses}
                          onClick={() => loadObjects({ append: true, continuationToken: objectsNextToken })}
                          disabled={objectsLoadingMore}
                        >
                          {objectsLoadingMore ? "Loading..." : "Load more"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {showInspector && (
                  <div className="flex min-h-0 h-full flex-col gap-3">
                    <div className="flex min-h-0 h-full flex-1 flex-col rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Inspector tabs">
                        <button
                          type="button"
                          role="tab"
                          id="inspector-tab-details"
                          aria-selected={inspectorTab === "details"}
                          aria-controls="inspector-panel-details"
                          onClick={() => setInspectorTab("details")}
                          className={`${filterChipClasses} ${inspectorTab === "details" ? filterChipActiveClasses : ""}`}
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
                          className={`${filterChipClasses} ${inspectorTab === "context" ? filterChipActiveClasses : ""}`}
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
                          className={`${filterChipClasses} ${inspectorTab === "bucket" ? filterChipActiveClasses : ""}`}
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
                          className={`${filterChipClasses} ${inspectorTab === "selection" ? filterChipActiveClasses : ""}`}
                        >
                          Selection
                          {selectedCount > 0 && <span className={countBadgeClasses}>{selectedCount}</span>}
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
                              <p className={inspectorSectionTitleClasses}>Current location</p>
                              <p className="break-all ui-caption text-slate-500 dark:text-slate-400">
                                {currentPath || "Select a bucket to get started."}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <div className={inspectorSectionCardClasses}>
                                <p className={inspectorSectionTitleClasses}>Actions</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className={bulkActionClasses}
                                    onClick={() => {
                                      fileInputRef.current?.click();
                                    }}
                                    disabled={!bucketName || !hasS3AccountContext}
                                  >
                                    <UploadIcon className="h-3.5 w-3.5" />
                                    Upload files
                                  </button>
                                  <button
                                    type="button"
                                    className={bulkActionClasses}
                                    onClick={() => {
                                      folderInputRef.current?.click();
                                    }}
                                    disabled={!bucketName || !hasS3AccountContext}
                                  >
                                    <FolderIcon className="h-3.5 w-3.5" />
                                    Upload folder
                                  </button>
                                  <button
                                    type="button"
                                    className={bulkActionClasses}
                                    onClick={handleNewFolder}
                                    disabled={!bucketName || !hasS3AccountContext}
                                  >
                                    <FolderPlusIcon className="h-3.5 w-3.5" />
                                    New folder
                                  </button>
                                  <button
                                    type="button"
                                    className={bulkActionClasses}
                                    onClick={handlePasteItems}
                                    disabled={!canPaste}
                                  >
                                    <PasteIcon className="h-3.5 w-3.5" />
                                    {pasteLabel}
                                  </button>
                                  {isVersioningEnabled && (
                                    <>
                                      <button
                                        type="button"
                                        className={bulkActionClasses}
                                        onClick={() => setShowPrefixVersions(true)}
                                        disabled={!bucketName || !hasS3AccountContext}
                                      >
                                        <ListIcon className="h-3.5 w-3.5" />
                                        Versions
                                      </button>
                                      <button
                                        type="button"
                                        className={bulkActionClasses}
                                        onClick={openCleanupModal}
                                        disabled={!bucketName || !hasS3AccountContext}
                                      >
                                        <TrashIcon className="h-3.5 w-3.5" />
                                        Clean versions
                                      </button>
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    className={bulkActionClasses}
                                    onClick={() => handleCopyPath(currentPath)}
                                    disabled={!currentPath}
                                  >
                                    <CopyIcon className="h-3.5 w-3.5" />
                                    Copy path
                                  </button>
                                </div>
                              </div>
                              <div className={inspectorSectionCardClasses}>
                                <p className={inspectorSectionTitleClasses}>Prefix summary</p>
                                <div className="mt-2 grid gap-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500">Files</span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">{pathStats.files}</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500">Folders</span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">{pathStats.folders}</span>
                                  </div>
                                  {isVersioningEnabled && showDeletedObjects && (
                                    <div className="flex items-center justify-between">
                                      <span className="text-slate-500">Deleted shown</span>
                                      <span className="font-semibold text-rose-700 dark:text-rose-200">
                                        {pathStats.deletedFiles + pathStats.deletedFolders}
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500">Total size</span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {formatBytes(pathStats.totalBytes)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className={inspectorSectionCardClasses}>
                                <div className="flex items-center justify-between gap-2">
                                  <p className={inspectorSectionTitleClasses}>Counts</p>
                                  <button
                                    type="button"
                                    className={bulkActionClasses}
                                    onClick={handleContextCount}
                                    disabled={
                                      !bucketName ||
                                      !hasS3AccountContext ||
                                      contextCountsLoading
                                    }
                                  >
                                    <RefreshIcon className="h-3.5 w-3.5" />
                                    {contextCountsLoading ? "Counting..." : contextCounts ? "Recount" : "Count"}
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
                                    <span className="text-slate-500">Current objects</span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {contextCountsLoading ? "..." : contextCounts ? contextCounts.objects : "-"}
                                    </span>
                                  </div>
                                  {isVersioningEnabled && (
                                    <>
                                      <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Versions</span>
                                        <span className="font-semibold text-slate-700 dark:text-slate-100">
                                          {contextCountsLoading ? "..." : contextCounts ? contextCounts.versions : "-"}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Delete markers</span>
                                        <span className="font-semibold text-slate-700 dark:text-slate-100">
                                          {contextCountsLoading ? "..." : contextCounts ? contextCounts.deleteMarkers : "-"}
                                        </span>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className={inspectorSectionCardClasses}>
                                <p className={inspectorSectionTitleClasses}>Storage classes</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {Object.keys(pathStats.storageCounts).length === 0 ? (
                                    <span className="ui-caption text-slate-500 dark:text-slate-400">No file data yet.</span>
                                  ) : (
                                    Object.entries(pathStats.storageCounts).map(([storage, count]) => (
                                      <span
                                        key={storage}
                                        className={`rounded-full border px-2 py-1 ui-caption font-semibold ${
                                          storageClassChipClasses[storage] ??
                                          "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                        }`}
                                      >
                                        {storage} ({count})
                                      </span>
                                    ))
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
                            <div className={`${inspectorSectionCardClasses} flex items-start justify-between gap-2`}>
                              <div className="space-y-1">
                                <p className={inspectorSectionTitleClasses}>Bucket overview</p>
                                <p className="ui-caption text-slate-500 dark:text-slate-400">
                                  {bucketName || "Select a bucket to inspect."}
                                </p>
                              </div>
                              <button
                                type="button"
                                className={inspectorInlineActionClasses}
                                onClick={() => void loadBucketInspectorData(true)}
                                disabled={!bucketName || !hasS3AccountContext || bucketInspectorLoading}
                              >
                                {bucketInspectorLoading ? "Loading..." : "Refresh"}
                              </button>
                            </div>

                            {!bucketName || !hasS3AccountContext ? (
                              <div className={inspectorEmptyStateClasses}>
                                Select a bucket to load bucket stats and features.
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {bucketInspectorLoading && !bucketInspectorData && (
                                  <p className="ui-caption text-slate-500 dark:text-slate-400">Loading bucket overview...</p>
                                )}
                                {bucketInspectorError && (
                                  <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                                    {bucketInspectorError}
                                  </p>
                                )}
                                <div className={inspectorSectionCardClasses}>
                                  <p className={inspectorSectionTitleClasses}>Stats</p>
                                  <div className="mt-2 grid gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">Created</span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                                        {bucketInspectorData?.creation_date
                                          ? formatDateTime(bucketInspectorData.creation_date)
                                          : "-"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">Used bytes</span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                                        {formatBytes(bucketInspectorData?.used_bytes ?? null)}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">Object count</span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                                        {bucketInspectorData?.object_count != null
                                          ? bucketInspectorData.object_count.toLocaleString()
                                          : "-"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">Quota size</span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                                        {(bucketInspectorData?.quota_max_size_bytes ?? 0) > 0
                                          ? formatBytes(bucketInspectorData?.quota_max_size_bytes ?? null)
                                          : "Not set"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">Quota objects</span>
                                      <span className="font-semibold text-slate-700 dark:text-slate-100">
                                        {(bucketInspectorData?.quota_max_objects ?? 0) > 0
                                          ? (bucketInspectorData?.quota_max_objects ?? 0).toLocaleString()
                                          : "Not set"}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className={inspectorSectionCardClasses}>
                                  <p className={inspectorSectionTitleClasses}>Features</p>
                                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                    States mirror the Manager bucket overview when available.
                                  </p>
                                  <div className="mt-2 space-y-2">
                                    {bucketInspectorFeatures.length === 0 ? (
                                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                                        No feature data available for this context.
                                      </p>
                                    ) : (
                                      bucketInspectorFeatures.map((feature) => (
                                        <div key={feature.key} className="flex items-center justify-between gap-2">
                                          <span className="text-slate-500">{feature.label}</span>
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
                            <div className={`${inspectorSectionCardClasses} flex items-start justify-between gap-2`}>
                              <div>
                                <p className={inspectorSectionTitleClasses}>Selection</p>
                                <p className="mt-1 ui-caption text-slate-400">
                                  {selectedCount > 0
                                    ? `${selectedCount} selected`
                                    : selectionPrimary
                                      ? `Focused: ${selectionPrimary.name}`
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
                                    Contains deleted items (derived from delete markers).
                                  </p>
                                )}
                                {selectedCount > 0 && (
                                  <p className="ui-caption text-slate-400">Total size: {formatBytes(selectedBytes)}</p>
                                )}
                              </div>
                              {selectedCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedIds([])}
                                  className={inspectorInlineActionClasses}
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                            <div className="space-y-3">
                              <div className={inspectorSectionCardClasses}>
                                <p className={inspectorSectionTitleClasses}>Actions</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {canSelectionDownloadFolder && selectionPrimary && (
                                    <button
                                      type="button"
                                      className={bulkActionClasses}
                                      onClick={() => handleDownloadFolder(selectionPrimary)}
                                      disabled={!bucketName || !hasS3AccountContext}
                                    >
                                      <DownloadIcon className="h-3.5 w-3.5" />
                                      Download folder
                                    </button>
                                  )}
                                  {!canSelectionDownloadFolder && canSelectionDownloadFiles && (
                                    <button
                                      type="button"
                                      className={bulkActionClasses}
                                      onClick={() => handleDownloadItems(selectionFiles)}
                                      disabled={!bucketName || !hasS3AccountContext}
                                    >
                                      <DownloadIcon className="h-3.5 w-3.5" />
                                      Download
                                    </button>
                                  )}
                                  {canSelectionOpen && selectionPrimary && (
                                    <button
                                      type="button"
                                      className={bulkActionClasses}
                                      onClick={() => handleOpenItem(selectionPrimary)}
                                    >
                                      <OpenIcon className="h-3.5 w-3.5" />
                                      Open
                                    </button>
                                  )}
                                  {canSelectionCopyUrl && selectionPrimary && (
                                    <button
                                      type="button"
                                      className={bulkActionClasses}
                                      onClick={() => handleCopyUrl(selectionPrimary)}
                                      disabled={!hasS3AccountContext}
                                    >
                                      <LinkIcon className="h-3.5 w-3.5" />
                                      Copy URL
                                    </button>
                                  )}
                                  {selectionIsSingle && selectionPrimary && (
                                    <button
                                      type="button"
                                      className={bulkActionClasses}
                                      onClick={() => handleCopyPath(`${bucketName}/${selectionPrimary.key}`)}
                                    >
                                      <CopyIcon className="h-3.5 w-3.5" />
                                      Copy path
                                    </button>
                                  )}
                                  {canSelectionAdvanced && (
                                    <button
                                      type="button"
                                      className={bulkActionClasses}
                                      onClick={() => setShowAdvancedModal(true)}
                                    >
                                      <SettingsIcon className="h-3.5 w-3.5" />
                                      Advanced
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className={inspectorSectionCardClasses}>
                                <p className={inspectorSectionTitleClasses}>Bulk actions</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className={bulkActionClasses}
                                    onClick={() => handleCopyItems(selectionItems)}
                                    disabled={!canSelectionCopyItems}
                                  >
                                    <CopyIcon className="h-3.5 w-3.5" />
                                    Copy
                                  </button>
                                  <button
                                    type="button"
                                    className={bulkActionClasses}
                                    onClick={() => handleCutItems(selectionItems)}
                                    disabled={!canSelectionCutItems}
                                  >
                                    <CutIcon className="h-3.5 w-3.5" />
                                    Cut
                                  </button>
                                  <button
                                    type="button"
                                    className={bulkActionClasses}
                                    onClick={() => openBulkAttributesModal(selectionItems)}
                                    disabled={!canSelectionBulkAttributes}
                                  >
                                    <SlidersIcon className="h-3.5 w-3.5" />
                                    Bulk attributes
                                  </button>
                                  {isVersioningEnabled && (
                                    <button
                                      type="button"
                                      className={bulkActionClasses}
                                      onClick={() => openBulkRestoreModal(selectionItems)}
                                    >
                                      <HistoryIcon className="h-3.5 w-3.5" />
                                      Restore to date
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={bulkDangerClasses}
                                    onClick={() => handleDeleteItems(selectionItems)}
                                    disabled={!hasS3AccountContext || !canSelectionDelete}
                                  >
                                    <TrashIcon className="h-3.5 w-3.5" />
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className={inspectorSectionCardClasses}>
                              <div className="flex items-center justify-between gap-2">
                                <p className={inspectorSectionTitleClasses}>Selection stats</p>
                                <button
                                  type="button"
                                  className={bulkActionClasses}
                                  onClick={calculateSelectionStats}
                                  disabled={!bucketName || !hasS3AccountContext || selectionStatsLoading}
                                >
                                  <RefreshIcon className="h-3.5 w-3.5" />
                                  {selectionStatsLoading ? "Calculating..." : selectionStats ? "Recalculate" : "Calculate"}
                                </button>
                              </div>
                              {selectionStatsError && (
                                <p className="mt-2 ui-caption font-semibold text-rose-600 dark:text-rose-200">
                                  {selectionStatsError}
                                </p>
                              )}
                              {!selectionStats && !selectionStatsLoading && !selectionStatsError && (
                                <p className="mt-2 ui-caption text-slate-400">
                                  Calculates object count and size, including folder contents.
                                </p>
                              )}
                              {selectionStats && (
                                <div className="mt-2 grid gap-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500">Objects</span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                                      {selectionStats.objectCount.toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500">Total size</span>
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
                            <div className={`${inspectorSectionCardClasses} flex items-center justify-between gap-2`}>
                              <p className={inspectorSectionTitleClasses}>Object details</p>
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
                              <p className={inspectorSectionTitleClasses}>Metadata</p>
                              {metadataLoading && (
                                <p className="ui-caption text-slate-500 dark:text-slate-400">Loading metadata...</p>
                              )}
                              {metadataError && (
                                <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{metadataError}</p>
                              )}
                              <div className="grid gap-2 ui-caption text-slate-600 dark:text-slate-300">
                                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                                  <span className="text-slate-500">Path</span>
                                  <span className="truncate font-semibold text-slate-700 dark:text-slate-100">
                                    {inspectedPath}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-500">Owner</span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-100">{inspectedItem.owner}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-500">Last modified</span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-100">{inspectedItem.modified}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-500">Content type</span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-100">
                                    {inspectedMetadata?.content_type ?? "unknown"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-500">ETag</span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-100">
                                    {inspectedMetadata?.etag ?? "-"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-500">Storage class</span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-100">
                                    {inspectedMetadata?.storage_class ?? inspectedItem.storageClass ?? "-"}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className={inspectorSectionCardClasses}>
                              <p className={inspectorSectionTitleClasses}>Tags</p>
                              <div className="flex flex-wrap gap-2">
                                {inspectedTags.length ? (
                                  inspectedTags.map((tag) => (
                                    <span
                                      key={`${tag.key}:${tag.value}`}
                                      className={`${filterChipClasses} border-slate-200 dark:border-slate-700`}
                                    >
                                      {tag.key}
                                      {tag.value ? `=${tag.value}` : ""}
                                    </span>
                                  ))
                                ) : (
                                  <span className="ui-caption text-slate-500 dark:text-slate-400">No tags defined.</span>
                                )}
                              </div>
                            </div>
                            {isVersioningEnabled && inspectedItem.type === "file" && (
                              <BrowserObjectVersionsList
                                versions={objectVersionRows}
                                loading={objectVersionsLoading}
                                error={objectVersionsError}
                                canLoadMore={Boolean(objectVersionKeyMarker || objectVersionIdMarker)}
                                onLoadMore={() =>
                                  loadObjectVersions({ append: true, targetKey: inspectedItem.key })
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
          </div>
        </div>
      </div>
        <BrowserContextMenu
          contextMenu={contextMenu}
          contextMenuRef={contextMenuRef}
          bucketName={bucketName}
          hasS3AccountContext={hasS3AccountContext}
          versioningEnabled={isVersioningEnabled}
          showFolderItems={showFolderItems}
          showDeletedObjects={showDeletedObjects}
          allowInspectorPanel={allowInspectorPanel}
          canPaste={canPaste}
          clipboard={clipboard}
          currentPath={currentPath}
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
        onCopyItems={handleCopyItems}
        onCutItems={handleCutItems}
        onOpenBulkAttributes={openBulkAttributesModal}
        onOpenBulkRestore={openBulkRestoreModal}
        onOpenObjectVersions={openObjectVersionsModal}
        onOpenAdvanced={openAdvancedForItem}
        onDeleteItems={handleDeleteItems}
        onDownloadFolder={handleDownloadFolder}
        onDownloadItems={handleDownloadItems}
        onOpenItem={handleOpenItem}
        onOpenDetails={openItemDetails}
        onToggleShowFolders={() => setShowFolderItems((prev) => !prev)}
        onToggleShowDeleted={() => setShowDeletedObjects((prev) => !prev)}
      />
      <BrowserPreviewModal
        previewItem={previewItem}
        previewUrl={previewUrl}
        previewContentType={previewContentType}
        previewKind={previewKind}
        previewLoading={previewLoading}
        previewError={previewError}
        onClose={closePreview}
        onDownload={handleDownloadItems}
      />
      {showAdvancedModal && inspectedItem && inspectedItem.type === "file" && (
        <ObjectAdvancedModal
          accountId={accountIdForApi}
          bucketName={bucketName}
          item={inspectedItem}
          metadata={inspectedMetadata}
          tags={inspectedTags}
          tagsVersionId={inspectedTagsVersionId}
          onClose={() => setShowAdvancedModal(false)}
          onRefresh={handleAdvancedRefresh}
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
          onRefresh={() => loadPrefixVersions({ append: false, keyMarker: null, versionIdMarker: null })}
          onLoadMore={() => loadPrefixVersions({ append: true })}
          onRestoreVersion={handleRestoreVersion}
          onDeleteVersion={handleDeleteVersion}
        />
      )}
      {showObjectVersionsModal && isVersioningEnabled && objectVersionsModalKey && objectVersionsModalPath && (
        <BrowserObjectVersionsModal
          bucketName={bucketName}
          objectKey={objectVersionsModalKey}
          objectPath={objectVersionsModalPath}
          objectVersionsLoading={objectVersionsModalLoading}
          objectVersionsError={objectVersionsModalError}
          objectVersionRows={objectVersionModalRows}
          objectVersionKeyMarker={objectVersionModalKeyMarker}
          objectVersionIdMarker={objectVersionModalIdMarker}
          onClose={closeObjectVersionsModal}
          onRefresh={() =>
            loadObjectVersionsModal({
              append: false,
              keyMarker: null,
              versionIdMarker: null,
              targetKey: objectVersionsModalKey,
            })
          }
          onLoadMore={() => loadObjectVersionsModal({ append: true, targetKey: objectVersionsModalKey })}
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
          setBulkRestoreRestoreDeleted={setBulkRestoreRestoreDeleted}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3">
              <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Create folder</h3>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Destination: <span className="font-semibold">{currentPath || `${bucketName}/`}</span>
              </p>
            </div>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateFolderFromModal();
              }}
            >
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
              {newFolderError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-300">{newFolderError}</p>}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-slate-100"
                  onClick={() => {
                    if (newFolderLoading) return;
                    setShowNewFolderModal(false);
                    setNewFolderError(null);
                  }}
                  disabled={newFolderLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!bucketName || !hasS3AccountContext || newFolderLoading}
                >
                  {newFolderLoading ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showOperationsModal && (
        <BrowserOperationsModal
          totalOperationsCount={totalOperationsCount}
          activeOperationsCount={activeOperations.length}
          queuedOperationsCount={uploadQueue.length + queuedDownloadCount + queuedDeleteCount + queuedCopyCount}
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

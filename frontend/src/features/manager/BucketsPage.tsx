/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListToolbar from "../../components/ListToolbar";
import PageEmptyState from "../../components/PageEmptyState";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { cx, uiButtonBaseClass, uiButtonVariants, uiCheckboxClass } from "../../components/ui/styles";
import {
  Bucket,
  BucketFeatureStatus,
  BucketTag,
  createBucket,
  deleteBucket,
  getBucketCors,
  getBucketLogging,
  getBucketNotifications,
  getBucketPolicy,
  getBucketProperties,
  getBucketWebsite,
  listBuckets,
} from "../../api/buckets";
import type { BucketProperties } from "../../api/buckets";
import { S3AccountSelector } from "../../api/accountParams";
import { useS3AccountContext } from "./S3AccountContext";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import Modal from "../../components/Modal";
import SortableHeader from "../../components/SortableHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactButtonClasses, toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import PropertySummaryChip from "../../components/PropertySummaryChip";
import {
  S3_BUCKET_NAME_MAX_LENGTH,
  isValidS3BucketName,
  normalizeS3BucketName,
  normalizeS3BucketNameInput,
} from "../../utils/s3BucketName";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { compareByNullableField, type SortableField } from "../../utils/sortValues";
import { getManagerToolAccess, readStoredUser } from "../../utils/workspaces";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";
import BucketPurgeRunModal from "../shared/BucketPurgeRunModal";
import { BucketFeatureSummaryChip, BucketSummaryTooltip } from "../shared/BucketFeatureSummaryTooltip";
import type { BucketFeatureTooltipState } from "../shared/BucketFeatureSummaryTooltip";
import {
  buildBucketPolicySummaryLines,
  buildBucketTagSummaryLines,
  buildCorsRuleSummaryLines,
  buildLifecycleRuleSummaryLines,
  buildLoggingSummaryLines,
  buildNotificationSummaryLines,
  buildObjectLockSummaryLines,
  buildPublicAccessBlockSummaryLines,
  buildVersioningSummaryLines,
  buildWebsiteSummaryLines,
} from "../shared/bucketFeatureSummaries";

type BucketForm = {
  name: string;
  locationConstraint: string;
  versioning: boolean;
};

const defaultForm: BucketForm = {
  name: "",
  locationConstraint: "",
  versioning: false,
};

const buildDefaultForm = (): BucketForm => ({
  ...defaultForm,
});
const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

function QuotaBar({ usedBytes, quotaBytes }: { usedBytes?: number | null; quotaBytes?: number | null }) {
  if (!quotaBytes || quotaBytes <= 0) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }
  const used = usedBytes ?? 0;
  const ratio = Math.min(100, Math.round((used / quotaBytes) * 100));
  const usedDisplay = formatBytes(used);
  const quotaDisplay = formatBytes(quotaBytes);
  return (
    <div className="flex items-center gap-2" title={`${usedDisplay} / ${quotaDisplay}`}>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full bg-primary-500" style={{ width: `${ratio}%` }} />
      </div>
      <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">{ratio}%</span>
    </div>
  );
}

function QuotaObjectsBar({ usedObjects, quotaObjects }: { usedObjects?: number | null; quotaObjects?: number | null }) {
  if (!quotaObjects || quotaObjects <= 0) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }
  const used = usedObjects ?? 0;
  const ratio = Math.min(100, Math.round((used / quotaObjects) * 100));
  return (
    <div className="flex items-center gap-2" title={`${used.toLocaleString()} / ${quotaObjects.toLocaleString()} objects`}>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full bg-primary-500" style={{ width: `${ratio}%` }} />
      </div>
      <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">{ratio}%</span>
    </div>
  );
}

const formatBytes = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const decimals = size >= 10 || idx === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[idx]}`;
};

const formatNumber = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  return value.toLocaleString();
};

const formatObjectCountLabel = (value: number) => {
  const suffix = value === 1 ? "object" : "objects";
  return `${value.toLocaleString()} ${suffix}`;
};

type BucketListRow = Bucket & {
  tags?: BucketTag[] | null;
  features?: Record<string, BucketFeatureStatus> | null;
};
type SortField = SortableField<BucketListRow>;

type ColumnId =
  | "used_bytes"
  | "object_count"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "creation_date"
  | "tags"
  | "versioning"
  | "object_lock"
  | "block_public_access"
  | "lifecycle_rules"
  | "static_website"
  | "bucket_policy"
  | "cors"
  | "access_logging"
  | "notifications"
  | "quota_status";

type ManagerFeatureKey =
  | "versioning"
  | "object_lock"
  | "block_public_access"
  | "lifecycle_rules"
  | "static_website"
  | "bucket_policy"
  | "cors"
  | "access_logging"
  | "notifications";

const MANAGER_FEATURE_LABELS: Record<ManagerFeatureKey, string> = {
  versioning: "Versioning",
  object_lock: "Object Lock",
  block_public_access: "Block public access",
  lifecycle_rules: "Lifecycle rules",
  static_website: "Static website",
  bucket_policy: "Bucket policy",
  cors: "CORS",
  access_logging: "Access logging",
  notifications: "Notifications",
};

const LEGACY_COLUMNS_STORAGE_KEY = "manager.bucket_list.columns.v1";
const COLUMNS_STORAGE_KEY = "manager.bucket_list.columns.session.v1";
const defaultVisibleColumns: ColumnId[] = ["used_bytes", "object_count"];

const loadVisibleColumns = (): ColumnId[] => {
  if (typeof window === "undefined") return defaultVisibleColumns;
  try {
    window.localStorage.removeItem(LEGACY_COLUMNS_STORAGE_KEY);
  } catch {
    // Ignore storage access failures; the default column set remains safe.
  }

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(COLUMNS_STORAGE_KEY);
  } catch {
    return defaultVisibleColumns;
  }
  if (!raw) return defaultVisibleColumns;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultVisibleColumns;
    const allowed = new Set<ColumnId>([
      "used_bytes",
      "object_count",
      "quota_max_size_bytes",
      "quota_max_objects",
      "creation_date",
      "tags",
      "versioning",
      "object_lock",
      "block_public_access",
      "lifecycle_rules",
      "static_website",
      "bucket_policy",
      "cors",
      "access_logging",
      "notifications",
      "quota_status",
    ]);
    const cleaned = parsed.filter((v) => typeof v === "string" && allowed.has(v as ColumnId)) as ColumnId[];
    return cleaned.length > 0 ? cleaned : defaultVisibleColumns;
  } catch {
    return defaultVisibleColumns;
  }
};

const persistVisibleColumns = (value: ColumnId[]) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage write failures; the in-memory selection still applies for this render.
  }
};

export default function BucketsPage() {
  const {
    accounts,
    selectedS3AccountId,
    requiresS3AccountSelection,
    sessionS3AccountName,
    accountIdForApi,
  } = useS3AccountContext();
  const { generalSettings } = useGeneralSettings();
  const storedUser = readStoredUser();
  const managerToolAccess = getManagerToolAccess(storedUser);
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const [buckets, setBuckets] = useState<BucketListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingBucket, setDeletingBucket] = useState<string | null>(null);
  const [pendingDeleteBucketName, setPendingDeleteBucketName] = useState<string | null>(null);
  const [pendingDeleteWithPurgeBucketName, setPendingDeleteWithPurgeBucketName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [useCustomLocationConstraint, setUseCustomLocationConstraint] = useState(false);
  const [bucketForm, setBucketForm] = useState<BucketForm>(buildDefaultForm);
  const [wizardInitialSignature, setWizardInitialSignature] = useState(() =>
    stableSignature({ bucketForm: buildDefaultForm(), useCustomLocationConstraint: false })
  );
  const [filter, setFilter] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(loadVisibleColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement | null>(null);
  const fetchRequestRef = useRef(0);
  const [activeFeatureTooltipKey, setActiveFeatureTooltipKey] = useState<string | null>(null);
  const [featureTooltipState, setFeatureTooltipState] = useState<Record<string, BucketFeatureTooltipState>>({});
  const featureTooltipInflightRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const bucketPropertiesCacheRef = useRef<Record<string, BucketProperties>>({});
  const bucketPropertiesInflightRef = useRef<Record<string, Promise<BucketProperties>>>({});
  const [activeTagsTooltipKey, setActiveTagsTooltipKey] = useState<string | null>(null);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "used_bytes",
    direction: "desc",
  });
  const [enrichingColumns, setEnrichingColumns] = useState(false);
  const invalidBucketNameMessage = "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.";

  const selectedS3Account = useMemo(
    () => accounts.find((a) => a.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const endpointCaps = selectedS3Account?.storage_endpoint_capabilities ?? null;
  const usageFeatureEnabled = endpointCaps ? endpointCaps.metrics !== false : true;
  const snsFeatureEnabled = endpointCaps ? endpointCaps.sns !== false : true;
  const staticWebsiteFeatureEnabled = endpointCaps?.static_website === true;
  const quotaFeatureEnabled = selectedS3Account?.endpoint_provider === "ceph";
  const metricColumnOptions = useMemo(
    () => [
      { id: "used_bytes" as const, label: "Used" },
      { id: "object_count" as const, label: "Objects" },
      ...(quotaFeatureEnabled
        ? ([
            { id: "quota_max_size_bytes" as const, label: "Quota" },
            { id: "quota_max_objects" as const, label: "Object quota" },
            { id: "quota_status" as const, label: "Quota status" },
          ] as const)
        : []),
      { id: "creation_date" as const, label: "Created on" },
      { id: "tags" as const, label: "Tags" },
    ],
    [quotaFeatureEnabled]
  );
  const featureColumnOptions = useMemo(
    () =>
      ([
        { id: "versioning", label: "Versioning", key: "versioning" },
        { id: "object_lock", label: "Object Lock", key: "object_lock" },
        { id: "block_public_access", label: "Block public access", key: "block_public_access" },
        { id: "lifecycle_rules", label: "Lifecycle rules", key: "lifecycle_rules" },
        { id: "static_website", label: "Static website", key: "static_website" },
        { id: "bucket_policy", label: "Bucket policy", key: "bucket_policy" },
        { id: "cors", label: "CORS", key: "cors" },
        { id: "access_logging", label: "Access logging", key: "access_logging" },
        { id: "notifications", label: "Notifications", key: "notifications" },
      ].filter(
        (option) =>
          (option.id !== "static_website" || staticWebsiteFeatureEnabled) &&
          (option.id !== "notifications" || snsFeatureEnabled)
      ) as Array<{ id: ManagerFeatureKey; label: string; key: ManagerFeatureKey }>),
    [snsFeatureEnabled, staticWebsiteFeatureEnabled]
  );
  const accountLabel = selectedS3Account
    ? formatAccountLabel(selectedS3Account, defaultEndpointId, defaultEndpointName)
    : requiresS3AccountSelection
      ? "Not selected"
      : sessionS3AccountName || "S3 session";
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const canDeleteBucketWithPurge =
    Boolean(generalSettings.bucket_purge_enabled) && Boolean(managerToolAccess?.bucket_purge);

  const includeParams = useMemo(() => {
    const include: string[] = [];
    if (visibleColumns.includes("tags")) include.push("tags");
    featureColumnOptions.forEach(({ id }) => {
      if (visibleColumns.includes(id)) include.push(id);
    });
    return include;
  }, [featureColumnOptions, visibleColumns]);

  const requiresStats = useMemo(
    () =>
      usageFeatureEnabled &&
      (visibleColumns.includes("used_bytes") ||
        visibleColumns.includes("object_count") ||
        (quotaFeatureEnabled &&
          (visibleColumns.includes("quota_max_size_bytes") ||
            visibleColumns.includes("quota_max_objects") ||
            visibleColumns.includes("quota_status")))),
    [usageFeatureEnabled, visibleColumns, quotaFeatureEnabled]
  );

  type ColumnDef = {
    id: string;
    label: string;
    field?: SortField | null;
    align?: "left" | "right";
    render: (bucket: BucketListRow) => ReactNode;
  };

  const quotaConfigured = (bucket: BucketListRow) =>
    Boolean((bucket.quota_max_size_bytes ?? 0) > 0 || (bucket.quota_max_objects ?? 0) > 0);

  const bucketTooltipCacheKey = (bucket: BucketListRow) => bucket.name;
  const featureTooltipCacheKey = (bucket: BucketListRow, featureKey: ManagerFeatureKey) =>
    `${bucketTooltipCacheKey(bucket)}:${featureKey}`;
  const tagsTooltipCacheKey = (bucketName: string) => `${bucketName}:tags`;

  const getBucketPropertiesCached = async (bucket: BucketListRow): Promise<BucketProperties> => {
    const bucketKey = bucketTooltipCacheKey(bucket);
    const cached = bucketPropertiesCacheRef.current[bucketKey];
    if (cached) return cached;
    const inflight = bucketPropertiesInflightRef.current[bucketKey];
    if (inflight) return inflight;
    const accountId = accountIdForApi ?? null;
    const promise = getBucketProperties(accountId, bucket.name)
      .then((properties) => {
        bucketPropertiesCacheRef.current[bucketKey] = properties;
        return properties;
      })
      .finally(() => {
        delete bucketPropertiesInflightRef.current[bucketKey];
      });
    bucketPropertiesInflightRef.current[bucketKey] = promise;
    return promise;
  };

  const buildFeatureTooltipLines = async (bucket: BucketListRow, featureKey: ManagerFeatureKey): Promise<string[]> => {
    const accountId = accountIdForApi ?? null;

    if (featureKey === "versioning") {
      const properties = await getBucketPropertiesCached(bucket);
      return buildVersioningSummaryLines(properties.versioning_status);
    }

    if (featureKey === "object_lock") {
      const properties = await getBucketPropertiesCached(bucket);
      return buildObjectLockSummaryLines(properties.object_lock_enabled, properties.object_lock);
    }

    if (featureKey === "block_public_access") {
      const properties = await getBucketPropertiesCached(bucket);
      return buildPublicAccessBlockSummaryLines(properties.public_access_block as Record<string, unknown> | null | undefined);
    }

    if (featureKey === "lifecycle_rules") {
      const properties = await getBucketPropertiesCached(bucket);
      return buildLifecycleRuleSummaryLines(properties.lifecycle_rules as unknown[]);
    }

    if (featureKey === "cors") {
      const properties = await getBucketPropertiesCached(bucket);
      const inlineRules = Array.isArray(properties.cors_rules) ? properties.cors_rules : null;
      if (inlineRules) return buildCorsRuleSummaryLines(inlineRules);
      const cors = await getBucketCors(accountId, bucket.name);
      return buildCorsRuleSummaryLines(cors.rules);
    }

    if (featureKey === "static_website") {
      const website = await getBucketWebsite(accountId, bucket.name);
      return buildWebsiteSummaryLines(website as Record<string, unknown>);
    }

    if (featureKey === "bucket_policy") {
      const policy = await getBucketPolicy(accountId, bucket.name);
      return buildBucketPolicySummaryLines(policy.policy);
    }

    if (featureKey === "access_logging") {
      const logging = await getBucketLogging(accountId, bucket.name);
      return buildLoggingSummaryLines(logging as Record<string, unknown>);
    }

    if (featureKey === "notifications") {
      const notifications = await getBucketNotifications(accountId, bucket.name);
      return buildNotificationSummaryLines(notifications.configuration);
    }

    return ["No additional details available."];
  };

  const loadFeatureTooltip = (bucket: BucketListRow, featureKey: ManagerFeatureKey) => {
    if (needsS3AccountSelection) return;
    const key = featureTooltipCacheKey(bucket, featureKey);
    const current = featureTooltipState[key];
    if (current?.status === "ready" || current?.status === "loading") return;
    if (featureTooltipInflightRef.current[key]) return;

    const work = (async () => {
      setFeatureTooltipState((prev) => ({ ...prev, [key]: { status: "loading" } }));
      try {
        const lines = await buildFeatureTooltipLines(bucket, featureKey);
        setFeatureTooltipState((prev) => ({ ...prev, [key]: { status: "ready", lines } }));
      } catch (err) {
        setFeatureTooltipState((prev) => ({
          ...prev,
          [key]: { status: "error", message: extractError(err) },
        }));
      } finally {
        delete featureTooltipInflightRef.current[key];
      }
    })();
    featureTooltipInflightRef.current[key] = work;
  };

  const renderTagList = (tags?: BucketTag[] | null, bucketName = "bucket") => {
    const safeTags = Array.isArray(tags) ? tags.filter((t) => (t.key ?? "").trim()) : [];
    if (safeTags.length === 0) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    const maxShown = 3;
    const shown = safeTags.slice(0, maxShown);
    const remaining = safeTags.length - shown.length;
    const tagKey = tagsTooltipCacheKey(bucketName);
    const tooltip: BucketFeatureTooltipState = { status: "ready", lines: buildBucketTagSummaryLines(safeTags) };
    return (
      <BucketSummaryTooltip
        label="S3 tags"
        tooltip={tooltip}
        open={activeTagsTooltipKey === tagKey}
        onOpen={() => setActiveTagsTooltipKey(tagKey)}
        onClose={() => setActiveTagsTooltipKey((prev) => (prev === tagKey ? null : prev))}
        cacheKey={tagKey}
        buttonClassName="inline-flex max-w-full cursor-default text-left"
      >
        <div className="flex flex-wrap gap-1.5">
          {shown.map((t) => (
            <span
              key={`${t.key}:${t.value}`}
              className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {t.key}={t.value}
            </span>
          ))}
          {remaining > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              +{remaining}
            </span>
          )}
        </div>
      </BucketSummaryTooltip>
    );
  };

  const renderFeatureChip = (featureKey: ManagerFeatureKey, bucket: BucketListRow) => {
    const status = bucket.features?.[featureKey] ?? null;
    if (!status) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    const tooltipKey = featureTooltipCacheKey(bucket, featureKey);
    return (
      <BucketFeatureSummaryChip
        label={MANAGER_FEATURE_LABELS[featureKey]}
        state={status.state}
        tone={status.tone}
        tooltip={featureTooltipState[tooltipKey]}
        open={activeFeatureTooltipKey === tooltipKey}
        onOpen={() => {
          setActiveFeatureTooltipKey(tooltipKey);
          loadFeatureTooltip(bucket, featureKey);
        }}
        onClose={() => setActiveFeatureTooltipKey((prev) => (prev === tooltipKey ? null : prev))}
        cacheKey={tooltipKey}
      />
    );
  };

  const fetchBuckets = useCallback(async (accountId: S3AccountSelector) => {
    const requestId = fetchRequestRef.current + 1;
    fetchRequestRef.current = requestId;
    setError(null);
    setLoading(true);
    setEnrichingColumns(false);
    try {
      const baseData = await listBuckets(accountId, {
        with_stats: requiresStats,
      });
      if (fetchRequestRef.current !== requestId) return;
      setBuckets(baseData);
      setLoading(false);

      if (includeParams.length === 0) return;

      setEnrichingColumns(true);
      try {
        const enrichedData = await listBuckets(accountId, {
          include: includeParams,
          with_stats: requiresStats,
        });
        if (fetchRequestRef.current !== requestId) return;
        setBuckets(enrichedData);
      } catch (err) {
        if (fetchRequestRef.current !== requestId) return;
        console.error(err);
        setError(extractError(err));
      } finally {
        if (fetchRequestRef.current === requestId) {
          setEnrichingColumns(false);
        }
      }
    } catch (err) {
      if (fetchRequestRef.current !== requestId) return;
      console.error(err);
      setError(extractError(err) || "Unable to fetch buckets.");
      setBuckets([]);
      setEnrichingColumns(false);
    } finally {
      if (fetchRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [includeParams, requiresStats]);

  useEffect(() => {
    if (needsS3AccountSelection) {
      fetchRequestRef.current += 1;
      setLoading(false);
      setEnrichingColumns(false);
      setBuckets([]);
      return;
    }
    fetchBuckets(accountIdForApi ?? null);
  }, [accountIdForApi, fetchBuckets, needsS3AccountSelection]);

  useEffect(() => {
    setActiveFeatureTooltipKey(null);
    setFeatureTooltipState({});
    featureTooltipInflightRef.current = {};
    bucketPropertiesCacheRef.current = {};
    bucketPropertiesInflightRef.current = {};
    setActiveTagsTooltipKey(null);
  }, [accountIdForApi]);

  useEffect(() => {
    persistVisibleColumns(visibleColumns);
  }, [visibleColumns]);

  useEffect(() => {
    setVisibleColumns((prev) => {
      const next = prev.filter((column) => {
        if (column === "static_website" && !staticWebsiteFeatureEnabled) return false;
        if (column === "notifications" && !snsFeatureEnabled) return false;
        if (
          (column === "quota_max_size_bytes" || column === "quota_max_objects" || column === "quota_status") &&
          !quotaFeatureEnabled
        ) {
          return false;
        }
        return true;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [quotaFeatureEnabled, snsFeatureEnabled, staticWebsiteFeatureEnabled]);

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

  const filteredBuckets = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const items = q ? buckets.filter((b) => b.name.toLowerCase().includes(q)) : buckets;
    const sorted = [...items].sort((a, b) => {
      return compareByNullableField(a, b, sort.field, sort.direction);
    });
    return sorted;
  }, [buckets, filter, sort]);

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "desc" };
    });
  };

  const toggleColumn = (id: ColumnId) => {
    setVisibleColumns((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const resetColumns = () => {
    setVisibleColumns(defaultVisibleColumns);
  };

  const performCreate = async (
    name: string,
    versioning: boolean,
    locationConstraint?: string
  ): Promise<{ created: boolean }> => {
    if (needsS3AccountSelection) {
      setActionError("Select an account before creating a bucket.");
      return { created: false };
    }
    setCreating(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await createBucket(name, accountIdForApi, {
        versioning,
        locationConstraint,
      });
      setActionMessage("Bucket created");
      await fetchBuckets(accountIdForApi ?? null);
      return { created: true };
    } catch (err) {
      setActionError(extractError(err));
      return { created: false };
    } finally {
      setCreating(false);
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (needsS3AccountSelection) {
      setActionError("Select an account before creating a bucket.");
      return;
    }
    const normalizedBucketName = normalizeS3BucketName(bucketForm.name);
    if (!normalizedBucketName) {
      setActionError("Bucket name is required.");
      return;
    }
    if (!isValidS3BucketName(normalizedBucketName)) {
      setActionError(invalidBucketNameMessage);
      return;
    }
    const locationConstraint = useCustomLocationConstraint ? bucketForm.locationConstraint.trim() || undefined : undefined;
    const result = await performCreate(normalizedBucketName, bucketForm.versioning, locationConstraint);
    if (result.created) {
      setBucketForm(buildDefaultForm());
      setShowWizard(false);
      setWizardStep(0);
      setUseCustomLocationConstraint(false);
    }
  };

  const requestDelete = (name: string) => {
    if (needsS3AccountSelection) return;
    const targetBucket = buckets.find((b) => b.name === name);
    const objectCount = targetBucket?.object_count;
    if ((objectCount ?? 0) > 0) {
      if (canDeleteBucketWithPurge) {
        setActionError(null);
        setActionMessage(null);
        setPendingDeleteWithPurgeBucketName(name);
        return;
      }
      setActionMessage(null);
      setActionError(
        `Bucket '${name}' is not empty (${formatObjectCountLabel(objectCount ?? 0)}). Empty it before deleting, or enable bucket purge access to delete it from Manager.`
      );
      return;
    }
    setActionError(null);
    setActionMessage(null);
    setPendingDeleteBucketName(name);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteBucketName) return;
    const name = pendingDeleteBucketName;
    setDeletingBucket(name);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteBucket(name, accountIdForApi);
      setActionMessage("Bucket deleted");
      await fetchBuckets(accountIdForApi ?? null);
      return;
    } catch (err) {
      const msg = extractError(err);
      const notEmpty = msg.toLowerCase().includes("not empty");
      const conflict = axios.isAxiosError(err) && err.response?.status === 409;
      if (notEmpty || conflict) {
        setActionError(`Bucket '${name}' is not empty. Empty it before deleting.`);
        return;
      }
      setActionError(msg);
    } finally {
      setDeletingBucket(null);
      setPendingDeleteBucketName(null);
    }
  };

  const handleDeleteWithPurgeFinished = async (result: { bucket_deleted?: boolean; deleted_objects?: number; deleted_versions?: number }) => {
    if (!result.bucket_deleted) return;
    const deletedEntries = (result.deleted_objects ?? 0) + (result.deleted_versions ?? 0);
    const entryLabel = deletedEntries === 1 ? "entry" : "entries";
    setActionError(null);
    setActionMessage(`Bucket deleted after removing ${deletedEntries.toLocaleString()} ${entryLabel}.`);
    await fetchBuckets(accountIdForApi ?? null);
  };

  const bucketTableColumns: ColumnDef[] = (() => {
    const cols: ColumnDef[] = [
      {
        id: "name",
        label: "Name",
        field: "name",
        render: (bucket) => (
          <Link to={`/manager/buckets/${encodeURIComponent(bucket.name)}`} className="hover:text-primary-700 dark:hover:text-primary-200">
            {bucket.name}
          </Link>
        ),
      },
    ];

    const visible = new Set(visibleColumns);
    if (visible.has("used_bytes")) {
      cols.push({
        id: "used_bytes",
        label: "Used",
        field: "used_bytes",
        render: (bucket) => formatBytes(bucket.used_bytes),
      });
    }
    if (quotaFeatureEnabled && visible.has("quota_max_size_bytes")) {
      cols.push({
        id: "quota_max_size_bytes",
        label: "Quota",
        field: "quota_max_size_bytes",
        render: (bucket) => <QuotaBar usedBytes={bucket.used_bytes} quotaBytes={bucket.quota_max_size_bytes ?? null} />,
      });
    }
    if (visible.has("object_count")) {
      cols.push({
        id: "object_count",
        label: "Objects",
        field: "object_count",
        render: (bucket) => formatNumber(bucket.object_count),
      });
    }
    if (quotaFeatureEnabled && visible.has("quota_max_objects")) {
      cols.push({
        id: "quota_max_objects",
        label: "Object quota",
        field: "quota_max_objects",
        render: (bucket) => <QuotaObjectsBar usedObjects={bucket.object_count} quotaObjects={bucket.quota_max_objects ?? null} />,
      });
    }
    if (visible.has("creation_date")) {
      cols.push({
        id: "creation_date",
        label: "Created on",
        field: null,
        render: (bucket) => (bucket.creation_date ? new Date(bucket.creation_date).toLocaleDateString() : "-"),
      });
    }
    if (visible.has("tags")) {
      cols.push({
        id: "tags",
        label: "Tags",
        field: null,
        render: (bucket) => renderTagList(bucket.tags, bucket.name),
      });
    }

    featureColumnOptions.forEach((c) => {
      if (!visible.has(c.id)) return;
      cols.push({
        id: c.id,
        label: c.label,
        field: null,
        render: (bucket) => renderFeatureChip(c.key, bucket),
      });
    });

    if (quotaFeatureEnabled && visible.has("quota_status")) {
      cols.push({
        id: "quota_status",
        label: "Quota status",
        field: null,
        render: (bucket) => (
          <PropertySummaryChip
            compact
            state={quotaConfigured(bucket) ? "Configured" : "Not set"}
            tone={quotaConfigured(bucket) ? "active" : "inactive"}
            title={`Quota: ${quotaConfigured(bucket) ? "Configured" : "Not set"}`}
          />
        ),
      });
    }

    cols.push({
      id: "actions",
      label: "Actions",
      field: null,
      align: "right",
      render: (bucket) => {
        const objectCount = bucket.object_count;
        const containsObjects = (objectCount ?? 0) > 0;
        const deleteDisabledReason =
          containsObjects && !canDeleteBucketWithPurge
            ? "Bucket is not empty. Empty it first, or enable bucket purge access to delete it from Manager."
            : null;
        const deleteDisabledLabel = deleteDisabledReason ? "Not empty" : null;
        const deleteLabel = containsObjects && canDeleteBucketWithPurge ? "Purge and Delete" : "Delete";
        const deleteButton = (
          <button
            onClick={() => requestDelete(bucket.name)}
            className={`${tableDeleteActionClasses} whitespace-nowrap`}
            disabled={deletingBucket === bucket.name || Boolean(deleteDisabledReason)}
          >
            {deletingBucket === bucket.name ? "Deleting..." : deleteLabel}
          </button>
        );
        return (
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-nowrap justify-end gap-2">
              <Link
                to={`/manager/buckets/${encodeURIComponent(bucket.name)}`}
                className={`${tableActionButtonClasses} whitespace-nowrap`}
              >
                Configure
              </Link>
              {deleteDisabledReason ? <span title={deleteDisabledReason}>{deleteButton}</span> : deleteButton}
            </div>
            {deleteDisabledLabel && (
              <span className="ui-caption text-slate-500 dark:text-slate-400" title={deleteDisabledReason ?? undefined}>
                {deleteDisabledLabel}
              </span>
            )}
          </div>
        );
      },
    });

    return cols;
  })();

  const stepTitles = ["General", "Protection"];
  const isBucketNameValid = !bucketForm.name || isValidS3BucketName(bucketForm.name);
  const wizardCurrentSignature = useMemo(
    () => stableSignature({ bucketForm, useCustomLocationConstraint }),
    [bucketForm, useCustomLocationConstraint]
  );
  const closeWizard = () => {
    setShowWizard(false);
    setBucketForm(buildDefaultForm());
    setWizardStep(0);
    setUseCustomLocationConstraint(false);
    setWizardInitialSignature(stableSignature({ bucketForm: buildDefaultForm(), useCustomLocationConstraint: false }));
  };
  const wizardCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showWizard && wizardCurrentSignature !== wizardInitialSignature,
    onClose: closeWizard,
    disabled: creating,
  });
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredBuckets.length,
  });

  const openAdvancedModal = () => {
    setBucketForm(buildDefaultForm());
    setWizardStep(0);
    setUseCustomLocationConstraint(false);
    setWizardInitialSignature(stableSignature({ bucketForm: buildDefaultForm(), useCustomLocationConstraint: false }));
    setShowWizard(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Buckets"
        description="Bucket inventory and configuration for the active manager context."
        breadcrumbs={[{ label: "Manager" }, { label: "Buckets" }]}
        actions={[
          {
            label: "Create bucket",
            onClick: openAdvancedModal,
          },
        ]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before managing buckets"
          description="The bucket list, quota details, and destructive actions stay disabled until a manager execution context is selected."
          primaryAction={{ label: "Open dashboard", to: "/manager" }}
          secondaryAction={{ label: "Open browser", to: "/manager/browser" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Buckets"
            description="Paginated list of buckets for the active context."
            showHeading={false}
            countLabel={`${filteredBuckets.length} bucket(s)`}
            search={
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Search
                </span>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search by name"
                  className={`${toolbarCompactInputClasses} w-full sm:w-64 md:w-72`}
                />
              </div>
            }
            columns={
              <>
                {enrichingColumns ? (
                  <span className="ui-caption text-slate-500 dark:text-slate-400">Updating selected columns...</span>
                ) : null}
                <div className="relative" ref={columnPickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowColumnPicker((prev) => !prev)}
                    className={toolbarCompactButtonClasses}
                  >
                    Columns
                  </button>
                  {showColumnPicker && (
                    <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between gap-2">
                        <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Visible columns</p>
                        <button
                          type="button"
                          onClick={resetColumns}
                          className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          Reset
                        </button>
                      </div>

                      <div className="mt-3 space-y-3">
                        <div className="space-y-2">
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Metrics</p>
                          {metricColumnOptions.map((opt) => (
                            <label key={opt.id} className="flex items-center justify-between ui-body text-slate-700 dark:text-slate-200">
                              <span>{opt.label}</span>
                              <input
                                type="checkbox"
                                checked={visibleColumns.includes(opt.id)}
                                onChange={() => toggleColumn(opt.id)}
                                className={uiCheckboxClass}
                              />
                            </label>
                          ))}
                        </div>

                        <div className="space-y-2">
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Features</p>
                          {featureColumnOptions.map((opt) => (
                            <label key={opt.id} className="flex items-center justify-between ui-body text-slate-700 dark:text-slate-200">
                              <span>{opt.label}</span>
                              <input
                                type="checkbox"
                                checked={visibleColumns.includes(opt.id)}
                                onChange={() => toggleColumn(opt.id)}
                                className={uiCheckboxClass}
                              />
                            </label>
                          ))}
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
                            Feature checks run only when their column is enabled.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            }
          />
          <div className="overflow-x-auto">
            <table className="manager-table w-full min-w-[760px] divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  {bucketTableColumns.map((col) => (
                    <SortableHeader
                      key={col.id}
                      label={col.label}
                      field={col.field}
                      activeField={sort.field}
                      direction={sort.direction}
                      align={col.align ?? (col.label === "Actions" ? "right" : "left")}
                      onSort={col.field ? (field) => toggleSort(field) : undefined}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {tableStatus === "loading" && <TableEmptyState colSpan={bucketTableColumns.length} message="Loading buckets..." />}
                {tableStatus === "error" && (
                  <TableEmptyState colSpan={bucketTableColumns.length} message="Unable to load buckets." tone="error" />
                )}
                {tableStatus === "empty" && <TableEmptyState colSpan={bucketTableColumns.length} message="No buckets." />}
                {filteredBuckets.map((bucket) => (
                    <tr key={bucket.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      {bucketTableColumns.map((col) => {
                        const align = col.align ?? (col.id === "actions" ? "right" : "left");
                        const cellBase =
                          col.id === "actions"
                            ? "min-w-[13rem] px-6 py-4 text-right align-top"
                            : align === "right"
                              ? "px-6 py-4 text-right"
                              : "px-6 py-4";
                        const textClass =
                          col.id === "name"
                            ? "manager-table-cell ui-body font-semibold text-slate-900 dark:text-slate-100"
                            : "ui-body text-slate-600 dark:text-slate-300";
                        return (
                          <td key={`${bucket.name}:${col.id}`} className={`${cellBase} ${textClass}`}>
                            {col.render(bucket)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pendingDeleteBucketName && (
        <ConfirmActionDialog
          title="Delete bucket"
          description="This permanently removes the bucket after server-side checks confirm it is empty."
          confirmLabel="Delete bucket"
          details={[
            { label: "Bucket", value: pendingDeleteBucketName, mono: true },
            { label: "Context", value: accountLabel },
          ]}
          impacts={[
            "Deletion is irreversible once the bucket is removed.",
            "The bucket must remain empty until the operation completes.",
          ]}
          loading={deletingBucket === pendingDeleteBucketName}
          onCancel={() => setPendingDeleteBucketName(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}

      {pendingDeleteWithPurgeBucketName && accountIdForApi && (
        <BucketPurgeRunModal
          mode="manager-delete"
          contextId={String(accountIdForApi)}
          contextName={accountLabel}
          targets={[{ bucketName: pendingDeleteWithPurgeBucketName }]}
          onFinished={(result) => void handleDeleteWithPurgeFinished(result)}
          onClose={() => setPendingDeleteWithPurgeBucketName(null)}
        />
      )}

      {showWizard && (
        <Modal title="Create bucket" onClose={wizardCloseGuard.requestClose}>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="flex items-center gap-3">
              {stepTitles.map((title, index) => (
                <div key={title} className="flex items-center gap-2 ui-body">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full border ui-caption font-semibold ${
                      index === wizardStep
                        ? "border-primary bg-primary-100/70 text-primary-800 dark:border-primary-500 dark:bg-primary-500/20 dark:text-primary-100"
                        : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <span className={index === wizardStep ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}>
                    {title}
                  </span>
                  {index < stepTitles.length - 1 && <span className="text-slate-400 dark:text-slate-600">—</span>}
                </div>
              ))}
            </div>

            {wizardStep === 0 && (
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Bucket name</label>
                  <input
                    value={bucketForm.name}
                    onChange={(e) => {
                      const value = normalizeS3BucketNameInput(e.target.value);
                      setBucketForm((prev) => ({ ...prev, name: value }));
                    }}
                    maxLength={S3_BUCKET_NAME_MAX_LENGTH}
                    title={!bucketForm.name || isBucketNameValid ? undefined : invalidBucketNameMessage}
                    className={`rounded-md border px-3 py-2 ui-body focus:outline-none focus:ring-2 ${
                      !bucketForm.name || isBucketNameValid
                        ? "border-slate-200 focus:border-primary focus:ring-primary/30 dark:border-slate-700 dark:text-slate-100"
                        : "border-rose-400 text-rose-700 focus:border-rose-500 focus:ring-rose-200 dark:border-rose-500 dark:text-rose-200 dark:focus:ring-rose-900/50"
                    } dark:bg-slate-900`}
                    placeholder="ex: backups-prod"
                    required
                  />
                  {bucketForm.name && !isBucketNameValid && (
                    <p className="ui-caption font-semibold text-rose-600 dark:text-rose-300">{invalidBucketNameMessage}</p>
                  )}
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    DNS compatible, lowercase, numbers, dots, and hyphens. The selected account will be used.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 ui-caption text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={useCustomLocationConstraint}
                      onChange={(e) => setUseCustomLocationConstraint(e.target.checked)}
                      className={uiCheckboxClass}
                    />
                    <span>Custom LocationConstraint</span>
                  </label>
                  {useCustomLocationConstraint && (
                    <div className="flex flex-col gap-2">
                      <input
                        value={bucketForm.locationConstraint}
                        onChange={(e) => setBucketForm((prev) => ({ ...prev, locationConstraint: e.target.value }))}
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="ex: eu-west-1"
                      />
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Optional. Empty value uses the endpoint default region/placement.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {wizardStep === 1 && (
              <div className="space-y-4">
                <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ui-body text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100">
                  <span>
                    Versioning
                    <span className="block ui-caption text-slate-500 dark:text-slate-400">Enables version retention.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={bucketForm.versioning}
                    onChange={(e) => setBucketForm((prev) => ({ ...prev, versioning: e.target.checked }))}
                    className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  />
                </label>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="ui-caption text-slate-500 dark:text-slate-400">
                S3Account: {accountLabel}
              </div>
              <div className="flex items-center gap-3">
                {wizardStep > 0 && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      setWizardStep((prev) => Math.max(prev - 1, 0));
                    }}
                    className="rounded-md border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    Previous
                  </button>
                )}
                {wizardStep < stepTitles.length - 1 ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      if (!bucketForm.name.trim()) {
                        setActionError("Bucket name is required.");
                        return;
                      }
                      if (!isBucketNameValid) {
                        setActionError(invalidBucketNameMessage);
                        return;
                      }
                      setActionError(null);
                      setWizardStep((prev) => Math.min(prev + 1, stepTitles.length - 1));
                    }}
                    disabled={!bucketForm.name.trim() || !isBucketNameValid}
                    className={cx(uiButtonBaseClass, uiButtonVariants.primary, "rounded-md px-4 py-2 ui-body")}
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={creating}
                    className={cx(uiButtonBaseClass, uiButtonVariants.primary, "rounded-md px-4 py-2 ui-body")}
                  >
                    {creating ? "Creating..." : "Create bucket"}
                  </button>
                )}
              </div>
            </div>
          </form>
          {wizardCloseGuard.confirmationDialog}
        </Modal>
      )}
    </div>
  );
}

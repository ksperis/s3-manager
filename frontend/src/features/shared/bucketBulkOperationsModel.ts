/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminBucketConfigBackupFeature } from "../../api/cephAdmin";
import {
  readSessionJsonFromKey,
  removeSessionStorageKey,
  writeSessionJsonToKey,
} from "../../utils/clientStorage";

export const BULK_CONCURRENCY_LIMIT = 6;

export type BulkOperation =
  | ""
  | "copy_configs"
  | "paste_configs"
  | "set_quota"
  | "add_public_access_block"
  | "remove_public_access_block"
  | "enable_versioning"
  | "disable_versioning"
  | "add_lifecycle"
  | "delete_lifecycle"
  | "add_notifications"
  | "delete_notifications"
  | "add_cors"
  | "delete_cors"
  | "add_policy"
  | "delete_policy";

export type SelectionExportFormat = "text" | "csv" | "json";
export type BulkPreviewTone = "added" | "removed";
export type BulkPreviewLine = { text: string; tone?: BulkPreviewTone };
export type BulkPreviewItem = {
  bucket: string;
  before: BulkPreviewLine[];
  after: BulkPreviewLine[];
  changed: boolean;
  error?: string;
};

export type BulkCopyFeatureKey =
  | "quota"
  | "versioning"
  | "object_lock"
  | "public_access_block"
  | "lifecycle"
  | "cors"
  | "policy"
  | "access_logging";

export type BulkCopyFeatureSelection = Record<BulkCopyFeatureKey, boolean>;

export type BulkQuotaSnapshot = {
  maxSizeBytes: number | null;
  maxObjects: number | null;
};

export type BulkObjectLockSnapshot = {
  enabled: boolean;
  mode: string | null;
  days: number | null;
  years: number | null;
};

export type BulkAccessLoggingSnapshot = {
  enabled: boolean;
  target_bucket: string | null;
  target_prefix: string | null;
};

export type BulkConfigClipboardBucket = {
  name: string;
  quota: BulkQuotaSnapshot | null;
  versioningEnabled: boolean | null;
  objectLock: BulkObjectLockSnapshot | null;
  publicAccessBlock: PublicAccessBlockState | null;
  lifecycleRules: Record<string, unknown>[] | null;
  corsRules: Record<string, unknown>[] | null;
  policy: Record<string, unknown> | null;
  accessLogging: BulkAccessLoggingSnapshot | null;
};

export type BulkConfigClipboard = {
  version: 1;
  copiedAt: string;
  sourceEndpointId: number;
  sourceEndpointName: string | null;
  features: BulkCopyFeatureSelection;
  buckets: BulkConfigClipboardBucket[];
};

export type BulkPastePlanItem = {
  sourceBucket: string;
  destinationBucket: string;
  sourceConfig: BulkConfigClipboardBucket;
};

export type BulkPastePlan = {
  mode: "one_to_many" | "one_to_one" | null;
  mappings: BulkPastePlanItem[];
  error: string | null;
};

export type QuotaSizeUnit = "MiB" | "GiB" | "TiB";

export type ParsedQuotaInput = {
  applySize: boolean;
  applyObjects: boolean;
  maxSizeValue: number | null;
  maxSizeUnit: QuotaSizeUnit;
  maxSizeBytes: number | null;
  maxObjects: number | null;
};

const QUOTA_UNIT_TO_BYTES: Record<QuotaSizeUnit, number> = {
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

export const normalizeQuotaLimit = (value?: number | null) => {
  if (value === null || value === undefined) return null;
  return value > 0 ? value : null;
};

export const bytesToGiB = (value: number) => value / 1024 ** 3;

export const hasConfiguredQuota = (quota: {
  maxSizeBytes: number | null;
  maxObjects: number | null;
}) => quota.maxSizeBytes !== null || quota.maxObjects !== null;

export const parseQuotaInput = (
  rawMaxSizeValue: string,
  maxSizeUnit: QuotaSizeUnit,
  rawMaxObjects: string,
  applySize: boolean,
  applyObjects: boolean,
): { error: string } | ParsedQuotaInput => {
  if (!applySize && !applyObjects) {
    return { error: "Select at least one quota target (storage or objects)." };
  }
  const maxSizeText = rawMaxSizeValue.trim();
  const maxObjectsText = rawMaxObjects.trim();

  let maxSizeValue: number | null = null;
  let maxSizeBytes: number | null = null;
  if (applySize && maxSizeText) {
    const parsed = Number(maxSizeText);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: "Quota size must be a positive number or zero." };
    }
    maxSizeValue = parsed;
    maxSizeBytes = Math.floor(parsed * QUOTA_UNIT_TO_BYTES[maxSizeUnit]);
  }

  let maxObjects: number | null = null;
  if (applyObjects && maxObjectsText) {
    const parsed = Number(maxObjectsText);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      return { error: "Object quota must be a whole number (0 or greater)." };
    }
    maxObjects = parsed;
  }

  return {
    applySize,
    applyObjects,
    maxSizeValue,
    maxSizeUnit,
    maxSizeBytes: normalizeQuotaLimit(maxSizeBytes),
    maxObjects: normalizeQuotaLimit(maxObjects),
  };
};

export type PublicAccessBlockState = {
  block_public_acls: boolean;
  ignore_public_acls: boolean;
  block_public_policy: boolean;
  restrict_public_buckets: boolean;
};

export type PublicAccessBlockOptionKey = keyof PublicAccessBlockState;
type NullablePublicAccessBlockState = Partial<
  Record<PublicAccessBlockOptionKey, boolean | null>
>;

export const PUBLIC_ACCESS_BLOCK_OPTIONS: Array<{
  key: PublicAccessBlockOptionKey;
  label: string;
}> = [
  { key: "block_public_acls", label: "BlockPublicAcls" },
  { key: "ignore_public_acls", label: "IgnorePublicAcls" },
  { key: "block_public_policy", label: "BlockPublicPolicy" },
  { key: "restrict_public_buckets", label: "RestrictPublicBuckets" },
];

export const normalizePublicAccessBlockState = (
  value?: NullablePublicAccessBlockState | null,
): PublicAccessBlockState => ({
  block_public_acls: Boolean(value?.block_public_acls),
  ignore_public_acls: Boolean(value?.ignore_public_acls),
  block_public_policy: Boolean(value?.block_public_policy),
  restrict_public_buckets: Boolean(value?.restrict_public_buckets),
});

export const isPublicAccessBlockEquivalent = (
  a: PublicAccessBlockState,
  b: PublicAccessBlockState,
) =>
  a.block_public_acls === b.block_public_acls &&
  a.ignore_public_acls === b.ignore_public_acls &&
  a.block_public_policy === b.block_public_policy &&
  a.restrict_public_buckets === b.restrict_public_buckets;

export const formatPublicAccessBlockState = (
  state: PublicAccessBlockState,
) => {
  const enabledCount = [
    state.block_public_acls,
    state.ignore_public_acls,
    state.block_public_policy,
    state.restrict_public_buckets,
  ].filter(Boolean).length;
  if (enabledCount === 4) return "Enabled";
  if (enabledCount === 0) return "Disabled";
  return `Partial (${enabledCount}/4)`;
};

export const formatPublicAccessBlockFlag = (value: boolean) =>
  value ? "Blocked" : "Unblocked";

export const normalizeObjectLockSnapshot = (
  value?: Record<string, unknown> | null,
): BulkObjectLockSnapshot => {
  const enabled = Boolean(value?.enabled);
  const rawMode = value?.mode;
  const mode =
    typeof rawMode === "string" && rawMode.trim() ? rawMode.trim() : null;
  const rawDays = value?.days;
  const rawYears = value?.years;
  const days =
    typeof rawDays === "number" && Number.isFinite(rawDays) ? rawDays : null;
  const years =
    typeof rawYears === "number" && Number.isFinite(rawYears)
      ? rawYears
      : null;
  return { enabled, mode, days, years };
};

export const isObjectLockSnapshotEqual = (
  a: BulkObjectLockSnapshot,
  b: BulkObjectLockSnapshot,
) =>
  a.enabled === b.enabled &&
  a.mode === b.mode &&
  a.days === b.days &&
  a.years === b.years;

export const formatObjectLockSnapshot = (value: BulkObjectLockSnapshot) =>
  JSON.stringify(
    {
      enabled: value.enabled,
      mode: value.mode,
      days: value.days,
      years: value.years,
    },
    null,
    2,
  );

export const normalizeAccessLoggingSnapshot = (
  value?: Record<string, unknown> | null,
): BulkAccessLoggingSnapshot => {
  const rawTargetBucket = value?.target_bucket;
  const rawTargetPrefix = value?.target_prefix;
  const target_bucket =
    typeof rawTargetBucket === "string" && rawTargetBucket.trim()
      ? rawTargetBucket.trim()
      : null;
  const target_prefix =
    typeof rawTargetPrefix === "string" && rawTargetPrefix.trim()
      ? rawTargetPrefix.trim()
      : null;
  const enabled = Boolean(value?.enabled && target_bucket);
  return { enabled, target_bucket, target_prefix };
};

export const isAccessLoggingSnapshotEqual = (
  a: BulkAccessLoggingSnapshot,
  b: BulkAccessLoggingSnapshot,
) =>
  a.enabled === b.enabled &&
  a.target_bucket === b.target_bucket &&
  a.target_prefix === b.target_prefix;

export const applyPublicAccessBlockTargets = (
  current: PublicAccessBlockState,
  desiredEnabled: boolean,
  targets: PublicAccessBlockOptionKey[],
): PublicAccessBlockState => {
  const next: PublicAccessBlockState = { ...current };
  targets.forEach((key) => {
    next[key] = desiredEnabled;
  });
  return next;
};

export const BULK_COPY_FEATURE_LABELS: Record<BulkCopyFeatureKey, string> = {
  quota: "Quota",
  versioning: "Versioning",
  object_lock: "Object Lock",
  public_access_block: "Block public access",
  lifecycle: "Lifecycle rules",
  cors: "CORS",
  policy: "Bucket policy",
  access_logging: "Access logging",
};

export const BUCKET_CONFIG_BACKUP_FEATURE_LABELS: Record<
  CephAdminBucketConfigBackupFeature,
  string
> = {
  quota: "Quota",
  versioning: "Versioning",
  object_lock: "Object Lock",
  public_access_block: "Block public access",
  lifecycle: "Lifecycle rules",
  cors: "CORS",
  policy: "Bucket policy",
  access_logging: "Access logging",
  tags: "Tags",
};

export const DEFAULT_BULK_COPY_FEATURE_SELECTION: BulkCopyFeatureSelection = {
  quota: false,
  versioning: false,
  object_lock: false,
  public_access_block: false,
  lifecycle: false,
  cors: false,
  policy: false,
  access_logging: false,
};

const parseRuleList = (value: unknown): Record<string, unknown>[] | null => {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (rule): rule is Record<string, unknown> =>
      Boolean(rule) && typeof rule === "object" && !Array.isArray(rule),
  );
};

export const loadBulkConfigClipboard = (
  storageKey: string,
): BulkConfigClipboard | null => {
  const parsed = readSessionJsonFromKey<Partial<BulkConfigClipboard>>(storageKey);
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1) return null;
  const sourceEndpointId = Number(parsed.sourceEndpointId);
  if (!Number.isFinite(sourceEndpointId) || sourceEndpointId <= 0) return null;

  const rawFeatures = (parsed.features ?? {}) as Partial<
    Record<BulkCopyFeatureKey, unknown>
  >;
  const features = Object.fromEntries(
    (Object.keys(DEFAULT_BULK_COPY_FEATURE_SELECTION) as BulkCopyFeatureKey[]).map(
      (key) => [key, rawFeatures[key] === true],
    ),
  ) as BulkCopyFeatureSelection;

  const byName = new Map<string, BulkConfigClipboardBucket>();
  const rawBuckets = Array.isArray(parsed.buckets) ? parsed.buckets : [];
  rawBuckets.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const rawName = (entry as { name?: unknown }).name;
    if (typeof rawName !== "string" || !rawName.trim()) return;
    const name = rawName.trim();
    const rawQuota = (entry as { quota?: unknown }).quota;
    const quota =
      rawQuota && typeof rawQuota === "object"
        ? {
            maxSizeBytes: normalizeQuotaLimit(
              (rawQuota as { maxSizeBytes?: number | null }).maxSizeBytes,
            ),
            maxObjects: normalizeQuotaLimit(
              (rawQuota as { maxObjects?: number | null }).maxObjects,
            ),
          }
        : null;
    const rawVersioning = (entry as { versioningEnabled?: unknown })
      .versioningEnabled;
    const rawObjectLock = (entry as { objectLock?: unknown }).objectLock;
    const rawPublicAccessBlock = (entry as { publicAccessBlock?: unknown })
      .publicAccessBlock;
    const rawPolicy = (entry as { policy?: unknown }).policy;
    const rawAccessLogging = (entry as { accessLogging?: unknown }).accessLogging;
    byName.set(name.toLowerCase(), {
      name,
      quota,
      versioningEnabled:
        typeof rawVersioning === "boolean" ? rawVersioning : null,
      objectLock:
        rawObjectLock && typeof rawObjectLock === "object"
          ? normalizeObjectLockSnapshot(rawObjectLock as Record<string, unknown>)
          : null,
      publicAccessBlock:
        rawPublicAccessBlock && typeof rawPublicAccessBlock === "object"
          ? normalizePublicAccessBlockState(
              rawPublicAccessBlock as Partial<PublicAccessBlockState>,
            )
          : null,
      lifecycleRules: parseRuleList(
        (entry as { lifecycleRules?: unknown }).lifecycleRules,
      ),
      corsRules: parseRuleList((entry as { corsRules?: unknown }).corsRules),
      policy:
        rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy)
          ? (rawPolicy as Record<string, unknown>)
          : null,
      accessLogging:
        rawAccessLogging && typeof rawAccessLogging === "object"
          ? normalizeAccessLoggingSnapshot(
              rawAccessLogging as Record<string, unknown>,
            )
          : null,
    });
  });
  const buckets = Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  if (buckets.length === 0) return null;

  return {
    version: 1,
    copiedAt:
      typeof parsed.copiedAt === "string" &&
      !Number.isNaN(Date.parse(parsed.copiedAt))
        ? parsed.copiedAt
        : new Date().toISOString(),
    sourceEndpointId,
    sourceEndpointName:
      typeof parsed.sourceEndpointName === "string" &&
      parsed.sourceEndpointName.trim()
        ? parsed.sourceEndpointName.trim()
        : null,
    features,
    buckets,
  };
};

export const persistBulkConfigClipboard = (
  storageKey: string,
  value: BulkConfigClipboard | null,
) => {
  if (!value) {
    removeSessionStorageKey(storageKey);
    return;
  }
  writeSessionJsonToKey(storageKey, value);
};

export const runWithConcurrencySettled = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>,
  onSettled?: (result: PromiseSettledResult<R>, index: number) => void,
): Promise<PromiseSettledResult<R>[]> => {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      try {
        const value = await handler(items[index], index);
        const result: PromiseSettledResult<R> = { status: "fulfilled", value };
        results[index] = result;
        onSettled?.(result, index);
      } catch (err) {
        const result: PromiseSettledResult<R> = {
          status: "rejected",
          reason: err,
        };
        results[index] = result;
        onSettled?.(result, index);
      }
    }
  });
  await Promise.all(workers);
  return results;
};

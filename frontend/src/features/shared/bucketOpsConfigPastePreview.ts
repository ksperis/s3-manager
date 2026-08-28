/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { runWithConcurrencySettled } from "../../utils/concurrency";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatNumber } from "../../utils/format";
import { stableStringify } from "../cephAdmin/bucketJsonParsers";
import {
  BULK_CONCURRENCY_LIMIT,
  formatObjectLockSnapshot,
  isAccessLoggingSnapshotEqual,
  isObjectLockSnapshotEqual,
  isPublicAccessBlockEquivalent,
  normalizeAccessLoggingSnapshot,
  normalizeObjectLockSnapshot,
  normalizePublicAccessBlockState,
  type BulkConfigClipboard,
  type BulkPastePlanItem,
  type BulkPreviewItem,
  type BulkPreviewLine,
  type BulkQuotaSnapshot,
} from "./bucketBulkOperationsModel";
import {
  formatCorsRule,
  formatLifecycleRule,
} from "./bucketConfigMerge";
import type { BucketOpsApi } from "./bucketOpsApi";
import {
  formatVersioningStatus,
  normalizeVersioningStatus,
} from "./bucketOpsPresentation";

type BucketOpsConfigPastePreviewApi = Pick<
  BucketOpsApi,
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketLogging"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
>;

type BucketOpsConfigPastePreviewInput = BucketOpsConfigPastePreviewApi & {
  clipboard: BulkConfigClipboard | null;
  fetchBucketQuota: (bucketName: string) => Promise<BulkQuotaSnapshot>;
  isStorageOps: boolean;
  mappings: readonly BulkPastePlanItem[];
  onProgress?: (progress: { completed: number; total: number; failed: number }) => void;
  targetEndpointId: number;
};

type PreviewSectionAppender = (
  label: string,
  beforeLines: BulkPreviewLine[],
  afterLines: BulkPreviewLine[],
) => void;

async function buildBucketConfigPastePreview({
  clipboard,
  fetchBucketQuota,
  getBucketCors,
  getBucketLifecycle,
  getBucketLogging,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  isStorageOps,
  mapping,
  targetEndpointId,
}: BucketOpsConfigPastePreviewApi & {
  clipboard: BulkConfigClipboard | null;
  fetchBucketQuota: (bucketName: string) => Promise<BulkQuotaSnapshot>;
  isStorageOps: boolean;
  mapping: BulkPastePlanItem;
  targetEndpointId: number;
}): Promise<BulkPreviewItem> {
  const features = clipboard?.features;
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
  const before: BulkPreviewLine[] = [
    { text: `Source bucket: ${mapping.sourceBucket}` },
  ];
  const after: BulkPreviewLine[] = [
    { text: `Source bucket: ${mapping.sourceBucket}` },
  ];
  const pushSection: PreviewSectionAppender = (label, beforeLines, afterLines) => {
    before.push({ text: `[${label}]` }, ...beforeLines);
    after.push({ text: `[${label}]` }, ...afterLines);
  };

  const properties = features.versioning || features.object_lock
    ? await getBucketProperties(targetEndpointId, mapping.destinationBucket)
    : null;

  if (!isStorageOps && features.quota && source.quota) {
    const currentQuota = await fetchBucketQuota(mapping.destinationBucket);
    const sectionChanged =
      currentQuota.maxSizeBytes !== source.quota.maxSizeBytes ||
      currentQuota.maxObjects !== source.quota.maxObjects;
    changed ||= sectionChanged;
    pushSection(
      "Quota",
      [
        {
          text: `Size: ${
            currentQuota.maxSizeBytes != null
              ? formatBytes(currentQuota.maxSizeBytes)
              : "Not set"
          }`,
          tone: sectionChanged ? "removed" : undefined,
        },
        {
          text: `Objects: ${
            currentQuota.maxObjects != null
              ? formatNumber(currentQuota.maxObjects)
              : "Not set"
          }`,
          tone: sectionChanged ? "removed" : undefined,
        },
      ],
      [
        {
          text: `Size: ${
            source.quota.maxSizeBytes != null
              ? formatBytes(source.quota.maxSizeBytes)
              : "Not set"
          }`,
          tone: sectionChanged ? "added" : undefined,
        },
        {
          text: `Objects: ${
            source.quota.maxObjects != null
              ? formatNumber(source.quota.maxObjects)
              : "Not set"
          }`,
          tone: sectionChanged ? "added" : undefined,
        },
      ],
    );
  }

  if (features.versioning && source.versioningEnabled !== null) {
    const currentEnabled = normalizeVersioningStatus(properties?.versioning_status);
    const sectionChanged =
      currentEnabled === null || currentEnabled !== source.versioningEnabled;
    changed ||= sectionChanged;
    pushSection(
      "Versioning",
      [
        {
          text: formatVersioningStatus(properties?.versioning_status),
          tone: sectionChanged ? "removed" : undefined,
        },
      ],
      [
        {
          text: source.versioningEnabled ? "Enabled" : "Suspended",
          tone: sectionChanged ? "added" : undefined,
        },
      ],
    );
  }

  if (features.object_lock && source.objectLock) {
    const rawCurrentObjectLock =
      properties?.object_lock && typeof properties.object_lock === "object"
        ? (properties.object_lock as Record<string, unknown>)
        : {};
    const currentObjectLock = normalizeObjectLockSnapshot({
      ...rawCurrentObjectLock,
      enabled: Boolean(
        properties?.object_lock_enabled ?? rawCurrentObjectLock.enabled,
      ),
    });
    const sectionChanged = !isObjectLockSnapshotEqual(
      currentObjectLock,
      source.objectLock,
    );
    changed ||= sectionChanged;
    pushSection(
      "Object Lock",
      [
        {
          text: formatObjectLockSnapshot(currentObjectLock),
          tone: sectionChanged ? "removed" : undefined,
        },
      ],
      [
        {
          text: formatObjectLockSnapshot(source.objectLock),
          tone: sectionChanged ? "added" : undefined,
        },
      ],
    );
  }

  if (features.public_access_block && source.publicAccessBlock) {
    const currentPublicAccessBlock = normalizePublicAccessBlockState(
      await getBucketPublicAccessBlock(
        targetEndpointId,
        mapping.destinationBucket,
      ),
    );
    const sectionChanged = !isPublicAccessBlockEquivalent(
      currentPublicAccessBlock,
      source.publicAccessBlock,
    );
    changed ||= sectionChanged;
    pushSection(
      "Block Public Access",
      [
        {
          text: JSON.stringify(currentPublicAccessBlock, null, 2),
          tone: sectionChanged ? "removed" : undefined,
        },
      ],
      [
        {
          text: JSON.stringify(source.publicAccessBlock, null, 2),
          tone: sectionChanged ? "added" : undefined,
        },
      ],
    );
  }

  if (features.lifecycle && source.lifecycleRules) {
    const currentLifecycle = (
      (await getBucketLifecycle(
        targetEndpointId,
        mapping.destinationBucket,
      )).rules ?? []
    ) as Record<string, unknown>[];
    const sectionChanged =
      stableStringify(currentLifecycle) !== stableStringify(source.lifecycleRules);
    changed ||= sectionChanged;
    pushSection(
      "Lifecycle",
      currentLifecycle.length === 0
        ? [{ text: "(no rules)" }]
        : currentLifecycle.map((rule) => ({
            text: formatLifecycleRule(rule),
            tone: sectionChanged ? "removed" : undefined,
          })),
      source.lifecycleRules.length === 0
        ? [{ text: "(no rules)" }]
        : source.lifecycleRules.map((rule) => ({
            text: formatLifecycleRule(rule),
            tone: sectionChanged ? "added" : undefined,
          })),
    );
  }

  if (features.cors && source.corsRules) {
    const currentCors = (
      (await getBucketCors(targetEndpointId, mapping.destinationBucket)).rules ?? []
    ) as Record<string, unknown>[];
    const sectionChanged =
      stableStringify(currentCors) !== stableStringify(source.corsRules);
    changed ||= sectionChanged;
    pushSection(
      "CORS",
      currentCors.length === 0
        ? [{ text: "(no rules)" }]
        : currentCors.map((rule) => ({
            text: formatCorsRule(rule),
            tone: sectionChanged ? "removed" : undefined,
          })),
      source.corsRules.length === 0
        ? [{ text: "(no rules)" }]
        : source.corsRules.map((rule) => ({
            text: formatCorsRule(rule),
            tone: sectionChanged ? "added" : undefined,
          })),
    );
  }

  if (features.policy) {
    const currentPolicy = (
      (await getBucketPolicy(targetEndpointId, mapping.destinationBucket)).policy ??
      null
    ) as Record<string, unknown> | null;
    const sectionChanged =
      stableStringify(currentPolicy) !== stableStringify(source.policy);
    changed ||= sectionChanged;
    pushSection(
      "Bucket Policy",
      [
        {
          text: currentPolicy
            ? JSON.stringify(currentPolicy, null, 2)
            : "(no policy)",
          tone: sectionChanged ? "removed" : undefined,
        },
      ],
      [
        {
          text: source.policy
            ? JSON.stringify(source.policy, null, 2)
            : "(no policy)",
          tone: sectionChanged ? "added" : undefined,
        },
      ],
    );
  }

  if (features.access_logging && source.accessLogging) {
    const currentAccessLogging = normalizeAccessLoggingSnapshot(
      (await getBucketLogging(
        targetEndpointId,
        mapping.destinationBucket,
      )) as unknown as Record<string, unknown>,
    );
    const sectionChanged = !isAccessLoggingSnapshotEqual(
      currentAccessLogging,
      source.accessLogging,
    );
    changed ||= sectionChanged;
    pushSection(
      "Access logging",
      [
        {
          text: JSON.stringify(currentAccessLogging, null, 2),
          tone: sectionChanged ? "removed" : undefined,
        },
      ],
      [
        {
          text: JSON.stringify(source.accessLogging, null, 2),
          tone: sectionChanged ? "added" : undefined,
        },
      ],
    );
  }

  return { bucket: mapping.destinationBucket, changed, before, after };
}

export async function previewBucketOpsConfigPaste({
  clipboard,
  fetchBucketQuota,
  getBucketCors,
  getBucketLifecycle,
  getBucketLogging,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  isStorageOps,
  mappings,
  onProgress,
  targetEndpointId,
}: BucketOpsConfigPastePreviewInput): Promise<BulkPreviewItem[]> {
  let completed = 0;
  let failed = 0;
  const total = mappings.length;
  const results = await runWithConcurrencySettled(
    [...mappings],
    BULK_CONCURRENCY_LIMIT,
    async (mapping) =>
      buildBucketConfigPastePreview({
        clipboard,
        fetchBucketQuota,
        getBucketCors,
        getBucketLifecycle,
        getBucketLogging,
        getBucketPolicy,
        getBucketProperties,
        getBucketPublicAccessBlock,
        isStorageOps,
        mapping,
        targetEndpointId,
      }),
    (result) => {
      completed += 1;
      if (result.status === "rejected") failed += 1;
      onProgress?.({ completed: Math.min(total, completed), total, failed });
    },
  );

  return results.map((result, index) => {
    const mapping = mappings[index];
    if (result.status === "fulfilled") return result.value;
    const error = extractApiError(result.reason, "Unexpected error");
    return {
      bucket: mapping.destinationBucket,
      before: [
        { text: `Source bucket: ${mapping.sourceBucket}` },
        { text: "Preview failed." },
      ],
      after: [
        { text: `Source bucket: ${mapping.sourceBucket}` },
        { text: "Preview failed." },
      ],
      changed: false,
      error,
    };
  });
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { runWithConcurrencySettled } from "../../utils/concurrency";
import {
  BULK_CONCURRENCY_LIMIT,
  BULK_COPY_FEATURE_LABELS,
  normalizeAccessLoggingSnapshot,
  normalizeObjectLockSnapshot,
  normalizePublicAccessBlockState,
  type BulkConfigClipboard,
  type BulkConfigClipboardBucket,
  type BulkCopyFeatureKey,
  type BulkCopyFeatureSelection,
  type BulkQuotaSnapshot,
} from "./bucketBulkOperationsModel";
import type { BucketOpsApi } from "./bucketOpsApi";
import { normalizeVersioningStatus } from "./bucketOpsPresentation";

type BucketOpsConfigCopyApi = Pick<
  BucketOpsApi,
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketLogging"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
>;

type BucketOpsConfigCopyInput = BucketOpsConfigCopyApi & {
  bucketNames: readonly string[];
  copiedAt: string;
  features: BulkCopyFeatureSelection;
  fetchBucketQuota: (bucketName: string) => Promise<BulkQuotaSnapshot>;
  isStorageOps: boolean;
  onProgress?: (progress: { completed: number; total: number; failed: number }) => void;
  sourceEndpointId: number;
  sourceEndpointName: string | null;
};

type BucketOpsConfigCopyResult =
  | { kind: "error"; error: string }
  | { kind: "success"; clipboard: BulkConfigClipboard; summary: string };

export async function copyBucketOpsConfigs({
  bucketNames,
  copiedAt,
  features,
  fetchBucketQuota,
  getBucketCors,
  getBucketLifecycle,
  getBucketLogging,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  isStorageOps,
  onProgress,
  sourceEndpointId,
  sourceEndpointName,
}: BucketOpsConfigCopyInput): Promise<BucketOpsConfigCopyResult> {
  const selectedFeatures = (Object.keys(features) as BulkCopyFeatureKey[]).filter(
    (feature) => features[feature] && (!isStorageOps || feature !== "quota"),
  );
  if (selectedFeatures.length === 0) {
    return { kind: "error", error: "Select at least one configuration to copy." };
  }

  let completed = 0;
  let failed = 0;
  const total = bucketNames.length;
  const results = await runWithConcurrencySettled(
    [...bucketNames],
    BULK_CONCURRENCY_LIMIT,
    async (bucketName): Promise<BulkConfigClipboardBucket> => {
      const properties = features.versioning || features.object_lock
        ? await getBucketProperties(sourceEndpointId, bucketName)
        : null;
      const rawObjectLock =
        properties?.object_lock && typeof properties.object_lock === "object"
          ? (properties.object_lock as Record<string, unknown>)
          : {};
      return {
        name: bucketName,
        quota: !isStorageOps && features.quota
          ? await fetchBucketQuota(bucketName)
          : null,
        versioningEnabled: features.versioning
          ? normalizeVersioningStatus(properties?.versioning_status) === true
          : null,
        objectLock: features.object_lock
          ? normalizeObjectLockSnapshot({
              ...rawObjectLock,
              enabled: Boolean(properties?.object_lock_enabled ?? rawObjectLock.enabled),
            })
          : null,
        publicAccessBlock: features.public_access_block
          ? normalizePublicAccessBlockState(
              await getBucketPublicAccessBlock(sourceEndpointId, bucketName),
            )
          : null,
        lifecycleRules: features.lifecycle
          ? ((await getBucketLifecycle(sourceEndpointId, bucketName)).rules ?? []) as Record<string, unknown>[]
          : null,
        corsRules: features.cors
          ? ((await getBucketCors(sourceEndpointId, bucketName)).rules ?? []) as Record<string, unknown>[]
          : null,
        policy: features.policy
          ? (((await getBucketPolicy(sourceEndpointId, bucketName)).policy ?? null) as Record<string, unknown> | null)
          : null,
        accessLogging: features.access_logging
          ? normalizeAccessLoggingSnapshot(
              (await getBucketLogging(sourceEndpointId, bucketName)) as unknown as Record<string, unknown>,
            )
          : null,
      };
    },
    (result) => {
      completed += 1;
      if (result.status === "rejected") failed += 1;
      onProgress?.({ completed: Math.min(total, completed), total, failed });
    },
  );

  if (failed > 0) {
    return {
      kind: "error",
      error: `${failed} source bucket(s) failed while copying configs.`,
    };
  }
  const copiedBuckets = results
    .filter(
      (result): result is PromiseFulfilledResult<BulkConfigClipboardBucket> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .sort((left, right) => left.name.localeCompare(right.name));
  if (copiedBuckets.length === 0) {
    return { kind: "error", error: "No source bucket configuration could be copied." };
  }

  const clipboard: BulkConfigClipboard = {
    version: 1,
    copiedAt,
    sourceEndpointId,
    sourceEndpointName,
    features: {
      ...features,
      quota: !isStorageOps && features.quota,
    },
    buckets: copiedBuckets,
  };
  const featureLabelText = selectedFeatures
    .map((feature) => BULK_COPY_FEATURE_LABELS[feature])
    .join(", ");
  return {
    kind: "success",
    clipboard,
    summary: `Copied ${featureLabelText} from ${copiedBuckets.length} bucket(s).`,
  };
}

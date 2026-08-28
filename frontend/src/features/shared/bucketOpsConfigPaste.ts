/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { stableStringify } from "../cephAdmin/bucketJsonParsers";
import {
  bytesToGiB,
  isAccessLoggingSnapshotEqual,
  isObjectLockSnapshotEqual,
  isPublicAccessBlockEquivalent,
  normalizeAccessLoggingSnapshot,
  normalizeObjectLockSnapshot,
  normalizePublicAccessBlockState,
  type BulkConfigClipboard,
  type BulkPastePlanItem,
  type BulkQuotaSnapshot,
} from "./bucketBulkOperationsModel";
import {
  runBucketMutationBatch,
  type BucketMutationBatchResult,
} from "./bucketOpsBulkExecution";
import type { BucketOpsApi } from "./bucketOpsApi";
import { normalizeVersioningStatus } from "./bucketOpsPresentation";

type BucketOpsConfigPasteApi = Pick<
  BucketOpsApi,
  | "deleteBucketCors"
  | "deleteBucketLifecycle"
  | "deleteBucketLogging"
  | "deleteBucketPolicy"
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketLogging"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
  | "putBucketCors"
  | "putBucketLifecycle"
  | "putBucketLogging"
  | "putBucketPolicy"
  | "setBucketVersioning"
  | "updateBucketObjectLock"
  | "updateBucketPublicAccessBlock"
  | "updateBucketQuota"
>;

type BucketOpsConfigPasteProgress = {
  completed: number;
  total: number;
  failed: number;
};

type BucketOpsConfigPasteInput = BucketOpsConfigPasteApi & {
  clipboard: BulkConfigClipboard | null;
  fetchBucketQuota: (bucketName: string) => Promise<BulkQuotaSnapshot>;
  isStorageOps: boolean;
  mappings: readonly BulkPastePlanItem[];
  onProgress?: (progress: BucketOpsConfigPasteProgress) => void;
  targetEndpointId: number;
};

export async function applyBucketOpsConfigPaste({
  clipboard,
  deleteBucketCors,
  deleteBucketLifecycle,
  deleteBucketLogging,
  deleteBucketPolicy,
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
  putBucketCors,
  putBucketLifecycle,
  putBucketLogging,
  putBucketPolicy,
  setBucketVersioning,
  targetEndpointId,
  updateBucketObjectLock,
  updateBucketPublicAccessBlock,
  updateBucketQuota,
}: BucketOpsConfigPasteInput): Promise<BucketMutationBatchResult> {
  return runBucketMutationBatch({
    items: mappings,
    onProgress,
    mutate: async (mapping) => {
      const features = clipboard?.features;
      if (!features) {
        throw new Error("Copied configuration is no longer available.");
      }
      const source = mapping.sourceConfig;
      let changed = false;

      const properties = features.versioning || features.object_lock
        ? await getBucketProperties(targetEndpointId, mapping.destinationBucket)
        : null;

      if (!isStorageOps && features.quota && source.quota && updateBucketQuota) {
        const currentQuota = await fetchBucketQuota(mapping.destinationBucket);
        const quotaChanged =
          currentQuota.maxSizeBytes !== source.quota.maxSizeBytes ||
          currentQuota.maxObjects !== source.quota.maxObjects;
        if (quotaChanged) {
          const maxSizeGiB = source.quota.maxSizeBytes != null
            ? bytesToGiB(source.quota.maxSizeBytes)
            : null;
          await updateBucketQuota(targetEndpointId, mapping.destinationBucket, {
            max_size_gb: maxSizeGiB,
            max_size_unit: maxSizeGiB != null ? "GiB" : null,
            max_objects: source.quota.maxObjects,
          });
          changed = true;
        }
      }

      if (features.versioning && source.versioningEnabled !== null) {
        const currentEnabled = normalizeVersioningStatus(properties?.versioning_status);
        if (currentEnabled === null || currentEnabled !== source.versioningEnabled) {
          await setBucketVersioning(
            targetEndpointId,
            mapping.destinationBucket,
            source.versioningEnabled,
          );
          changed = true;
        }
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
        if (!isObjectLockSnapshotEqual(currentObjectLock, source.objectLock)) {
          await updateBucketObjectLock(
            targetEndpointId,
            mapping.destinationBucket,
            source.objectLock,
          );
          changed = true;
        }
      }

      if (features.public_access_block && source.publicAccessBlock) {
        const currentPublicAccessBlock = normalizePublicAccessBlockState(
          await getBucketPublicAccessBlock(
            targetEndpointId,
            mapping.destinationBucket,
          ),
        );
        if (
          !isPublicAccessBlockEquivalent(
            currentPublicAccessBlock,
            source.publicAccessBlock,
          )
        ) {
          await updateBucketPublicAccessBlock(
            targetEndpointId,
            mapping.destinationBucket,
            source.publicAccessBlock,
          );
          changed = true;
        }
      }

      if (features.lifecycle && source.lifecycleRules) {
        const currentLifecycle = (
          (await getBucketLifecycle(
            targetEndpointId,
            mapping.destinationBucket,
          )).rules ?? []
        ) as Record<string, unknown>[];
        if (stableStringify(currentLifecycle) !== stableStringify(source.lifecycleRules)) {
          if (source.lifecycleRules.length === 0) {
            if (currentLifecycle.length > 0) {
              await deleteBucketLifecycle(
                targetEndpointId,
                mapping.destinationBucket,
              );
              changed = true;
            }
          } else {
            await putBucketLifecycle(
              targetEndpointId,
              mapping.destinationBucket,
              source.lifecycleRules,
            );
            changed = true;
          }
        }
      }

      if (features.cors && source.corsRules) {
        const currentCors = (
          (await getBucketCors(targetEndpointId, mapping.destinationBucket)).rules ?? []
        ) as Record<string, unknown>[];
        if (stableStringify(currentCors) !== stableStringify(source.corsRules)) {
          if (source.corsRules.length === 0) {
            if (currentCors.length > 0) {
              await deleteBucketCors(targetEndpointId, mapping.destinationBucket);
              changed = true;
            }
          } else {
            await putBucketCors(
              targetEndpointId,
              mapping.destinationBucket,
              source.corsRules,
            );
            changed = true;
          }
        }
      }

      if (features.policy) {
        const currentPolicy = (
          (await getBucketPolicy(targetEndpointId, mapping.destinationBucket)).policy ??
          null
        ) as Record<string, unknown> | null;
        if (stableStringify(currentPolicy) !== stableStringify(source.policy)) {
          if (!source.policy) {
            if (currentPolicy) {
              await deleteBucketPolicy(targetEndpointId, mapping.destinationBucket);
              changed = true;
            }
          } else {
            await putBucketPolicy(
              targetEndpointId,
              mapping.destinationBucket,
              source.policy,
            );
            changed = true;
          }
        }
      }

      if (features.access_logging && source.accessLogging) {
        const currentAccessLogging = normalizeAccessLoggingSnapshot(
          (await getBucketLogging(
            targetEndpointId,
            mapping.destinationBucket,
          )) as unknown as Record<string, unknown>,
        );
        if (!isAccessLoggingSnapshotEqual(currentAccessLogging, source.accessLogging)) {
          if (!source.accessLogging.enabled || !source.accessLogging.target_bucket) {
            if (currentAccessLogging.enabled || currentAccessLogging.target_bucket) {
              await deleteBucketLogging(targetEndpointId, mapping.destinationBucket);
              changed = true;
            }
          } else {
            await putBucketLogging(targetEndpointId, mapping.destinationBucket, {
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
  });
}

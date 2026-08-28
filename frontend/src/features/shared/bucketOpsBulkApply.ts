/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  deleteNotificationConfigurations,
  isNotificationConfigurationEmpty,
  mergeNotificationConfigurations,
} from "../cephAdmin/bucketJsonParsers";
import {
  applyPublicAccessBlockTargets,
  bytesToGiB,
  hasConfiguredQuota,
  isPublicAccessBlockEquivalent,
  normalizePublicAccessBlockState,
  type BulkOperation,
  type BulkQuotaSnapshot,
} from "./bucketBulkOperationsModel";
import {
  getCorsRuleTypes,
  getLifecycleRuleId,
  getLifecycleRuleTypes,
  getPolicyStatementSid,
  getPolicyStatementTypes,
  mergeCorsRules,
  mergeLifecycleRules,
  mergePolicyStatements,
} from "./bucketConfigMerge";
import type { BucketOpsApi } from "./bucketOpsApi";
import type { PreparedBucketOpsBulkInput } from "./bucketOpsBulkInput";
import {
  runBucketMutationBatch,
  type BucketMutationBatchResult,
} from "./bucketOpsBulkExecution";
import { normalizeVersioningStatus } from "./bucketOpsPresentation";

type BucketOpsBulkApplyApi = Pick<
  BucketOpsApi,
  | "deleteBucketCors"
  | "deleteBucketLifecycle"
  | "deleteBucketNotifications"
  | "deleteBucketPolicy"
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketNotifications"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
  | "putBucketCors"
  | "putBucketLifecycle"
  | "putBucketNotifications"
  | "putBucketPolicy"
  | "setBucketVersioning"
  | "updateBucketPublicAccessBlock"
  | "updateBucketQuota"
>;

type BucketOpsBulkApplyInput = BucketOpsBulkApplyApi & {
  bucketNames: readonly string[];
  corsUpdateOnlyExisting: boolean;
  endpointId: number;
  fetchBucketQuota: (bucketName: string) => Promise<BulkQuotaSnapshot>;
  lifecycleUpdateOnlyExisting: boolean;
  onProgress?: (progress: { completed: number; total: number; failed: number }) => void;
  operation: BulkOperation;
  policyUpdateOnlyExisting: boolean;
  prepared: PreparedBucketOpsBulkInput;
  quotaSkipConfigured: boolean;
};

export async function applyBucketOpsBulkUpdate({
  bucketNames,
  corsUpdateOnlyExisting,
  deleteBucketCors,
  deleteBucketLifecycle,
  deleteBucketNotifications,
  deleteBucketPolicy,
  endpointId,
  fetchBucketQuota,
  getBucketCors,
  getBucketLifecycle,
  getBucketNotifications,
  getBucketPolicy,
  getBucketProperties,
  getBucketPublicAccessBlock,
  lifecycleUpdateOnlyExisting,
  onProgress,
  operation,
  policyUpdateOnlyExisting,
  prepared,
  putBucketCors,
  putBucketLifecycle,
  putBucketNotifications,
  putBucketPolicy,
  quotaSkipConfigured,
  setBucketVersioning,
  updateBucketPublicAccessBlock,
  updateBucketQuota,
}: BucketOpsBulkApplyInput): Promise<BucketMutationBatchResult> {
  const {
    deleteCorsIds,
    deleteCorsTypes,
    deleteIds,
    deleteNotificationIds,
    deleteNotificationTypes,
    deletePolicyIds,
    deletePolicyTypes,
    deleteTypes,
    parsedCorsRules,
    parsedNotificationConfiguration,
    parsedPolicy,
    parsedPolicyStatements,
    parsedQuota,
    parsedRules,
    publicAccessBlockTargets,
  } = prepared;
  const desiredEnabled = operation === "enable_versioning";
  const desiredPublicAccessBlockEnabled = operation === "add_public_access_block";

  return runBucketMutationBatch({
    items: bucketNames,
    onProgress,
    mutate: async (bucketName) => {
      if (operation === "set_quota" && parsedQuota && updateBucketQuota) {
        const currentQuota = await fetchBucketQuota(bucketName);
        if (quotaSkipConfigured && hasConfiguredQuota(currentQuota)) {
          return { changed: false };
        }
        const nextSize = parsedQuota.applySize
          ? parsedQuota.maxSizeBytes
          : currentQuota.maxSizeBytes;
        const nextObjects = parsedQuota.applyObjects
          ? parsedQuota.maxObjects
          : currentQuota.maxObjects;
        if (
          currentQuota.maxSizeBytes === nextSize &&
          currentQuota.maxObjects === nextObjects
        ) {
          return { changed: false };
        }
        const payloadSize =
          nextSize != null
            ? parsedQuota.applySize && parsedQuota.maxSizeValue != null
              ? parsedQuota.maxSizeValue
              : bytesToGiB(nextSize)
            : null;
        const payloadUnit =
          nextSize != null
            ? parsedQuota.applySize && parsedQuota.maxSizeValue != null
              ? parsedQuota.maxSizeUnit
              : "GiB"
            : null;
        await updateBucketQuota(endpointId, bucketName, {
          max_size_gb: payloadSize,
          max_size_unit: payloadUnit,
          max_objects: nextObjects,
        });
        return { changed: true };
      }

      if (
        (operation === "add_public_access_block" ||
          operation === "remove_public_access_block") &&
        publicAccessBlockTargets
      ) {
        const current = normalizePublicAccessBlockState(
          await getBucketPublicAccessBlock(endpointId, bucketName),
        );
        const target = applyPublicAccessBlockTargets(
          current,
          desiredPublicAccessBlockEnabled,
          publicAccessBlockTargets,
        );
        if (isPublicAccessBlockEquivalent(current, target)) {
          return { changed: false };
        }
        await updateBucketPublicAccessBlock(endpointId, bucketName, target);
        return { changed: true };
      }

      if (operation === "enable_versioning" || operation === "disable_versioning") {
        const properties = await getBucketProperties(endpointId, bucketName);
        const currentEnabled = normalizeVersioningStatus(
          properties.versioning_status,
        );
        if (currentEnabled !== null && currentEnabled === desiredEnabled) {
          return { changed: false };
        }
        await setBucketVersioning(endpointId, bucketName, desiredEnabled);
        return { changed: true };
      }

      if (operation === "add_lifecycle" && parsedRules) {
        const lifecycle = await getBucketLifecycle(endpointId, bucketName);
        const existingRules = lifecycle.rules ?? [];
        const { nextRules, changes } = mergeLifecycleRules(
          existingRules as Record<string, unknown>[],
          parsedRules,
          { onlyUpdateExisting: lifecycleUpdateOnlyExisting },
        );
        if (changes.length === 0) return { changed: false };
        await putBucketLifecycle(endpointId, bucketName, nextRules);
        return { changed: true };
      }

      if (operation === "delete_lifecycle" && deleteIds && deleteTypes) {
        const lifecycle = await getBucketLifecycle(endpointId, bucketName);
        const existingRules = lifecycle.rules ?? [];
        const nextRules = existingRules.filter((rule) => {
          const record = rule as Record<string, unknown>;
          const ruleId = getLifecycleRuleId(record);
          if (ruleId && deleteIds.has(ruleId)) return false;
          if (deleteTypes.size === 0) return true;
          return !getLifecycleRuleTypes(record).some((type) =>
            deleteTypes.has(type),
          );
        }) as Record<string, unknown>[];
        if (nextRules.length === existingRules.length) return { changed: false };
        if (nextRules.length === 0) {
          await deleteBucketLifecycle(endpointId, bucketName);
        } else {
          await putBucketLifecycle(endpointId, bucketName, nextRules);
        }
        return { changed: true };
      }

      if (operation === "add_notifications" && parsedNotificationConfiguration) {
        const notifications = await getBucketNotifications(endpointId, bucketName);
        const { configuration, changes } = mergeNotificationConfigurations(
          notifications.configuration ?? {},
          parsedNotificationConfiguration,
        );
        if (changes.length === 0) return { changed: false };
        await putBucketNotifications(endpointId, bucketName, configuration);
        return { changed: true };
      }

      if (
        operation === "delete_notifications" &&
        deleteNotificationIds &&
        deleteNotificationTypes
      ) {
        const notifications = await getBucketNotifications(endpointId, bucketName);
        const { configuration, changes } = deleteNotificationConfigurations(
          notifications.configuration ?? {},
          deleteNotificationIds,
          deleteNotificationTypes,
        );
        if (changes.length === 0) return { changed: false };
        if (isNotificationConfigurationEmpty(configuration)) {
          await deleteBucketNotifications(endpointId, bucketName);
        } else {
          await putBucketNotifications(endpointId, bucketName, configuration);
        }
        return { changed: true };
      }

      if (operation === "add_cors" && parsedCorsRules) {
        const cors = await getBucketCors(endpointId, bucketName);
        const existingRules = cors.rules ?? [];
        const { nextRules, changes } = mergeCorsRules(
          existingRules as Record<string, unknown>[],
          parsedCorsRules,
          { onlyUpdateExisting: corsUpdateOnlyExisting },
        );
        if (changes.length === 0) return { changed: false };
        await putBucketCors(endpointId, bucketName, nextRules);
        return { changed: true };
      }

      if (operation === "delete_cors" && deleteCorsIds && deleteCorsTypes) {
        const cors = await getBucketCors(endpointId, bucketName);
        const existingRules = cors.rules ?? [];
        const nextRules = existingRules.filter((rule) => {
          const record = rule as Record<string, unknown>;
          const ruleId = getLifecycleRuleId(record);
          if (ruleId && deleteCorsIds.has(ruleId)) return false;
          if (deleteCorsTypes.size === 0) return true;
          return !getCorsRuleTypes(record).some((type) =>
            deleteCorsTypes.has(type),
          );
        }) as Record<string, unknown>[];
        if (nextRules.length === existingRules.length) return { changed: false };
        if (nextRules.length === 0) {
          await deleteBucketCors(endpointId, bucketName);
        } else {
          await putBucketCors(endpointId, bucketName, nextRules);
        }
        return { changed: true };
      }

      if (operation === "add_policy" && parsedPolicyStatements) {
        const policy = await getBucketPolicy(endpointId, bucketName);
        const existingPolicy = policy.policy ?? {};
        const existingStatements = Array.isArray(
          (existingPolicy as Record<string, unknown>).Statement,
        )
          ? ((existingPolicy as Record<string, unknown>)
              .Statement as Record<string, unknown>[])
          : [];
        const { nextStatements, changes } = mergePolicyStatements(
          existingStatements,
          parsedPolicyStatements,
          { onlyUpdateExisting: policyUpdateOnlyExisting },
        );
        if (changes.length === 0) return { changed: false };
        await putBucketPolicy(endpointId, bucketName, {
          ...(Object.keys(existingPolicy).length > 0
            ? (existingPolicy as Record<string, unknown>)
            : (parsedPolicy ?? {})),
          Statement: nextStatements,
        });
        return { changed: true };
      }

      if (operation === "delete_policy" && deletePolicyIds && deletePolicyTypes) {
        const policy = await getBucketPolicy(endpointId, bucketName);
        const existingPolicy = policy.policy ?? {};
        const existingStatements = Array.isArray(
          (existingPolicy as Record<string, unknown>).Statement,
        )
          ? ((existingPolicy as Record<string, unknown>)
              .Statement as Record<string, unknown>[])
          : [];
        const nextStatements = existingStatements.filter((statement) => {
          const sid = getPolicyStatementSid(statement);
          if (sid && deletePolicyIds.has(sid)) return false;
          if (deletePolicyTypes.size === 0) return true;
          return !getPolicyStatementTypes(statement).some((type) =>
            deletePolicyTypes.has(type),
          );
        });
        if (nextStatements.length === existingStatements.length) {
          return { changed: false };
        }
        if (nextStatements.length === 0) {
          await deleteBucketPolicy(endpointId, bucketName);
        } else {
          await putBucketPolicy(endpointId, bucketName, {
            ...(existingPolicy as Record<string, unknown>),
            Statement: nextStatements,
          });
        }
        return { changed: true };
      }

      return { changed: false };
    },
  });
}

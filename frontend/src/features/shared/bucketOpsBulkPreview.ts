/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatBytes, formatNumber } from "../../utils/format";
import {
  deleteNotificationConfigurations,
  mergeNotificationConfigurations,
} from "../cephAdmin/bucketJsonParsers";
import {
  PUBLIC_ACCESS_BLOCK_OPTIONS,
  applyPublicAccessBlockTargets,
  formatPublicAccessBlockFlag,
  formatPublicAccessBlockState,
  hasConfiguredQuota,
  isPublicAccessBlockEquivalent,
  normalizePublicAccessBlockState,
  type BulkOperation,
  type BulkPreviewItem,
  type BulkPreviewLine,
  type BulkQuotaSnapshot,
} from "./bucketBulkOperationsModel";
import {
  formatCorsRule,
  formatLifecycleRule,
  formatNotificationConfiguration,
  formatPolicyRule,
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
import { runBucketPreviewBatch } from "./bucketOpsBulkPreviewExecution";
import {
  formatVersioningStatus,
  normalizeVersioningStatus,
} from "./bucketOpsPresentation";

type BucketOpsBulkPreviewApi = Pick<
  BucketOpsApi,
  | "getBucketCors"
  | "getBucketLifecycle"
  | "getBucketNotifications"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketPublicAccessBlock"
>;

type BucketOpsBulkPreviewInput = BucketOpsBulkPreviewApi & {
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

export async function previewBucketOpsBulkUpdate({
  bucketNames,
  corsUpdateOnlyExisting,
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
  quotaSkipConfigured,
}: BucketOpsBulkPreviewInput): Promise<BulkPreviewItem[]> {
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
    parsedPolicyStatements,
    parsedQuota,
    parsedRules,
    publicAccessBlockTargets,
  } = prepared;
  const desiredEnabled = operation === "enable_versioning";
  const desiredPublicAccessBlockEnabled = operation === "add_public_access_block";

  const buildVersioningPreview = async (bucketName: string) => {
    const properties = await getBucketProperties(endpointId, bucketName);
    const currentStatus = formatVersioningStatus(properties.versioning_status);
    const currentEnabled = normalizeVersioningStatus(properties.versioning_status);
    const changed = currentEnabled === null || currentEnabled !== desiredEnabled;
    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: currentStatus,
          tone: changed && currentEnabled !== null ? "removed" as const : undefined,
        },
      ],
      after: [
        {
          text: changed
            ? desiredEnabled
              ? "Enabled"
              : "Suspended"
            : currentStatus,
          tone: changed ? "added" as const : undefined,
        },
      ],
    };
  };

  const buildPublicAccessBlockPreview = async (bucketName: string) => {
    const current = normalizePublicAccessBlockState(
      await getBucketPublicAccessBlock(endpointId, bucketName),
    );
    const target = applyPublicAccessBlockTargets(
      current,
      desiredPublicAccessBlockEnabled,
      publicAccessBlockTargets ?? [],
    );
    const changed = !isPublicAccessBlockEquivalent(current, target);
    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: `State: ${formatPublicAccessBlockState(current)}`,
          tone: changed ? "removed" as const : undefined,
        },
        ...PUBLIC_ACCESS_BLOCK_OPTIONS.map((option): BulkPreviewLine => ({
          text: `${option.label}: ${formatPublicAccessBlockFlag(current[option.key])}`,
          tone:
            current[option.key] !== target[option.key] ? "removed" : undefined,
        })),
      ],
      after: [
        {
          text: `State: ${formatPublicAccessBlockState(target)}`,
          tone: changed ? "added" as const : undefined,
        },
        ...PUBLIC_ACCESS_BLOCK_OPTIONS.map((option): BulkPreviewLine => ({
          text: `${option.label}: ${formatPublicAccessBlockFlag(target[option.key])}`,
          tone: current[option.key] !== target[option.key] ? "added" : undefined,
        })),
      ],
    };
  };

  const buildQuotaPreview = async (bucketName: string): Promise<BulkPreviewItem> => {
    if (!parsedQuota) {
      return { bucket: bucketName, changed: false, before: [], after: [] };
    }
    const currentQuota = await fetchBucketQuota(bucketName);
    const sizeText = (value: number | null) =>
      value != null ? formatBytes(value) : "Not set";
    const objectsText = (value: number | null) =>
      value != null ? formatNumber(value) : "Not set";
    if (quotaSkipConfigured && hasConfiguredQuota(currentQuota)) {
      return {
        bucket: bucketName,
        changed: false,
        before: [
          { text: `Size: ${sizeText(currentQuota.maxSizeBytes)}` },
          { text: `Objects: ${objectsText(currentQuota.maxObjects)}` },
        ],
        after: [
          { text: `Size: ${sizeText(currentQuota.maxSizeBytes)}` },
          { text: `Objects: ${objectsText(currentQuota.maxObjects)}` },
          { text: "(existing quota preserved)" },
        ],
      };
    }
    const afterSize = parsedQuota.applySize
      ? parsedQuota.maxSizeBytes
      : currentQuota.maxSizeBytes;
    const afterObjects = parsedQuota.applyObjects
      ? parsedQuota.maxObjects
      : currentQuota.maxObjects;
    const sizeChanged = currentQuota.maxSizeBytes !== afterSize;
    const objectsChanged = currentQuota.maxObjects !== afterObjects;
    return {
      bucket: bucketName,
      changed: sizeChanged || objectsChanged,
      before: [
        {
          text: `Size: ${sizeText(currentQuota.maxSizeBytes)}`,
          tone: sizeChanged ? "removed" : undefined,
        },
        {
          text: `Objects: ${objectsText(currentQuota.maxObjects)}`,
          tone: objectsChanged ? "removed" : undefined,
        },
      ],
      after: [
        {
          text: `Size: ${sizeText(afterSize)}`,
          tone: sizeChanged ? "added" : undefined,
        },
        {
          text: `Objects: ${objectsText(afterObjects)}`,
          tone: objectsChanged ? "added" : undefined,
        },
      ],
    };
  };

  const buildRuleMergePreview = async (
    bucketName: string,
    kind: "lifecycle" | "cors",
  ): Promise<BulkPreviewItem> => {
    const existingRules = kind === "lifecycle"
      ? ((await getBucketLifecycle(endpointId, bucketName)).rules ?? [])
      : ((await getBucketCors(endpointId, bucketName)).rules ?? []);
    const incomingRules = kind === "lifecycle" ? parsedRules : parsedCorsRules;
    const formatRule = kind === "lifecycle" ? formatLifecycleRule : formatCorsRule;
    const { nextRules, changes } = kind === "lifecycle"
      ? mergeLifecycleRules(
          existingRules as Record<string, unknown>[],
          incomingRules ?? [],
          { onlyUpdateExisting: lifecycleUpdateOnlyExisting },
        )
      : mergeCorsRules(
          existingRules as Record<string, unknown>[],
          incomingRules ?? [],
          { onlyUpdateExisting: corsUpdateOnlyExisting },
        );
    const emptyText = "(no rules)";
    return {
      bucket: bucketName,
      changed: changes.length > 0,
      before:
        existingRules.length === 0
          ? [{ text: emptyText }]
          : existingRules.map((rule, index) => ({
              text: formatRule(rule as Record<string, unknown>),
              tone: changes.some(
                (change) => change.action === "replace" && change.index === index,
              )
                ? "removed" as const
                : undefined,
            })),
      after:
        nextRules.length === 0
          ? [{ text: emptyText }]
          : nextRules.map((rule, index) => ({
              text: formatRule(rule as Record<string, unknown>),
              tone: changes.some(
                (change) =>
                  (change.action === "replace" || change.action === "add") &&
                  change.index === index,
              )
                ? "added" as const
                : undefined,
            })),
    };
  };

  const buildRuleDeletePreview = async (
    bucketName: string,
    kind: "lifecycle" | "cors",
  ): Promise<BulkPreviewItem> => {
    const existingRules = kind === "lifecycle"
      ? ((await getBucketLifecycle(endpointId, bucketName)).rules ?? [])
      : ((await getBucketCors(endpointId, bucketName)).rules ?? []);
    const ids = kind === "lifecycle" ? deleteIds : deleteCorsIds;
    const types = kind === "lifecycle" ? deleteTypes : deleteCorsTypes;
    const formatRule = kind === "lifecycle" ? formatLifecycleRule : formatCorsRule;
    const removedIndices = new Set<number>();
    existingRules.forEach((rule, index) => {
      const record = rule as Record<string, unknown>;
      const ruleId = getLifecycleRuleId(record);
      const typeMatch = kind === "lifecycle"
        ? getLifecycleRuleTypes(record).some((type) => deleteTypes?.has(type))
        : getCorsRuleTypes(record).some((type) => deleteCorsTypes?.has(type));
      if ((ruleId && ids?.has(ruleId)) || ((types?.size ?? 0) > 0 && typeMatch)) {
        removedIndices.add(index);
      }
    });
    const nextRules = existingRules.filter((_, index) => !removedIndices.has(index));
    return {
      bucket: bucketName,
      changed: removedIndices.size > 0,
      before:
        existingRules.length === 0
          ? [{ text: "(no rules)" }]
          : existingRules.map((rule, index) => ({
              text: formatRule(rule as Record<string, unknown>),
              tone: removedIndices.has(index) ? "removed" as const : undefined,
            })),
      after:
        nextRules.length === 0
          ? [{ text: "(no rules)" }]
          : nextRules.map((rule) => ({
              text: formatRule(rule as Record<string, unknown>),
            })),
    };
  };

  const buildNotificationsPreview = async (
    bucketName: string,
    deleting: boolean,
  ): Promise<BulkPreviewItem> => {
    const notifications = await getBucketNotifications(endpointId, bucketName);
    const currentConfiguration = notifications.configuration ?? {};
    const result = deleting
      ? deleteNotificationConfigurations(
          currentConfiguration,
          deleteNotificationIds ?? new Set(),
          deleteNotificationTypes ?? new Set(),
        )
      : mergeNotificationConfigurations(
          currentConfiguration,
          parsedNotificationConfiguration ?? {},
        );
    const changed = result.changes.length > 0;
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
          text: formatNotificationConfiguration(result.configuration),
          tone: changed ? "added" : undefined,
        },
      ],
    };
  };

  const buildPolicyMergePreview = async (
    bucketName: string,
  ): Promise<BulkPreviewItem> => {
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
      parsedPolicyStatements ?? [],
      { onlyUpdateExisting: policyUpdateOnlyExisting },
    );
    return {
      bucket: bucketName,
      changed: changes.length > 0,
      before:
        existingStatements.length === 0
          ? [{ text: "(no statements)" }]
          : existingStatements.map((statement, index) => ({
              text: formatPolicyRule(statement),
              tone: changes.some(
                (change) => change.action === "replace" && change.index === index,
              )
                ? "removed" as const
                : undefined,
            })),
      after:
        nextStatements.length === 0
          ? [{ text: "(no statements)" }]
          : nextStatements.map((statement, index) => ({
              text: formatPolicyRule(statement),
              tone: changes.some(
                (change) =>
                  (change.action === "replace" || change.action === "add") &&
                  change.index === index,
              )
                ? "added" as const
                : undefined,
            })),
    };
  };

  const buildPolicyDeletePreview = async (
    bucketName: string,
  ): Promise<BulkPreviewItem> => {
    const policy = await getBucketPolicy(endpointId, bucketName);
    const existingPolicy = policy.policy ?? {};
    const existingStatements = Array.isArray(
      (existingPolicy as Record<string, unknown>).Statement,
    )
      ? ((existingPolicy as Record<string, unknown>)
          .Statement as Record<string, unknown>[])
      : [];
    const removedIndices = new Set<number>();
    existingStatements.forEach((statement, index) => {
      const sid = getPolicyStatementSid(statement);
      const typeMatch = getPolicyStatementTypes(statement).some((type) =>
        deletePolicyTypes?.has(type),
      );
      if (
        (sid && deletePolicyIds?.has(sid)) ||
        ((deletePolicyTypes?.size ?? 0) > 0 && typeMatch)
      ) {
        removedIndices.add(index);
      }
    });
    const nextStatements = existingStatements.filter(
      (_, index) => !removedIndices.has(index),
    );
    return {
      bucket: bucketName,
      changed: removedIndices.size > 0,
      before:
        existingStatements.length === 0
          ? [{ text: "(no statements)" }]
          : existingStatements.map((statement, index) => ({
              text: formatPolicyRule(statement),
              tone: removedIndices.has(index) ? "removed" as const : undefined,
            })),
      after:
        nextStatements.length === 0
          ? [{ text: "(no statements)" }]
          : nextStatements.map((statement) => ({
              text: formatPolicyRule(statement),
            })),
    };
  };

  return runBucketPreviewBatch({
    items: bucketNames,
    onProgress,
    preview: async (bucketName) => {
      switch (operation) {
        case "set_quota":
          return buildQuotaPreview(bucketName);
        case "add_public_access_block":
        case "remove_public_access_block":
          return buildPublicAccessBlockPreview(bucketName);
        case "enable_versioning":
        case "disable_versioning":
          return buildVersioningPreview(bucketName);
        case "add_lifecycle":
          return buildRuleMergePreview(bucketName, "lifecycle");
        case "delete_lifecycle":
          return buildRuleDeletePreview(bucketName, "lifecycle");
        case "add_notifications":
          return buildNotificationsPreview(bucketName, false);
        case "delete_notifications":
          return buildNotificationsPreview(bucketName, true);
        case "add_cors":
          return buildRuleMergePreview(bucketName, "cors");
        case "delete_cors":
          return buildRuleDeletePreview(bucketName, "cors");
        case "add_policy":
          return buildPolicyMergePreview(bucketName);
        case "delete_policy":
          return buildPolicyDeletePreview(bucketName);
        default:
          return {
            bucket: bucketName,
            before: [{ text: "-" }],
            after: [{ text: "-" }],
            changed: false,
          };
      }
    },
    buildFailure: (bucketName, error) => ({
      bucket: bucketName,
      before: [{ text: "Preview failed." }],
      after: [{ text: "Preview failed." }],
      changed: false,
      error,
    }),
  });
}

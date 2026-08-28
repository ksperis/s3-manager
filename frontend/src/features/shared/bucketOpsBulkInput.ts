/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  parseCorsRules,
  parseLifecycleRules,
  parseNotificationConfiguration,
  parsePolicyStatements,
  parseRuleIds,
  type NotificationConfigurationTypeKey,
} from "../cephAdmin/bucketJsonParsers";
import {
  CORS_TYPE_OPTIONS,
  LIFECYCLE_TYPE_OPTIONS,
  NOTIFICATION_TYPE_OPTIONS,
  POLICY_TYPE_OPTIONS,
  getCorsRuleKey,
  getLifecycleRuleId,
  type CorsRuleTypeKey,
  type LifecycleRuleTypeKey,
  type PolicyRuleTypeKey,
} from "./bucketConfigMerge";
import {
  PUBLIC_ACCESS_BLOCK_OPTIONS,
  parseQuotaInput,
  type BulkOperation,
  type ParsedQuotaInput,
  type PublicAccessBlockOptionKey,
  type QuotaSizeUnit,
} from "./bucketBulkOperationsModel";

type OptionSelection<Key extends string> = Partial<Record<Key, boolean>>;

export type BucketOpsBulkInput = {
  operation: BulkOperation;
  quota: {
    applyObjects: boolean;
    applySize: boolean;
    objects: string;
    sizeUnit: QuotaSizeUnit;
    sizeValue: string;
  };
  lifecycle: {
    deleteIds: string;
    deleteTypes: OptionSelection<LifecycleRuleTypeKey>;
    ruleText: string;
    updateOnlyExisting: boolean;
  };
  notifications: {
    configurationText: string;
    deleteIds: string;
    deleteTypes: OptionSelection<NotificationConfigurationTypeKey>;
  };
  cors: {
    deleteIds: string;
    deleteTypes: OptionSelection<CorsRuleTypeKey>;
    ruleText: string;
    updateOnlyExisting: boolean;
  };
  policy: {
    deleteIds: string;
    deleteTypes: OptionSelection<PolicyRuleTypeKey>;
    policyText: string;
    updateOnlyExisting: boolean;
  };
  publicAccessBlockTargets: OptionSelection<PublicAccessBlockOptionKey>;
};

type PreparedBucketOpsBulkInput = {
  parsedQuota: ParsedQuotaInput | null;
  parsedRules: Record<string, unknown>[] | null;
  parsedNotificationConfiguration: Record<string, unknown> | null;
  parsedCorsRules: Record<string, unknown>[] | null;
  parsedPolicyStatements: Record<string, unknown>[] | null;
  parsedPolicy: Record<string, unknown> | null;
  deleteIds: Set<string> | null;
  deleteTypes: Set<LifecycleRuleTypeKey> | null;
  deleteNotificationIds: Set<string> | null;
  deleteNotificationTypes: Set<NotificationConfigurationTypeKey> | null;
  deleteCorsIds: Set<string> | null;
  deleteCorsTypes: Set<CorsRuleTypeKey> | null;
  deletePolicyIds: Set<string> | null;
  deletePolicyTypes: Set<PolicyRuleTypeKey> | null;
  publicAccessBlockTargets: PublicAccessBlockOptionKey[] | null;
};

type PreparedBucketOpsBulkInputResult =
  | { kind: "error"; error: string }
  | { kind: "success"; value: PreparedBucketOpsBulkInput };

const emptyPreparedInput = (): PreparedBucketOpsBulkInput => ({
  parsedQuota: null,
  parsedRules: null,
  parsedNotificationConfiguration: null,
  parsedCorsRules: null,
  parsedPolicyStatements: null,
  parsedPolicy: null,
  deleteIds: null,
  deleteTypes: null,
  deleteNotificationIds: null,
  deleteNotificationTypes: null,
  deleteCorsIds: null,
  deleteCorsTypes: null,
  deletePolicyIds: null,
  deletePolicyTypes: null,
  publicAccessBlockTargets: null,
});

function selectedOptionKeys<Key extends string>(
  options: readonly { key: Key }[],
  selection: OptionSelection<Key>,
): Key[] {
  return options.filter((option) => selection[option.key]).map((option) => option.key);
}

export function prepareBucketOpsBulkInput(
  input: BucketOpsBulkInput,
): PreparedBucketOpsBulkInputResult {
  const value = emptyPreparedInput();

  switch (input.operation) {
    case "set_quota": {
      const parsed = parseQuotaInput(
        input.quota.sizeValue,
        input.quota.sizeUnit,
        input.quota.objects,
        input.quota.applySize,
        input.quota.applyObjects,
      );
      if ("error" in parsed) return { kind: "error", error: parsed.error };
      value.parsedQuota = parsed;
      break;
    }
    case "add_lifecycle": {
      const parsed = parseLifecycleRules(input.lifecycle.ruleText);
      if ("error" in parsed) return { kind: "error", error: parsed.error };
      if (
        input.lifecycle.updateOnlyExisting &&
        parsed.rules.every((rule) => !getLifecycleRuleId(rule))
      ) {
        return {
          kind: "error",
          error: "Provide rule IDs when 'only update existing' is enabled.",
        };
      }
      value.parsedRules = parsed.rules;
      break;
    }
    case "delete_lifecycle": {
      const ids = parseRuleIds(input.lifecycle.deleteIds);
      const types = selectedOptionKeys(
        LIFECYCLE_TYPE_OPTIONS,
        input.lifecycle.deleteTypes,
      );
      if (ids.length === 0 && types.length === 0) {
        return {
          kind: "error",
          error: "Provide at least one rule ID or rule type.",
        };
      }
      value.deleteIds = new Set(ids);
      value.deleteTypes = new Set(types);
      break;
    }
    case "add_notifications": {
      const parsed = parseNotificationConfiguration(
        input.notifications.configurationText,
      );
      if ("error" in parsed) return { kind: "error", error: parsed.error };
      value.parsedNotificationConfiguration = parsed.configuration;
      break;
    }
    case "delete_notifications": {
      const ids = parseRuleIds(input.notifications.deleteIds);
      const types = selectedOptionKeys(
        NOTIFICATION_TYPE_OPTIONS,
        input.notifications.deleteTypes,
      );
      if (ids.length === 0 && types.length === 0) {
        return {
          kind: "error",
          error: "Provide at least one notification ID or notification type.",
        };
      }
      value.deleteNotificationIds = new Set(ids);
      value.deleteNotificationTypes = new Set(types);
      break;
    }
    case "add_cors": {
      const parsed = parseCorsRules(input.cors.ruleText);
      if ("error" in parsed) return { kind: "error", error: parsed.error };
      if (
        input.cors.updateOnlyExisting &&
        parsed.rules.every(
          (rule) => !getLifecycleRuleId(rule) && !getCorsRuleKey(rule),
        )
      ) {
        return {
          kind: "error",
          error:
            "Provide rule IDs or matching origins/methods when 'only update existing' is enabled.",
        };
      }
      value.parsedCorsRules = parsed.rules;
      break;
    }
    case "delete_cors": {
      const ids = parseRuleIds(input.cors.deleteIds);
      const types = selectedOptionKeys(CORS_TYPE_OPTIONS, input.cors.deleteTypes);
      if (ids.length === 0 && types.length === 0) {
        return {
          kind: "error",
          error: "Provide at least one rule ID or rule type.",
        };
      }
      value.deleteCorsIds = new Set(ids);
      value.deleteCorsTypes = new Set(types);
      break;
    }
    case "add_policy": {
      const parsed = parsePolicyStatements(input.policy.policyText);
      if ("error" in parsed) return { kind: "error", error: parsed.error };
      value.parsedPolicyStatements = parsed.statements;
      value.parsedPolicy = parsed.policy as Record<string, unknown>;
      break;
    }
    case "delete_policy": {
      const ids = parseRuleIds(input.policy.deleteIds);
      const types = selectedOptionKeys(
        POLICY_TYPE_OPTIONS,
        input.policy.deleteTypes,
      );
      if (ids.length === 0 && types.length === 0) {
        return {
          kind: "error",
          error: "Provide at least one statement ID or statement type.",
        };
      }
      value.deletePolicyIds = new Set(ids);
      value.deletePolicyTypes = new Set(types);
      break;
    }
    case "add_public_access_block":
    case "remove_public_access_block": {
      const targets = selectedOptionKeys(
        PUBLIC_ACCESS_BLOCK_OPTIONS,
        input.publicAccessBlockTargets,
      );
      if (targets.length === 0) {
        return {
          kind: "error",
          error: "Select at least one block public access option.",
        };
      }
      value.publicAccessBlockTargets = targets;
      break;
    }
    default:
      break;
  }

  return { kind: "success", value };
}

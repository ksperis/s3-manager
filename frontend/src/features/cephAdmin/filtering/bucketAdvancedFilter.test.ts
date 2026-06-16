import { describe, expect, it } from "vitest";

import {
  buildFeatureDetailRules,
  defaultFeatureDetailFilters,
  featureDetailSummary,
  hasFeatureDetailFilters,
  sanitizeFeatureDetailFilters,
} from "./bucketAdvancedFilter";

describe("bucketAdvancedFilter", () => {
  it("builds lifecycle rules with quantifier for missing named rule", () => {
    const rules = buildFeatureDetailRules({
      ...defaultFeatureDetailFilters,
      lifecycleRuleNameMode: "has_not_named",
      lifecycleRuleName: "archive-rule",
    });

    expect(rules).toEqual([
      {
        feature: "lifecycle_rules",
        param: "lifecycle_rule_id",
        op: "eq",
        value: "archive-rule",
        quantifier: "none",
      },
    ]);
  });

  it("builds mixed feature-parameter rules", () => {
    const rules = buildFeatureDetailRules({
      ...defaultFeatureDetailFilters,
      lifecycleRuleTypeMode: "has",
      lifecycleRuleTypeValue: "expiration",
      lifecycleExpirationDaysOp: ">=",
      lifecycleExpirationDays: "30",
      lifecycleNoncurrentExpirationDaysOp: "=",
      lifecycleNoncurrentExpirationDays: "14",
      lifecycleTransitionDaysOp: "<=",
      lifecycleTransitionDays: "60",
      lifecycleAbortDaysOp: ">=",
      lifecycleAbortDays: "7",
      objectLockMode: "GOVERNANCE",
      objectLockRetentionDays: "30",
      objectLockRetentionYearsOp: "=",
      objectLockRetentionYears: "1",
      bpaBlockPublicAcls: "true",
      corsMethodMode: "has",
      corsMethodValue: "GET",
      loggingEnabled: "true",
      loggingTargetPrefix: "logs/",
      websiteIndexPresent: "true",
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "error.html",
      websiteRedirectHost: "example.test",
      websiteRoutingRuleCountOp: ">=",
      websiteRoutingRuleCount: "1",
      policyStatementOp: ">=",
      policyStatementCount: "2",
      policyHasConditions: "true",
      notificationRuleId: "topic-created",
      notificationRuleTypeMode: "has",
      notificationRuleTypeValue: "topic",
      notificationTopicName: "bucket-events",
      notificationEventMode: "has",
      notificationEventValue: "s3:ObjectCreated:*",
      notificationFilterPrefixMode: "has",
      notificationFilterPrefixValue: "incoming/",
      notificationFilterSuffixMode: "has_not",
      notificationFilterSuffixValue: ".tmp",
      notificationEventBridgePresent: "true",
      sseAlgorithm: "aws:kms",
      sseKmsKeyId: "audit-key",
    });

    expect(rules).toEqual(
      expect.arrayContaining([
        { feature: "lifecycle_rules", param: "lifecycle_rule_type", op: "has", value: "expiration" },
        { feature: "lifecycle_rules", param: "lifecycle_expiration_days", op: "gte", value: 30 },
        { feature: "lifecycle_rules", param: "lifecycle_noncurrent_expiration_days", op: "eq", value: 14 },
        { feature: "lifecycle_rules", param: "lifecycle_transition_days", op: "lte", value: 60 },
        { feature: "lifecycle_rules", param: "lifecycle_abort_multipart_days", op: "gte", value: 7 },
        { feature: "object_lock", param: "object_lock_mode", op: "eq", value: "GOVERNANCE" },
        { feature: "object_lock", param: "object_lock_retention_days", op: "gte", value: 30 },
        { feature: "object_lock", param: "object_lock_retention_years", op: "eq", value: 1 },
        { feature: "block_public_access", param: "bpa_block_public_acls", op: "eq", value: true },
        { feature: "cors", param: "cors_allowed_method", op: "has", value: "GET" },
        { feature: "access_logging", param: "logging_enabled", op: "eq", value: true },
        { feature: "access_logging", param: "logging_target_prefix", op: "contains", value: "logs/" },
        { feature: "static_website", param: "website_index_present", op: "eq", value: true },
        { feature: "static_website", param: "website_index_document", op: "contains", value: "index.html" },
        { feature: "static_website", param: "website_error_document", op: "contains", value: "error.html" },
        { feature: "static_website", param: "website_redirect_host", op: "contains", value: "example.test" },
        { feature: "static_website", param: "website_routing_rule_count", op: "gte", value: 1 },
        { feature: "bucket_policy", param: "policy_statement_count", op: "gte", value: 2 },
        { feature: "bucket_policy", param: "policy_has_conditions", op: "eq", value: true },
        { feature: "notifications", param: "notification_rule_id", op: "contains", value: "topic-created" },
        { feature: "notifications", param: "notification_rule_type", op: "has", value: "topic" },
        { feature: "notifications", param: "notification_topic_name", op: "contains", value: "bucket-events" },
        { feature: "notifications", param: "notification_event", op: "has", value: "s3:ObjectCreated:*" },
        { feature: "notifications", param: "notification_filter_prefix", op: "has", value: "incoming/" },
        { feature: "notifications", param: "notification_filter_suffix", op: "has_not", value: ".tmp" },
        { feature: "notifications", param: "notification_eventbridge_present", op: "eq", value: true },
        { feature: "server_side_encryption", param: "sse_algorithm", op: "contains", value: "aws:kms" },
        { feature: "server_side_encryption", param: "sse_kms_key_id", op: "contains", value: "audit-key" },
      ])
    );
  });

  it("detects active feature detail filters", () => {
    expect(hasFeatureDetailFilters(defaultFeatureDetailFilters)).toBe(false);
    expect(
      hasFeatureDetailFilters({
        ...defaultFeatureDetailFilters,
        loggingTargetBucket: "audit-logs",
      })
    ).toBe(true);
  });

  it("sanitizes invalid persisted state", () => {
    const sanitized = sanitizeFeatureDetailFilters({
      lifecycleRuleNameMode: "invalid",
      lifecycleRuleName: 123,
      lifecycleRuleTypeMode: "wrong",
      lifecycleRuleTypeValue: "transition",
      lifecycleExpirationDaysOp: "??",
      lifecycleExpirationDays: 10,
      objectLockRetentionYearsOp: "??",
      objectLockRetentionYears: 1,
      bpaBlockPublicAcls: "true",
      websiteRoutingRuleCountOp: "??",
      websiteRoutingRuleCount: 2,
      policyStatementOp: "??",
      policyStatementCount: 8,
      notificationRuleTypeMode: "bad",
      notificationRuleTypeValue: "topic",
      notificationEventMode: "has_not",
      notificationFilterPrefixMode: "wrong",
      notificationEventBridgePresent: "false",
    });

    expect(sanitized.lifecycleRuleNameMode).toBe("any");
    expect(sanitized.lifecycleRuleName).toBe("");
    expect(sanitized.lifecycleRuleTypeMode).toBe("any");
    expect(sanitized.lifecycleRuleTypeValue).toBe("transition");
    expect(sanitized.lifecycleExpirationDaysOp).toBe("=");
    expect(sanitized.lifecycleExpirationDays).toBe("");
    expect(sanitized.objectLockRetentionYearsOp).toBe(">=");
    expect(sanitized.objectLockRetentionYears).toBe("");
    expect(sanitized.bpaBlockPublicAcls).toBe("true");
    expect(sanitized.websiteRoutingRuleCountOp).toBe(">=");
    expect(sanitized.websiteRoutingRuleCount).toBe("");
    expect(sanitized.policyStatementOp).toBe(">=");
    expect(sanitized.policyStatementCount).toBe("");
    expect(sanitized.notificationRuleTypeMode).toBe("any");
    expect(sanitized.notificationRuleTypeValue).toBe("topic");
    expect(sanitized.notificationEventMode).toBe("has_not");
    expect(sanitized.notificationFilterPrefixMode).toBe("any");
    expect(sanitized.notificationEventBridgePresent).toBe("false");
  });

  it("returns readable summary labels", () => {
    const labels = featureDetailSummary({
      ...defaultFeatureDetailFilters,
      lifecycleRuleNameMode: "has_named",
      lifecycleRuleName: "archive",
      lifecycleRuleTypeMode: "has_not",
      lifecycleRuleTypeValue: "abort_multipart",
      lifecycleExpirationDaysOp: ">=",
      lifecycleExpirationDays: "30",
      loggingEnabled: "false",
      loggingTargetPrefix: "logs/",
      websiteIndexDocument: "index.html",
      websiteRoutingRuleCount: "1",
      policyStatementCount: "3",
      policyStatementOp: ">=",
      notificationTopicName: "archive-topic",
      notificationEventMode: "has",
      notificationEventValue: "s3:ObjectRestore:*",
      notificationEventBridgePresent: "true",
      sseAlgorithm: "aws:kms",
    });

    expect(labels).toEqual(
      expect.arrayContaining([
        "Lifecycle rule name: archive",
        "Lifecycle rule type has_not: Abort incomplete multipart uploads",
        "Lifecycle expiration days >= 30",
        "Logging enabled: false",
        "Logging target prefix contains: logs/",
        "Website index document contains: index.html",
        "Website routing rules >= 1",
        "Policy statements >= 3",
        "Notification topic contains: archive-topic",
        "Notification event has: s3:ObjectRestore:*",
        "Notification EventBridge present: true",
        "SSE algorithm contains: aws:kms",
      ])
    );
  });

  it("builds lifecycle rule type negation", () => {
    const rules = buildFeatureDetailRules({
      ...defaultFeatureDetailFilters,
      lifecycleRuleTypeMode: "has_not",
      lifecycleRuleTypeValue: "transition",
    });

    expect(rules).toEqual([
      {
        feature: "lifecycle_rules",
        param: "lifecycle_rule_type",
        op: "has_not",
        value: "transition",
      },
    ]);
  });

  it("omits notification detail rules when notifications are unsupported", () => {
    const rules = buildFeatureDetailRules(
      {
        ...defaultFeatureDetailFilters,
        notificationTopicName: "archive-topic",
        notificationEventBridgePresent: "true",
        lifecycleRuleStatus: "Disabled",
      },
      { notifications: false }
    );

    expect(rules).toEqual([
      {
        feature: "lifecycle_rules",
        param: "lifecycle_rule_status",
        op: "eq",
        value: "Disabled",
      },
    ]);
    expect(
      hasFeatureDetailFilters(
        {
          ...defaultFeatureDetailFilters,
          notificationTopicName: "archive-topic",
        },
        { notifications: false }
      )
    ).toBe(false);
  });

  it("omits SSE detail rules when server-side encryption is unsupported", () => {
    const rules = buildFeatureDetailRules(
      {
        ...defaultFeatureDetailFilters,
        sseAlgorithm: "aws:kms",
        sseKmsKeyId: "audit-key",
        lifecycleRuleStatus: "Disabled",
      },
      { server_side_encryption: false }
    );

    expect(rules).toEqual([
      {
        feature: "lifecycle_rules",
        param: "lifecycle_rule_status",
        op: "eq",
        value: "Disabled",
      },
    ]);
    expect(
      hasFeatureDetailFilters(
        {
          ...defaultFeatureDetailFilters,
          sseAlgorithm: "aws:kms",
        },
        { server_side_encryption: false }
      )
    ).toBe(false);
  });
});

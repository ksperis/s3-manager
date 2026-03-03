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
      bpaBlockPublicAcls: "true",
      corsMethodMode: "has",
      corsMethodValue: "GET",
      loggingEnabled: "true",
      websiteIndexPresent: "true",
      policyStatementOp: ">=",
      policyStatementCount: "2",
      policyHasConditions: "true",
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
        { feature: "block_public_access", param: "bpa_block_public_acls", op: "eq", value: true },
        { feature: "cors", param: "cors_allowed_method", op: "has", value: "GET" },
        { feature: "access_logging", param: "logging_enabled", op: "eq", value: true },
        { feature: "static_website", param: "website_index_present", op: "eq", value: true },
        { feature: "bucket_policy", param: "policy_statement_count", op: "gte", value: 2 },
        { feature: "bucket_policy", param: "policy_has_conditions", op: "eq", value: true },
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
      bpaBlockPublicAcls: "true",
      policyStatementOp: "??",
      policyStatementCount: 8,
    });

    expect(sanitized.lifecycleRuleNameMode).toBe("any");
    expect(sanitized.lifecycleRuleName).toBe("");
    expect(sanitized.lifecycleRuleTypeMode).toBe("any");
    expect(sanitized.lifecycleRuleTypeValue).toBe("transition");
    expect(sanitized.lifecycleExpirationDaysOp).toBe("=");
    expect(sanitized.lifecycleExpirationDays).toBe("");
    expect(sanitized.bpaBlockPublicAcls).toBe("true");
    expect(sanitized.policyStatementOp).toBe(">=");
    expect(sanitized.policyStatementCount).toBe("");
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
      policyStatementCount: "3",
      policyStatementOp: ">=",
    });

    expect(labels).toEqual(
      expect.arrayContaining([
        "Lifecycle rule name: archive",
        "Lifecycle rule type has_not: Abort incomplete multipart uploads",
        "Lifecycle expiration days >= 30",
        "Logging enabled: false",
        "Policy statements >= 3",
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
});

import { describe, expect, it } from "vitest";

import {
  buildAdvancedFilterPayload,
  hasAdvancedFilters,
  sanitizeAdvancedFilter,
  type AdvancedFilterState,
} from "./BucketOpsWorkbench";

const baseAdvancedFilter = (): AdvancedFilterState => sanitizeAdvancedFilter({});

describe("BucketOpsWorkbench advanced filter storage-ops fields", () => {
  it("filters UI tags by physical bucket identity in storage-ops mode", () => {
    const rawPayload = buildAdvancedFilterPayload("", "contains", null, ["physical-7", "physical-8"], true);
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual([
      { field: "bucket_identity", op: "in", value: ["physical-7", "physical-8"] },
    ]);
  });

  it("emits selected context id rules in storage-ops mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      contextIds: ["1", "conn-2"],
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, true);
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(expect.arrayContaining([{ field: "context_id", op: "in", value: ["1", "conn-2"] }]));
    expect(payload.rules).not.toEqual(expect.arrayContaining([{ field: "context_name", op: expect.any(String) }]));
  });

  it("emits selected context and endpoint rules in storage-ops mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      contextIds: ["1"],
      endpointNames: ["Primary Endpoint", "Archive Endpoint"],
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, true);
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(
      expect.arrayContaining([
        { field: "context_id", op: "eq", value: "1" },
        { field: "endpoint_name", op: "in", value: ["Primary Endpoint", "Archive Endpoint"] },
      ])
    );
    expect(payload.rules).not.toEqual(expect.arrayContaining([{ field: "context_name", op: expect.any(String) }]));
    expect(payload.rules).not.toEqual(expect.arrayContaining([{ field: "context_kind", op: expect.any(String) }]));
  });

  it("does not emit storage-ops identity rules in ceph-admin mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      contextIds: ["1"],
      endpointNames: ["Archive Endpoint"],
    };

    const payload = buildAdvancedFilterPayload("", "contains", advanced, null, false);
    expect(payload).toBeUndefined();
  });

  it("counts storage-ops identity rules as active only in storage-ops mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      endpointNames: ["Archive Endpoint"],
    };

    expect(hasAdvancedFilters(advanced, true)).toBe(true);
    expect(hasAdvancedFilters(advanced, false)).toBe(false);
  });

  it("sanitizes persisted selected context ids and endpoint names", () => {
    const sanitized = sanitizeAdvancedFilter({
      contextIds: ["1", "conn-2", "1", "", 8],
      endpointNames: ["Primary Endpoint", "Archive Endpoint", "Primary Endpoint", "", 7],
    });

    expect(sanitized.contextIds).toEqual(["1", "conn-2"]);
    expect(sanitized.endpointNames).toEqual(["Primary Endpoint", "Archive Endpoint"]);
  });

  it("serializes owner quota and owner usage filters with the correct backend fields", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      minQuotaUsageSizePercent: "70",
      maxQuotaUsageObjectPercent: "98",
      minOwnerQuotaBytes: "1024",
      maxOwnerQuotaObjects: "50",
      minOwnerUsedBytes: "900",
      maxOwnerQuotaUsageSizePercent: "95",
      minOwnerQuotaUsageObjectPercent: "80",
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, false, true);
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(
      expect.arrayContaining([
        { field: "quota_usage_size_percent", op: "gte", value: 70 },
        { field: "quota_usage_object_percent", op: "lte", value: 98 },
        { field: "owner_quota_max_size_bytes", op: "gte", value: 1024 },
        { field: "owner_quota_max_objects", op: "lte", value: 50 },
        { field: "owner_used_bytes", op: "gte", value: 900 },
        { field: "owner_quota_usage_size_percent", op: "lte", value: 95 },
        { field: "owner_quota_usage_object_percent", op: "gte", value: 80 },
      ])
    );
  });

  it("keeps owner quota filters active even when stats filters are disabled", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      minOwnerQuotaBytes: "2048",
      minOwnerUsedBytes: "1024",
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, false, false);
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(
      expect.arrayContaining([{ field: "owner_quota_max_size_bytes", op: "gte", value: 2048 }])
    );
    expect(payload.rules).not.toEqual(
      expect.arrayContaining([{ field: "owner_used_bytes", op: "gte", value: 1024 }])
    );
    expect(hasAdvancedFilters(advanced, false, false)).toBe(true);
  });

  it("serializes owner suspended filters as boolean backend rules", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      ownerSuspended: "true",
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, false, true);
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(
      expect.arrayContaining([{ field: "owner_suspended", op: "eq", value: true }])
    );
    expect(hasAdvancedFilters(advanced, false, true)).toBe(true);
  });

  it("serializes notifications feature state only when the feature is supported", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      features: {
        ...baseAdvancedFilter().features,
        notifications: "enabled",
      },
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, false, true, {
      notifications: true,
    });
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(expect.arrayContaining([{ feature: "notifications", state: "enabled" }]));
    expect(hasAdvancedFilters(advanced, false, true, { notifications: true })).toBe(true);
    expect(buildAdvancedFilterPayload("", "contains", advanced, null, false, true, { notifications: false })).toBeUndefined();
    expect(hasAdvancedFilters(advanced, false, true, { notifications: false })).toBe(false);
  });

  it("serializes disabled lifecycle rule status as a feature-detail rule", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      featureDetails: {
        ...baseAdvancedFilter().featureDetails,
        lifecycleRuleStatus: "Disabled",
      },
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, false, true);
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(
      expect.arrayContaining([
        { feature: "lifecycle_rules", param: "lifecycle_rule_status", op: "eq", value: "Disabled" },
      ])
    );
    expect(hasAdvancedFilters(advanced, false, true)).toBe(true);
  });

  it("serializes notification feature-detail filters only when notifications are supported", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      featureDetails: {
        ...baseAdvancedFilter().featureDetails,
        notificationTopicName: "bucket-events",
        notificationEventMode: "has",
        notificationEventValue: "s3:ObjectCreated:*",
        notificationEventBridgePresent: "true",
      },
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, false, true, {
      notifications: true,
    });
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(
      expect.arrayContaining([
        { feature: "notifications", param: "notification_topic_name", op: "contains", value: "bucket-events" },
        { feature: "notifications", param: "notification_event", op: "has", value: "s3:ObjectCreated:*" },
        { feature: "notifications", param: "notification_eventbridge_present", op: "eq", value: true },
      ])
    );
    expect(hasAdvancedFilters(advanced, false, true, { notifications: true })).toBe(true);
    expect(buildAdvancedFilterPayload("", "contains", advanced, null, false, true, { notifications: false })).toBeUndefined();
    expect(hasAdvancedFilters(advanced, false, true, { notifications: false })).toBe(false);
  });

  it("serializes audit feature-detail filters with server-side encryption support", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      featureDetails: {
        ...baseAdvancedFilter().featureDetails,
        objectLockRetentionYears: "1",
        loggingTargetPrefix: "logs/",
        websiteIndexDocument: "index.html",
        websiteErrorDocument: "error.html",
        websiteRedirectHost: "example.test",
        websiteRoutingRuleCount: "2",
        sseAlgorithm: "aws:kms",
        sseKmsKeyId: "audit-key",
      },
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, false, true, {
      server_side_encryption: true,
    });
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(
      expect.arrayContaining([
        { feature: "object_lock", param: "object_lock_retention_years", op: "gte", value: 1 },
        { feature: "access_logging", param: "logging_target_prefix", op: "contains", value: "logs/" },
        { feature: "static_website", param: "website_index_document", op: "contains", value: "index.html" },
        { feature: "static_website", param: "website_error_document", op: "contains", value: "error.html" },
        { feature: "static_website", param: "website_redirect_host", op: "contains", value: "example.test" },
        { feature: "static_website", param: "website_routing_rule_count", op: "gte", value: 2 },
        { feature: "server_side_encryption", param: "sse_algorithm", op: "contains", value: "aws:kms" },
        { feature: "server_side_encryption", param: "sse_kms_key_id", op: "contains", value: "audit-key" },
      ])
    );
    expect(hasAdvancedFilters(advanced, false, true, { server_side_encryption: true })).toBe(true);
    expect(buildAdvancedFilterPayload("", "contains", advanced, null, false, true, { server_side_encryption: false })).toBeTruthy();
    expect(
      JSON.parse(
        buildAdvancedFilterPayload("", "contains", advanced, null, false, true, { server_side_encryption: false }) ?? "{}"
      ).rules
    ).not.toEqual(expect.arrayContaining([{ feature: "server_side_encryption", param: "sse_algorithm", op: "contains", value: "aws:kms" }]));
  });

  it("sanitizes persisted owner quota fields", () => {
    const sanitized = sanitizeAdvancedFilter({
      minQuotaUsageSizePercent: "71",
      maxQuotaUsageObjectPercent: "92",
      minOwnerQuotaBytes: "123",
      maxOwnerQuotaObjects: "45",
      minOwnerQuotaUsageSizePercent: "88",
    });

    expect(sanitized.minQuotaUsageSizePercent).toBe("71");
    expect(sanitized.maxQuotaUsageObjectPercent).toBe("92");
    expect(sanitized.minOwnerQuotaBytes).toBe("123");
    expect(sanitized.maxOwnerQuotaObjects).toBe("45");
    expect(sanitized.minOwnerQuotaUsageSizePercent).toBe("88");
  });

  it("sanitizes persisted owner suspended filter state", () => {
    expect(sanitizeAdvancedFilter({ ownerSuspended: "false" }).ownerSuspended).toBe("false");
    expect(sanitizeAdvancedFilter({ ownerSuspended: "maybe" }).ownerSuspended).toBe("any");
  });
});

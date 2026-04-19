import { describe, expect, it } from "vitest";

import {
  buildAdvancedFilterPayload,
  hasAdvancedFilters,
  sanitizeAdvancedFilter,
  type AdvancedFilterState,
} from "./BucketOpsWorkbench";

const baseAdvancedFilter = (): AdvancedFilterState => sanitizeAdvancedFilter({});

describe("BucketOpsWorkbench advanced filter storage-ops fields", () => {
  it("emits context/kind/endpoint rules in storage-ops mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      context: "Account A",
      contextMatchMode: "contains",
      kind: "account",
      endpoint: "Primary Endpoint",
      endpointMatchMode: "exact",
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, true);
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(
      expect.arrayContaining([
        { field: "context_name", op: "contains", value: "Account A" },
        { field: "context_kind", op: "eq", value: "account" },
        { field: "endpoint_name", op: "eq", value: "Primary Endpoint" },
      ])
    );
  });

  it("does not emit storage-ops identity rules in ceph-admin mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      context: "Account A",
      kind: "connection",
      endpoint: "Archive Endpoint",
    };

    const payload = buildAdvancedFilterPayload("", "contains", advanced, null, false);
    expect(payload).toBeUndefined();
  });

  it("counts storage-ops identity rules as active only in storage-ops mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      context: "Account A",
      kind: "account",
    };

    expect(hasAdvancedFilters(advanced, true)).toBe(true);
    expect(hasAdvancedFilters(advanced, false)).toBe(false);
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
});

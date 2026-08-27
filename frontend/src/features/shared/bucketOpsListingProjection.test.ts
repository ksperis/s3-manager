import { describe, expect, it } from "vitest";
import { defaultAdvancedFilter } from "./bucketOpsAdvancedFilterModel";
import { buildBucketOpsListingProjection } from "./bucketOpsListingProjection";

function buildProjection(
  overrides: Partial<Parameters<typeof buildBucketOpsListingProjection>[0]> = {},
) {
  return buildBucketOpsListingProjection({
    advancedApplied: null,
    featureColumnIds: ["versioning", "object_lock"],
    isStorageOps: false,
    sortField: "name",
    usageFeatureEnabled: true,
    visibleColumns: [],
    ...overrides,
  });
}

describe("buildBucketOpsListingProjection", () => {
  it("builds one de-duplicated include contract for listing and export", () => {
    const projection = buildProjection({
      visibleColumns: [
        "owner_name",
        "owner_suspended",
        "owner_quota_max_size_bytes",
        "owner_used_bytes",
        "tags",
        "versioning",
        "object_lock_mode",
      ],
    });

    expect(projection.includeParams).toEqual([
      "owner_name",
      "owner_suspended",
      "owner_quota",
      "owner_quota_usage",
      "tags",
      "versioning",
      "object_lock_mode",
    ]);
  });

  it("keeps Ceph Admin base stats while separating visible detail needs", () => {
    const projection = buildProjection();

    expect(projection.baseRequiresStats).toBe(true);
    expect(projection.requiresStats).toBe(false);
    expect(projection.exportWithStats).toBe(true);
  });

  it("requests Storage Ops stats only for server-side filters or sorts", () => {
    const visibleOnly = buildProjection({
      isStorageOps: true,
      visibleColumns: ["used_bytes"],
    });
    const ownerQuotaOnly = buildProjection({
      advancedApplied: {
        ...defaultAdvancedFilter,
        minOwnerQuotaBytes: "1",
      },
      isStorageOps: true,
    });
    const ownerUsage = buildProjection({
      advancedApplied: {
        ...defaultAdvancedFilter,
        minOwnerUsedBytes: "1",
      },
      isStorageOps: true,
    });
    const statsSort = buildProjection({
      isStorageOps: true,
      sortField: "object_count",
    });

    expect(visibleOnly).toMatchObject({
      baseRequiresStats: false,
      exportWithStats: true,
      requiresStats: true,
    });
    expect(ownerQuotaOnly).toMatchObject({
      baseRequiresStats: false,
      requiresStats: false,
    });
    expect(ownerUsage).toMatchObject({
      baseRequiresStats: true,
      requiresStats: true,
    });
    expect(statsSort.baseRequiresStats).toBe(true);
  });

  it("disables every stats projection when endpoint metrics are unavailable", () => {
    const projection = buildProjection({
      advancedApplied: {
        ...defaultAdvancedFilter,
        minUsedBytes: "1",
        minOwnerUsedBytes: "1",
      },
      isStorageOps: true,
      sortField: "used_bytes",
      usageFeatureEnabled: false,
      visibleColumns: ["used_bytes", "quota_status"],
    });

    expect(projection).toMatchObject({
      baseRequiresStats: false,
      exportWithStats: false,
      requiresStats: false,
    });
  });

  it("identifies fields populated by the secondary detail request", () => {
    const projection = buildProjection({
      isStorageOps: true,
      visibleColumns: [
        "used_bytes",
        "owner_quota_max_objects",
        "owner_suspended",
      ],
    });

    expect(projection.detailLoadingColumnIds).toEqual(
      new Set([
        "owner_suspended",
        "owner_quota",
        "used_bytes",
        "object_count",
        "quota_max_size_bytes",
        "quota_max_objects",
        "quota_usage_size_percent",
        "quota_usage_object_percent",
        "owner_used_bytes",
        "owner_object_count",
        "owner_quota_usage_size_percent",
        "owner_quota_usage_object_percent",
        "quota_status",
        "owner_quota_max_objects",
      ]),
    );
  });
});

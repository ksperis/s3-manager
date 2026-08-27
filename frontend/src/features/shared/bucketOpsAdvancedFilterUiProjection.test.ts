import { describe, expect, it } from "vitest";
import {
  defaultAdvancedFilter,
  type AdvancedFilterState,
} from "./bucketOpsAdvancedFilterModel";
import { buildBucketOpsAdvancedFilterUiProjection } from "./bucketOpsAdvancedFilterUiProjection";

function projection({
  applied = null,
  draft = defaultAdvancedFilter,
  featureSupport = {},
  isStorageOps = false,
  quickFilterApplied = "",
  quickFilterDraft = "",
  usageFeatureEnabled = true,
}: {
  applied?: AdvancedFilterState | null;
  draft?: AdvancedFilterState;
  featureSupport?: Parameters<
    typeof buildBucketOpsAdvancedFilterUiProjection
  >[0]["featureSupport"];
  isStorageOps?: boolean;
  quickFilterApplied?: string;
  quickFilterDraft?: string;
  usageFeatureEnabled?: boolean;
} = {}) {
  return buildBucketOpsAdvancedFilterUiProjection({
    advancedApplied: applied,
    advancedDraft: draft,
    featureSupport,
    isStorageOps,
    quickFilterApplied,
    quickFilterDraft,
    usageFeatureEnabled,
  });
}

describe("buildBucketOpsAdvancedFilterUiProjection", () => {
  it("derives configured, pending, and neutral field states", () => {
    const applied = {
      ...defaultAdvancedFilter,
      tenant: "tenant-a",
    };
    const configured = projection({
      applied,
      draft: applied,
      quickFilterApplied: "bucket-a",
      quickFilterDraft: " bucket-a ",
    });
    const pending = projection({
      applied,
      draft: { ...applied, tenant: "tenant-b" },
      quickFilterApplied: "bucket-a",
      quickFilterDraft: "bucket-b",
    });

    expect(configured.tenantFieldState.tone).toBe("configured");
    expect(configured.ownerFieldState.tone).toBe("neutral");
    expect(configured.quickFilterFieldState.tone).toBe("configured");
    expect(configured.quickFilterPending).toBe(false);
    expect(pending.tenantFieldState.tone).toBe("unsaved");
    expect(pending.quickFilterFieldState.tone).toBe("unsaved");
    expect(pending.quickFilterPending).toBe(true);
  });

  it("counts Storage Ops identity filters only on the Storage Ops surface", () => {
    const draft = {
      ...defaultAdvancedFilter,
      contextIds: ["context"],
      endpointNames: ["Primary"],
      tenant: "tenant",
      owner: "owner",
      ownerName: "Owner name",
      ownerNameScope: "account" as const,
      ownerSuspended: "true" as const,
    };

    expect(
      projection({ draft, isStorageOps: true }).advancedDraftIdentityCount
    ).toBe(7);
    expect(
      projection({ draft, isStorageOps: false }).advancedDraftIdentityCount
    ).toBe(5);
  });

  it("excludes usage ranges when endpoint metrics are unavailable", () => {
    const draft = {
      ...defaultAdvancedFilter,
      minOwnerQuotaBytes: "1",
      minUsedBytes: "2",
      minOwnerUsedBytes: "3",
    };

    expect(
      projection({ draft, usageFeatureEnabled: true }).advancedDraftRangeCount
    ).toBe(3);
    expect(
      projection({ draft, usageFeatureEnabled: false }).advancedDraftRangeCount
    ).toBe(1);
  });

  it("ignores unsupported feature-state filters", () => {
    const draft = {
      ...defaultAdvancedFilter,
      features: {
        ...defaultAdvancedFilter.features,
        versioning: "enabled" as const,
        notifications: "enabled" as const,
      },
    };
    const result = projection({
      draft,
      featureSupport: { versioning: true, notifications: false },
    });

    expect(result.advancedDraftFeatureCount).toBe(1);
    expect(result.advancedDraftActiveCount).toBe(1);
  });

  it("assigns no, low, and lookup-driven medium costs", () => {
    expect(projection().advancedDraftGlobalCostLevel).toBe("none");

    const identity = projection({
      draft: { ...defaultAdvancedFilter, tenant: "tenant" },
    });
    expect(identity.advancedDraftGlobalCostLevel).toBe("low");
    expect(identity.advancedDraftGlobalCostTooltip).toContain(
      "identity filters"
    );

    const ownerName = projection({
      draft: { ...defaultAdvancedFilter, ownerName: "owner" },
    });
    expect(ownerName.advancedDraftGlobalCostLevel).toBe("medium");
    expect(ownerName.advancedDraftGlobalCostTooltip).toContain(
      "owner identity lookups"
    );

    const ownerUsage = projection({
      draft: { ...defaultAdvancedFilter, minOwnerUsedBytes: "1" },
    });
    expect(ownerUsage.advancedDraftGlobalCostLevel).toBe("medium");
    expect(ownerUsage.advancedDraftGlobalCostTooltip).toContain(
      "bucket stats"
    );
  });

  it("reduces one feature-state filter cost when a direct prefilter is active", () => {
    const featureDraft = {
      ...defaultAdvancedFilter,
      features: {
        ...defaultAdvancedFilter.features,
        versioning: "enabled" as const,
      },
    };
    const withoutPrefilter = projection({ draft: featureDraft });
    const withPrefilter = projection({
      draft: { ...featureDraft, tenant: "tenant" },
    });

    expect(withoutPrefilter.advancedDraftGlobalCostLevel).toBe("high");
    expect(withPrefilter.advancedDraftGlobalCostLevel).toBe("medium");
    expect(withPrefilter.advancedDraftGlobalCostTooltip).toContain(
      "prefilters reduce buckets"
    );
  });

  it("prioritizes feature details, tags, and multiple feature-state filters as high cost", () => {
    const featureDetails = projection({
      draft: {
        ...defaultAdvancedFilter,
        featureDetails: {
          ...defaultAdvancedFilter.featureDetails,
          lifecycleRuleStatus: "Disabled",
        },
        s3Tags: "env=prod",
      },
    });
    expect(featureDetails.advancedDraftGlobalCostLevel).toBe("high");
    expect(featureDetails.advancedDraftGlobalCostTooltip).toContain(
      "feature detail filters"
    );

    const tags = projection({
      draft: { ...defaultAdvancedFilter, s3Tags: "env=prod" },
    });
    expect(tags.advancedDraftGlobalCostTooltip).toContain(
      "bucket tag retrieval"
    );

    const multipleFeatures = projection({
      draft: {
        ...defaultAdvancedFilter,
        features: {
          ...defaultAdvancedFilter.features,
          versioning: "enabled",
          lifecycle_rules: "disabled",
        },
      },
    });
    expect(multipleFeatures.advancedDraftFeatureCount).toBe(2);
    expect(multipleFeatures.advancedDraftGlobalCostLevel).toBe("high");
    expect(multipleFeatures.advancedDraftGlobalCostTooltip).toContain(
      "2 feature-state filters"
    );
  });
});

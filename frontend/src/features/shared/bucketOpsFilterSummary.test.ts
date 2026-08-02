/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import {
  defaultAdvancedFilter,
  type AdvancedFilterState,
} from "./bucketOpsAdvancedFilterModel";
import {
  buildBucketOpsActiveFilterSummaryItems,
  buildBucketOpsAdvancedFilterComparison,
  buildBucketOpsDraftFilterSummaryItems,
} from "./bucketOpsFilterSummary";

const advancedFilter = (
  overrides: Partial<AdvancedFilterState>,
): AdvancedFilterState => ({
  ...defaultAdvancedFilter,
  ...overrides,
  features: {
    ...defaultAdvancedFilter.features,
    ...overrides.features,
  },
  featureDetails: {
    ...defaultAdvancedFilter.featureDetails,
    ...overrides.featureDetails,
  },
});

const summaryContext = {
  isStorageOps: true,
  usageFeatureEnabled: true,
  featureSupport: {},
  contextLabelById: new Map([
    ["1", "Primary account"],
    ["conn-2", "Archive connection"],
  ]),
};

describe("bucket operations filter summaries", () => {
  it("compares normalized applied and draft values without order-only changes", () => {
    const applied = advancedFilter({
      contextIds: ["conn-2", "1"],
      tenant: "tenant-a, tenant-b",
      tenantMatchMode: "contains",
      s3Tags: "env=prod, tier=hot",
      ownerSuspended: "true",
    });
    const draft = advancedFilter({
      contextIds: ["1", "conn-2"],
      tenant: "tenant-a, tenant-b",
      tenantMatchMode: "exact",
      s3Tags: "TIER=HOT, ENV=PROD",
      ownerSuspended: "false",
    });

    const comparison = buildBucketOpsAdvancedFilterComparison(applied, draft);

    expect(comparison.contextPending).toBe(false);
    expect(comparison.tenantDraftForcesExact).toBe(true);
    expect(comparison.tenantDraftEffectiveMatchMode).toBe("exact");
    expect(comparison.tenantPending).toBe(false);
    expect(comparison.s3TagsPending).toBe(false);
    expect(comparison.ownerSuspendedPending).toBe(true);
  });

  it("builds quick, tag, identity, range and feature summaries centrally", () => {
    const advanced = advancedFilter({
      contextIds: ["1", "conn-2"],
      endpointNames: ["Primary endpoint"],
      tenant: "tenant-a, tenant-b",
      ownerNameScope: "account",
      ownerSuspended: "true",
      s3Tags: "env=prod, tier=hot",
      minUsedBytes: "1000",
      maxQuotaUsageSizePercent: "95",
      minOwnerQuotaBytes: "2048",
      features: {
        ...defaultAdvancedFilter.features,
        versioning: "enabled",
      },
      featureDetails: {
        ...defaultAdvancedFilter.featureDetails,
        lifecycleRuleStatus: "Disabled",
      },
    });

    const items = buildBucketOpsActiveFilterSummaryItems({
      ...summaryContext,
      quickFilterValue: "bucket-a, bucket-b",
      quickFilterMode: "contains",
      tagFilters: ["Blue", "blue", "Gold"],
      tagFilterMode: "all",
      advanced,
    });

    expect(items).toEqual(
      expect.arrayContaining([
        {
          id: "quick",
          label: "Name exact list: bucket-a, bucket-b",
          remove: { type: "quick" },
        },
        {
          id: "tag-mode",
          label: "UI tags mode: AND",
          remove: { type: "tag_mode" },
        },
        {
          id: "context-ids",
          label: "Contexts: Primary account, Archive connection",
          remove: { type: "advanced_context_ids" },
        },
        {
          id: "tenant",
          label: "Tenant exact list: tenant-a, tenant-b",
          remove: { type: "advanced_text", field: "tenant" },
        },
        {
          id: "num-minUsedBytes",
          label: "Used bytes >= 1,000",
          remove: { type: "advanced_numeric", field: "minUsedBytes" },
        },
        {
          id: "num-maxQuotaUsageSizePercent",
          label: "Quota usage size % <= 95%",
          remove: {
            type: "advanced_numeric",
            field: "maxQuotaUsageSizePercent",
          },
        },
        {
          id: "feature-versioning",
          label: "Versioning: Enabled",
          remove: { type: "advanced_feature", feature: "versioning" },
        },
        {
          id: "feature-detail-lifecycleRuleStatus",
          label: "Lifecycle rule status: Disabled",
          remove: {
            type: "advanced_feature_detail",
            field: "lifecycleRuleStatus",
          },
        },
      ]),
    );
    expect(items.filter((item) => item.id.startsWith("tag-")).map((item) => item.label)).toEqual([
      "UI tags mode: AND",
      "UI tag: Blue",
      "UI tag: Gold",
    ]);
  });

  it("omits unsupported usage and feature summaries without hiding owner quota filters", () => {
    const advanced = advancedFilter({
      minUsedBytes: "1000",
      minOwnerQuotaBytes: "2048",
      features: {
        ...defaultAdvancedFilter.features,
        notifications: "enabled",
      },
    });

    const items = buildBucketOpsActiveFilterSummaryItems({
      ...summaryContext,
      usageFeatureEnabled: false,
      featureSupport: { notifications: false },
      quickFilterValue: "",
      quickFilterMode: "contains",
      tagFilters: [],
      tagFilterMode: "any",
      advanced,
    });

    expect(items.map((item) => item.id)).not.toContain("num-minUsedBytes");
    expect(items.map((item) => item.id)).not.toContain("feature-notifications");
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "num-minOwnerQuotaBytes",
          label: "Owner quota bytes >= 2,048",
        }),
      ]),
    );
  });

  it("derives draft summaries from the same presentation contract", () => {
    const advanced = advancedFilter({
      owner: "owner-a",
      ownerMatchMode: "exact",
      minOwnerQuotaObjects: "12",
    });

    expect(buildBucketOpsDraftFilterSummaryItems(advanced, summaryContext)).toEqual([
      { id: "draft-owner", label: "Owner exact: owner-a" },
      {
        id: "draft-num-minOwnerQuotaObjects",
        label: "Owner quota objects >= 12",
      },
    ]);
  });
});

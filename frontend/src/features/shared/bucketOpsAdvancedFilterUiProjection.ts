/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  uiFeatureStateHighlightFieldClasses,
  uiFeatureStateHighlightLabelClasses,
  type UiFeatureStateTone,
} from "../../components/ui/styles";
import { featureDetailSummary } from "../cephAdmin/filtering/bucketAdvancedFilter";
import {
  FILTER_COST_LABEL,
  type FilterCostLevel,
} from "../cephAdmin/filtering/advancedFilterShared";
import {
  BUCKET_STATS_NUMERIC_FILTER_FIELDS,
  OWNER_QUOTA_NUMERIC_FILTER_FIELDS,
  OWNER_USAGE_NUMERIC_FILTER_FIELDS,
  type AdvancedFilterState,
  type FeatureKey,
} from "./bucketOpsAdvancedFilterModel";
import { buildBucketOpsAdvancedFilterComparison } from "./bucketOpsFilterSummary";

type BuildBucketOpsAdvancedFilterUiProjectionOptions = {
  advancedApplied: AdvancedFilterState | null;
  advancedDraft: AdvancedFilterState;
  featureSupport: Partial<Record<FeatureKey, boolean>>;
  isStorageOps: boolean;
  quickFilterApplied: string;
  quickFilterDraft: string;
  usageFeatureEnabled: boolean;
};

export function buildAdvancedFilterFieldState(
  isApplied: boolean,
  isPending: boolean
) {
  const tone: UiFeatureStateTone = isPending
    ? "unsaved"
    : isApplied
      ? "configured"
      : "neutral";
  return {
    tone,
    labelClass: uiFeatureStateHighlightLabelClasses[tone],
    fieldClass: uiFeatureStateHighlightFieldClasses[tone],
  };
}

function countPopulatedFields(
  advancedDraft: AdvancedFilterState,
  fields: Array<keyof AdvancedFilterState>
): number {
  return fields.filter((field) => {
    const value = advancedDraft[field];
    return typeof value === "string" && value.trim().length > 0;
  }).length;
}

type CostProjectionOptions = {
  featureCount: number;
  featureDetailFiltersActive: boolean;
  identityCount: number;
  ownerNameLookupActive: boolean;
  ownerQuotaLookupActive: boolean;
  ownerSuspendedLookupActive: boolean;
  ownerUsageLookupActive: boolean;
  ownerPrefilterActive: boolean;
  rangeCount: number;
  s3TagsLookupActive: boolean;
};

function buildCostProjection({
  featureCount,
  featureDetailFiltersActive,
  identityCount,
  ownerNameLookupActive,
  ownerQuotaLookupActive,
  ownerSuspendedLookupActive,
  ownerUsageLookupActive,
  ownerPrefilterActive,
  rangeCount,
  s3TagsLookupActive,
}: CostProjectionOptions): { level: FilterCostLevel; tooltip: string } {
  const multipleFeatureFiltersActive = featureCount > 1;
  const featureCostReducedByPrefilter =
    featureCount === 1 &&
    ownerPrefilterActive &&
    !ownerNameLookupActive &&
    !s3TagsLookupActive;

  let level: FilterCostLevel = "none";
  if (featureDetailFiltersActive || s3TagsLookupActive) {
    level = "high";
  } else if (featureCount > 0) {
    level =
      multipleFeatureFiltersActive || !featureCostReducedByPrefilter
        ? "high"
        : "medium";
  } else if (
    ownerNameLookupActive ||
    ownerSuspendedLookupActive ||
    ownerQuotaLookupActive ||
    ownerUsageLookupActive ||
    rangeCount > 0
  ) {
    level = "medium";
  } else if (identityCount > 0) {
    level = "low";
  }

  if (level === "high") {
    if (featureDetailFiltersActive) {
      return {
        level,
        tooltip: `${FILTER_COST_LABEL.high}: feature detail filters require additional per-bucket configuration reads.`,
      };
    }
    if (s3TagsLookupActive) {
      return {
        level,
        tooltip: `${FILTER_COST_LABEL.high}: S3 tag filters require bucket tag retrieval.`,
      };
    }
    if (multipleFeatureFiltersActive) {
      return {
        level,
        tooltip: `${FILTER_COST_LABEL.high}: ${featureCount} feature-state filters are active, which increases per-bucket checks even with prefilters.`,
      };
    }
    return {
      level,
      tooltip: `${FILTER_COST_LABEL.high}: feature-state filters are active and may require additional checks.`,
    };
  }

  if (level === "medium") {
    if (ownerNameLookupActive) {
      return {
        level,
        tooltip: `${FILTER_COST_LABEL.medium}: owner-name filters require owner identity lookups.`,
      };
    }
    if (ownerSuspendedLookupActive) {
      return {
        level,
        tooltip: `${FILTER_COST_LABEL.medium}: owner-suspended filters require owner status lookups.`,
      };
    }
    if (ownerQuotaLookupActive && !ownerUsageLookupActive) {
      return {
        level,
        tooltip: `${FILTER_COST_LABEL.medium}: owner quota filters require owner metadata lookups.`,
      };
    }
    if (ownerUsageLookupActive) {
      return {
        level,
        tooltip: `${FILTER_COST_LABEL.medium}: owner usage filters require owner metadata lookups and bucket stats.`,
      };
    }
    if (featureCostReducedByPrefilter) {
      return {
        level,
        tooltip: `${FILTER_COST_LABEL.medium}: feature-state filters are active, but owner/tenant prefilters reduce buckets to inspect.`,
      };
    }
    return {
      level,
      tooltip: `${FILTER_COST_LABEL.medium}: usage/quota filters are active and require stats retrieval.`,
    };
  }

  if (level === "low") {
    return {
      level,
      tooltip: `${FILTER_COST_LABEL.low}: identity filters use already available bucket fields.`,
    };
  }
  return { level, tooltip: FILTER_COST_LABEL.none };
}

export function buildBucketOpsAdvancedFilterUiProjection({
  advancedApplied,
  advancedDraft,
  featureSupport,
  isStorageOps,
  quickFilterApplied,
  quickFilterDraft,
  usageFeatureEnabled,
}: BuildBucketOpsAdvancedFilterUiProjectionOptions) {
  const comparison = buildBucketOpsAdvancedFilterComparison(
    advancedApplied,
    advancedDraft
  );
  const {
    contextAppliedIds,
    contextDraftIds,
    contextPending,
    endpointAppliedNames,
    endpointDraftNames,
    endpointPending,
    ownerAppliedValue,
    ownerDraftValue,
    ownerNameAppliedScope,
    ownerNameAppliedValue,
    ownerNameDraftScope,
    ownerNameDraftValue,
    ownerNamePending,
    ownerPending,
    ownerSuspendedApplied,
    ownerSuspendedDraft,
    ownerSuspendedPending,
    s3TagsAppliedExpressions,
    s3TagsDraftExpressions,
    s3TagsPending,
    tenantAppliedValue,
    tenantDraftValue,
    tenantPending,
  } = comparison;
  const ownerNameLookupActive = ownerNameDraftValue.length > 0;
  const ownerSuspendedLookupActive = ownerSuspendedDraft !== "any";
  const ownerQuotaLookupActive = countPopulatedFields(
    advancedDraft,
    OWNER_QUOTA_NUMERIC_FILTER_FIELDS
  ) > 0;
  const ownerUsageLookupActive =
    usageFeatureEnabled &&
    countPopulatedFields(advancedDraft, OWNER_USAGE_NUMERIC_FILTER_FIELDS) > 0;
  const s3TagsLookupActive = s3TagsDraftExpressions.length > 0;
  const featureDetailDraftLabels = featureDetailSummary(
    advancedDraft.featureDetails
  );
  const ownerPrefilterActive =
    contextDraftIds.length > 0 ||
    endpointDraftNames.length > 0 ||
    tenantDraftValue.length > 0 ||
    ownerDraftValue.length > 0 ||
    ownerNameDraftScope !== "any";
  const advancedDraftIdentityCount =
    Number(isStorageOps && contextDraftIds.length > 0) +
    Number(isStorageOps && endpointDraftNames.length > 0) +
    Number(tenantDraftValue.length > 0) +
    Number(ownerDraftValue.length > 0) +
    Number(ownerNameLookupActive) +
    Number(ownerNameDraftScope !== "any") +
    Number(ownerSuspendedLookupActive);
  const ownerQuotaRangeCount = countPopulatedFields(
    advancedDraft,
    OWNER_QUOTA_NUMERIC_FILTER_FIELDS
  );
  const advancedDraftRangeCount = usageFeatureEnabled
    ? ownerQuotaRangeCount +
      countPopulatedFields(advancedDraft, BUCKET_STATS_NUMERIC_FILTER_FIELDS) +
      countPopulatedFields(advancedDraft, OWNER_USAGE_NUMERIC_FILTER_FIELDS)
    : ownerQuotaRangeCount;
  const advancedDraftFeatureCount = (
    Object.keys(advancedDraft.features) as FeatureKey[]
  ).filter(
    (key) =>
      featureSupport[key] !== false && advancedDraft.features[key] !== "any"
  ).length;
  const advancedDraftTagCount = s3TagsDraftExpressions.length;
  const advancedDraftFeatureDetailCount = featureDetailDraftLabels.length;
  const advancedDraftActiveCount =
    advancedDraftIdentityCount +
    advancedDraftRangeCount +
    advancedDraftFeatureCount +
    advancedDraftTagCount +
    advancedDraftFeatureDetailCount;
  const cost = buildCostProjection({
    featureCount: advancedDraftFeatureCount,
    featureDetailFiltersActive: advancedDraftFeatureDetailCount > 0,
    identityCount: advancedDraftIdentityCount,
    ownerNameLookupActive,
    ownerQuotaLookupActive,
    ownerSuspendedLookupActive,
    ownerUsageLookupActive,
    ownerPrefilterActive,
    rangeCount: advancedDraftRangeCount,
    s3TagsLookupActive,
  });
  const trimmedQuickFilterApplied = quickFilterApplied.trim();
  const quickFilterPending = quickFilterDraft.trim() !== trimmedQuickFilterApplied;

  return {
    ...comparison,
    contextFieldState: buildAdvancedFilterFieldState(
      contextAppliedIds.length > 0,
      contextPending
    ),
    endpointFieldState: buildAdvancedFilterFieldState(
      endpointAppliedNames.length > 0,
      endpointPending
    ),
    tenantFieldState: buildAdvancedFilterFieldState(Boolean(tenantAppliedValue), tenantPending),
    ownerFieldState: buildAdvancedFilterFieldState(Boolean(ownerAppliedValue), ownerPending),
    ownerNameFieldState: buildAdvancedFilterFieldState(
      Boolean(ownerNameAppliedValue || ownerNameAppliedScope !== "any"),
      ownerNamePending
    ),
    ownerSuspendedFieldState: buildAdvancedFilterFieldState(
      ownerSuspendedApplied !== "any",
      ownerSuspendedPending
    ),
    s3TagsFieldState: buildAdvancedFilterFieldState(
      s3TagsAppliedExpressions.length > 0,
      s3TagsPending
    ),
    quickFilterFieldState: buildAdvancedFilterFieldState(
      trimmedQuickFilterApplied.length > 0,
      quickFilterPending
    ),
    quickFilterPending,
    featureDetailDraftLabels,
    advancedDraftIdentityCount,
    advancedDraftRangeCount,
    advancedDraftFeatureCount,
    advancedDraftTagCount,
    advancedDraftFeatureDetailCount,
    advancedDraftActiveCount,
    advancedDraftGlobalCostLevel: cost.level,
    advancedDraftGlobalCostTooltip: cost.tooltip,
  };
}

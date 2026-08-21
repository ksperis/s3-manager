/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatNumber } from "../../utils/format";
import { featureDetailSummaryItems } from "../cephAdmin/filtering/bucketAdvancedFilter";
import {
  formatTextFilterSummary,
  formatTextMatchModeLabel,
  parseExactListInput,
} from "../cephAdmin/filtering/advancedFilterShared";
import {
  FEATURE_LABELS,
  formatFeatureFilterStateLabel,
  hasAdvancedFilters,
  normalizeAdvancedSelectionValues,
  parseS3TagExpressions,
  serializeAdvancedSelectionValues,
  serializeS3TagExpressions,
  type ActiveFilterRemoveAction,
  type ActiveFilterSummaryItem,
  type AdvancedFilterState,
  type AdvancedNumericField,
  type FeatureKey,
  type TextMatchMode,
} from "./bucketOpsAdvancedFilterModel";
import { normalizeUiTagValues } from "./bucketOpsListState";
import { formatBucketNamesPreview } from "./bucketOpsPresentation";

type AdvancedFilterSummaryContext = {
  isStorageOps: boolean;
  usageFeatureEnabled: boolean;
  featureSupport: Partial<Record<FeatureKey, boolean>>;
  contextLabelById: ReadonlyMap<string, string>;
};

type ActiveFilterSummaryOptions = AdvancedFilterSummaryContext & {
  quickFilterValue: string;
  quickFilterMode: TextMatchMode;
  tagFilters: Array<string | number>;
  tagLabelById?: ReadonlyMap<number, string>;
  tagFilterMode: "any" | "all";
  advanced: AdvancedFilterState | null;
};

type DraftFilterSummaryItem = {
  id: string;
  label: string;
};

type NumericSummaryDefinition = {
  id: AdvancedNumericField;
  label: string;
  format?: "number" | "percent";
  requiresUsage: boolean;
};

const NUMERIC_SUMMARY_DEFINITIONS: NumericSummaryDefinition[] = [
  { id: "minUsedBytes", label: "Used bytes >=", requiresUsage: true },
  { id: "maxUsedBytes", label: "Used bytes <=", requiresUsage: true },
  { id: "minObjects", label: "Objects >=", requiresUsage: true },
  { id: "maxObjects", label: "Objects <=", requiresUsage: true },
  { id: "minQuotaBytes", label: "Quota bytes >=", requiresUsage: true },
  { id: "maxQuotaBytes", label: "Quota bytes <=", requiresUsage: true },
  { id: "minQuotaObjects", label: "Quota objects >=", requiresUsage: true },
  { id: "maxQuotaObjects", label: "Quota objects <=", requiresUsage: true },
  {
    id: "minQuotaUsageSizePercent",
    label: "Quota usage size % >=",
    format: "percent",
    requiresUsage: true,
  },
  {
    id: "maxQuotaUsageSizePercent",
    label: "Quota usage size % <=",
    format: "percent",
    requiresUsage: true,
  },
  {
    id: "minQuotaUsageObjectPercent",
    label: "Quota usage objects % >=",
    format: "percent",
    requiresUsage: true,
  },
  {
    id: "maxQuotaUsageObjectPercent",
    label: "Quota usage objects % <=",
    format: "percent",
    requiresUsage: true,
  },
  { id: "minOwnerUsedBytes", label: "Owner used bytes >=", requiresUsage: true },
  { id: "maxOwnerUsedBytes", label: "Owner used bytes <=", requiresUsage: true },
  { id: "minOwnerObjects", label: "Owner objects >=", requiresUsage: true },
  { id: "maxOwnerObjects", label: "Owner objects <=", requiresUsage: true },
  {
    id: "minOwnerQuotaUsageSizePercent",
    label: "Owner quota usage size % >=",
    format: "percent",
    requiresUsage: true,
  },
  {
    id: "maxOwnerQuotaUsageSizePercent",
    label: "Owner quota usage size % <=",
    format: "percent",
    requiresUsage: true,
  },
  {
    id: "minOwnerQuotaUsageObjectPercent",
    label: "Owner quota usage objects % >=",
    format: "percent",
    requiresUsage: true,
  },
  {
    id: "maxOwnerQuotaUsageObjectPercent",
    label: "Owner quota usage objects % <=",
    format: "percent",
    requiresUsage: true,
  },
  { id: "minOwnerQuotaBytes", label: "Owner quota bytes >=", requiresUsage: false },
  { id: "maxOwnerQuotaBytes", label: "Owner quota bytes <=", requiresUsage: false },
  { id: "minOwnerQuotaObjects", label: "Owner quota objects >=", requiresUsage: false },
  { id: "maxOwnerQuotaObjects", label: "Owner quota objects <=", requiresUsage: false },
];

const effectiveTextMatchMode = (
  value: string,
  mode: TextMatchMode,
): TextMatchMode => {
  const parsed = parseExactListInput(value);
  return parsed.listProvided && parsed.values.length > 0 ? "exact" : mode;
};

export const buildBucketOpsAdvancedFilterComparison = (
  applied: AdvancedFilterState | null,
  draft: AdvancedFilterState,
) => {
  const contextAppliedIds = normalizeAdvancedSelectionValues(
    applied?.contextIds,
  );
  const endpointAppliedNames = normalizeAdvancedSelectionValues(
    applied?.endpointNames,
  );
  const tenantAppliedValue = (applied?.tenant ?? "").trim();
  const ownerAppliedValue = (applied?.owner ?? "").trim();
  const ownerNameAppliedValue = (applied?.ownerName ?? "").trim();
  const s3TagsAppliedExpressions = parseS3TagExpressions(applied?.s3Tags ?? "");
  const tenantAppliedEffectiveMatchMode = effectiveTextMatchMode(
    applied?.tenant ?? "",
    applied?.tenantMatchMode ?? "contains",
  );
  const ownerAppliedEffectiveMatchMode = effectiveTextMatchMode(
    applied?.owner ?? "",
    applied?.ownerMatchMode ?? "contains",
  );
  const ownerNameAppliedEffectiveMatchMode = effectiveTextMatchMode(
    applied?.ownerName ?? "",
    applied?.ownerNameMatchMode ?? "contains",
  );
  const s3TagsAppliedEffectiveMatchMode = effectiveTextMatchMode(
    applied?.s3Tags ?? "",
    applied?.s3TagsMatchMode ?? "contains",
  );
  const ownerNameAppliedScope = applied?.ownerNameScope ?? "any";
  const ownerSuspendedApplied = applied?.ownerSuspended ?? "any";

  const contextDraftIds = normalizeAdvancedSelectionValues(draft.contextIds);
  const endpointDraftNames = normalizeAdvancedSelectionValues(
    draft.endpointNames,
  );
  const tenantDraftValue = draft.tenant.trim();
  const ownerDraftValue = draft.owner.trim();
  const ownerNameDraftValue = draft.ownerName.trim();
  const s3TagsDraftExpressions = parseS3TagExpressions(draft.s3Tags);
  const tenantDraftParsed = parseExactListInput(draft.tenant);
  const ownerDraftParsed = parseExactListInput(draft.owner);
  const ownerNameDraftParsed = parseExactListInput(draft.ownerName);
  const s3TagsDraftParsed = parseExactListInput(draft.s3Tags);
  const tenantDraftForcesExact =
    tenantDraftParsed.listProvided && tenantDraftParsed.values.length > 0;
  const ownerDraftForcesExact =
    ownerDraftParsed.listProvided && ownerDraftParsed.values.length > 0;
  const ownerNameDraftForcesExact =
    ownerNameDraftParsed.listProvided && ownerNameDraftParsed.values.length > 0;
  const s3TagsDraftForcesExact =
    s3TagsDraftParsed.listProvided && s3TagsDraftParsed.values.length > 0;
  const tenantDraftEffectiveMatchMode = effectiveTextMatchMode(
    draft.tenant,
    draft.tenantMatchMode,
  );
  const ownerDraftEffectiveMatchMode = effectiveTextMatchMode(
    draft.owner,
    draft.ownerMatchMode,
  );
  const ownerNameDraftEffectiveMatchMode = effectiveTextMatchMode(
    draft.ownerName,
    draft.ownerNameMatchMode,
  );
  const s3TagsDraftEffectiveMatchMode = effectiveTextMatchMode(
    draft.s3Tags,
    draft.s3TagsMatchMode,
  );

  return {
    contextAppliedIds,
    endpointAppliedNames,
    tenantAppliedValue,
    ownerAppliedValue,
    ownerNameAppliedValue,
    s3TagsAppliedExpressions,
    tenantAppliedEffectiveMatchMode,
    ownerAppliedEffectiveMatchMode,
    ownerNameAppliedEffectiveMatchMode,
    s3TagsAppliedEffectiveMatchMode,
    ownerNameAppliedScope,
    ownerSuspendedApplied,
    contextDraftIds,
    endpointDraftNames,
    tenantDraftValue,
    ownerDraftValue,
    ownerNameDraftValue,
    s3TagsDraftExpressions,
    tenantDraftEffectiveMatchMode,
    tenantDraftForcesExact,
    ownerDraftEffectiveMatchMode,
    ownerDraftForcesExact,
    ownerNameDraftEffectiveMatchMode,
    ownerNameDraftForcesExact,
    s3TagsDraftEffectiveMatchMode,
    s3TagsDraftForcesExact,
    ownerNameDraftScope: draft.ownerNameScope,
    ownerSuspendedDraft: draft.ownerSuspended,
    contextPending:
      serializeAdvancedSelectionValues(contextDraftIds) !==
      serializeAdvancedSelectionValues(contextAppliedIds),
    endpointPending:
      serializeAdvancedSelectionValues(endpointDraftNames) !==
      serializeAdvancedSelectionValues(endpointAppliedNames),
    tenantPending:
      tenantDraftValue !== tenantAppliedValue ||
      (tenantDraftValue.length > 0 &&
        tenantDraftEffectiveMatchMode !== tenantAppliedEffectiveMatchMode),
    ownerPending:
      ownerDraftValue !== ownerAppliedValue ||
      (ownerDraftValue.length > 0 &&
        ownerDraftEffectiveMatchMode !== ownerAppliedEffectiveMatchMode),
    ownerNamePending:
      ownerNameDraftValue !== ownerNameAppliedValue ||
      draft.ownerNameScope !== ownerNameAppliedScope ||
      (ownerNameDraftValue.length > 0 &&
        ownerNameDraftEffectiveMatchMode !==
          ownerNameAppliedEffectiveMatchMode),
    ownerSuspendedPending: draft.ownerSuspended !== ownerSuspendedApplied,
    s3TagsPending:
      serializeS3TagExpressions(s3TagsDraftExpressions) !==
        serializeS3TagExpressions(s3TagsAppliedExpressions) ||
      (s3TagsDraftExpressions.length > 0 &&
        s3TagsDraftEffectiveMatchMode !==
          s3TagsAppliedEffectiveMatchMode),
  };
};

const formatNumericSummaryValue = (
  value: string,
  format?: NumericSummaryDefinition["format"],
) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return value;
  return format === "percent" ? `${numberValue}%` : formatNumber(numberValue);
};

const buildAdvancedFilterSummaryItems = (
  advanced: AdvancedFilterState,
  {
    isStorageOps,
    usageFeatureEnabled,
    featureSupport,
    contextLabelById,
  }: AdvancedFilterSummaryContext,
): ActiveFilterSummaryItem[] => {
  const items: ActiveFilterSummaryItem[] = [];
  const add = (
    id: string,
    label: string,
    remove: ActiveFilterRemoveAction,
  ) => items.push({ id, label, remove });

  if (isStorageOps) {
    const contextIds = normalizeAdvancedSelectionValues(advanced.contextIds);
    if (contextIds.length > 0) {
      const labels = contextIds.map((id) => contextLabelById.get(id) ?? id);
      add(
        "context-ids",
        `Contexts: ${formatBucketNamesPreview(labels, 2)}`,
        { type: "advanced_context_ids" },
      );
    }
    const endpointNames = normalizeAdvancedSelectionValues(
      advanced.endpointNames,
    );
    if (endpointNames.length > 0) {
      add(
        "endpoint-names",
        `Endpoints: ${formatBucketNamesPreview(endpointNames, 2)}`,
        { type: "advanced_endpoint_names" },
      );
    }
  }

  const textFields: Array<{
    id: string;
    label: string;
    value: string;
    mode: TextMatchMode;
    field: "tenant" | "owner" | "ownerName";
  }> = [
    {
      id: "tenant",
      label: "Tenant",
      value: advanced.tenant,
      mode: advanced.tenantMatchMode,
      field: "tenant",
    },
    {
      id: "owner",
      label: "Owner",
      value: advanced.owner,
      mode: advanced.ownerMatchMode,
      field: "owner",
    },
    {
      id: "owner-name",
      label: "Owner name",
      value: advanced.ownerName,
      mode: advanced.ownerNameMatchMode,
      field: "ownerName",
    },
  ];
  textFields.forEach(({ id, label, value, mode, field }) => {
    const summary = formatTextFilterSummary(
      label,
      value,
      effectiveTextMatchMode(value, mode),
    );
    if (summary) {
      add(id, summary, { type: "advanced_text", field });
    }
  });

  if (advanced.ownerNameScope !== "any") {
    add(
      "owner-kind",
      `Owner kind: ${advanced.ownerNameScope === "account" ? "Accounts" : "Users"}`,
      { type: "advanced_owner_scope" },
    );
  }
  if (advanced.ownerSuspended !== "any") {
    add(
      "owner-suspended",
      `Owner suspended: ${advanced.ownerSuspended === "true" ? "Yes" : "No"}`,
      { type: "advanced_owner_suspended" },
    );
  }

  const tagExpressions = parseS3TagExpressions(advanced.s3Tags);
  if (tagExpressions.length > 0) {
    const tagMatchMode = effectiveTextMatchMode(
      advanced.s3Tags,
      advanced.s3TagsMatchMode,
    );
    add(
      "s3-tags",
      `S3 tags ${formatTextMatchModeLabel(tagMatchMode)}: ${formatBucketNamesPreview(tagExpressions, 2)}`,
      { type: "advanced_text", field: "s3Tags" },
    );
  }

  NUMERIC_SUMMARY_DEFINITIONS.forEach(
    ({ id, label, format, requiresUsage }) => {
      if (requiresUsage && !usageFeatureEnabled) return;
      const value = advanced[id].trim();
      if (!value) return;
      add(
        `num-${id}`,
        `${label} ${formatNumericSummaryValue(value, format)}`,
        { type: "advanced_numeric", field: id },
      );
    },
  );

  (Object.keys(advanced.features) as FeatureKey[]).forEach((feature) => {
    if (featureSupport[feature] === false) return;
    const state = advanced.features[feature];
    if (state === "any") return;
    add(
      `feature-${feature}`,
      `${FEATURE_LABELS[feature]}: ${formatFeatureFilterStateLabel(state)}`,
      { type: "advanced_feature", feature },
    );
  });
  featureDetailSummaryItems(advanced.featureDetails).forEach((entry) => {
    add(`feature-detail-${entry.field}`, entry.label, {
      type: "advanced_feature_detail",
      field: entry.field,
    });
  });

  return items;
};

export const buildBucketOpsActiveFilterSummaryItems = ({
  quickFilterValue,
  quickFilterMode,
  tagFilters,
  tagFilterMode,
  advanced,
  ...context
}: ActiveFilterSummaryOptions): ActiveFilterSummaryItem[] => {
  const items: ActiveFilterSummaryItem[] = [];
  const quick = quickFilterValue.trim();
  if (quick) {
    const quickLabel = formatTextFilterSummary(
      "Name",
      quickFilterValue,
      effectiveTextMatchMode(quickFilterValue, quickFilterMode),
    );
    if (quickLabel) {
      items.push({ id: "quick", label: quickLabel, remove: { type: "quick" } });
    }
  }

  const normalizedTags = tagFilters.every((tag): tag is number => typeof tag === "number")
    ? Array.from(new Set(tagFilters))
    : normalizeUiTagValues(tagFilters.filter((tag): tag is string => typeof tag === "string"));
  if (normalizedTags.length > 1) {
    items.push({
      id: "tag-mode",
      label: `UI tags mode: ${tagFilterMode === "all" ? "AND" : "OR"}`,
      remove: { type: "tag_mode" },
    });
  }
  normalizedTags.forEach((tag) => {
    const label = typeof tag === "number" ? context.tagLabelById?.get(tag) ?? `#${tag}` : tag;
    items.push({
      id: `tag-${typeof tag === "number" ? tag : tag.toLowerCase()}`,
      label: `UI tag: ${label}`,
      remove: { type: "tag", tag },
    });
  });

  if (
    advanced &&
    hasAdvancedFilters(
      advanced,
      context.isStorageOps,
      context.usageFeatureEnabled,
      context.featureSupport,
    )
  ) {
    items.push(...buildAdvancedFilterSummaryItems(advanced, context));
  }
  return items;
};

export const buildBucketOpsDraftFilterSummaryItems = (
  advanced: AdvancedFilterState,
  context: AdvancedFilterSummaryContext,
): DraftFilterSummaryItem[] =>
  buildAdvancedFilterSummaryItems(advanced, context).map(({ id, label }) => ({
    id: `draft-${id}`,
    label,
  }));

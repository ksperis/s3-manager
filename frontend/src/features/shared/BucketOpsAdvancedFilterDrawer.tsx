/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiButton from "../../components/ui/UiButton";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
} from "../../components/ui/styles";
import { ChevronDownIcon } from "../browser/browserIcons";
import {
  advancedFilterAccordionClass,
  advancedFilterBackdropClass,
  advancedFilterBodyClass,
  advancedFilterDrawerClass,
  advancedFilterFooterClass,
  advancedFilterHeaderClass,
  formatAdvancedFilterSyncLabel,
  advancedFilterSyncBadgeClass,
  advancedFilterRootClass,
  advancedFilterSectionClass,
  renderAdvancedFilterCostBadge,
  renderAdvancedFilterDraftSummary,
  renderAdvancedFilterRuleCountBadge,
  renderFilterCostIndicator,
  type FilterCostLevel,
} from "../cephAdmin/filtering/advancedFilterShared";
import {
  type AdvancedFilterSecondarySectionId,
  type AdvancedFilterState,
  type FeatureKey,
} from "./bucketOpsAdvancedFilterModel";
import BucketOpsFeatureDetailFilterFields from "./BucketOpsFeatureDetailFilterFields";
import BucketOpsFeatureStateFilterFields from "./BucketOpsFeatureStateFilterFields";
import BucketOpsIdentityFilterFields from "./BucketOpsIdentityFilterFields";
import BucketOpsMetricFilterFields from "./BucketOpsMetricFilterFields";
import BucketOpsStorageScopeFilterFields from "./BucketOpsStorageScopeFilterFields";
import type { useBucketOpsFilterController } from "./useBucketOpsFilterController";
import type { useBucketOpsStorageScopeFilters } from "./useBucketOpsStorageScopeFilters";

type FilterController = ReturnType<typeof useBucketOpsFilterController>;
type StorageScopeFilterController = ReturnType<
  typeof useBucketOpsStorageScopeFilters
>;

type FeatureStateOption = {
  id: FeatureKey;
  label: string;
  supported: boolean;
};

type BucketOpsAdvancedFilterDrawerProps = {
  advancedApplied: AdvancedFilterState | null;
  advancedDraft: AdvancedFilterState;
  controller: FilterController;
  draftSummaryItems: Array<{ id: string; label: string }>;
  featureStateOptions: FeatureStateOption[];
  isStorageOps: boolean;
  sseFeatureEnabled: boolean;
  storageScopeController?: StorageScopeFilterController;
  usageFeatureEnabled: boolean;
  usageUnavailableBadge: string;
  usageUnavailableDescription: string;
};

type AdvancedFilterSectionProps = {
  activeCount: number;
  badge?: ReactNode;
  children: ReactNode;
  costLevel: FilterCostLevel;
  costTooltip: string;
  id: AdvancedFilterSecondarySectionId;
  onToggle: (id: AdvancedFilterSecondarySectionId) => void;
  open: boolean;
  title: string;
};

function AdvancedFilterSection({
  activeCount,
  badge,
  children,
  costLevel,
  costTooltip,
  id,
  onToggle,
  open,
  title,
}: AdvancedFilterSectionProps) {
  const contentId = `advanced-filter-${id}-content`;
  return (
    <section className={advancedFilterAccordionClass}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:hover:bg-neutral-800/70"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <ChevronDownIcon
            className={cx(
              "h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-slate-400",
              open ? "" : "-rotate-90",
            )}
          />
          <span className="inline-flex min-w-0 items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span className="truncate">{title}</span>
            {renderFilterCostIndicator(costLevel, costTooltip)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badge}
          <span className="ui-caption text-slate-500 dark:text-slate-400">
            {activeCount} active
          </span>
        </span>
      </button>
      {open && (
        <div id={contentId} className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

export default function BucketOpsAdvancedFilterDrawer({
  advancedApplied,
  advancedDraft,
  controller,
  draftSummaryItems,
  featureStateOptions,
  isStorageOps,
  sseFeatureEnabled,
  storageScopeController,
  usageFeatureEnabled,
  usageUnavailableBadge,
  usageUnavailableDescription,
}: BucketOpsAdvancedFilterDrawerProps) {
  const {
    advancedDraftActiveCount,
    advancedDraftFeatureCount,
    advancedDraftFeatureDetailCount,
    advancedDraftGlobalCostLevel,
    advancedDraftGlobalCostTooltip,
    advancedDraftRangeCount,
    advancedFilterCloseGuard,
    advancedFilterSecondarySections,
    applyAdvancedFilter,
    contextDraftIds,
    contextFieldState,
    endpointDraftNames,
    endpointFieldState,
    hasAnyAdvancedToClear,
    hasPendingAdvancedChanges,
    resetAdvancedFilter,
    showAdvancedFilter,
    toggleAdvancedFilterSecondarySection,
    updateAdvancedField,
    updateFeatureDetailFilter,
    updateFeatureFilter,
  } = controller;

  if (!showAdvancedFilter) return null;
  if (isStorageOps && !storageScopeController) {
    throw new Error("Storage Ops advanced filters require a scope controller.");
  }

  return (
    <>
      <div className={advancedFilterRootClass}>
        <button
          type="button"
          onClick={advancedFilterCloseGuard.requestClose}
          className={advancedFilterBackdropClass}
          aria-label="Close advanced filter drawer"
        />
        <div className={advancedFilterDrawerClass}>
          <div className={advancedFilterHeaderClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                  Advanced filter
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Buckets listing
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {renderAdvancedFilterRuleCountBadge(advancedDraftActiveCount)}
                  {renderAdvancedFilterCostBadge(
                    advancedDraftGlobalCostLevel,
                    advancedDraftGlobalCostTooltip,
                  )}
                  <span
                    className={advancedFilterSyncBadgeClass(
                      hasPendingAdvancedChanges,
                    )}
                  >
                    {formatAdvancedFilterSyncLabel(hasPendingAdvancedChanges)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={advancedFilterCloseGuard.requestClose}
                className={cx(
                  uiButtonBaseClass,
                  uiButtonVariants.secondary,
                  "rounded-md px-2.5 py-1.5 ui-caption",
                )}
              >
                Close
              </button>
            </div>
          </div>

          <div className={advancedFilterBodyClass}>
            <div className="space-y-4">
              {renderAdvancedFilterDraftSummary(draftSummaryItems)}

              <section className={advancedFilterSectionClass}>
                <div className="mb-3 flex items-center justify-between">
                  <p className="inline-flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <span>Identity and tags</span>
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {isStorageOps && storageScopeController && (
                    <BucketOpsStorageScopeFilterFields
                      contextDraftIds={contextDraftIds}
                      contextFieldState={contextFieldState}
                      controller={storageScopeController}
                      endpointDraftNames={endpointDraftNames}
                      endpointFieldState={endpointFieldState}
                    />
                  )}
                  <BucketOpsIdentityFilterFields
                    advancedDraft={advancedDraft}
                    controller={controller}
                  />
                </div>
              </section>

              <AdvancedFilterSection
                id="metrics"
                title="Storage Metrics and Quota"
                costLevel="medium"
                costTooltip="Medium cost: owner quota filters require owner metadata lookups; usage and percentage filters also require bucket stats."
                activeCount={advancedDraftRangeCount}
                badge={
                  !usageFeatureEnabled ? (
                    <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 ui-caption font-semibold text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-200">
                      {usageUnavailableBadge}
                    </span>
                  ) : null
                }
                open={advancedFilterSecondarySections.metrics}
                onToggle={toggleAdvancedFilterSecondarySection}
              >
                <BucketOpsMetricFilterFields
                  advancedApplied={advancedApplied}
                  advancedDraft={advancedDraft}
                  onFieldChange={updateAdvancedField}
                  usageFeatureEnabled={usageFeatureEnabled}
                  usageUnavailableDescription={usageUnavailableDescription}
                />
              </AdvancedFilterSection>

              <AdvancedFilterSection
                id="featureStates"
                title="Feature states"
                costLevel="high"
                costTooltip="High cost: feature-state filters may trigger extra checks."
                activeCount={advancedDraftFeatureCount}
                open={advancedFilterSecondarySections.featureStates}
                onToggle={toggleAdvancedFilterSecondarySection}
              >
                <BucketOpsFeatureStateFilterFields
                  advancedApplied={advancedApplied}
                  advancedDraft={advancedDraft}
                  featureStateOptions={featureStateOptions}
                  onFeatureChange={updateFeatureFilter}
                />
              </AdvancedFilterSection>

              <AdvancedFilterSection
                id="featureDetails"
                title="Feature details"
                costLevel="high"
                costTooltip="High cost: feature-detail filters may trigger additional per-bucket data retrieval."
                activeCount={advancedDraftFeatureDetailCount}
                open={advancedFilterSecondarySections.featureDetails}
                onToggle={toggleAdvancedFilterSecondarySection}
              >
                <BucketOpsFeatureDetailFilterFields
                  filters={advancedDraft.featureDetails}
                  onFieldChange={updateFeatureDetailFilter}
                  sseFeatureEnabled={sseFeatureEnabled}
                />
              </AdvancedFilterSection>
            </div>
          </div>

          <div className={advancedFilterFooterClass}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                {hasPendingAdvancedChanges
                  ? "Draft has unapplied changes."
                  : advancedDraftActiveCount > 0
                    ? "Draft matches applied filters."
                    : "No advanced filter configured."}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <UiButton
                  type="button"
                  onClick={resetAdvancedFilter}
                  disabled={!hasAnyAdvancedToClear}
                  variant="secondary"
                  size="sm"
                >
                  Clear
                </UiButton>
                <UiButton
                  type="button"
                  onClick={advancedFilterCloseGuard.requestClose}
                  variant="secondary"
                  size="sm"
                >
                  Close
                </UiButton>
                <UiButton
                  type="button"
                  onClick={applyAdvancedFilter}
                  disabled={!hasPendingAdvancedChanges}
                  variant="primary"
                  size="sm"
                >
                  Apply filters
                </UiButton>
              </div>
            </div>
          </div>
        </div>
      </div>
      {advancedFilterCloseGuard.confirmationDialog}
    </>
  );
}

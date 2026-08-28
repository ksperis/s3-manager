/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { advancedFilterControlClass } from "../cephAdmin/filtering/advancedFilterShared";
import {
  formatFeatureFilterStateLabel,
  type AdvancedFilterState,
  type FeatureFilterState,
  type FeatureKey,
} from "./bucketOpsAdvancedFilterModel";
import { buildAdvancedFilterFieldState } from "./bucketOpsAdvancedFilterUiProjection";

type FeatureStateOption = {
  id: FeatureKey;
  label: string;
  supported: boolean;
};

const BINARY_FEATURE_FILTER_STATES: FeatureFilterState[] = [
  "any",
  "enabled",
  "disabled",
];
const VERSIONING_FILTER_STATES: FeatureFilterState[] = [
  ...BINARY_FEATURE_FILTER_STATES,
  "suspended",
  "disabled_or_suspended",
];

type BucketOpsFeatureStateFilterFieldsProps = {
  advancedApplied: AdvancedFilterState | null;
  advancedDraft: AdvancedFilterState;
  featureStateOptions: FeatureStateOption[];
  onFeatureChange: (feature: FeatureKey, value: FeatureFilterState) => void;
};

export default function BucketOpsFeatureStateFilterFields({
  advancedApplied,
  advancedDraft,
  featureStateOptions,
  onFeatureChange,
}: BucketOpsFeatureStateFilterFieldsProps) {
  const hasUnsupportedFeature = featureStateOptions.some(
    (feature) => !feature.supported,
  );

  return (
    <>
      {hasUnsupportedFeature && (
        <p className="mb-3 ui-caption text-slate-500 dark:text-slate-400">
          Some features are disabled on this endpoint and cannot be filtered.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {featureStateOptions.map((feature) => {
          const disabled = !feature.supported;
          const appliedValue =
            advancedApplied?.features[feature.id] ?? "any";
          const draftValue = advancedDraft.features[feature.id];
          const state = disabled
            ? { labelClass: "", fieldClass: "" }
            : buildAdvancedFilterFieldState(
                appliedValue !== "any",
                draftValue !== appliedValue,
              );
          const filterStates =
            feature.id === "versioning"
              ? VERSIONING_FILTER_STATES
              : BINARY_FEATURE_FILTER_STATES;
          const fieldId = `bucket-ops-feature-state-${feature.id}`;

          return (
            <div
              key={feature.id}
              className={`rounded-lg border border-slate-200 p-2.5 dark:border-slate-700 ${disabled ? "opacity-60" : ""}`}
            >
              <label
                htmlFor={fieldId}
                className={`ui-caption font-medium text-slate-700 dark:text-slate-200 ${state.labelClass}`}
              >
                {feature.label}
              </label>
              <select
                id={fieldId}
                value={draftValue}
                onChange={(event) =>
                  onFeatureChange(
                    feature.id,
                    event.target.value as FeatureFilterState,
                  )
                }
                className={advancedFilterControlClass(
                  `mt-1 w-full px-2 py-1.5 font-normal ${state.fieldClass}`,
                  disabled,
                )}
                disabled={disabled}
              >
                {filterStates.map((filterState) => (
                  <option key={filterState} value={filterState}>
                    {formatFeatureFilterStateLabel(filterState)}
                  </option>
                ))}
              </select>
              {disabled && (
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  {feature.label} is disabled on this endpoint.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

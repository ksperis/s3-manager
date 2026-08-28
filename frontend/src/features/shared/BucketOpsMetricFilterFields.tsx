/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  advancedFilterControlClass,
  advancedFilterFieldCardClass,
} from "../cephAdmin/filtering/advancedFilterShared";
import {
  type AdvancedFilterState,
  type AdvancedNumericField,
} from "./bucketOpsAdvancedFilterModel";
import { buildAdvancedFilterFieldState } from "./bucketOpsAdvancedFilterUiProjection";

type MetricRangeRow = {
  label: string;
  minId: AdvancedNumericField;
  maxId: AdvancedNumericField;
};

type MetricFilterSection = {
  title: string;
  requiresStats: boolean;
  rows: MetricRangeRow[];
};

const METRIC_FILTER_SECTIONS: MetricFilterSection[] = [
  {
    title: "Usage",
    requiresStats: true,
    rows: [
      { label: "Bytes", minId: "minUsedBytes", maxId: "maxUsedBytes" },
      { label: "Objects", minId: "minObjects", maxId: "maxObjects" },
    ],
  },
  {
    title: "Quota",
    requiresStats: true,
    rows: [
      { label: "Bytes", minId: "minQuotaBytes", maxId: "maxQuotaBytes" },
      { label: "Objects", minId: "minQuotaObjects", maxId: "maxQuotaObjects" },
    ],
  },
  {
    title: "Quota usage %",
    requiresStats: true,
    rows: [
      {
        label: "Size %",
        minId: "minQuotaUsageSizePercent",
        maxId: "maxQuotaUsageSizePercent",
      },
      {
        label: "Objects %",
        minId: "minQuotaUsageObjectPercent",
        maxId: "maxQuotaUsageObjectPercent",
      },
    ],
  },
  {
    title: "Owner quota",
    requiresStats: false,
    rows: [
      {
        label: "Bytes",
        minId: "minOwnerQuotaBytes",
        maxId: "maxOwnerQuotaBytes",
      },
      {
        label: "Objects",
        minId: "minOwnerQuotaObjects",
        maxId: "maxOwnerQuotaObjects",
      },
    ],
  },
  {
    title: "Owner usage",
    requiresStats: true,
    rows: [
      {
        label: "Bytes",
        minId: "minOwnerUsedBytes",
        maxId: "maxOwnerUsedBytes",
      },
      {
        label: "Objects",
        minId: "minOwnerObjects",
        maxId: "maxOwnerObjects",
      },
    ],
  },
  {
    title: "Owner usage %",
    requiresStats: true,
    rows: [
      {
        label: "Size %",
        minId: "minOwnerQuotaUsageSizePercent",
        maxId: "maxOwnerQuotaUsageSizePercent",
      },
      {
        label: "Objects %",
        minId: "minOwnerQuotaUsageObjectPercent",
        maxId: "maxOwnerQuotaUsageObjectPercent",
      },
    ],
  },
];

type BucketOpsMetricFilterFieldsProps = {
  advancedApplied: AdvancedFilterState | null;
  advancedDraft: AdvancedFilterState;
  onFieldChange: (field: AdvancedNumericField, value: string) => void;
  usageFeatureEnabled: boolean;
  usageUnavailableDescription: string;
};

export default function BucketOpsMetricFilterFields({
  advancedApplied,
  advancedDraft,
  onFieldChange,
  usageFeatureEnabled,
  usageUnavailableDescription,
}: BucketOpsMetricFilterFieldsProps) {
  return (
    <div className="space-y-3">
      {!usageFeatureEnabled && (
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          {usageUnavailableDescription}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {METRIC_FILTER_SECTIONS.map((section) => {
          const disabled = section.requiresStats && !usageFeatureEnabled;
          return (
            <div
              key={section.title}
              className={advancedFilterFieldCardClass(
                disabled ? "opacity-75" : "",
              )}
            >
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {section.title}
              </p>
              {disabled && (
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  Requires bucket stats.
                </p>
              )}
              <div className="mt-2 space-y-2">
                {section.rows.map((row) => {
                  const minApplied = (advancedApplied?.[row.minId] ?? "").trim();
                  const minDraft = advancedDraft[row.minId].trim();
                  const maxApplied = (advancedApplied?.[row.maxId] ?? "").trim();
                  const maxDraft = advancedDraft[row.maxId].trim();
                  const rowState = buildAdvancedFilterFieldState(
                    Boolean(minApplied || maxApplied),
                    minDraft !== minApplied || maxDraft !== maxApplied,
                  );
                  const minState = buildAdvancedFilterFieldState(
                    Boolean(minApplied),
                    minDraft !== minApplied,
                  );
                  const maxState = buildAdvancedFilterFieldState(
                    Boolean(maxApplied),
                    maxDraft !== maxApplied,
                  );
                  return (
                    <div key={`${section.title}:${row.label}`}>
                      <label
                        className={`ui-caption font-medium text-slate-600 dark:text-slate-300 ${rowState.labelClass}`}
                      >
                        {row.label}
                      </label>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={advancedDraft[row.minId]}
                          onChange={(event) =>
                            onFieldChange(row.minId, event.target.value)
                          }
                          aria-label={`${section.title} ${row.label} minimum`}
                          placeholder="min"
                          disabled={disabled}
                          className={advancedFilterControlClass(
                            `w-full px-2 py-1.5 font-normal ${minState.fieldClass}`,
                            disabled,
                          )}
                        />
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={advancedDraft[row.maxId]}
                          onChange={(event) =>
                            onFieldChange(row.maxId, event.target.value)
                          }
                          aria-label={`${section.title} ${row.label} maximum`}
                          placeholder="max"
                          disabled={disabled}
                          className={advancedFilterControlClass(
                            `w-full px-2 py-1.5 font-normal ${maxState.fieldClass}`,
                            disabled,
                          )}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

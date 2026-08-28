/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type FeatureDetailFilterKey,
  type FeatureDetailFilters,
  type NumericComparisonOpUi,
} from "../cephAdmin/filtering/bucketAdvancedFilter";
import {
  advancedFilterControlClass,
  advancedFilterFieldCardClass,
} from "../cephAdmin/filtering/advancedFilterShared";
import {
  BOOLEAN_FILTER_OPTIONS,
  NUMERIC_FILTER_OPTIONS,
} from "./bucketOpsAdvancedFilterModel";
import {
  LIFECYCLE_TYPE_OPTIONS,
  NOTIFICATION_TYPE_OPTIONS,
} from "./bucketConfigMerge";

type BucketOpsFeatureDetailFilterFieldsProps = {
  filters: FeatureDetailFilters;
  onFieldChange: (
    field: FeatureDetailFilterKey,
    value: FeatureDetailFilters[FeatureDetailFilterKey],
  ) => void;
  sseFeatureEnabled: boolean;
};

export default function BucketOpsFeatureDetailFilterFields({
  filters,
  onFieldChange,
  sseFeatureEnabled,
}: BucketOpsFeatureDetailFilterFieldsProps) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
    <div className={advancedFilterFieldCardClass()}>
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Lifecycle
      </p>
      <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
        Rule name, status, type and lifecycle day conditions are evaluated on the same lifecycle rule.
      </p>
      <div className="mt-2 space-y-2">
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule name</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.lifecycleRuleNameMode}
              onChange={(e) =>
                onFieldChange(
                  "lifecycleRuleNameMode",
                  e.target.value as FeatureDetailFilters["lifecycleRuleNameMode"]
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="any">Any</option>
              <option value="has_named">Has named rule</option>
              <option value="has_not_named">Has no named rule</option>
            </select>
            <input
              type="text"
              value={filters.lifecycleRuleName}
              onChange={(e) => onFieldChange("lifecycleRuleName", e.target.value)}
              placeholder="rule-id"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule status</label>
          <select
            value={filters.lifecycleRuleStatus}
            onChange={(e) =>
              onFieldChange(
                "lifecycleRuleStatus",
                e.target.value as FeatureDetailFilters["lifecycleRuleStatus"]
              )
            }
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">Any</option>
            <option value="Enabled">Enabled</option>
            <option value="Disabled">Disabled</option>
          </select>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule type</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.lifecycleRuleTypeMode}
              onChange={(e) =>
                onFieldChange(
                  "lifecycleRuleTypeMode",
                  e.target.value as FeatureDetailFilters["lifecycleRuleTypeMode"]
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="any">Any</option>
              <option value="has">Has rule type</option>
              <option value="has_not">Has no rule type</option>
            </select>
            <select
              value={filters.lifecycleRuleTypeValue}
              onChange={(e) =>
                onFieldChange(
                  "lifecycleRuleTypeValue",
                  e.target.value as FeatureDetailFilters["lifecycleRuleTypeValue"]
                )
              }
              disabled={filters.lifecycleRuleTypeMode === "any"}
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Select type</option>
              {LIFECYCLE_TYPE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Expiration days</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.lifecycleExpirationDaysOp}
              onChange={(e) =>
                onFieldChange(
                  "lifecycleExpirationDaysOp",
                  e.target.value as NumericComparisonOpUi
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {NUMERIC_FILTER_OPTIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              value={filters.lifecycleExpirationDays}
              onChange={(e) => onFieldChange("lifecycleExpirationDays", e.target.value)}
              placeholder="days"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Noncurrent expiration days</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.lifecycleNoncurrentExpirationDaysOp}
              onChange={(e) =>
                onFieldChange(
                  "lifecycleNoncurrentExpirationDaysOp",
                  e.target.value as NumericComparisonOpUi
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {NUMERIC_FILTER_OPTIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              value={filters.lifecycleNoncurrentExpirationDays}
              onChange={(e) =>
                onFieldChange("lifecycleNoncurrentExpirationDays", e.target.value)
              }
              placeholder="days"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Transition days</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.lifecycleTransitionDaysOp}
              onChange={(e) =>
                onFieldChange(
                  "lifecycleTransitionDaysOp",
                  e.target.value as NumericComparisonOpUi
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {NUMERIC_FILTER_OPTIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              value={filters.lifecycleTransitionDays}
              onChange={(e) => onFieldChange("lifecycleTransitionDays", e.target.value)}
              placeholder="days"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Abort days</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.lifecycleAbortDaysOp}
              onChange={(e) =>
                onFieldChange(
                  "lifecycleAbortDaysOp",
                  e.target.value as NumericComparisonOpUi
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {NUMERIC_FILTER_OPTIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              value={filters.lifecycleAbortDays}
              onChange={(e) => onFieldChange("lifecycleAbortDays", e.target.value)}
              placeholder="days"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      </div>
    </div>

    <div className={advancedFilterFieldCardClass()}>
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Notifications
      </p>
      <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
        Rule ID, type, topic, events and key filters are evaluated on the same notification rule.
      </p>
      <div className="mt-2 space-y-2">
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule ID</label>
          <input
            type="text"
            value={filters.notificationRuleId}
            onChange={(e) => onFieldChange("notificationRuleId", e.target.value)}
            placeholder="rule-id"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule type</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.notificationRuleTypeMode}
              onChange={(e) =>
                onFieldChange(
                  "notificationRuleTypeMode",
                  e.target.value as FeatureDetailFilters["notificationRuleTypeMode"]
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="any">Any</option>
              <option value="has">Has</option>
              <option value="has_not">Has not</option>
            </select>
            <select
              value={filters.notificationRuleTypeValue}
              onChange={(e) =>
                onFieldChange(
                  "notificationRuleTypeValue",
                  e.target.value as FeatureDetailFilters["notificationRuleTypeValue"]
                )
              }
              disabled={filters.notificationRuleTypeMode === "any"}
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Select type</option>
              {NOTIFICATION_TYPE_OPTIONS.filter((option) => option.key !== "eventbridge").map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Topic name or ARN</label>
          <input
            type="text"
            value={filters.notificationTopicName}
            onChange={(e) => onFieldChange("notificationTopicName", e.target.value)}
            placeholder="bucket-events"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        {[
          {
            modeKey: "notificationEventMode" as const,
            valueKey: "notificationEventValue" as const,
            label: "Event",
            placeholder: "s3:ObjectCreated:*",
          },
          {
            modeKey: "notificationFilterPrefixMode" as const,
            valueKey: "notificationFilterPrefixValue" as const,
            label: "Filter prefix",
            placeholder: "incoming/",
          },
          {
            modeKey: "notificationFilterSuffixMode" as const,
            valueKey: "notificationFilterSuffixValue" as const,
            label: "Filter suffix",
            placeholder: ".csv",
          },
        ].map((entry) => (
          <div key={entry.valueKey}>
            <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">{entry.label}</label>
            <div className="mt-1 grid grid-cols-5 gap-2">
              <select
                value={filters[entry.modeKey]}
                onChange={(e) =>
                  onFieldChange(
                    entry.modeKey,
                    e.target.value as FeatureDetailFilters[typeof entry.modeKey]
                  )
                }
                className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="any">Any</option>
                <option value="has">Has</option>
                <option value="has_not">Has not</option>
              </select>
              <input
                type="text"
                value={filters[entry.valueKey]}
                onChange={(e) => onFieldChange(entry.valueKey, e.target.value)}
                placeholder={entry.placeholder}
                className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        ))}
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">EventBridge present</label>
          <select
            value={filters.notificationEventBridgePresent}
            onChange={(e) =>
              onFieldChange(
                "notificationEventBridgePresent",
                e.target.value as FeatureDetailFilters["notificationEventBridgePresent"]
              )
            }
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {BOOLEAN_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>

    <div className={advancedFilterFieldCardClass()}>
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Object Lock and BPA
      </p>
      <div className="mt-2 space-y-2">
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Object Lock mode</label>
          <select
            value={filters.objectLockMode}
            onChange={(e) =>
              onFieldChange(
                "objectLockMode",
                e.target.value as FeatureDetailFilters["objectLockMode"]
              )
            }
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">Any</option>
            <option value="GOVERNANCE">GOVERNANCE</option>
            <option value="COMPLIANCE">COMPLIANCE</option>
          </select>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Object Lock retention days</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.objectLockRetentionOp}
              onChange={(e) =>
                onFieldChange(
                  "objectLockRetentionOp",
                  e.target.value as NumericComparisonOpUi
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {NUMERIC_FILTER_OPTIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              value={filters.objectLockRetentionDays}
              onChange={(e) => onFieldChange("objectLockRetentionDays", e.target.value)}
              placeholder="days"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Object Lock retention years</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.objectLockRetentionYearsOp}
              onChange={(e) =>
                onFieldChange(
                  "objectLockRetentionYearsOp",
                  e.target.value as NumericComparisonOpUi
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {NUMERIC_FILTER_OPTIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              value={filters.objectLockRetentionYears}
              onChange={(e) => onFieldChange("objectLockRetentionYears", e.target.value)}
              placeholder="years"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: "bpaBlockPublicAcls" as const, label: "Block public ACLs" },
            { key: "bpaIgnorePublicAcls" as const, label: "Ignore public ACLs" },
            { key: "bpaBlockPublicPolicy" as const, label: "Block public policy" },
            { key: "bpaRestrictPublicBuckets" as const, label: "Restrict public buckets" },
          ].map((entry) => (
            <div key={entry.key}>
              <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">{entry.label}</label>
              <select
                value={filters[entry.key]}
                onChange={(e) =>
                  onFieldChange(
                    entry.key,
                    e.target.value as FeatureDetailFilters[typeof entry.key]
                  )
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {BOOLEAN_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className={advancedFilterFieldCardClass()}>
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        CORS and Logging
      </p>
      <div className="mt-2 space-y-2">
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">CORS method</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.corsMethodMode}
              onChange={(e) =>
                onFieldChange(
                  "corsMethodMode",
                  e.target.value as FeatureDetailFilters["corsMethodMode"]
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="any">Any</option>
              <option value="has">Has</option>
              <option value="has_not">Has not</option>
            </select>
            <input
              type="text"
              value={filters.corsMethodValue}
              onChange={(e) => onFieldChange("corsMethodValue", e.target.value)}
              placeholder="GET"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">CORS origin</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.corsOriginMode}
              onChange={(e) =>
                onFieldChange(
                  "corsOriginMode",
                  e.target.value as FeatureDetailFilters["corsOriginMode"]
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="any">Any</option>
              <option value="has">Has</option>
              <option value="has_not">Has not</option>
            </select>
            <input
              type="text"
              value={filters.corsOriginValue}
              onChange={(e) => onFieldChange("corsOriginValue", e.target.value)}
              placeholder="https://example.test"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Logging enabled</label>
          <select
            value={filters.loggingEnabled}
            onChange={(e) =>
              onFieldChange(
                "loggingEnabled",
                e.target.value as FeatureDetailFilters["loggingEnabled"]
              )
            }
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {BOOLEAN_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Logging target bucket</label>
          <input
            type="text"
            value={filters.loggingTargetBucket}
            onChange={(e) => onFieldChange("loggingTargetBucket", e.target.value)}
            placeholder="audit-bucket"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Logging target prefix</label>
          <input
            type="text"
            value={filters.loggingTargetPrefix}
            onChange={(e) => onFieldChange("loggingTargetPrefix", e.target.value)}
            placeholder="logs/"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      </div>
    </div>

    <div className={advancedFilterFieldCardClass()}>
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Website and Policy
      </p>
      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website index present</label>
            <select
              value={filters.websiteIndexPresent}
              onChange={(e) =>
                onFieldChange(
                  "websiteIndexPresent",
                  e.target.value as FeatureDetailFilters["websiteIndexPresent"]
                )
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {BOOLEAN_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website redirect host present</label>
            <select
              value={filters.websiteRedirectHostPresent}
              onChange={(e) =>
                onFieldChange(
                  "websiteRedirectHostPresent",
                  e.target.value as FeatureDetailFilters["websiteRedirectHostPresent"]
                )
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {BOOLEAN_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website index document</label>
            <input
              type="text"
              value={filters.websiteIndexDocument}
              onChange={(e) => onFieldChange("websiteIndexDocument", e.target.value)}
              placeholder="index.html"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website error document</label>
            <input
              type="text"
              value={filters.websiteErrorDocument}
              onChange={(e) => onFieldChange("websiteErrorDocument", e.target.value)}
              placeholder="error.html"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website redirect host</label>
          <input
            type="text"
            value={filters.websiteRedirectHost}
            onChange={(e) => onFieldChange("websiteRedirectHost", e.target.value)}
            placeholder="www.example.test"
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website routing rules</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.websiteRoutingRuleCountOp}
              onChange={(e) =>
                onFieldChange(
                  "websiteRoutingRuleCountOp",
                  e.target.value as NumericComparisonOpUi
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {NUMERIC_FILTER_OPTIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              value={filters.websiteRoutingRuleCount}
              onChange={(e) => onFieldChange("websiteRoutingRuleCount", e.target.value)}
              placeholder="count"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Policy statements</label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            <select
              value={filters.policyStatementOp}
              onChange={(e) =>
                onFieldChange(
                  "policyStatementOp",
                  e.target.value as NumericComparisonOpUi
                )
              }
              className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {NUMERIC_FILTER_OPTIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              value={filters.policyStatementCount}
              onChange={(e) => onFieldChange("policyStatementCount", e.target.value)}
              placeholder="count"
              className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Policy has conditions</label>
          <select
            value={filters.policyHasConditions}
            onChange={(e) =>
              onFieldChange(
                "policyHasConditions",
                e.target.value as FeatureDetailFilters["policyHasConditions"]
              )
            }
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {BOOLEAN_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>

    <div className={advancedFilterFieldCardClass(sseFeatureEnabled ? "" : "opacity-60")}>
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Server-side encryption
      </p>
      {!sseFeatureEnabled && (
        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
          Server-side encryption is disabled on this endpoint.
        </p>
      )}
      <div className="mt-2 space-y-2">
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">SSE algorithm</label>
          <input
            type="text"
            value={filters.sseAlgorithm}
            onChange={(e) => onFieldChange("sseAlgorithm", e.target.value)}
            placeholder="AES256"
            disabled={!sseFeatureEnabled}
            className={advancedFilterControlClass("mt-1 w-full px-2 py-1.5", !sseFeatureEnabled)}
          />
        </div>
        <div>
          <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">SSE KMS key ID</label>
          <input
            type="text"
            value={filters.sseKmsKeyId}
            onChange={(e) => onFieldChange("sseKmsKeyId", e.target.value)}
            placeholder="key-id or ARN"
            disabled={!sseFeatureEnabled}
            className={advancedFilterControlClass("mt-1 w-full px-2 py-1.5", !sseFeatureEnabled)}
          />
        </div>
      </div>
    </div>
    </div>
  );
}

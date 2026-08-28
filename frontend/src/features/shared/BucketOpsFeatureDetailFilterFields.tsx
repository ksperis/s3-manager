/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import {
  type FeatureDetailFilterKey,
  type FeatureDetailFilters,
  type FeatureTriState,
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

type FieldChangeHandler = (
  field: FeatureDetailFilterKey,
  value: FeatureDetailFilters[FeatureDetailFilterKey],
) => void;

type BucketOpsFeatureDetailFilterFieldsProps = {
  filters: FeatureDetailFilters;
  onFieldChange: FieldChangeHandler;
  sseFeatureEnabled: boolean;
};

type FilterControlProps = {
  filters: FeatureDetailFilters;
  onFieldChange: FieldChangeHandler;
};

type SelectOption = {
  label: string;
  value: string;
};

type NumericComparisonFieldKey = {
  [Key in FeatureDetailFilterKey]: FeatureDetailFilters[Key] extends NumericComparisonOpUi
    ? Key
    : never;
}[FeatureDetailFilterKey];

type BooleanFilterFieldKey = {
  [Key in FeatureDetailFilterKey]: FeatureDetailFilters[Key] extends FeatureTriState
    ? Key
    : never;
}[FeatureDetailFilterKey];

type NumericFilterDefinition = {
  label: string;
  opField: NumericComparisonFieldKey;
  placeholder: string;
  valueField: FeatureDetailFilterKey;
};

type PresenceTextFilterDefinition = {
  label: string;
  modeField: FeatureDetailFilterKey;
  placeholder: string;
  valueField: FeatureDetailFilterKey;
};

type BooleanFilterDefinition = {
  field: BooleanFilterFieldKey;
  label: string;
};

const FIELD_LABEL_CLASS =
  "ui-caption font-medium text-slate-700 dark:text-slate-200";
const FULL_CONTROL_CLASS = "mt-1 w-full px-2 py-1.5";
const PAIR_MODE_CONTROL_CLASS = "col-span-2 px-2 py-1.5";
const PAIR_VALUE_CONTROL_CLASS = "col-span-3 px-2 py-1.5";

const PRESENCE_FILTER_OPTIONS: SelectOption[] = [
  { value: "any", label: "Any" },
  { value: "has", label: "Has" },
  { value: "has_not", label: "Has not" },
];
const LIFECYCLE_RULE_NAME_MODE_OPTIONS: SelectOption[] = [
  { value: "any", label: "Any" },
  { value: "has_named", label: "Has named rule" },
  { value: "has_not_named", label: "Has no named rule" },
];
const LIFECYCLE_RULE_TYPE_MODE_OPTIONS: SelectOption[] = [
  { value: "any", label: "Any" },
  { value: "has", label: "Has rule type" },
  { value: "has_not", label: "Has no rule type" },
];
const LIFECYCLE_RULE_STATUS_OPTIONS: SelectOption[] = [
  { value: "", label: "Any" },
  { value: "Enabled", label: "Enabled" },
  { value: "Disabled", label: "Disabled" },
];
const LIFECYCLE_RULE_TYPE_VALUE_OPTIONS: SelectOption[] = [
  { value: "", label: "Select type" },
  ...LIFECYCLE_TYPE_OPTIONS.map((option) => ({
    value: option.key,
    label: option.label,
  })),
];
const NOTIFICATION_RULE_TYPE_VALUE_OPTIONS: SelectOption[] = [
  { value: "", label: "Select type" },
  ...NOTIFICATION_TYPE_OPTIONS.filter(
    (option) => option.key !== "eventbridge",
  ).map((option) => ({
    value: option.key,
    label: option.label,
  })),
];
const OBJECT_LOCK_MODE_OPTIONS: SelectOption[] = [
  { value: "", label: "Any" },
  { value: "GOVERNANCE", label: "GOVERNANCE" },
  { value: "COMPLIANCE", label: "COMPLIANCE" },
];

const LIFECYCLE_NUMERIC_FILTERS: NumericFilterDefinition[] = [
  {
    label: "Expiration days",
    opField: "lifecycleExpirationDaysOp",
    valueField: "lifecycleExpirationDays",
    placeholder: "days",
  },
  {
    label: "Noncurrent expiration days",
    opField: "lifecycleNoncurrentExpirationDaysOp",
    valueField: "lifecycleNoncurrentExpirationDays",
    placeholder: "days",
  },
  {
    label: "Transition days",
    opField: "lifecycleTransitionDaysOp",
    valueField: "lifecycleTransitionDays",
    placeholder: "days",
  },
  {
    label: "Abort days",
    opField: "lifecycleAbortDaysOp",
    valueField: "lifecycleAbortDays",
    placeholder: "days",
  },
];
const NOTIFICATION_PRESENCE_FILTERS: PresenceTextFilterDefinition[] = [
  {
    label: "Event",
    modeField: "notificationEventMode",
    valueField: "notificationEventValue",
    placeholder: "s3:ObjectCreated:*",
  },
  {
    label: "Filter prefix",
    modeField: "notificationFilterPrefixMode",
    valueField: "notificationFilterPrefixValue",
    placeholder: "incoming/",
  },
  {
    label: "Filter suffix",
    modeField: "notificationFilterSuffixMode",
    valueField: "notificationFilterSuffixValue",
    placeholder: ".csv",
  },
];
const OBJECT_LOCK_NUMERIC_FILTERS: NumericFilterDefinition[] = [
  {
    label: "Object Lock retention days",
    opField: "objectLockRetentionOp",
    valueField: "objectLockRetentionDays",
    placeholder: "days",
  },
  {
    label: "Object Lock retention years",
    opField: "objectLockRetentionYearsOp",
    valueField: "objectLockRetentionYears",
    placeholder: "years",
  },
];
const BPA_BOOLEAN_FILTERS: BooleanFilterDefinition[] = [
  { field: "bpaBlockPublicAcls", label: "Block public ACLs" },
  { field: "bpaIgnorePublicAcls", label: "Ignore public ACLs" },
  { field: "bpaBlockPublicPolicy", label: "Block public policy" },
  { field: "bpaRestrictPublicBuckets", label: "Restrict public buckets" },
];
const CORS_PRESENCE_FILTERS: PresenceTextFilterDefinition[] = [
  {
    label: "CORS method",
    modeField: "corsMethodMode",
    valueField: "corsMethodValue",
    placeholder: "GET",
  },
  {
    label: "CORS origin",
    modeField: "corsOriginMode",
    valueField: "corsOriginValue",
    placeholder: "https://example.test",
  },
];
const WEBSITE_BOOLEAN_FILTERS: BooleanFilterDefinition[] = [
  { field: "websiteIndexPresent", label: "Website index present" },
  {
    field: "websiteRedirectHostPresent",
    label: "Website redirect host present",
  },
];
const WEBSITE_NUMERIC_FILTERS: NumericFilterDefinition[] = [
  {
    label: "Website routing rules",
    opField: "websiteRoutingRuleCountOp",
    valueField: "websiteRoutingRuleCount",
    placeholder: "count",
  },
  {
    label: "Policy statements",
    opField: "policyStatementOp",
    valueField: "policyStatementCount",
    placeholder: "count",
  },
];

const fieldId = (field: FeatureDetailFilterKey) =>
  "bucket-ops-feature-detail-" + field;

function FeatureDetailCard({
  children,
  description,
  disabled = false,
  title,
}: {
  children: ReactNode;
  description?: string;
  disabled?: boolean;
  title: string;
}) {
  return (
    <div className={advancedFilterFieldCardClass(disabled ? "opacity-60" : "")}>
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </p>
      {description && (
        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

function TextFilterField({
  className = FULL_CONTROL_CLASS,
  disabled = false,
  field,
  filters,
  label,
  onFieldChange,
  placeholder,
}: FilterControlProps & {
  className?: string;
  disabled?: boolean;
  field: FeatureDetailFilterKey;
  label: string;
  placeholder: string;
}) {
  const id = fieldId(field);
  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={filters[field]}
        onChange={(event) => onFieldChange(field, event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={advancedFilterControlClass(className, disabled)}
      />
    </div>
  );
}

function SelectFilterField({
  className = FULL_CONTROL_CLASS,
  disabled = false,
  field,
  filters,
  label,
  onFieldChange,
  options,
}: FilterControlProps & {
  className?: string;
  disabled?: boolean;
  field: FeatureDetailFilterKey;
  label: string;
  options: SelectOption[];
}) {
  const id = fieldId(field);
  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {label}
      </label>
      <select
        id={id}
        value={filters[field]}
        onChange={(event) => onFieldChange(field, event.target.value)}
        disabled={disabled}
        className={advancedFilterControlClass(className, disabled)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PresenceTextFilterField({
  filters,
  label,
  modeField,
  modeOptions = PRESENCE_FILTER_OPTIONS,
  onFieldChange,
  placeholder,
  valueField,
}: FilterControlProps & PresenceTextFilterDefinition & {
  modeOptions?: SelectOption[];
}) {
  return (
    <div>
      <p className={FIELD_LABEL_CLASS}>{label}</p>
      <div className="mt-1 grid grid-cols-5 gap-2">
        <select
          id={fieldId(modeField)}
          aria-label={label + " mode"}
          value={filters[modeField]}
          onChange={(event) => onFieldChange(modeField, event.target.value)}
          className={advancedFilterControlClass(PAIR_MODE_CONTROL_CLASS)}
        >
          {modeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          id={fieldId(valueField)}
          aria-label={label + " value"}
          type="text"
          value={filters[valueField]}
          onChange={(event) => onFieldChange(valueField, event.target.value)}
          placeholder={placeholder}
          className={advancedFilterControlClass(PAIR_VALUE_CONTROL_CLASS)}
        />
      </div>
    </div>
  );
}

function PresenceSelectFilterField({
  filters,
  label,
  modeField,
  modeOptions,
  onFieldChange,
  valueField,
  valueOptions,
}: FilterControlProps & {
  label: string;
  modeField: FeatureDetailFilterKey;
  modeOptions: SelectOption[];
  valueField: FeatureDetailFilterKey;
  valueOptions: SelectOption[];
}) {
  const valueDisabled = filters[modeField] === "any";
  return (
    <div>
      <p className={FIELD_LABEL_CLASS}>{label}</p>
      <div className="mt-1 grid grid-cols-5 gap-2">
        <select
          id={fieldId(modeField)}
          aria-label={label + " mode"}
          value={filters[modeField]}
          onChange={(event) => onFieldChange(modeField, event.target.value)}
          className={advancedFilterControlClass(PAIR_MODE_CONTROL_CLASS)}
        >
          {modeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          id={fieldId(valueField)}
          aria-label={label + " value"}
          value={filters[valueField]}
          onChange={(event) => onFieldChange(valueField, event.target.value)}
          disabled={valueDisabled}
          className={advancedFilterControlClass(
            PAIR_VALUE_CONTROL_CLASS,
            valueDisabled,
          )}
        >
          {valueOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function NumericComparisonField({
  filters,
  label,
  onFieldChange,
  opField,
  placeholder,
  valueField,
}: FilterControlProps & NumericFilterDefinition) {
  return (
    <div>
      <p className={FIELD_LABEL_CLASS}>{label}</p>
      <div className="mt-1 grid grid-cols-5 gap-2">
        <select
          id={fieldId(opField)}
          aria-label={label + " operator"}
          value={filters[opField]}
          onChange={(event) => onFieldChange(opField, event.target.value)}
          className={advancedFilterControlClass(PAIR_MODE_CONTROL_CLASS)}
        >
          {NUMERIC_FILTER_OPTIONS.map((operator) => (
            <option key={operator} value={operator}>
              {operator}
            </option>
          ))}
        </select>
        <input
          id={fieldId(valueField)}
          aria-label={label + " value"}
          type="number"
          min="0"
          value={filters[valueField]}
          onChange={(event) => onFieldChange(valueField, event.target.value)}
          placeholder={placeholder}
          className={advancedFilterControlClass(PAIR_VALUE_CONTROL_CLASS)}
        />
      </div>
    </div>
  );
}

function BooleanFilterField({
  field,
  filters,
  label,
  onFieldChange,
}: FilterControlProps & BooleanFilterDefinition) {
  return (
    <SelectFilterField
      field={field}
      filters={filters}
      label={label}
      onFieldChange={onFieldChange}
      options={BOOLEAN_FILTER_OPTIONS}
    />
  );
}

export default function BucketOpsFeatureDetailFilterFields({
  filters,
  onFieldChange,
  sseFeatureEnabled,
}: BucketOpsFeatureDetailFilterFieldsProps) {
  const controls = { filters, onFieldChange };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <FeatureDetailCard
        title="Lifecycle"
        description="Rule name, status, type and lifecycle day conditions are evaluated on the same lifecycle rule."
      >
        <PresenceTextFilterField
          {...controls}
          label="Rule name"
          modeField="lifecycleRuleNameMode"
          modeOptions={LIFECYCLE_RULE_NAME_MODE_OPTIONS}
          valueField="lifecycleRuleName"
          placeholder="rule-id"
        />
        <SelectFilterField
          {...controls}
          field="lifecycleRuleStatus"
          label="Rule status"
          options={LIFECYCLE_RULE_STATUS_OPTIONS}
        />
        <PresenceSelectFilterField
          {...controls}
          label="Rule type"
          modeField="lifecycleRuleTypeMode"
          modeOptions={LIFECYCLE_RULE_TYPE_MODE_OPTIONS}
          valueField="lifecycleRuleTypeValue"
          valueOptions={LIFECYCLE_RULE_TYPE_VALUE_OPTIONS}
        />
        {LIFECYCLE_NUMERIC_FILTERS.map((definition) => (
          <NumericComparisonField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
      </FeatureDetailCard>

      <FeatureDetailCard
        title="Notifications"
        description="Rule ID, type, topic, events and key filters are evaluated on the same notification rule."
      >
        <TextFilterField
          {...controls}
          field="notificationRuleId"
          label="Rule ID"
          placeholder="rule-id"
        />
        <PresenceSelectFilterField
          {...controls}
          label="Rule type"
          modeField="notificationRuleTypeMode"
          modeOptions={PRESENCE_FILTER_OPTIONS}
          valueField="notificationRuleTypeValue"
          valueOptions={NOTIFICATION_RULE_TYPE_VALUE_OPTIONS}
        />
        <TextFilterField
          {...controls}
          field="notificationTopicName"
          label="Topic name or ARN"
          placeholder="bucket-events"
        />
        {NOTIFICATION_PRESENCE_FILTERS.map((definition) => (
          <PresenceTextFilterField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
        <BooleanFilterField
          {...controls}
          field="notificationEventBridgePresent"
          label="EventBridge present"
        />
      </FeatureDetailCard>

      <FeatureDetailCard title="Object Lock and BPA">
        <SelectFilterField
          {...controls}
          field="objectLockMode"
          label="Object Lock mode"
          options={OBJECT_LOCK_MODE_OPTIONS}
        />
        {OBJECT_LOCK_NUMERIC_FILTERS.map((definition) => (
          <NumericComparisonField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
        <div className="grid grid-cols-2 gap-2">
          {BPA_BOOLEAN_FILTERS.map((definition) => (
            <BooleanFilterField
              key={definition.field}
              {...controls}
              {...definition}
            />
          ))}
        </div>
      </FeatureDetailCard>

      <FeatureDetailCard title="CORS and Logging">
        {CORS_PRESENCE_FILTERS.map((definition) => (
          <PresenceTextFilterField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
        <BooleanFilterField
          {...controls}
          field="loggingEnabled"
          label="Logging enabled"
        />
        <TextFilterField
          {...controls}
          field="loggingTargetBucket"
          label="Logging target bucket"
          placeholder="audit-bucket"
        />
        <TextFilterField
          {...controls}
          field="loggingTargetPrefix"
          label="Logging target prefix"
          placeholder="logs/"
        />
      </FeatureDetailCard>

      <FeatureDetailCard title="Website and Policy">
        <div className="grid grid-cols-2 gap-2">
          {WEBSITE_BOOLEAN_FILTERS.map((definition) => (
            <BooleanFilterField
              key={definition.field}
              {...controls}
              {...definition}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextFilterField
            {...controls}
            field="websiteIndexDocument"
            label="Website index document"
            placeholder="index.html"
          />
          <TextFilterField
            {...controls}
            field="websiteErrorDocument"
            label="Website error document"
            placeholder="error.html"
          />
        </div>
        <TextFilterField
          {...controls}
          field="websiteRedirectHost"
          label="Website redirect host"
          placeholder="www.example.test"
        />
        {WEBSITE_NUMERIC_FILTERS.map((definition) => (
          <NumericComparisonField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
        <BooleanFilterField
          {...controls}
          field="policyHasConditions"
          label="Policy has conditions"
        />
      </FeatureDetailCard>

      <FeatureDetailCard
        title="Server-side encryption"
        disabled={!sseFeatureEnabled}
      >
        {!sseFeatureEnabled && (
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Server-side encryption is disabled on this endpoint.
          </p>
        )}
        <TextFilterField
          {...controls}
          field="sseAlgorithm"
          label="SSE algorithm"
          placeholder="AES256"
          disabled={!sseFeatureEnabled}
        />
        <TextFilterField
          {...controls}
          field="sseKmsKeyId"
          label="SSE KMS key ID"
          placeholder="key-id or ARN"
          disabled={!sseFeatureEnabled}
        />
      </FeatureDetailCard>
    </div>
  );
}

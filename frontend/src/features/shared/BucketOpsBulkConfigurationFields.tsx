/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import {
  NOTIFICATION_CONFIGURATION_ARRAY_KEYS,
  NOTIFICATION_EVENTBRIDGE_KEY,
} from "../cephAdmin/bucketJsonParsers";
import {
  CORS_TYPE_OPTIONS,
  LIFECYCLE_TYPE_OPTIONS,
  NOTIFICATION_TYPE_OPTIONS,
  POLICY_TYPE_OPTIONS,
} from "./bucketConfigMerge";
import {
  PUBLIC_ACCESS_BLOCK_OPTIONS,
  type QuotaSizeUnit,
} from "./bucketBulkOperationsModel";
import type { useBucketOpsBulkForm } from "./useBucketOpsBulkForm";

type BulkFormController = ReturnType<typeof useBucketOpsBulkForm>;

type JsonConfigurationFieldsProps = {
  description: ReactNode;
  fieldId: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  updateOnlyExisting?: {
    checked: boolean;
    label: string;
    onChange: (checked: boolean) => void;
  };
  value: string;
};

const textAreaClass =
  "w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const numericControlClass =
  "w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const fieldLabelClass =
  "ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const optionCheckboxClass =
  "flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100";

function JsonConfigurationFields({
  description,
  fieldId,
  label,
  onChange,
  placeholder,
  updateOnlyExisting,
  value,
}: JsonConfigurationFieldsProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className={fieldLabelClass}>
        {label}
      </label>
      <textarea
        id={fieldId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        placeholder={placeholder}
        className={textAreaClass}
      />
      <p className="ui-caption text-slate-500 dark:text-slate-400">
        {description}
      </p>
      {updateOnlyExisting && (
        <UiCheckboxField
          checked={updateOnlyExisting.checked}
          onChange={(event) =>
            updateOnlyExisting.onChange(event.target.checked)
          }
          className="ui-caption text-slate-600 dark:text-slate-300"
        >
          {updateOnlyExisting.label}
        </UiCheckboxField>
      )}
    </div>
  );
}

type DeleteCriteriaFieldsProps<Key extends string> = {
  description: string;
  fieldId: string;
  idLabel: string;
  idPlaceholder: string;
  ids: string;
  onIdsChange: (value: string) => void;
  onTypeChange: (key: Key, checked: boolean) => void;
  options: Array<{ key: Key; label: string }>;
  selectedTypes: Record<Key, boolean>;
  typeLabel: string;
};

function DeleteCriteriaFields<Key extends string>({
  description,
  fieldId,
  idLabel,
  idPlaceholder,
  ids,
  onIdsChange,
  onTypeChange,
  options,
  selectedTypes,
  typeLabel,
}: DeleteCriteriaFieldsProps<Key>) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor={fieldId} className={fieldLabelClass}>
          {idLabel}
        </label>
        <textarea
          id={fieldId}
          value={ids}
          onChange={(event) => onIdsChange(event.target.value)}
          rows={4}
          placeholder={idPlaceholder}
          className={textAreaClass}
        />
      </div>
      <div className="space-y-2">
        <p className={fieldLabelClass}>{typeLabel}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <UiCheckboxField
              key={option.key}
              checked={selectedTypes[option.key]}
              onChange={(event) =>
                onTypeChange(option.key, event.target.checked)
              }
              className={optionCheckboxClass}
            >
              {option.label}
            </UiCheckboxField>
          ))}
        </div>
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>
    </div>
  );
}

function QuotaFields({ controller }: { controller: BulkFormController }) {
  const {
    bulkQuotaApplyObjects,
    bulkQuotaApplySize,
    bulkQuotaObjects,
    bulkQuotaSizeUnit,
    bulkQuotaSizeValue,
    bulkQuotaSkipConfigured,
    setBulkQuotaApplyObjects,
    setBulkQuotaApplySize,
    setBulkQuotaObjects,
    setBulkQuotaSizeUnit,
    setBulkQuotaSizeValue,
    setBulkQuotaSkipConfigured,
  } = controller;
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <UiCheckboxField
          checked={bulkQuotaApplySize}
          onChange={(event) => setBulkQuotaApplySize(event.target.checked)}
          className="ui-caption text-slate-600 dark:text-slate-300"
        >
          Update storage quota
        </UiCheckboxField>
        <UiCheckboxField
          checked={bulkQuotaApplyObjects}
          onChange={(event) => setBulkQuotaApplyObjects(event.target.checked)}
          className="ui-caption text-slate-600 dark:text-slate-300"
        >
          Update object quota
        </UiCheckboxField>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="space-y-1">
          <label htmlFor="bucket-ops-bulk-quota-size" className={fieldLabelClass}>
            Storage quota
          </label>
          <input
            id="bucket-ops-bulk-quota-size"
            type="number"
            min={0}
            step="any"
            value={bulkQuotaSizeValue}
            onChange={(event) => setBulkQuotaSizeValue(event.target.value)}
            placeholder="Leave empty to clear"
            disabled={!bulkQuotaApplySize}
            className={numericControlClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="bucket-ops-bulk-quota-unit" className={fieldLabelClass}>
            Unit
          </label>
          <select
            id="bucket-ops-bulk-quota-unit"
            value={bulkQuotaSizeUnit}
            onChange={(event) =>
              setBulkQuotaSizeUnit(event.target.value as QuotaSizeUnit)
            }
            disabled={!bulkQuotaApplySize}
            className={numericControlClass}
          >
            <option value="MiB">MiB</option>
            <option value="GiB">GiB</option>
            <option value="TiB">TiB</option>
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="bucket-ops-bulk-quota-objects" className={fieldLabelClass}>
          Object quota
        </label>
        <input
          id="bucket-ops-bulk-quota-objects"
          type="number"
          min={0}
          step={1}
          value={bulkQuotaObjects}
          onChange={(event) => setBulkQuotaObjects(event.target.value)}
          placeholder="Leave empty to clear"
          disabled={!bulkQuotaApplyObjects}
          className={numericControlClass}
        />
      </div>
      <UiCheckboxField
        checked={bulkQuotaSkipConfigured}
        onChange={(event) => setBulkQuotaSkipConfigured(event.target.checked)}
        className="ui-caption text-slate-600 dark:text-slate-300"
      >
        Do not change buckets that already have a quota.
      </UiCheckboxField>
      <p className="ui-caption text-slate-500 dark:text-slate-400">
        Leave both fields empty to remove quotas from the selected buckets.
      </p>
    </div>
  );
}

function PublicAccessBlockFields({
  controller,
}: {
  controller: BulkFormController;
}) {
  const {
    bulkOperation,
    bulkPublicAccessBlockTargets,
    setBulkPublicAccessBlockTargets,
  } = controller;
  return (
    <div className="space-y-3">
      <p className={fieldLabelClass}>
        Options to {bulkOperation === "add_public_access_block" ? "block" : "unblock"}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {PUBLIC_ACCESS_BLOCK_OPTIONS.map((option) => (
          <UiCheckboxField
            key={option.key}
            checked={bulkPublicAccessBlockTargets[option.key]}
            onChange={(event) => {
              const checked = event.target.checked;
              setBulkPublicAccessBlockTargets((previous) => ({
                ...previous,
                [option.key]: checked,
              }));
            }}
            className={optionCheckboxClass}
          >
            {option.label}
          </UiCheckboxField>
        ))}
      </div>
      <p className="ui-caption text-slate-500 dark:text-slate-400">
        Only selected options are updated. Unselected options remain unchanged.
      </p>
    </div>
  );
}

export default function BucketOpsBulkConfigurationFields({
  controller,
}: {
  controller: BulkFormController;
}) {
  const {
    bulkCorsDeleteIds,
    bulkCorsDeleteTypes,
    bulkCorsRuleText,
    bulkCorsUpdateOnlyExisting,
    bulkLifecycleDeleteIds,
    bulkLifecycleDeleteTypes,
    bulkLifecycleRuleText,
    bulkLifecycleUpdateOnlyExisting,
    bulkNotificationDeleteIds,
    bulkNotificationDeleteTypes,
    bulkNotificationText,
    bulkOperation,
    bulkPolicyDeleteIds,
    bulkPolicyDeleteTypes,
    bulkPolicyText,
    bulkPolicyUpdateOnlyExisting,
    setBulkCorsDeleteIds,
    setBulkCorsDeleteTypes,
    setBulkCorsRuleText,
    setBulkCorsUpdateOnlyExisting,
    setBulkLifecycleDeleteIds,
    setBulkLifecycleDeleteTypes,
    setBulkLifecycleRuleText,
    setBulkLifecycleUpdateOnlyExisting,
    setBulkNotificationDeleteIds,
    setBulkNotificationDeleteTypes,
    setBulkNotificationText,
    setBulkPolicyDeleteIds,
    setBulkPolicyDeleteTypes,
    setBulkPolicyText,
    setBulkPolicyUpdateOnlyExisting,
  } = controller;

  if (bulkOperation === "set_quota") {
    return <QuotaFields controller={controller} />;
  }
  if (
    bulkOperation === "add_public_access_block" ||
    bulkOperation === "remove_public_access_block"
  ) {
    return <PublicAccessBlockFields controller={controller} />;
  }
  if (bulkOperation === "add_lifecycle") {
    return (
      <JsonConfigurationFields
        fieldId="bucket-ops-bulk-lifecycle-rules"
        label="Lifecycle rules (JSON)"
        value={bulkLifecycleRuleText}
        onChange={setBulkLifecycleRuleText}
        placeholder='{"ID":"rule-1","Status":"Enabled","Filter":{"Prefix":"logs/"}}'
        description="Provide a JSON object or array. Rules will be appended, or will replace existing rules with the same ID."
        updateOnlyExisting={{
          checked: bulkLifecycleUpdateOnlyExisting,
          label: "Only update rules that already exist (do not add new rules).",
          onChange: setBulkLifecycleUpdateOnlyExisting,
        }}
      />
    );
  }
  if (bulkOperation === "delete_lifecycle") {
    return (
      <DeleteCriteriaFields
        fieldId="bucket-ops-bulk-lifecycle-delete-ids"
        idLabel="Rule IDs (comma, newline, or JSON array)"
        ids={bulkLifecycleDeleteIds}
        onIdsChange={setBulkLifecycleDeleteIds}
        idPlaceholder='rule-1, rule-2 or ["rule-1","rule-2"]'
        typeLabel="Rule types"
        options={LIFECYCLE_TYPE_OPTIONS}
        selectedTypes={bulkLifecycleDeleteTypes}
        onTypeChange={(key, checked) =>
          setBulkLifecycleDeleteTypes((previous) => ({
            ...previous,
            [key]: checked,
          }))
        }
        description="Rules are deleted if the ID matches or if any selected type is present in the rule."
      />
    );
  }
  if (bulkOperation === "add_notifications") {
    return (
      <JsonConfigurationFields
        fieldId="bucket-ops-bulk-notification-configuration"
        label="Notification configuration (JSON)"
        value={bulkNotificationText}
        onChange={setBulkNotificationText}
        placeholder={`{"${NOTIFICATION_CONFIGURATION_ARRAY_KEYS.topic}":[{"Id":"topic-created","TopicArn":"arn:aws:sns:default:ACCOUNT:topic","Events":["s3:ObjectCreated:*"]}],"${NOTIFICATION_EVENTBRIDGE_KEY}":{}}`}
        description="Provide a bucket notification configuration object. Entries replace existing entries with the same ID; anonymous entries are appended when they are not already present."
      />
    );
  }
  if (bulkOperation === "delete_notifications") {
    return (
      <DeleteCriteriaFields
        fieldId="bucket-ops-bulk-notification-delete-ids"
        idLabel="Notification IDs (comma, newline, or JSON array)"
        ids={bulkNotificationDeleteIds}
        onIdsChange={setBulkNotificationDeleteIds}
        idPlaceholder='topic-created, queue-created or ["topic-created","queue-created"]'
        typeLabel="Notification types"
        options={NOTIFICATION_TYPE_OPTIONS}
        selectedTypes={bulkNotificationDeleteTypes}
        onTypeChange={(key, checked) =>
          setBulkNotificationDeleteTypes((previous) => ({
            ...previous,
            [key]: checked,
          }))
        }
        description="Entries are deleted if the ID matches or if their notification type is selected."
      />
    );
  }
  if (bulkOperation === "add_cors") {
    return (
      <JsonConfigurationFields
        fieldId="bucket-ops-bulk-cors-rules"
        label="CORS rules (JSON)"
        value={bulkCorsRuleText}
        onChange={setBulkCorsRuleText}
        placeholder='{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"]}'
        description="Provide a JSON object or array. Rules are merged by rule ID (if present) or by AllowedOrigins + AllowedMethods."
        updateOnlyExisting={{
          checked: bulkCorsUpdateOnlyExisting,
          label: "Only update rules that already exist (do not add new rules).",
          onChange: setBulkCorsUpdateOnlyExisting,
        }}
      />
    );
  }
  if (bulkOperation === "delete_cors") {
    return (
      <DeleteCriteriaFields
        fieldId="bucket-ops-bulk-cors-delete-ids"
        idLabel="Rule IDs (comma, newline, or JSON array)"
        ids={bulkCorsDeleteIds}
        onIdsChange={setBulkCorsDeleteIds}
        idPlaceholder='rule-1, rule-2 or ["rule-1","rule-2"]'
        typeLabel="Rule types"
        options={CORS_TYPE_OPTIONS}
        selectedTypes={bulkCorsDeleteTypes}
        onTypeChange={(key, checked) =>
          setBulkCorsDeleteTypes((previous) => ({
            ...previous,
            [key]: checked,
          }))
        }
        description="Rules are deleted if the ID matches or if any selected type is present in the rule."
      />
    );
  }
  if (bulkOperation === "add_policy") {
    return (
      <JsonConfigurationFields
        fieldId="bucket-ops-bulk-policy"
        label="Policy (JSON)"
        value={bulkPolicyText}
        onChange={setBulkPolicyText}
        placeholder='{"Version":"2012-10-17","Statement":[{"Sid":"AllowRead","Effect":"Allow","Action":["s3:GetObject"],"Resource":"*","Principal":"*"}]}'
        description="Provide a policy object, a statement array, or a single statement. Statements are merged by Sid or by Effect/Action/Principal/Resource."
        updateOnlyExisting={{
          checked: bulkPolicyUpdateOnlyExisting,
          label:
            "Only update statements that already exist (do not add new statements).",
          onChange: setBulkPolicyUpdateOnlyExisting,
        }}
      />
    );
  }
  if (bulkOperation === "delete_policy") {
    return (
      <DeleteCriteriaFields
        fieldId="bucket-ops-bulk-policy-delete-ids"
        idLabel="Statement IDs (Sid) (comma, newline, or JSON array)"
        ids={bulkPolicyDeleteIds}
        onIdsChange={setBulkPolicyDeleteIds}
        idPlaceholder='AllowRead, DenyWrite or ["AllowRead","DenyWrite"]'
        typeLabel="Statement types"
        options={POLICY_TYPE_OPTIONS}
        selectedTypes={bulkPolicyDeleteTypes}
        onTypeChange={(key, checked) =>
          setBulkPolicyDeleteTypes((previous) => ({
            ...previous,
            [key]: checked,
          }))
        }
        description="Statements are deleted if the Sid matches or if any selected type is present."
      />
    );
  }
  return null;
}

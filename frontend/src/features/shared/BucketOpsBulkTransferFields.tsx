/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import {
  BULK_COPY_FEATURE_LABELS,
  type BulkConfigClipboard,
  type BulkCopyFeatureKey,
  type BulkOperation,
  type BulkPastePlan,
} from "./bucketBulkOperationsModel";
import { normalizeBucketName } from "./bucketOpsPresentation";
import type { useBucketOpsBulkForm } from "./useBucketOpsBulkForm";

type BulkFormController = Pick<
  ReturnType<typeof useBucketOpsBulkForm>,
  | "bulkCopyFeatures"
  | "bulkOperation"
  | "bulkPasteMapping"
  | "setBulkCopyFeatures"
  | "setBulkOperation"
  | "setBulkPasteMapping"
>;

type BucketOpsBulkTransferFieldsProps = {
  clipboard: BulkConfigClipboard | null;
  clipboardSameEndpoint: boolean;
  controller: BulkFormController;
  isStorageOps: boolean;
  pastePlan: BulkPastePlan;
  quotaDisabledReason: string | null;
  scopeDisplayName: string;
  selectedBucketNames: string[];
  selectedCount: number;
  snsFeatureEnabled: boolean;
};

export default function BucketOpsBulkTransferFields({
  clipboard,
  clipboardSameEndpoint,
  controller,
  isStorageOps,
  pastePlan,
  quotaDisabledReason,
  scopeDisplayName,
  selectedBucketNames,
  selectedCount,
  snsFeatureEnabled,
}: BucketOpsBulkTransferFieldsProps) {
  const {
    bulkCopyFeatures,
    bulkOperation,
    bulkPasteMapping,
    setBulkCopyFeatures,
    setBulkOperation,
    setBulkPasteMapping,
  } = controller;
  const clipboardSourceBuckets = useMemo(
    () => clipboard?.buckets.map((bucket) => bucket.name) ?? [],
    [clipboard],
  );
  const clipboardCopiedAtLabel = useMemo(() => {
    if (!clipboard) return null;
    const parsed = new Date(clipboard.copiedAt);
    if (Number.isNaN(parsed.getTime())) return clipboard.copiedAt;
    return parsed.toLocaleString();
  }, [clipboard]);
  const clipboardFeatureLabels = useMemo(() => {
    if (!clipboard) return [];
    return (Object.keys(clipboard.features) as BulkCopyFeatureKey[])
      .filter((feature) => clipboard.features[feature])
      .map((feature) => BULK_COPY_FEATURE_LABELS[feature]);
  }, [clipboard]);

  return (
    <>
      <p className="ui-body text-slate-700 dark:text-slate-200">
        Apply configuration to{" "}
        <span className="font-semibold">
          {selectedCount} bucket{selectedCount > 1 ? "s" : ""}
        </span>
        .
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            htmlFor="bucket-ops-bulk-operation"
            className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            Operation
          </label>
          <select
            id="bucket-ops-bulk-operation"
            value={bulkOperation}
            onChange={(event) =>
              setBulkOperation(event.target.value as BulkOperation)
            }
            className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">Select an S3 API operation</option>
            <optgroup label="Configuration transfer">
              <option value="copy_configs">Copy configurations</option>
              <option value="paste_configs" disabled={!clipboard}>
                {clipboard
                  ? "Paste copied configurations"
                  : "Paste copied configurations (nothing copied)"}
              </option>
            </optgroup>
            <optgroup label="Access and quota">
              {!isStorageOps && (
                <option
                  value="set_quota"
                  disabled={Boolean(quotaDisabledReason)}
                >
                  {quotaDisabledReason
                    ? `Set bucket quota (${quotaDisabledReason})`
                    : "Set bucket quota"}
                </option>
              )}
              <option value="add_public_access_block">
                Add block public access
              </option>
              <option value="remove_public_access_block">
                Remove block public access
              </option>
            </optgroup>
            <optgroup label="Versioning">
              <option value="enable_versioning">Enable versioning</option>
              <option value="disable_versioning">Disable versioning</option>
            </optgroup>
            <optgroup label="Rules and policies">
              <option value="add_lifecycle">
                Add or update lifecycle rules
              </option>
              <option value="delete_lifecycle">Delete lifecycle rules</option>
              <option value="add_notifications" disabled={!snsFeatureEnabled}>
                {snsFeatureEnabled
                  ? "Add or update notification configurations"
                  : "Add or update notification configurations (SNS unavailable)"}
              </option>
              <option
                value="delete_notifications"
                disabled={!snsFeatureEnabled}
              >
                {snsFeatureEnabled
                  ? "Delete notification configurations"
                  : "Delete notification configurations (SNS unavailable)"}
              </option>
              <option value="add_cors">Add or update CORS rules</option>
              <option value="delete_cors">Delete CORS rules</option>
              <option value="add_policy">
                Add or update policy statements
              </option>
              <option value="delete_policy">Delete policy statements</option>
            </optgroup>
          </select>
        </div>
      </div>

      {bulkOperation === "copy_configs" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Configurations to copy
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(BULK_COPY_FEATURE_LABELS) as BulkCopyFeatureKey[])
                .filter((feature) => !isStorageOps || feature !== "quota")
                .map((feature) => (
                  <UiCheckboxField
                    key={feature}
                    checked={bulkCopyFeatures[feature]}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setBulkCopyFeatures((previous) => ({
                        ...previous,
                        [feature]: checked,
                      }));
                    }}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  >
                    {BULK_COPY_FEATURE_LABELS[feature]}
                  </UiCheckboxField>
                ))}
            </div>
          </div>
          {clipboard && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
              <p className="ui-caption text-slate-600 dark:text-slate-300">
                Clipboard currently contains config from{" "}
                <span className="font-semibold">{clipboard.buckets.length}</span>{" "}
                bucket{clipboard.buckets.length > 1 ? "s" : ""} on{" "}
                <span className="font-semibold">
                  {clipboard.sourceEndpointName ??
                    `${scopeDisplayName} #${clipboard.sourceEndpointId}`}
                </span>
                {clipboardCopiedAtLabel
                  ? ` (copied ${clipboardCopiedAtLabel})`
                  : ""}
                .
              </p>
              {clipboardFeatureLabels.length > 0 && (
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  Features: {clipboardFeatureLabels.join(", ")}.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {bulkOperation === "paste_configs" && (
        <div className="space-y-4">
          {!clipboard ? (
            <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
              No copied configuration available. Use "Copy configs" first.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="ui-caption text-slate-700 dark:text-slate-200">
                  Source:{" "}
                  <span className="font-semibold">
                    {clipboard.sourceEndpointName ??
                      `${scopeDisplayName} #${clipboard.sourceEndpointId}`}
                  </span>{" "}
                  · {clipboard.buckets.length} bucket
                  {clipboard.buckets.length > 1 ? "s" : ""} ·
                  {clipboardCopiedAtLabel
                    ? ` copied ${clipboardCopiedAtLabel}`
                    : " copied recently"}
                </p>
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  Destination selection: {selectedBucketNames.length} bucket
                  {selectedBucketNames.length > 1 ? "s" : ""}.
                </p>
                {clipboardFeatureLabels.length > 0 && (
                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                    Pasted features: {clipboardFeatureLabels.join(", ")}.
                  </p>
                )}
              </div>
              {pastePlan.mode === "one_to_many" && (
                <div className="space-y-1 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                    Proposed mapping: 1 source to all selected destinations.
                  </p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Source bucket:{" "}
                    <span className="font-semibold">
                      {clipboard.buckets[0]?.name ?? "-"}
                    </span>
                  </p>
                </div>
              )}
              {pastePlan.mode === "one_to_one" && (
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Proposed mapping (1:1)
                  </p>
                  <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                      <thead className="bg-slate-100 dark:bg-slate-900/60">
                        <tr>
                          <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Source bucket
                          </th>
                          <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Destination bucket
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {clipboardSourceBuckets.map((sourceBucket) => {
                          const usedByOther = new Set(
                            Object.entries(bulkPasteMapping)
                              .filter(
                                ([otherSource, destination]) =>
                                  otherSource !== sourceBucket &&
                                  destination.trim(),
                              )
                              .map(([, destination]) =>
                                normalizeBucketName(destination),
                              ),
                          );
                          return (
                            <tr key={sourceBucket}>
                              <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                                {sourceBucket}
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  aria-label={`Destination bucket for ${sourceBucket}`}
                                  value={bulkPasteMapping[sourceBucket] ?? ""}
                                  onChange={(event) => {
                                    const destination = event.target.value;
                                    setBulkPasteMapping((previous) => ({
                                      ...previous,
                                      [sourceBucket]: destination,
                                    }));
                                  }}
                                  className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                >
                                  <option value="">
                                    Select destination bucket
                                  </option>
                                  {selectedBucketNames.map(
                                    (destinationBucket) => {
                                      const normalizedDestination =
                                        normalizeBucketName(destinationBucket);
                                      const isUsed =
                                        usedByOther.has(normalizedDestination);
                                      const isSameBucketConflict =
                                        clipboardSameEndpoint &&
                                        normalizeBucketName(sourceBucket) ===
                                          normalizedDestination;
                                      return (
                                        <option
                                          key={`${sourceBucket}-${destinationBucket}`}
                                          value={destinationBucket}
                                          disabled={
                                            isUsed || isSameBucketConflict
                                          }
                                        >
                                          {destinationBucket}
                                          {isSameBucketConflict
                                            ? " (same bucket not allowed)"
                                            : isUsed
                                              ? " (already used)"
                                              : ""}
                                        </option>
                                      );
                                    },
                                  )}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!pastePlan.mode && (
                <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                  Mapping impossible with current source/destination selections.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useRef, useState } from "react";

import {
  streamManagerBucketDeleteWithPurge,
  streamCephAdminBucketPurge,
  streamManagerBucketPurge,
  streamStorageOpsBucketPurge,
  type BucketDeleteWithPurgePayload,
  type BucketPurgeBucketResult,
  type BucketPurgeFailure,
  type BucketPurgePayload,
  type BucketPurgeProgress,
  type BucketPurgeResult,
} from "../../api/bucketPurge";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { extractApiError } from "../../utils/apiError";
import { formatCompactNumber, formatNumber } from "../../utils/format";

export type BucketPurgeUiTarget = {
  bucketName: string;
  contextId?: string | null;
  contextName?: string | null;
};

type CommonProps = {
  targets: BucketPurgeUiTarget[];
  onClose: () => void;
  onFinished?: (result: BucketPurgeResult) => void;
};

type BucketPurgeRunModalProps =
  | (CommonProps & {
      mode: "manager";
      contextId: string;
      contextName?: string | null;
    })
  | (CommonProps & {
      mode: "manager-delete";
      contextId: string;
      contextName?: string | null;
    })
  | (CommonProps & {
      mode: "ceph-admin";
      endpointId: number;
      endpointName?: string | null;
    })
  | (CommonProps & {
      mode: "storage-ops";
    });

function statusLabel(status: BucketPurgeResult["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "completed_with_errors") return "Completed with errors";
  if (status === "canceled") return "Canceled";
  return "Failed";
}

function bucketStatusClasses(status: BucketPurgeBucketResult["status"]): string {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100";
  }
  if (status === "completed_with_errors") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100";
  }
  return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100";
}

function surfaceLabel(props: BucketPurgeRunModalProps): string {
  if (props.mode === "manager" || props.mode === "manager-delete") return "Manager";
  if (props.mode === "ceph-admin") return "Ceph Admin";
  return "Storage Ops";
}

function contextLabel(props: BucketPurgeRunModalProps): string {
  if (props.mode === "manager" || props.mode === "manager-delete") return props.contextName || props.contextId;
  if (props.mode === "ceph-admin") return props.endpointName || `Endpoint ${props.endpointId}`;
  return "All selected contexts";
}

function failureTarget(failure: BucketPurgeFailure): string {
  if (failure.key) return failure.key;
  if (failure.stage === "delete_bucket") return "Bucket deletion";
  return failure.stage === "list" ? "Bucket listing" : "DeleteObjects batch";
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function progressDeletedEntries(progress: BucketPurgeProgress): number {
  return progress.deleted_objects + progress.deleted_versions;
}

function progressListedEntries(progress: BucketPurgeProgress): number {
  return progress.listed_objects + progress.listed_versions;
}

function progressTotalEntries(progress: BucketPurgeProgress): number | null {
  const discoveredTotal = Math.max(progressListedEntries(progress), progressDeletedEntries(progress));
  const estimatedTotal = progress.total_entries_estimate ?? null;
  if (estimatedTotal === null) return discoveredTotal > 0 ? discoveredTotal : null;
  return Math.max(estimatedTotal, discoveredTotal);
}

function progressEntriesLabel(progress: BucketPurgeProgress): string {
  const deletedTotal = progressDeletedEntries(progress);
  const totalEntries = progressTotalEntries(progress);
  if (totalEntries === null) {
    return `${formatCompactNumber(deletedTotal)} entries deleted`;
  }
  const totalLabel = progress.total_entries_final
    ? formatCompactNumber(totalEntries)
    : `at least ${formatCompactNumber(totalEntries)}`;
  return `${formatCompactNumber(deletedTotal)} / ${totalLabel} entries deleted`;
}

export default function BucketPurgeRunModal(props: BucketPurgeRunModalProps) {
  const [parallelism, setParallelism] = useState(10);
  const [confirmation, setConfirmation] = useState("");
  const [progress, setProgress] = useState<BucketPurgeProgress | null>(null);
  const [result, setResult] = useState<BucketPurgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const targetCount = props.targets.length;
  const isDeleteMode = props.mode === "manager-delete";
  const deleteTarget = isDeleteMode ? props.targets[0]?.bucketName ?? "" : "";
  const expectedConfirmation = isDeleteMode ? `DELETE BUCKET ${deleteTarget}` : `PURGE ${targetCount} BUCKETS`;
  const confirmationValid = confirmation === expectedConfirmation;
  const targetLabel = isDeleteMode ? "Delete bucket" : `${targetCount} bucket${targetCount > 1 ? "s" : ""}`;
  const operationLabel = isDeleteMode ? "Bucket deletion" : "Purge";
  const progressPercent = useMemo(() => {
    if (!progress) return null;
    const totalEntries = progressTotalEntries(progress);
    const deletedTotal = progressDeletedEntries(progress);
    if (totalEntries !== null && totalEntries > 0) {
      const rawPercent = Math.max(0, Math.min(100, Math.round((deletedTotal / totalEntries) * 100)));
      return progress.total_entries_final ? rawPercent : Math.min(rawPercent, 96);
    }
    if (progress.total_buckets > 0) {
      const rawPercent = Math.max(0, Math.min(100, Math.round((progress.completed_buckets / progress.total_buckets) * 100)));
      return progress.total_entries_final ? rawPercent : Math.min(rawPercent, 96);
    }
    return null;
  }, [progress]);

  const buildPayload = (): BucketPurgePayload | BucketDeleteWithPurgePayload => {
    const basePayload = {
      parallelism: Math.max(1, Math.min(64, Math.trunc(parallelism || 10))),
      confirmation,
    };
    if (isDeleteMode) {
      if (!deleteTarget) {
        throw new Error("Missing bucket to delete.");
      }
      return basePayload;
    }
    const purgePayload: BucketPurgePayload = {
      ...basePayload,
      include_versions: true,
    };
    if (props.mode === "storage-ops") {
      const targets = props.targets.map((target) => {
        const contextId = target.contextId?.trim();
        if (!contextId) {
          throw new Error(`Missing context for bucket ${target.bucketName}.`);
        }
        return {
          context_id: contextId,
          bucket_name: target.bucketName,
        };
      });
      return { ...purgePayload, targets };
    }
    return {
      ...purgePayload,
      buckets: props.targets.map((target) => target.bucketName),
    };
  };

  const runPurge = async () => {
    if (running || targetCount === 0 || !confirmationValid) return;
    setError(null);
    setMessage(null);
    setResult(null);
    setProgress(null);
    let payload: BucketPurgePayload | BucketDeleteWithPurgePayload;
    try {
      payload = buildPayload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid options.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const streamOptions = {
        signal: controller.signal,
        onProgress: (event: BucketPurgeProgress) => setProgress(event),
      };
      const nextResult =
        props.mode === "manager-delete"
          ? await streamManagerBucketDeleteWithPurge(props.contextId, deleteTarget, payload as BucketDeleteWithPurgePayload, streamOptions)
          : props.mode === "manager"
          ? await streamManagerBucketPurge(props.contextId, payload as BucketPurgePayload, streamOptions)
          : props.mode === "ceph-admin"
            ? await streamCephAdminBucketPurge(props.endpointId, payload as BucketPurgePayload, streamOptions)
            : await streamStorageOpsBucketPurge(payload as BucketPurgePayload, streamOptions);
      setResult(nextResult);
      props.onFinished?.(nextResult);
      setMessage(`${operationLabel} ${statusLabel(nextResult.status).toLowerCase()}.`);
    } catch (err) {
      if (isAbortError(err)) {
        setMessage(isDeleteMode ? "Bucket deletion canceled." : "Purge canceled.");
      } else {
        setError(extractApiError(err, isDeleteMode ? "Bucket deletion failed." : "Bucket purge failed."));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancelPurge = () => {
    abortRef.current?.abort();
  };

  const closeModal = () => {
    abortRef.current?.abort();
    props.onClose();
  };

  return (
    <Modal title={isDeleteMode ? "Delete bucket" : "Purge buckets"} onClose={closeModal} maxWidthClass="max-w-7xl" maxBodyHeightClass="max-h-[85vh]">
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {message && (
          <PageBanner tone={result?.status === "completed" ? "success" : result?.status === "failed" ? "error" : "warning"}>
            {message}
          </PageBanner>
        )}

        <div className="space-y-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{targetLabel}</p>
              <p className={cx("ui-caption", uiMutedTextClass)}>
                {surfaceLabel(props)} - {contextLabel(props)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <button
                  type="button"
                  onClick={cancelPurge}
                  className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 ui-caption font-semibold text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={runPurge}
                  disabled={targetCount === 0 || !confirmationValid}
                  className="rounded-md bg-rose-600 px-3 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeleteMode ? "Delete bucket" : "Start purge"}
                </button>
              )}
            </div>
          </div>

          {isDeleteMode ? (
            <PageBanner tone="warning">
              This deletes current objects, historical versions, and delete markers, then removes the bucket and its S3 configuration.
            </PageBanner>
          ) : (
            <PageBanner tone="warning">
              This empties the selected buckets by deleting current objects, historical versions, and delete markers. Buckets and bucket configuration are kept.
            </PageBanner>
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_minmax(260px,360px)]">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
              <p className="ui-caption font-semibold uppercase text-slate-500 dark:text-slate-400">Targets</p>
            </div>
            <div className="max-h-48 overflow-auto divide-y divide-slate-200 dark:divide-slate-800">
              {props.targets.map((target) => (
                <div key={`${target.contextId ?? ""}:${target.bucketName}`} className="px-3 py-2">
                  <p className="break-all ui-body font-semibold text-slate-900 dark:text-slate-100">{target.bucketName}</p>
                  {(target.contextName || target.contextId) && (
                    <p className={cx("ui-caption", uiMutedTextClass)}>{target.contextName || target.contextId}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <label className="space-y-1 ui-caption">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Parallelism</span>
            <input
              type="number"
              min={1}
              max={64}
              value={parallelism}
              disabled={running}
              onChange={(event) => setParallelism(Number(event.target.value))}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          <label className="space-y-1 ui-caption">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              Type {expectedConfirmation}
            </span>
            <input
              type="text"
              value={confirmation}
              disabled={running}
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>

        {progress && (
          <div className="border-y border-slate-200 py-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                {progress.bucket_name ? `${progress.bucket_name} - ${progress.stage}` : progress.stage}
              </p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                {progressEntriesLabel(progress)}
              </p>
            </div>
            {progressPercent === null ? (
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                role="progressbar"
                aria-label="Bucket purge progress"
              >
                <div className="h-full w-full animate-pulse rounded-full bg-rose-500/70" />
              </div>
            ) : (
              <UiProgressBar
                value={progressPercent}
                label="Bucket purge progress"
                className="mt-2 h-2 bg-slate-200 dark:bg-slate-800"
                barClassName="bg-rose-600 transition-[width] duration-150 ease-out"
              />
            )}
            <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
              {formatCompactNumber(progress.completed_buckets)} / {formatCompactNumber(progress.total_buckets)} buckets completed
              {" - "}
              {formatCompactNumber(progress.deleted_objects)} current object(s),{" "}
              {formatCompactNumber(progress.deleted_versions)} version/delete marker entries
              {!progress.total_entries_final ? " - Total still being discovered" : ""}
              {progress.failed_count > 0 ? ` - ${formatCompactNumber(progress.failed_count)} error(s)` : ""}
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className={`grid gap-2 ${isDeleteMode ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
              <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
                <p className="ui-caption text-slate-500 dark:text-slate-400">Objects deleted</p>
                <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{formatNumber(result.deleted_objects)}</p>
              </div>
              <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
                <p className="ui-caption text-slate-500 dark:text-slate-400">Versions/delete markers deleted</p>
                <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{formatNumber(result.deleted_versions)}</p>
              </div>
              <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
                <p className="ui-caption text-slate-500 dark:text-slate-400">Buckets completed</p>
                <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">
                  {formatNumber(result.completed_buckets)} / {formatNumber(result.total_buckets)}
                </p>
              </div>
              <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
                <p className="ui-caption text-slate-500 dark:text-slate-400">Errors</p>
                <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{formatNumber(result.failed_count)}</p>
              </div>
              {isDeleteMode && (
                <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Bucket</p>
                  <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">
                    {result.bucket_deleted ? "Deleted" : "Not deleted"}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {result.buckets.map((bucket) => (
                <details
                  key={`${bucket.context_id ?? ""}:${bucket.bucket_name}`}
                  className="rounded-lg border border-slate-200 dark:border-slate-800"
                >
                  <summary className="cursor-pointer list-none px-3 py-2">
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_repeat(4,minmax(95px,auto))] lg:items-center">
                      <div className="min-w-0">
                        <p className="break-all ui-body font-semibold text-slate-900 dark:text-slate-100">{bucket.bucket_name}</p>
                        {(bucket.context_name || bucket.context_id) && (
                          <p className="ui-caption text-slate-500 dark:text-slate-400">{bucket.context_name || bucket.context_id}</p>
                        )}
                      </div>
                      <div>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 ui-caption font-semibold ${bucketStatusClasses(bucket.status)}`}>
                          {statusLabel(bucket.status)}
                        </span>
                      </div>
                      <div className="ui-caption text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Objects </span>
                        {formatNumber(bucket.deleted_objects)}
                      </div>
                      <div className="ui-caption text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Versions </span>
                        {formatNumber(bucket.deleted_versions)}
                      </div>
                      <div className="ui-caption text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Errors </span>
                        {formatNumber(bucket.failed_count)}
                      </div>
                      <div className="ui-caption text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Duration </span>
                        {bucket.duration_seconds < 1
                          ? `${Math.round(bucket.duration_seconds * 1000)} ms`
                          : `${bucket.duration_seconds.toFixed(bucket.duration_seconds >= 10 ? 0 : 1)} s`}
                      </div>
                    </div>
                  </summary>
                  <div className="space-y-2 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                    {bucket.failed_count > bucket.failures_sample.length && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 ui-caption font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
                        Only {formatNumber(bucket.failures_sample.length)} of {formatNumber(bucket.failed_count)} error(s) are visible.
                      </p>
                    )}
                    {bucket.failures_sample.length > 0 ? (
                      <div className="max-h-72 overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
                        <table className="min-w-full divide-y divide-slate-200 ui-caption dark:divide-slate-800">
                          <thead className="bg-slate-50 dark:bg-slate-900/70">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold uppercase text-slate-500 dark:text-slate-400">Stage</th>
                              <th className="px-3 py-2 text-left font-semibold uppercase text-slate-500 dark:text-slate-400">Target</th>
                              <th className="px-3 py-2 text-left font-semibold uppercase text-slate-500 dark:text-slate-400">Version</th>
                              <th className="px-3 py-2 text-left font-semibold uppercase text-slate-500 dark:text-slate-400">Count</th>
                              <th className="px-3 py-2 text-left font-semibold uppercase text-slate-500 dark:text-slate-400">Message</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {bucket.failures_sample.map((failure, index) => (
                              <tr key={`${failure.key ?? "bucket"}:${failure.version_id ?? ""}:${failure.stage}:${index}`}>
                                <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{failure.stage}</td>
                                <td className="break-all px-3 py-2 font-mono text-[11px] text-slate-900 dark:text-slate-100">
                                  {failureTarget(failure)}
                                </td>
                                <td className="break-all px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                  {failure.version_id || "-"}
                                </td>
                                <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{formatNumber(failure.count)}</td>
                                <td className="min-w-[18rem] px-3 py-2 text-slate-700 dark:text-slate-200">{failure.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200">
                        No purge error reported for this bucket.
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

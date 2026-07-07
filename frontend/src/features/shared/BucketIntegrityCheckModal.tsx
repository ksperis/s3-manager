/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useRef, useState } from "react";

import {
  streamCephAdminBucketIntegrityCheck,
  streamManagerBucketIntegrityCheck,
  streamStorageOpsBucketIntegrityCheck,
  type BucketIntegrityBucketResult,
  type BucketIntegrityCheckMode,
  type BucketIntegrityCheckPayload,
  type BucketIntegrityFailure,
  type BucketIntegrityProgress,
  type BucketIntegrityResult,
} from "../../api/bucketIntegrity";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiProgressBar from "../../components/ui/UiProgressBar";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatNumber } from "../../utils/format";

export type BucketIntegrityUiTarget = {
  bucketName: string;
  contextId?: string | null;
  contextName?: string | null;
};

type CommonProps = {
  targets: BucketIntegrityUiTarget[];
  onClose: () => void;
};

type BucketIntegrityCheckModalProps =
  | (CommonProps & {
      mode: "manager";
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

function formatSeconds(value?: number | null): string {
  if (value === undefined || value === null) return "-";
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  return `${value.toFixed(value >= 10 ? 0 : 1)} s`;
}

function statusLabel(status: BucketIntegrityResult["status"]): string {
  if (status === "passed") return "Passed";
  if (status === "completed_with_errors") return "Completed with errors";
  if (status === "canceled") return "Canceled";
  return "Failed";
}

function bucketStatusClasses(status: BucketIntegrityResult["status"]): string {
  if (status === "passed") return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:border-emerald-500/30";
  if (status === "completed_with_errors") return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:border-amber-500/30";
  return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-100 dark:border-rose-500/30";
}

function formatFailureTarget(failure: BucketIntegrityFailure): string {
  if (failure.key) return failure.key;
  return failure.stage === "list" ? "Bucket listing" : "Object";
}

function bucketMatchesSearch(bucket: BucketIntegrityBucketResult, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    bucket.bucket_name,
    bucket.context_name ?? "",
    bucket.context_id ?? "",
    bucket.status,
    statusLabel(bucket.status),
    ...bucket.failures_sample.flatMap((failure) => [
      failure.stage,
      failure.key ?? "",
      failure.version_id ?? "",
      failure.message,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function parseOptionalSince(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Since must be a valid date.");
  }
  return parsed.toISOString();
}

function parseOptionalMaxMb(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Max MB per object must be greater than zero.");
  }
  return parsed;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

const CHECK_MODE_OPTIONS: Array<{ value: BucketIntegrityCheckMode; label: string }> = [
  { value: "head", label: "HEAD only" },
  { value: "get", label: "GET body" },
];

export default function BucketIntegrityCheckModal(props: BucketIntegrityCheckModalProps) {
  const [parallelism, setParallelism] = useState(10);
  const [allVersions, setAllVersions] = useState(false);
  const [checkMode, setCheckMode] = useState<BucketIntegrityCheckMode>("head");
  const [since, setSince] = useState("");
  const [maxMb, setMaxMb] = useState("");
  const [progress, setProgress] = useState<BucketIntegrityProgress | null>(null);
  const [result, setResult] = useState<BucketIntegrityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resultSearch, setResultSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BucketIntegrityResult["status"]>("all");
  const [errorFilter, setErrorFilter] = useState<"all" | "with_errors" | "without_errors">("all");
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const targetCount = props.targets.length;
  const targetLabel = `${targetCount} bucket${targetCount > 1 ? "s" : ""}`;
  const progressPercent = useMemo(() => {
    if (!progress || progress.listed_count <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((progress.checked_count / progress.listed_count) * 100)));
  }, [progress]);
  const filteredBucketResults = useMemo(() => {
    if (!result) return [];
    const needle = resultSearch.trim().toLowerCase();
    return result.buckets.filter((bucket) => {
      if (statusFilter !== "all" && bucket.status !== statusFilter) return false;
      if (errorFilter === "with_errors" && bucket.failed_count === 0) return false;
      if (errorFilter === "without_errors" && bucket.failed_count > 0) return false;
      return bucketMatchesSearch(bucket, needle);
    });
  }, [errorFilter, result, resultSearch, statusFilter]);

  const buildPayload = (): BucketIntegrityCheckPayload => {
    const maxMbPerObject = checkMode === "get" ? parseOptionalMaxMb(maxMb) : null;
    const sinceIso = parseOptionalSince(since);
    const basePayload: BucketIntegrityCheckPayload = {
      parallelism: Math.max(1, Math.min(64, Math.trunc(parallelism || 10))),
      all_versions: allVersions,
      check_mode: checkMode,
      since: sinceIso || undefined,
      max_mb_per_object: checkMode === "get" ? maxMbPerObject || undefined : undefined,
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
      return { ...basePayload, targets };
    }
    return {
      ...basePayload,
      buckets: props.targets.map((target) => target.bucketName),
    };
  };

  const runCheck = async () => {
    if (running || targetCount === 0) return;
    setError(null);
    setMessage(null);
    setResult(null);
    setProgress(null);
    let payload: BucketIntegrityCheckPayload;
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
        onProgress: (event: BucketIntegrityProgress) => setProgress(event),
      };
      const nextResult =
        props.mode === "manager"
          ? await streamManagerBucketIntegrityCheck(props.contextId, payload, streamOptions)
          : props.mode === "ceph-admin"
            ? await streamCephAdminBucketIntegrityCheck(props.endpointId, payload, streamOptions)
            : await streamStorageOpsBucketIntegrityCheck(payload, streamOptions);
      setResult(nextResult);
      setMessage(`Check ${statusLabel(nextResult.status).toLowerCase()}.`);
    } catch (err) {
      if (isAbortError(err)) {
        setMessage("Check canceled.");
      } else {
        setError(extractApiError(err, "Bucket integrity check failed."));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancelCheck = () => {
    abortRef.current?.abort();
  };

  const closeModal = () => {
    abortRef.current?.abort();
    props.onClose();
  };

  return (
    <Modal title="Check bucket integrity" onClose={closeModal} maxWidthClass="max-w-7xl" maxBodyHeightClass="max-h-[85vh]">
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {message && <PageBanner tone={result?.status === "passed" ? "success" : result?.status === "failed" ? "error" : "warning"}>{message}</PageBanner>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <div>
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{targetLabel}</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              {props.mode === "manager"
                ? props.contextName || props.contextId
                : props.mode === "ceph-admin"
                  ? props.endpointName || `Endpoint ${props.endpointId}`
                  : "Storage Ops"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <UiButton
                type="button"
                onClick={cancelCheck}
                variant="danger"
                size="sm"
              >
                Cancel
              </UiButton>
            ) : (
              <UiButton
                type="button"
                onClick={runCheck}
                disabled={targetCount === 0}
                variant="primary"
                size="sm"
              >
                Run check
              </UiButton>
            )}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="space-y-1 ui-caption">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Mode</span>
            <UiSegmentedControl
              ariaLabel="Bucket integrity check mode"
              options={CHECK_MODE_OPTIONS.map((option) => ({ ...option, disabled: running }))}
              value={checkMode}
              onChange={setCheckMode}
            />
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
            <span className="font-semibold text-slate-700 dark:text-slate-200">Since</span>
            <input
              type="datetime-local"
              value={since}
              disabled={running}
              onChange={(event) => setSince(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="space-y-1 ui-caption">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Max MB per object</span>
            <input
              type="number"
              min={0}
              step="0.1"
              value={maxMb}
              disabled={running || checkMode === "head"}
              onChange={(event) => setMaxMb(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-900/50 dark:disabled:text-slate-500"
            />
          </label>
          <label className="flex items-center gap-2 self-end rounded-md border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={allVersions}
              disabled={running}
              onChange={(event) => setAllVersions(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30 dark:border-slate-600"
            />
            All versions
          </label>
        </div>

        {progress && (
          <div className="border-y border-slate-200 py-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                {progress.bucket_name ? `${progress.bucket_name} - ${progress.stage}` : progress.stage}
              </p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                {formatNumber(progress.checked_count)} / {formatNumber(progress.listed_count)} objects - {formatBytes(progress.bytes_read)}
              </p>
            </div>
            <UiProgressBar
              value={progressPercent ?? 100}
              label="Bucket integrity progress"
              className="mt-2 h-2 overflow-hidden bg-slate-200 dark:bg-slate-800"
              barClassName="bg-primary transition-[width] duration-150 ease-out"
            />
            <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
              {formatNumber(progress.completed_buckets)} / {formatNumber(progress.total_buckets)} buckets completed
              {progress.failed_count > 0 ? ` - ${formatNumber(progress.failed_count)} errors` : ""}
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
                <p className="ui-caption text-slate-500 dark:text-slate-400">Objects listed</p>
                <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{formatNumber(result.listed_count)}</p>
              </div>
              <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
                <p className="ui-caption text-slate-500 dark:text-slate-400">Objects checked</p>
                <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{formatNumber(result.checked_count)}</p>
              </div>
              <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
                <p className="ui-caption text-slate-500 dark:text-slate-400">Errors</p>
                <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{formatNumber(result.failed_count)}</p>
              </div>
              <div className="border-b border-slate-200 pb-2 dark:border-slate-800">
                <p className="ui-caption text-slate-500 dark:text-slate-400">Bytes read</p>
                <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{formatBytes(result.bytes_read)}</p>
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40 lg:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
              <input
                type="text"
                value={resultSearch}
                onChange={(event) => setResultSearch(event.target.value)}
                placeholder="Filter by bucket, context, object, or error"
                className="w-full rounded-md border border-slate-300 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <select
                aria-label="Filter integrity status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | BucketIntegrityResult["status"])}
                className="w-full rounded-md border border-slate-300 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="all">All statuses</option>
                <option value="passed">Passed</option>
                <option value="completed_with_errors">Completed with errors</option>
                <option value="failed">Failed</option>
                <option value="canceled">Canceled</option>
              </select>
              <select
                aria-label="Filter integrity errors"
                value={errorFilter}
                onChange={(event) => setErrorFilter(event.target.value as "all" | "with_errors" | "without_errors")}
                className="w-full rounded-md border border-slate-300 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="all">All error states</option>
                <option value="with_errors">With errors</option>
                <option value="without_errors">Without errors</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setResultSearch("");
                  setStatusFilter("all");
                  setErrorFilter("all");
                }}
                className="rounded-md border border-slate-300 px-3 py-2 ui-caption font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-500"
              >
                Reset filters
              </button>
            </div>
            <p className="ui-caption text-slate-600 dark:text-slate-300">
              Showing {formatNumber(filteredBucketResults.length)} / {formatNumber(result.buckets.length)} bucket result(s).
            </p>
            <div className="space-y-2">
              {filteredBucketResults.map((bucket) => (
                <details
                  key={`${bucket.context_id ?? ""}:${bucket.bucket_name}`}
                  className="rounded-lg border border-slate-200 dark:border-slate-800"
                >
                  <summary className="cursor-pointer list-none px-3 py-2">
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_repeat(5,minmax(86px,auto))] lg:items-center">
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
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Listed </span>
                        {formatNumber(bucket.listed_count)}
                      </div>
                      <div className="ui-caption text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Checked </span>
                        {formatNumber(bucket.checked_count)}
                      </div>
                      <div className="ui-caption text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Errors </span>
                        {formatNumber(bucket.failed_count)}
                      </div>
                      <div className="ui-caption text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Read </span>
                        {formatBytes(bucket.bytes_read)}
                      </div>
                      <div className="ui-caption text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Duration </span>
                        {formatSeconds(bucket.duration_seconds)}
                      </div>
                    </div>
                  </summary>
                  <div className="space-y-2 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="ui-caption font-semibold uppercase text-slate-500 dark:text-slate-400">Affected objects</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        {formatNumber(bucket.failures_sample.length)} visible / {formatNumber(bucket.failed_count)} total error(s)
                      </p>
                    </div>
                    {bucket.failed_count > bucket.failures_sample.length && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 ui-caption font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
                        Only {formatNumber(bucket.failures_sample.length)} of {formatNumber(bucket.failed_count)} affected object(s) are visible.
                      </p>
                    )}
                    {bucket.failures_sample.length > 0 ? (
                      <div className="max-h-72 overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
                        <table className="min-w-full divide-y divide-slate-200 ui-caption dark:divide-slate-800">
                          <thead className="bg-slate-50 dark:bg-slate-900/70">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold uppercase text-slate-500 dark:text-slate-400">Stage</th>
                              <th className="px-3 py-2 text-left font-semibold uppercase text-slate-500 dark:text-slate-400">Object</th>
                              <th className="px-3 py-2 text-left font-semibold uppercase text-slate-500 dark:text-slate-400">Version</th>
                              <th className="px-3 py-2 text-left font-semibold uppercase text-slate-500 dark:text-slate-400">Message</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {bucket.failures_sample.map((failure, index) => (
                              <tr key={`${failure.key ?? "bucket"}:${failure.version_id ?? ""}:${index}`}>
                                <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{failure.stage}</td>
                                <td className="break-all px-3 py-2 font-mono text-[11px] text-slate-900 dark:text-slate-100">
                                  {formatFailureTarget(failure)}
                                </td>
                                <td className="break-all px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                  {failure.version_id || "-"}
                                </td>
                                <td className="min-w-[18rem] px-3 py-2 text-slate-700 dark:text-slate-200">{failure.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200">
                        No affected objects reported for this bucket.
                      </p>
                    )}
                  </div>
                </details>
              ))}
              {filteredBucketResults.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 ui-body text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  No bucket result matches the current filters.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useRef, useState } from "react";

import {
  streamCephAdminBucketUsageStats,
  streamStorageOpsBucketUsageStats,
  type BucketUsageStatsPayload,
  type BucketUsageStatsProgress,
  type BucketUsageStatsResult,
} from "../../api/bucketUsageStats";
import PageBanner from "../../components/PageBanner";
import WorkflowPage from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import {
  BucketOperationSummaryStat,
  bucketOperationTableBodyClass,
  bucketOperationTableClass,
  bucketOperationTableContainerClass,
  bucketOperationTableHeadClass,
  bucketOperationTableHeaderClass,
  bucketOperationTableHeaderRightClass,
} from "./bucketOperationRunUi";

export type BucketUsageStatsUiTarget = {
  bucketName: string;
  contextId?: string | null;
  contextName?: string | null;
};

type CommonProps = {
  targets: BucketUsageStatsUiTarget[];
  onClose: () => void;
  onCompleted?: () => void;
};

type BucketUsageStatsRunModalProps =
  | (CommonProps & {
      mode: "ceph-admin";
      endpointId: number;
      endpointName?: string | null;
    })
  | (CommonProps & {
      mode: "storage-ops";
    });

function statusLabel(status: BucketUsageStatsResult["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "completed_with_warnings") return "Completed with warnings";
  if (status === "canceled") return "Canceled";
  return "Failed";
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export default function BucketUsageStatsRunModal(props: BucketUsageStatsRunModalProps) {
  const [parallelism, setParallelism] = useState(8);
  const [progress, setProgress] = useState<BucketUsageStatsProgress | null>(null);
  const [result, setResult] = useState<BucketUsageStatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const targetCount = props.targets.length;
  const targetLabel = `${targetCount} bucket${targetCount > 1 ? "s" : ""}`;
  const progressPercent = useMemo(() => {
    if (!progress || progress.total_buckets <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((progress.completed_buckets / progress.total_buckets) * 100)));
  }, [progress]);

  const buildPayload = (): BucketUsageStatsPayload => {
    const basePayload: BucketUsageStatsPayload = {
      parallelism: Math.max(1, Math.min(32, Math.trunc(parallelism || 8))),
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

  const runCalculation = async () => {
    if (running || targetCount === 0) return;
    setError(null);
    setMessage(null);
    setResult(null);
    setProgress(null);
    let payload: BucketUsageStatsPayload;
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
        onProgress: (event: BucketUsageStatsProgress) => setProgress(event),
      };
      const nextResult =
        props.mode === "ceph-admin"
          ? await streamCephAdminBucketUsageStats(props.endpointId, payload, streamOptions)
          : await streamStorageOpsBucketUsageStats(payload, streamOptions);
      setResult(nextResult);
      setMessage(`Calculation ${statusLabel(nextResult.status).toLowerCase()}.`);
      if (nextResult.status !== "failed") {
        props.onCompleted?.();
      }
    } catch (err) {
      if (isAbortError(err)) {
        setMessage("Calculation canceled.");
      } else {
        setError(extractApiError(err, "Bucket usage stats calculation failed."));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancelCalculation = () => {
    abortRef.current?.abort();
  };

  const closeModal = () => {
    abortRef.current?.abort();
    props.onClose();
  };

  const workspaceLabel = props.mode === "ceph-admin" ? "Ceph Admin" : "Storage Ops";
  const bucketsPath = props.mode === "ceph-admin" ? "/ceph-admin/buckets" : "/storage-ops/buckets";

  return (
    <WorkflowPage
      title="Calculate bucket usage stats"
      description="Run the calculation as a page-level task and keep progress and per-bucket results visible."
      breadcrumbs={[{ label: workspaceLabel }, { label: "Buckets", to: bucketsPath }, { label: "Usage stats" }]}
      onBack={closeModal}
      backLabel={running ? "Stop and return" : "Back to buckets"}
      contentClassName="min-w-0"
    >
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {message && <PageBanner tone={result?.status === "completed" ? "success" : result?.status === "failed" ? "error" : "warning"}>{message}</PageBanner>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <div>
            <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{targetLabel}</p>
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {props.mode === "ceph-admin" ? props.endpointName || `Endpoint ${props.endpointId}` : "Storage Ops"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UiInput
              label="Parallelism"
              type="number"
              min={1}
              max={32}
              value={parallelism}
              disabled={running}
              onChange={(event) => setParallelism(Number(event.target.value))}
              fieldClassName="w-24"
              size="compact"
            />
            {running ? (
              <UiButton
                type="button"
                onClick={cancelCalculation}
                variant="danger"
                size="sm"
              >
                Cancel
              </UiButton>
            ) : (
              <UiButton
                type="button"
                onClick={runCalculation}
                disabled={targetCount === 0}
                variant="primary"
                size="sm"
              >
                Run calculation
              </UiButton>
            )}
          </div>
        </div>

        {progress && (
          <div className="border-y border-slate-200 py-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                {progress.bucket_name ? `${progress.bucket_name} - ${progress.stage}` : progress.stage}
              </p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                {formatCompactNumber(progress.listed_versions)} version(s) - {formatBytes(progress.total_bytes)}
              </p>
            </div>
            <UiProgressBar
              value={progressPercent ?? 100}
              label="Bucket usage stats progress"
              className="mt-2 h-2 overflow-hidden bg-slate-200 dark:bg-slate-800"
              barClassName="bg-primary transition-[width] duration-150 ease-out"
            />
            <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
              {formatCompactNumber(progress.completed_buckets)} / {formatCompactNumber(progress.total_buckets)} buckets completed
              {progress.listed_delete_markers > 0 ? ` - ${formatCompactNumber(progress.listed_delete_markers)} delete markers` : ""}
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <BucketOperationSummaryStat label="Versions listed" value={formatCompactNumber(result.listed_versions)} />
              <BucketOperationSummaryStat label="Logical bytes" value={formatBytes(result.total_bytes)} />
              <BucketOperationSummaryStat label="Delete markers" value={formatCompactNumber(result.listed_delete_markers)} />
              <BucketOperationSummaryStat label="Failed buckets" value={formatCompactNumber(result.failed_buckets)} />
            </div>
            <div className={bucketOperationTableContainerClass}>
              <table className={bucketOperationTableClass}>
                <thead className={bucketOperationTableHeadClass}>
                  <tr>
                    <th className={bucketOperationTableHeaderClass}>Bucket</th>
                    <th className={bucketOperationTableHeaderClass}>Status</th>
                    <th className={bucketOperationTableHeaderRightClass}>Bytes</th>
                    <th className={bucketOperationTableHeaderRightClass}>Versions</th>
                    <th className={bucketOperationTableHeaderClass}>Notes</th>
                  </tr>
                </thead>
                <tbody className={bucketOperationTableBodyClass}>
                  {result.buckets.map((bucket) => (
                    <tr key={`${bucket.context_id ?? ""}:${bucket.bucket_name}`}>
                      <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">{bucket.bucket_name}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{bucket.status.replace(/_/g, " ")}</td>
                      <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{formatBytes(bucket.snapshot?.total_bytes ?? 0)}</td>
                      <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{formatCompactNumber(bucket.snapshot?.object_version_count ?? 0)}</td>
                      <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{bucket.message || bucket.snapshot?.warnings?.[0] || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!result && !progress && (
          <div className={cx(uiCardMutedClass, "px-4 py-3")}>
            <p className={cx("ui-body font-semibold", uiTitleTextClass)}>Ready to calculate</p>
            <p className={cx("ui-caption", uiMutedTextClass)}>
              The calculation lists object versions first. If an endpoint does not support version listing, it falls back to current objects only.
            </p>
          </div>
        )}
      </div>
    </WorkflowPage>
  );
}

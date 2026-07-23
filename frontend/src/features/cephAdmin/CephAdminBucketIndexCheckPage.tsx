/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useRef, useState } from "react";

import {
  streamCephAdminBucketIndexChecks,
  type BucketIndexCheckProgress,
  type BucketIndexCheckResult,
  type BucketIndexCheckTarget,
} from "../../api/bucketIndexCheck";
import PageBanner from "../../components/PageBanner";
import WorkflowPage from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatNumber } from "../../utils/format";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";

type Props = {
  endpointId: number;
  endpointName?: string | null;
  targets: BucketIndexCheckTarget[];
  onClose: () => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function CephAdminBucketIndexCheckPage({ endpointId, endpointName, targets, onClose }: Props) {
  const [parallelism, setParallelism] = useState(4);
  const [progress, setProgress] = useState<BucketIndexCheckProgress | null>(null);
  const [result, setResult] = useState<BucketIndexCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const progressPercent = useMemo(() => {
    if (!progress || progress.total_buckets <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((progress.completed_buckets / progress.total_buckets) * 100)));
  }, [progress]);

  const runChecks = async () => {
    if (running || targets.length === 0 || targets.length > 200) return;
    setError(null);
    setMessage(null);
    setResult(null);
    setProgress(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const nextResult = await streamCephAdminBucketIndexChecks(
        endpointId,
        { targets, parallelism: Math.max(1, Math.min(16, Math.trunc(parallelism || 4))) },
        { signal: controller.signal, onProgress: setProgress }
      );
      setResult(nextResult);
      setMessage(
        nextResult.status === "completed"
          ? "All bucket index checks completed."
          : `${formatNumber(nextResult.failed_buckets)} bucket index check${nextResult.failed_buckets === 1 ? "" : "s"} failed.`
      );
    } catch (runError) {
      if (isAbortError(runError)) {
        setMessage("Bucket index checks canceled.");
      } else {
        setError(extractApiError(runError, "Bucket index checks failed."));
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const closePage = () => {
    abortRef.current?.abort();
    onClose();
  };

  return (
    <WorkflowPage
      title="Check bucket indexes"
      description="Run read-only RGW Admin Ops diagnostics across the selected buckets and review each result."
      breadcrumbs={cephAdminPageBreadcrumbs("buckets", { label: "Index checks" })}
      onBack={closePage}
      backLabel={running ? "Stop and return" : "Back to bucket selection"}
      contentClassName="min-w-0"
    >
      <div className="space-y-4">
        <PageBanner tone="warning">
          This bulk action is read-only. Index repairs remain available only from the unitary RGW Admin Ops action.
        </PageBanner>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {message && <PageBanner tone={result?.status === "completed" ? "success" : "warning"}>{message}</PageBanner>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--ui-border-soft)] pb-3">
          <div>
            <p className={cx("ui-body font-semibold", uiTitleTextClass)}>
              {targets.length} bucket{targets.length > 1 ? "s" : ""}
            </p>
            <p className={cx("ui-caption", uiMutedTextClass)}>{endpointName || `Endpoint ${endpointId}`} · RGW Admin Ops</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UiInput
              label="Parallelism"
              type="number"
              min={1}
              max={16}
              value={parallelism}
              disabled={running}
              onChange={(event) => setParallelism(Number(event.target.value))}
              fieldClassName="w-24"
              size="compact"
            />
            {running ? (
              <UiButton variant="danger" size="sm" onClick={() => abortRef.current?.abort()}>
                Cancel
              </UiButton>
            ) : (
              <UiButton size="sm" onClick={() => void runChecks()} disabled={targets.length === 0 || targets.length > 200}>
                Run index checks
              </UiButton>
            )}
          </div>
        </div>

        {progress && (
          <div className="space-y-2 border-b border-[color:var(--ui-border-soft)] pb-4">
            <div className="flex items-center justify-between gap-2 ui-caption font-semibold">
              <span>{progress.message || "Checking bucket indexes"}</span>
              <span>{progressPercent}%</span>
            </div>
            <UiProgressBar value={progressPercent} label="Bucket index check progress" />
          </div>
        )}

        <div className="overflow-x-auto rounded-md border border-[color:var(--ui-border-soft)]">
          <table className="manager-table min-w-full">
            <thead>
              <tr>
                <th className="text-left">Bucket</th>
                <th className="text-left">Tenant</th>
                <th className="text-left">Status</th>
                <th className="text-left">Result</th>
              </tr>
            </thead>
            <tbody>
              {(result?.buckets ?? targets.map((target) => ({ ...target, status: "pending" as const, message: "Not run yet" }))).map((item) => (
                <tr key={`${item.tenant ?? ""}:${item.name}`}>
                  <td className="font-mono ui-caption">{item.name}</td>
                  <td>{item.tenant || "—"}</td>
                  <td>
                    <span className={item.status === "completed" ? "text-emerald-700 dark:text-emerald-300" : item.status === "failed" ? "text-rose-700 dark:text-rose-300" : uiMutedTextClass}>
                      {item.status === "completed" ? "Completed" : item.status === "failed" ? "Failed" : "Pending"}
                    </span>
                  </td>
                  <td className="max-w-xl whitespace-normal">{item.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </WorkflowPage>
  );
}

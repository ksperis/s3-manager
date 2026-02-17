/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../../components/Modal";
import {
  CephAdminBucketCompareResult,
  CephAdminEndpoint,
  compareCephAdminBucketPair,
  listCephAdminBuckets,
} from "../../api/cephAdmin";

type CompareMapping = {
  sourceBucket: string;
  targetBucket: string;
};

type CompareRunItem = {
  sourceBucket: string;
  targetBucket: string;
  status: "pending" | "running" | "success" | "failed";
  result?: CephAdminBucketCompareResult;
  error?: string;
};

type CephAdminBucketCompareModalProps = {
  sourceEndpointId: number;
  sourceEndpointName?: string | null;
  sourceBuckets: string[];
  endpoints: CephAdminEndpoint[];
  onClose: () => void;
};

const extractError = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    return ((err.response?.data as { detail?: string } | undefined)?.detail || err.message || "Unexpected error");
  }
  return err instanceof Error ? err.message : "Unexpected error";
};

const runWithConcurrencySettled = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>,
  onSettled?: (result: PromiseSettledResult<R>, index: number) => void
): Promise<PromiseSettledResult<R>[]> => {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      try {
        const value = await handler(items[index], index);
        const result: PromiseSettledResult<R> = { status: "fulfilled", value };
        results[index] = result;
        onSettled?.(result, index);
      } catch (err) {
        const result: PromiseSettledResult<R> = { status: "rejected", reason: err };
        results[index] = result;
        onSettled?.(result, index);
      }
    }
  });
  await Promise.all(workers);
  return results;
};

const formatUnknown = (value: unknown) => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

type CompareDiffTone = "added" | "removed";

type CompareDiffLine = {
  text: string;
  tone?: CompareDiffTone;
};

const diffToneClasses = (tone?: CompareDiffTone) => {
  if (tone === "added") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100";
  }
  if (tone === "removed") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100";
  }
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";
};

const renderDiffLines = (lines: CompareDiffLine[]) => (
  <div className="space-y-2">
    {lines.map((line, idx) => (
      <pre
        key={`${line.text}-${idx}`}
        className={`whitespace-pre-wrap break-words rounded-md border px-2 py-1 font-mono text-[11px] leading-relaxed ${diffToneClasses(
          line.tone
        )}`}
      >
        {line.text}
      </pre>
    ))}
  </div>
);

const triggerDownload = (filename: string, content: string, mimeType: string) => {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export default function CephAdminBucketCompareModal({
  sourceEndpointId,
  sourceEndpointName,
  sourceBuckets,
  endpoints,
  onClose,
}: CephAdminBucketCompareModalProps) {
  const sortedSourceBuckets = useMemo(() => [...sourceBuckets].sort((a, b) => a.localeCompare(b)), [sourceBuckets]);
  const sourceBucketNameSet = useMemo(() => new Set(sortedSourceBuckets.map((name) => name.toLowerCase())), [sortedSourceBuckets]);
  const targetEndpointOptions = useMemo(() => endpoints, [endpoints]);
  const [targetEndpointId, setTargetEndpointId] = useState<number | null>(
    (() => {
      if (targetEndpointOptions.length === 0) return null;
      const preferred = targetEndpointOptions.find((endpoint) => endpoint.id !== sourceEndpointId);
      return (preferred ?? targetEndpointOptions[0]).id;
    })()
  );
  const [targetBucketNames, setTargetBucketNames] = useState<string[]>([]);
  const [targetBucketsLoading, setTargetBucketsLoading] = useState(false);
  const [targetBucketsError, setTargetBucketsError] = useState<string | null>(null);
  const [mappingMode, setMappingMode] = useState<"by_name" | "manual">("by_name");
  const [manualMapping, setManualMapping] = useState<Record<string, string>>({});
  const [includeConfig, setIncludeConfig] = useState(false);
  const [sizeOnly, setSizeOnly] = useState(false);
  const [parallelism, setParallelism] = useState(4);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, failed: 0 });
  const [items, setItems] = useState<CompareRunItem[]>([]);
  const sameEndpointSelected = targetEndpointId === sourceEndpointId;

  useEffect(() => {
    if (targetEndpointOptions.length === 0) {
      setTargetEndpointId(null);
      return;
    }
    setTargetEndpointId((prev) => {
      if (prev !== null && targetEndpointOptions.some((endpoint) => endpoint.id === prev)) {
        return prev;
      }
      const preferred = targetEndpointOptions.find((endpoint) => endpoint.id !== sourceEndpointId);
      return (preferred ?? targetEndpointOptions[0]).id;
    });
  }, [sourceEndpointId, targetEndpointOptions]);

  useEffect(() => {
    if (sameEndpointSelected && mappingMode !== "manual") {
      setMappingMode("manual");
    }
  }, [mappingMode, sameEndpointSelected]);

  useEffect(() => {
    if (!targetEndpointId) {
      setTargetBucketNames([]);
      setTargetBucketsError("Select a target endpoint.");
      return;
    }
    let cancelled = false;
    const load = async () => {
      setTargetBucketsLoading(true);
      setTargetBucketsError(null);
      try {
        const names: string[] = [];
        const seen = new Set<string>();
        let page = 1;
        while (true) {
          const response = await listCephAdminBuckets(targetEndpointId, {
            page,
            page_size: 200,
            sort_by: "name",
            sort_dir: "asc",
            with_stats: false,
          });
          response.items.forEach((bucket) => {
            const name = (bucket.name ?? "").trim();
            if (!name || seen.has(name)) return;
            seen.add(name);
            names.push(name);
          });
          if (!response.has_next) break;
          page += 1;
        }
        if (cancelled) return;
        names.sort((a, b) => a.localeCompare(b));
        setTargetBucketNames(names);
        setManualMapping((prev) => {
          const next: Record<string, string> = {};
          Object.entries(prev).forEach(([sourceBucket, targetBucket]) => {
            const normalized = (targetBucket ?? "").trim().toLowerCase();
            if (!normalized) return;
            if (targetEndpointId === sourceEndpointId && sourceBucketNameSet.has(normalized)) {
              return;
            }
            next[sourceBucket] = targetBucket;
          });
          return next;
        });
        setTargetBucketsError(null);
      } catch (err) {
        if (cancelled) return;
        setTargetBucketNames([]);
        setTargetBucketsError(extractError(err));
      } finally {
        if (!cancelled) {
          setTargetBucketsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sourceBucketNameSet, sourceEndpointId, targetEndpointId]);

  useEffect(() => {
    if (mappingMode !== "manual") return;
    const knownTargets = new Set(targetBucketNames.map((name) => name.toLowerCase()));
    setManualMapping((prev) => {
      const next: Record<string, string> = {};
      sortedSourceBuckets.forEach((sourceBucket) => {
        const prevTarget = (prev[sourceBucket] ?? "").trim();
        if (prevTarget) {
          next[sourceBucket] = prevTarget;
          return;
        }
        const byName = targetBucketNames.find((candidate) => candidate.toLowerCase() === sourceBucket.toLowerCase());
        if (byName && !(sameEndpointSelected && sourceBucketNameSet.has(byName.toLowerCase()))) {
          next[sourceBucket] = byName;
          return;
        }
        if (knownTargets.has(sourceBucket.toLowerCase()) && !(sameEndpointSelected && sourceBucketNameSet.has(sourceBucket.toLowerCase()))) {
          next[sourceBucket] = sourceBucket;
        }
      });
      return next;
    });
  }, [mappingMode, sameEndpointSelected, sortedSourceBuckets, sourceBucketNameSet, targetBucketNames]);

  const availableTargetBucketNames = useMemo(() => {
    if (!sameEndpointSelected) return targetBucketNames;
    return targetBucketNames.filter((name) => !sourceBucketNameSet.has(name.toLowerCase()));
  }, [sameEndpointSelected, sourceBucketNameSet, targetBucketNames]);

  const comparePlan = useMemo(() => {
    if (!targetEndpointId) {
      return { mappings: [] as CompareMapping[], error: "Select a target endpoint." };
    }
    if (sortedSourceBuckets.length === 0) {
      return { mappings: [] as CompareMapping[], error: "Select source buckets first." };
    }
    if (sameEndpointSelected && mappingMode !== "manual") {
      return { mappings: [] as CompareMapping[], error: "Same-endpoint comparison requires manual mapping." };
    }
    if (mappingMode === "by_name") {
      return {
        mappings: sortedSourceBuckets.map((bucket) => ({ sourceBucket: bucket, targetBucket: bucket })),
        error: null,
      };
    }

    const mappings: CompareMapping[] = [];
    const missing: string[] = [];
    const invalidTargets: string[] = [];
    sortedSourceBuckets.forEach((sourceBucket) => {
      const targetBucket = (manualMapping[sourceBucket] ?? "").trim();
      if (!targetBucket) {
        missing.push(sourceBucket);
        return;
      }
      const normalizedTarget = targetBucket.toLowerCase();
      if (sameEndpointSelected && sourceBucketNameSet.has(normalizedTarget)) {
        invalidTargets.push(targetBucket);
        return;
      }
      mappings.push({ sourceBucket, targetBucket });
    });
    if (missing.length > 0) {
      return {
        mappings: [] as CompareMapping[],
        error: `Complete mapping for all source buckets (${missing.length} missing).`,
      };
    }
    if (invalidTargets.length > 0) {
      return {
        mappings: [] as CompareMapping[],
        error: "When source and target endpoint are the same, mapped target buckets must be outside the selected source set.",
      };
    }
    return { mappings, error: null };
  }, [manualMapping, mappingMode, sameEndpointSelected, sortedSourceBuckets, sourceBucketNameSet, targetEndpointId]);

  const targetNameSet = useMemo(
    () => new Set(targetBucketNames.map((name) => name.toLowerCase())),
    [targetBucketNames]
  );
  const missingByName = useMemo(() => {
    if (mappingMode !== "by_name") return [];
    return sortedSourceBuckets.filter((name) => !targetNameSet.has(name.toLowerCase()));
  }, [mappingMode, sortedSourceBuckets, targetNameSet]);
  const progressPercent = useMemo(() => {
    if (progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.completed / progress.total) * 100));
  }, [progress.completed, progress.total]);

  const runCompare = async () => {
    if (!targetEndpointId) {
      setRunError("Select a target endpoint.");
      return;
    }
    if (comparePlan.error) {
      setRunError(comparePlan.error);
      return;
    }
    const safeParallelism = Number.isFinite(parallelism) ? Math.max(1, Math.min(20, Math.floor(parallelism))) : 4;
    const mappings = comparePlan.mappings;
    setRunError(null);
    setRunning(true);
    setProgress({ completed: 0, total: mappings.length, failed: 0 });
    setItems(
      mappings.map((mapping) => ({
        sourceBucket: mapping.sourceBucket,
        targetBucket: mapping.targetBucket,
        status: "pending",
      }))
    );

    await runWithConcurrencySettled(
      mappings,
      safeParallelism,
      async (mapping, index) => {
        setItems((prev) =>
          prev.map((item, itemIdx) =>
            itemIdx === index
              ? {
                  ...item,
                  status: "running",
                }
              : item
          )
        );
        return compareCephAdminBucketPair(sourceEndpointId, {
          target_endpoint_id: targetEndpointId,
          source_bucket: mapping.sourceBucket,
          target_bucket: mapping.targetBucket,
          include_config: includeConfig,
          size_only: sizeOnly,
        });
      },
      (result, index) => {
        setProgress((prev) => ({
          completed: prev.completed + 1,
          total: prev.total,
          failed: prev.failed + (result.status === "rejected" ? 1 : 0),
        }));
        if (result.status === "fulfilled") {
          setItems((prev) =>
            prev.map((item, itemIdx) => (itemIdx === index ? { ...item, status: "success", result: result.value } : item))
          );
          return;
        }
        setItems((prev) =>
          prev.map((item, itemIdx) =>
            itemIdx === index
              ? {
                  ...item,
                  status: "failed",
                  error: extractError(result.reason),
                }
              : item
          )
        );
      }
    );
    setRunning(false);
  };

  const resultSummary = useMemo(() => {
    const success = items.filter((item) => item.status === "success").length;
    const failed = items.filter((item) => item.status === "failed").length;
    const withDiff = items.filter((item) => item.result?.has_differences).length;
    return { success, failed, withDiff };
  }, [items]);

  const exportGlobalDiff = () => {
    if (items.length === 0) return;
    const targetEndpoint = endpoints.find((endpoint) => endpoint.id === targetEndpointId);
    const payload = {
      generated_at: new Date().toISOString(),
      source_endpoint: {
        id: sourceEndpointId,
        name: sourceEndpointName ?? `Endpoint #${sourceEndpointId}`,
      },
      target_endpoint: targetEndpointId
        ? {
            id: targetEndpointId,
            name: targetEndpoint?.name ?? `Endpoint #${targetEndpointId}`,
          }
        : null,
      options: {
        mapping_mode: mappingMode,
        include_config: includeConfig,
        size_only: sizeOnly,
        parallelism,
      },
      summary: {
        total: items.length,
        success: resultSummary.success,
        failed: resultSummary.failed,
        with_differences: resultSummary.withDiff,
      },
      items: items.map((item) => ({
        source_bucket: item.sourceBucket,
        target_bucket: item.targetBucket,
        status: item.status,
        error: item.error ?? null,
        result: item.result ?? null,
      })),
    };
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `bucket-compare-${sourceEndpointId}-to-${targetEndpointId ?? "na"}-${timestamp}.json`;
    triggerDownload(filename, JSON.stringify(payload, null, 2), "application/json");
  };

  return (
    <Modal title="Compare buckets" onClose={onClose} maxWidthClass="max-w-7xl" maxBodyHeightClass="max-h-[85vh]">
      <div className="space-y-4">
        <p className="ui-body text-slate-700 dark:text-slate-200">
          Compare <span className="font-semibold">{sortedSourceBuckets.length}</span> source bucket
          {sortedSourceBuckets.length > 1 ? "s" : ""} from{" "}
          <span className="font-semibold">{sourceEndpointName ?? `Endpoint #${sourceEndpointId}`}</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Target endpoint
            </label>
            <select
              value={targetEndpointId ?? ""}
              onChange={(event) => setTargetEndpointId(event.target.value ? Number(event.target.value) : null)}
              disabled={running || targetEndpointOptions.length === 0}
              className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {targetEndpointOptions.length === 0 && <option value="">No other endpoint available</option>}
              {targetEndpointOptions.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Mapping mode
            </label>
            <select
              value={mappingMode}
              onChange={(event) => setMappingMode(event.target.value as "by_name" | "manual")}
              disabled={running}
              className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="by_name" disabled={sameEndpointSelected}>
                1:1 by bucket name{sameEndpointSelected ? " (disabled on same endpoint)" : ""}
              </option>
              <option value="manual">Manual mapping</option>
            </select>
          </div>
        </div>
        {sameEndpointSelected && (
          <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
            Same-endpoint comparison is enabled: manual mapping is required, and selected source buckets are excluded from targets.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
            <input
              type="checkbox"
              checked={includeConfig}
              onChange={(event) => setIncludeConfig(event.target.checked)}
              disabled={running}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
            />
            Include bucket configuration
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
            <input
              type="checkbox"
              checked={sizeOnly}
              onChange={(event) => setSizeOnly(event.target.checked)}
              disabled={running}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
            />
            Quick check (size only)
          </label>
          <label className="space-y-1 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
            <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Parallelism</span>
            <input
              type="number"
              min={1}
              max={20}
              value={parallelism}
              onChange={(event) => setParallelism(Number(event.target.value))}
              disabled={running}
              className="w-full rounded-md border border-slate-200 px-2 py-1 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>
        {targetBucketsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading target buckets...</p>}
        {targetBucketsError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{targetBucketsError}</p>}
        {mappingMode === "by_name" && missingByName.length > 0 && (
          <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
            {missingByName.length} target bucket(s) do not exist with the same name.
          </p>
        )}
        {mappingMode === "manual" && (
          <div className="max-h-[240px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
              <thead className="bg-slate-100 dark:bg-slate-900/60">
                <tr>
                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Source
                  </th>
                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Target
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {sortedSourceBuckets.map((sourceBucket) => (
                  <tr key={sourceBucket} className="align-top">
                    <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{sourceBucket}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        list="bucket-compare-target-options"
                        value={manualMapping[sourceBucket] ?? ""}
                        onChange={(event) =>
                          setManualMapping((prev) => ({
                            ...prev,
                            [sourceBucket]: event.target.value,
                          }))
                        }
                        disabled={running}
                        className="w-full rounded-md border border-slate-200 px-2 py-1 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="target bucket"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="bucket-compare-target-options">
              {availableTargetBucketNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        )}
        {runError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{runError}</p>}
        {(running || progress.total > 0) && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
              <span>
                Processing {progress.completed} / {progress.total} mappings
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full bg-primary-500 transition-[width] duration-200" style={{ width: `${progressPercent}%` }} />
            </div>
            {progress.failed > 0 && (
              <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">Failures so far: {progress.failed}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runCompare}
            disabled={running || Boolean(comparePlan.error) || !targetEndpointId}
            className="rounded-md bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Comparing..." : "Run comparison"}
          </button>
          <button
            type="button"
            onClick={exportGlobalDiff}
            disabled={running || items.length === 0}
            className="rounded-md border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
          >
            Export global diff
          </button>
          {items.length > 0 && !running && (
            <p className="ui-caption text-slate-600 dark:text-slate-300">
              Success: {resultSummary.success} / Failed: {resultSummary.failed} / With differences: {resultSummary.withDiff}
            </p>
          )}
        </div>
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => {
              const content = item.result?.content_diff;
              const contentHasDifferences = Boolean(
                content && (content.different_count > 0 || content.only_source_count > 0 || content.only_target_count > 0)
              );
              const contentSections = content
                ? [
                    {
                      key: "source_only",
                      label: `Source only (${content.only_source_count})`,
                      changed: content.only_source_count > 0,
                      before:
                        content.only_source_count > 0
                          ? content.only_source_sample.length > 0
                            ? content.only_source_sample.map((key) => ({ text: `- ${key}`, tone: "removed" as const }))
                            : [{ text: "(sample not available)", tone: "removed" as const }]
                          : [{ text: "(none)" }],
                      after: [{ text: "(none)" }],
                    },
                    {
                      key: "target_only",
                      label: `Target only (${content.only_target_count})`,
                      changed: content.only_target_count > 0,
                      before: [{ text: "(none)" }],
                      after:
                        content.only_target_count > 0
                          ? content.only_target_sample.length > 0
                            ? content.only_target_sample.map((key) => ({ text: `- ${key}`, tone: "added" as const }))
                            : [{ text: "(sample not available)", tone: "added" as const }]
                          : [{ text: "(none)" }],
                    },
                    {
                      key: "different",
                      label: `Different objects (${content.different_count})`,
                      changed: content.different_count > 0,
                      before:
                        content.different_count > 0
                          ? content.different_sample.length > 0
                            ? content.different_sample.map((diff) => ({
                                text: `${diff.key}: ${diff.compare_by} | size=${diff.source_size ?? "-"} | etag=${diff.source_etag ?? "-"}`,
                                tone: "removed" as const,
                              }))
                            : [{ text: "(sample not available)", tone: "removed" as const }]
                          : [{ text: "(none)" }],
                      after:
                        content.different_count > 0
                          ? content.different_sample.length > 0
                            ? content.different_sample.map((diff) => ({
                                text: `${diff.key}: ${diff.compare_by} | size=${diff.target_size ?? "-"} | etag=${diff.target_etag ?? "-"}`,
                                tone: "added" as const,
                              }))
                            : [{ text: "(sample not available)", tone: "added" as const }]
                          : [{ text: "(none)" }],
                    },
                  ]
                : [];
              const configSections =
                item.result?.config_diff?.sections.map((section) => ({
                  key: section.key,
                  label: section.label,
                  changed: section.changed,
                  before: [{ text: formatUnknown(section.source), tone: section.changed ? ("removed" as const) : undefined }],
                  after: [{ text: formatUnknown(section.target), tone: section.changed ? ("added" as const) : undefined }],
                })) ?? [];
              const configHasDifferences = Boolean(item.result?.config_diff?.changed);
              const bucketHasDifferences = Boolean(item.result?.has_differences);
              const progressValue = item.status === "running" ? 45 : item.status === "pending" ? 0 : 100;
              return (
                <details
                  key={`${item.sourceBucket}->${item.targetBucket}:${item.status}:${bucketHasDifferences ? "diff" : "same"}`}
                  defaultOpen={item.status === "failed" || bucketHasDifferences}
                  className="rounded-lg border border-slate-200 dark:border-slate-800"
                >
                  <summary className="cursor-pointer list-none px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {item.sourceBucket} → {item.targetBucket}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          item.status === "success"
                            ? item.result?.has_differences
                              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
                            : item.status === "failed"
                              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100"
                              : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200"
                        }`}
                      >
                        {item.status}
                      </span>
                      {content && (
                        <span className="ui-caption text-slate-500 dark:text-slate-400">
                          Matched {content.matched_count} · Different {content.different_count} · Source only{" "}
                          {content.only_source_count} · Target only {content.only_target_count}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 relative h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div className="h-full bg-primary-500 transition-[width] duration-200" style={{ width: `${progressValue}%` }} />
                    </div>
                  </summary>
                  <div className="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                    {item.error && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{item.error}</p>}
                    {content && (
                      <details
                        defaultOpen={contentHasDifferences}
                        className="rounded-md border border-slate-200 dark:border-slate-800"
                      >
                        <summary className="cursor-pointer list-none px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                              Content diff ({content.compare_mode === "size_only" ? "size only" : "md5 or size"})
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                contentHasDifferences
                                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
                                  : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200"
                              }`}
                            >
                              {contentHasDifferences ? "Changed" : "Unchanged"}
                            </span>
                          </div>
                        </summary>
                        <div className="space-y-2 border-t border-slate-200 px-2.5 py-2 dark:border-slate-800">
                          {contentSections.map((section) => (
                            <details
                              key={`${item.sourceBucket}:${item.targetBucket}:content:${section.key}`}
                              defaultOpen={section.changed}
                              className="rounded-md border border-slate-200 dark:border-slate-800"
                            >
                              <summary className="cursor-pointer list-none px-2 py-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{section.label}</span>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                      section.changed
                                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
                                        : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200"
                                    }`}
                                  >
                                    {section.changed ? "Changed" : "Unchanged"}
                                  </span>
                                </div>
                              </summary>
                              <div className="grid gap-2 border-t border-slate-200 px-2 py-2 lg:grid-cols-2 dark:border-slate-800">
                                <div className="space-y-1">
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Source
                                  </p>
                                  {renderDiffLines(section.before)}
                                </div>
                                <div className="space-y-1">
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Target
                                  </p>
                                  {renderDiffLines(section.after)}
                                </div>
                              </div>
                            </details>
                          ))}
                        </div>
                      </details>
                    )}
                    {item.result?.config_diff && (
                      <details
                        defaultOpen={configHasDifferences}
                        className="rounded-md border border-slate-200 dark:border-slate-800"
                      >
                        <summary className="cursor-pointer list-none px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Config diff</span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                configHasDifferences
                                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
                                  : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200"
                              }`}
                            >
                              {configHasDifferences ? "Changed" : "Unchanged"}
                            </span>
                          </div>
                        </summary>
                        <div className="space-y-2 border-t border-slate-200 px-2.5 py-2 dark:border-slate-800">
                          {configSections.map((section) => (
                            <details
                              key={`${item.sourceBucket}:${item.targetBucket}:config:${section.key}`}
                              defaultOpen={section.changed}
                              className="rounded-md border border-slate-200 dark:border-slate-800"
                            >
                              <summary className="cursor-pointer list-none px-2 py-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{section.label}</span>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                      section.changed
                                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
                                        : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200"
                                    }`}
                                  >
                                    {section.changed ? "Changed" : "Unchanged"}
                                  </span>
                                </div>
                              </summary>
                              <div className="grid gap-2 border-t border-slate-200 px-2 py-2 lg:grid-cols-2 dark:border-slate-800">
                                <div className="space-y-1">
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Source
                                  </p>
                                  {renderDiffLines(section.before)}
                                </div>
                                <div className="space-y-1">
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Target
                                  </p>
                                  {renderDiffLines(section.after)}
                                </div>
                              </div>
                            </details>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../components/Modal";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import { uiCheckboxClass, uiInputClass, uiLabelClass } from "../../components/ui/styles";
import {
  CephAdminBucketCompareResult,
  CephAdminEndpoint,
  compareCephAdminBucketPair,
  listCephAdminBuckets,
  type CephAdminBucketCompareConfigFeature,
} from "../../api/cephAdmin";
import {
  BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS,
  extractCompareError,
  formatUnknown,
  getChangedTone,
  getRunStatusTone,
  parseRawMappingText,
  renderDiffLines,
  runWithConcurrencySettled,
  triggerDownload,
} from "../shared/bucketCompareShared";

type CompareMapping = {
  sourceBucket: string;
  targetBucket: string;
};

type CompareRunItem = {
  sourceBucket: string;
  targetBucket: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
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

const extractError = extractCompareError;

const CONFIG_FEATURE_OPTIONS: Array<{ key: CephAdminBucketCompareConfigFeature; label: string }> =
  BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS.map((option) => ({
    key: option.key as CephAdminBucketCompareConfigFeature,
    label: option.label,
  }));

const ALL_CONFIG_FEATURE_KEYS = CONFIG_FEATURE_OPTIONS.map((option) => option.key);

export default function CephAdminBucketCompareModal({
  sourceEndpointId,
  sourceEndpointName,
  sourceBuckets,
  endpoints,
  onClose,
}: CephAdminBucketCompareModalProps) {
  const sortedSourceBuckets = useMemo(() => [...sourceBuckets].sort((a, b) => a.localeCompare(b)), [sourceBuckets]);
  const sourceBucketNameSet = useMemo(() => new Set(sortedSourceBuckets), [sortedSourceBuckets]);
  const targetEndpointOptions = useMemo(() => endpoints, [endpoints]);
  const [targetEndpointId, setTargetEndpointId] = useState<number | null>(null);
  const [targetBucketNames, setTargetBucketNames] = useState<string[]>([]);
  const [targetBucketsLoading, setTargetBucketsLoading] = useState(false);
  const [targetBucketsError, setTargetBucketsError] = useState<string | null>(null);
  const [mappingMode, setMappingMode] = useState<"by_name" | "manual">("by_name");
  const [manualMapping, setManualMapping] = useState<Record<string, string>>({});
  const [rawMappingText, setRawMappingText] = useState("");
  const [includeContent, setIncludeContent] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(false);
  const [selectedConfigFeatures, setSelectedConfigFeatures] = useState<CephAdminBucketCompareConfigFeature[]>(
    () => [...ALL_CONFIG_FEATURE_KEYS]
  );
  const [parallelism, setParallelism] = useState(4);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, failed: 0, cancelled: 0 });
  const [items, setItems] = useState<CompareRunItem[]>([]);
  const [resultSearch, setResultSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CompareRunItem["status"]>("all");
  const [diffFilter, setDiffFilter] = useState<"all" | "with_diff" | "no_diff">("all");
  const sameEndpointSelected = targetEndpointId === sourceEndpointId;
  const parsedRawMapping = useMemo(() => parseRawMappingText(rawMappingText), [rawMappingText]);
  const cancelRequestedRef = useRef(false);
  const requestControllersRef = useRef(new Set<AbortController>());
  const controlClass = uiInputClass;
  const compactControlClass =
    "w-full rounded-md border border-slate-200 px-2 py-1 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

  useEffect(() => {
    if (targetEndpointOptions.length === 0) {
      setTargetEndpointId(null);
      return;
    }
    setTargetEndpointId((prev) => {
      if (prev !== null && targetEndpointOptions.some((endpoint) => endpoint.id === prev)) {
        return prev;
      }
      return null;
    });
  }, [targetEndpointOptions]);

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
            const normalized = (targetBucket ?? "").trim();
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
    const knownTargets = new Set(targetBucketNames);
    setManualMapping((prev) => {
      const next: Record<string, string> = {};
      sortedSourceBuckets.forEach((sourceBucket) => {
        const prevTarget = (prev[sourceBucket] ?? "").trim();
        if (prevTarget) {
          next[sourceBucket] = prevTarget;
          return;
        }
        const byName = targetBucketNames.find((candidate) => candidate === sourceBucket);
        if (byName && !(sameEndpointSelected && sourceBucketNameSet.has(byName))) {
          next[sourceBucket] = byName;
          return;
        }
        if (knownTargets.has(sourceBucket) && !(sameEndpointSelected && sourceBucketNameSet.has(sourceBucket))) {
          next[sourceBucket] = sourceBucket;
        }
      });
      return next;
    });
  }, [mappingMode, sameEndpointSelected, sortedSourceBuckets, sourceBucketNameSet, targetBucketNames]);

  useEffect(() => {
    if (mappingMode !== "manual") return;
    if (parsedRawMapping.mapping.size === 0) return;
    setManualMapping((prev) => {
      const next = { ...prev };
      let changed = false;
      sortedSourceBuckets.forEach((sourceBucket) => {
        const mapped = parsedRawMapping.mapping.get(sourceBucket);
        if (!mapped) return;
        if ((next[sourceBucket] ?? "").trim() === mapped) return;
        next[sourceBucket] = mapped;
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [mappingMode, parsedRawMapping.mapping, sortedSourceBuckets]);

  const availableTargetBucketNames = useMemo(() => {
    if (!sameEndpointSelected) return targetBucketNames;
    return targetBucketNames.filter((name) => !sourceBucketNameSet.has(name));
  }, [sameEndpointSelected, sourceBucketNameSet, targetBucketNames]);

  const fallbackByNameMapping = useMemo(() => {
    const mapping = new Map<string, string>();
    sortedSourceBuckets.forEach((sourceBucket) => {
      const candidate = availableTargetBucketNames.find((bucketName) => bucketName === sourceBucket);
      if (!candidate) return;
      mapping.set(sourceBucket, candidate);
    });
    return mapping;
  }, [availableTargetBucketNames, sortedSourceBuckets]);

  const resolvedManualMapping = useMemo(() => {
    const mapping = new Map<string, string>();
    sortedSourceBuckets.forEach((sourceBucket) => {
      const rawMapped = parsedRawMapping.mapping.get(sourceBucket);
      if (rawMapped) {
        mapping.set(sourceBucket, rawMapped);
        return;
      }
      const uiMapped = (manualMapping[sourceBucket] ?? "").trim();
      if (uiMapped) {
        mapping.set(sourceBucket, uiMapped);
        return;
      }
      const fallbackMapped = fallbackByNameMapping.get(sourceBucket);
      if (fallbackMapped) {
        mapping.set(sourceBucket, fallbackMapped);
      }
    });
    return mapping;
  }, [fallbackByNameMapping, manualMapping, parsedRawMapping.mapping, sortedSourceBuckets]);

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
    const invalidTargets: string[] = [];
    sortedSourceBuckets.forEach((sourceBucket) => {
      const targetBucket = (resolvedManualMapping.get(sourceBucket) ?? "").trim();
      if (!targetBucket) {
        return;
      }
      if (sameEndpointSelected && sourceBucketNameSet.has(targetBucket)) {
        invalidTargets.push(targetBucket);
        return;
      }
      mappings.push({ sourceBucket, targetBucket });
    });
    if (invalidTargets.length > 0) {
      return {
        mappings: [] as CompareMapping[],
        error: "When source and target endpoint are the same, mapped target buckets must be outside the selected source set.",
      };
    }
    if (mappings.length === 0) {
      return {
        mappings: [] as CompareMapping[],
        error: "No mapping resolved. Add raw mapping lines, fill manual fields, or rely on 1:1 fallback when available.",
      };
    }
    return { mappings, error: null };
  }, [mappingMode, resolvedManualMapping, sameEndpointSelected, sortedSourceBuckets, sourceBucketNameSet, targetEndpointId]);

  const targetNameSet = useMemo(() => new Set(targetBucketNames), [targetBucketNames]);
  const missingByName = useMemo(() => {
    if (mappingMode !== "by_name") return [];
    return sortedSourceBuckets.filter((name) => !targetNameSet.has(name));
  }, [mappingMode, sortedSourceBuckets, targetNameSet]);
  const progressPercent = useMemo(() => {
    if (progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.completed / progress.total) * 100));
  }, [progress.completed, progress.total]);
  const hasScopeSelected = includeContent || includeConfig;
  const hasConfigFeatureSelected = selectedConfigFeatures.length > 0;
  const canRunComparison =
    !running && !comparePlan.error && Boolean(targetEndpointId) && hasScopeSelected && (!includeConfig || hasConfigFeatureSelected);

  useEffect(() => {
    if (includeContent) return;
    setSizeOnly(false);
  }, [includeContent]);

  const toggleConfigFeature = (feature: CephAdminBucketCompareConfigFeature, enabled: boolean) => {
    setSelectedConfigFeatures((prev) => {
      const next = new Set(prev);
      if (enabled) {
        next.add(feature);
      } else {
        next.delete(feature);
      }
      return ALL_CONFIG_FEATURE_KEYS.filter((key) => next.has(key));
    });
  };

  const runCompare = async () => {
    if (!targetEndpointId) {
      setRunError("Select a target endpoint.");
      return;
    }
    if (!hasScopeSelected) {
      setRunError("Select at least one comparison scope: content and/or configuration.");
      return;
    }
    if (includeConfig && !hasConfigFeatureSelected) {
      setRunError("Select at least one configuration feature or disable configuration scope.");
      return;
    }
    if (comparePlan.error) {
      setRunError(comparePlan.error);
      return;
    }
    const safeParallelism = Number.isFinite(parallelism) ? Math.max(1, Math.min(20, Math.floor(parallelism))) : 4;
    const mappings = comparePlan.mappings;
    setRunError(null);
    cancelRequestedRef.current = false;
    setRunning(true);
    setStopping(false);
    setProgress({ completed: 0, total: mappings.length, failed: 0, cancelled: 0 });
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
        if (cancelRequestedRef.current) {
          throw new DOMException("Comparison cancelled", "AbortError");
        }
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
        const controller = new AbortController();
        requestControllersRef.current.add(controller);
        try {
          return await compareCephAdminBucketPair(
            sourceEndpointId,
            {
              target_endpoint_id: targetEndpointId,
              source_bucket: mapping.sourceBucket,
              target_bucket: mapping.targetBucket,
              include_content: includeContent,
              include_config: includeConfig,
              config_features: includeConfig ? selectedConfigFeatures : undefined,
            },
            { signal: controller.signal }
          );
        } finally {
          requestControllersRef.current.delete(controller);
        }
      },
      (result, index) => {
        const cancelled =
          cancelRequestedRef.current ||
          (result.status === "rejected" && axios.isAxiosError(result.reason) && result.reason.code === "ERR_CANCELED") ||
          (result.status === "rejected" && result.reason instanceof DOMException && result.reason.name === "AbortError");
        setProgress((prev) => ({
          completed: prev.completed + 1,
          total: prev.total,
          failed: prev.failed + (!cancelled && result.status === "rejected" ? 1 : 0),
          cancelled: prev.cancelled + (cancelled ? 1 : 0),
        }));
        if (result.status === "fulfilled" && !cancelRequestedRef.current) {
          setItems((prev) =>
            prev.map((item, itemIdx) => (itemIdx === index ? { ...item, status: "success", result: result.value } : item))
          );
          return;
        }
        if (cancelled) {
          setItems((prev) =>
            prev.map((item, itemIdx) =>
              itemIdx === index
                ? {
                    ...item,
                    status: "cancelled",
                    error: "Comparison cancelled.",
                  }
                : item
            )
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
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    setRunning(false);
    setStopping(false);
  };

  const resultSummary = useMemo(() => {
    const success = items.filter((item) => item.status === "success").length;
    const failed = items.filter((item) => item.status === "failed").length;
    const cancelled = items.filter((item) => item.status === "cancelled").length;
    const withDiff = items.filter((item) => item.result?.has_differences).length;
    return { success, failed, cancelled, withDiff };
  }, [items]);

  const filteredItems = useMemo(() => {
    const search = resultSearch.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (diffFilter === "with_diff" && !item.result?.has_differences) return false;
      if (diffFilter === "no_diff") {
        if (item.status !== "success") return false;
        if (item.result?.has_differences) return false;
      }
      if (!search) return true;
      const source = item.sourceBucket.toLowerCase();
      const target = item.targetBucket.toLowerCase();
      const error = (item.error ?? "").toLowerCase();
      return source.includes(search) || target.includes(search) || error.includes(search);
    });
  }, [diffFilter, items, resultSearch, statusFilter]);

  const resetResultFilters = () => {
    setResultSearch("");
    setStatusFilter("all");
    setDiffFilter("all");
  };

  const stopComparison = useCallback(() => {
    if (!running) return;
    cancelRequestedRef.current = true;
    setStopping(true);
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    setItems((prev) =>
      prev.map((item) =>
        item.status === "pending" || item.status === "running"
          ? {
              ...item,
              status: "cancelled",
              error: "Comparison cancelled.",
            }
          : item
      )
    );
  }, [running]);

  const handleClose = useCallback(() => {
    stopComparison();
    onClose();
  }, [onClose, stopComparison]);

  useEffect(() => {
    return () => {
      cancelRequestedRef.current = true;
      requestControllersRef.current.forEach((controller) => controller.abort());
      requestControllersRef.current.clear();
    };
  }, []);

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
        include_content: includeContent,
        include_config: includeConfig,
        config_features: includeConfig ? selectedConfigFeatures : [],
        parallelism,
      },
      summary: {
        total: items.length,
        success: resultSummary.success,
        failed: resultSummary.failed,
        cancelled: resultSummary.cancelled,
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
    <Modal title="Compare buckets" onClose={handleClose} maxWidthClass="max-w-7xl" maxBodyHeightClass="max-h-[85vh]">
      <div className="space-y-4">
        <p className="ui-body text-slate-700 dark:text-slate-200">
          Compare <span className="font-semibold">{sortedSourceBuckets.length}</span> source bucket
          {sortedSourceBuckets.length > 1 ? "s" : ""} from{" "}
          <span className="font-semibold">{sourceEndpointName ?? `Endpoint #${sourceEndpointId}`}</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className={uiLabelClass}>Target endpoint</label>
            <select
              value={targetEndpointId ?? ""}
              onChange={(event) => setTargetEndpointId(event.target.value ? Number(event.target.value) : null)}
              disabled={running || targetEndpointOptions.length === 0}
              className={controlClass}
            >
              {targetEndpointOptions.length > 0 && <option value="">Select a target endpoint</option>}
              {targetEndpointOptions.length === 0 && <option value="">No other endpoint available</option>}
              {targetEndpointOptions.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={uiLabelClass}>Mapping mode</label>
            <select
              value={mappingMode}
              onChange={(event) => setMappingMode(event.target.value as "by_name" | "manual")}
              disabled={running}
              className={controlClass}
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
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
            <input
              type="checkbox"
              checked={includeContent}
              onChange={(event) => setIncludeContent(event.target.checked)}
              disabled={running}
              className={uiCheckboxClass}
            />
            Compare bucket content
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
            <input
              type="checkbox"
              checked={includeConfig}
              onChange={(event) => setIncludeConfig(event.target.checked)}
              disabled={running}
              className={uiCheckboxClass}
            />
            Compare bucket configuration
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
              className={compactControlClass}
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
        {!hasScopeSelected && (
          <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
            Select at least one comparison scope to run.
          </p>
        )}
        {includeConfig && (
          <details className="rounded-lg border border-slate-200 dark:border-slate-800">
            <summary className="cursor-pointer list-none px-3 py-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Configuration features to compare
            </summary>
            <div className="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <UiButton
                  type="button"
                  onClick={() => setSelectedConfigFeatures([...ALL_CONFIG_FEATURE_KEYS])}
                  disabled={running}
                  variant="secondary"
                  className="ui-caption"
                >
                  Select all
                </UiButton>
                <UiButton
                  type="button"
                  onClick={() => setSelectedConfigFeatures([])}
                  disabled={running}
                  variant="secondary"
                  className="ui-caption"
                >
                  Clear
                </UiButton>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {CONFIG_FEATURE_OPTIONS.map((option) => (
                  <label
                    key={option.key}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  >
                    <input
                      type="checkbox"
                      checked={selectedConfigFeatures.includes(option.key)}
                      onChange={(event) => toggleConfigFeature(option.key, event.target.checked)}
                      disabled={running}
                      className={uiCheckboxClass}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {!hasConfigFeatureSelected && (
                <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
                  Select at least one configuration feature.
                </p>
              )}
            </div>
          </details>
        )}
        {mappingMode === "manual" && (
          <div className="space-y-3">
            <details className="rounded-lg border border-slate-200 dark:border-slate-800">
              <summary className="cursor-pointer list-none px-3 py-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Raw mapping (priority)
              </summary>
              <div className="space-y-2 border-t border-slate-200 px-3 py-2 dark:border-slate-800">
                <textarea
                  value={rawMappingText}
                  onChange={(event) => setRawMappingText(event.target.value)}
                  disabled={running}
                  rows={6}
                  placeholder={"source-bucket-a => target-bucket-a\nsource-bucket-b -> target-bucket-b"}
                  className={`${controlClass} font-mono text-xs`}
                />
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Accepted formats per line: <code>source =&gt; target</code>, <code>source -&gt; target</code>, <code>source = target</code>.
                  </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Parsed entries: {parsedRawMapping.mapping.size}. Invalid lines: {parsedRawMapping.invalidLines.length}.
                </p>
                {parsedRawMapping.invalidLines.length > 0 && (
                  <pre className="whitespace-pre-wrap break-words rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
                    {parsedRawMapping.invalidLines.map((line) => `- ${line}`).join("\n")}
                  </pre>
                )}
              </div>
            </details>
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
                  {sortedSourceBuckets.map((sourceBucket) => {
                    const rawTarget = parsedRawMapping.mapping.get(sourceBucket);
                    const effectiveTarget = resolvedManualMapping.get(sourceBucket) ?? "";
                    return (
                      <tr key={sourceBucket} className="align-top">
                        <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{sourceBucket}</td>
                        <td className="space-y-1 px-3 py-2">
                          <input
                            type="text"
                            list="bucket-compare-target-options"
                            value={rawTarget ?? (manualMapping[sourceBucket] ?? "")}
                            onChange={(event) =>
                              setManualMapping((prev) => ({
                                ...prev,
                                [sourceBucket]: event.target.value,
                              }))
                            }
                            disabled={running || Boolean(rawTarget)}
                            className={compactControlClass}
                            placeholder="target bucket"
                          />
                          {rawTarget && (
                            <p className="ui-caption text-amber-700 dark:text-amber-200">
                              Overridden by raw mapping.
                            </p>
                          )}
                          {!rawTarget && !manualMapping[sourceBucket] && effectiveTarget && (
                            <p className="ui-caption text-slate-500 dark:text-slate-400">Fallback 1:1 applied: {effectiveTarget}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="bucket-compare-target-options">
                {availableTargetBucketNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
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
            {progress.cancelled > 0 && (
              <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
                Cancelled so far: {progress.cancelled}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <UiButton
            onClick={runCompare}
            disabled={!canRunComparison}
            className="ui-body"
          >
            {running ? "Comparing..." : "Run comparison"}
          </UiButton>
          <UiButton onClick={stopComparison} disabled={!running} variant="warning" className="ui-body">
            {stopping ? "Stopping..." : "Stop"}
          </UiButton>
          <UiButton onClick={exportGlobalDiff} disabled={running || items.length === 0} variant="secondary" className="ui-body">
            Export global diff
          </UiButton>
          {items.length > 0 && !running && (
            <p className="ui-caption text-slate-600 dark:text-slate-300">
              Success: {resultSummary.success} / Failed: {resultSummary.failed} / Cancelled: {resultSummary.cancelled} / With
              differences: {resultSummary.withDiff}
            </p>
          )}
        </div>
        {items.length > 0 && (
          <div className="space-y-2">
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40 lg:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
              <input
                type="text"
                value={resultSearch}
                onChange={(event) => setResultSearch(event.target.value)}
                placeholder="Filter by source/target bucket or error"
                className={controlClass}
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | CompareRunItem["status"])}
                className={controlClass}
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="running">Running</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                value={diffFilter}
                onChange={(event) => setDiffFilter(event.target.value as "all" | "with_diff" | "no_diff")}
                className={controlClass}
              >
                <option value="all">All diff states</option>
                <option value="with_diff">With differences</option>
                <option value="no_diff">No differences</option>
              </select>
              <UiButton onClick={resetResultFilters} variant="secondary" className="ui-body">
                Reset filters
              </UiButton>
            </div>
            <p className="ui-caption text-slate-600 dark:text-slate-300">
              Showing {filteredItems.length} / {items.length} result(s).
            </p>
            {filteredItems.map((item) => {
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
                            ? content.only_source_sample.map((key) => ({ text: key, tone: "removed" as const }))
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
                            ? content.only_target_sample.map((key) => ({ text: key, tone: "added" as const }))
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
                      <UiBadge tone={getRunStatusTone(item)} className="px-2 text-[10px]">
                        {item.status}
                      </UiBadge>
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
                              Content diff (md5 or size)
                            </span>
                            <UiBadge tone={getChangedTone(contentHasDifferences)} className="px-2 text-[10px]">
                              {contentHasDifferences ? "Different" : "Identical"}
                            </UiBadge>
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
                                  <UiBadge tone={getChangedTone(section.changed)} className="px-2 text-[10px]">
                                    {section.changed ? "Different" : "Identical"}
                                  </UiBadge>
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
                            <UiBadge tone={getChangedTone(configHasDifferences)} className="px-2 text-[10px]">
                              {configHasDifferences ? "Different" : "Identical"}
                            </UiBadge>
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
                                  <UiBadge tone={getChangedTone(section.changed)} className="px-2 text-[10px]">
                                    {section.changed ? "Different" : "Identical"}
                                  </UiBadge>
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
            {filteredItems.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 ui-body text-slate-600 dark:border-slate-700 dark:text-slate-300">
                No result matches the current filters.
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

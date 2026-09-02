/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../components/Modal";
import WorkflowPage from "../../components/WorkflowPage";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiDetails from "../../components/ui/UiDetails";
import UiProgressBar from "../../components/ui/UiProgressBar";
import UiSelect from "../../components/ui/UiSelect";
import { uiCheckboxClass, uiInputClass } from "../../components/ui/styles";
import { runWithConcurrencySettled } from "../../utils/concurrency";
import {
  CephAdminBucketCompareResult,
  CephAdminEndpoint,
  compareCephAdminBucketPair,
  listCephAdminBuckets,
  type CephAdminBucketCompareConfigFeature,
} from "../../api/cephAdmin";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import {
  BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS,
  BucketCompareManualMappingEditor,
  CompareVisibleKeysCopyFeedback,
  bucketComparisonCancelledMessage,
  buildBucketCompareMappingModel,
  compareObjectDetailsFromKeys,
  copyCompareObjectKeysToClipboard,
  extractCompareError,
  formatCompareDisplayLimitMessage,
  formatUnknown,
  getChangedTone,
  getCompareHiddenCount,
  getObjectParentPrefix,
  getRunStatusLabel,
  getRunStatusTone,
  getVisibleCompareObjectKeys,
  matchesBucketCompareRunFilters,
  parseRawMappingText,
  renderCompareObjectDetails,
  renderDiffLines,
  resolveBucketCompareRunSettlement,
  sourceCompareObjectDetailFromDiff,
  summarizeBucketCompareRun,
  targetCompareObjectDetailFromDiff,
  updateBucketCompareRunItem,
  updateBucketCompareRunProgress,
} from "../shared/bucketCompareShared";
import {
  formatDownloadTimestamp,
  triggerJsonDownload,
} from "../../utils/download";

type CompareRunItem = {
  sourceBucket: string;
  targetBucket: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  result?: CephAdminBucketCompareResult;
  error?: string;
};

type PendingExploreNavigation = {
  href: string;
  objectKey: string;
};

type CephAdminBucketCompareModalProps = {
  sourceEndpointId: number;
  sourceEndpointName?: string | null;
  sourceBuckets: string[];
  endpoints: CephAdminEndpoint[];
  onClose: () => void;
};

const extractError = extractCompareError;

const copyFeedbackToneClass: Record<CompareVisibleKeysCopyFeedback["tone"], string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100",
  danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100",
};

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
  const [ignoreModifiedAfter, setIgnoreModifiedAfter] = useState("");
  const [parallelism, setParallelism] = useState(4);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, failed: 0, cancelled: 0 });
  const [items, setItems] = useState<CompareRunItem[]>([]);
  const [pendingExplore, setPendingExplore] = useState<PendingExploreNavigation | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<(CompareVisibleKeysCopyFeedback & { id: string }) | null>(null);
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

  const {
    availableTargetBucketNames,
    resolvedManualMapping,
    comparePlan,
    missingByName,
  } = useMemo(
    () =>
      buildBucketCompareMappingModel({
        targetSelected: Boolean(targetEndpointId),
        targetKind: "endpoint",
        sourceBuckets: sortedSourceBuckets,
        targetBuckets: targetBucketNames,
        sameTargetSelected: sameEndpointSelected,
        mappingMode,
        rawMapping: parsedRawMapping.mapping,
        manualMapping,
      }),
    [
      manualMapping,
      mappingMode,
      parsedRawMapping.mapping,
      sameEndpointSelected,
      sortedSourceBuckets,
      targetBucketNames,
      targetEndpointId,
    ]
  );
  const progressPercent = useMemo(() => {
    if (progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.completed / progress.total) * 100));
  }, [progress.completed, progress.total]);
  const hasScopeSelected = includeContent || includeConfig;
  const hasConfigFeatureSelected = selectedConfigFeatures.length > 0;
  const ignoreModifiedAfterIso = useMemo(() => {
    const value = ignoreModifiedAfter.trim();
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }, [ignoreModifiedAfter]);
  const ignoreModifiedAfterInvalid = Boolean(ignoreModifiedAfter.trim()) && !ignoreModifiedAfterIso;
  const canRunComparison =
    !running &&
    !comparePlan.error &&
    Boolean(targetEndpointId) &&
    hasScopeSelected &&
    (!includeConfig || hasConfigFeatureSelected) &&
    !ignoreModifiedAfterInvalid;

  const buildCephAdminBrowserHref = useCallback((endpointId: number, bucket: string, key: string) => {
    const params = new URLSearchParams();
    params.set("ep", String(endpointId));
    params.set("bucket", bucket);
    const prefix = getObjectParentPrefix(key);
    if (prefix) params.set("prefix", prefix);
    return `/ceph-admin/browser?${params.toString()}`;
  }, []);

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
    if (ignoreModifiedAfterInvalid) {
      setRunError("Enter a valid modified-after cutoff or clear the field.");
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
              ignore_modified_after: ignoreModifiedAfterIso,
            },
            { signal: controller.signal }
          );
        } finally {
          requestControllersRef.current.delete(controller);
        }
      },
      (result, index) => {
        const settlement = resolveBucketCompareRunSettlement(
          result,
          cancelRequestedRef.current
        );
        setProgress((prev) => updateBucketCompareRunProgress(prev, settlement));
        setItems((prev) =>
          prev.map((item, itemIdx) =>
            itemIdx === index ? updateBucketCompareRunItem(item, settlement) : item
          )
        );
      }
    );
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    setRunning(false);
    setStopping(false);
  };

  const resultSummary = useMemo(() => summarizeBucketCompareRun(items), [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) =>
      matchesBucketCompareRunFilters(item, {
        search: resultSearch,
        status: statusFilter,
        differences: diffFilter,
      })
    );
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
              error: bucketComparisonCancelledMessage,
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
    const requestControllers = requestControllersRef.current;
    return () => {
      cancelRequestedRef.current = true;
      requestControllers.forEach((controller) => controller.abort());
      requestControllers.clear();
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
        ignore_modified_after: ignoreModifiedAfterIso,
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
    const timestamp = formatDownloadTimestamp(new Date());
    const filename = `bucket-compare-${sourceEndpointId}-to-${targetEndpointId ?? "na"}-${timestamp}.json`;
    triggerJsonDownload(filename, payload);
  };

  const openExploreConfirm = useCallback((href: string, detail: { key: string }) => {
    setPendingExplore({ href, objectKey: detail.key });
  }, []);

  const copyVisibleKeys = useCallback(async (id: string, keys: string[]) => {
    if (keys.length === 0) return;
    try {
      await copyCompareObjectKeysToClipboard(keys);
      setCopyFeedback({
        id,
        tone: "success",
        message: `Copied ${keys.length} key${keys.length === 1 ? "" : "s"} to clipboard.`,
      });
    } catch {
      setCopyFeedback({
        id,
        tone: "danger",
        message: "Unable to copy keys to clipboard.",
      });
    }
  }, []);

  const confirmExploreNavigation = useCallback(() => {
    if (!pendingExplore) return;
    window.location.assign(pendingExplore.href);
  }, [pendingExplore]);

  return (
    <WorkflowPage
      title="Compare buckets"
      description="Map source and target buckets, run the comparison and review or export the resulting differences."
      breadcrumbs={cephAdminPageBreadcrumbs("buckets", { label: "Compare" })}
      onBack={handleClose}
      backLabel={running ? "Stop and return" : "Back to buckets"}
      contentClassName="min-w-0"
    >
      <div className="space-y-4">
        <p className="ui-body text-slate-700 dark:text-slate-200">
          Compare <span className="font-semibold">{sortedSourceBuckets.length}</span> source bucket
          {sortedSourceBuckets.length > 1 ? "s" : ""} from{" "}
          <span className="font-semibold">{sourceEndpointName ?? `Endpoint #${sourceEndpointId}`}</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <UiSelect
            label="Target endpoint"
            value={targetEndpointId ?? ""}
            onChange={(event) => setTargetEndpointId(event.target.value ? Number(event.target.value) : null)}
            disabled={running || targetEndpointOptions.length === 0}
          >
            {targetEndpointOptions.length > 0 && <option value="">Select a target endpoint</option>}
            {targetEndpointOptions.length === 0 && <option value="">No other endpoint available</option>}
            {targetEndpointOptions.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
              </option>
            ))}
          </UiSelect>
          <UiSelect
            label="Mapping mode"
            value={mappingMode}
            onChange={(event) => setMappingMode(event.target.value as "by_name" | "manual")}
            disabled={running}
          >
            <option value="by_name" disabled={sameEndpointSelected}>
              1:1 by bucket name{sameEndpointSelected ? " (disabled on same endpoint)" : ""}
            </option>
            <option value="manual">Manual mapping</option>
          </UiSelect>
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
          <label className="space-y-1 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
            <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Ignore objects modified after
            </span>
            <input
              type="datetime-local"
              value={ignoreModifiedAfter}
              onChange={(event) => setIgnoreModifiedAfter(event.target.value)}
              disabled={running}
              className={compactControlClass}
            />
          </label>
        </div>
        {ignoreModifiedAfterInvalid && (
          <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
            Enter a valid modified-after cutoff or clear the field.
          </p>
        )}
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
          <BucketCompareManualMappingEditor
            rawMappingText={rawMappingText}
            onRawMappingTextChange={setRawMappingText}
            parsedRawMapping={parsedRawMapping}
            sourceBuckets={sortedSourceBuckets}
            resolvedManualMapping={resolvedManualMapping}
            manualMapping={manualMapping}
            onManualMappingChange={(sourceBucket, targetBucket) =>
              setManualMapping((prev) => ({ ...prev, [sourceBucket]: targetBucket }))
            }
            availableTargetBucketNames={availableTargetBucketNames}
            disabled={running}
            controlClass={controlClass}
            compactControlClass={compactControlClass}
          />
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
            <UiProgressBar
              value={progressPercent}
              label="Bucket comparison progress"
              className="h-2.5 overflow-hidden bg-slate-200 dark:bg-slate-800"
              barClassName="bg-primary-500 transition-[width] duration-200"
            />
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
              Done: {resultSummary.success} / Failed: {resultSummary.failed} / Cancelled: {resultSummary.cancelled} / With
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
                <option value="success">Done</option>
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
                ? (() => {
                    const onlySourceDetails =
                      content.only_source_count > 0
                        ? (content.only_source_details?.length ? content.only_source_details : compareObjectDetailsFromKeys(content.only_source_sample))
                        : [];
                    const onlyTargetDetails =
                      content.only_target_count > 0
                        ? (content.only_target_details?.length ? content.only_target_details : compareObjectDetailsFromKeys(content.only_target_sample))
                        : [];
                    const differentSourceDetails =
                      content.different_count > 0 ? content.different_sample.map(sourceCompareObjectDetailFromDiff) : [];
                    const differentTargetDetails =
                      content.different_count > 0 ? content.different_sample.map(targetCompareObjectDetailFromDiff) : [];
                    const onlySourceHiddenCount = getCompareHiddenCount(
                      content.only_source_count,
                      onlySourceDetails.length,
                      content.only_source_hidden_count
                    );
                    const onlyTargetHiddenCount = getCompareHiddenCount(
                      content.only_target_count,
                      onlyTargetDetails.length,
                      content.only_target_hidden_count
                    );
                    const differentHiddenCount = getCompareHiddenCount(
                      content.different_count,
                      differentSourceDetails.length,
                      content.different_hidden_count
                    );
                    return [
                      {
                        key: "source_only",
                        label: `Source only (${content.only_source_count})`,
                        changed: content.only_source_count > 0,
                        objectCount: content.only_source_count,
                        visibleCount: onlySourceDetails.length,
                        hiddenCount: onlySourceHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(onlySourceDetails),
                        sourceDetails: onlySourceDetails,
                        targetDetails: [],
                      },
                      {
                        key: "target_only",
                        label: `Target only (${content.only_target_count})`,
                        changed: content.only_target_count > 0,
                        objectCount: content.only_target_count,
                        visibleCount: onlyTargetDetails.length,
                        hiddenCount: onlyTargetHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(onlyTargetDetails),
                        sourceDetails: [],
                        targetDetails: onlyTargetDetails,
                      },
                      {
                        key: "different",
                        label: `Different objects (${content.different_count})`,
                        changed: content.different_count > 0,
                        objectCount: content.different_count,
                        visibleCount: differentSourceDetails.length,
                        hiddenCount: differentHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(differentSourceDetails),
                        sourceDetails: differentSourceDetails,
                        targetDetails: differentTargetDetails,
                      },
                    ];
                  })()
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
                <UiDetails
                  key={`${item.sourceBucket}->${item.targetBucket}:${item.status}:${bucketHasDifferences ? "diff" : "same"}`}
                  defaultOpen={false}
                  className="border-t border-[color:var(--ui-border-soft)] first:border-t-0"
                >
                  <summary className="cursor-pointer list-none px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {item.sourceBucket} → {item.targetBucket}
                      </span>
                      <UiBadge tone={getRunStatusTone(item)} className="px-2 text-[10px]">
                        {getRunStatusLabel(item)}
                      </UiBadge>
                      {content && (
                        <span className="ui-caption text-slate-500 dark:text-slate-400">
                          Matched {content.matched_count} · Different {content.different_count} · Source only{" "}
                          {content.only_source_count} · Target only {content.only_target_count}
                          {content.ignored_after_cutoff_count ? ` · Ignored after cutoff ${content.ignored_after_cutoff_count}` : ""}
                        </span>
                      )}
                    </div>
                    <UiProgressBar
                      value={progressValue}
                      label={`Comparison progress for ${item.sourceBucket} to ${item.targetBucket}`}
                      className="mt-2 h-1.5 overflow-hidden bg-slate-200 dark:bg-slate-800"
                      barClassName="bg-primary-500 transition-[width] duration-200"
                    />
                  </summary>
                  <div className="space-y-3 px-3 pb-3">
                    {item.error && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{item.error}</p>}
                    {content && (
                      <UiDetails
                        defaultOpen={false}
                        className="border-t border-[color:var(--ui-border-soft)] pt-3"
                      >
                        <summary className="cursor-pointer list-none py-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                              Content diff (md5 or size)
                            </span>
                            <UiBadge tone={getChangedTone(contentHasDifferences)} className="px-2 text-[10px]">
                              {contentHasDifferences ? "Different" : "Identical"}
                            </UiBadge>
                          </div>
                        </summary>
                        <div className="mt-2 space-y-3">
                          {contentSections.map((section) => {
                            const sectionFeedbackId = `${item.sourceBucket}:${item.targetBucket}:content:${section.key}`;
                            const sectionCopyFeedback = copyFeedback?.id === sectionFeedbackId ? copyFeedback : null;
                            const displayLimitMessage = formatCompareDisplayLimitMessage(
                              section.objectCount,
                              section.visibleCount,
                              section.hiddenCount
                            );
                            return (
                              <UiDetails
                                key={sectionFeedbackId}
                                defaultOpen={false}
                                className="border-t border-[color:var(--ui-border-soft)] pt-2 first:border-t-0 first:pt-0"
                              >
                                <summary className="cursor-pointer list-none py-1.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{section.label}</span>
                                      <UiBadge tone={getChangedTone(section.changed)} className="px-2 text-[10px]">
                                        {section.changed ? "Different" : "Identical"}
                                      </UiBadge>
                                      {displayLimitMessage && (
                                        <UiBadge tone="warning" className="px-2 text-[10px]">
                                          Showing {section.visibleCount} of {section.objectCount}
                                        </UiBadge>
                                      )}
                                    </div>
                                    {section.changed && section.copyKeys.length > 0 && (
                                      <UiButton
                                        variant="secondary"
                                        className="py-1 ui-caption"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          void copyVisibleKeys(sectionFeedbackId, section.copyKeys);
                                        }}
                                      >
                                        Copy keys
                                      </UiButton>
                                    )}
                                  </div>
                                </summary>
                                <div className="mt-1 space-y-2 pb-2">
                                  {sectionCopyFeedback && (
                                    <p
                                      className={`rounded-md border px-2 py-1 ui-caption font-semibold ${copyFeedbackToneClass[sectionCopyFeedback.tone]}`}
                                    >
                                      {sectionCopyFeedback.message}
                                    </p>
                                  )}
                                  {displayLimitMessage && (
                                    <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
                                      {displayLimitMessage}
                                    </p>
                                  )}
                                  <div className="grid gap-2 lg:grid-cols-2">
                                    <div className="space-y-1">
                                      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Source
                                      </p>
                                      {renderCompareObjectDetails(section.sourceDetails, {
                                        onExplore: openExploreConfirm,
                                        buildBrowserHref: (detail) =>
                                          buildCephAdminBrowserHref(sourceEndpointId, item.sourceBucket, detail.key),
                                      })}
                                    </div>
                                    <div className="space-y-1">
                                      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Target
                                      </p>
                                      {renderCompareObjectDetails(section.targetDetails, {
                                        onExplore: openExploreConfirm,
                                        buildBrowserHref: (detail) =>
                                          buildCephAdminBrowserHref(
                                            item.result?.target_endpoint_id ?? targetEndpointId ?? sourceEndpointId,
                                            item.targetBucket,
                                            detail.key
                                          ),
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </UiDetails>
                            );
                          })}
                        </div>
                      </UiDetails>
                    )}
                    {item.result?.config_diff && (
                      <UiDetails
                        defaultOpen={false}
                        className="border-t border-[color:var(--ui-border-soft)] pt-3"
                      >
                        <summary className="cursor-pointer list-none py-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Config diff</span>
                            <UiBadge tone={getChangedTone(configHasDifferences)} className="px-2 text-[10px]">
                              {configHasDifferences ? "Different" : "Identical"}
                            </UiBadge>
                          </div>
                        </summary>
                        <div className="mt-2 space-y-3">
                          {configSections.map((section) => (
                            <UiDetails
                              key={`${item.sourceBucket}:${item.targetBucket}:config:${section.key}`}
                              defaultOpen={false}
                              className="border-t border-[color:var(--ui-border-soft)] pt-2 first:border-t-0 first:pt-0"
                            >
                              <summary className="cursor-pointer list-none py-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{section.label}</span>
                                  <UiBadge tone={getChangedTone(section.changed)} className="px-2 text-[10px]">
                                    {section.changed ? "Different" : "Identical"}
                                  </UiBadge>
                                </div>
                              </summary>
                              <div className="mt-1 grid gap-2 pb-2 lg:grid-cols-2">
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
                            </UiDetails>
                          ))}
                        </div>
                      </UiDetails>
                    )}
                  </div>
                </UiDetails>
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
      {pendingExplore && (
        <Modal
          title="Leave comparison page?"
          onClose={() => setPendingExplore(null)}
          maxWidthClass="max-w-lg"
          maxBodyHeightClass="max-h-[70vh]"
          zIndexClass="z-[60]"
        >
          <div className="space-y-3">
            <p className="ui-body text-slate-700 dark:text-slate-200">
              This will leave the bucket comparison page and open this object in Browser.
            </p>
            <p className="break-all rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-100">
              {pendingExplore.objectKey}
            </p>
            <div className="flex justify-end gap-2">
              <UiButton variant="secondary" onClick={() => setPendingExplore(null)}>
                Cancel
              </UiButton>
              <UiButton onClick={confirmExploreNavigation}>Open Browser</UiButton>
            </div>
          </div>
        </Modal>
      )}
    </WorkflowPage>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import Modal from "../../components/Modal";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import { UiTone, uiCheckboxClass, uiInputClass, uiLabelClass } from "../../components/ui/styles";
import {
  compareManagerBucketPair,
  listBuckets,
  ManagerBucketCompareAction,
  ManagerBucketCompareActionResult,
  ManagerBucketCompareResult,
  runManagerBucketCompareAction,
  type ManagerBucketCompareConfigFeature,
} from "../../api/buckets";
import type { ExecutionContext } from "../../api/executionContexts";

type CompareMapping = {
  sourceBucket: string;
  targetBucket: string;
};

type CompareRunItem = {
  sourceBucket: string;
  targetBucket: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  result?: ManagerBucketCompareResult;
  error?: string;
  actionRunning?: ManagerBucketCompareAction | null;
  actionFeedback?: {
    tone: UiTone;
    message: string;
  } | null;
};

type ParsedRawMappingResult = {
  mapping: Map<string, string>;
  invalidLines: string[];
};

type CompareRunOptionsSnapshot = {
  targetContextId: string;
  includeContent: boolean;
  includeConfig: boolean;
  configFeatures: ManagerBucketCompareConfigFeature[];
};

type RemediationSectionKey = "source_only" | "different" | "target_only";

type PendingRemediationAction = {
  itemIndex: number;
  action: ManagerBucketCompareAction;
  objectCount: number;
};

type ManagerBucketCompareModalProps = {
  sourceContextId: string;
  sourceContextName?: string | null;
  sourceBuckets: string[];
  contexts: ExecutionContext[];
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

const getRunStatusTone = (item: CompareRunItem): UiTone => {
  if (item.status === "failed") return "danger";
  if (item.status === "cancelled") return "warning";
  if (item.status === "success") {
    return item.result?.has_differences ? "warning" : "success";
  }
  return "neutral";
};

const getChangedTone = (changed: boolean): UiTone => (changed ? "warning" : "neutral");

const feedbackToneClass: Record<UiTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100",
  danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100",
  primary:
    "border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900/40 dark:bg-primary-950/40 dark:text-primary-100",
};

const remediationActionLabel: Record<ManagerBucketCompareAction, string> = {
  sync_source_only: "Sync missing",
  sync_different: "Sync different",
  delete_target_only: "Delete extra",
};

const remediationActionTitle: Record<ManagerBucketCompareAction, string> = {
  sync_source_only: "Confirm sync missing objects",
  sync_different: "Confirm sync different objects",
  delete_target_only: "Confirm delete extra objects",
};

const remediationSectionActionMap: Record<RemediationSectionKey, ManagerBucketCompareAction> = {
  source_only: "sync_source_only",
  different: "sync_different",
  target_only: "delete_target_only",
};

const parseRawMappingText = (value: string): ParsedRawMappingResult => {
  const mapping = new Map<string, string>();
  const invalidLines: string[] = [];
  const separators = ["=>", "->", "="] as const;
  value
    .split(/\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separator = separators.find((sep) => line.includes(sep));
      if (!separator) {
        invalidLines.push(line);
        return;
      }
      const [rawSource, ...rawTargetParts] = line.split(separator);
      const source = (rawSource ?? "").trim();
      const target = rawTargetParts.join(separator).trim();
      if (!source || !target) {
        invalidLines.push(line);
        return;
      }
      mapping.set(source, target);
    });
  return { mapping, invalidLines };
};

const CONFIG_FEATURE_OPTIONS: Array<{ key: ManagerBucketCompareConfigFeature; label: string }> = [
  { key: "versioning_status", label: "Versioning" },
  { key: "object_lock", label: "Object lock" },
  { key: "public_access_block", label: "Public access block" },
  { key: "lifecycle_rules", label: "Lifecycle rules" },
  { key: "cors_rules", label: "CORS rules" },
  { key: "bucket_policy", label: "Bucket policy" },
  { key: "access_logging", label: "Access logging" },
  { key: "tags", label: "Tags" },
];

const ALL_CONFIG_FEATURE_KEYS = CONFIG_FEATURE_OPTIONS.map((option) => option.key);

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

export default function ManagerBucketCompareModal({
  sourceContextId,
  sourceContextName,
  sourceBuckets,
  contexts,
  onClose,
}: ManagerBucketCompareModalProps) {
  const sortedSourceBuckets = useMemo(() => [...sourceBuckets].sort((a, b) => a.localeCompare(b)), [sourceBuckets]);
  const sourceBucketNameSet = useMemo(() => new Set(sortedSourceBuckets), [sortedSourceBuckets]);
  const targetContextOptions = useMemo(() => contexts, [contexts]);
  const [targetContextId, setTargetContextId] = useState<string | null>(null);
  const [targetBucketNames, setTargetBucketNames] = useState<string[]>([]);
  const [targetBucketsLoading, setTargetBucketsLoading] = useState(false);
  const [targetBucketsError, setTargetBucketsError] = useState<string | null>(null);
  const [mappingMode, setMappingMode] = useState<"by_name" | "manual">("by_name");
  const [manualMapping, setManualMapping] = useState<Record<string, string>>({});
  const [rawMappingText, setRawMappingText] = useState("");
  const [includeContent, setIncludeContent] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(false);
  const [selectedConfigFeatures, setSelectedConfigFeatures] = useState<ManagerBucketCompareConfigFeature[]>(
    () => [...ALL_CONFIG_FEATURE_KEYS]
  );
  const [parallelism, setParallelism] = useState(4);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, failed: 0, cancelled: 0 });
  const [items, setItems] = useState<CompareRunItem[]>([]);
  const [lastRunOptions, setLastRunOptions] = useState<CompareRunOptionsSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingRemediationAction | null>(null);
  const [resultSearch, setResultSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CompareRunItem["status"]>("all");
  const [diffFilter, setDiffFilter] = useState<"all" | "with_diff" | "no_diff">("all");
  const sameContextSelected = targetContextId === sourceContextId;
  const parsedRawMapping = useMemo(() => parseRawMappingText(rawMappingText), [rawMappingText]);
  const cancelRequestedRef = useRef(false);
  const requestControllersRef = useRef(new Set<AbortController>());
  const controlClass = uiInputClass;
  const compactControlClass =
    "w-full rounded-md border border-slate-200 px-2 py-1 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const contextDisplayNameById = useMemo(() => {
    const byId = new Map<string, string>();
    contexts.forEach((context) => {
      byId.set(context.id, context.display_name || context.id);
    });
    byId.set(sourceContextId, sourceContextName ?? sourceContextId);
    return byId;
  }, [contexts, sourceContextId, sourceContextName]);

  useEffect(() => {
    if (targetContextOptions.length === 0) {
      setTargetContextId(null);
      return;
    }
    setTargetContextId((prev) => {
      if (prev !== null && targetContextOptions.some((context) => context.id === prev)) {
        return prev;
      }
      return null;
    });
  }, [targetContextOptions]);

  useEffect(() => {
    if (sameContextSelected && mappingMode !== "manual") {
      setMappingMode("manual");
    }
  }, [mappingMode, sameContextSelected]);

  useEffect(() => {
    if (!targetContextId) {
      setTargetBucketNames([]);
      setTargetBucketsError("Select a target context.");
      return;
    }
    let cancelled = false;
    const load = async () => {
      setTargetBucketsLoading(true);
      setTargetBucketsError(null);
      try {
        const names = (await listBuckets(targetContextId, { with_stats: false }))
          .map((bucket) => (bucket.name ?? "").trim())
          .filter((name): name is string => Boolean(name))
          .sort((a, b) => a.localeCompare(b));
        if (cancelled) return;
        setTargetBucketNames(names);
        setManualMapping((prev) => {
          const next: Record<string, string> = {};
          Object.entries(prev).forEach(([sourceBucket, targetBucket]) => {
            const normalized = (targetBucket ?? "").trim();
            if (!normalized) return;
            if (targetContextId === sourceContextId && sourceBucketNameSet.has(normalized)) {
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
  }, [sourceBucketNameSet, sourceContextId, targetContextId]);

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
        if (byName && !(sameContextSelected && sourceBucketNameSet.has(byName))) {
          next[sourceBucket] = byName;
          return;
        }
        if (knownTargets.has(sourceBucket) && !(sameContextSelected && sourceBucketNameSet.has(sourceBucket))) {
          next[sourceBucket] = sourceBucket;
        }
      });
      return next;
    });
  }, [mappingMode, sameContextSelected, sortedSourceBuckets, sourceBucketNameSet, targetBucketNames]);

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
    if (!sameContextSelected) return targetBucketNames;
    return targetBucketNames.filter((name) => !sourceBucketNameSet.has(name));
  }, [sameContextSelected, sourceBucketNameSet, targetBucketNames]);

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
    if (!targetContextId) {
      return { mappings: [] as CompareMapping[], error: "Select a target context." };
    }
    if (sortedSourceBuckets.length === 0) {
      return { mappings: [] as CompareMapping[], error: "Select source buckets first." };
    }
    if (sameContextSelected && mappingMode !== "manual") {
      return { mappings: [] as CompareMapping[], error: "Same-context comparison requires manual mapping." };
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
      if (sameContextSelected && sourceBucketNameSet.has(targetBucket)) {
        invalidTargets.push(targetBucket);
        return;
      }
      mappings.push({ sourceBucket, targetBucket });
    });
    if (invalidTargets.length > 0) {
      return {
        mappings: [] as CompareMapping[],
        error: "When source and target context are the same, mapped target buckets must be outside the selected source set.",
      };
    }
    if (mappings.length === 0) {
      return {
        mappings: [] as CompareMapping[],
        error: "No mapping resolved. Add raw mapping lines, fill manual fields, or rely on 1:1 fallback when available.",
      };
    }
    return { mappings, error: null };
  }, [mappingMode, resolvedManualMapping, sameContextSelected, sortedSourceBuckets, sourceBucketNameSet, targetContextId]);

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
  const hasActionInFlight = useMemo(() => items.some((item) => Boolean(item.actionRunning)), [items]);
  const canRunComparison =
    !running &&
    !hasActionInFlight &&
    !comparePlan.error &&
    Boolean(targetContextId) &&
    hasScopeSelected &&
    (!includeConfig || hasConfigFeatureSelected);

  useEffect(() => {
    if (includeContent) return;
    setSizeOnly(false);
  }, [includeContent]);

  const toggleConfigFeature = (feature: ManagerBucketCompareConfigFeature, enabled: boolean) => {
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
    if (!targetContextId) {
      setRunError("Select a target context.");
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
    const snapshot: CompareRunOptionsSnapshot = {
      targetContextId,
      includeContent,
      includeConfig,
      configFeatures: includeConfig ? [...selectedConfigFeatures] : [],
    };
    setLastRunOptions(snapshot);
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
        actionRunning: null,
        actionFeedback: null,
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
          return await compareManagerBucketPair(
            sourceContextId,
            {
              target_context_id: snapshot.targetContextId,
              source_bucket: mapping.sourceBucket,
              target_bucket: mapping.targetBucket,
              include_content: snapshot.includeContent,
              include_config: snapshot.includeConfig,
              config_features: snapshot.includeConfig ? snapshot.configFeatures : undefined,
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
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
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
    setPendingAction(null);
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
    const controllers = requestControllersRef.current;
    return () => {
      cancelRequestedRef.current = true;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  const exportGlobalDiff = () => {
    if (items.length === 0) return;
    const targetContext = contexts.find((context) => context.id === targetContextId);
    const payload = {
      generated_at: new Date().toISOString(),
      source_context: {
        id: sourceContextId,
        name: sourceContextName ?? sourceContextId,
      },
      target_context: targetContextId
        ? {
            id: targetContextId,
            name: targetContext?.display_name ?? targetContextId,
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
    const filename = `bucket-compare-${sourceContextId}-to-${targetContextId ?? "na"}-${timestamp}.json`;
    triggerDownload(filename, JSON.stringify(payload, null, 2), "application/json");
  };

  const startRemediationAction = useCallback(
    async (pending: PendingRemediationAction) => {
      const currentItem = items[pending.itemIndex];
      if (!currentItem) return;

      const targetContextForAction =
        currentItem.result?.target_context_id || lastRunOptions?.targetContextId || targetContextId || null;
      if (!targetContextForAction) {
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  actionFeedback: {
                    tone: "danger",
                    message: "Unable to run action: target context is missing.",
                  },
                }
              : item
          )
        );
        return;
      }

      const safeActionParallelism = Number.isFinite(parallelism) ? Math.max(1, Math.min(32, Math.floor(parallelism))) : 4;
      setItems((prev) =>
        prev.map((item, index) =>
          index === pending.itemIndex
            ? {
                ...item,
                actionRunning: pending.action,
                actionFeedback: null,
              }
            : item
        )
      );

      let actionResult: ManagerBucketCompareActionResult;
      try {
        actionResult = await runManagerBucketCompareAction(sourceContextId, {
          target_context_id: targetContextForAction,
          source_bucket: currentItem.sourceBucket,
          target_bucket: currentItem.targetBucket,
          action: pending.action,
          parallelism: safeActionParallelism,
        });
      } catch (err) {
        const error = extractError(err);
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  actionRunning: null,
                  actionFeedback: {
                    tone: "danger",
                    message: `Action failed: ${error}`,
                  },
                }
              : item
          )
        );
        return;
      }

      const actionTone: UiTone =
        actionResult.failed_count <= 0 ? "success" : actionResult.succeeded_count > 0 ? "warning" : "danger";
      const actionMessage = actionResult.message;
      setItems((prev) =>
        prev.map((item, index) =>
          index === pending.itemIndex
            ? {
                ...item,
                actionFeedback: {
                  tone: actionTone,
                  message: actionMessage,
                },
              }
            : item
        )
      );

      const refreshOptions: CompareRunOptionsSnapshot = lastRunOptions ?? {
        targetContextId: targetContextForAction,
        includeContent: true,
        includeConfig: false,
        configFeatures: [],
      };
      try {
        const refreshedResult = await compareManagerBucketPair(sourceContextId, {
          target_context_id: refreshOptions.targetContextId,
          source_bucket: currentItem.sourceBucket,
          target_bucket: currentItem.targetBucket,
          include_content: refreshOptions.includeContent,
          include_config: refreshOptions.includeConfig,
          config_features: refreshOptions.includeConfig ? refreshOptions.configFeatures : undefined,
        });
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  status: "success",
                  result: refreshedResult,
                  error: undefined,
                  actionRunning: null,
                }
              : item
          )
        );
      } catch (err) {
        const error = extractError(err);
        setItems((prev) =>
          prev.map((item, index) =>
            index === pending.itemIndex
              ? {
                  ...item,
                  status: "failed",
                  error: `Action applied, but re-compare failed: ${error}`,
                  actionRunning: null,
                }
              : item
          )
        );
      }
    },
    [items, lastRunOptions, parallelism, sourceContextId, targetContextId]
  );

  const openRemediationConfirm = useCallback(
    (itemIndex: number, sectionKey: RemediationSectionKey, objectCount: number) => {
      const item = items[itemIndex];
      if (!item) return;
      if (item.status !== "success") return;
      if (running || item.actionRunning) return;
      if (objectCount <= 0) return;
      setPendingAction({
        itemIndex,
        action: remediationSectionActionMap[sectionKey],
        objectCount,
      });
    },
    [items, running]
  );

  const confirmRemediationAction = useCallback(async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    await startRemediationAction(action);
  }, [pendingAction, startRemediationAction]);

  const pendingActionItem = pendingAction ? items[pendingAction.itemIndex] : null;
  const pendingActionSourceContextId = pendingActionItem?.result?.source_context_id ?? sourceContextId;
  const pendingActionTargetContextId =
    pendingActionItem?.result?.target_context_id || lastRunOptions?.targetContextId || targetContextId || "";
  const pendingActionSourceContextName =
    contextDisplayNameById.get(pendingActionSourceContextId) ?? pendingActionSourceContextId;
  const pendingActionTargetContextName =
    contextDisplayNameById.get(pendingActionTargetContextId) ?? pendingActionTargetContextId;

  return (
    <Modal title="Compare buckets" onClose={handleClose} maxWidthClass="max-w-7xl" maxBodyHeightClass="max-h-[85vh]">
      <div className="space-y-4">
        <p className="ui-body text-slate-700 dark:text-slate-200">
          Compare <span className="font-semibold">{sortedSourceBuckets.length}</span> source bucket
          {sortedSourceBuckets.length > 1 ? "s" : ""} from{" "}
          <span className="font-semibold">{sourceContextName ?? sourceContextId}</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className={uiLabelClass}>Target context</label>
            <select
              value={targetContextId ?? ""}
              onChange={(event) => setTargetContextId(event.target.value ? event.target.value : null)}
              disabled={running || targetContextOptions.length === 0}
              className={controlClass}
            >
              {targetContextOptions.length > 0 && <option value="">Select a target context</option>}
              {targetContextOptions.length === 0 && <option value="">No other context available</option>}
              {targetContextOptions.map((context) => (
                <option key={context.id} value={context.id}>
                  {context.display_name}
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
              <option value="by_name" disabled={sameContextSelected}>
                1:1 by bucket name{sameContextSelected ? " (disabled on same context)" : ""}
              </option>
              <option value="manual">Manual mapping</option>
            </select>
          </div>
        </div>
        {sameContextSelected && (
          <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
            Same-context comparison is enabled: manual mapping is required, and selected source buckets are excluded from targets.
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
            {filteredItems.map(({ item, index: itemIndex }) => {
              const content = item.result?.content_diff;
              const contentHasDifferences = Boolean(
                content && (content.different_count > 0 || content.only_source_count > 0 || content.only_target_count > 0)
              );
              const contentSections = content
                ? [
                    {
                      key: "source_only" as const,
                      label: `Source only (${content.only_source_count})`,
                      changed: content.only_source_count > 0,
                      objectCount: content.only_source_count,
                      action:
                        content.only_source_count > 0
                          ? {
                              type: "sync_source_only" as const,
                              label: remediationActionLabel.sync_source_only,
                            }
                          : null,
                      before:
                        content.only_source_count > 0
                          ? content.only_source_sample.length > 0
                            ? content.only_source_sample.map((key) => ({ text: key, tone: "removed" as const }))
                            : [{ text: "(sample not available)", tone: "removed" as const }]
                          : [{ text: "(none)" }],
                      after: [{ text: "(none)" }],
                    },
                    {
                      key: "target_only" as const,
                      label: `Target only (${content.only_target_count})`,
                      changed: content.only_target_count > 0,
                      objectCount: content.only_target_count,
                      action:
                        content.only_target_count > 0
                          ? {
                              type: "delete_target_only" as const,
                              label: remediationActionLabel.delete_target_only,
                            }
                          : null,
                      before: [{ text: "(none)" }],
                      after:
                        content.only_target_count > 0
                          ? content.only_target_sample.length > 0
                            ? content.only_target_sample.map((key) => ({ text: key, tone: "added" as const }))
                            : [{ text: "(sample not available)", tone: "added" as const }]
                          : [{ text: "(none)" }],
                    },
                    {
                      key: "different" as const,
                      label: `Different objects (${content.different_count})`,
                      changed: content.different_count > 0,
                      objectCount: content.different_count,
                      action:
                        content.different_count > 0
                          ? {
                              type: "sync_different" as const,
                              label: remediationActionLabel.sync_different,
                            }
                          : null,
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
                        {item.sourceBucket} {"->"} {item.targetBucket}
                      </span>
                      <UiBadge tone={getRunStatusTone(item)} className="px-2 text-[10px]">
                        {item.status}
                      </UiBadge>
                      {content && (
                        <span className="ui-caption text-slate-500 dark:text-slate-400">
                          Matched {content.matched_count} | Different {content.different_count} | Source only{" "}
                          {content.only_source_count} | Target only {content.only_target_count}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 relative h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div className="h-full bg-primary-500 transition-[width] duration-200" style={{ width: `${progressValue}%` }} />
                    </div>
                  </summary>
                  <div className="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                    {item.error && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{item.error}</p>}
                    {item.actionFeedback && (
                      <p
                        className={`rounded-md border px-2 py-1 ui-caption font-semibold ${feedbackToneClass[item.actionFeedback.tone]}`}
                      >
                        {item.actionFeedback.message}
                      </p>
                    )}
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
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{section.label}</span>
                                    <UiBadge tone={getChangedTone(section.changed)} className="px-2 text-[10px]">
                                      {section.changed ? "Different" : "Identical"}
                                    </UiBadge>
                                  </div>
                                  {section.action && (
                                    <UiButton
                                      variant={section.action.type === "delete_target_only" ? "danger" : "secondary"}
                                      disabled={
                                        running ||
                                        item.status !== "success" ||
                                        !content ||
                                        Boolean(item.actionRunning) ||
                                        item.actionRunning === section.action.type
                                      }
                                      className="py-1 ui-caption"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        openRemediationConfirm(itemIndex, section.key, section.objectCount);
                                      }}
                                    >
                                      {item.actionRunning === section.action.type ? "Running..." : section.action.label}
                                    </UiButton>
                                  )}
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
      {pendingAction && pendingActionItem && (
        <Modal
          title={remediationActionTitle[pendingAction.action]}
          onClose={() => setPendingAction(null)}
          maxWidthClass="max-w-2xl"
          maxBodyHeightClass="max-h-[70vh]"
          zIndexClass="z-[60]"
        >
          <div className="space-y-3">
            <p className="ui-body text-slate-700 dark:text-slate-200">
              This will run <span className="font-semibold">{remediationActionLabel[pendingAction.action]}</span> on the full
              object set for this pair.
            </p>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
              <p className="ui-caption text-slate-700 dark:text-slate-200">
                Source context: <span className="font-semibold">{pendingActionSourceContextName}</span>
              </p>
              <p className="ui-caption text-slate-700 dark:text-slate-200">
                Target context: <span className="font-semibold">{pendingActionTargetContextName}</span>
              </p>
              <p className="ui-caption text-slate-700 dark:text-slate-200">
                Source bucket: <span className="font-semibold">{pendingActionItem.sourceBucket}</span>
              </p>
              <p className="ui-caption text-slate-700 dark:text-slate-200">
                Target bucket: <span className="font-semibold">{pendingActionItem.targetBucket}</span>
              </p>
              <p className="ui-caption text-slate-700 dark:text-slate-200">
                Estimated objects impacted: <span className="font-semibold">{pendingAction.objectCount}</span>
              </p>
            </div>
            {pendingAction.action === "delete_target_only" && (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 ui-caption font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
                This action is destructive and removes extra objects from the target bucket.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <UiButton variant="secondary" onClick={() => setPendingAction(null)}>
                Cancel
              </UiButton>
              <UiButton
                variant={pendingAction.action === "delete_target_only" ? "danger" : "primary"}
                onClick={() => {
                  void confirmRemediationAction();
                }}
              >
                Confirm
              </UiButton>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

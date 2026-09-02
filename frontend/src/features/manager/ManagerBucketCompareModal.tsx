/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../components/Modal";
import WorkflowPage from "../../components/WorkflowPage";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiDetails from "../../components/ui/UiDetails";
import UiProgressBar from "../../components/ui/UiProgressBar";
import UiSelect from "../../components/ui/UiSelect";
import { UiTone, uiCheckboxClass, uiInputClass } from "../../components/ui/styles";
import { proxyDownload } from "../../api/browser";
import { runWithConcurrencySettled } from "../../utils/concurrency";
import {
  compareManagerBucketPair,
  listBuckets,
  ManagerBucketCompareAction,
  ManagerBucketCompareActionResult,
  ManagerBucketCompareResult,
  ManagerBucketObjectDetail,
  runManagerBucketCompareAction,
  type ManagerBucketCompareConfigFeature,
} from "../../api/buckets";
import type { ExecutionContext } from "../../api/executionContexts";
import {
  BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS,
  BucketCompareManualMappingEditor,
  CompareVisibleKeysCopyFeedback,
  bucketComparisonCancelledMessage,
  buildBucketCompareMappingModel,
  compareObjectDetailsFromKeys,
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
  renderCompareObjectDetails,
  renderDiffLines,
  resolveBucketCompareRunSettlement,
  sourceCompareObjectDetailFromDiff,
  summarizeBucketCompareRun,
  targetCompareObjectDetailFromDiff,
  updateBucketCompareRunItem,
  updateBucketCompareRunProgress,
  useBucketCompareConfigFeatures,
  useBucketCompareManualMappingState,
  useCompareVisibleKeysClipboard,
} from "../shared/bucketCompareShared";
import {
  formatDownloadTimestamp,
  triggerBlobDownload,
  triggerJsonDownload,
} from "../../utils/download";

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

type CompareRunOptionsSnapshot = {
  targetContextId: string;
  includeContent: boolean;
  includeConfig: boolean;
  configFeatures: ManagerBucketCompareConfigFeature[];
  ignoreModifiedAfterIso: string | null;
};

type RemediationSectionKey = "source_only" | "different" | "target_only";

type PendingRemediationAction = {
  itemIndex: number;
  action: ManagerBucketCompareAction;
  objectKeys: string[];
  visibleOnly?: boolean;
};

type ManagerBucketCompareModalProps = {
  sourceContextId: string;
  sourceContextName?: string | null;
  sourceBuckets: string[];
  contexts: ExecutionContext[];
  managerBrowserEnabled?: boolean;
  onClose: () => void;
};

const extractError = extractCompareError;

const downloadFilenameFromKey = (key: string) => {
  const filename = key.split("/").filter(Boolean).pop();
  return filename || "download";
};

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
  sync_source_only: "Sync all missing",
  sync_different: "Sync all different",
  delete_target_only: "Delete all extra",
};

const remediationVisibleActionLabel: Record<ManagerBucketCompareAction, string> = {
  sync_source_only: "Sync visible missing",
  sync_different: "Sync visible different",
  delete_target_only: "Delete visible extra",
};

const remediationActionTitle: Record<ManagerBucketCompareAction, string> = {
  sync_source_only: "Confirm sync missing objects",
  sync_different: "Confirm sync different objects",
  delete_target_only: "Confirm delete extra objects",
};

const remediationSingleActionLabel: Record<ManagerBucketCompareAction, string> = {
  sync_source_only: "Sync this object",
  sync_different: "Sync this object",
  delete_target_only: "Delete this object",
};

const remediationSectionActionMap: Record<RemediationSectionKey, ManagerBucketCompareAction> = {
  source_only: "sync_source_only",
  different: "sync_different",
  target_only: "delete_target_only",
};

const CONFIG_FEATURE_OPTIONS: Array<{ key: ManagerBucketCompareConfigFeature; label: string }> =
  BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS.map((option) => ({
    key: option.key as ManagerBucketCompareConfigFeature,
    label: option.label,
  }));

const ALL_CONFIG_FEATURE_KEYS = CONFIG_FEATURE_OPTIONS.map((option) => option.key);

export default function ManagerBucketCompareModal({
  sourceContextId,
  sourceContextName,
  sourceBuckets,
  contexts,
  managerBrowserEnabled = true,
  onClose,
}: ManagerBucketCompareModalProps) {
  const sortedSourceBuckets = useMemo(() => [...sourceBuckets].sort((a, b) => a.localeCompare(b)), [sourceBuckets]);
  const targetContextOptions = useMemo(() => contexts, [contexts]);
  const [targetContextId, setTargetContextId] = useState<string | null>(null);
  const [targetBucketNames, setTargetBucketNames] = useState<string[]>([]);
  const [targetBucketsLoading, setTargetBucketsLoading] = useState(false);
  const [targetBucketsError, setTargetBucketsError] = useState<string | null>(null);
  const [mappingMode, setMappingMode] = useState<"by_name" | "manual">("by_name");
  const [includeContent, setIncludeContent] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(false);
  const [ignoreModifiedAfter, setIgnoreModifiedAfter] = useState("");
  const [parallelism, setParallelism] = useState(4);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, failed: 0, cancelled: 0 });
  const [items, setItems] = useState<CompareRunItem[]>([]);
  const [lastRunOptions, setLastRunOptions] = useState<CompareRunOptionsSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingRemediationAction | null>(null);
  const [downloadFeedback, setDownloadFeedback] = useState<(CompareVisibleKeysCopyFeedback & { id: string }) | null>(null);
  const [downloadInFlight, setDownloadInFlight] = useState<string | null>(null);
  const [resultSearch, setResultSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CompareRunItem["status"]>("all");
  const [diffFilter, setDiffFilter] = useState<"all" | "with_diff" | "no_diff">("all");
  const sameContextSelected = targetContextId === sourceContextId;
  const {
    manualMapping,
    parsedRawMapping,
    rawMappingText,
    setManualMapping,
    setRawMappingText,
  } = useBucketCompareManualMappingState({
    mappingMode,
    sourceBuckets: sortedSourceBuckets,
    targetBuckets: targetBucketNames,
    sameTargetSelected: sameContextSelected,
  });
  const {
    selectedConfigFeatures,
    setSelectedConfigFeatures,
    toggleConfigFeature,
  } = useBucketCompareConfigFeatures<ManagerBucketCompareConfigFeature>(
    ALL_CONFIG_FEATURE_KEYS
  );
  const cancelRequestedRef = useRef(false);
  const requestControllersRef = useRef(new Set<AbortController>());
  const { copyFeedback, copyVisibleKeys } = useCompareVisibleKeysClipboard();
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
  }, [sourceContextId, targetContextId]);

  const {
    availableTargetBucketNames,
    resolvedManualMapping,
    comparePlan,
    missingByName,
  } = useMemo(
    () =>
      buildBucketCompareMappingModel({
        targetSelected: Boolean(targetContextId),
        targetKind: "context",
        sourceBuckets: sortedSourceBuckets,
        targetBuckets: targetBucketNames,
        sameTargetSelected: sameContextSelected,
        mappingMode,
        rawMapping: parsedRawMapping.mapping,
        manualMapping,
      }),
    [
      manualMapping,
      mappingMode,
      parsedRawMapping.mapping,
      sameContextSelected,
      sortedSourceBuckets,
      targetBucketNames,
      targetContextId,
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
  const hasActionInFlight = useMemo(() => items.some((item) => Boolean(item.actionRunning)), [items]);
  const canRunComparison =
    !running &&
    !hasActionInFlight &&
    !comparePlan.error &&
    Boolean(targetContextId) &&
    hasScopeSelected &&
    (!includeConfig || hasConfigFeatureSelected) &&
    !ignoreModifiedAfterInvalid;

  const buildManagerBrowserHref = useCallback((contextId: string, bucket: string, key: string) => {
    const params = new URLSearchParams();
    params.set("ctx", contextId);
    params.set("bucket", bucket);
    const prefix = getObjectParentPrefix(key);
    if (prefix) params.set("prefix", prefix);
    return `/manager/browser?${params.toString()}`;
  }, []);
  const managerBrowserDisabledReason = managerBrowserEnabled
    ? null
    : "Manager Browser is disabled for this surface.";

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
    const snapshot: CompareRunOptionsSnapshot = {
      targetContextId,
      includeContent,
      includeConfig,
      configFeatures: includeConfig ? [...selectedConfigFeatures] : [],
      ignoreModifiedAfterIso,
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

    try {
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
                ignore_modified_after: snapshot.ignoreModifiedAfterIso,
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
    } catch (err) {
      const error = extractError(err);
      setRunError(error);
      setItems((prev) =>
        prev.map((item) =>
          item.status === "pending" || item.status === "running"
            ? {
                ...item,
                status: "failed",
                error,
              }
            : item
        )
      );
    } finally {
      requestControllersRef.current.forEach((controller) => controller.abort());
      requestControllersRef.current.clear();
      setRunning(false);
      setStopping(false);
    }
  };

  const resultSummary = useMemo(() => summarizeBucketCompareRun(items), [items]);

  const filteredItems = useMemo(() => {
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
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
    setPendingAction(null);
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
    const filename = `bucket-compare-${sourceContextId}-to-${targetContextId ?? "na"}-${timestamp}.json`;
    triggerJsonDownload(filename, payload);
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
          object_keys: pending.objectKeys,
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
        ignoreModifiedAfterIso: ignoreModifiedAfterIso,
      };
      try {
        const refreshedResult = await compareManagerBucketPair(sourceContextId, {
          target_context_id: refreshOptions.targetContextId,
          source_bucket: currentItem.sourceBucket,
          target_bucket: currentItem.targetBucket,
          include_content: refreshOptions.includeContent,
          include_config: refreshOptions.includeConfig,
          config_features: refreshOptions.includeConfig ? refreshOptions.configFeatures : undefined,
          ignore_modified_after: refreshOptions.ignoreModifiedAfterIso,
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
    [ignoreModifiedAfterIso, items, lastRunOptions, parallelism, sourceContextId, targetContextId]
  );

  const openRemediationConfirm = useCallback(
    (itemIndex: number, sectionKey: RemediationSectionKey, objectKeys: string[], visibleOnly = false) => {
      const item = items[itemIndex];
      if (!item) return;
      if (item.status !== "success") return;
      if (running || item.actionRunning) return;
      if (objectKeys.length <= 0) return;
      setPendingAction({
        itemIndex,
        action: remediationSectionActionMap[sectionKey],
        objectKeys: [...objectKeys],
        visibleOnly,
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

  const downloadCompareObject = useCallback(
    async (params: { contextId: string; bucket: string; key: string; feedbackId: string }) => {
      if (managerBrowserDisabledReason || downloadInFlight) return;
      const downloadId = `${params.contextId}:${params.bucket}:${params.key}`;
      setDownloadInFlight(downloadId);
      setDownloadFeedback(null);
      try {
        const blob = await proxyDownload(params.contextId, params.bucket, params.key);
        triggerBlobDownload(downloadFilenameFromKey(params.key), blob);
        setDownloadFeedback({
          id: params.feedbackId,
          tone: "success",
          message: `Download started for ${params.key}.`,
        });
      } catch {
        setDownloadFeedback({
          id: params.feedbackId,
          tone: "danger",
          message: `Unable to download ${params.key}.`,
        });
      } finally {
        setDownloadInFlight(null);
      }
    },
    [downloadInFlight, managerBrowserDisabledReason]
  );

  const pendingActionItem = pendingAction ? items[pendingAction.itemIndex] : null;
  const pendingActionSourceContextId = pendingActionItem?.result?.source_context_id ?? sourceContextId;
  const pendingActionTargetContextId =
    pendingActionItem?.result?.target_context_id || lastRunOptions?.targetContextId || targetContextId || "";
  const pendingActionSourceContextName =
    contextDisplayNameById.get(pendingActionSourceContextId) ?? pendingActionSourceContextId;
  const pendingActionTargetContextName =
    contextDisplayNameById.get(pendingActionTargetContextId) ?? pendingActionTargetContextId;

  return (
    <WorkflowPage
      title="Compare buckets"
      description="Configure the target mapping, run the comparison, and review or remediate differences without leaving the workflow."
      breadcrumbs={managerPageBreadcrumbs("compare", { label: "Run" })}
      backLabel="Back to bucket selection"
      onBack={handleClose}
      contentClassName="space-y-4"
    >
      <div className="space-y-4">
        <p className="ui-body text-slate-700 dark:text-slate-200">
          Compare <span className="font-semibold">{sortedSourceBuckets.length}</span> source bucket
          {sortedSourceBuckets.length > 1 ? "s" : ""} from{" "}
          <span className="font-semibold">{sourceContextName ?? sourceContextId}</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <UiSelect
            label="Target context"
            value={targetContextId ?? ""}
            onChange={(event) => setTargetContextId(event.target.value ? event.target.value : null)}
            disabled={running || targetContextOptions.length === 0}
          >
            {targetContextOptions.length > 0 && <option value="">Select a target context</option>}
            {targetContextOptions.length === 0 && <option value="">No other context available</option>}
            {targetContextOptions.map((context) => (
              <option key={context.id} value={context.id}>
                {context.display_name}
              </option>
            ))}
          </UiSelect>
          <UiSelect
            label="Mapping mode"
            value={mappingMode}
            onChange={(event) => setMappingMode(event.target.value as "by_name" | "manual")}
            disabled={running}
          >
            <option value="by_name" disabled={sameContextSelected}>
              1:1 by bucket name{sameContextSelected ? " (disabled on same context)" : ""}
            </option>
            <option value="manual">Manual mapping</option>
          </UiSelect>
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
                {running ? "Processing" : "Completed"} {progress.completed} / {progress.total} mappings
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
            {filteredItems.map(({ item, index: itemIndex }) => {
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
                        key: "source_only" as const,
                        label: `Source only (${content.only_source_count})`,
                        changed: content.only_source_count > 0,
                        objectCount: content.only_source_count,
                        visibleCount: onlySourceDetails.length,
                        hiddenCount: onlySourceHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(onlySourceDetails),
                        action:
                          content.only_source_count > 0
                            ? {
                                type: "sync_source_only" as const,
                                label:
                                  onlySourceHiddenCount > 0
                                    ? remediationVisibleActionLabel.sync_source_only
                                    : remediationActionLabel.sync_source_only,
                              }
                            : null,
                        sourceDetails: onlySourceDetails,
                        targetDetails: [],
                      },
                      {
                        key: "target_only" as const,
                        label: `Target only (${content.only_target_count})`,
                        changed: content.only_target_count > 0,
                        objectCount: content.only_target_count,
                        visibleCount: onlyTargetDetails.length,
                        hiddenCount: onlyTargetHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(onlyTargetDetails),
                        action:
                          content.only_target_count > 0
                            ? {
                                type: "delete_target_only" as const,
                                label:
                                  onlyTargetHiddenCount > 0
                                    ? remediationVisibleActionLabel.delete_target_only
                                    : remediationActionLabel.delete_target_only,
                              }
                            : null,
                        sourceDetails: [],
                        targetDetails: onlyTargetDetails,
                      },
                      {
                        key: "different" as const,
                        label: `Different objects (${content.different_count})`,
                        changed: content.different_count > 0,
                        objectCount: content.different_count,
                        visibleCount: differentSourceDetails.length,
                        hiddenCount: differentHiddenCount,
                        copyKeys: getVisibleCompareObjectKeys(differentSourceDetails),
                        action:
                          content.different_count > 0
                            ? {
                                type: "sync_different" as const,
                                label:
                                  differentHiddenCount > 0
                                    ? remediationVisibleActionLabel.sync_different
                                    : remediationActionLabel.sync_different,
                              }
                            : null,
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
                        {item.sourceBucket} {"->"} {item.targetBucket}
                      </span>
                      <UiBadge tone={getRunStatusTone(item)} className="px-2 text-[10px]">
                        {getRunStatusLabel(item)}
                      </UiBadge>
                      {content && (
                        <span className="ui-caption text-slate-500 dark:text-slate-400">
                          Matched {content.matched_count} | Different {content.different_count} | Source only{" "}
                          {content.only_source_count} | Target only {content.only_target_count}
                          {content.ignored_after_cutoff_count ? ` | Ignored after cutoff ${content.ignored_after_cutoff_count}` : ""}
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
                    {item.actionFeedback && (
                      <p
                        className={`rounded-md border px-2 py-1 ui-caption font-semibold ${feedbackToneClass[item.actionFeedback.tone]}`}
                      >
                        {item.actionFeedback.message}
                      </p>
                    )}
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
                            const sectionDownloadFeedback =
                              downloadFeedback?.id === sectionFeedbackId ? downloadFeedback : null;
                            const displayLimitMessage = formatCompareDisplayLimitMessage(
                              section.objectCount,
                              section.visibleCount,
                              section.hiddenCount
                            );
                            const sourceContextForRow = item.result?.source_context_id ?? sourceContextId;
                            const targetContextForRow =
                              item.result?.target_context_id || lastRunOptions?.targetContextId || targetContextId || "";
                            const renderObjectActions = (
                              contextId: string,
                              bucket: string,
                              includeRemediation: boolean,
                              remediationVariant: "secondary" | "danger"
                            ) => (detail: ManagerBucketObjectDetail) => {
                              const downloadId = `${contextId}:${bucket}:${detail.key}`;
                              const downloadDisabled =
                                Boolean(managerBrowserDisabledReason) || Boolean(downloadInFlight) || running;
                              return (
                                <>
                                  <UiButton
                                    variant="secondary"
                                    disabled={downloadDisabled}
                                    title={managerBrowserDisabledReason ?? undefined}
                                    className="py-1 ui-caption"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void downloadCompareObject({
                                        contextId,
                                        bucket,
                                        key: detail.key,
                                        feedbackId: sectionFeedbackId,
                                      });
                                    }}
                                  >
                                    {downloadInFlight === downloadId ? "Downloading..." : "Download"}
                                  </UiButton>
                                  {section.action && includeRemediation && (
                                    <UiButton
                                      variant={remediationVariant}
                                      disabled={running || item.status !== "success" || Boolean(item.actionRunning)}
                                      className="py-1 ui-caption"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        openRemediationConfirm(itemIndex, section.key, [detail.key]);
                                      }}
                                    >
                                      {item.actionRunning === section.action.type
                                        ? "Running..."
                                        : remediationSingleActionLabel[section.action.type]}
                                    </UiButton>
                                  )}
                                </>
                              );
                            };
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
                                    <div className="flex flex-wrap items-center gap-2">
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
                                      {section.action && (
                                        <UiButton
                                          variant={section.action.type === "delete_target_only" ? "danger" : "secondary"}
                                          disabled={
                                            running ||
                                            item.status !== "success" ||
                                            !content ||
                                            section.copyKeys.length === 0 ||
                                            Boolean(item.actionRunning) ||
                                            item.actionRunning === section.action.type
                                          }
                                          className="py-1 ui-caption"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            openRemediationConfirm(
                                              itemIndex,
                                              section.key,
                                              section.copyKeys,
                                              section.hiddenCount > 0
                                            );
                                          }}
                                        >
                                          {item.actionRunning === section.action.type ? "Running..." : section.action.label}
                                        </UiButton>
                                      )}
                                    </div>
                                  </div>
                                </summary>
                                <div className="mt-1 space-y-2 pb-2">
                                  {sectionCopyFeedback && (
                                    <p
                                      className={`rounded-md border px-2 py-1 ui-caption font-semibold ${feedbackToneClass[sectionCopyFeedback.tone]}`}
                                    >
                                      {sectionCopyFeedback.message}
                                    </p>
                                  )}
                                  {sectionDownloadFeedback && (
                                    <p
                                      className={`rounded-md border px-2 py-1 ui-caption font-semibold ${feedbackToneClass[sectionDownloadFeedback.tone]}`}
                                    >
                                      {sectionDownloadFeedback.message}
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
                                        browserDisabledReason: managerBrowserDisabledReason,
                                        buildBrowserHref: (detail) =>
                                          buildManagerBrowserHref(
                                            sourceContextForRow,
                                            item.sourceBucket,
                                            detail.key
                                          ),
                                        renderAction:
                                          section.sourceDetails.length > 0
                                            ? renderObjectActions(
                                                sourceContextForRow,
                                                item.sourceBucket,
                                                section.key !== "target_only",
                                                "secondary"
                                              )
                                            : undefined,
                                      })}
                                    </div>
                                    <div className="space-y-1">
                                      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Target
                                      </p>
                                      {renderCompareObjectDetails(section.targetDetails, {
                                        browserDisabledReason: managerBrowserDisabledReason,
                                        buildBrowserHref: (detail) =>
                                          buildManagerBrowserHref(
                                            targetContextForRow,
                                            item.targetBucket,
                                            detail.key
                                          ),
                                        renderAction:
                                          section.targetDetails.length > 0
                                            ? renderObjectActions(
                                                targetContextForRow,
                                                item.targetBucket,
                                                section.key === "target_only",
                                                "danger"
                                              )
                                            : undefined,
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
              This will run{" "}
              <span className="font-semibold">
                {pendingAction.objectKeys.length === 1
                  ? remediationSingleActionLabel[pendingAction.action]
                  : pendingAction.visibleOnly
                    ? remediationVisibleActionLabel[pendingAction.action]
                  : remediationActionLabel[pendingAction.action]}
              </span>{" "}
              for the exact object keys from the current diff.
            </p>
            {pendingAction.visibleOnly && (
              <p className="ui-caption font-semibold text-amber-700 dark:text-amber-200">
                This diff section is truncated; only displayed keys will be remediated.
              </p>
            )}
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
                Objects impacted: <span className="font-semibold">{pendingAction.objectKeys.length}</span>
              </p>
              {(lastRunOptions?.ignoreModifiedAfterIso ?? ignoreModifiedAfterIso) && (
                <p className="ui-caption text-slate-700 dark:text-slate-200">
                  Cutoff:{" "}
                  <span className="font-semibold">{lastRunOptions?.ignoreModifiedAfterIso ?? ignoreModifiedAfterIso}</span>
                </p>
              )}
              <div className="mt-2 max-h-48 overflow-auto rounded-md border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
                {pendingAction.objectKeys.map((key) => (
                  <p key={key} className="break-all font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-100">
                    {key}
                  </p>
                ))}
              </div>
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
    </WorkflowPage>
  );
}

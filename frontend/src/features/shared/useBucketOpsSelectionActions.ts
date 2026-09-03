/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CephAdminBucket,
  ListCephAdminBucketsParams,
} from "../../api/cephAdminBuckets";
import type { BucketIndexCheckTarget } from "../../api/bucketIndexCheck";
import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import { triggerDownload } from "../../utils/download";
import type { ActionProgressState } from "./actionProgress";
import type { SelectionExportFormat } from "./bucketBulkOperationsModel";
import type { BucketUiTagDraft } from "./bucketOpsRowTagModel";
import type { BucketOpsSelectionExportArtifact } from "./bucketOpsSelectionExport";
import { resolveBucketOpsSelectionTargets } from "./bucketOpsSelectionTargets";
import { formatBucketNamesPreview } from "./bucketOpsPresentation";
import { parseUiTags } from "./bucketOpsListState";
import type { BucketUiTagTarget } from "./bucketUiTags";

type SelectionTagAction = "add" | "remove";

type UseBucketOpsSelectionActionsOptions = {
  bucketNames: readonly string[];
  download?: (
    filename: string,
    content: string,
    mimeType: string,
  ) => void;
  extractError: (error: unknown) => string;
  isStorageOps: boolean;
  listBuckets: (
    scopeId: number,
    params: ListCephAdminBucketsParams,
  ) => Promise<{ items?: CephAdminBucket[]; has_next: boolean }>;
  persistUiTagChanges: (
    targets: BucketUiTagTarget[],
    add: Array<BucketUiTagDefinition | BucketUiTagDraft>,
    remove: BucketUiTagDefinition[],
    options?: {
      onProgress?: (progress: { completed: number; total: number }) => void;
    },
  ) => Promise<void>;
  prepareExport: (
    format: SelectionExportFormat,
    onProgress: (completed: number, total: number) => void,
  ) => Promise<BucketOpsSelectionExportArtifact>;
  refreshBuckets: () => void;
  resolveTarget: (bucket: CephAdminBucket) => BucketUiTagTarget | null;
  scopeId: number | null;
  scopeKey: string;
  setError: (message: string) => void;
};

export function useBucketOpsSelectionActions({
  bucketNames,
  download = triggerDownload,
  extractError,
  isStorageOps,
  listBuckets,
  persistUiTagChanges,
  prepareExport,
  refreshBuckets,
  resolveTarget,
  scopeId,
  scopeKey,
  setError,
}: UseBucketOpsSelectionActionsOptions) {
  const [indexCheckTargets, setIndexCheckTargets] = useState<
    BucketIndexCheckTarget[] | null
  >(null);
  const [selectionTagActionLoading, setSelectionTagActionLoading] =
    useState<SelectionTagAction | null>(null);
  const [selectionTagAddInput, setSelectionTagAddInput] = useState("");
  const [selectionExportLoading, setSelectionExportLoading] =
    useState<SelectionExportFormat | null>(null);
  const [selectionActionProgress, setSelectionActionProgress] =
    useState<ActionProgressState | null>(null);
  const actionSequenceRef = useRef(0);
  const activeActionRef = useRef<"index" | "tags" | "export" | null>(null);

  const resetSelectionActions = useCallback(() => {
    actionSequenceRef.current += 1;
    activeActionRef.current = null;
    setIndexCheckTargets(null);
    setSelectionTagActionLoading(null);
    setSelectionTagAddInput("");
    setSelectionExportLoading(null);
    setSelectionActionProgress(null);
  }, []);

  useEffect(() => {
    resetSelectionActions();
    return () => {
      actionSequenceRef.current += 1;
    };
  }, [resetSelectionActions, scopeKey]);

  const parsedSelectionTagAddInput = useMemo(
    () => parseUiTags(selectionTagAddInput),
    [selectionTagAddInput],
  );

  const resolveTargets = (
    onProgress?: (progress: {
      completed: number;
      total: number;
      failed: number;
    }) => void,
  ) =>
    resolveBucketOpsSelectionTargets({
      bucketNames,
      listBuckets,
      onProgress,
      resolveTarget,
      scopeId,
    });

  const openSelectedBucketIndexChecks = async () => {
    if (
      isStorageOps ||
      scopeId === null ||
      bucketNames.length === 0 ||
      bucketNames.length > 200 ||
      activeActionRef.current !== null
    ) {
      return;
    }
    const runToken = actionSequenceRef.current + 1;
    actionSequenceRef.current = runToken;
    activeActionRef.current = "index";
    setSelectionActionProgress({
      label: "Resolving RGW bucket identities",
      completed: 0,
      total: bucketNames.length,
      failed: 0,
    });
    try {
      const { targets, missingNames } = await resolveTargets((progress) => {
        if (actionSequenceRef.current !== runToken) return;
        setSelectionActionProgress({
          label: "Resolving RGW bucket identities",
          ...progress,
        });
      });
      if (actionSequenceRef.current !== runToken) return;
      if (missingNames.length > 0) {
        setError(
          `Some selected buckets no longer exist: ${formatBucketNamesPreview(missingNames)}.`,
        );
      }
      if (targets.length === 0) {
        setError("Unable to resolve selected buckets for the RGW index check.");
        return;
      }
      if (targets.length > 200) {
        setError(
          "Bucket index checks are limited to 200 resolved buckets. Narrow the selection to continue.",
        );
        return;
      }
      setIndexCheckTargets(
        targets.map((target) => ({
          name: target.name,
          tenant: target.tenant,
        })),
      );
    } catch (error) {
      if (actionSequenceRef.current === runToken) setError(extractError(error));
    } finally {
      if (actionSequenceRef.current === runToken) {
        activeActionRef.current = null;
        setSelectionActionProgress(null);
      }
    }
  };

  const applyUiTagToSelection = async (
    tag: BucketUiTagDefinition | BucketUiTagDraft[],
    action: SelectionTagAction,
  ) => {
    if (
      scopeId === null ||
      bucketNames.length === 0 ||
      activeActionRef.current !== null
    ) {
      return;
    }
    const parsedTagValues = Array.isArray(tag) ? tag : [tag];
    if (
      parsedTagValues.length === 0 ||
      (action === "remove" && Array.isArray(tag))
    ) {
      return;
    }

    const runToken = actionSequenceRef.current + 1;
    actionSequenceRef.current = runToken;
    activeActionRef.current = "tags";
    const progressLabel =
      action === "add" ? "Applying UI tags" : "Removing UI tags";
    setSelectionActionProgress({
      label: progressLabel,
      completed: 0,
      total: bucketNames.length,
      failed: 0,
    });
    setSelectionTagActionLoading(action);
    try {
      const { targets, missingNames } = await resolveTargets((progress) => {
        if (actionSequenceRef.current !== runToken) return;
        setSelectionActionProgress({ label: progressLabel, ...progress });
      });
      if (actionSequenceRef.current !== runToken) return;
      if (targets.length === 0) {
        setError("Unable to resolve selected buckets for UI tag update.");
        return;
      }
      if (missingNames.length > 0) {
        setError(
          `Some selected buckets no longer exist: ${formatBucketNamesPreview(missingNames)}.`,
        );
      }
      await persistUiTagChanges(
        targets,
        action === "add" ? parsedTagValues : [],
        action === "remove"
          ? (parsedTagValues as BucketUiTagDefinition[])
          : [],
        {
          onProgress: ({ completed, total }) => {
            if (actionSequenceRef.current !== runToken) return;
            setSelectionActionProgress({
              label: progressLabel,
              completed,
              total,
              failed: 0,
            });
          },
        },
      );
      if (actionSequenceRef.current === runToken) refreshBuckets();
    } catch (error) {
      if (actionSequenceRef.current === runToken) {
        setError(extractError(error));
        refreshBuckets();
      }
    } finally {
      if (actionSequenceRef.current === runToken) {
        activeActionRef.current = null;
        setSelectionTagActionLoading(null);
        setSelectionActionProgress(null);
      }
    }
  };

  const exportSelectedBuckets = async (format: SelectionExportFormat) => {
    if (bucketNames.length === 0 || activeActionRef.current !== null) return;
    const withProgress = format === "csv" || format === "json";
    const runToken = actionSequenceRef.current + 1;
    actionSequenceRef.current = runToken;
    activeActionRef.current = "export";
    if (withProgress) {
      setSelectionActionProgress({
        label:
          format === "csv" ? "Preparing CSV export" : "Preparing JSON export",
        completed: 0,
        total: bucketNames.length,
        failed: 0,
      });
    }
    setSelectionExportLoading(format);
    try {
      const artifact = await prepareExport(format, (completed, total) => {
        if (!withProgress || actionSequenceRef.current !== runToken) return;
        setSelectionActionProgress((current) =>
          current ? { ...current, completed, total } : current,
        );
      });
      if (actionSequenceRef.current !== runToken) return;
      download(artifact.filename, artifact.content, artifact.mimeType);
    } catch (error) {
      if (actionSequenceRef.current === runToken) setError(extractError(error));
    } finally {
      if (actionSequenceRef.current === runToken) {
        activeActionRef.current = null;
        setSelectionExportLoading(null);
        if (withProgress) setSelectionActionProgress(null);
      }
    }
  };

  return {
    applyUiTagToSelection,
    closeSelectedBucketIndexChecks: () => setIndexCheckTargets(null),
    exportSelectedBuckets,
    indexCheckTargets,
    openSelectedBucketIndexChecks,
    parsedSelectionTagAddInput,
    resetSelectionActions,
    selectionActionProgress,
    selectionExportLoading,
    selectionTagActionLoading,
    selectionTagAddInput,
    setSelectionTagAddInput,
  };
}

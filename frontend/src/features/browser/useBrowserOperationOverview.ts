/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { triggerBlobDownload } from "../../utils/download";
import { DEFAULT_QUEUED_VISIBLE_COUNT } from "./browserConstants";
import { buildBrowserOperationDetailsExport } from "./browserOperationDetailsExport";
import {
  buildCopyOperationGroups,
  buildDeleteOperationGroups,
  buildDownloadOperationGroups,
  buildOperationGroupSortIndexes,
  buildUploadOperationGroups,
  collectFinishedOperationIds,
  filterDetailOperationGroups,
  filterUploadOperationGroups,
  omitOperationRecords,
  omitOperationSectionRecords,
  summarizeDetailOperationGroups,
} from "./browserOperationGroups";
import type {
  CopyDetailItem,
  DeleteDetailItem,
  DownloadDetailItem,
  OperationDetailsKind,
  OperationItem,
  UploadQueueItem,
} from "./browserTypes";

type OperationSection = "queued" | "completed" | "failed";
type OperationFilter = "active" | OperationSection;

type UseBrowserOperationOverviewOptions = {
  operations: OperationItem[];
  setOperations: Dispatch<SetStateAction<OperationItem[]>>;
  uploadQueue: UploadQueueItem[];
  downloadDetails: Record<string, DownloadDetailItem[]>;
  setDownloadDetails: Dispatch<
    SetStateAction<Record<string, DownloadDetailItem[]>>
  >;
  deleteDetails: Record<string, DeleteDetailItem[]>;
  setDeleteDetails: Dispatch<
    SetStateAction<Record<string, DeleteDetailItem[]>>
  >;
  copyDetails: Record<string, CopyDetailItem[]>;
  setCopyDetails: Dispatch<
    SetStateAction<Record<string, CopyDetailItem[]>>
  >;
  setStatusMessage: (message: string | null) => void;
};

function isOtherOperation(operation: OperationItem): boolean {
  return (
    operation.kind !== "upload" &&
    operation.kind !== "download" &&
    operation.kind !== "delete" &&
    operation.kind !== "copy"
  );
}

export function useBrowserOperationOverview({
  operations,
  setOperations,
  uploadQueue,
  downloadDetails,
  setDownloadDetails,
  deleteDetails,
  setDeleteDetails,
  copyDetails,
  setCopyDetails,
  setStatusMessage,
}: UseBrowserOperationOverviewOptions) {
  const [operationFilter, setOperationFilter] =
    useState<OperationFilter | null>(null);
  const [expandedOperationGroups, setExpandedOperationGroups] = useState<
    Record<string, boolean>
  >({});
  const [sectionVisibleCountByGroup, setSectionVisibleCountByGroup] = useState<
    Record<string, number>
  >({});
  const [operationsPanelOpen, setOperationsPanelOpen] = useState(false);
  const [operationsPanelDismissed, setOperationsPanelDismissed] =
    useState(false);
  const operationsPanelVisibleRef = useRef(false);
  const [showOperationsDetailsModal, setShowOperationsDetailsModal] =
    useState(false);

  const showOperationsBar = useCallback(() => {
    setOperationsPanelOpen((open) =>
      operationsPanelVisibleRef.current ? open : false,
    );
    setOperationsPanelDismissed(false);
  }, []);
  const dismissOperationsPanel = useCallback(() => {
    setOperationsPanelOpen(false);
    setOperationsPanelDismissed(true);
  }, []);
  const toggleOperationsPanel = useCallback(() => {
    setOperationsPanelOpen((open) => !open);
  }, []);
  const openOperationsDetailsModal = useCallback(() => {
    setShowOperationsDetailsModal(true);
  }, []);
  const closeOperationsDetailsModal = useCallback(() => {
    setShowOperationsDetailsModal(false);
  }, []);

  const activeOperations = useMemo(
    () => operations.filter((operation) => !operation.completedAt),
    [operations],
  );
  const uploadGroups = useMemo(
    () => buildUploadOperationGroups(operations, uploadQueue),
    [operations, uploadQueue],
  );
  const downloadGroups = useMemo(
    () => buildDownloadOperationGroups(operations, downloadDetails),
    [downloadDetails, operations],
  );
  const deleteGroups = useMemo(
    () => buildDeleteOperationGroups(operations, deleteDetails),
    [deleteDetails, operations],
  );
  const copyGroups = useMemo(
    () => buildCopyOperationGroups(operations, copyDetails),
    [copyDetails, operations],
  );
  const downloadSummary = summarizeDetailOperationGroups(downloadGroups);
  const deleteSummary = summarizeDetailOperationGroups(deleteGroups);
  const copySummary = summarizeDetailOperationGroups(copyGroups);
  const uploadOperations = operations.filter(
    (operation) => operation.kind === "upload",
  );
  const otherOperations = operations.filter(isOtherOperation);
  const failedUploadCount = uploadOperations.filter(
    (operation) => operation.completionStatus === "failed",
  ).length;
  const failedOtherOperations = otherOperations.filter(
    (operation) => operation.completionStatus === "failed",
  );
  const completedUploadCount = uploadOperations.filter(
    (operation) =>
      operation.completedAt && operation.completionStatus !== "failed",
  ).length;
  const completedOtherOperations = otherOperations.filter(
    (operation) =>
      operation.completedAt && operation.completionStatus !== "failed",
  );
  const activeOtherOperations = activeOperations.filter(isOtherOperation);

  const queuedOperationsCount =
    uploadQueue.length +
    downloadSummary.queued +
    deleteSummary.queued +
    copySummary.queued;
  const totalOperationsCount =
    activeOperations.length + queuedOperationsCount;
  const hasPendingOperations = totalOperationsCount > 0;
  const failedOperationsCount =
    failedUploadCount +
    downloadSummary.failed +
    deleteSummary.failed +
    copySummary.failed +
    failedOtherOperations.length;
  const completedOperationsCount =
    completedUploadCount +
    downloadSummary.completed +
    deleteSummary.completed +
    copySummary.completed +
    completedOtherOperations.length;
  const operationsPanelTotalCount =
    totalOperationsCount + completedOperationsCount + failedOperationsCount;
  const hasOperationsPanelContent = operationsPanelTotalCount > 0;
  const showOperationsPanel =
    hasOperationsPanelContent &&
    (!operationsPanelDismissed || hasPendingOperations);
  const hasFinishedOperations =
    completedOperationsCount > 0 || failedOperationsCount > 0;

  useEffect(() => {
    operationsPanelVisibleRef.current = showOperationsPanel;
  }, [showOperationsPanel]);
  useEffect(() => {
    if (!hasOperationsPanelContent) {
      setShowOperationsDetailsModal(false);
    }
  }, [hasOperationsPanelContent]);

  const filtersAllInactive = operationFilter === null;
  const showActiveOperations = operationFilter === "active";
  const showQueuedOperations = operationFilter === "queued";
  const showCompletedOperations = operationFilter === "completed";
  const showFailedOperations = operationFilter === "failed";
  const operationGroupVisibility = {
    active: showActiveOperations || filtersAllInactive,
    queued: showQueuedOperations || filtersAllInactive,
    completed: showCompletedOperations || filtersAllInactive,
    failed: showFailedOperations || filtersAllInactive,
  };
  const visibleOtherOperations = [
    ...(operationGroupVisibility.active ? activeOtherOperations : []),
    ...(operationGroupVisibility.completed ? completedOtherOperations : []),
    ...(operationGroupVisibility.failed ? failedOtherOperations : []),
  ];
  const visibleUploadGroups = filterUploadOperationGroups(
    uploadGroups,
    operationGroupVisibility,
  );
  const visibleDownloadGroups = filterDetailOperationGroups(
    downloadGroups,
    "downloading",
    operationGroupVisibility,
  );
  const visibleDeleteGroups = filterDetailOperationGroups(
    deleteGroups,
    "deleting",
    operationGroupVisibility,
  );
  const visibleCopyGroups = filterDetailOperationGroups(
    copyGroups,
    "copying",
    operationGroupVisibility,
  );
  const operationGroupSortIndexes = buildOperationGroupSortIndexes(
    operations,
    uploadQueue,
    uploadGroups,
  );

  const isGroupExpanded = useCallback(
    (groupId: string) => Boolean(expandedOperationGroups[groupId]),
    [expandedOperationGroups],
  );
  const toggleGroupExpanded = useCallback((groupId: string) => {
    setExpandedOperationGroups((previous) => ({
      ...previous,
      [groupId]: !previous[groupId],
    }));
  }, []);
  const toggleOperationFilter = useCallback((filter: OperationFilter) => {
    setOperationFilter((previous) => (previous === filter ? null : filter));
  }, []);
  const getSectionVisibleCount = useCallback(
    (groupId: string, section: OperationSection) =>
      sectionVisibleCountByGroup[`${groupId}:${section}`] ??
      DEFAULT_QUEUED_VISIBLE_COUNT,
    [sectionVisibleCountByGroup],
  );
  const showMoreSection = useCallback(
    (groupId: string, section: OperationSection) => {
      const key = `${groupId}:${section}`;
      setSectionVisibleCountByGroup((previous) => ({
        ...previous,
        [key]:
          (previous[key] ?? DEFAULT_QUEUED_VISIBLE_COUNT) +
          DEFAULT_QUEUED_VISIBLE_COUNT,
      }));
    },
    [],
  );
  const downloadOperationDetails = useCallback(
    (kind: OperationDetailsKind, operationId: string) => {
      if (typeof window === "undefined") return;
      const exported = buildBrowserOperationDetailsExport({
        kind,
        operationId,
        exportedAt: new Date().toISOString(),
        operations,
        downloadGroups,
        deleteGroups,
        copyGroups,
        uploadGroups,
      });
      if (!exported) {
        setStatusMessage("No details available for this operation.");
        return;
      }

      triggerBlobDownload(
        exported.filename,
        new Blob([JSON.stringify(exported.payload, null, 2)], {
          type: "application/json",
        }),
      );
    },
    [
      copyGroups,
      deleteGroups,
      downloadGroups,
      operations,
      setStatusMessage,
      uploadGroups,
    ],
  );
  const clearFinishedOperations = useCallback(() => {
    const finishedIds = collectFinishedOperationIds(operations);
    if (finishedIds.size === 0) return;
    setOperations((previous) =>
      previous.filter((operation) => !finishedIds.has(operation.id)),
    );
    setDownloadDetails((previous) =>
      omitOperationRecords(previous, finishedIds),
    );
    setDeleteDetails((previous) => omitOperationRecords(previous, finishedIds));
    setCopyDetails((previous) => omitOperationRecords(previous, finishedIds));
    setExpandedOperationGroups((previous) =>
      omitOperationRecords(previous, finishedIds),
    );
    setSectionVisibleCountByGroup((previous) =>
      omitOperationSectionRecords(previous, finishedIds),
    );
  }, [
    operations,
    setCopyDetails,
    setDeleteDetails,
    setDownloadDetails,
    setOperations,
  ]);

  return {
    activeOperationsCount: activeOperations.length,
    allOtherOperations: [
      ...activeOtherOperations,
      ...completedOtherOperations,
      ...failedOtherOperations,
    ],
    clearFinishedOperations,
    closeOperationsDetailsModal,
    completedOperationsCount,
    copyGroups,
    deleteGroups,
    dismissOperationsPanel,
    downloadGroups,
    downloadOperationDetails,
    failedOperationsCount,
    filtersAllInactive,
    getSectionVisibleCount,
    hasFinishedOperations,
    hasOperationsPanelContent,
    hasPendingOperations,
    isGroupExpanded,
    openOperationsDetailsModal,
    operationsPanelOpen,
    operationsPanelTotalCount,
    operationSortFallback: operationGroupSortIndexes.fallback,
    operationSortIndexById: operationGroupSortIndexes.operationById,
    queuedOperationsCount,
    showActiveOperations,
    showCompletedOperations,
    showFailedOperations,
    showMoreSection,
    showOperationsBar,
    showOperationsDetailsModal,
    showOperationsPanel,
    showQueuedOperations,
    toggleGroupExpanded,
    toggleOperationFilter,
    toggleOperationsPanel,
    uploadGroups,
    uploadGroupSortIndexById: operationGroupSortIndexes.uploadGroupById,
    visibleCopyGroups,
    visibleDeleteGroups,
    visibleDownloadGroups,
    visibleOtherOperations,
    visibleUploadGroups,
  };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import ConfirmActionDialog from "../../../components/ConfirmActionDialog";
import PageShell from "../../../components/PageShell";
import UiButton from "../../../components/ui/UiButton";
import { cx, uiPanelClass, uiPanelMutedClass } from "../../../components/ui/styles";
import {
  continueManagerMigration,
  deleteManagerMigration,
  pauseManagerMigration,
  resumeManagerMigration,
  retryFailedManagerMigrationItems,
  retryManagerMigrationItem,
  rollbackFailedManagerMigrationItems,
  rollbackManagerMigration,
  rollbackManagerMigrationItem,
  runManagerMigrationPrecheck,
  startManagerMigration,
  stopManagerMigration,
  type BucketMigrationItemView,
  type BucketMigrationPrecheckReport,
} from "../../../api/managerMigrations";
import { useManagerContexts, useManagerMigrationDetail } from "./hooks";
import { managerPageBreadcrumbs } from "../managerBreadcrumbs";
import {
  canOfferFullRollback,
  computeItemCopyProgressPercent,
  computeProgress,
  extractError,
  formatDateTime,
  formatYesNo,
  getNextAction,
  inferTargetExists,
  inferTargetExistsUnknown,
  isFinalMigrationStatus,
  isMigrationPrecheckPassed,
  operatorCardClasses,
  parseReviewItemMessages,
  precheckChipClasses,
  precheckMessageClasses,
  statusChipClasses,
  strategyLabel,
  stepLabel,
  type MigrationOperatorAction,
  type ReviewItemSummary,
} from "./shared";

type BucketFocus = "focus" | "all" | "failed" | "awaiting";

type PendingMigrationConfirmation =
  | { kind: "stop" }
  | { kind: "rollback" }
  | { kind: "rollback-failed" }
  | { kind: "rollback-item"; itemId: number }
  | { kind: "delete" };

type MigrationConfirmationCopy = {
  title: string;
  description: string;
  confirmLabel: string;
  details?: Array<{ label: string; value: string | number; mono?: boolean }>;
  impacts: string[];
};

function priorityValue(item: BucketMigrationItemView): number {
  const priority: Record<string, number> = {
    failed: 0,
    running: 1,
    pending: 2,
    paused: 3,
    awaiting_cutover: 4,
    completed: 5,
    rolled_back: 6,
    skipped: 7,
    canceled: 8,
  };
  return priority[item.status] ?? 99;
}

function isInFocus(item: BucketMigrationItemView, focus: BucketFocus): boolean {
  if (focus === "all") return true;
  if (focus === "failed") return item.status === "failed";
  if (focus === "awaiting") return item.status === "awaiting_cutover";
  return ["running", "pending", "failed", "awaiting_cutover", "paused"].includes(item.status);
}

export default function ManagerMigrationDetailPage() {
  const { migrationId } = useParams<{ migrationId: string }>();
  const parsedMigrationId = migrationId ? Number(migrationId) : NaN;
  const migrationIdValue = Number.isFinite(parsedMigrationId) ? parsedMigrationId : null;

  const navigate = useNavigate();
  const { contextLabelById } = useManagerContexts();
  const { migrationDetail, detailLoading, detailError, setDetailError, refresh } = useManagerMigrationDetail(migrationIdValue);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedPrecheckItems, setExpandedPrecheckItems] = useState<Record<number, boolean>>({});
  const [showEvents, setShowEvents] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [bucketFocus, setBucketFocus] = useState<BucketFocus>("focus");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingMigrationConfirmation | null>(null);

  const selectedMigrationSummary = useMemo(() => {
    if (!migrationDetail) return null;
    const completedItems = migrationDetail.items.filter((item) => item.status === "completed").length;
    const rolledBackItems = migrationDetail.items.filter((item) => item.status === "rolled_back").length;
    const failedItems = migrationDetail.items.filter((item) => item.status === "failed").length;
    const skippedItems = migrationDetail.items.filter((item) => item.status === "skipped").length;
    const done = completedItems + rolledBackItems + failedItems + skippedItems;
    const percent = computeProgress(done, migrationDetail.total_items);
    return {
      done,
      total: migrationDetail.total_items,
      percent,
      completedItems,
      rolledBackItems,
      failedItems,
      skippedItems,
      activeItems: Math.max(0, migrationDetail.total_items - done),
    };
  }, [migrationDetail]);

  const precheckReport = useMemo<BucketMigrationPrecheckReport | null>(() => {
    if (!migrationDetail?.precheck_report || typeof migrationDetail.precheck_report !== "object") return null;
    return migrationDetail.precheck_report as BucketMigrationPrecheckReport;
  }, [migrationDetail]);

  const globalPrecheckMessages = useMemo(() => parseReviewItemMessages(precheckReport?.checks), [precheckReport]);
  const precheckSummary = useMemo(() => {
    const summaryRaw = precheckReport?.summary;
    const summary = summaryRaw && typeof summaryRaw === "object" ? (summaryRaw as Record<string, unknown>) : {};
    return {
      blockingErrors: Number(summary.blocking_errors ?? precheckReport?.errors ?? 0) || 0,
      warnings: Number(summary.warnings ?? precheckReport?.warnings ?? 0) || 0,
      infos: Number(summary.infos ?? 0) || 0,
    };
  }, [precheckReport]);

  const unsupportedFeatures = useMemo(() => {
    const features = precheckReport?.unsupported_features;
    if (!Array.isArray(features)) return [];
    return features.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }, [precheckReport]);

  const reviewItems = useMemo<ReviewItemSummary[]>(() => {
    if (!migrationDetail) return [];
    const reportItemsById = new Map<number, Record<string, unknown>>();
    if (precheckReport && Array.isArray(precheckReport.items)) {
      for (const row of precheckReport.items) {
        if (!row || typeof row !== "object") continue;
        const item = row as Record<string, unknown>;
        const itemId = Number(item.item_id);
        if (Number.isFinite(itemId)) reportItemsById.set(itemId, item);
      }
    }

    return migrationDetail.items.map((item) => {
      const reportItem = reportItemsById.get(item.id);
      const messages = parseReviewItemMessages(reportItem?.checks ?? reportItem?.messages);
      return {
        itemId: item.id,
        sourceBucket: item.source_bucket,
        targetBucket: item.target_bucket,
        strategy: typeof reportItem?.strategy === "string" ? reportItem.strategy : "current_only",
        blocking: Boolean(reportItem?.blocking),
        deleteSourceSafe: reportItem?.delete_source_safe !== false,
        rollbackSafe: reportItem?.rollback_safe !== false,
        sameEndpointCopySafe: reportItem?.same_endpoint_copy_safe !== false,
        targetExists: inferTargetExists(messages),
        targetExistsUnknown: inferTargetExistsUnknown(messages),
        messages,
        errors: Number(reportItem?.errors ?? 0) || 0,
        warnings: Number(reportItem?.warnings ?? 0) || 0,
      };
    });
  }, [migrationDetail, precheckReport]);
  const reviewItemsById = useMemo(() => new Map(reviewItems.map((item) => [item.itemId, item])), [reviewItems]);

  const sortedItems = useMemo(() => {
    if (!migrationDetail) return [];
    return [...migrationDetail.items].sort((left, right) => {
      const priorityLeft = priorityValue(left);
      const priorityRight = priorityValue(right);
      if (priorityLeft !== priorityRight) return priorityLeft - priorityRight;
      return left.source_bucket.localeCompare(right.source_bucket);
    });
  }, [migrationDetail]);

  const visibleItems = useMemo(() => sortedItems.filter((item) => isInFocus(item, bucketFocus)), [bucketFocus, sortedItems]);

  const canLaunchFromDraft = Boolean(migrationDetail && migrationDetail.status === "draft" && isMigrationPrecheckPassed(migrationDetail));
  const nextAction = useMemo(() => {
    if (!migrationDetail) return null;
    return getNextAction(migrationDetail, canLaunchFromDraft);
  }, [migrationDetail, canLaunchFromDraft]);

  const failedItemCount = useMemo(() => sortedItems.filter((item) => item.status === "failed").length, [sortedItems]);
  const canManageFailedItems = Boolean(
    migrationDetail && !["queued", "running", "pause_requested", "cancel_requested"].includes(migrationDetail.status)
  );
  const canStopMigration = Boolean(
    migrationDetail && !["completed", "completed_with_errors", "failed", "canceled", "rolled_back"].includes(migrationDetail.status)
  );
  const canRunPrecheck = Boolean(
    migrationDetail &&
      migrationDetail.precheck_status !== "passed" &&
      !["queued", "running", "pause_requested", "cancel_requested"].includes(migrationDetail.status)
  );

  const executeAction = async (action: MigrationOperatorAction | "stop") => {
    if (!migrationDetail) return;
    setActionLoading(action);
    setDetailError(null);
    try {
      if (action === "pause") await pauseManagerMigration(migrationDetail.id);
      if (action === "resume") await resumeManagerMigration(migrationDetail.id);
      if (action === "stop") await stopManagerMigration(migrationDetail.id);
      if (action === "continue") await continueManagerMigration(migrationDetail.id);
      if (action === "start") await startManagerMigration(migrationDetail.id);
      if (action === "rollback") await rollbackManagerMigration(migrationDetail.id);
      await refresh();
    } catch (error) {
      setDetailError(extractError(error));
    } finally {
      setActionLoading(null);
    }
  };

  const runAction = (action: MigrationOperatorAction | "stop") => {
    if (action === "stop" || action === "rollback") {
      setPendingConfirmation({ kind: action });
      return;
    }
    void executeAction(action);
  };

  const runPrecheck = async () => {
    if (!migrationDetail) return;
    setActionLoading("precheck");
    setDetailError(null);
    try {
      await runManagerMigrationPrecheck(migrationDetail.id);
      await refresh();
    } catch (error) {
      setDetailError(extractError(error));
    } finally {
      setActionLoading(null);
    }
  };

  const executeFailedItemsAction = async (action: "retry_failed_items" | "rollback_failed_items") => {
    if (!migrationDetail) return;
    const loadingKey = action === "retry_failed_items" ? "retry-failed-items" : "rollback-failed-items";
    setActionLoading(loadingKey);
    setDetailError(null);
    try {
      if (action === "retry_failed_items") await retryFailedManagerMigrationItems(migrationDetail.id);
      if (action === "rollback_failed_items") await rollbackFailedManagerMigrationItems(migrationDetail.id);
      await refresh();
    } catch (error) {
      setDetailError(extractError(error));
    } finally {
      setActionLoading(null);
    }
  };

  const runFailedItemsAction = (action: "retry_failed_items" | "rollback_failed_items") => {
    if (action === "rollback_failed_items") {
      setPendingConfirmation({ kind: "rollback-failed" });
      return;
    }
    void executeFailedItemsAction(action);
  };

  const executeItemAction = async (itemId: number, action: "retry" | "rollback") => {
    if (!migrationDetail) return;
    const loadingKey = `${action}-item-${itemId}`;
    setActionLoading(loadingKey);
    setDetailError(null);
    try {
      if (action === "retry") await retryManagerMigrationItem(migrationDetail.id, itemId);
      if (action === "rollback") await rollbackManagerMigrationItem(migrationDetail.id, itemId);
      await refresh();
    } catch (error) {
      setDetailError(extractError(error));
    } finally {
      setActionLoading(null);
    }
  };

  const runItemAction = (itemId: number, action: "retry" | "rollback") => {
    if (action === "rollback") {
      setPendingConfirmation({ kind: "rollback-item", itemId });
      return;
    }
    void executeItemAction(itemId, action);
  };

  const togglePrecheckDetails = (itemId: number) => {
    setExpandedPrecheckItems((current) => ({
      ...current,
      [itemId]: !current[itemId],
    }));
  };

  const executeDeleteMigration = async () => {
    if (!migrationDetail || !isFinalMigrationStatus(migrationDetail.status)) return;
    setActionLoading("delete-migration");
    setDetailError(null);
    try {
      await deleteManagerMigration(migrationDetail.id);
      navigate("/manager/migrations");
    } catch (error) {
      setDetailError(extractError(error));
    } finally {
      setActionLoading(null);
    }
  };

  const runDeleteMigration = () => {
    setPendingConfirmation({ kind: "delete" });
  };

  const confirmPendingAction = async () => {
    if (!pendingConfirmation) return;
    try {
      if (pendingConfirmation.kind === "stop") await executeAction("stop");
      if (pendingConfirmation.kind === "rollback") await executeAction("rollback");
      if (pendingConfirmation.kind === "rollback-failed") await executeFailedItemsAction("rollback_failed_items");
      if (pendingConfirmation.kind === "rollback-item") {
        await executeItemAction(pendingConfirmation.itemId, "rollback");
      }
      if (pendingConfirmation.kind === "delete") await executeDeleteMigration();
    } finally {
      setPendingConfirmation(null);
    }
  };

  const confirmationCopy = useMemo<MigrationConfirmationCopy | null>(() => {
    if (!migrationDetail || !pendingConfirmation) return null;
    if (pendingConfirmation.kind === "stop") {
      return {
        title: "Stop migration?",
        description: "Stop the active replication run for this migration.",
        confirmLabel: "Stop migration",
        details: [{ label: "Migration", value: `#${migrationDetail.id}` }],
        impacts: ["Partially copied destination data may remain until you resume, roll back, or clean it up."],
      };
    }
    if (pendingConfirmation.kind === "rollback") {
      return {
        title: "Roll back migration?",
        description: "Reverse the completed migration work and restore source access.",
        confirmLabel: "Roll back migration",
        details: [{ label: "Migration", value: `#${migrationDetail.id}` }],
        impacts: ["Destination objects created by this migration will be purged."],
      };
    }
    if (pendingConfirmation.kind === "rollback-failed") {
      return {
        title: "Roll back all failed buckets?",
        description: "Reverse the migration work for every failed bucket in this run.",
        confirmLabel: "Roll back failed buckets",
        details: [
          { label: "Migration", value: `#${migrationDetail.id}` },
          { label: "Failed buckets", value: failedItemCount },
        ],
        impacts: ["Source access will be restored and destination objects for failed items will be purged."],
      };
    }
    if (pendingConfirmation.kind === "rollback-item") {
      const item = migrationDetail.items.find((entry) => entry.id === pendingConfirmation.itemId);
      return {
        title: "Roll back this failed bucket?",
        description: "Reverse the migration work for this bucket only.",
        confirmLabel: "Roll back bucket",
        details: [
          { label: "Source", value: item?.source_bucket ?? `Item #${pendingConfirmation.itemId}`, mono: true },
          { label: "Destination", value: item?.target_bucket ?? "Unknown", mono: true },
        ],
        impacts: ["Source access will be restored and destination objects for this bucket will be purged."],
      };
    }
    return {
      title: "Delete migration history?",
      description: "Remove this completed migration from the operational history.",
      confirmLabel: "Delete history",
      details: [{ label: "Migration", value: `#${migrationDetail.id}` }],
      impacts: ["Tracking data and events will be removed. Source and destination buckets will not be deleted."],
    };
  }, [failedItemCount, migrationDetail, pendingConfirmation]);

  if (!migrationIdValue) {
    return (
      <PageShell
        title="Bucket Migration"
        description="Invalid migration identifier."
        breadcrumbs={managerPageBreadcrumbs("migration", { label: "Details" })}
        actions={[{ label: "Back to list", onClick: () => navigate("/manager/migrations") }]}
      />
    );
  }

  return (
    <PageShell
      title={migrationDetail ? `Migration #${migrationDetail.id}` : `Migration #${migrationIdValue}`}
      description="Operational view with focused bucket replication progress and required actions."
      breadcrumbs={managerPageBreadcrumbs("migration", { label: "Details" })}
      actions={[
        { label: "Back to list", onClick: () => navigate("/manager/migrations") },
        ...(migrationDetail?.status === "draft"
          ? [{ label: "Edit draft", onClick: () => navigate(`/manager/migrations/new?from=${migrationDetail.id}`) }]
          : []),
      ]}
    >

      {detailLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Refreshing...</p>}
      {detailError && <p className="ui-caption text-rose-600 dark:text-rose-300">{detailError}</p>}
      {!migrationDetail && !detailLoading && (
        <p className="ui-caption text-slate-500 dark:text-slate-400">Migration not found or unavailable.</p>
      )}

      {migrationDetail && (
        <>
          <section className={cx(uiPanelClass, "space-y-3 p-4")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusChipClasses(migrationDetail.status)}`}>
                {migrationDetail.status}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${precheckChipClasses(migrationDetail.precheck_status)}`}
              >
                precheck: {migrationDetail.precheck_status}
              </span>
              <span className="ui-caption text-slate-500 dark:text-slate-400">
                {contextLabelById.get(migrationDetail.source_context_id) ?? migrationDetail.source_context_id} {"->"}{" "}
                {contextLabelById.get(migrationDetail.target_context_id) ?? migrationDetail.target_context_id}
              </span>
            </div>

            {nextAction && (
              <div className={`rounded-lg border px-3 py-3 ${operatorCardClasses(nextAction.tone)}`}>
                <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">{nextAction.title}</p>
                <p className="ui-caption text-slate-600 dark:text-slate-300">{nextAction.description}</p>
                {nextAction.action && (
                  <div className="mt-2">
                    <UiButton
                      type="button"
                      onClick={() =>
                        nextAction.action === "retry_failed_items"
                          ? runFailedItemsAction("retry_failed_items")
                          : runAction(nextAction.action as MigrationOperatorAction)
                      }
                      disabled={actionLoading != null || (nextAction.action === "start" && !canLaunchFromDraft)}
                      variant="secondary"
                      size="sm"
                    >
                      {actionLoading === nextAction.action ||
                      (nextAction.action === "retry_failed_items" && actionLoading === "retry-failed-items")
                        ? `${nextAction.actionLabel}...`
                        : nextAction.actionLabel}
                    </UiButton>
                  </div>
                )}
              </div>
            )}

            {selectedMigrationSummary && (
              <div className={cx(uiPanelMutedClass, "p-3")}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">Global progress</p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">
                    {selectedMigrationSummary.done}/{selectedMigrationSummary.total} ({selectedMigrationSummary.percent}%)
                  </p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${selectedMigrationSummary.percent}%` }} />
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-5">
                  <p className="ui-caption text-slate-600 dark:text-slate-300">completed: {selectedMigrationSummary.completedItems}</p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">rolled_back: {selectedMigrationSummary.rolledBackItems}</p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">failed: {selectedMigrationSummary.failedItems}</p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">skipped: {selectedMigrationSummary.skippedItems}</p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">in progress: {selectedMigrationSummary.activeItems}</p>
                </div>
              </div>
            )}

            {precheckReport && (
              <div className={cx(uiPanelMutedClass, "p-3")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">
                    Precheck report
                    {typeof precheckReport.report_version === "number" ? ` v${precheckReport.report_version}` : ""}
                  </p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">
                    {precheckSummary.blockingErrors} blocking error(s), {precheckSummary.warnings} warning(s), {precheckSummary.infos} info
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!precheckReport.same_endpoint_copy_safe && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                      same-endpoint copy unsafe
                    </span>
                  )}
                  {!precheckReport.delete_source_safe && (
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                      delete_source blocked
                    </span>
                  )}
                  {!precheckReport.rollback_safe && (
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                      rollback unsafe
                    </span>
                  )}
                  {unsupportedFeatures.length > 0 && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                      unsupported: {unsupportedFeatures.join(", ")}
                    </span>
                  )}
                </div>
                {globalPrecheckMessages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {globalPrecheckMessages.map((message, index) => (
                      <span
                        key={`global-precheck-${message.code ?? message.level}-${index}`}
                        className={`rounded-md border px-2 py-1 text-[11px] ${precheckMessageClasses(message.level)}`}
                      >
                        {message.level.toUpperCase()}
                        {message.blocking ? " BLOCKING" : ""}
                        {message.code ? ` [${message.code}]` : ""}: {message.message}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {migrationDetail.status === "draft" && (
                <UiButton
                  type="button"
                  onClick={() => runAction("start")}
                  disabled={actionLoading != null || !canLaunchFromDraft}
                  variant="secondary"
                  size="sm"
                >
                  {actionLoading === "start" ? "Launching..." : "Launch replication"}
                </UiButton>
              )}

              {canRunPrecheck && (
                <UiButton
                  type="button"
                  onClick={runPrecheck}
                  disabled={actionLoading != null}
                  variant="warning"
                  size="sm"
                >
                  {actionLoading === "precheck"
                    ? "Running precheck..."
                    : migrationDetail.precheck_status === "failed"
                      ? "Re-run precheck"
                      : "Run precheck"}
                </UiButton>
              )}

              {["queued", "running", "pause_requested"].includes(migrationDetail.status) && (
                <UiButton
                  type="button"
                  onClick={() => runAction("pause")}
                  disabled={actionLoading != null}
                  variant="secondary"
                  size="sm"
                >
                  {actionLoading === "pause" ? "Pausing..." : "Pause"}
                </UiButton>
              )}

              {migrationDetail.status === "paused" && (
                <UiButton
                  type="button"
                  onClick={() => runAction("resume")}
                  disabled={actionLoading != null}
                  variant="secondary"
                  size="sm"
                >
                  {actionLoading === "resume" ? "Resuming..." : "Resume"}
                </UiButton>
              )}

              {migrationDetail.status === "awaiting_cutover" && (
                <UiButton
                  type="button"
                  onClick={() => runAction("continue")}
                  disabled={actionLoading != null}
                  variant="secondary"
                  size="sm"
                >
                  {actionLoading === "continue" ? "Continuing..." : "Continue after pre-sync"}
                </UiButton>
              )}

              {canOfferFullRollback(migrationDetail) && (
                <UiButton
                  type="button"
                  onClick={() => runAction("rollback")}
                  disabled={actionLoading != null}
                  variant="warning"
                  size="sm"
                >
                  {actionLoading === "rollback" ? "Rolling back..." : "Rollback migration"}
                </UiButton>
              )}

              {failedItemCount > 0 && canManageFailedItems && (
                <UiButton
                  type="button"
                  onClick={() => runFailedItemsAction("retry_failed_items")}
                  disabled={actionLoading != null}
                  variant="secondary"
                  size="sm"
                >
                  {actionLoading === "retry-failed-items" ? "Retrying failed..." : `Retry all failed (${failedItemCount})`}
                </UiButton>
              )}

              {failedItemCount > 0 && canManageFailedItems && (
                <UiButton
                  type="button"
                  onClick={() => runFailedItemsAction("rollback_failed_items")}
                  disabled={actionLoading != null}
                  variant="warning"
                  size="sm"
                >
                  {actionLoading === "rollback-failed-items"
                    ? "Rolling back failed..."
                    : `Rollback all failed (${failedItemCount})`}
                </UiButton>
              )}

              {canStopMigration && (
                <UiButton
                  type="button"
                  onClick={() => runAction("stop")}
                  disabled={actionLoading != null}
                  variant="danger"
                  size="sm"
                >
                  {actionLoading === "stop" ? "Stopping..." : "Stop"}
                </UiButton>
              )}

              {isFinalMigrationStatus(migrationDetail.status) && (
                <UiButton
                  type="button"
                  onClick={runDeleteMigration}
                  disabled={actionLoading != null}
                  variant="danger"
                  size="sm"
                >
                  {actionLoading === "delete-migration" ? "Deleting..." : "Delete migration"}
                </UiButton>
              )}
            </div>
          </section>

          <section className={cx(uiPanelClass, "space-y-2 p-4")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="ui-body text-base font-semibold text-slate-900 dark:text-slate-100">Bucket replication progress</h3>
              <div className="flex flex-wrap gap-1">
                <UiButton
                  type="button"
                  onClick={() => setBucketFocus("focus")}
                  variant={bucketFocus === "focus" ? "primary" : "secondary"}
                  size="xs"
                >
                  Focused
                </UiButton>
                <UiButton
                  type="button"
                  onClick={() => setBucketFocus("failed")}
                  variant={bucketFocus === "failed" ? "danger" : "secondary"}
                  size="xs"
                >
                  Failed
                </UiButton>
                <UiButton
                  type="button"
                  onClick={() => setBucketFocus("awaiting")}
                  variant={bucketFocus === "awaiting" ? "warning" : "secondary"}
                  size="xs"
                >
                  Awaiting
                </UiButton>
                <UiButton
                  type="button"
                  onClick={() => setBucketFocus("all")}
                  variant={bucketFocus === "all" ? "primary" : "secondary"}
                  size="xs"
                >
                  All
                </UiButton>
              </div>
            </div>

            <div className="space-y-2">
              {visibleItems.map((item) => {
                const itemCopyProgress = computeItemCopyProgressPercent(item);
                const showItemCopyProgress =
                  itemCopyProgress != null && ["pending", "running", "paused", "awaiting_cutover"].includes(item.status);
                const reviewItem = reviewItemsById.get(item.id);
                const precheckDetailsExpanded = Boolean(expandedPrecheckItems[item.id]);
                const hasPrecheckDetails = Boolean(
                  reviewItem &&
                    (reviewItem.errors > 0 ||
                      reviewItem.warnings > 0 ||
                      reviewItem.targetExists ||
                      reviewItem.targetExistsUnknown ||
                      reviewItem.strategy !== "current_only" ||
                      reviewItem.blocking ||
                      !reviewItem.deleteSourceSafe ||
                      !reviewItem.rollbackSafe ||
                      !reviewItem.sameEndpointCopySafe)
                );
                return (
                  <div key={item.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">
                        {item.source_bucket} {"->"} {item.target_bucket}
                      </p>
                      <span className="ui-caption rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
                      {stepLabel(item.step)} | copied: {item.objects_copied} | deleted: {item.objects_deleted}
                      {typeof item.source_count === "number" && item.source_count >= 0 ? ` | source objects: ${item.source_count}` : ""}
                    </p>
                    {showItemCopyProgress && (
                      <div className="mt-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${itemCopyProgress}%` }} />
                        </div>
                        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                          Copy progress: {item.objects_copied}/{item.source_count} ({itemCopyProgress}%)
                        </p>
                      </div>
                    )}
                    {reviewItem && hasPrecheckDetails && (
                      <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/70 p-2 dark:border-slate-700 dark:bg-slate-800/40">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={`ui-caption rounded-full border px-2 py-0.5 font-semibold ${
                              reviewItem.blocking || reviewItem.errors > 0
                                ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                                : reviewItem.warnings > 0
                                  ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                            }`}
                          >
                            Precheck: {reviewItem.errors} error(s), {reviewItem.warnings} warning(s)
                          </span>
                          {reviewItem.messages.length > 0 && (
                            <UiButton
                              type="button"
                              onClick={() => togglePrecheckDetails(item.id)}
                              variant="ghost"
                              size="xs"
                            >
                              {precheckDetailsExpanded ? "Hide precheck details" : "Show precheck details"}
                            </UiButton>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                            strategy: {strategyLabel(reviewItem.strategy)}
                          </span>
                          {reviewItem.blocking && (
                            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                              blocked
                            </span>
                          )}
                          {!reviewItem.deleteSourceSafe && (
                            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                              delete_source unsafe
                            </span>
                          )}
                          {!reviewItem.rollbackSafe && (
                            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                              rollback unsafe
                            </span>
                          )}
                          {!reviewItem.sameEndpointCopySafe && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                              same-endpoint copy unsafe
                            </span>
                          )}
                        </div>
                        {reviewItem.targetExistsUnknown && (
                          <p className="mt-2 ui-caption text-amber-700 dark:text-amber-300">
                            Target bucket existence could not be fully verified during precheck.
                          </p>
                        )}
                        {precheckDetailsExpanded && reviewItem.messages.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {reviewItem.messages.map((message, index) => (
                              <span
                                key={`${reviewItem.itemId}-${message.code ?? message.level}-${index}`}
                                className={`rounded-md border px-2 py-1 text-[11px] ${precheckMessageClasses(message.level)}`}
                              >
                                {message.level.toUpperCase()}
                                {message.blocking ? " BLOCKING" : ""}
                                {message.code ? ` [${message.code}]` : ""}
                                {message.scope ? ` (${message.scope})` : ""}: {message.message}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {item.error_message && <p className="mt-1 ui-caption text-rose-600 dark:text-rose-300">{item.error_message}</p>}
                    {item.status === "failed" && canManageFailedItems && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <UiButton
                          type="button"
                          onClick={() => runItemAction(item.id, "retry")}
                          disabled={actionLoading != null}
                          variant="secondary"
                          size="xs"
                        >
                          {actionLoading === `retry-item-${item.id}` ? "Retrying..." : "Retry bucket"}
                        </UiButton>
                        <UiButton
                          type="button"
                          onClick={() => runItemAction(item.id, "rollback")}
                          disabled={actionLoading != null}
                          variant="warning"
                          size="xs"
                        >
                          {actionLoading === `rollback-item-${item.id}` ? "Rolling back..." : "Rollback bucket"}
                        </UiButton>
                      </div>
                    )}
                  </div>
                );
              })}
              {visibleItems.length === 0 && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">No bucket items for current focus.</p>
              )}
            </div>
          </section>

          <section className={cx(uiPanelClass, "p-4")}>
            <UiButton
              type="button"
              onClick={() => setShowEvents((current) => !current)}
              variant="ghost"
              size="sm"
            >
              {showEvents ? "Hide events" : "Show events"}
            </UiButton>
            {showEvents && (
              <div className="mt-3 max-h-56 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                {migrationDetail.recent_events.map((event) => (
                  <div key={event.id} className="rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700">
                    <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">
                      {event.level.toUpperCase()} | {event.message}
                    </p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">{formatDateTime(event.created_at)}</p>
                  </div>
                ))}
                {migrationDetail.recent_events.length === 0 && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">No events yet.</p>
                )}
              </div>
            )}
          </section>

          <section className={cx(uiPanelClass, "p-4")}>
            <UiButton
              type="button"
              onClick={() => setShowTechnical((current) => !current)}
              variant="ghost"
              size="sm"
            >
              {showTechnical ? "Hide technical details" : "Show technical details"}
            </UiButton>
            {showTechnical && (
              <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Last precheck: {formatDateTime(migrationDetail.precheck_checked_at)}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">Mode: {migrationDetail.mode}</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">Settings: {formatYesNo(migrationDetail.copy_bucket_settings)}</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">Lock target: {formatYesNo(migrationDetail.lock_target_writes)}</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Use x-amz-copy-source: {formatYesNo(migrationDetail.use_same_endpoint_copy)}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Auto-grant source read: {formatYesNo(migrationDetail.auto_grant_source_read_for_copy)}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">Delete source: {formatYesNo(migrationDetail.delete_source)}</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Strong integrity check: {formatYesNo(migrationDetail.strong_integrity_check)}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Webhook: {migrationDetail.webhook_url ? migrationDetail.webhook_url : "not configured"}
                </p>
              </div>
            )}
          </section>

          {confirmationCopy && (
            <ConfirmActionDialog
              title={confirmationCopy.title}
              description={confirmationCopy.description}
              confirmLabel={confirmationCopy.confirmLabel}
              details={confirmationCopy.details}
              impacts={confirmationCopy.impacts}
              loading={actionLoading != null}
              onCancel={() => setPendingConfirmation(null)}
              onConfirm={() => void confirmPendingAction()}
            />
          )}
        </>
      )}
    </PageShell>
  );
}

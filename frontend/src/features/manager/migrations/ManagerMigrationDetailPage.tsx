/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import PageHeader from "../../../components/PageHeader";
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
} from "../../../api/managerMigrations";
import { useManagerContexts, useManagerMigrationDetail } from "./hooks";
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
  operatorCardClasses,
  parseReviewItemMessages,
  precheckChipClasses,
  precheckMessageClasses,
  statusChipClasses,
  stepLabel,
  type MigrationOperatorAction,
  type ReviewItemSummary,
} from "./shared";

type BucketFocus = "focus" | "all" | "failed" | "awaiting";

function priorityValue(item: BucketMigrationItemView): number {
  const priority: Record<string, number> = {
    failed: 0,
    running: 1,
    pending: 2,
    paused: 3,
    awaiting_cutover: 4,
    completed: 5,
    skipped: 6,
    canceled: 7,
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
  const [showPrecheck, setShowPrecheck] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [bucketFocus, setBucketFocus] = useState<BucketFocus>("focus");

  const selectedMigrationSummary = useMemo(() => {
    if (!migrationDetail) return null;
    const done = migrationDetail.completed_items + migrationDetail.failed_items + migrationDetail.skipped_items;
    const percent = computeProgress(done, migrationDetail.total_items);
    return {
      done,
      total: migrationDetail.total_items,
      percent,
      activeItems:
        migrationDetail.total_items - migrationDetail.completed_items - migrationDetail.failed_items - migrationDetail.skipped_items,
    };
  }, [migrationDetail]);

  const precheckSummary = useMemo(() => {
    if (!migrationDetail?.precheck_report || typeof migrationDetail.precheck_report !== "object") return null;
    const report = migrationDetail.precheck_report as Record<string, unknown>;
    const errors = typeof report.errors === "number" ? report.errors : 0;
    const warnings = typeof report.warnings === "number" ? report.warnings : 0;
    return { errors, warnings };
  }, [migrationDetail]);

  const reviewItems = useMemo<ReviewItemSummary[]>(() => {
    if (!migrationDetail) return [];
    const reportItemsById = new Map<number, Record<string, unknown>>();
    if (migrationDetail.precheck_report && typeof migrationDetail.precheck_report === "object") {
      const report = migrationDetail.precheck_report as Record<string, unknown>;
      if (Array.isArray(report.items)) {
        for (const row of report.items) {
          if (!row || typeof row !== "object") continue;
          const item = row as Record<string, unknown>;
          const itemId = Number(item.item_id);
          if (Number.isFinite(itemId)) reportItemsById.set(itemId, item);
        }
      }
    }

    return migrationDetail.items.map((item) => {
      const reportItem = reportItemsById.get(item.id);
      const messages = parseReviewItemMessages(reportItem?.messages);
      return {
        itemId: item.id,
        sourceBucket: item.source_bucket,
        targetBucket: item.target_bucket,
        targetExists: inferTargetExists(messages),
        targetExistsUnknown: inferTargetExistsUnknown(messages),
        messages,
        errors: Number(reportItem?.errors ?? 0) || 0,
        warnings: Number(reportItem?.warnings ?? 0) || 0,
      };
    });
  }, [migrationDetail]);

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

  const canLaunchFromDraft = Boolean(
    migrationDetail && migrationDetail.status === "draft" && migrationDetail.precheck_status === "passed"
  );
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

  const runAction = async (action: MigrationOperatorAction | "stop") => {
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

  const runFailedItemsAction = async (action: "retry_failed_items" | "rollback_failed_items") => {
    if (!migrationDetail) return;
    if (action === "rollback_failed_items") {
      const confirmed = window.confirm(
        "Rollback all failed buckets? This will restore source rights and purge destination objects for failed items."
      );
      if (!confirmed) return;
    }
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

  const runItemAction = async (itemId: number, action: "retry" | "rollback") => {
    if (!migrationDetail) return;
    if (action === "rollback") {
      const confirmed = window.confirm(
        "Rollback this failed bucket? This will restore source rights and purge destination objects for this bucket."
      );
      if (!confirmed) return;
    }
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

  const runDeleteMigration = async () => {
    if (!migrationDetail || !isFinalMigrationStatus(migrationDetail.status)) return;
    const confirmed = window.confirm(
      `Delete migration #${migrationDetail.id}? This only removes migration history and tracking data.`
    );
    if (!confirmed) return;

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

  if (!migrationIdValue) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Bucket Migration"
          description="Invalid migration identifier."
          breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Migration" }]}
          actions={[{ label: "Back to list", onClick: () => navigate("/manager/migrations") }]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={migrationDetail ? `Migration #${migrationDetail.id}` : `Migration #${migrationIdValue}`}
        description="Operational view with focused bucket replication progress and required actions."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Migration" }]}
        actions={[
          { label: "Back to list", onClick: () => navigate("/manager/migrations") },
          ...(migrationDetail?.status === "draft"
            ? [{ label: "Edit draft", onClick: () => navigate(`/manager/migrations/new?from=${migrationDetail.id}`) }]
            : []),
        ]}
      />

      {detailLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Refreshing...</p>}
      {detailError && <p className="ui-caption text-rose-600 dark:text-rose-300">{detailError}</p>}
      {!migrationDetail && !detailLoading && (
        <p className="ui-caption text-slate-500 dark:text-slate-400">Migration not found or unavailable.</p>
      )}

      {migrationDetail && (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
              <div className={`rounded-xl border px-3 py-3 ${operatorCardClasses(nextAction.tone)}`}>
                <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">{nextAction.title}</p>
                <p className="ui-caption text-slate-600 dark:text-slate-300">{nextAction.description}</p>
                {nextAction.action && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() =>
                        nextAction.action === "retry_failed_items"
                          ? runFailedItemsAction("retry_failed_items")
                          : runAction(nextAction.action as MigrationOperatorAction)
                      }
                      disabled={actionLoading != null || (nextAction.action === "start" && !canLaunchFromDraft)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {actionLoading === nextAction.action ||
                      (nextAction.action === "retry_failed_items" && actionLoading === "retry-failed-items")
                        ? `${nextAction.actionLabel}...`
                        : nextAction.actionLabel}
                    </button>
                  </div>
                )}
              </div>
            )}

            {selectedMigrationSummary && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="mb-2 flex items-center justify-between">
                  <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">Global progress</p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">
                    {selectedMigrationSummary.done}/{selectedMigrationSummary.total} ({selectedMigrationSummary.percent}%)
                  </p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${selectedMigrationSummary.percent}%` }} />
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <p className="ui-caption text-slate-600 dark:text-slate-300">completed: {migrationDetail.completed_items}</p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">failed: {migrationDetail.failed_items}</p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">skipped: {migrationDetail.skipped_items}</p>
                  <p className="ui-caption text-slate-600 dark:text-slate-300">in progress: {selectedMigrationSummary.activeItems}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {migrationDetail.status === "draft" && (
                <button
                  type="button"
                  onClick={() => runAction("start")}
                  disabled={actionLoading != null || !canLaunchFromDraft}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 ui-caption font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                >
                  {actionLoading === "start" ? "Launching..." : "Launch replication"}
                </button>
              )}

              {migrationDetail.precheck_status === "failed" && (
                <button
                  type="button"
                  onClick={runPrecheck}
                  disabled={actionLoading != null}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 ui-caption font-semibold text-amber-800 disabled:opacity-50 dark:border-amber-700 dark:text-amber-200"
                >
                  {actionLoading === "precheck" ? "Running precheck..." : "Re-run precheck"}
                </button>
              )}

              {["queued", "running", "pause_requested"].includes(migrationDetail.status) && (
                <button
                  type="button"
                  onClick={() => runAction("pause")}
                  disabled={actionLoading != null}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 ui-caption font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                >
                  {actionLoading === "pause" ? "Pausing..." : "Pause"}
                </button>
              )}

              {migrationDetail.status === "paused" && (
                <button
                  type="button"
                  onClick={() => runAction("resume")}
                  disabled={actionLoading != null}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 ui-caption font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                >
                  {actionLoading === "resume" ? "Resuming..." : "Resume"}
                </button>
              )}

              {migrationDetail.status === "awaiting_cutover" && (
                <button
                  type="button"
                  onClick={() => runAction("continue")}
                  disabled={actionLoading != null}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 ui-caption font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                >
                  {actionLoading === "continue" ? "Continuing..." : "Continue after pre-sync"}
                </button>
              )}

              {canOfferFullRollback(migrationDetail) && (
                <button
                  type="button"
                  onClick={() => runAction("rollback")}
                  disabled={actionLoading != null}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 ui-caption font-semibold text-amber-800 disabled:opacity-50 dark:border-amber-700 dark:text-amber-200"
                >
                  {actionLoading === "rollback" ? "Rolling back..." : "Rollback migration"}
                </button>
              )}

              {failedItemCount > 0 && canManageFailedItems && (
                <button
                  type="button"
                  onClick={() => runFailedItemsAction("retry_failed_items")}
                  disabled={actionLoading != null}
                  className="rounded-lg border border-sky-300 px-3 py-1.5 ui-caption font-semibold text-sky-700 disabled:opacity-50 dark:border-sky-700 dark:text-sky-200"
                >
                  {actionLoading === "retry-failed-items" ? "Retrying failed..." : `Retry all failed (${failedItemCount})`}
                </button>
              )}

              {failedItemCount > 0 && canManageFailedItems && (
                <button
                  type="button"
                  onClick={() => runFailedItemsAction("rollback_failed_items")}
                  disabled={actionLoading != null}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 ui-caption font-semibold text-amber-800 disabled:opacity-50 dark:border-amber-700 dark:text-amber-200"
                >
                  {actionLoading === "rollback-failed-items"
                    ? "Rolling back failed..."
                    : `Rollback all failed (${failedItemCount})`}
                </button>
              )}

              {canStopMigration && (
                <button
                  type="button"
                  onClick={() => runAction("stop")}
                  disabled={actionLoading != null}
                  className="rounded-lg border border-rose-300 px-3 py-1.5 ui-caption font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-700 dark:text-rose-200"
                >
                  {actionLoading === "stop" ? "Stopping..." : "Stop"}
                </button>
              )}

              {isFinalMigrationStatus(migrationDetail.status) && (
                <button
                  type="button"
                  onClick={runDeleteMigration}
                  disabled={actionLoading != null}
                  className="rounded-lg border border-rose-300 px-3 py-1.5 ui-caption font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-700 dark:text-rose-200"
                >
                  {actionLoading === "delete-migration" ? "Deleting..." : "Delete migration"}
                </button>
              )}
            </div>
          </section>

          <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="ui-body text-base font-semibold text-slate-900 dark:text-slate-100">Bucket replication progress</h3>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setBucketFocus("focus")}
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                    bucketFocus === "focus"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
                  }`}
                >
                  Focused
                </button>
                <button
                  type="button"
                  onClick={() => setBucketFocus("failed")}
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                    bucketFocus === "failed"
                      ? "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200"
                      : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
                  }`}
                >
                  Failed
                </button>
                <button
                  type="button"
                  onClick={() => setBucketFocus("awaiting")}
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                    bucketFocus === "awaiting"
                      ? "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                      : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
                  }`}
                >
                  Awaiting
                </button>
                <button
                  type="button"
                  onClick={() => setBucketFocus("all")}
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                    bucketFocus === "all"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
                  }`}
                >
                  All
                </button>
              </div>
            </div>

            <div className="max-h-[520px] space-y-2 overflow-auto">
              {visibleItems.map((item) => {
                const itemCopyProgress = computeItemCopyProgressPercent(item);
                const showItemCopyProgress =
                  itemCopyProgress != null && ["pending", "running", "paused", "awaiting_cutover"].includes(item.status);
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
                    {item.error_message && <p className="mt-1 ui-caption text-rose-600 dark:text-rose-300">{item.error_message}</p>}
                    {item.status === "failed" && canManageFailedItems && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => runItemAction(item.id, "retry")}
                          disabled={actionLoading != null}
                          className="rounded-md border border-sky-300 px-2 py-1 text-[11px] font-semibold text-sky-700 disabled:opacity-50 dark:border-sky-700 dark:text-sky-200"
                        >
                          {actionLoading === `retry-item-${item.id}` ? "Retrying..." : "Retry bucket"}
                        </button>
                        <button
                          type="button"
                          onClick={() => runItemAction(item.id, "rollback")}
                          disabled={actionLoading != null}
                          className="rounded-md border border-amber-300 px-2 py-1 text-[11px] font-semibold text-amber-800 disabled:opacity-50 dark:border-amber-700 dark:text-amber-200"
                        >
                          {actionLoading === `rollback-item-${item.id}` ? "Rolling back..." : "Rollback bucket"}
                        </button>
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

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setShowPrecheck((current) => !current)}
              className="ui-caption font-semibold text-slate-700 dark:text-slate-200"
            >
              {showPrecheck ? "Hide precheck details" : "Show precheck details"}
            </button>
            {showPrecheck && (
              <div className="mt-3 space-y-3">
                <p className="ui-caption text-slate-600 dark:text-slate-300">
                  Precheck: {precheckSummary?.errors ?? 0} error(s), {precheckSummary?.warnings ?? 0} warning(s)
                </p>
                <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  {reviewItems.map((reviewItem) => {
                    return (
                      <div key={reviewItem.itemId} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                        <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">
                          {reviewItem.sourceBucket} {"->"} {reviewItem.targetBucket}
                        </p>
                        <p className="ui-caption text-slate-600 dark:text-slate-300">
                          Precheck result: {reviewItem.errors} error(s), {reviewItem.warnings} warning(s)
                        </p>
                        {reviewItem.targetExistsUnknown && (
                          <p className="ui-caption text-amber-700 dark:text-amber-300">
                            Target bucket existence could not be fully verified during precheck.
                          </p>
                        )}
                        {reviewItem.messages.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {reviewItem.messages.map((message, index) => (
                              <span
                                key={`${reviewItem.itemId}-${message.level}-${index}`}
                                className={`rounded-md border px-2 py-1 text-[11px] ${precheckMessageClasses(message.level)}`}
                              >
                                {message.level.toUpperCase()}: {message.message}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setShowEvents((current) => !current)}
              className="ui-caption font-semibold text-slate-700 dark:text-slate-200"
            >
              {showEvents ? "Hide events" : "Show events"}
            </button>
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

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setShowTechnical((current) => !current)}
              className="ui-caption font-semibold text-slate-700 dark:text-slate-200"
            >
              {showTechnical ? "Hide technical details" : "Show technical details"}
            </button>
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
                  Webhook: {migrationDetail.webhook_url ? migrationDetail.webhook_url : "not configured"}
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

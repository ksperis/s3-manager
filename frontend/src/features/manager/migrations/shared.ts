/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";

import type {
  BucketMigrationDetail,
  BucketMigrationPrecheckStatus,
  BucketMigrationStatus,
} from "../../../api/managerMigrations";

export type ReviewItemMessage = {
  level: string;
  message: string;
};

export type ReviewItemSummary = {
  itemId: number;
  sourceBucket: string;
  targetBucket: string;
  targetExists: boolean;
  targetExistsUnknown: boolean;
  messages: ReviewItemMessage[];
  errors: number;
  warnings: number;
};

export type MigrationOperatorAction = "start" | "pause" | "resume" | "continue" | "rollback";
export type NextActionType = MigrationOperatorAction | "retry_failed_items";

export type NextAction = {
  title: string;
  description: string;
  action: NextActionType | null;
  actionLabel: string;
  tone: "info" | "success" | "warning" | "danger";
};

export function extractError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { detail?: string } | undefined)?.detail || error.message || "Request failed";
  }
  return error instanceof Error ? error.message : "Request failed";
}

export function statusChipClasses(status: BucketMigrationStatus): string {
  if (["running", "queued", "pause_requested", "cancel_requested"].includes(status)) {
    return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200";
  }
  if (status === "awaiting_cutover") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
  }
  if (["completed"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200";
  }
  if (status === "rolled_back") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
  }
  if (["completed_with_errors", "failed", "canceled"].includes(status)) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200";
  }
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
}

export function precheckChipClasses(status: BucketMigrationPrecheckStatus): string {
  if (status === "passed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200";
  }
  if (status === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200";
  }
  return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
}

export function precheckMessageClasses(level: string): string {
  if (level === "error") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200";
  }
  if (level === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
  }
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

export function operatorCardClasses(tone: NextAction["tone"]): string {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20";
  }
  if (tone === "danger") {
    return "border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20";
  }
  return "border-sky-200 bg-sky-50 dark:border-sky-900/40 dark:bg-sky-950/20";
}

export function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    create_bucket: "Create bucket",
    copy_bucket_settings: "Copy settings",
    pre_sync: "Pre-sync",
    awaiting_cutover: "Waiting cutover",
    apply_target_lock: "Protect target",
    apply_read_only: "Protect source",
    sync: "Sync",
    verify: "Final verify",
    delete_source: "Delete source",
    completed: "Completed",
    skipped: "Skipped",
    rolled_back: "Rolled back",
  };
  return labels[step] ?? step;
}

export function parseReviewItemMessages(value: unknown): ReviewItemMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: ReviewItemMessage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const level = typeof row.level === "string" ? row.level : "info";
    const message = typeof row.message === "string" ? row.message : "";
    if (!message) continue;
    messages.push({ level, message });
  }
  return messages;
}

export function inferTargetExists(messages: ReviewItemMessage[]): boolean {
  return messages.some((entry) => entry.message.toLowerCase().includes("target bucket already exists"));
}

export function inferTargetExistsUnknown(messages: ReviewItemMessage[]): boolean {
  return messages.some((entry) => entry.message.toLowerCase().includes("unable to verify whether target bucket exists"));
}

export function buildPlannedSteps(
  item: ReviewItemSummary,
  options: {
    mode: "one_shot" | "pre_sync";
    copyBucketSettings: boolean;
    deleteSource: boolean;
    lockTargetWrites: boolean;
    useSameEndpointCopy: boolean;
    autoGrantSourceReadForCopy: boolean;
  }
): string[] {
  if (item.targetExists) {
    return ["Skip this bucket migration because the target bucket already exists."];
  }
  const steps = ["Create destination bucket."];
  if (options.lockTargetWrites) {
    steps.push("Apply temporary write-lock on destination bucket (migration worker is exempted).");
  }
  if (options.copyBucketSettings) {
    steps.push("Copy bucket settings.");
  }
  if (options.useSameEndpointCopy) {
    steps.push("Use same-endpoint x-amz-copy-source for object replication.");
  } else {
    steps.push("Use stream copy (GetObject + upload) for object replication.");
  }
  if (options.mode === "pre_sync") {
    steps.push("Run pre-sync then wait for cutover.");
  }
  if (options.useSameEndpointCopy && options.autoGrantSourceReadForCopy) {
    steps.push("Temporarily grant source read access for same-endpoint x-amz-copy-source operations.");
  }
  steps.push("Apply source bucket protection policy.");
  steps.push("Run sync/re-sync including deletion diff.");
  steps.push("Run final md5 + size verification.");
  if (options.deleteSource) {
    steps.push("Delete source bucket only if final diff is clean.");
  }
  return steps;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export function formatYesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export function computeProgress(done: number, total: number): number {
  const safeTotal = total <= 0 ? 1 : total;
  return Math.max(0, Math.min(100, Math.round((done / safeTotal) * 100)));
}

export function normalizeEndpointUrl(value?: string | null): string {
  return (value || "").trim().replace(/\/+$/, "").toLowerCase();
}

export function computeItemCopyProgressPercent(item: { source_count?: number | null; objects_copied: number }): number | null {
  const baseline = Number(item.source_count ?? 0);
  if (!Number.isFinite(baseline) || baseline <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((Math.max(0, item.objects_copied) / baseline) * 100)));
}

export function isActiveMigrationStatus(status: BucketMigrationStatus): boolean {
  return ["draft", "queued", "running", "pause_requested", "cancel_requested", "paused", "awaiting_cutover"].includes(
    status
  );
}

export function isNeedsAttentionMigrationStatus(status: BucketMigrationStatus): boolean {
  return ["failed", "completed_with_errors", "canceled"].includes(status);
}

export function isFinalMigrationStatus(status: BucketMigrationStatus): boolean {
  return ["completed", "completed_with_errors", "failed", "canceled", "rolled_back"].includes(status);
}

export function canOfferFullRollback(detail: BucketMigrationDetail): boolean {
  if (!["failed", "completed_with_errors"].includes(detail.status)) return false;
  if (!detail.delete_source) return true;
  return !detail.items.some(
    (item) => item.status !== "skipped" && (item.status === "completed" || item.step === "delete_source" || item.step === "completed")
  );
}

export function getNextAction(detail: BucketMigrationDetail, canLaunchFromDraft: boolean): NextAction {
  if (detail.status === "draft") {
    if (canLaunchFromDraft) {
      return {
        title: "Action required: launch replication",
        description: "Precheck passed. You can start replication now.",
        action: "start",
        actionLabel: "Launch replication",
        tone: "success",
      };
    }
    if (detail.precheck_status === "failed") {
      return {
        title: "Action required: resolve precheck issues",
        description: "Fix the precheck errors shown below before launch.",
        action: null,
        actionLabel: "",
        tone: "danger",
      };
    }
    return {
      title: "Precheck in progress",
      description: "Migration draft is waiting for precheck completion.",
      action: null,
      actionLabel: "",
      tone: "info",
    };
  }

  if (["queued", "running", "pause_requested"].includes(detail.status)) {
    return {
      title: "Migration running",
      description: "Monitor progress. Pause only if intervention is needed.",
      action: "pause",
      actionLabel: "Pause",
      tone: "info",
    };
  }

  if (detail.status === "paused") {
    return {
      title: "Action required: resume migration",
      description: "Migration is paused and waiting for your decision.",
      action: "resume",
      actionLabel: "Resume",
      tone: "warning",
    };
  }

  if (detail.status === "awaiting_cutover") {
    return {
      title: "Action required: continue cutover",
      description: "Pre-sync is complete. Continue to final synchronization.",
      action: "continue",
      actionLabel: "Continue after pre-sync",
      tone: "warning",
    };
  }

  if (detail.status === "completed") {
    return {
      title: "Migration completed",
      description: "All buckets in this migration are complete.",
      action: null,
      actionLabel: "",
      tone: "success",
    };
  }

  if (["failed", "completed_with_errors"].includes(detail.status) && detail.failed_items > 0) {
    return {
      title: "Action required: retry failed buckets",
      description: `Retry all failed bucket item(s) (${detail.failed_items}) before considering rollback.`,
      action: "retry_failed_items",
      actionLabel: `Retry all failed (${detail.failed_items})`,
      tone: "warning",
    };
  }

  if (["failed", "completed_with_errors"].includes(detail.status) && canOfferFullRollback(detail)) {
    return {
      title: "Migration requires attention",
      description: "Some items failed. You can rollback to restore source rights and clean target data.",
      action: "rollback",
      actionLabel: "Rollback migration",
      tone: "danger",
    };
  }

  if (detail.status === "canceled") {
    return {
      title: "Migration canceled",
      description: "No further action is required.",
      action: null,
      actionLabel: "",
      tone: "warning",
    };
  }

  if (detail.status === "rolled_back") {
    return {
      title: "Migration rolled back",
      description: "Rollback completed. Source rights were restored and target objects were removed.",
      action: null,
      actionLabel: "",
      tone: "warning",
    };
  }

  return {
    title: "Migration state",
    description: "Monitor this migration.",
    action: null,
    actionLabel: "",
    tone: "info",
  };
}

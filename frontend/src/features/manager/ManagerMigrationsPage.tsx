/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { listBuckets, type Bucket } from "../../api/buckets";
import { listExecutionContexts, type ExecutionContext } from "../../api/executionContexts";
import {
  continueManagerMigration,
  createManagerMigration,
  deleteManagerMigration,
  getManagerMigration,
  listManagerMigrations,
  pauseManagerMigration,
  retryFailedManagerMigrationItems,
  retryManagerMigrationItem,
  rollbackFailedManagerMigrationItems,
  rollbackManagerMigration,
  rollbackManagerMigrationItem,
  resumeManagerMigration,
  runManagerMigrationPrecheck,
  startManagerMigration,
  stopManagerMigration,
  type BucketMigrationDetail,
  type BucketMigrationPrecheckStatus,
  type BucketMigrationStatus,
  type BucketMigrationView,
} from "../../api/managerMigrations";
import Modal from "../../components/Modal";
import PageHeader from "../../components/PageHeader";
import { useS3AccountContext } from "./S3AccountContext";

function extractError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { detail?: string } | undefined)?.detail || error.message || "Request failed";
  }
  return error instanceof Error ? error.message : "Request failed";
}

function statusChipClasses(status: BucketMigrationStatus): string {
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

function precheckChipClasses(status: BucketMigrationPrecheckStatus): string {
  if (status === "passed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200";
  }
  if (status === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200";
  }
  return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
}

type ReviewItemMessage = {
  level: string;
  message: string;
};

type ReviewItemSummary = {
  itemId: number;
  sourceBucket: string;
  targetBucket: string;
  targetExists: boolean;
  targetExistsUnknown: boolean;
  messages: ReviewItemMessage[];
  errors: number;
  warnings: number;
};

type MigrationOperatorAction = "start" | "pause" | "resume" | "continue" | "rollback";
type MigrationListFilter = "all" | "active" | "needs_attention";
type NextActionType = MigrationOperatorAction | "retry_failed_items";

type NextAction = {
  title: string;
  description: string;
  action: NextActionType | null;
  actionLabel: string;
  tone: "info" | "success" | "warning" | "danger";
};

function parseReviewItemMessages(value: unknown): ReviewItemMessage[] {
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

function inferTargetExists(messages: ReviewItemMessage[]): boolean {
  return messages.some((entry) => entry.message.toLowerCase().includes("target bucket already exists"));
}

function inferTargetExistsUnknown(messages: ReviewItemMessage[]): boolean {
  return messages.some((entry) => entry.message.toLowerCase().includes("unable to verify whether target bucket exists"));
}

function precheckMessageClasses(level: string): string {
  if (level === "error") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200";
  }
  if (level === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
  }
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function operatorCardClasses(tone: NextAction["tone"]): string {
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

function stepLabel(step: string): string {
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

function buildPlannedSteps(
  item: ReviewItemSummary,
  options: {
    mode: "one_shot" | "pre_sync";
    copyBucketSettings: boolean;
    deleteSource: boolean;
    lockTargetWrites: boolean;
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
  if (options.mode === "pre_sync") {
    steps.push("Run pre-sync then wait for cutover.");
  }
  if (options.autoGrantSourceReadForCopy) {
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

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatYesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function computeProgress(done: number, total: number): number {
  const safeTotal = total <= 0 ? 1 : total;
  return Math.max(0, Math.min(100, Math.round((done / safeTotal) * 100)));
}

function normalizeEndpointUrl(value?: string | null): string {
  return (value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function computeItemCopyProgressPercent(item: { source_count?: number | null; objects_copied: number }): number | null {
  const baseline = Number(item.source_count ?? 0);
  if (!Number.isFinite(baseline) || baseline <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((Math.max(0, item.objects_copied) / baseline) * 100)));
}

function isActiveMigrationStatus(status: BucketMigrationStatus): boolean {
  return ["draft", "queued", "running", "pause_requested", "paused", "awaiting_cutover"].includes(status);
}

function isNeedsAttentionMigrationStatus(status: BucketMigrationStatus): boolean {
  return ["failed", "completed_with_errors", "canceled"].includes(status);
}

function isFinalMigrationStatus(status: BucketMigrationStatus): boolean {
  return ["completed", "completed_with_errors", "failed", "canceled", "rolled_back"].includes(status);
}

function canOfferFullRollback(detail: BucketMigrationDetail): boolean {
  if (!["failed", "completed_with_errors"].includes(detail.status)) return false;
  if (!detail.delete_source) return true;
  return !detail.items.some((item) => item.status !== "skipped" && (item.status === "completed" || item.step === "delete_source" || item.step === "completed"));
}

function getNextAction(detail: BucketMigrationDetail, canLaunchFromDraft: boolean): NextAction {
  if (detail.status === "draft") {
    if (canLaunchFromDraft) {
      return {
        title: "Action required: launch replication",
        description: "Review checks passed. You can start replication now.",
        action: "start",
        actionLabel: "Launch replication",
        tone: "success",
      };
    }
    if (detail.precheck_status === "failed") {
      return {
        title: "Action required: resolve review issues",
        description: "Fix the review errors shown below before launch.",
        action: null,
        actionLabel: "",
        tone: "danger",
      };
    }
    return {
      title: "Review in progress",
      description: "Migration draft is waiting for review completion.",
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

export default function ManagerMigrationsPage() {
  const { selectedS3AccountId } = useS3AccountContext();

  const [contexts, setContexts] = useState<ExecutionContext[]>([]);
  const [contextsLoading, setContextsLoading] = useState(true);
  const [contextsError, setContextsError] = useState<string | null>(null);

  const sourceContextId = selectedS3AccountId ?? "";
  const [targetContextId, setTargetContextId] = useState<string>("");

  const [sourceBuckets, setSourceBuckets] = useState<Bucket[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [bucketsError, setBucketsError] = useState<string | null>(null);

  const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);
  const [mappingPrefix, setMappingPrefix] = useState<string>("");
  const [targetOverrides, setTargetOverrides] = useState<Record<string, string>>({});

  const [mode, setMode] = useState<"one_shot" | "pre_sync">("one_shot");
  const [copyBucketSettings, setCopyBucketSettings] = useState<boolean>(true);
  const [deleteSource, setDeleteSource] = useState<boolean>(false);
  const [lockTargetWrites, setLockTargetWrites] = useState<boolean>(true);
  const [autoGrantSourceReadForCopy, setAutoGrantSourceReadForCopy] = useState<boolean>(true);
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(false);

  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [reconfigureSourceMigrationId, setReconfigureSourceMigrationId] = useState<number | null>(null);

  const [migrations, setMigrations] = useState<BucketMigrationView[]>([]);
  const [migrationsLoading, setMigrationsLoading] = useState(true);
  const [migrationsError, setMigrationsError] = useState<string | null>(null);
  const [migrationListFilter, setMigrationListFilter] = useState<MigrationListFilter>("all");

  const [selectedMigrationId, setSelectedMigrationId] = useState<number | null>(null);
  const [migrationDetail, setMigrationDetail] = useState<BucketMigrationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const sourceContext = useMemo(
    () => contexts.find((entry) => entry.id === sourceContextId) ?? null,
    [contexts, sourceContextId]
  );
  const targetContext = useMemo(
    () => contexts.find((entry) => entry.id === targetContextId) ?? null,
    [contexts, targetContextId]
  );
  const isCrossEndpointSelection = useMemo(() => {
    if (!sourceContext || !targetContext) return false;
    if (sourceContext.endpoint_id != null && targetContext.endpoint_id != null) {
      return sourceContext.endpoint_id !== targetContext.endpoint_id;
    }
    const sourceEndpointUrl = normalizeEndpointUrl(sourceContext.endpoint_url);
    const targetEndpointUrl = normalizeEndpointUrl(targetContext.endpoint_url);
    if (sourceEndpointUrl && targetEndpointUrl) {
      return sourceEndpointUrl !== targetEndpointUrl;
    }
    return false;
  }, [sourceContext, targetContext]);
  const contextLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const context of contexts) {
      map.set(context.id, context.display_name);
    }
    return map;
  }, [contexts]);

  useEffect(() => {
    let canceled = false;
    setContextsLoading(true);
    setContextsError(null);
    listExecutionContexts("manager")
      .then((items) => {
        if (canceled) return;
        setContexts(items);
      })
      .catch((error) => {
        if (canceled) return;
        setContextsError(extractError(error));
      })
      .finally(() => {
        if (!canceled) setContextsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!targetContextId) return;
    const isStillValid = contexts.some((context) => context.id === targetContextId && context.id !== sourceContextId);
    if (!isStillValid) {
      setTargetContextId("");
    }
  }, [contexts, sourceContextId, targetContextId]);

  useEffect(() => {
    if (!sourceContextId) {
      setSourceBuckets([]);
      setSelectedBuckets([]);
      setTargetOverrides({});
      return;
    }
    let canceled = false;
    setBucketsLoading(true);
    setBucketsError(null);
    listBuckets(sourceContextId, { with_stats: false })
      .then((items) => {
        if (canceled) return;
        const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
        setSourceBuckets(sorted);
        setSelectedBuckets((current) => current.filter((name) => sorted.some((bucket) => bucket.name === name)));
        setTargetOverrides((current) => {
          const next: Record<string, string> = {};
          Object.entries(current).forEach(([key, value]) => {
            if (sorted.some((bucket) => bucket.name === key)) next[key] = value;
          });
          return next;
        });
      })
      .catch((error) => {
        if (canceled) return;
        setBucketsError(extractError(error));
        setSourceBuckets([]);
      })
      .finally(() => {
        if (!canceled) setBucketsLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [sourceContextId]);

  const loadMigrations = useCallback(async () => {
    setMigrationsError(null);
    if (!sourceContextId) {
      setMigrations([]);
      setSelectedMigrationId(null);
      setMigrationDetail(null);
      return;
    }
    try {
      const items = await listManagerMigrations(100, sourceContextId);
      setMigrations(items);
      if (items.length > 0 && selectedMigrationId == null) {
        setSelectedMigrationId(items[0].id);
      }
      if (selectedMigrationId != null && !items.some((entry) => entry.id === selectedMigrationId)) {
        setSelectedMigrationId(items[0]?.id ?? null);
      }
    } catch (error) {
      setMigrationsError(extractError(error));
    }
  }, [selectedMigrationId, sourceContextId]);

  useEffect(() => {
    setMigrationsLoading(true);
    loadMigrations().finally(() => setMigrationsLoading(false));
    const interval = window.setInterval(() => {
      loadMigrations().catch(() => {});
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loadMigrations]);

  useEffect(() => {
    if (!selectedMigrationId) {
      setMigrationDetail(null);
      return;
    }
    let canceled = false;
    setDetailLoading(true);
    setDetailError(null);
    getManagerMigration(selectedMigrationId)
      .then((detail) => {
        if (canceled) return;
        setMigrationDetail(detail);
      })
      .catch((error) => {
        if (canceled) return;
        setDetailError(extractError(error));
      })
      .finally(() => {
        if (!canceled) setDetailLoading(false);
      });

    const interval = window.setInterval(() => {
      getManagerMigration(selectedMigrationId)
        .then((detail) => {
          if (!canceled) setMigrationDetail(detail);
        })
        .catch(() => {});
    }, 3000);

    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [selectedMigrationId]);

  useEffect(() => {
    setShowTechnicalDetails(false);
  }, [selectedMigrationId]);

  useEffect(() => {
    if (!isCreateModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createLoading) {
        setIsCreateModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCreateModalOpen, createLoading]);

  useEffect(() => {
    if (!isCreateModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCreateModalOpen]);

  const toggleBucket = (bucketName: string) => {
    setSelectedBuckets((current) => {
      if (current.includes(bucketName)) return current.filter((entry) => entry !== bucketName);
      return [...current, bucketName];
    });
  };

  const openCreateModal = () => {
    setCreateError(null);
    setCreateSuccess(null);
    setReconfigureSourceMigrationId(null);
    setWebhookUrl("");
    setShowAdvancedOptions(false);
    setIsCreateModalOpen(true);
  };

  const openCreateModalFromMigration = (detail: BucketMigrationDetail) => {
    if (!sourceContextId || detail.source_context_id !== sourceContextId) {
      setCreateError("Cannot reconfigure this migration from the current source context.");
      return;
    }

    const configuredBuckets = detail.items.map((item) => item.source_bucket);
    const configuredOverrides: Record<string, string> = {};
    detail.items.forEach((item) => {
      configuredOverrides[item.source_bucket] = item.target_bucket;
    });

    setCreateError(null);
    setCreateSuccess(null);
    setTargetContextId(detail.target_context_id);
    setSelectedBuckets(configuredBuckets);
    setTargetOverrides(configuredOverrides);
    setMappingPrefix(detail.mapping_prefix ?? "");
    setMode(detail.mode);
    setCopyBucketSettings(detail.copy_bucket_settings);
    setDeleteSource(detail.delete_source);
    setLockTargetWrites(detail.lock_target_writes);
    setAutoGrantSourceReadForCopy(detail.auto_grant_source_read_for_copy);
    setWebhookUrl(detail.webhook_url ?? "");
    setShowAdvancedOptions(true);
    setReconfigureSourceMigrationId(detail.id);
    setIsCreateModalOpen(true);
  };

  const runReviewInBackground = (migrationId: number) => {
    void (async () => {
      try {
        const reviewed = await runManagerMigrationPrecheck(migrationId);
        setMigrationDetail((current) => (current && current.id === migrationId ? reviewed : current));
        await loadMigrations();
        if (reviewed.precheck_status === "passed") {
          setCreateSuccess(`Migration #${migrationId} review passed. Launch replication when you are ready.`);
        } else {
          setCreateSuccess(`Migration #${migrationId} review failed. Resolve the reported issues, then re-run review.`);
        }
      } catch (error) {
        setCreateError(`Migration #${migrationId} was created, but review failed: ${extractError(error)}`);
      }
    })();
  };

  const runReview = async () => {
    if (!migrationDetail) return;
    setActionLoading("precheck");
    setDetailError(null);
    try {
      const reviewed = await runManagerMigrationPrecheck(migrationDetail.id);
      setMigrationDetail(reviewed);
      await loadMigrations();
    } catch (error) {
      setDetailError(extractError(error));
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);

    if (!sourceContextId) {
      setCreateError("Select a source in the top selector before creating a migration.");
      return;
    }
    if (!targetContextId) {
      setCreateError("Target is required.");
      return;
    }
    if (sourceContextId === targetContextId) {
      setCreateError("Source and target must differ.");
      return;
    }
    if (selectedBuckets.length === 0) {
      setCreateError("Select at least one source bucket.");
      return;
    }

    setCreateLoading(true);
    try {
      const sourceMigrationId = reconfigureSourceMigrationId;
      const buckets = selectedBuckets.map((source_bucket) => ({
        source_bucket,
        target_bucket: (targetOverrides[source_bucket] || "").trim() || undefined,
      }));
      const detail = await createManagerMigration({
        source_context_id: sourceContextId,
        target_context_id: targetContextId,
        buckets,
        mapping_prefix: mappingPrefix,
        mode,
        copy_bucket_settings: copyBucketSettings,
        delete_source: deleteSource,
        lock_target_writes: lockTargetWrites,
        auto_grant_source_read_for_copy: autoGrantSourceReadForCopy,
        webhook_url: webhookUrl.trim() || undefined,
      });
      setSelectedMigrationId(detail.id);
      await loadMigrations();
      setMigrationDetail(detail);
      setCreateSuccess(
        sourceMigrationId == null
          ? `Migration #${detail.id} was created. Review is running in background.`
          : `Migration #${detail.id} was created from migration #${sourceMigrationId}. Review is running in background.`
      );
      setWebhookUrl("");
      setShowAdvancedOptions(false);
      setReconfigureSourceMigrationId(null);
      setIsCreateModalOpen(false);
      runReviewInBackground(detail.id);
    } catch (error) {
      setCreateError(extractError(error));
    } finally {
      setCreateLoading(false);
    }
  };

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
      setMigrationDetail(await getManagerMigration(migrationDetail.id));
      await loadMigrations();
    } catch (error) {
      setDetailError(extractError(error));
    } finally {
      setActionLoading(null);
    }
  };

  const runDeleteMigration = async (migration: BucketMigrationView) => {
    if (!isFinalMigrationStatus(migration.status)) return;
    const confirmed = window.confirm(
      `Delete migration #${migration.id}? This only removes migration history and tracking data.`
    );
    if (!confirmed) return;

    const loadingKey = `delete-migration-${migration.id}`;
    setActionLoading(loadingKey);
    setMigrationsError(null);
    setDetailError(null);
    try {
      await deleteManagerMigration(migration.id);
      if (selectedMigrationId === migration.id) {
        setSelectedMigrationId(null);
        setMigrationDetail(null);
      }
      await loadMigrations();
    } catch (error) {
      setMigrationsError(extractError(error));
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
      setMigrationDetail(await getManagerMigration(migrationDetail.id));
      await loadMigrations();
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
      setMigrationDetail(await getManagerMigration(migrationDetail.id));
      await loadMigrations();
    } catch (error) {
      setDetailError(extractError(error));
    } finally {
      setActionLoading(null);
    }
  };

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
    const topErrors: string[] = [];
    if (Array.isArray(report.items)) {
      for (const item of report.items) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const sourceBucket = typeof row.source_bucket === "string" ? row.source_bucket : "unknown";
        const messages = Array.isArray(row.messages) ? row.messages : [];
        for (const message of messages) {
          if (!message || typeof message !== "object") continue;
          const entry = message as Record<string, unknown>;
          if (entry.level !== "error") continue;
          const text = typeof entry.message === "string" ? entry.message : "Review error";
          topErrors.push(`${sourceBucket}: ${text}`);
          if (topErrors.length >= 4) break;
        }
        if (topErrors.length >= 4) break;
      }
    }
    return { errors, warnings, topErrors };
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

  const canLaunchFromDraft = Boolean(
    migrationDetail && migrationDetail.status === "draft" && migrationDetail.precheck_status === "passed"
  );

  const nextAction = useMemo(() => {
    if (!migrationDetail) return null;
    return getNextAction(migrationDetail, canLaunchFromDraft);
  }, [migrationDetail, canLaunchFromDraft]);
  const nextActionIsRetryFailed = nextAction?.action === "retry_failed_items";
  const nextActionIsLoading = nextActionIsRetryFailed
    ? actionLoading === "retry-failed-items"
    : nextAction?.action
      ? actionLoading === nextAction.action
      : false;

  const currentContextMigrationsSummary = useMemo(() => {
    let active = 0;
    let requiringAttention = 0;
    for (const migration of migrations) {
      if (isActiveMigrationStatus(migration.status)) active += 1;
      if (isNeedsAttentionMigrationStatus(migration.status)) requiringAttention += 1;
    }
    return {
      total: migrations.length,
      active,
      requiringAttention,
    };
  }, [migrations]);

  const filteredMigrations = useMemo(() => {
    if (migrationListFilter === "all") return migrations;
    if (migrationListFilter === "active") {
      return migrations.filter((migration) => isActiveMigrationStatus(migration.status));
    }
    return migrations.filter((migration) => isNeedsAttentionMigrationStatus(migration.status));
  }, [migrations, migrationListFilter]);

  const sortedItems = useMemo(() => {
    if (!migrationDetail) return [];
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
    return [...migrationDetail.items].sort((a, b) => {
      const left = priority[a.status] ?? 99;
      const right = priority[b.status] ?? 99;
      if (left !== right) return left - right;
      return a.source_bucket.localeCompare(b.source_bucket);
    });
  }, [migrationDetail]);

  const failedItemCount = useMemo(() => sortedItems.filter((item) => item.status === "failed").length, [sortedItems]);

  const canManageFailedItems = Boolean(
    migrationDetail && !["queued", "running", "pause_requested", "cancel_requested"].includes(migrationDetail.status)
  );

  const canStopMigration = Boolean(
    migrationDetail &&
      !["completed", "completed_with_errors", "failed", "canceled", "rolled_back"].includes(migrationDetail.status)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bucket Migration"
        description="Operate bucket migrations with a clear view of status, progress, and required actions."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Migration" }]}
        actions={[
          {
            label: "New migration",
            onClick: openCreateModal,
          },
        ]}
      />

      {createSuccess && <p className="ui-caption text-emerald-700 dark:text-emerald-300">{createSuccess}</p>}
      {!isCreateModalOpen && createError && <p className="ui-caption text-rose-600 dark:text-rose-300">{createError}</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.35fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="ui-body text-base font-semibold text-slate-900 dark:text-slate-100">Current context migrations</h2>
            {migrationsLoading && <span className="ui-caption text-slate-500 dark:text-slate-400">Loading...</span>}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setMigrationListFilter("all")}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                migrationListFilter === "all"
                  ? "border-primary bg-primary/5"
                  : "border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600"
              }`}
            >
              <p className="ui-caption text-slate-500 dark:text-slate-400">Total</p>
              <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">{currentContextMigrationsSummary.total}</p>
            </button>
            <button
              type="button"
              onClick={() => setMigrationListFilter("active")}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                migrationListFilter === "active"
                  ? "border-sky-300 bg-sky-100 dark:border-sky-700 dark:bg-sky-950/40"
                  : "border-sky-200 bg-sky-50 hover:border-sky-300 dark:border-sky-900/40 dark:bg-sky-950/20 dark:hover:border-sky-800/60"
              }`}
            >
              <p className="ui-caption text-sky-700 dark:text-sky-300">Active</p>
              <p className="ui-caption font-semibold text-sky-800 dark:text-sky-200">{currentContextMigrationsSummary.active}</p>
            </button>
            <button
              type="button"
              onClick={() => setMigrationListFilter("needs_attention")}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                migrationListFilter === "needs_attention"
                  ? "border-rose-300 bg-rose-100 dark:border-rose-700 dark:bg-rose-950/40"
                  : "border-rose-200 bg-rose-50 hover:border-rose-300 dark:border-rose-900/40 dark:bg-rose-950/20 dark:hover:border-rose-800/60"
              }`}
            >
              <p className="ui-caption text-rose-700 dark:text-rose-300">Needs attention</p>
              <p className="ui-caption font-semibold text-rose-800 dark:text-rose-200">{currentContextMigrationsSummary.requiringAttention}</p>
            </button>
          </div>

          {migrationsError && <p className="mt-3 ui-caption text-rose-600 dark:text-rose-300">{migrationsError}</p>}

          <div className="mt-3 max-h-[620px] space-y-2 overflow-auto">
            {filteredMigrations.map((migration) => {
              const selected = migration.id === selectedMigrationId;
              const done = migration.completed_items + migration.failed_items + migration.skipped_items;
              const percent = computeProgress(done, migration.total_items);
              const canDelete = isFinalMigrationStatus(migration.status);
              const deleteLoadingKey = `delete-migration-${migration.id}`;
              return (
                <div
                  key={migration.id}
                  className={`relative w-full rounded-lg border p-3 text-left transition ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                  }`}
                >
                  <button type="button" onClick={() => setSelectedMigrationId(migration.id)} className="w-full text-left">
                    <div className="flex items-center justify-between gap-2 pr-8">
                      <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">#{migration.id}</p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusChipClasses(migration.status)}`}
                      >
                        {migration.status}
                      </span>
                    </div>
                    <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
                      {contextLabelById.get(migration.source_context_id) ?? migration.source_context_id} {"->"}{" "}
                      {contextLabelById.get(migration.target_context_id) ?? migration.target_context_id}
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                      {done}/{migration.total_items} done ({percent}%)
                    </p>
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => runDeleteMigration(migration)}
                      disabled={actionLoading != null}
                      aria-label={actionLoading === deleteLoadingKey ? `Deleting migration #${migration.id}` : `Delete migration #${migration.id}`}
                      title={actionLoading === deleteLoadingKey ? "Deleting..." : "Delete migration"}
                      className="absolute right-2 top-2 rounded-md border border-rose-300 p-1 text-rose-700 disabled:opacity-50 dark:border-rose-700 dark:text-rose-200"
                    >
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="M3.5 5.5h13" />
                        <path d="M8 5.5v-1a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
                        <path d="M6.5 5.5l.6 10a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-10" />
                        <path d="M8.5 8.5v5.5M11.5 8.5v5.5" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
            {!migrationsLoading && filteredMigrations.length === 0 && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                No migrations for current filter.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="ui-body text-base font-semibold text-slate-900 dark:text-slate-100">Operator view</h2>
            {detailLoading && <span className="ui-caption text-slate-500 dark:text-slate-400">Refreshing...</span>}
          </div>

          {detailError && <p className="ui-caption text-rose-600 dark:text-rose-300">{detailError}</p>}
          {!migrationDetail && !detailLoading && (
            <p className="ui-caption text-slate-500 dark:text-slate-400">Select a migration to start operating.</p>
          )}

          {migrationDetail && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusChipClasses(migrationDetail.status)}`}>
                  {migrationDetail.status}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${precheckChipClasses(migrationDetail.precheck_status)}`}
                >
                  review: {migrationDetail.precheck_status}
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
                          nextActionIsRetryFailed
                            ? runFailedItemsAction("retry_failed_items")
                            : runAction(nextAction.action as MigrationOperatorAction)
                        }
                        disabled={actionLoading != null || (nextAction.action === "start" && !canLaunchFromDraft)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {nextActionIsLoading ? `${nextAction.actionLabel}...` : nextAction.actionLabel}
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

                {migrationDetail.precheck_status === "failed" &&
                  !["queued", "running", "pause_requested", "cancel_requested"].includes(migrationDetail.status) && (
                    <button
                      type="button"
                      onClick={runReview}
                      disabled={actionLoading != null}
                      className="rounded-lg border border-amber-300 px-3 py-1.5 ui-caption font-semibold text-amber-800 disabled:opacity-50 dark:border-amber-700 dark:text-amber-200"
                    >
                      {actionLoading === "precheck" ? "Reviewing..." : "Re-run review"}
                    </button>
                  )}
                {migrationDetail.precheck_status === "failed" &&
                  migrationDetail.status === "draft" &&
                  !["queued", "running", "pause_requested", "cancel_requested"].includes(migrationDetail.status) && (
                    <button
                      type="button"
                      onClick={() => openCreateModalFromMigration(migrationDetail)}
                      disabled={actionLoading != null}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 ui-caption font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                    >
                      Adjust configuration
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
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <h3 className="ui-caption font-semibold text-slate-800 dark:text-slate-100">Bucket execution</h3>
                  <span className="ui-caption text-slate-500 dark:text-slate-400">{sortedItems.length} item(s)</span>
                </div>
                <div className="max-h-80 space-y-2 overflow-auto">
                  {sortedItems.map((item) => {
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
                          {typeof item.source_count === "number" && item.source_count >= 0
                            ? ` | source objects: ${item.source_count}`
                            : ""}
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
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowTechnicalDetails((current) => !current)}
                  className="ui-caption font-semibold text-slate-700 dark:text-slate-200"
                >
                  {showTechnicalDetails ? "Hide technical details" : "Show technical details"}
                </button>

                {showTechnicalDetails && (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                      <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                        Review: {precheckSummary?.errors ?? 0} error(s), {precheckSummary?.warnings ?? 0} warning(s)
                      </p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Last review: {formatDateTime(migrationDetail.precheck_checked_at)}
                      </p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Mode: {migrationDetail.mode}
                      </p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Settings: {formatYesNo(migrationDetail.copy_bucket_settings)}
                      </p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Lock target: {formatYesNo(migrationDetail.lock_target_writes)}
                      </p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Auto-grant source read: {formatYesNo(migrationDetail.auto_grant_source_read_for_copy)}
                      </p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Delete source: {formatYesNo(migrationDetail.delete_source)}
                      </p>
                      {(precheckSummary?.topErrors ?? []).map((entry, index) => (
                        <p key={`${entry}-${index}`} className="ui-caption text-rose-600 dark:text-rose-300">
                          {entry}
                        </p>
                      ))}
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Webhook: {migrationDetail.webhook_url ? migrationDetail.webhook_url : "not configured"}
                      </p>
                    </div>

                    <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      {reviewItems.map((reviewItem) => {
                        const plannedSteps = buildPlannedSteps(reviewItem, {
                          mode: migrationDetail.mode,
                          copyBucketSettings: migrationDetail.copy_bucket_settings,
                          deleteSource: migrationDetail.delete_source,
                          lockTargetWrites: migrationDetail.lock_target_writes,
                          autoGrantSourceReadForCopy: migrationDetail.auto_grant_source_read_for_copy,
                        });
                        return (
                          <div key={reviewItem.itemId} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                            <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">
                              {reviewItem.sourceBucket} {"->"} {reviewItem.targetBucket}
                            </p>
                            {plannedSteps.map((step, index) => (
                              <p key={`${reviewItem.itemId}-${index}`} className="ui-caption text-slate-600 dark:text-slate-300">
                                - {step}
                              </p>
                            ))}
                            {reviewItem.targetExistsUnknown && (
                              <p className="ui-caption text-amber-700 dark:text-amber-300">
                                - Target bucket existence could not be fully verified during review.
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

                    <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
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
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {isCreateModalOpen && (
        <Modal
          title={reconfigureSourceMigrationId == null ? "Create migration" : `Reconfigure migration #${reconfigureSourceMigrationId}`}
          onClose={() => {
            if (!createLoading) {
              setReconfigureSourceMigrationId(null);
              setIsCreateModalOpen(false);
            }
          }}
          maxWidthClass="max-w-3xl"
          maxBodyHeightClass="max-h-[78vh]"
          closeOnEscape={!createLoading}
          closeOnBackdropClick={!createLoading}
        >
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              {reconfigureSourceMigrationId == null
                ? "Create a draft, run review automatically, then launch from the operator view."
                : `Adjust settings for migration #${reconfigureSourceMigrationId}, then create a revised draft and run review automatically.`}
            </p>
              {contextsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading contexts...</p>}
              {contextsError && <p className="ui-caption text-rose-600 dark:text-rose-300">{contextsError}</p>}

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Endpoints</p>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/70">
                    <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Source</p>
                    <div className="mt-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                      {sourceContext ? `${sourceContext.display_name} (${sourceContext.id})` : "No source selected"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/70">
                    <label className="space-y-1 ui-caption">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">Target</span>
                      <select
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                        value={targetContextId}
                        onChange={(event) => setTargetContextId(event.target.value)}
                        disabled={!sourceContextId}
                        required
                      >
                        <option value="">Select a target</option>
                        {contexts
                          .filter((context) => context.id !== sourceContextId)
                          .map((context) => (
                            <option key={`modal-dst-${context.id}`} value={context.id}>
                              {context.display_name} ({context.id})
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                </div>
                {isCrossEndpointSelection && (
                  <p className="mt-2 ui-caption text-amber-700 dark:text-amber-300">
                    Cross-endpoint migration can take longer depending on the data volume to transfer.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <label className="space-y-1 ui-caption">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Target prefix mapping</span>
                  <input
                    type="text"
                    value={mappingPrefix}
                    onChange={(event) => setMappingPrefix(event.target.value)}
                    placeholder="Optional prefix"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Advanced options</p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      Strategy, safety, performance and integration settings.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedOptions((current) => !current)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                  >
                    {showAdvancedOptions ? "Hide" : "Show"}
                  </button>
                </div>

                {showAdvancedOptions && (
                  <div className="mt-3 space-y-3">
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                      <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Strategy</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="inline-flex items-center gap-2 ui-caption text-slate-700 dark:text-slate-200">
                          <input type="radio" checked={mode === "one_shot"} onChange={() => setMode("one_shot")} className="h-4 w-4" />
                          One-shot migration
                        </label>
                        <label className="inline-flex items-center gap-2 ui-caption text-slate-700 dark:text-slate-200">
                          <input type="radio" checked={mode === "pre_sync"} onChange={() => setMode("pre_sync")} className="h-4 w-4" />
                          Pre-sync + cutover
                        </label>
                      </div>
                    </div>

                    <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                      <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Safety and behavior</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="inline-flex items-center gap-2 ui-caption text-slate-700 dark:text-slate-200">
                          <input
                            type="checkbox"
                            checked={copyBucketSettings}
                            onChange={(event) => setCopyBucketSettings(event.target.checked)}
                            className="h-4 w-4"
                          />
                          Copy bucket settings
                        </label>
                        <label className="inline-flex items-center gap-2 ui-caption text-slate-700 dark:text-slate-200">
                          <input
                            type="checkbox"
                            checked={lockTargetWrites}
                            onChange={(event) => setLockTargetWrites(event.target.checked)}
                            className="h-4 w-4"
                          />
                          Lock target writes during migration
                        </label>
                        <label className="inline-flex items-center gap-2 ui-caption text-slate-700 dark:text-slate-200 md:col-span-2">
                          <input
                            type="checkbox"
                            checked={autoGrantSourceReadForCopy}
                            onChange={(event) => setAutoGrantSourceReadForCopy(event.target.checked)}
                            className="h-4 w-4"
                          />
                          Auto-grant temporary source read for same-endpoint copy
                        </label>
                        <label className="inline-flex items-center gap-2 ui-caption text-slate-700 dark:text-slate-200 md:col-span-2">
                          <input
                            type="checkbox"
                            checked={deleteSource}
                            onChange={(event) => setDeleteSource(event.target.checked)}
                            className="h-4 w-4"
                          />
                          Delete source if diff is clean
                        </label>
                      </div>
                    </div>

                    <div className="space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                      <label className="space-y-1 ui-caption">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">Webhook URL</span>
                        <input
                          type="url"
                          value={webhookUrl}
                          onChange={(event) => setWebhookUrl(event.target.value)}
                          placeholder="https://example.net/migration-events"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                        />
                      </label>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Called on each migration event with migration and bucket-level status data.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Source buckets</h3>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {selectedBuckets.length} selected / {sourceBuckets.length}
                  </p>
                </div>

                {bucketsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading buckets...</p>}
                {bucketsError && <p className="ui-caption text-rose-600 dark:text-rose-300">{bucketsError}</p>}
                {!bucketsLoading && !bucketsError && sourceBuckets.length === 0 && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">No bucket found for selected source.</p>
                )}

                <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  {sourceBuckets.map((bucket) => {
                    const checked = selectedBuckets.includes(bucket.name);
                    return (
                      <div key={`modal-${bucket.name}`} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                        <label className="flex items-center gap-2 ui-caption font-medium text-slate-800 dark:text-slate-100">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBucket(bucket.name)}
                            className="h-4 w-4"
                          />
                          <span>{bucket.name}</span>
                        </label>
                        {checked && (
                          <div className="mt-2">
                            <input
                              type="text"
                              value={targetOverrides[bucket.name] ?? ""}
                              placeholder={`Target bucket (default: ${mappingPrefix}${bucket.name})`}
                              onChange={(event) =>
                                setTargetOverrides((current) => ({
                                  ...current,
                                  [bucket.name]: event.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {createError && <p className="ui-caption text-rose-600 dark:text-rose-300">{createError}</p>}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReconfigureSourceMigrationId(null);
                    setIsCreateModalOpen(false);
                  }}
                  disabled={createLoading}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading || !sourceContextId}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {createLoading
                    ? reconfigureSourceMigrationId == null
                      ? "Creating and reviewing..."
                      : "Creating revised migration..."
                    : reconfigureSourceMigrationId == null
                      ? "Create migration"
                      : "Create revised migration"}
                </button>
              </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import PageHeader from "../../../components/PageHeader";
import {
  createManagerMigration,
  getManagerMigration,
  runManagerMigrationPrecheck,
  startManagerMigration,
  updateManagerMigration,
} from "../../../api/managerMigrations";
import { useS3AccountContext } from "../S3AccountContext";
import { useCrossEndpointSelection, useManagerContexts, useManagerSourceBuckets } from "./hooks";
import { buildPlannedSteps, extractError } from "./shared";

type WizardStep = 0 | 1 | 2 | 3;

function isPrecheckPassed(detail: { precheck_status?: string; precheck_report?: unknown }): boolean {
  if (detail.precheck_status !== "passed") return false;
  if (!detail.precheck_report || typeof detail.precheck_report !== "object") return true;
  const report = detail.precheck_report as Record<string, unknown>;
  if (typeof report.errors === "number" && report.errors > 0) return false;
  const reportItems = Array.isArray(report.items) ? report.items : [];
  for (const row of reportItems) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.errors === "number" && item.errors > 0) return false;
    const messages = Array.isArray(item.messages) ? item.messages : [];
    for (const messageRow of messages) {
      if (!messageRow || typeof messageRow !== "object") continue;
      const message = messageRow as Record<string, unknown>;
      if (typeof message.level === "string" && message.level.toLowerCase() === "error") return false;
    }
  }
  return true;
}

export default function ManagerMigrationWizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromQuery = searchParams.get("from");
  const editMigrationId = fromQuery && /^\d+$/.test(fromQuery) ? Number(fromQuery) : null;

  const { selectedS3AccountId } = useS3AccountContext();
  const sourceContextId = selectedS3AccountId ?? "";

  const { contexts, contextsLoading, contextsError } = useManagerContexts();
  const { sourceBuckets, bucketsLoading, bucketsError } = useManagerSourceBuckets(sourceContextId);

  const sourceContext = useMemo(() => contexts.find((entry) => entry.id === sourceContextId) ?? null, [contexts, sourceContextId]);

  const [targetContextId, setTargetContextId] = useState<string>("");
  const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);
  const [bucketFilter, setBucketFilter] = useState<string>("");
  const [mappingPrefix, setMappingPrefix] = useState<string>("");
  const [mappingSuffix, setMappingSuffix] = useState<string>("");
  const [targetOverrides, setTargetOverrides] = useState<Record<string, string>>({});

  const [mode, setMode] = useState<"one_shot" | "pre_sync">("one_shot");
  const [copyBucketSettings, setCopyBucketSettings] = useState<boolean>(false);
  const [deleteSource, setDeleteSource] = useState<boolean>(true);
  const [strongIntegrityCheck, setStrongIntegrityCheck] = useState<boolean>(false);
  const [lockTargetWrites, setLockTargetWrites] = useState<boolean>(true);
  const [useSameEndpointCopy, setUseSameEndpointCopy] = useState<boolean>(false);
  const [autoGrantSourceReadForCopy, setAutoGrantSourceReadForCopy] = useState<boolean>(false);
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(false);

  const [step, setStep] = useState<WizardStep>(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editLoaded, setEditLoaded] = useState(false);

  const targetContext = useMemo(() => contexts.find((entry) => entry.id === targetContextId) ?? null, [contexts, targetContextId]);
  const targetContextOptions = useMemo(
    () =>
      contexts.filter((context) => {
        if (context.id === sourceContextId) return false;
        if (context.kind !== "account") return true;
        if (context.id === targetContextId) return true;
        return context.manager_account_is_admin === true;
      }),
    [contexts, sourceContextId, targetContextId]
  );
  const isCrossEndpointSelection = useCrossEndpointSelection(sourceContext, targetContext);
  const canUseSameEndpointCopy = Boolean(sourceContext && targetContext && !isCrossEndpointSelection);

  const selectedBucketSet = useMemo(() => new Set(selectedBuckets), [selectedBuckets]);
  const filteredBuckets = useMemo(() => {
    const needle = bucketFilter.trim().toLowerCase();
    if (!needle) return sourceBuckets;
    return sourceBuckets.filter((bucket) => bucket.name.toLowerCase().includes(needle));
  }, [bucketFilter, sourceBuckets]);
  const summaryBucketMappings = useMemo(
    () =>
      selectedBuckets.map((sourceBucket) => ({
        sourceBucket,
        targetBucket: (targetOverrides[sourceBucket] || "").trim() || `${mappingPrefix}${sourceBucket}${mappingSuffix}`,
      })),
    [mappingPrefix, mappingSuffix, selectedBuckets, targetOverrides]
  );
  const summaryOperationSteps = useMemo(() => {
    if (summaryBucketMappings.length === 0) return [];
    const probe = summaryBucketMappings[0];
    return buildPlannedSteps(
      {
        itemId: 1,
        sourceBucket: probe.sourceBucket,
        targetBucket: probe.targetBucket,
        targetExists: false,
        targetExistsUnknown: false,
        messages: [],
        errors: 0,
        warnings: 0,
      },
      {
        mode,
        copyBucketSettings,
        deleteSource,
        strongIntegrityCheck,
        lockTargetWrites,
        useSameEndpointCopy,
        autoGrantSourceReadForCopy: useSameEndpointCopy && autoGrantSourceReadForCopy,
      }
    );
  }, [
    autoGrantSourceReadForCopy,
    copyBucketSettings,
    deleteSource,
    strongIntegrityCheck,
    lockTargetWrites,
    mode,
    summaryBucketMappings,
    useSameEndpointCopy,
  ]);

  useEffect(() => {
    setSelectedBuckets((current) => current.filter((name) => sourceBuckets.some((bucket) => bucket.name === name)));
    setTargetOverrides((current) => {
      const next: Record<string, string> = {};
      Object.entries(current).forEach(([key, value]) => {
        if (sourceBuckets.some((bucket) => bucket.name === key)) next[key] = value;
      });
      return next;
    });
  }, [sourceBuckets]);

  useEffect(() => {
    if (!editMigrationId || editLoaded) return;
    setEditLoading(true);
    setFormError(null);
    getManagerMigration(editMigrationId)
      .then((detail) => {
        if (!sourceContextId || detail.source_context_id !== sourceContextId) {
          setFormError("Cannot edit this draft from the current source context.");
          return;
        }

        const configuredBuckets = detail.items.map((item) => item.source_bucket);
        const declaredMappingPrefix = detail.mapping_prefix ?? "";
        const firstItem = detail.items[0] ?? null;
        let inferredMappingPrefix = declaredMappingPrefix;
        let inferredMappingSuffix = "";
        if (firstItem) {
          const idx = firstItem.target_bucket.indexOf(firstItem.source_bucket);
          if (idx >= 0) {
            const candidatePrefix = firstItem.target_bucket.slice(0, idx);
            const candidateSuffix = firstItem.target_bucket.slice(idx + firstItem.source_bucket.length);
            const consistent = detail.items.every(
              (item) => item.target_bucket === `${candidatePrefix}${item.source_bucket}${candidateSuffix}`
            );
            if (consistent) {
              inferredMappingPrefix = candidatePrefix;
              inferredMappingSuffix = candidateSuffix;
            }
          }
        }

        const configuredOverrides: Record<string, string> = {};
        detail.items.forEach((item) => {
          const defaultTarget = `${inferredMappingPrefix}${item.source_bucket}${inferredMappingSuffix}`;
          if (item.target_bucket !== defaultTarget) {
            configuredOverrides[item.source_bucket] = item.target_bucket;
          }
        });

        setTargetContextId(detail.target_context_id);
        setSelectedBuckets(configuredBuckets);
        setTargetOverrides(configuredOverrides);
        setMappingPrefix(inferredMappingPrefix);
        setMappingSuffix(inferredMappingSuffix);
        setMode(detail.mode);
        setCopyBucketSettings(detail.copy_bucket_settings);
        setDeleteSource(detail.delete_source);
        setStrongIntegrityCheck(Boolean(detail.strong_integrity_check));
        setLockTargetWrites(detail.lock_target_writes);
        setUseSameEndpointCopy(Boolean(detail.use_same_endpoint_copy));
        setAutoGrantSourceReadForCopy(
          Boolean(detail.use_same_endpoint_copy) ? Boolean(detail.auto_grant_source_read_for_copy) : false
        );
        setWebhookUrl(detail.webhook_url ?? "");
        setShowAdvancedOptions(true);
      })
      .catch((error) => {
        setFormError(extractError(error));
      })
      .finally(() => {
        setEditLoaded(true);
        setEditLoading(false);
      });
  }, [editLoaded, editMigrationId, sourceContextId]);

  useEffect(() => {
    if (!sourceContext || !targetContext) return;
    if (canUseSameEndpointCopy) return;
    setUseSameEndpointCopy(false);
    setAutoGrantSourceReadForCopy(false);
  }, [canUseSameEndpointCopy, sourceContext, targetContext]);

  useEffect(() => {
    if (useSameEndpointCopy) return;
    setAutoGrantSourceReadForCopy(false);
  }, [useSameEndpointCopy]);

  useEffect(() => {
    if (deleteSource) return;
    setStrongIntegrityCheck(false);
  }, [deleteSource]);

  const toggleBucket = (bucketName: string) => {
    setSelectedBuckets((current) => {
      if (current.includes(bucketName)) return current.filter((entry) => entry !== bucketName);
      return [...current, bucketName];
    });
  };

  const selectFilteredBuckets = () => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      filteredBuckets.forEach((bucket) => next.add(bucket.name));
      return [...next];
    });
  };

  const validateStep = (currentStep: WizardStep): boolean => {
    if (currentStep === 0) {
      if (!sourceContextId) {
        setFormError("Select a source in the top selector before creating a migration.");
        return false;
      }
      if (!targetContextId) {
        setFormError("Target is required.");
        return false;
      }
      if (
        sourceContext?.kind === "account" &&
        targetContext?.kind === "account" &&
        sourceContext.id !== targetContext.id &&
        (sourceContext.manager_account_is_admin !== true || targetContext.manager_account_is_admin !== true)
      ) {
        setFormError("Cross-account migrations require admin access on both source and target account contexts.");
        return false;
      }
      if (sourceContextId === targetContextId) {
        setFormError("Source and target must differ.");
        return false;
      }
      if (selectedBuckets.length === 0) {
        setFormError("Select at least one source bucket.");
        return false;
      }
    }
    if (currentStep === 1) {
      for (const bucketName of selectedBuckets) {
        const override = (targetOverrides[bucketName] || "").trim();
        if (override.length === 0) continue;
        if (override.includes(" ")) {
          setFormError(`Target override for '${bucketName}' cannot include spaces.`);
          return false;
        }
      }
    }
    setFormError(null);
    return true;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((current) => (current >= 3 ? 3 : ((current + 1) as WizardStep)));
  };

  const goBack = () => {
    setFormError(null);
    setStep((current) => (current <= 0 ? 0 : ((current - 1) as WizardStep)));
  };

  const handleSubmit = async () => {
    if (!validateStep(3)) return;

    setCreateLoading(true);
    setFormError(null);
    try {
      const buckets = selectedBuckets.map((source_bucket) => ({
        source_bucket,
        target_bucket:
          (targetOverrides[source_bucket] || "").trim() ||
          (mappingSuffix ? `${mappingPrefix}${source_bucket}${mappingSuffix}` : undefined),
      }));
      const payload = {
        source_context_id: sourceContextId,
        target_context_id: targetContextId,
        buckets,
        mapping_prefix: mappingPrefix,
        mode,
        copy_bucket_settings: copyBucketSettings,
        delete_source: deleteSource,
        strong_integrity_check: strongIntegrityCheck,
        lock_target_writes: lockTargetWrites,
        use_same_endpoint_copy: useSameEndpointCopy,
        auto_grant_source_read_for_copy: useSameEndpointCopy ? autoGrantSourceReadForCopy : false,
        webhook_url: webhookUrl.trim() || undefined,
      };

      const detail =
        editMigrationId == null
          ? await createManagerMigration(payload)
          : await updateManagerMigration(editMigrationId, payload);
      const precheckDetail = await runManagerMigrationPrecheck(detail.id).catch(() => null);
      if (precheckDetail && isPrecheckPassed(precheckDetail)) {
        await startManagerMigration(detail.id).catch(() => {});
      }
      navigate(`/manager/migrations/${detail.id}`);
    } catch (error) {
      setFormError(extractError(error));
    } finally {
      setCreateLoading(false);
    }
  };

  const stepLabel = (index: WizardStep, label: string) => {
    const active = step === index;
    const completed = step > index;
    const classes = active
      ? "border-primary bg-primary/10 text-primary"
      : completed
        ? "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
        : "border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-300";
    return (
      <div className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${classes}`}>
        {label}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={editMigrationId == null ? "New migration" : `Edit draft #${editMigrationId}`}
        description="Guided setup to create or update a migration draft."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Migration" }]}
        actions={[{ label: "Back to list", onClick: () => navigate("/manager/migrations") }]}
      />

      {(contextsLoading || editLoading) && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading...</p>}
      {contextsError && <p className="ui-caption text-rose-600 dark:text-rose-300">{contextsError}</p>}
      {bucketsError && <p className="ui-caption text-rose-600 dark:text-rose-300">{bucketsError}</p>}
      {formError && <p className="ui-caption text-rose-600 dark:text-rose-300">{formError}</p>}

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {stepLabel(0, "1. Context & buckets")}
            {stepLabel(1, "2. Mapping")}
            {stepLabel(2, "3. Strategy")}
            {stepLabel(3, "4. Summary")}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0 || createLoading}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
            >
              Back
            </button>

            {step < 3 && (
              <button
                type="button"
                onClick={goNext}
                disabled={createLoading}
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white disabled:opacity-50"
              >
                Next
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={createLoading}
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white disabled:opacity-50"
              >
                {createLoading
                  ? editMigrationId == null
                    ? "Creating and running precheck..."
                    : "Updating and running precheck..."
                  : editMigrationId == null
                    ? "Create migration"
                    : "Update migration"}
              </button>
            )}
          </div>
        </div>

        {step === 0 && (
          <div className="space-y-4">
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
                      {targetContextOptions.map((context) => (
                        <option key={`wizard-dst-${context.id}`} value={context.id}>
                          {context.display_name} ({context.id})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                For cross-account migrations, account targets are limited to admin contexts.
              </p>
              {isCrossEndpointSelection && (
                <p className="mt-2 ui-caption text-amber-700 dark:text-amber-300">
                  Cross-endpoint migration can take longer depending on the data volume to transfer.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Source buckets</h3>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {selectedBuckets.length} selected / {sourceBuckets.length}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={bucketFilter}
                  onChange={(event) => setBucketFilter(event.target.value)}
                  placeholder="Filter source buckets"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-80 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={selectFilteredBuckets}
                  disabled={filteredBuckets.length === 0}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-500"
                >
                  Select filtered
                </button>
              </div>

              {bucketsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading buckets...</p>}

              <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                {filteredBuckets.map((bucket) => {
                  const checked = selectedBucketSet.has(bucket.name);
                  return (
                    <div key={`wizard-${bucket.name}`} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                      <label className="flex items-center gap-2 ui-caption font-medium text-slate-800 dark:text-slate-100">
                        <input type="checkbox" checked={checked} onChange={() => toggleBucket(bucket.name)} className="h-4 w-4" />
                        <span>{bucket.name}</span>
                      </label>
                    </div>
                  );
                })}
                {!bucketsLoading && filteredBuckets.length === 0 && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {sourceBuckets.length === 0 ? "No bucket found for selected source." : "No buckets match current filter."}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
              <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Target prefix/suffix mapping</p>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="space-y-1 ui-caption">
                  <span className="text-slate-600 dark:text-slate-300">Prefix</span>
                  <input
                    type="text"
                    value={mappingPrefix}
                    onChange={(event) => setMappingPrefix(event.target.value)}
                    placeholder="Optional prefix"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </label>
                <label className="space-y-1 ui-caption">
                  <span className="text-slate-600 dark:text-slate-300">Suffix</span>
                  <input
                    type="text"
                    value={mappingSuffix}
                    onChange={(event) => setMappingSuffix(event.target.value)}
                    placeholder="Optional suffix"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              {selectedBuckets.map((bucketName) => (
                <div key={`wizard-map-${bucketName}`} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                  <div className="grid gap-2 md:grid-cols-[minmax(220px,280px)_1fr] md:items-center">
                    <p className="ui-caption truncate font-semibold text-slate-800 dark:text-slate-100">{bucketName}</p>
                    <input
                      type="text"
                      value={targetOverrides[bucketName] ?? ""}
                      placeholder={`Target bucket (default: ${mappingPrefix}${bucketName}${mappingSuffix})`}
                      onChange={(event) =>
                        setTargetOverrides((current) => ({
                          ...current,
                          [bucketName]: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
              <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Strategy</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="inline-flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 ui-caption text-slate-700 dark:text-slate-200">
                    <input
                      type="radio"
                      checked={mode === "one_shot"}
                      onChange={() => setMode("one_shot")}
                      className="h-4 w-4"
                    />
                    One-shot migration
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 ui-caption text-slate-700 dark:text-slate-200">
                    <input
                      type="radio"
                      checked={mode === "pre_sync"}
                      onChange={() => setMode("pre_sync")}
                      className="h-4 w-4"
                    />
                    Pre-sync + cutover
                  </label>
                </div>
              </div>

              <label className="mt-2 flex w-fit max-w-full items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2 ui-caption text-slate-800 dark:border-amber-700 dark:bg-amber-950/20 dark:text-slate-100">
                <input
                  type="checkbox"
                  checked={deleteSource}
                  onChange={(event) => setDeleteSource(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                  <span className="space-y-0.5">
                    <span className="block font-semibold">Delete source if diff is clean</span>
                  </span>
                </label>

              <label
                className={`flex w-fit max-w-full items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 ui-caption text-slate-800 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100 ${
                  !deleteSource ? "opacity-70" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={strongIntegrityCheck}
                  onChange={(event) => setStrongIntegrityCheck(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                  disabled={!deleteSource}
                />
                <span className="space-y-0.5">
                  <span className="block font-semibold">Strong integrity check before source deletion</span>
                  <span aria-hidden="true" className="block text-[11px] text-slate-500 dark:text-slate-400">
                    {deleteSource
                      ? "Optional deep verification (can be expensive on very large datasets). Disabled by default."
                      : "Enable source deletion first to configure this option."}
                  </span>
                </span>
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Advanced options</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Safety and integration settings.</p>
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
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={copyBucketSettings}
                        onChange={(event) => setCopyBucketSettings(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      <span className="space-y-0.5">
                        <span className="block font-semibold">Copy bucket settings</span>
                        <span aria-hidden="true" className="block text-[11px] text-slate-500 dark:text-slate-400">
                          Replicate bucket policies and settings.
                        </span>
                      </span>
                    </label>

                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={lockTargetWrites}
                        onChange={(event) => setLockTargetWrites(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      <span className="space-y-0.5">
                        <span className="block font-semibold">Lock target writes during migration</span>
                        <span aria-hidden="true" className="block text-[11px] text-slate-500 dark:text-slate-400">
                          Apply temporary write lock on destination buckets.
                        </span>
                      </span>
                    </label>

                    <label
                      className={`flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 ${
                        !canUseSameEndpointCopy ? "opacity-70" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={useSameEndpointCopy}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setUseSameEndpointCopy(checked);
                          if (checked) {
                            setAutoGrantSourceReadForCopy(true);
                          }
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0"
                        disabled={!canUseSameEndpointCopy}
                      />
                      <span className="space-y-0.5">
                        <span className="block font-semibold">Use x-amz-copy-source (same endpoint only)</span>
                        <span aria-hidden="true" className="block text-[11px] text-slate-500 dark:text-slate-400">
                          {canUseSameEndpointCopy
                            ? "Use server-side copy when source and destination share the same endpoint."
                            : "Available only when source and target use the same endpoint."}
                        </span>
                      </span>
                    </label>

                    <label
                      className={`flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 ${
                        !useSameEndpointCopy ? "opacity-70" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={autoGrantSourceReadForCopy}
                        onChange={(event) => setAutoGrantSourceReadForCopy(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                        disabled={!useSameEndpointCopy}
                      />
                      <span className="space-y-0.5">
                        <span className="block font-semibold">Auto-grant temporary source read for same-endpoint copy</span>
                        <span aria-hidden="true" className="block text-[11px] text-slate-500 dark:text-slate-400">
                          {useSameEndpointCopy
                            ? "Temporarily grant source read access during server-side copy."
                            : "Enable x-amz-copy-source first to modify this option."}
                        </span>
                      </span>
                    </label>
                  </div>

                  <label className="block space-y-1 ui-caption">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Webhook URL</span>
                    <input
                      type="url"
                      value={webhookUrl}
                      onChange={(event) => setWebhookUrl(event.target.value)}
                      placeholder="https://example.net/migration-events"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Summary</p>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {[
                  { label: "Source", value: sourceContext ? sourceContext.display_name : sourceContextId || "-" },
                  { label: "Target", value: targetContext ? targetContext.display_name : targetContextId || "-" },
                  { label: "Buckets", value: String(selectedBuckets.length) },
                  { label: "Mode", value: mode },
                  { label: "Copy settings", value: copyBucketSettings ? "yes" : "no" },
                  { label: "Lock target", value: lockTargetWrites ? "yes" : "no" },
                  { label: "Use x-amz-copy-source", value: useSameEndpointCopy ? "yes" : "no" },
                  { label: "Auto-grant source read", value: autoGrantSourceReadForCopy ? "yes" : "no" },
                  { label: "Delete source", value: deleteSource ? "yes" : "no" },
                  { label: "Strong integrity check", value: strongIntegrityCheck ? "yes" : "no" },
                  { label: "Webhook", value: webhookUrl.trim() || "not configured" },
                ].map((entry) => (
                  <div key={`wizard-summary-${entry.label}`} className="grid grid-cols-[140px_1fr] items-start gap-2">
                    <p className="ui-caption text-slate-500 dark:text-slate-400">{entry.label}</p>
                    <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{entry.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/70">
              <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Operations plan</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">Selected buckets and shared execution flow.</p>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Buckets</p>
                  {summaryBucketMappings.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {summaryBucketMappings.map((item) => (
                        <li key={`wizard-summary-operation-bucket-${item.sourceBucket}`} className="ui-caption text-slate-600 dark:text-slate-300">
                          {item.sourceBucket} {"->"} {item.targetBucket}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">No bucket selected.</p>
                  )}
                </div>
                <div>
                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Execution flow (once)</p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                    {summaryOperationSteps.map((stepText, stepIndex) => (
                      <li key={`wizard-summary-operation-flow-${stepIndex}`} className="ui-caption text-slate-600 dark:text-slate-300">
                        {stepText}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}

      </section>
    </div>
  );
}

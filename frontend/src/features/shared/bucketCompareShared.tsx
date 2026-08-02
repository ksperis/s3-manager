/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, useState, type ReactNode } from "react";
import { cx, type UiTone } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";

type ParsedRawMappingResult = {
  mapping: Map<string, string>;
  invalidLines: string[];
};

type BucketCompareMapping = {
  sourceBucket: string;
  targetBucket: string;
};

type BucketCompareMappingModel = {
  availableTargetBucketNames: string[];
  resolvedManualMapping: Map<string, string>;
  comparePlan: {
    mappings: BucketCompareMapping[];
    error: string | null;
  };
  missingByName: string[];
};

type CompareDiffTone = "added" | "removed";

type CompareDiffLine = {
  text: string;
  tone?: CompareDiffTone;
};

type CompareObjectDetailLike = {
  key: string;
  size?: number | null;
  etag?: string | null;
  last_modified?: string | null;
  storage_class?: string | null;
};

export type CompareVisibleKeysCopyFeedback = {
  tone: "success" | "danger";
  message: string;
};

type RunItemStatus = "pending" | "running" | "success" | "failed" | "cancelled";

type RunStatusItem = {
  status: RunItemStatus;
  result?: { has_differences?: boolean } | null;
};

export const BUCKET_COMPARE_CONFIG_FEATURE_OPTIONS = [
  { key: "versioning_status", label: "Versioning" },
  { key: "object_lock", label: "Object lock" },
  { key: "public_access_block", label: "Public access block" },
  { key: "lifecycle_rules", label: "Lifecycle rules" },
  { key: "cors_rules", label: "CORS rules" },
  { key: "bucket_policy", label: "Bucket policy" },
  { key: "access_logging", label: "Access logging" },
  { key: "tags", label: "Tags" },
] as const;

export const bucketCompareMappingTableContainerClass =
  "max-h-[240px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800";
export const bucketCompareMappingTableClass = "min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800";
export const bucketCompareMappingTableHeadClass = "bg-slate-100 dark:bg-slate-900/60";
export const bucketCompareMappingTableBodyClass = "divide-y divide-slate-200 dark:divide-slate-800";
export const bucketCompareMappingTableHeaderClass =
  "px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
export const bucketCompareMappingSourceCellClass = "px-3 py-2 font-semibold text-slate-900 dark:text-slate-100";
export const bucketCompareMappingTargetCellClass = "space-y-1 px-3 py-2";

export const extractCompareError = (err: unknown): string => {
  return extractApiError(err, "Bucket comparison failed.");
};

export const bucketComparisonCancelledMessage =
  "Comparison cancelled in this browser. The backend may still be finishing; verify the current state before retrying.";

export const runWithConcurrencySettled = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>,
  onSettled?: (result: PromiseSettledResult<R>, index: number) => void
): Promise<PromiseSettledResult<R>[]> => {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const notifySettled = (result: PromiseSettledResult<R>, index: number) => {
    try {
      onSettled?.(result, index);
    } catch (err) {
      console.error("Bucket compare settlement callback failed", err);
    }
  };
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      try {
        const value = await handler(items[index], index);
        const result: PromiseSettledResult<R> = { status: "fulfilled", value };
        results[index] = result;
        notifySettled(result, index);
      } catch (err) {
        const result: PromiseSettledResult<R> = { status: "rejected", reason: err };
        results[index] = result;
        notifySettled(result, index);
      }
    }
  });
  await Promise.all(workers);
  return results;
};

export const formatUnknown = (value: unknown) => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatCompareDateTime = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatCompareEtag = (value?: string | null): string => {
  const normalized = (value ?? "").trim().replace(/^"|"$/g, "");
  if (!normalized) return "-";
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized;
};

export const getObjectParentPrefix = (key: string): string => {
  const index = key.lastIndexOf("/");
  if (index < 0) return "";
  return key.slice(0, index + 1);
};

export const getVisibleCompareObjectKeys = (rows: CompareObjectDetailLike[]): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row) => {
    if (seen.has(row.key)) return;
    seen.add(row.key);
    keys.push(row.key);
  });
  return keys;
};

export const getCompareHiddenCount = (totalCount: number, visibleCount: number, hiddenCount?: number | null): number => {
  const reportedHiddenCount = typeof hiddenCount === "number" && Number.isFinite(hiddenCount) ? hiddenCount : totalCount - visibleCount;
  return Math.max(0, reportedHiddenCount);
};

export const formatCompareDisplayLimitMessage = (
  totalCount: number,
  visibleCount: number,
  hiddenCount?: number | null
): string | null => {
  const hidden = getCompareHiddenCount(totalCount, visibleCount, hiddenCount);
  if (hidden <= 0) return null;
  return `Showing ${visibleCount} of ${totalCount} objects. ${hidden} not displayed.`;
};

export const copyCompareObjectKeysToClipboard = async (keys: string[]): Promise<void> => {
  const clipboard =
    typeof window !== "undefined"
      ? window.navigator.clipboard
      : typeof navigator !== "undefined"
        ? navigator.clipboard
        : null;
  if (!clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }
  await clipboard.writeText(keys.join("\n"));
};

export const renderCompareObjectDetails = (
  rows: CompareObjectDetailLike[],
  options?: {
    buildBrowserHref?: (detail: CompareObjectDetailLike) => string | null;
    browserDisabledReason?: string | null;
    onExplore?: (href: string, detail: CompareObjectDetailLike, index: number) => void;
    renderAction?: (detail: CompareObjectDetailLike, index: number) => ReactNode;
  }
) => <CompareObjectDetailsList rows={rows} options={options} />;

type CompareObjectDetailsListProps = {
  rows: CompareObjectDetailLike[];
  options?: {
    buildBrowserHref?: (detail: CompareObjectDetailLike) => string | null;
    browserDisabledReason?: string | null;
    onExplore?: (href: string, detail: CompareObjectDetailLike, index: number) => void;
    renderAction?: (detail: CompareObjectDetailLike, index: number) => ReactNode;
  };
};

function CompareObjectDetailsList({ rows, options }: CompareObjectDetailsListProps) {
  const listId = useId();
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="px-1 py-1 ui-caption text-slate-500 dark:text-slate-400">
        (none)
      </div>
    );
  }

  return (
    <div className="divide-y divide-[color:var(--ui-border-soft)]">
      {rows.map((detail, index) => {
        const rowId = `${detail.key}-${index}`;
        const panelId = `${listId}-compare-object-metadata-${index}-${detail.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        const href = options?.buildBrowserHref?.(detail) ?? null;
        const action = options?.renderAction?.(detail, index) ?? null;
        const expanded = expandedRowId === rowId;

        return (
          <div key={rowId} className="relative">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => {
                setExpandedRowId((current) => (current === rowId ? null : rowId));
              }}
              className={cx(
                "flex w-full items-start gap-2 px-1 py-1.5 text-left ui-caption transition",
                "hover:bg-[var(--ui-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
                expanded && "bg-[var(--ui-hover)]"
              )}
            >
              <span className="min-w-0 flex-1 break-all font-mono text-[11px] font-semibold leading-relaxed text-slate-900 dark:text-slate-100">
                {detail.key}
              </span>
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-[11px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                i
              </span>
              <span className="sr-only">Show object metadata</span>
            </button>
            {expanded && (
              <div
                id={panelId}
                role="dialog"
                aria-label={`Object metadata for ${detail.key}`}
                className="absolute left-1 right-1 top-full z-30 mt-1 rounded-md bg-[var(--ui-surface)] p-2 text-[var(--ui-text)] shadow-lg ring-1 ring-[color:var(--ui-border)]"
              >
                <dl className="grid gap-x-3 gap-y-1 ui-caption sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Size</dt>
                    <dd className="text-slate-800 dark:text-slate-100">{formatBytes(detail.size)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Modified</dt>
                    <dd className="text-slate-800 dark:text-slate-100">{formatCompareDateTime(detail.last_modified)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">ETag</dt>
                    <dd className="break-all font-mono text-[11px] text-slate-800 dark:text-slate-100">
                      {formatCompareEtag(detail.etag)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Storage</dt>
                    <dd className="text-slate-800 dark:text-slate-100">{detail.storage_class || "-"}</dd>
                  </div>
                </dl>
                {(href || options?.browserDisabledReason || action) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[color:var(--ui-border-soft)] pt-2">
                    {options?.browserDisabledReason ? (
                      <button
                        type="button"
                        disabled
                        title={options.browserDisabledReason}
                        className="cursor-not-allowed rounded-md border border-slate-200 bg-slate-100 px-2 py-1 font-semibold text-slate-400 opacity-80 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500"
                      >
                        Explore
                      </button>
                    ) : href && options?.onExplore ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          options.onExplore?.(href, detail, index);
                        }}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700 hover:border-primary-300 hover:text-primary-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-200"
                      >
                        Explore
                      </button>
                    ) : href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700 hover:border-primary-300 hover:text-primary-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-200"
                      >
                        Explore
                      </a>
                    ) : null}
                    {action}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const diffToneClasses = (tone?: CompareDiffTone) => {
  if (tone === "added") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100";
  }
  if (tone === "removed") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100";
  }
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";
};

export const renderDiffLines = (lines: CompareDiffLine[]) => (
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

export const getRunStatusTone = (item: RunStatusItem): UiTone => {
  if (item.status === "failed") return "danger";
  if (item.status === "cancelled") return "warning";
  if (item.status === "success") {
    return item.result?.has_differences ? "warning" : "success";
  }
  return "neutral";
};

export const getRunStatusLabel = (item: RunStatusItem): string => {
  if (item.status === "pending") return "Pending";
  if (item.status === "running") return "Running";
  if (item.status === "failed") return "Failed";
  if (item.status === "cancelled") return "Cancelled";
  if (item.status === "success") {
    if (typeof item.result?.has_differences === "boolean") {
      return item.result.has_differences ? "Different" : "Identical";
    }
    return "Done";
  }
  return item.status;
};

export const getChangedTone = (changed: boolean): UiTone => (changed ? "warning" : "neutral");

export const parseRawMappingText = (value: string): ParsedRawMappingResult => {
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

export const buildBucketCompareMappingModel = ({
  targetSelected,
  targetKind,
  sourceBuckets,
  targetBuckets,
  sameTargetSelected,
  mappingMode,
  rawMapping,
  manualMapping,
}: {
  targetSelected: boolean;
  targetKind: "endpoint" | "context";
  sourceBuckets: string[];
  targetBuckets: string[];
  sameTargetSelected: boolean;
  mappingMode: "by_name" | "manual";
  rawMapping: ReadonlyMap<string, string>;
  manualMapping: Readonly<Record<string, string>>;
}): BucketCompareMappingModel => {
  const sourceBucketNames = new Set(sourceBuckets);
  const availableTargetBucketNames = sameTargetSelected
    ? targetBuckets.filter((name) => !sourceBucketNames.has(name))
    : targetBuckets;
  const availableTargetNames = new Set(availableTargetBucketNames);
  const resolvedManualMapping = new Map<string, string>();

  sourceBuckets.forEach((sourceBucket) => {
    const rawMapped = rawMapping.get(sourceBucket);
    if (rawMapped) {
      resolvedManualMapping.set(sourceBucket, rawMapped);
      return;
    }
    const uiMapped = (manualMapping[sourceBucket] ?? "").trim();
    if (uiMapped) {
      resolvedManualMapping.set(sourceBucket, uiMapped);
      return;
    }
    if (availableTargetNames.has(sourceBucket)) {
      resolvedManualMapping.set(sourceBucket, sourceBucket);
    }
  });

  let comparePlan: BucketCompareMappingModel["comparePlan"];
  if (!targetSelected) {
    comparePlan = { mappings: [], error: `Select a target ${targetKind}.` };
  } else if (sourceBuckets.length === 0) {
    comparePlan = { mappings: [], error: "Select source buckets first." };
  } else if (sameTargetSelected && mappingMode !== "manual") {
    comparePlan = {
      mappings: [],
      error: `Same-${targetKind} comparison requires manual mapping.`,
    };
  } else if (mappingMode === "by_name") {
    comparePlan = {
      mappings: sourceBuckets.map((bucket) => ({
        sourceBucket: bucket,
        targetBucket: bucket,
      })),
      error: null,
    };
  } else {
    const mappings: BucketCompareMapping[] = [];
    let hasInvalidTarget = false;
    sourceBuckets.forEach((sourceBucket) => {
      const targetBucket = (resolvedManualMapping.get(sourceBucket) ?? "").trim();
      if (!targetBucket) return;
      if (sameTargetSelected && sourceBucketNames.has(targetBucket)) {
        hasInvalidTarget = true;
        return;
      }
      mappings.push({ sourceBucket, targetBucket });
    });
    if (hasInvalidTarget) {
      comparePlan = {
        mappings: [],
        error: `When source and target ${targetKind} are the same, mapped target buckets must be outside the selected source set.`,
      };
    } else if (mappings.length === 0) {
      comparePlan = {
        mappings: [],
        error: "No mapping resolved. Add raw mapping lines, fill manual fields, or rely on 1:1 fallback when available.",
      };
    } else {
      comparePlan = { mappings, error: null };
    }
  }

  const targetBucketNames = new Set(targetBuckets);
  const missingByName =
    mappingMode === "by_name"
      ? sourceBuckets.filter((name) => !targetBucketNames.has(name))
      : [];

  return {
    availableTargetBucketNames,
    resolvedManualMapping,
    comparePlan,
    missingByName,
  };
};

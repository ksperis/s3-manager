/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import type { ReactNode } from "react";
import type { UiTone } from "../../components/ui/styles";
import { formatBytes } from "../../utils/format";

export type ParsedRawMappingResult = {
  mapping: Map<string, string>;
  invalidLines: string[];
};

export type CompareDiffTone = "added" | "removed";

export type CompareDiffLine = {
  text: string;
  tone?: CompareDiffTone;
};

export type CompareObjectDetailLike = {
  key: string;
  size?: number | null;
  etag?: string | null;
  last_modified?: string | null;
  storage_class?: string | null;
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

export const extractCompareError = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    return ((err.response?.data as { detail?: string } | undefined)?.detail || err.message || "Unexpected error");
  }
  return err instanceof Error ? err.message : "Unexpected error";
};

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

export const formatCompareDateTime = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const formatCompareEtag = (value?: string | null): string => {
  const normalized = (value ?? "").trim().replace(/^"|"$/g, "");
  if (!normalized) return "-";
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized;
};

export const getObjectParentPrefix = (key: string): string => {
  const index = key.lastIndexOf("/");
  if (index < 0) return "";
  return key.slice(0, index + 1);
};

export const renderCompareObjectDetails = (
  rows: CompareObjectDetailLike[],
  options?: {
    buildBrowserHref?: (detail: CompareObjectDetailLike) => string | null;
    browserDisabledReason?: string | null;
    onExplore?: (href: string, detail: CompareObjectDetailLike, index: number) => void;
    renderAction?: (detail: CompareObjectDetailLike, index: number) => ReactNode;
  }
) => {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200">
        (none)
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((detail, index) => {
        const href = options?.buildBrowserHref?.(detail) ?? null;
        const action = options?.renderAction?.(detail, index) ?? null;
        return (
          <div
            key={`${detail.key}-${index}`}
            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 ui-caption text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-100"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-all font-mono text-[11px] font-semibold leading-relaxed text-slate-900 dark:text-slate-100">
                  {detail.key}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
                  <span>{formatBytes(detail.size)}</span>
                  <span>Modified {formatCompareDateTime(detail.last_modified)}</span>
                  <span>ETag {formatCompareEtag(detail.etag)}</span>
                  <span>Storage {detail.storage_class || "-"}</span>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
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
            </div>
          </div>
        );
      })}
    </div>
  );
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

export const triggerDownload = (filename: string, content: string, mimeType: string) => {
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

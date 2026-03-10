/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import type { UiTone } from "../../components/ui/styles";

export type ParsedRawMappingResult = {
  mapping: Map<string, string>;
  invalidLines: string[];
};

export type CompareDiffTone = "added" | "removed";

export type CompareDiffLine = {
  text: string;
  tone?: CompareDiffTone;
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
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      try {
        const value = await handler(items[index], index);
        const result: PromiseSettledResult<R> = { status: "fulfilled", value };
        results[index] = result;
        onSettled?.(result, index);
      } catch (err) {
        const result: PromiseSettledResult<R> = { status: "rejected", reason: err };
        results[index] = result;
        onSettled?.(result, index);
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

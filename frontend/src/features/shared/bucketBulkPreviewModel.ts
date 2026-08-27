/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  BulkOperation,
  BulkPreviewItem,
  BulkPreviewLine,
} from "./bucketBulkOperationsModel";

type BulkPreviewSection = {
  key: string;
  label: string;
  before: BulkPreviewLine[];
  after: BulkPreviewLine[];
  changed: boolean;
  error?: string;
};

const sectionLabelForOperation = (operation: BulkOperation) => {
  switch (operation) {
    case "set_quota":
      return "Quota";
    case "add_public_access_block":
    case "remove_public_access_block":
      return "Block Public Access";
    case "enable_versioning":
    case "disable_versioning":
      return "Versioning";
    case "add_lifecycle":
    case "delete_lifecycle":
      return "Lifecycle";
    case "add_notifications":
    case "delete_notifications":
      return "Notifications";
    case "add_cors":
    case "delete_cors":
      return "CORS";
    case "add_policy":
    case "delete_policy":
      return "Bucket Policy";
    case "paste_configs":
      return "Overview";
    default:
      return "Preview";
  }
};

const splitPreviewLinesBySection = (
  lines: BulkPreviewLine[],
  fallbackLabel: string,
) => {
  const sections: { label: string; lines: BulkPreviewLine[] }[] = [];
  let currentLabel = fallbackLabel;
  let currentLines: BulkPreviewLine[] = [];
  const flush = () => {
    if (currentLines.length === 0) return;
    sections.push({ label: currentLabel, lines: currentLines });
    currentLines = [];
  };
  lines.forEach((line) => {
    const marker = line.text.trim().match(/^\[(.+)\]$/);
    if (marker) {
      flush();
      currentLabel = marker[1].trim() || fallbackLabel;
      return;
    }
    currentLines.push(line);
  });
  flush();
  if (sections.length === 0) {
    sections.push({ label: fallbackLabel, lines: [{ text: "-" }] });
  }
  return sections;
};

const serializePreviewLines = (lines: BulkPreviewLine[]) =>
  lines.map((line) => `${line.tone ?? "none"}|${line.text}`).join("\n");

const hasChangedPreviewTone = (lines: BulkPreviewLine[]) =>
  lines.some((line) => line.tone === "added" || line.tone === "removed");

export function summarizeBulkPreview(items: readonly BulkPreviewItem[]) {
  const errors = items.filter((item) => item.error).length;
  const changed = items.filter((item) => !item.error && item.changed).length;
  return { changed, unchanged: items.length - changed - errors, errors };
}

export function buildBulkPreviewSections(
  item: BulkPreviewItem,
  operation: BulkOperation,
): BulkPreviewSection[] {
  if (item.error) {
    return [
      {
        key: "error",
        label: "Error",
        before: [{ text: item.error, tone: "removed" }],
        after: [{ text: item.error, tone: "added" }],
        changed: true,
        error: item.error,
      },
    ];
  }

  const fallbackLabel = sectionLabelForOperation(operation);
  const beforeSections = splitPreviewLinesBySection(item.before, fallbackLabel);
  const afterSections = splitPreviewLinesBySection(item.after, fallbackLabel);
  const labels: string[] = [];
  const seen = new Set<string>();
  [...beforeSections, ...afterSections].forEach((section) => {
    const key = section.label.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    labels.push(section.label);
  });

  return labels.map((label, index) => {
    const normalized = label.trim().toLowerCase();
    const before =
      beforeSections.find((section) => section.label.trim().toLowerCase() === normalized)?.lines ?? [];
    const after =
      afterSections.find((section) => section.label.trim().toLowerCase() === normalized)?.lines ?? [];
    const changed =
      hasChangedPreviewTone(before) ||
      hasChangedPreviewTone(after) ||
      serializePreviewLines(before) !== serializePreviewLines(after);
    return {
      key: `${normalized || "section"}-${index}`,
      label,
      before: before.length > 0 ? before : [{ text: "-" }],
      after: after.length > 0 ? after : [{ text: "-" }],
      changed,
    };
  });
}

type BulkPreviewExportInput = {
  generatedAt: string;
  items: readonly BulkPreviewItem[];
  operation: BulkOperation;
  scope: { id: number | null; name: string | null };
  scopeKey: "endpoint" | "scope";
};

export function buildBulkPreviewExportPayload({
  generatedAt,
  items,
  operation,
  scope,
  scopeKey,
}: BulkPreviewExportInput) {
  const stats = summarizeBulkPreview(items);
  const itemsWithChanges = items.filter((item) => item.changed || Boolean(item.error));
  return {
    generated_at: generatedAt,
    [scopeKey]: scope,
    operation: operation || null,
    summary: {
      total: items.length,
      changed: stats.changed,
      unchanged: stats.unchanged,
      errors: stats.errors,
      exported_items: itemsWithChanges.length,
    },
    items: itemsWithChanges.map((item) => ({
      bucket: item.bucket,
      changed: item.changed,
      error: item.error ?? null,
      sections: buildBulkPreviewSections(item, operation)
        .filter((section) => section.changed || Boolean(section.error))
        .map((section) => ({
          label: section.label,
          changed: section.changed,
          error: section.error ?? null,
          before: section.before,
          after: section.after,
        })),
    })),
  };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminBucket } from "../../api/cephAdmin";
import { decodeStorageOpsBucketRef } from "../../api/storageOps";
import { formatBytes, formatNumber } from "../../utils/format";
import { normalizeQuotaLimit } from "./bucketBulkOperationsModel";
import type { ColumnId, SortField } from "./bucketOpsListState";

const BUCKET_UI_TAG_KEY_SEPARATOR = "\u001f";

export const isStatsSortField = (field: SortField) =>
  field === "used_bytes" || field === "object_count";

export const sanitizeExportFilenamePart = (value?: string | null) => {
  const normalized = (value ?? "").trim();
  const cleaned = normalized
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "buckets";
};

export const csvEscape = (value: string) =>
  `"${value.replace(/"/g, "\"\"")}"`;

export const normalizeVersioningStatus = (
  status?: string | null,
): boolean | null => {
  if (!status || !status.trim()) return false;
  const normalized = status.trim().toLowerCase();
  if (normalized === "enabled") return true;
  if (normalized === "suspended" || normalized === "disabled") return false;
  return null;
};

export const formatVersioningStatus = (status?: string | null) => {
  if (!status || !status.trim()) return "Disabled";
  const normalized = status.trim().toLowerCase();
  if (normalized === "enabled") return "Enabled";
  if (normalized === "suspended") return "Suspended";
  if (normalized === "disabled") return "Disabled";
  return status;
};

export const computeQuotaUsagePercent = (
  used?: number | null,
  quota?: number | null,
) => {
  const normalizedQuota = normalizeQuotaLimit(quota);
  if (normalizedQuota === null) return null;
  const safeUsed = Math.max(0, used ?? 0);
  const percent = (safeUsed / normalizedQuota) * 100;
  if (!Number.isFinite(percent)) return null;
  return Math.max(0, percent);
};

export const formatQuotaPercent = (value?: number | null) => {
  if (value === null || value === undefined) return null;
  if (value >= 100) return `${Math.round(value)}%`;
  if (value >= 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
};

export const formatOptionalBytes = (value?: number | null) =>
  value === null || value === undefined ? "-" : formatBytes(value);

export const formatOptionalCount = (value?: number | null) =>
  value === null || value === undefined ? "-" : formatNumber(value);

export const formatQuotaBytes = (value?: number | null) => {
  const quota = normalizeQuotaLimit(value);
  return quota !== null ? formatBytes(quota) : "-";
};

export const formatQuotaObjects = (value?: number | null) => {
  const quota = normalizeQuotaLimit(value);
  return quota !== null ? formatNumber(quota) : "-";
};

export const formatQuotaUsageValue = (
  used?: number | null,
  quota?: number | null,
) => {
  const percent = computeQuotaUsagePercent(used, quota);
  return percent !== null ? (formatQuotaPercent(percent) ?? "-") : "-";
};

export const formatOwnerSuspended = (value?: boolean | null) => {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "-";
};

export const isBucketQuotaConfigured = (bucket: CephAdminBucket) =>
  Boolean((bucket.quota_max_size_bytes ?? 0) > 0 || (bucket.quota_max_objects ?? 0) > 0);

export const formatBucketColumnDetail = (
  bucket: CephAdminBucket,
  detailKey: ColumnId,
): string => {
  const details = bucket.column_details as Record<string, unknown> | null | undefined;
  const raw = details?.[detailKey];
  if (raw === null || raw === undefined) return "-";
  if (Array.isArray(raw)) {
    if (raw.length === 0) return "None";
    const numericValues = raw
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
      .map((item) => Math.trunc(item))
      .sort((left, right) => left - right);
    if (numericValues.length === raw.length) {
      return Array.from(new Set(numericValues)).join(", ");
    }
    const textValues = raw
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    if (textValues.length === 0) return "None";
    return Array.from(new Set(textValues)).join(", ");
  }
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw === "number") return formatNumber(raw);
  if (typeof raw === "string") return raw.trim() || "-";
  return "-";
};

export const buildBucketUiTagKey = (
  bucketName: string,
  tenant?: string | null,
) => `${(tenant ?? "").trim()}${BUCKET_UI_TAG_KEY_SEPARATOR}${bucketName.trim()}`;

export const formatBucketNamesPreview = (names: string[], max = 8) => {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} (+${names.length - max} more)`;
};

export const getBucketDisplayName = (
  bucket: CephAdminBucket,
  useExplicitBucketName: boolean,
): string => {
  if (useExplicitBucketName) {
    const raw = (bucket as { bucket_name?: string | null }).bucket_name;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return bucket.name;
};

export const getStorageOpsContextId = (bucket: CephAdminBucket): string => {
  const raw = (bucket as { context_id?: string | null }).context_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return decodeStorageOpsBucketRef(bucket.name)?.contextId ?? "";
};

export const getStorageOpsBucketName = (bucket: CephAdminBucket): string => {
  const raw = (bucket as { bucket_name?: string | null }).bucket_name;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return decodeStorageOpsBucketRef(bucket.name)?.bucketName ?? bucket.name;
};

export const normalizeBucketName = (value: string) => value.trim().toLowerCase();

export const areStringMapEqual = (
  left: Record<string, string>,
  right: Record<string, string>,
) => {
  const leftKeys = Object.keys(left).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b));
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && (left[key] ?? "") === (right[key] ?? ""),
    )
  );
};

export const ownerFilterFromSearch = (search: string) => {
  if (!search) return null;
  const value = new URLSearchParams(search).get("owner")?.trim();
  return value || null;
};

export const getTagColors = (tag: string) => {
  const hue = Array.from(tag).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  ) % 360;
  return {
    background: `hsl(${hue} 70% 90% / 0.9)`,
    text: `hsl(${hue} 60% 30%)`,
    border: `hsl(${hue} 60% 70% / 0.7)`,
  };
};

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  BucketLoggingConfiguration,
  BucketObjectLockConfiguration,
  BucketPublicAccessBlock,
  BucketTag,
  BucketWebsiteConfiguration,
} from "../../../api/buckets";
import type { GraphicalReplicationRule } from "../bucketReplication";

export type BucketFeatureCardMode = "graphical" | "json" | "hybrid";
export type BucketFeatureVisualState = "neutral" | "configured" | "unsaved" | "disabled";

type JsonSignatureResult = {
  signature: string;
  valid: boolean;
};

type JsonNormalizer = (value: unknown) => unknown;

const INVALID_JSON_SIGNATURE_PREFIX = "__INVALID_JSON__";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeBucketJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeBucketJsonValue(entry));
  }
  if (isPlainObject(value)) {
    const sortedEntries = Object.entries(value)
      .map(([key, entry]) => [key, normalizeBucketJsonValue(entry)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

export function stableBucketJsonSignature(value: unknown): string {
  return JSON.stringify(normalizeBucketJsonValue(value));
}

export function jsonTextSignature(
  text: string,
  fallback: unknown,
  normalizer: JsonNormalizer = (value) => value
): JsonSignatureResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { signature: stableBucketJsonSignature(normalizer(fallback)), valid: true };
  }
  try {
    const parsed = JSON.parse(trimmed);
    return { signature: stableBucketJsonSignature(normalizer(parsed)), valid: true };
  } catch {
    return { signature: `${INVALID_JSON_SIGNATURE_PREFIX}:${trimmed}`, valid: false };
  }
}

export function resolveFeatureVisualState(params: {
  disabled?: boolean;
  configured: boolean;
  unsaved: boolean;
}): BucketFeatureVisualState {
  const { disabled = false, configured, unsaved } = params;
  if (disabled) return "disabled";
  if (unsaved) return "unsaved";
  if (configured) return "configured";
  return "neutral";
}

export function normalizePublicAccessDraft(config: BucketPublicAccessBlock | null | undefined): Record<string, boolean> {
  return {
    block_public_acls: Boolean(config?.block_public_acls),
    ignore_public_acls: Boolean(config?.ignore_public_acls),
    block_public_policy: Boolean(config?.block_public_policy),
    restrict_public_buckets: Boolean(config?.restrict_public_buckets),
  };
}

export function normalizeAccessLoggingDraft(config: BucketLoggingConfiguration | null | undefined): Record<string, unknown> {
  return {
    enabled: Boolean(config?.enabled),
    target_bucket: normalizeString(config?.target_bucket),
    target_prefix: normalizeString(config?.target_prefix),
  };
}

export function normalizeWebsiteDraft(config: BucketWebsiteConfiguration | null | undefined): Record<string, unknown> {
  const redirect = config?.redirect_all_requests_to;
  return {
    index_document: normalizeString(config?.index_document),
    error_document: normalizeString(config?.error_document),
    redirect_all_requests_to: redirect
      ? {
          host_name: normalizeString(redirect.host_name),
          protocol: normalizeString(redirect.protocol),
        }
      : null,
    routing_rules: Array.isArray(config?.routing_rules) ? config?.routing_rules : [],
  };
}

export function normalizeObjectLockDraft(config: BucketObjectLockConfiguration | null | undefined): Record<string, unknown> {
  return {
    enabled: config?.enabled ?? null,
    mode: normalizeString(config?.mode),
    days: config?.days ?? null,
    years: config?.years ?? null,
  };
}

export function normalizeQuotaDraft(maxSize: string, unit: "MiB" | "GiB" | "TiB", maxObjects: string): Record<string, unknown> {
  return {
    max_size: normalizeString(maxSize),
    max_size_unit: unit,
    max_objects: normalizeString(maxObjects),
  };
}

export function normalizeBucketTagsDraft(tags: BucketTag[]): BucketTag[] {
  return tags
    .map((tag) => ({
      key: normalizeString(tag.key),
      value: typeof tag.value === "string" ? tag.value.trim() : "",
    }))
    .sort((a, b) => {
      const byKey = a.key.localeCompare(b.key);
      if (byKey !== 0) return byKey;
      return a.value.localeCompare(b.value);
    });
}

export function normalizeAclDraft(preset: string, custom: string): Record<string, unknown> {
  return {
    preset: normalizeString(preset),
    custom: normalizeString(custom),
  };
}

export function normalizeNotificationConfiguration(configuration: unknown): Record<string, unknown> {
  if (!isPlainObject(configuration)) return {};
  const normalized: Record<string, unknown> = {};

  Object.entries(configuration).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        normalized[key] = value.map((entry) => normalizeBucketJsonValue(entry));
      }
      return;
    }

    if (isPlainObject(value)) {
      const normalizedObject = normalizeBucketJsonValue(value);
      if (isPlainObject(normalizedObject) && Object.keys(normalizedObject).length === 0) {
        return;
      }
      normalized[key] = normalizedObject;
      return;
    }

    if (value !== undefined && value !== null) {
      normalized[key] = value;
    }
  });

  return normalized;
}

export function normalizeLifecycleSimpleDraft(draft: {
  id: string;
  prefix: string;
  expirationDays: string;
  noncurrentDays: string;
  multipartDays: string;
  tagKey: string;
  tagValue: string;
  deleteExpiredMarkers: boolean;
  status: "Enabled" | "Disabled";
}): Record<string, unknown> {
  return {
    id: normalizeString(draft.id),
    prefix: normalizeString(draft.prefix),
    expiration_days: normalizeString(draft.expirationDays),
    noncurrent_days: normalizeString(draft.noncurrentDays),
    multipart_days: normalizeString(draft.multipartDays),
    tag_key: normalizeString(draft.tagKey),
    tag_value: normalizeString(draft.tagValue),
    delete_expired_markers: Boolean(draft.deleteExpiredMarkers),
    status: draft.status,
  };
}

export function isLifecycleSimpleDraftEmpty(draft: {
  id: string;
  prefix: string;
  expirationDays: string;
  noncurrentDays: string;
  multipartDays: string;
  tagKey: string;
  tagValue: string;
  deleteExpiredMarkers: boolean;
  status: "Enabled" | "Disabled";
}): boolean {
  const normalized = normalizeLifecycleSimpleDraft(draft);
  return (
    normalized.id === "" &&
    normalized.prefix === "" &&
    normalized.expiration_days === "" &&
    normalized.noncurrent_days === "" &&
    normalized.multipart_days === "" &&
    normalized.tag_key === "" &&
    normalized.tag_value === "" &&
    normalized.delete_expired_markers === false &&
    normalized.status === "Enabled"
  );
}

export function normalizeReplicationGraphicalDraft(role: string, rules: GraphicalReplicationRule[]): Record<string, unknown> {
  const normalizedRules = rules.map((rule) => ({
    id: normalizeString(rule.id),
    status: rule.status,
    priority: normalizeString(rule.priority),
    prefix: normalizeString(rule.prefix),
    destination_bucket: normalizeString(rule.destinationBucket),
    delete_marker_status: rule.deleteMarkerStatus,
  }));
  return {
    role: normalizeString(role),
    rules: normalizedRules,
  };
}

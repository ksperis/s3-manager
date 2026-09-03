/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  BucketLoggingConfiguration,
  BucketPublicAccessBlock,
} from "../../../api/bucketContracts";

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

function normalizeBucketJsonValue(value: unknown): unknown {
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

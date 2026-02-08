/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import Modal from "../../components/Modal";
import TableEmptyState from "../../components/TableEmptyState";
import SortableHeader from "../../components/SortableHeader";
import PaginationControls from "../../components/PaginationControls";
import PropertySummaryChip from "../../components/PropertySummaryChip";
import {
  CephAdminBucket,
  deleteCephAdminBucketCors,
  deleteCephAdminBucketLifecycle,
  deleteCephAdminBucketPolicy,
  getCephAdminBucketCors,
  getCephAdminBucketLifecycle,
  getCephAdminBucketPolicy,
  getCephAdminBucketProperties,
  getCephAdminBucketPublicAccessBlock,
  listCephAdminBuckets,
  putCephAdminBucketCors,
  putCephAdminBucketLifecycle,
  putCephAdminBucketPolicy,
  setCephAdminBucketVersioning,
  updateCephAdminBucketPublicAccessBlock,
  updateCephAdminBucketQuota,
} from "../../api/cephAdmin";
import { tableActionButtonClasses } from "../../components/tableActionClasses";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";

const extractError = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    return ((err.response?.data as { detail?: string } | undefined)?.detail || err.message || "Unexpected error");
  }
  return err instanceof Error ? err.message : "Unexpected error";
};

const formatBytes = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const decimals = size >= 10 || idx === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[idx]}`;
};

const formatNumber = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  return value.toLocaleString();
};

const BULK_CONCURRENCY_LIMIT = 6;

type BulkOperation =
  | ""
  | "set_quota"
  | "add_public_access_block"
  | "remove_public_access_block"
  | "enable_versioning"
  | "disable_versioning"
  | "add_lifecycle"
  | "delete_lifecycle"
  | "add_cors"
  | "delete_cors"
  | "add_policy"
  | "delete_policy";
type BulkPreviewTone = "added" | "removed";
type BulkPreviewLine = { text: string; tone?: BulkPreviewTone };
type BulkPreviewItem = {
  bucket: string;
  before: BulkPreviewLine[];
  after: BulkPreviewLine[];
  changed: boolean;
  error?: string;
};
type BulkApplyProgress = {
  completed: number;
  total: number;
  failed: number;
};

type QuotaSizeUnit = "MiB" | "GiB" | "TiB";

type ParsedQuotaInput = {
  applySize: boolean;
  applyObjects: boolean;
  maxSizeValue: number | null;
  maxSizeUnit: QuotaSizeUnit;
  maxSizeBytes: number | null;
  maxObjects: number | null;
};

const QUOTA_UNIT_TO_BYTES: Record<QuotaSizeUnit, number> = {
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

const normalizeQuotaLimit = (value?: number | null) => {
  if (value === null || value === undefined) return null;
  return value > 0 ? value : null;
};

const bytesToGiB = (value: number) => value / 1024 ** 3;

const hasConfiguredQuota = (quota: { maxSizeBytes: number | null; maxObjects: number | null }) =>
  quota.maxSizeBytes !== null || quota.maxObjects !== null;

const parseQuotaInput = (
  rawMaxSizeValue: string,
  maxSizeUnit: QuotaSizeUnit,
  rawMaxObjects: string,
  applySize: boolean,
  applyObjects: boolean
): { error: string } | ParsedQuotaInput => {
  if (!applySize && !applyObjects) {
    return { error: "Select at least one quota target (storage or objects)." };
  }
  const maxSizeText = rawMaxSizeValue.trim();
  const maxObjectsText = rawMaxObjects.trim();

  let maxSizeValue: number | null = null;
  let maxSizeBytes: number | null = null;
  if (applySize) {
    if (maxSizeText) {
      const parsed = Number(maxSizeText);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return { error: "Quota size must be a positive number or zero." };
      }
      maxSizeValue = parsed;
      maxSizeBytes = Math.floor(parsed * QUOTA_UNIT_TO_BYTES[maxSizeUnit]);
    }
  }

  let maxObjects: number | null = null;
  if (applyObjects) {
    if (maxObjectsText) {
      const parsed = Number(maxObjectsText);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        return { error: "Object quota must be a whole number (0 or greater)." };
      }
      maxObjects = parsed;
    }
  }

  return {
    applySize,
    applyObjects,
    maxSizeValue,
    maxSizeUnit,
    maxSizeBytes: normalizeQuotaLimit(maxSizeBytes),
    maxObjects: normalizeQuotaLimit(maxObjects),
  };
};

type PublicAccessBlockState = {
  block_public_acls: boolean;
  ignore_public_acls: boolean;
  block_public_policy: boolean;
  restrict_public_buckets: boolean;
};

type PublicAccessBlockOptionKey = keyof PublicAccessBlockState;

const PUBLIC_ACCESS_BLOCK_OPTIONS: Array<{ key: PublicAccessBlockOptionKey; label: string }> = [
  { key: "block_public_acls", label: "BlockPublicAcls" },
  { key: "ignore_public_acls", label: "IgnorePublicAcls" },
  { key: "block_public_policy", label: "BlockPublicPolicy" },
  { key: "restrict_public_buckets", label: "RestrictPublicBuckets" },
];

const normalizePublicAccessBlockState = (value?: Partial<PublicAccessBlockState> | null): PublicAccessBlockState => ({
  block_public_acls: Boolean(value?.block_public_acls),
  ignore_public_acls: Boolean(value?.ignore_public_acls),
  block_public_policy: Boolean(value?.block_public_policy),
  restrict_public_buckets: Boolean(value?.restrict_public_buckets),
});

const isPublicAccessBlockEquivalent = (a: PublicAccessBlockState, b: PublicAccessBlockState) =>
  a.block_public_acls === b.block_public_acls &&
  a.ignore_public_acls === b.ignore_public_acls &&
  a.block_public_policy === b.block_public_policy &&
  a.restrict_public_buckets === b.restrict_public_buckets;

const formatPublicAccessBlockState = (state: PublicAccessBlockState) => {
  const enabledCount = [
    state.block_public_acls,
    state.ignore_public_acls,
    state.block_public_policy,
    state.restrict_public_buckets,
  ].filter(Boolean).length;
  if (enabledCount === 4) return "Enabled";
  if (enabledCount === 0) return "Disabled";
  return `Partial (${enabledCount}/4)`;
};

const formatPublicAccessBlockFlag = (value: boolean) => (value ? "Blocked" : "Unblocked");

const applyPublicAccessBlockTargets = (
  current: PublicAccessBlockState,
  desiredEnabled: boolean,
  targets: PublicAccessBlockOptionKey[]
): PublicAccessBlockState => {
  const next: PublicAccessBlockState = { ...current };
  targets.forEach((key) => {
    next[key] = desiredEnabled;
  });
  return next;
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      results[index] = await handler(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const runWithConcurrencySettled = async <T, R>(
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

type LifecycleRuleTypeKey =
  | "expiration"
  | "delete_markers"
  | "noncurrent_expiration"
  | "abort_multipart"
  | "transition"
  | "noncurrent_transition";

type CorsRuleTypeKey =
  | "wildcard_origins"
  | "read_methods"
  | "write_methods"
  | "allow_credentials"
  | "expose_headers"
  | "max_age";

type PolicyRuleTypeKey =
  | "allow"
  | "deny"
  | "read_actions"
  | "write_actions"
  | "condition"
  | "public_principal";

const LIFECYCLE_TYPE_OPTIONS: Array<{ key: LifecycleRuleTypeKey; label: string }> = [
  { key: "expiration", label: "Expiration (current versions)" },
  { key: "delete_markers", label: "Expired object delete markers" },
  { key: "noncurrent_expiration", label: "Expiration (noncurrent versions)" },
  { key: "abort_multipart", label: "Abort incomplete multipart uploads" },
  { key: "transition", label: "Transitions" },
  { key: "noncurrent_transition", label: "Noncurrent transitions" },
];

const CORS_TYPE_OPTIONS: Array<{ key: CorsRuleTypeKey; label: string }> = [
  { key: "wildcard_origins", label: "Wildcard origins (*)" },
  { key: "read_methods", label: "Read methods (GET/HEAD)" },
  { key: "write_methods", label: "Write methods (PUT/POST/DELETE)" },
  { key: "allow_credentials", label: "Allow credentials" },
  { key: "expose_headers", label: "Expose headers" },
  { key: "max_age", label: "Max age" },
];

const POLICY_TYPE_OPTIONS: Array<{ key: PolicyRuleTypeKey; label: string }> = [
  { key: "allow", label: "Allow statements" },
  { key: "deny", label: "Deny statements" },
  { key: "read_actions", label: "Read actions (Get/List/Head)" },
  { key: "write_actions", label: "Write actions (Put/Delete)" },
  { key: "condition", label: "Has condition" },
  { key: "public_principal", label: "Public principal (*)" },
];

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
};

const formatLifecycleRule = (rule: Record<string, unknown>) => JSON.stringify(rule, null, 2);
const formatCorsRule = (rule: Record<string, unknown>) => JSON.stringify(rule, null, 2);
const formatPolicyRule = (rule: Record<string, unknown>) => JSON.stringify(rule, null, 2);

const getLifecycleRuleId = (rule: Record<string, unknown>) => {
  const rawId = rule.ID ?? (rule as { Id?: unknown }).Id ?? (rule as { id?: unknown }).id;
  if (typeof rawId === "string") {
    const trimmed = rawId.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof rawId === "number") {
    return String(rawId);
  }
  return null;
};

const getPolicyStatementSid = (statement: Record<string, unknown>) => {
  const rawSid = statement.Sid ?? (statement as { sid?: unknown }).sid;
  if (typeof rawSid === "string") {
    const trimmed = rawSid.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof rawSid === "number") {
    return String(rawSid);
  }
  return null;
};

type LifecycleChange = {
  action: "replace" | "add";
  index: number;
  before?: Record<string, unknown>;
  after: Record<string, unknown>;
};

const mergeLifecycleRules = (
  existingRules: Record<string, unknown>[],
  incomingRules: Record<string, unknown>[],
  options?: { onlyUpdateExisting?: boolean }
) => {
  const changes: LifecycleChange[] = [];
  const nextRules = [...existingRules];
  const serialize = (value: Record<string, unknown>) => stableStringify(value);

  incomingRules.forEach((incoming) => {
    const ruleId = getLifecycleRuleId(incoming);
    if (options?.onlyUpdateExisting) {
      if (!ruleId) return;
      const idx = nextRules.findIndex((existing) => getLifecycleRuleId(existing) === ruleId);
      if (idx < 0) return;
      if (serialize(nextRules[idx]) !== serialize(incoming)) {
        changes.push({ action: "replace", index: idx, before: nextRules[idx], after: incoming });
        nextRules[idx] = incoming;
      }
      return;
    }
    if (ruleId) {
      const idx = nextRules.findIndex((existing) => getLifecycleRuleId(existing) === ruleId);
      if (idx >= 0) {
        if (serialize(nextRules[idx]) !== serialize(incoming)) {
          changes.push({ action: "replace", index: idx, before: nextRules[idx], after: incoming });
          nextRules[idx] = incoming;
        }
        return;
      }
    }
    const existsByContent = nextRules.some((existing) => serialize(existing) === serialize(incoming));
    if (!existsByContent) {
      changes.push({ action: "add", index: nextRules.length, after: incoming });
      nextRules.push(incoming);
    }
  });

  return { nextRules, changes };
};

const parseLifecycleRules = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide lifecycle rules in JSON format." } as const;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      return { error: "Lifecycle rules must be a JSON object or array." } as const;
    }
    if (Array.isArray(parsed)) {
      const rules = parsed as unknown[];
      if (rules.length === 0) {
        return { error: "Provide at least one lifecycle rule." } as const;
      }
      const invalidIndex = rules.findIndex(
        (rule) => !rule || typeof rule !== "object" || Array.isArray(rule)
      );
      if (invalidIndex >= 0) {
        return { error: `Lifecycle rule at index ${invalidIndex} must be a JSON object.` } as const;
      }
      return { rules: rules as Record<string, unknown>[] } as const;
    }
    return { rules: [parsed as Record<string, unknown>] } as const;
  } catch {
    return { error: "Invalid JSON." } as const;
  }
};

const parseRuleIds = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return [] as string[];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : ""))
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[\n,]/g)
    .map((value) => value.trim())
    .filter(Boolean);
};

const getLifecycleRuleTypes = (rule: Record<string, unknown>): LifecycleRuleTypeKey[] => {
  const types: LifecycleRuleTypeKey[] = [];
  const expiration = rule.Expiration as Record<string, unknown> | undefined;
  if (expiration?.Days != null) types.push("expiration");
  if (expiration?.ExpiredObjectDeleteMarker) types.push("delete_markers");
  const noncurrentExp = rule.NoncurrentVersionExpiration as Record<string, unknown> | undefined;
  if (noncurrentExp?.NoncurrentDays != null) types.push("noncurrent_expiration");
  const multipart = rule.AbortIncompleteMultipartUpload as Record<string, unknown> | undefined;
  if (multipart?.DaysAfterInitiation != null) types.push("abort_multipart");
  const transitions = Array.isArray(rule.Transitions) ? rule.Transitions : [];
  if (transitions.length > 0) types.push("transition");
  const noncurrentTransitions = Array.isArray(rule.NoncurrentVersionTransitions) ? rule.NoncurrentVersionTransitions : [];
  if (noncurrentTransitions.length > 0) types.push("noncurrent_transition");
  return types;
};

const parseCorsRules = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide CORS rules in JSON format." } as const;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      return { error: "CORS rules must be a JSON object or array." } as const;
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { error: "Provide at least one CORS rule." } as const;
      }
      const invalidIndex = parsed.findIndex(
        (rule) => !rule || typeof rule !== "object" || Array.isArray(rule)
      );
      if (invalidIndex >= 0) {
        return { error: `CORS rule at index ${invalidIndex} must be a JSON object.` } as const;
      }
      return { rules: parsed as Record<string, unknown>[] } as const;
    }
    return { rules: [parsed as Record<string, unknown>] } as const;
  } catch {
    return { error: "Invalid JSON." } as const;
  }
};

const getCorsRuleKey = (rule: Record<string, unknown>) => {
  const origins = Array.isArray(rule.AllowedOrigins) ? rule.AllowedOrigins : [];
  const methods = Array.isArray(rule.AllowedMethods) ? rule.AllowedMethods : [];
  const normalizedOrigins = origins.map((value) => String(value).trim()).filter(Boolean).sort();
  const normalizedMethods = methods.map((value) => String(value).trim().toUpperCase()).filter(Boolean).sort();
  if (normalizedOrigins.length === 0 && normalizedMethods.length === 0) return null;
  return `${normalizedOrigins.join("|")}||${normalizedMethods.join("|")}`;
};

const getCorsRuleTypes = (rule: Record<string, unknown>): CorsRuleTypeKey[] => {
  const types: CorsRuleTypeKey[] = [];
  const origins = Array.isArray(rule.AllowedOrigins) ? rule.AllowedOrigins : [];
  const methods = Array.isArray(rule.AllowedMethods) ? rule.AllowedMethods : [];
  const normalizedMethods = methods.map((value) => String(value).trim().toUpperCase()).filter(Boolean);
  if (origins.some((origin) => String(origin).trim() === "*")) {
    types.push("wildcard_origins");
  }
  if (normalizedMethods.some((method) => method === "GET" || method === "HEAD")) {
    types.push("read_methods");
  }
  if (normalizedMethods.some((method) => method === "PUT" || method === "POST" || method === "DELETE")) {
    types.push("write_methods");
  }
  if ((rule as { AllowCredentials?: unknown }).AllowCredentials === true) {
    types.push("allow_credentials");
  }
  const exposeHeaders = Array.isArray(rule.ExposeHeaders) ? rule.ExposeHeaders : [];
  if (exposeHeaders.length > 0) {
    types.push("expose_headers");
  }
  if ((rule as { MaxAgeSeconds?: unknown }).MaxAgeSeconds != null) {
    types.push("max_age");
  }
  return types;
};

const parsePolicyStatements = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide a policy in JSON format." } as const;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      return { error: "Policy must be a JSON object or array." } as const;
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { error: "Provide at least one policy statement." } as const;
      }
      const invalidIndex = parsed.findIndex(
        (statement) => !statement || typeof statement !== "object" || Array.isArray(statement)
      );
      if (invalidIndex >= 0) {
        return { error: `Policy statement at index ${invalidIndex} must be a JSON object.` } as const;
      }
      return { policy: { Statement: parsed }, statements: parsed as Record<string, unknown>[] } as const;
    }
    const parsedObj = parsed as Record<string, unknown>;
    const rawStatements = parsedObj.Statement;
    if (Array.isArray(rawStatements)) {
      if (rawStatements.length === 0) {
        return { error: "Provide at least one policy statement." } as const;
      }
      const invalidIndex = rawStatements.findIndex(
        (statement) => !statement || typeof statement !== "object" || Array.isArray(statement)
      );
      if (invalidIndex >= 0) {
        return { error: `Policy statement at index ${invalidIndex} must be a JSON object.` } as const;
      }
      return { policy: parsedObj, statements: rawStatements as Record<string, unknown>[] } as const;
    }
    if (rawStatements && typeof rawStatements === "object") {
      return { policy: { ...parsedObj, Statement: [rawStatements] }, statements: [rawStatements as Record<string, unknown>] } as const;
    }
    return { policy: { Statement: [parsedObj] }, statements: [parsedObj] } as const;
  } catch {
    return { error: "Invalid JSON." } as const;
  }
};

const getPolicyStatementKey = (statement: Record<string, unknown>) => {
  const sid = getPolicyStatementSid(statement);
  if (sid) return `sid:${sid}`;
  const effect = statement.Effect ?? (statement as { effect?: unknown }).effect ?? "";
  const action = statement.Action ?? (statement as { action?: unknown }).action ?? "";
  const notAction = statement.NotAction ?? (statement as { notAction?: unknown }).notAction ?? "";
  const principal = statement.Principal ?? (statement as { principal?: unknown }).principal ?? "";
  const notPrincipal = statement.NotPrincipal ?? (statement as { notPrincipal?: unknown }).notPrincipal ?? "";
  const resource = statement.Resource ?? (statement as { resource?: unknown }).resource ?? "";
  const notResource = statement.NotResource ?? (statement as { notResource?: unknown }).notResource ?? "";
  const condition = statement.Condition ?? (statement as { condition?: unknown }).condition ?? "";
  return `key:${stableStringify({
    Effect: effect,
    Action: action,
    NotAction: notAction,
    Principal: principal,
    NotPrincipal: notPrincipal,
    Resource: resource,
    NotResource: notResource,
    Condition: condition,
  })}`;
};

const getPolicyStatementTypes = (statement: Record<string, unknown>): PolicyRuleTypeKey[] => {
  const types: PolicyRuleTypeKey[] = [];
  const effect = String(statement.Effect ?? "").toLowerCase();
  if (effect === "allow") types.push("allow");
  if (effect === "deny") types.push("deny");
  const condition = statement.Condition ?? (statement as { condition?: unknown }).condition;
  if (condition && typeof condition === "object" && Object.keys(condition as Record<string, unknown>).length > 0) {
    types.push("condition");
  }
  const principal = statement.Principal ?? (statement as { principal?: unknown }).principal;
  const isPublicPrincipal = (value: unknown): boolean => {
    if (value === "*") return true;
    if (!value || typeof value !== "object") return false;
    const aws = (value as { AWS?: unknown }).AWS;
    if (aws === "*") return true;
    if (Array.isArray(aws) && aws.some((item) => item === "*")) return true;
    return false;
  };
  if (isPublicPrincipal(principal)) {
    types.push("public_principal");
  }
  const actionsRaw = statement.Action ?? (statement as { action?: unknown }).action ?? [];
  const notActionsRaw = statement.NotAction ?? (statement as { notAction?: unknown }).notAction ?? [];
  const actions = Array.isArray(actionsRaw) ? actionsRaw : [actionsRaw];
  const notActions = Array.isArray(notActionsRaw) ? notActionsRaw : [notActionsRaw];
  const normalizedActions = [...actions, ...notActions].map((action) => String(action).trim()).filter(Boolean);
  const hasRead = normalizedActions.some((action) =>
    action === "*" || action.startsWith("s3:Get") || action.startsWith("s3:List") || action.startsWith("s3:Head")
  );
  const hasWrite = normalizedActions.some((action) =>
    action === "*" ||
    action.startsWith("s3:Put") ||
    action.startsWith("s3:Delete") ||
    action.startsWith("s3:Abort") ||
    action.startsWith("s3:Restore")
  );
  if (hasRead) types.push("read_actions");
  if (hasWrite) types.push("write_actions");
  return types;
};

type PolicyChange = {
  action: "replace" | "add";
  index: number;
  before?: Record<string, unknown>;
  after: Record<string, unknown>;
};

const mergePolicyStatements = (
  existingStatements: Record<string, unknown>[],
  incomingStatements: Record<string, unknown>[],
  options?: { onlyUpdateExisting?: boolean }
) => {
  const changes: PolicyChange[] = [];
  const nextStatements = [...existingStatements];
  const serialize = (value: Record<string, unknown>) => stableStringify(value);

  const findMatchIndex = (incoming: Record<string, unknown>) => {
    const sid = getPolicyStatementSid(incoming);
    if (sid) {
      const idx = nextStatements.findIndex((existing) => getPolicyStatementSid(existing) === sid);
      if (idx >= 0) return idx;
    }
    const key = getPolicyStatementKey(incoming);
    return nextStatements.findIndex((existing) => getPolicyStatementKey(existing) === key);
  };

  incomingStatements.forEach((incoming) => {
    const idx = findMatchIndex(incoming);
    if (options?.onlyUpdateExisting) {
      if (idx < 0) return;
      if (serialize(nextStatements[idx]) !== serialize(incoming)) {
        changes.push({ action: "replace", index: idx, before: nextStatements[idx], after: incoming });
        nextStatements[idx] = incoming;
      }
      return;
    }
    if (idx >= 0) {
      if (serialize(nextStatements[idx]) !== serialize(incoming)) {
        changes.push({ action: "replace", index: idx, before: nextStatements[idx], after: incoming });
        nextStatements[idx] = incoming;
      }
      return;
    }
    const existsByContent = nextStatements.some((existing) => serialize(existing) === serialize(incoming));
    if (!existsByContent) {
      changes.push({ action: "add", index: nextStatements.length, after: incoming });
      nextStatements.push(incoming);
    }
  });

  return { nextStatements, changes };
};

type CorsChange = {
  action: "replace" | "add";
  index: number;
  before?: Record<string, unknown>;
  after: Record<string, unknown>;
};

const mergeCorsRules = (
  existingRules: Record<string, unknown>[],
  incomingRules: Record<string, unknown>[],
  options?: { onlyUpdateExisting?: boolean }
) => {
  const changes: CorsChange[] = [];
  const nextRules = [...existingRules];
  const serialize = (value: Record<string, unknown>) => stableStringify(value);

  const findMatchIndex = (incoming: Record<string, unknown>) => {
    const ruleId = getLifecycleRuleId(incoming);
    if (ruleId) {
      const idx = nextRules.findIndex((existing) => getLifecycleRuleId(existing) === ruleId);
      if (idx >= 0) return idx;
    }
    const key = getCorsRuleKey(incoming);
    if (!key) return -1;
    return nextRules.findIndex((existing) => getCorsRuleKey(existing) === key);
  };

  incomingRules.forEach((incoming) => {
    const idx = findMatchIndex(incoming);
    if (options?.onlyUpdateExisting) {
      if (idx < 0) return;
      if (serialize(nextRules[idx]) !== serialize(incoming)) {
        changes.push({ action: "replace", index: idx, before: nextRules[idx], after: incoming });
        nextRules[idx] = incoming;
      }
      return;
    }

    if (idx >= 0) {
      if (serialize(nextRules[idx]) !== serialize(incoming)) {
        changes.push({ action: "replace", index: idx, before: nextRules[idx], after: incoming });
        nextRules[idx] = incoming;
      }
      return;
    }

    const existsByContent = nextRules.some((existing) => serialize(existing) === serialize(incoming));
    if (!existsByContent) {
      changes.push({ action: "add", index: nextRules.length, after: incoming });
      nextRules.push(incoming);
    }
  });

  return { nextRules, changes };
};

const normalizeVersioningStatus = (status?: string | null): boolean | null => {
  if (!status || !status.trim()) return false;
  const normalized = status.trim().toLowerCase();
  if (normalized === "enabled") return true;
  if (normalized === "suspended" || normalized === "disabled") return false;
  return null;
};

const formatVersioningStatus = (status?: string | null) => {
  if (!status || !status.trim()) return "Disabled";
  const normalized = status.trim().toLowerCase();
  if (normalized === "enabled") return "Enabled";
  if (normalized === "suspended") return "Suspended";
  if (normalized === "disabled") return "Disabled";
  return status;
};

function QuotaBar({ usedBytes, quotaBytes }: { usedBytes?: number | null; quotaBytes?: number | null }) {
  if (!quotaBytes || quotaBytes <= 0) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }
  const used = usedBytes ?? 0;
  const ratio = Math.min(100, Math.round((used / quotaBytes) * 100));
  const usedDisplay = formatBytes(used);
  const quotaDisplay = formatBytes(quotaBytes);
  return (
    <div className="flex items-center gap-2" title={`${usedDisplay} / ${quotaDisplay}`}>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full bg-primary-500" style={{ width: `${ratio}%` }} />
      </div>
      <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">{ratio}%</span>
    </div>
  );
}

function QuotaObjectsBar({ usedObjects, quotaObjects }: { usedObjects?: number | null; quotaObjects?: number | null }) {
  if (!quotaObjects || quotaObjects <= 0) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }
  const used = usedObjects ?? 0;
  const ratio = Math.min(100, Math.round((used / quotaObjects) * 100));
  return (
    <div className="flex items-center gap-2" title={`${used.toLocaleString()} / ${quotaObjects.toLocaleString()} objects`}>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full bg-primary-500" style={{ width: `${ratio}%` }} />
      </div>
      <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">{ratio}%</span>
    </div>
  );
}

type ColumnId =
  | "tenant"
  | "owner"
  | "owner_name"
  | "used_bytes"
  | "object_count"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "tags"
  | "ui_tags"
  | "versioning"
  | "object_lock"
  | "block_public_access"
  | "lifecycle_rules"
  | "static_website"
  | "bucket_policy"
  | "cors"
  | "access_logging"
  | "quota_status";

type SortField = "name" | "tenant" | "owner" | "used_bytes" | "object_count";
type FeatureKey =
  | "versioning"
  | "object_lock"
  | "block_public_access"
  | "lifecycle_rules"
  | "static_website"
  | "bucket_policy"
  | "cors"
  | "access_logging";
type FeatureFilterState = "any" | "enabled" | "disabled" | "suspended" | "disabled_or_suspended";

type AdvancedFilterState = {
  tenant: string;
  owner: string;
  minUsedBytes: string;
  maxUsedBytes: string;
  minObjects: string;
  maxObjects: string;
  minQuotaBytes: string;
  maxQuotaBytes: string;
  minQuotaObjects: string;
  maxQuotaObjects: string;
  features: Record<FeatureKey, FeatureFilterState>;
};

const defaultAdvancedFilter: AdvancedFilterState = {
  tenant: "",
  owner: "",
  minUsedBytes: "",
  maxUsedBytes: "",
  minObjects: "",
  maxObjects: "",
  minQuotaBytes: "",
  maxQuotaBytes: "",
  minQuotaObjects: "",
  maxQuotaObjects: "",
  features: {
    versioning: "any",
    object_lock: "any",
    block_public_access: "any",
    lifecycle_rules: "any",
    static_website: "any",
    bucket_policy: "any",
    cors: "any",
    access_logging: "any",
  },
};

const buildAdvancedFilterPayload = (
  basicFilter: string,
  advanced: AdvancedFilterState | null,
  taggedBuckets: string[] | null
) => {
  const trimmedFilter = basicFilter.trim();
  if (!advanced && !taggedBuckets) {
    return trimmedFilter ? trimmedFilter : undefined;
  }
  const rules: Array<Record<string, unknown>> = [];
  if (trimmedFilter) {
    rules.push({ field: "name", op: "contains", value: trimmedFilter });
  }
  if (advanced) {
    const tenant = advanced.tenant.trim();
    if (tenant) {
      rules.push({ field: "tenant", op: "contains", value: tenant });
    }
    const owner = advanced.owner.trim();
    if (owner) {
      rules.push({ field: "owner", op: "contains", value: owner });
    }
    const addNumericRule = (field: string, op: string, raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return;
      rules.push({ field, op, value });
    };
    addNumericRule("used_bytes", "gte", advanced.minUsedBytes);
    addNumericRule("used_bytes", "lte", advanced.maxUsedBytes);
    addNumericRule("object_count", "gte", advanced.minObjects);
    addNumericRule("object_count", "lte", advanced.maxObjects);
    addNumericRule("quota_max_size_bytes", "gte", advanced.minQuotaBytes);
    addNumericRule("quota_max_size_bytes", "lte", advanced.maxQuotaBytes);
    addNumericRule("quota_max_objects", "gte", advanced.minQuotaObjects);
    addNumericRule("quota_max_objects", "lte", advanced.maxQuotaObjects);

    (Object.keys(advanced.features) as FeatureKey[]).forEach((key) => {
      const state = advanced.features[key];
      if (state === "any") return;
      rules.push({ feature: key, state });
    });
  }

  if (taggedBuckets) {
    rules.push({ field: "name", op: "in", value: taggedBuckets });
  }

  if (rules.length === 0) {
    return trimmedFilter ? trimmedFilter : undefined;
  }
  return JSON.stringify({ match: "all", rules });
};

const hasAdvancedFilters = (advanced: AdvancedFilterState | null) => {
  if (!advanced) return false;
  if (advanced.tenant.trim() || advanced.owner.trim()) return true;
  if (
    advanced.minUsedBytes ||
    advanced.maxUsedBytes ||
    advanced.minObjects ||
    advanced.maxObjects ||
    advanced.minQuotaBytes ||
    advanced.maxQuotaBytes ||
    advanced.minQuotaObjects ||
    advanced.maxQuotaObjects
  ) {
    return true;
  }
  return Object.values(advanced.features).some((value) => value !== "any");
};

const COLUMNS_STORAGE_KEY = "ceph-admin.bucket_list.columns.v1";
const UI_TAGS_STORAGE_KEY = "ceph-admin.bucket_list.ui_tags.v1";
const BUCKETS_STATE_STORAGE_KEY = "ceph-admin.bucket_list.state.v1";
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_SORT: { field: SortField; direction: "asc" | "desc" } = { field: "name", direction: "asc" };
const defaultVisibleColumns: ColumnId[] = ["ui_tags", "used_bytes", "object_count"];

const loadVisibleColumns = (): ColumnId[] => {
  if (typeof window === "undefined") return defaultVisibleColumns;
  const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
  if (!raw) return defaultVisibleColumns;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultVisibleColumns;
    const allowed = new Set<ColumnId>([
      "tenant",
      "owner",
      "owner_name",
      "used_bytes",
      "object_count",
      "quota_max_size_bytes",
      "quota_max_objects",
      "tags",
      "ui_tags",
      "versioning",
      "object_lock",
      "block_public_access",
      "lifecycle_rules",
      "static_website",
      "bucket_policy",
      "cors",
      "access_logging",
      "quota_status",
    ]);
    const cleaned = parsed.filter((v) => typeof v === "string" && allowed.has(v as ColumnId)) as ColumnId[];
    return cleaned.length > 0 ? cleaned : defaultVisibleColumns;
  } catch {
    return defaultVisibleColumns;
  }
};

const persistVisibleColumns = (value: ColumnId[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(value));
};

type BucketUiTags = Record<string, string[]>;

const loadUiTags = (endpointId?: number | null): BucketUiTags => {
  if (typeof window === "undefined" || !endpointId) return {};
  const raw = localStorage.getItem(UI_TAGS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, BucketUiTags> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const tags = parsed[String(endpointId)] ?? {};
    const cleaned: BucketUiTags = {};
    Object.entries(tags).forEach(([key, value]) => {
      if (!Array.isArray(value)) return;
      const items = value.filter((item) => typeof item === "string" && item.trim()) as string[];
      if (items.length > 0) {
        cleaned[key] = items;
      }
    });
    return cleaned;
  } catch {
    return {};
  }
};

const persistUiTags = (endpointId: number | null | undefined, value: BucketUiTags) => {
  if (typeof window === "undefined" || !endpointId) return;
  const raw = localStorage.getItem(UI_TAGS_STORAGE_KEY);
  const store = raw ? (JSON.parse(raw) as Record<string, BucketUiTags>) : {};
  store[String(endpointId)] = value;
  localStorage.setItem(UI_TAGS_STORAGE_KEY, JSON.stringify(store));
};

type BucketListState = {
  filter: string;
  advancedApplied: AdvancedFilterState | null;
  tagFilters: string[];
  tagFilterMode: "any" | "all";
  selectedBuckets: string[];
  page: number;
  pageSize: number;
  sort: { field: SortField; direction: "asc" | "desc" };
};

const sanitizeStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];

const sanitizeAdvancedFilter = (value: unknown): AdvancedFilterState => {
  if (!value || typeof value !== "object") return defaultAdvancedFilter;
  const data = value as Partial<AdvancedFilterState>;
  const features: Record<FeatureKey, FeatureFilterState> = { ...defaultAdvancedFilter.features };
  if (data.features && typeof data.features === "object") {
    const rawFeatures = data.features as Record<string, unknown>;
    (Object.keys(features) as FeatureKey[]).forEach((key) => {
      const raw = rawFeatures[key];
      if (
        raw === "any" ||
        raw === "enabled" ||
        raw === "disabled" ||
        raw === "suspended" ||
        raw === "disabled_or_suspended"
      ) {
        features[key] = raw;
      }
    });
  }
  const safeString = (input: unknown) => (typeof input === "string" ? input : "");
  return {
    tenant: safeString(data.tenant),
    owner: safeString(data.owner),
    minUsedBytes: safeString(data.minUsedBytes),
    maxUsedBytes: safeString(data.maxUsedBytes),
    minObjects: safeString(data.minObjects),
    maxObjects: safeString(data.maxObjects),
    minQuotaBytes: safeString(data.minQuotaBytes),
    maxQuotaBytes: safeString(data.maxQuotaBytes),
    minQuotaObjects: safeString(data.minQuotaObjects),
    maxQuotaObjects: safeString(data.maxQuotaObjects),
    features,
  };
};

const sanitizeSort = (value: unknown): { field: SortField; direction: "asc" | "desc" } => {
  if (!value || typeof value !== "object") return DEFAULT_SORT;
  const data = value as { field?: unknown; direction?: unknown };
  const allowedFields: SortField[] = ["name", "tenant", "owner", "used_bytes", "object_count"];
  const field = allowedFields.includes(data.field as SortField) ? (data.field as SortField) : DEFAULT_SORT.field;
  const direction = data.direction === "desc" ? "desc" : "asc";
  return { field, direction };
};

const sanitizePage = (value: unknown, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized >= 1 ? normalized : fallback;
};

const sanitizePageSize = (value: unknown, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  if (normalized < 1) return fallback;
  if (normalized > 200) return 200;
  return normalized;
};

const loadBucketListState = (endpointId?: number | null): BucketListState | null => {
  if (typeof window === "undefined" || !endpointId) return null;
  const raw = localStorage.getItem(BUCKETS_STATE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const stored = parsed[String(endpointId)];
    if (!stored || typeof stored !== "object") return null;
    const data = stored as Record<string, unknown>;
    return {
      filter: typeof data.filter === "string" ? data.filter : "",
      advancedApplied: data.advancedApplied ? sanitizeAdvancedFilter(data.advancedApplied) : null,
      tagFilters: sanitizeStringArray(data.tagFilters),
      tagFilterMode: data.tagFilterMode === "all" ? "all" : "any",
      selectedBuckets: sanitizeStringArray(data.selectedBuckets),
      page: sanitizePage(data.page, 1),
      pageSize: sanitizePageSize(data.pageSize, DEFAULT_PAGE_SIZE),
      sort: sanitizeSort(data.sort),
    };
  } catch {
    return null;
  }
};

const persistBucketListState = (endpointId: number | null | undefined, value: BucketListState) => {
  if (typeof window === "undefined" || !endpointId) return;
  const raw = localStorage.getItem(BUCKETS_STATE_STORAGE_KEY);
  const store = raw ? (JSON.parse(raw) as Record<string, BucketListState>) : {};
  store[String(endpointId)] = value;
  localStorage.setItem(BUCKETS_STATE_STORAGE_KEY, JSON.stringify(store));
};

const parseUiTags = (value: string) => {
  const raw = value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  raw.forEach((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(tag);
  });
  return result;
};

const mergeUiTags = (existing: string[], incoming: string[]) => {
  const seen = new Set(existing.map((tag) => tag.toLowerCase()));
  const merged = [...existing];
  incoming.forEach((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(tag);
  });
  return merged;
};

const normalizeBucketName = (value: string) => value.trim().toLowerCase();

const getTagColors = (tag: string) => {
  const hue = Array.from(tag).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;
  return {
    background: `hsl(${hue} 70% 90% / 0.9)`,
    text: `hsl(${hue} 60% 30%)`,
    border: `hsl(${hue} 60% 70% / 0.7)`,
  };
};

export default function CephAdminBucketsPage() {
  const { selectedEndpointId, selectedEndpoint } = useCephAdminEndpoint();
  const [items, setItems] = useState<CephAdminBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(loadVisibleColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement | null>(null);
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedFilterState>(defaultAdvancedFilter);
  const [advancedApplied, setAdvancedApplied] = useState<AdvancedFilterState | null>(null);
  const [uiTags, setUiTags] = useState<BucketUiTags>(() => loadUiTags(selectedEndpointId));
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagFilterMode, setTagFilterMode] = useState<"any" | "all">("any");
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());
  const [orphanedTagBuckets, setOrphanedTagBuckets] = useState<string[]>([]);
  const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
  const [bulkOperation, setBulkOperation] = useState<BulkOperation>("");
  const [bulkQuotaSizeValue, setBulkQuotaSizeValue] = useState("");
  const [bulkQuotaSizeUnit, setBulkQuotaSizeUnit] = useState<QuotaSizeUnit>("GiB");
  const [bulkQuotaObjects, setBulkQuotaObjects] = useState("");
  const [bulkQuotaApplySize, setBulkQuotaApplySize] = useState(true);
  const [bulkQuotaApplyObjects, setBulkQuotaApplyObjects] = useState(true);
  const [bulkQuotaSkipConfigured, setBulkQuotaSkipConfigured] = useState(false);
  const [bulkPublicAccessBlockTargets, setBulkPublicAccessBlockTargets] = useState<
    Record<PublicAccessBlockOptionKey, boolean>
  >(() => ({
    block_public_acls: true,
    ignore_public_acls: true,
    block_public_policy: true,
    restrict_public_buckets: true,
  }));
  const [bulkLifecycleRuleText, setBulkLifecycleRuleText] = useState("");
  const [bulkLifecycleUpdateOnlyExisting, setBulkLifecycleUpdateOnlyExisting] = useState(false);
  const [bulkLifecycleDeleteIds, setBulkLifecycleDeleteIds] = useState("");
  const [bulkLifecycleDeleteTypes, setBulkLifecycleDeleteTypes] = useState<Record<LifecycleRuleTypeKey, boolean>>(() => {
    return LIFECYCLE_TYPE_OPTIONS.reduce(
      (acc, option) => ({ ...acc, [option.key]: false }),
      {} as Record<LifecycleRuleTypeKey, boolean>
    );
  });
  const [bulkCorsRuleText, setBulkCorsRuleText] = useState("");
  const [bulkCorsUpdateOnlyExisting, setBulkCorsUpdateOnlyExisting] = useState(false);
  const [bulkCorsDeleteIds, setBulkCorsDeleteIds] = useState("");
  const [bulkCorsDeleteTypes, setBulkCorsDeleteTypes] = useState<Record<CorsRuleTypeKey, boolean>>(() => {
    return CORS_TYPE_OPTIONS.reduce(
      (acc, option) => ({ ...acc, [option.key]: false }),
      {} as Record<CorsRuleTypeKey, boolean>
    );
  });
  const [bulkPolicyText, setBulkPolicyText] = useState("");
  const [bulkPolicyUpdateOnlyExisting, setBulkPolicyUpdateOnlyExisting] = useState(false);
  const [bulkPolicyDeleteIds, setBulkPolicyDeleteIds] = useState("");
  const [bulkPolicyDeleteTypes, setBulkPolicyDeleteTypes] = useState<Record<PolicyRuleTypeKey, boolean>>(() => {
    return POLICY_TYPE_OPTIONS.reduce(
      (acc, option) => ({ ...acc, [option.key]: false }),
      {} as Record<PolicyRuleTypeKey, boolean>
    );
  });
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewItem[]>([]);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkPreviewError, setBulkPreviewError] = useState<string | null>(null);
  const [bulkPreviewReady, setBulkPreviewReady] = useState(false);
  const [bulkApplyLoading, setBulkApplyLoading] = useState(false);
  const [bulkApplyError, setBulkApplyError] = useState<string | null>(null);
  const [bulkApplySummary, setBulkApplySummary] = useState<string | null>(null);
  const [bulkApplyProgress, setBulkApplyProgress] = useState<BulkApplyProgress | null>(null);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [tagTargets, setTagTargets] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagRemoveInput, setTagRemoveInput] = useState("");
  const [tagSuggestionBucket, setTagSuggestionBucket] = useState<string | null>(null);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const selectionHeaderRef = useRef<HTMLInputElement | null>(null);
  const restoreFilterRef = useRef<string | null>(null);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>(DEFAULT_SORT);
  const tagBucketNames = useMemo(
    () => Object.keys(uiTags).filter((bucketName) => (uiTags[bucketName] ?? []).length > 0),
    [uiTags]
  );
  const tagBucketSignature = useMemo(() => tagBucketNames.slice().sort().join("|"), [tagBucketNames]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setFilterValue(filter.trim());
      if (restoreFilterRef.current !== null) {
        const shouldSkipReset = restoreFilterRef.current === filter;
        restoreFilterRef.current = null;
        if (shouldSkipReset) {
          return;
        }
      }
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [filter]);

  useEffect(() => {
    persistVisibleColumns(visibleColumns);
  }, [visibleColumns]);

  useEffect(() => {
    setUiTags(loadUiTags(selectedEndpointId));
    const stored = loadBucketListState(selectedEndpointId);
    if (stored) {
      restoreFilterRef.current = stored.filter;
      setFilter(stored.filter);
      setFilterValue(stored.filter.trim());
      setAdvancedApplied(stored.advancedApplied);
      setAdvancedDraft(stored.advancedApplied ? stored.advancedApplied : defaultAdvancedFilter);
      setTagFilters(stored.tagFilters);
      setTagFilterMode(stored.tagFilterMode);
      setSelectedBuckets(new Set(stored.selectedBuckets));
      setPage(stored.page);
      setPageSize(stored.pageSize);
      setSort(stored.sort);
    } else {
      restoreFilterRef.current = null;
      setFilter("");
      setFilterValue("");
      setAdvancedApplied(null);
      setAdvancedDraft(defaultAdvancedFilter);
      setTagFilters([]);
      setTagFilterMode("any");
      setSelectedBuckets(new Set());
      setPage(1);
      setPageSize(DEFAULT_PAGE_SIZE);
      setSort(DEFAULT_SORT);
    }
  }, [selectedEndpointId]);

  useEffect(() => {
    persistUiTags(selectedEndpointId, uiTags);
  }, [uiTags, selectedEndpointId]);

  useEffect(() => {
    if (!selectedEndpointId) return;
    persistBucketListState(selectedEndpointId, {
      filter,
      advancedApplied,
      tagFilters,
      tagFilterMode,
      selectedBuckets: Array.from(selectedBuckets),
      page,
      pageSize,
      sort,
    });
  }, [selectedEndpointId, filter, advancedApplied, tagFilters, tagFilterMode, selectedBuckets, page, pageSize, sort]);

  useEffect(() => {
    if (!selectedEndpointId || tagBucketNames.length === 0) {
      setOrphanedTagBuckets([]);
      return;
    }
    let active = true;
    const loadOrphanedTags = async () => {
      try {
        const knownBuckets = new Set<string>();
        const chunkSize = 50;
        for (let start = 0; start < tagBucketNames.length; start += chunkSize) {
          const chunk = tagBucketNames.slice(start, start + chunkSize);
          const advancedFilter = JSON.stringify({
            match: "any",
            rules: [{ field: "name", op: "in", value: chunk }],
          });
          const response = await listCephAdminBuckets(selectedEndpointId, {
            page: 1,
            page_size: 200,
            advanced_filter: advancedFilter,
            with_stats: false,
          });
          if (!active) return;
          response.items.forEach((bucket) => knownBuckets.add(normalizeBucketName(bucket.name)));
        }
        if (!active) return;
        const missing = tagBucketNames
          .filter((bucketName) => !knownBuckets.has(normalizeBucketName(bucketName)))
          .sort((a, b) => a.localeCompare(b));
        setOrphanedTagBuckets(missing);
      } catch (err) {
        if (!active) return;
        console.warn("Unable to validate UI tags against bucket list.", err);
        setOrphanedTagBuckets([]);
      }
    };
    void loadOrphanedTags();
    return () => {
      active = false;
    };
  }, [selectedEndpointId, tagBucketSignature]);

  useEffect(() => {
    if (!showColumnPicker) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!columnPickerRef.current) return;
      if (!columnPickerRef.current.contains(target)) {
        setShowColumnPicker(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [showColumnPicker]);

  const includeParams = useMemo(() => {
    const include: string[] = [];
    if (visibleColumns.includes("owner_name")) include.push("owner_name");
    if (visibleColumns.includes("tags")) include.push("tags");
    const featureKeys: ColumnId[] = [
      "versioning",
      "object_lock",
      "block_public_access",
      "lifecycle_rules",
      "static_website",
      "bucket_policy",
      "cors",
      "access_logging",
    ];
    featureKeys.forEach((key) => {
      if (visibleColumns.includes(key)) include.push(key);
    });
    return include;
  }, [visibleColumns]);

  const advancedStatsRequired = useMemo(() => {
    if (!advancedApplied) return false;
    return Boolean(
      advancedApplied.minUsedBytes ||
        advancedApplied.maxUsedBytes ||
        advancedApplied.minObjects ||
        advancedApplied.maxObjects ||
        advancedApplied.minQuotaBytes ||
        advancedApplied.maxQuotaBytes ||
        advancedApplied.minQuotaObjects ||
        advancedApplied.maxQuotaObjects
    );
  }, [advancedApplied]);

  const requiresStats = useMemo(() => {
    if (advancedStatsRequired) return true;
    return (
      visibleColumns.includes("used_bytes") ||
      visibleColumns.includes("object_count") ||
      visibleColumns.includes("quota_max_size_bytes") ||
      visibleColumns.includes("quota_max_objects") ||
      visibleColumns.includes("quota_status")
    );
  }, [advancedStatsRequired, visibleColumns]);

  const availableUiTags = useMemo(() => {
    const tags = new Set<string>();
    Object.values(uiTags).forEach((bucketTags) => {
      bucketTags.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [uiTags]);

  const taggedBuckets = useMemo(() => {
    if (tagFilters.length === 0) return null;
    const normalizedFilters = tagFilters.map((tag) => tag.toLowerCase());
    const names = Object.entries(uiTags)
      .filter(([, tags]) => {
        const lowerTags = tags.map((tag) => tag.toLowerCase());
        if (tagFilterMode === "all") {
          return normalizedFilters.every((filterTag) => lowerTags.includes(filterTag));
        }
        return normalizedFilters.some((filterTag) => lowerTags.includes(filterTag));
      })
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b));
    return names;
  }, [tagFilters, tagFilterMode, uiTags]);

  const advancedFilterParam = useMemo(
    () => buildAdvancedFilterPayload("", advancedApplied, taggedBuckets),
    [advancedApplied, taggedBuckets]
  );

  const fetchBuckets = async () => {
    if (!selectedEndpointId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await listCephAdminBuckets(selectedEndpointId, {
        page,
        page_size: pageSize,
        filter: filterValue.trim() || undefined,
        advanced_filter: advancedFilterParam,
        sort_by: sort.field,
        sort_dir: sort.direction,
        include: includeParams.length > 0 ? includeParams : undefined,
        with_stats: requiresStats,
      });
      setItems(response.items ?? []);
      setTotal(response.total ?? 0);
    } catch (err) {
      console.error(err);
      setError(extractError(err));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedEndpointId) {
      setItems([]);
      setTotal(0);
      return;
    }
    void fetchBuckets();
  }, [
    selectedEndpointId,
    page,
    pageSize,
    filterValue,
    advancedFilterParam,
    sort.field,
    sort.direction,
    includeParams.join(","),
    requiresStats,
  ]);

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "asc" };
    });
    setPage(1);
  };

  const toggleColumn = (id: ColumnId) => {
    setVisibleColumns((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const resetColumns = () => {
    setVisibleColumns(defaultVisibleColumns);
  };

  const toggleSelection = (name: string) => {
    setSelectedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const setSelectionForPage = (checked: boolean) => {
    setSelectedBuckets((prev) => {
      const next = new Set(prev);
      items.forEach((bucket) => {
        if (checked) {
          next.add(bucket.name);
        } else {
          next.delete(bucket.name);
        }
      });
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedBuckets(new Set());
    setBulkOperation("");
    setBulkLifecycleRuleText("");
    setBulkLifecycleUpdateOnlyExisting(false);
    setBulkLifecycleDeleteIds("");
    setBulkLifecycleDeleteTypes(
      LIFECYCLE_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<LifecycleRuleTypeKey, boolean>
      )
    );
    setBulkCorsRuleText("");
    setBulkCorsUpdateOnlyExisting(false);
    setBulkCorsDeleteIds("");
    setBulkCorsDeleteTypes(
      CORS_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<CorsRuleTypeKey, boolean>
      )
    );
    setBulkPolicyText("");
    setBulkPolicyUpdateOnlyExisting(false);
    setBulkPolicyDeleteIds("");
    setBulkPolicyDeleteTypes(
      POLICY_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<PolicyRuleTypeKey, boolean>
      )
    );
    setBulkPreview([]);
    setBulkPreviewError(null);
    setBulkPreviewReady(false);
    setBulkApplyError(null);
    setBulkApplySummary(null);
  };

  const updateTagDraft = (bucketName: string, value: string) => {
    setTagDrafts((prev) => ({ ...prev, [bucketName]: value }));
  };

  const addTagFilter = (value: string) => {
    const parsed = parseUiTags(value);
    if (parsed.length === 0) return;
    setTagFilters((prev) => mergeUiTags(prev, parsed));
    setTagFilterInput("");
    setPage(1);
  };

  const removeTagFilter = (tag: string) => {
    setTagFilters((prev) => prev.filter((item) => item.toLowerCase() !== tag.toLowerCase()));
    setPage(1);
  };

  const addTagsForBucket = (bucketName: string, raw: string) => {
    const parsed = parseUiTags(raw);
    if (parsed.length === 0) return;
    setUiTags((prev) => {
      const existing = prev[bucketName] ?? [];
      const merged = mergeUiTags(existing, parsed);
      return { ...prev, [bucketName]: merged };
    });
  };

  const removeTagForBucket = (bucketName: string, tag: string) => {
    setUiTags((prev) => {
      const existing = prev[bucketName] ?? [];
      const next = existing.filter((item) => item.toLowerCase() !== tag.toLowerCase());
      const updated = { ...prev };
      if (next.length === 0) {
        delete updated[bucketName];
      } else {
        updated[bucketName] = next;
      }
      return updated;
    });
  };

  const selectedCount = selectedBuckets.size;
  const selectedOnPageCount = items.filter((bucket) => selectedBuckets.has(bucket.name)).length;
  const hiddenSelectedCount = Math.max(selectedCount - selectedOnPageCount, 0);
  const allSelectedOnPage = items.length > 0 && selectedOnPageCount === items.length;

  useEffect(() => {
    if (!selectionHeaderRef.current) return;
    selectionHeaderRef.current.indeterminate = selectedOnPageCount > 0 && !allSelectedOnPage;
  }, [selectedOnPageCount, allSelectedOnPage]);

  const openTagEditor = (targets: string[]) => {
    setTagTargets(targets);
    if (targets.length === 1) {
      const existing = uiTags[targets[0]] ?? [];
      setTagInput(existing.join(", "));
      setTagRemoveInput("");
    } else {
      setTagInput("");
      setTagRemoveInput("");
    }
    setShowTagEditor(true);
  };

  const applyTagsToTargets = () => {
    if (tagTargets.length === 0) return;
    const isMulti = tagTargets.length > 1;
    const parsedAdd = parseUiTags(tagInput);
    const parsedRemove = parseUiTags(tagRemoveInput);
    setUiTags((prev) => {
      const next = { ...prev };
      tagTargets.forEach((name) => {
        const existing = prev[name] ?? [];
        if (!isMulti) {
          if (parsedAdd.length === 0) {
            delete next[name];
          } else {
            next[name] = parsedAdd;
          }
          return;
        }
        let updated = existing;
        if (parsedAdd.length > 0) {
          updated = mergeUiTags(updated, parsedAdd);
        }
        if (parsedRemove.length > 0) {
          const removeSet = new Set(parsedRemove.map((tag) => tag.toLowerCase()));
          updated = updated.filter((tag) => !removeSet.has(tag.toLowerCase()));
        }
        if (updated.length === 0) {
          delete next[name];
        } else {
          next[name] = updated;
        }
      });
      return next;
    });
    setShowTagEditor(false);
    setTagTargets([]);
    setTagInput("");
    setTagRemoveInput("");
  };

  const selectedBucketList = useMemo(
    () => Array.from(selectedBuckets.values()).sort((a, b) => a.localeCompare(b)),
    [selectedBuckets]
  );

  const resetBulkPreview = () => {
    setBulkPreview([]);
    setBulkPreviewError(null);
    setBulkPreviewReady(false);
  };

  useEffect(() => {
    if (!showBulkUpdateModal) return;
    resetBulkPreview();
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress(null);
  }, [
    bulkOperation,
    bulkQuotaSizeValue,
    bulkQuotaSizeUnit,
    bulkQuotaObjects,
    bulkQuotaApplySize,
    bulkQuotaApplyObjects,
    bulkQuotaSkipConfigured,
    bulkPublicAccessBlockTargets,
    bulkLifecycleRuleText,
    bulkLifecycleUpdateOnlyExisting,
    bulkLifecycleDeleteIds,
    bulkLifecycleDeleteTypes,
    bulkCorsRuleText,
    bulkCorsUpdateOnlyExisting,
    bulkCorsDeleteIds,
    bulkCorsDeleteTypes,
    bulkPolicyText,
    bulkPolicyUpdateOnlyExisting,
    bulkPolicyDeleteIds,
    bulkPolicyDeleteTypes,
    selectedBuckets,
    showBulkUpdateModal,
  ]);

  const openBulkUpdateModal = () => {
    setShowBulkUpdateModal(true);
    setBulkOperation("");
    setBulkQuotaSizeValue("");
    setBulkQuotaSizeUnit("GiB");
    setBulkQuotaObjects("");
    setBulkQuotaApplySize(true);
    setBulkQuotaApplyObjects(true);
    setBulkQuotaSkipConfigured(false);
    setBulkPublicAccessBlockTargets({
      block_public_acls: true,
      ignore_public_acls: true,
      block_public_policy: true,
      restrict_public_buckets: true,
    });
    setBulkLifecycleRuleText("");
    setBulkLifecycleUpdateOnlyExisting(false);
    setBulkLifecycleDeleteIds("");
    setBulkLifecycleDeleteTypes(
      LIFECYCLE_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<LifecycleRuleTypeKey, boolean>
      )
    );
    setBulkCorsRuleText("");
    setBulkCorsUpdateOnlyExisting(false);
    setBulkCorsDeleteIds("");
    setBulkCorsDeleteTypes(
      CORS_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<CorsRuleTypeKey, boolean>
      )
    );
    setBulkPolicyText("");
    setBulkPolicyUpdateOnlyExisting(false);
    setBulkPolicyDeleteIds("");
    setBulkPolicyDeleteTypes(
      POLICY_TYPE_OPTIONS.reduce(
        (acc, option) => ({ ...acc, [option.key]: false }),
        {} as Record<PolicyRuleTypeKey, boolean>
      )
    );
    resetBulkPreview();
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress(null);
  };

  const closeBulkUpdateModal = () => {
    setShowBulkUpdateModal(false);
    resetBulkPreview();
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress(null);
  };

  const buildVersioningPreview = async (bucketName: string, desiredEnabled: boolean): Promise<BulkPreviewItem> => {
    const props = await getCephAdminBucketProperties(selectedEndpointId!, bucketName);
    const currentStatus = formatVersioningStatus(props.versioning_status);
    const currentEnabled = normalizeVersioningStatus(props.versioning_status);
    const changed = currentEnabled === null ? true : currentEnabled !== desiredEnabled;
    const afterStatus = changed ? (desiredEnabled ? "Enabled" : "Suspended") : currentStatus;
    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: currentStatus,
          tone: changed && currentEnabled !== null ? "removed" : undefined,
        },
      ],
      after: [
        {
          text: afterStatus,
          tone: changed ? "added" : undefined,
        },
      ],
    };
  };

  const buildPublicAccessBlockPreview = async (
    bucketName: string,
    desiredEnabled: boolean,
    targets: PublicAccessBlockOptionKey[]
  ): Promise<BulkPreviewItem> => {
    const current = normalizePublicAccessBlockState(await getCephAdminBucketPublicAccessBlock(selectedEndpointId!, bucketName));
    const target = applyPublicAccessBlockTargets(current, desiredEnabled, targets);
    const changed = !isPublicAccessBlockEquivalent(current, target);
    const beforeState = formatPublicAccessBlockState(current);
    const afterState = formatPublicAccessBlockState(target);
    return {
      bucket: bucketName,
      changed,
      before: [
        { text: `State: ${beforeState}`, tone: changed ? "removed" : undefined },
        ...PUBLIC_ACCESS_BLOCK_OPTIONS.map((option) => ({
          text: `${option.label}: ${formatPublicAccessBlockFlag(current[option.key])}`,
          tone: current[option.key] !== target[option.key] ? "removed" : undefined,
        })),
      ],
      after: [
        { text: `State: ${afterState}`, tone: changed ? "added" : undefined },
        ...PUBLIC_ACCESS_BLOCK_OPTIONS.map((option) => ({
          text: `${option.label}: ${formatPublicAccessBlockFlag(target[option.key])}`,
          tone: current[option.key] !== target[option.key] ? "added" : undefined,
        })),
      ],
    };
  };

  const fetchBucketQuota = async (bucketName: string) => {
    const advancedFilter = JSON.stringify({
      match: "all",
      rules: [{ field: "name", op: "in", value: [bucketName] }],
    });
    const response = await listCephAdminBuckets(selectedEndpointId!, {
      page: 1,
      page_size: 5,
      advanced_filter: advancedFilter,
      with_stats: true,
    });
    const match =
      response.items.find((item) => normalizeBucketName(item.name) === normalizeBucketName(bucketName)) ??
      response.items[0] ??
      null;
    return {
      maxSizeBytes: normalizeQuotaLimit(match?.quota_max_size_bytes),
      maxObjects: normalizeQuotaLimit(match?.quota_max_objects),
    };
  };

  const buildQuotaPreview = async (
    bucketName: string,
    payload: ParsedQuotaInput,
    skipConfigured: boolean
  ): Promise<BulkPreviewItem> => {
    const currentQuota = await fetchBucketQuota(bucketName);
    if (skipConfigured && hasConfiguredQuota(currentQuota)) {
      return {
        bucket: bucketName,
        changed: false,
        before: [
          { text: `Size: ${currentQuota.maxSizeBytes != null ? formatBytes(currentQuota.maxSizeBytes) : "Not set"}` },
          { text: `Objects: ${currentQuota.maxObjects != null ? formatNumber(currentQuota.maxObjects) : "Not set"}` },
        ],
        after: [
          { text: `Size: ${currentQuota.maxSizeBytes != null ? formatBytes(currentQuota.maxSizeBytes) : "Not set"}` },
          { text: `Objects: ${currentQuota.maxObjects != null ? formatNumber(currentQuota.maxObjects) : "Not set"}` },
          { text: "(existing quota preserved)" },
        ],
      };
    }
    const beforeSize = currentQuota.maxSizeBytes;
    const beforeObjects = currentQuota.maxObjects;
    const afterSize = payload.applySize ? payload.maxSizeBytes : currentQuota.maxSizeBytes;
    const afterObjects = payload.applyObjects ? payload.maxObjects : currentQuota.maxObjects;
    const sizeChanged = beforeSize !== afterSize;
    const objectsChanged = beforeObjects !== afterObjects;
    const changed = sizeChanged || objectsChanged;

    return {
      bucket: bucketName,
      changed,
      before: [
        {
          text: `Size: ${beforeSize != null ? formatBytes(beforeSize) : "Not set"}`,
          tone: sizeChanged ? "removed" : undefined,
        },
        {
          text: `Objects: ${beforeObjects != null ? formatNumber(beforeObjects) : "Not set"}`,
          tone: objectsChanged ? "removed" : undefined,
        },
      ],
      after: [
        {
          text: `Size: ${afterSize != null ? formatBytes(afterSize) : "Not set"}`,
          tone: sizeChanged ? "added" : undefined,
        },
        {
          text: `Objects: ${afterObjects != null ? formatNumber(afterObjects) : "Not set"}`,
          tone: objectsChanged ? "added" : undefined,
        },
      ],
    };
  };

  const buildLifecyclePreview = async (
    bucketName: string,
    rules: Record<string, unknown>[]
  ): Promise<BulkPreviewItem> => {
    const lifecycle = await getCephAdminBucketLifecycle(selectedEndpointId!, bucketName);
    const existingRules = lifecycle.rules ?? [];
    const { nextRules, changes } = mergeLifecycleRules(
      existingRules as Record<string, unknown>[],
      rules,
      { onlyUpdateExisting: bulkLifecycleUpdateOnlyExisting }
    );
    const changed = changes.length > 0;
    const beforeLines: BulkPreviewLine[] =
      existingRules.length === 0
        ? [{ text: "(no rules)" }]
        : existingRules.map((existing, idx) => {
            const isReplaced = changes.some((change) => change.action === "replace" && change.index === idx);
            return {
              text: formatLifecycleRule(existing as Record<string, unknown>),
              tone: isReplaced ? "removed" : undefined,
            };
          });
    const afterLines: BulkPreviewLine[] =
      nextRules.length === 0
        ? [{ text: "(no rules)" }]
        : nextRules.map((existing, idx) => {
            const isAdded = changes.some(
              (change) => (change.action === "replace" || change.action === "add") && change.index === idx
            );
            return {
              text: formatLifecycleRule(existing as Record<string, unknown>),
              tone: isAdded ? "added" : undefined,
            };
          });
    return {
      bucket: bucketName,
      changed,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildLifecycleDeletePreview = async (
    bucketName: string,
    deleteIds: Set<string>,
    deleteTypes: Set<LifecycleRuleTypeKey>
  ): Promise<BulkPreviewItem> => {
    const lifecycle = await getCephAdminBucketLifecycle(selectedEndpointId!, bucketName);
    const existingRules = lifecycle.rules ?? [];
    const shouldDeleteRule = (rule: Record<string, unknown>) => {
      const ruleId = getLifecycleRuleId(rule);
      if (ruleId && deleteIds.has(ruleId)) return true;
      if (deleteTypes.size === 0) return false;
      const ruleTypes = getLifecycleRuleTypes(rule);
      return ruleTypes.some((type) => deleteTypes.has(type));
    };
    const removedIndices = new Set<number>();
    existingRules.forEach((rule, idx) => {
      if (shouldDeleteRule(rule as Record<string, unknown>)) {
        removedIndices.add(idx);
      }
    });
    const nextRules = existingRules.filter((_, idx) => !removedIndices.has(idx));
    const beforeLines: BulkPreviewLine[] =
      existingRules.length === 0
        ? [{ text: "(no rules)" }]
        : existingRules.map((existing, idx) => ({
            text: formatLifecycleRule(existing as Record<string, unknown>),
            tone: removedIndices.has(idx) ? "removed" : undefined,
          }));
    const afterLines: BulkPreviewLine[] =
      nextRules.length === 0
        ? [{ text: "(no rules)" }]
        : nextRules.map((existing) => ({ text: formatLifecycleRule(existing as Record<string, unknown>) }));
    return {
      bucket: bucketName,
      changed: removedIndices.size > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildCorsPreview = async (
    bucketName: string,
    rules: Record<string, unknown>[]
  ): Promise<BulkPreviewItem> => {
    const cors = await getCephAdminBucketCors(selectedEndpointId!, bucketName);
    const existingRules = cors.rules ?? [];
    const { nextRules, changes } = mergeCorsRules(
      existingRules as Record<string, unknown>[],
      rules,
      { onlyUpdateExisting: bulkCorsUpdateOnlyExisting }
    );
    const beforeLines: BulkPreviewLine[] =
      existingRules.length === 0
        ? [{ text: "(no rules)" }]
        : existingRules.map((existing, idx) => {
            const isReplaced = changes.some((change) => change.action === "replace" && change.index === idx);
            return {
              text: formatCorsRule(existing as Record<string, unknown>),
              tone: isReplaced ? "removed" : undefined,
            };
          });
    const afterLines: BulkPreviewLine[] =
      nextRules.length === 0
        ? [{ text: "(no rules)" }]
        : nextRules.map((existing, idx) => {
            const isAdded = changes.some(
              (change) => (change.action === "replace" || change.action === "add") && change.index === idx
            );
            return {
              text: formatCorsRule(existing as Record<string, unknown>),
              tone: isAdded ? "added" : undefined,
            };
          });
    return {
      bucket: bucketName,
      changed: changes.length > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildCorsDeletePreview = async (
    bucketName: string,
    deleteIds: Set<string>,
    deleteTypes: Set<CorsRuleTypeKey>
  ): Promise<BulkPreviewItem> => {
    const cors = await getCephAdminBucketCors(selectedEndpointId!, bucketName);
    const existingRules = cors.rules ?? [];
    const shouldDeleteRule = (rule: Record<string, unknown>) => {
      const ruleId = getLifecycleRuleId(rule);
      if (ruleId && deleteIds.has(ruleId)) return true;
      if (deleteTypes.size === 0) return false;
      const ruleTypes = getCorsRuleTypes(rule);
      return ruleTypes.some((type) => deleteTypes.has(type));
    };
    const removedIndices = new Set<number>();
    existingRules.forEach((rule, idx) => {
      if (shouldDeleteRule(rule as Record<string, unknown>)) {
        removedIndices.add(idx);
      }
    });
    const nextRules = existingRules.filter((_, idx) => !removedIndices.has(idx));
    const beforeLines: BulkPreviewLine[] =
      existingRules.length === 0
        ? [{ text: "(no rules)" }]
        : existingRules.map((existing, idx) => ({
            text: formatCorsRule(existing as Record<string, unknown>),
            tone: removedIndices.has(idx) ? "removed" : undefined,
          }));
    const afterLines: BulkPreviewLine[] =
      nextRules.length === 0
        ? [{ text: "(no rules)" }]
        : nextRules.map((existing) => ({ text: formatCorsRule(existing as Record<string, unknown>) }));
    return {
      bucket: bucketName,
      changed: removedIndices.size > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildPolicyPreview = async (
    bucketName: string,
    statements: Record<string, unknown>[]
  ): Promise<BulkPreviewItem> => {
    const policy = await getCephAdminBucketPolicy(selectedEndpointId!, bucketName);
    const existingPolicy = policy.policy ?? {};
    const existingStatements = Array.isArray((existingPolicy as Record<string, unknown>).Statement)
      ? ((existingPolicy as Record<string, unknown>).Statement as Record<string, unknown>[])
      : [];
    const { nextStatements, changes } = mergePolicyStatements(
      existingStatements,
      statements,
      { onlyUpdateExisting: bulkPolicyUpdateOnlyExisting }
    );
    const beforeLines: BulkPreviewLine[] =
      existingStatements.length === 0
        ? [{ text: "(no statements)" }]
        : existingStatements.map((statement, idx) => {
            const isReplaced = changes.some((change) => change.action === "replace" && change.index === idx);
            return {
              text: formatPolicyRule(statement as Record<string, unknown>),
              tone: isReplaced ? "removed" : undefined,
            };
          });
    const afterLines: BulkPreviewLine[] =
      nextStatements.length === 0
        ? [{ text: "(no statements)" }]
        : nextStatements.map((statement, idx) => {
            const isAdded = changes.some(
              (change) => (change.action === "replace" || change.action === "add") && change.index === idx
            );
            return {
              text: formatPolicyRule(statement as Record<string, unknown>),
              tone: isAdded ? "added" : undefined,
            };
          });
    return {
      bucket: bucketName,
      changed: changes.length > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const buildPolicyDeletePreview = async (
    bucketName: string,
    deleteIds: Set<string>,
    deleteTypes: Set<PolicyRuleTypeKey>
  ): Promise<BulkPreviewItem> => {
    const policy = await getCephAdminBucketPolicy(selectedEndpointId!, bucketName);
    const existingPolicy = policy.policy ?? {};
    const existingStatements = Array.isArray((existingPolicy as Record<string, unknown>).Statement)
      ? ((existingPolicy as Record<string, unknown>).Statement as Record<string, unknown>[])
      : [];
    const shouldDeleteStatement = (statement: Record<string, unknown>) => {
      const sid = getPolicyStatementSid(statement);
      if (sid && deleteIds.has(sid)) return true;
      if (deleteTypes.size === 0) return false;
      const types = getPolicyStatementTypes(statement);
      return types.some((type) => deleteTypes.has(type));
    };
    const removedIndices = new Set<number>();
    existingStatements.forEach((statement, idx) => {
      if (shouldDeleteStatement(statement as Record<string, unknown>)) {
        removedIndices.add(idx);
      }
    });
    const nextStatements = existingStatements.filter((_, idx) => !removedIndices.has(idx));
    const beforeLines: BulkPreviewLine[] =
      existingStatements.length === 0
        ? [{ text: "(no statements)" }]
        : existingStatements.map((statement, idx) => ({
            text: formatPolicyRule(statement as Record<string, unknown>),
            tone: removedIndices.has(idx) ? "removed" : undefined,
          }));
    const afterLines: BulkPreviewLine[] =
      nextStatements.length === 0
        ? [{ text: "(no statements)" }]
        : nextStatements.map((statement) => ({ text: formatPolicyRule(statement as Record<string, unknown>) }));
    return {
      bucket: bucketName,
      changed: removedIndices.size > 0,
      before: beforeLines,
      after: afterLines,
    };
  };

  const runBulkPreview = async () => {
    if (!selectedEndpointId || selectedBucketList.length === 0) return;
    if (!bulkOperation) {
      setBulkPreviewError("Select an operation first.");
      return;
    }
    let parsedQuota: ParsedQuotaInput | null = null;
    let parsedRules: Record<string, unknown>[] | null = null;
    let parsedCorsRules: Record<string, unknown>[] | null = null;
    let parsedPolicyStatements: Record<string, unknown>[] | null = null;
    let parsedPolicy: Record<string, unknown> | null = null;
    let deleteIds: Set<string> | null = null;
    let deleteTypes: Set<LifecycleRuleTypeKey> | null = null;
    let deleteCorsIds: Set<string> | null = null;
    let deleteCorsTypes: Set<CorsRuleTypeKey> | null = null;
    let deletePolicyIds: Set<string> | null = null;
    let deletePolicyTypes: Set<PolicyRuleTypeKey> | null = null;
    let publicAccessBlockTargets: PublicAccessBlockOptionKey[] | null = null;
    if (bulkOperation === "set_quota") {
      const parsed = parseQuotaInput(
        bulkQuotaSizeValue,
        bulkQuotaSizeUnit,
        bulkQuotaObjects,
        bulkQuotaApplySize,
        bulkQuotaApplyObjects
      );
      if ("error" in parsed) {
        setBulkPreviewError(parsed.error);
        return;
      }
      parsedQuota = parsed;
    }
    if (bulkOperation === "add_lifecycle") {
      const parsed = parseLifecycleRules(bulkLifecycleRuleText);
      if ("error" in parsed) {
        setBulkPreviewError(parsed.error);
        return;
      }
      if (bulkLifecycleUpdateOnlyExisting && parsed.rules.every((rule) => !getLifecycleRuleId(rule))) {
        setBulkPreviewError("Provide rule IDs when 'only update existing' is enabled.");
        return;
      }
      parsedRules = parsed.rules;
    }
    if (bulkOperation === "add_cors") {
      const parsed = parseCorsRules(bulkCorsRuleText);
      if ("error" in parsed) {
        setBulkPreviewError(parsed.error);
        return;
      }
      if (
        bulkCorsUpdateOnlyExisting &&
        parsed.rules.every((rule) => !getLifecycleRuleId(rule) && !getCorsRuleKey(rule))
      ) {
        setBulkPreviewError("Provide rule IDs or matching origins/methods when 'only update existing' is enabled.");
        return;
      }
      parsedCorsRules = parsed.rules;
    }
    if (bulkOperation === "add_policy") {
      const parsed = parsePolicyStatements(bulkPolicyText);
      if ("error" in parsed) {
        setBulkPreviewError(parsed.error);
        return;
      }
      parsedPolicyStatements = parsed.statements;
    }
    if (bulkOperation === "delete_lifecycle") {
      const parsedIds = parseRuleIds(bulkLifecycleDeleteIds);
      const parsedTypes = LIFECYCLE_TYPE_OPTIONS.filter((option) => bulkLifecycleDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkPreviewError("Provide at least one rule ID or rule type.");
        return;
      }
      deleteIds = new Set(parsedIds);
      deleteTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "delete_cors") {
      const parsedIds = parseRuleIds(bulkCorsDeleteIds);
      const parsedTypes = CORS_TYPE_OPTIONS.filter((option) => bulkCorsDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkPreviewError("Provide at least one rule ID or rule type.");
        return;
      }
      deleteCorsIds = new Set(parsedIds);
      deleteCorsTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "delete_policy") {
      const parsedIds = parseRuleIds(bulkPolicyDeleteIds);
      const parsedTypes = POLICY_TYPE_OPTIONS.filter((option) => bulkPolicyDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkPreviewError("Provide at least one statement ID or statement type.");
        return;
      }
      deletePolicyIds = new Set(parsedIds);
      deletePolicyTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") {
      const parsedTargets = PUBLIC_ACCESS_BLOCK_OPTIONS.filter((option) => bulkPublicAccessBlockTargets[option.key]).map(
        (option) => option.key
      );
      if (parsedTargets.length === 0) {
        setBulkPreviewError("Select at least one block public access option.");
        return;
      }
      publicAccessBlockTargets = parsedTargets;
    }

    setBulkPreviewLoading(true);
    setBulkPreviewError(null);
    setBulkPreview([]);
    setBulkPreviewReady(false);
    setBulkApplyError(null);
    setBulkApplySummary(null);

    const desiredEnabled = bulkOperation === "enable_versioning";
    const desiredPublicAccessBlockEnabled = bulkOperation === "add_public_access_block";
    const previewItems = await runWithConcurrency(
      selectedBucketList,
      BULK_CONCURRENCY_LIMIT,
      async (bucketName) => {
        try {
          if (bulkOperation === "set_quota" && parsedQuota) {
            return await buildQuotaPreview(bucketName, parsedQuota, bulkQuotaSkipConfigured);
          }
          if (
            (bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") &&
            publicAccessBlockTargets
          ) {
            return await buildPublicAccessBlockPreview(bucketName, desiredPublicAccessBlockEnabled, publicAccessBlockTargets);
          }
          if (bulkOperation === "enable_versioning" || bulkOperation === "disable_versioning") {
            return await buildVersioningPreview(bucketName, desiredEnabled);
          }
          if (bulkOperation === "add_lifecycle" && parsedRules) {
            return await buildLifecyclePreview(bucketName, parsedRules);
          }
          if (bulkOperation === "delete_lifecycle" && deleteIds && deleteTypes) {
            return await buildLifecycleDeletePreview(bucketName, deleteIds, deleteTypes);
          }
          if (bulkOperation === "add_cors" && parsedCorsRules) {
            return await buildCorsPreview(bucketName, parsedCorsRules);
          }
          if (bulkOperation === "delete_cors" && deleteCorsIds && deleteCorsTypes) {
            return await buildCorsDeletePreview(bucketName, deleteCorsIds, deleteCorsTypes);
          }
          if (bulkOperation === "add_policy" && parsedPolicyStatements) {
            return await buildPolicyPreview(bucketName, parsedPolicyStatements);
          }
          if (bulkOperation === "delete_policy" && deletePolicyIds && deletePolicyTypes) {
            return await buildPolicyDeletePreview(bucketName, deletePolicyIds, deletePolicyTypes);
          }
          return {
            bucket: bucketName,
            before: [{ text: "-" }],
            after: [{ text: "-" }],
            changed: false,
          };
        } catch (err) {
          return {
            bucket: bucketName,
            before: [{ text: "Preview failed." }],
            after: [{ text: "Preview failed." }],
            changed: false,
            error: extractError(err),
          };
        }
      }
    );

    setBulkPreview(previewItems);
    setBulkPreviewReady(true);
    setBulkPreviewLoading(false);
  };

  const applyBulkUpdate = async () => {
    if (!selectedEndpointId || selectedBucketList.length === 0) return;
    if (!bulkOperation) {
      setBulkApplyError("Select an operation first.");
      return;
    }
    let parsedQuota: ParsedQuotaInput | null = null;
    let parsedRules: Record<string, unknown>[] | null = null;
    let parsedCorsRules: Record<string, unknown>[] | null = null;
    let parsedPolicyStatements: Record<string, unknown>[] | null = null;
    let deleteIds: Set<string> | null = null;
    let deleteTypes: Set<LifecycleRuleTypeKey> | null = null;
    let deleteCorsIds: Set<string> | null = null;
    let deleteCorsTypes: Set<CorsRuleTypeKey> | null = null;
    let deletePolicyIds: Set<string> | null = null;
    let deletePolicyTypes: Set<PolicyRuleTypeKey> | null = null;
    let publicAccessBlockTargets: PublicAccessBlockOptionKey[] | null = null;
    if (bulkOperation === "set_quota") {
      const parsed = parseQuotaInput(
        bulkQuotaSizeValue,
        bulkQuotaSizeUnit,
        bulkQuotaObjects,
        bulkQuotaApplySize,
        bulkQuotaApplyObjects
      );
      if ("error" in parsed) {
        setBulkApplyError(parsed.error);
        return;
      }
      parsedQuota = parsed;
    }
    if (bulkOperation === "add_lifecycle") {
      const parsed = parseLifecycleRules(bulkLifecycleRuleText);
      if ("error" in parsed) {
        setBulkApplyError(parsed.error);
        return;
      }
      if (bulkLifecycleUpdateOnlyExisting && parsed.rules.every((rule) => !getLifecycleRuleId(rule))) {
        setBulkApplyError("Provide rule IDs when 'only update existing' is enabled.");
        return;
      }
      parsedRules = parsed.rules;
    }
    if (bulkOperation === "add_cors") {
      const parsed = parseCorsRules(bulkCorsRuleText);
      if ("error" in parsed) {
        setBulkApplyError(parsed.error);
        return;
      }
      if (
        bulkCorsUpdateOnlyExisting &&
        parsed.rules.every((rule) => !getLifecycleRuleId(rule) && !getCorsRuleKey(rule))
      ) {
        setBulkApplyError("Provide rule IDs or matching origins/methods when 'only update existing' is enabled.");
        return;
      }
      parsedCorsRules = parsed.rules;
    }
    if (bulkOperation === "add_policy") {
      const parsed = parsePolicyStatements(bulkPolicyText);
      if ("error" in parsed) {
        setBulkApplyError(parsed.error);
        return;
      }
      parsedPolicyStatements = parsed.statements;
      parsedPolicy = parsed.policy as Record<string, unknown>;
    }
    if (bulkOperation === "delete_lifecycle") {
      const parsedIds = parseRuleIds(bulkLifecycleDeleteIds);
      const parsedTypes = LIFECYCLE_TYPE_OPTIONS.filter((option) => bulkLifecycleDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkApplyError("Provide at least one rule ID or rule type.");
        return;
      }
      deleteIds = new Set(parsedIds);
      deleteTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "delete_cors") {
      const parsedIds = parseRuleIds(bulkCorsDeleteIds);
      const parsedTypes = CORS_TYPE_OPTIONS.filter((option) => bulkCorsDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkApplyError("Provide at least one rule ID or rule type.");
        return;
      }
      deleteCorsIds = new Set(parsedIds);
      deleteCorsTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "delete_policy") {
      const parsedIds = parseRuleIds(bulkPolicyDeleteIds);
      const parsedTypes = POLICY_TYPE_OPTIONS.filter((option) => bulkPolicyDeleteTypes[option.key]).map(
        (option) => option.key
      );
      if (parsedIds.length === 0 && parsedTypes.length === 0) {
        setBulkApplyError("Provide at least one statement ID or statement type.");
        return;
      }
      deletePolicyIds = new Set(parsedIds);
      deletePolicyTypes = new Set(parsedTypes);
    }
    if (bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") {
      const parsedTargets = PUBLIC_ACCESS_BLOCK_OPTIONS.filter((option) => bulkPublicAccessBlockTargets[option.key]).map(
        (option) => option.key
      );
      if (parsedTargets.length === 0) {
        setBulkApplyError("Select at least one block public access option.");
        return;
      }
      publicAccessBlockTargets = parsedTargets;
    }

    setBulkApplyLoading(true);
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setBulkApplyProgress({ completed: 0, total: selectedBucketList.length, failed: 0 });

    const desiredEnabled = bulkOperation === "enable_versioning";
    const desiredPublicAccessBlockEnabled = bulkOperation === "add_public_access_block";
    const results = await runWithConcurrencySettled(
      selectedBucketList,
      BULK_CONCURRENCY_LIMIT,
      async (bucketName) => {
        if (bulkOperation === "set_quota" && parsedQuota) {
          const currentQuota = await fetchBucketQuota(bucketName);
          if (bulkQuotaSkipConfigured && hasConfiguredQuota(currentQuota)) {
            return { changed: false };
          }
          const currentSize = currentQuota.maxSizeBytes;
          const currentObjects = currentQuota.maxObjects;
          const nextSize = parsedQuota.applySize ? parsedQuota.maxSizeBytes : currentSize;
          const nextObjects = parsedQuota.applyObjects ? parsedQuota.maxObjects : currentObjects;
          if (currentSize === nextSize && currentObjects === nextObjects) {
            return { changed: false };
          }
          const payloadSizeGb =
            nextSize != null
              ? parsedQuota.applySize && parsedQuota.maxSizeValue != null
                ? parsedQuota.maxSizeValue
                : bytesToGiB(nextSize)
              : null;
          const payloadSizeUnit =
            nextSize != null
              ? parsedQuota.applySize && parsedQuota.maxSizeValue != null
                ? parsedQuota.maxSizeUnit
                : "GiB"
              : null;
          await updateCephAdminBucketQuota(selectedEndpointId, bucketName, {
            max_size_gb: payloadSizeGb,
            max_size_unit: payloadSizeUnit,
            max_objects: nextObjects,
          });
          return { changed: true };
        }
        if (
          (bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") &&
          publicAccessBlockTargets
        ) {
          const current = normalizePublicAccessBlockState(
            await getCephAdminBucketPublicAccessBlock(selectedEndpointId, bucketName)
          );
          const target = applyPublicAccessBlockTargets(current, desiredPublicAccessBlockEnabled, publicAccessBlockTargets);
          if (isPublicAccessBlockEquivalent(current, target)) {
            return { changed: false };
          }
          await updateCephAdminBucketPublicAccessBlock(selectedEndpointId, bucketName, target);
          return { changed: true };
        }
        if (bulkOperation === "enable_versioning" || bulkOperation === "disable_versioning") {
          const props = await getCephAdminBucketProperties(selectedEndpointId, bucketName);
          const currentEnabled = normalizeVersioningStatus(props.versioning_status);
          const shouldApply = currentEnabled === null ? true : currentEnabled !== desiredEnabled;
          if (!shouldApply) return { changed: false };
          await setCephAdminBucketVersioning(selectedEndpointId, bucketName, desiredEnabled);
          return { changed: true };
        }
        if (bulkOperation === "add_lifecycle" && parsedRules) {
          const lifecycle = await getCephAdminBucketLifecycle(selectedEndpointId, bucketName);
          const existingRules = lifecycle.rules ?? [];
          const { nextRules, changes } = mergeLifecycleRules(
            existingRules as Record<string, unknown>[],
            parsedRules,
            { onlyUpdateExisting: bulkLifecycleUpdateOnlyExisting }
          );
          if (changes.length === 0) return { changed: false };
          await putCephAdminBucketLifecycle(selectedEndpointId, bucketName, nextRules);
          return { changed: true };
        }
        if (bulkOperation === "delete_lifecycle" && deleteIds && deleteTypes) {
          const lifecycle = await getCephAdminBucketLifecycle(selectedEndpointId, bucketName);
          const existingRules = lifecycle.rules ?? [];
          const shouldDeleteRule = (rule: Record<string, unknown>) => {
            const ruleId = getLifecycleRuleId(rule);
            if (ruleId && deleteIds.has(ruleId)) return true;
            if (deleteTypes.size === 0) return false;
            const ruleTypes = getLifecycleRuleTypes(rule);
            return ruleTypes.some((type) => deleteTypes.has(type));
          };
          const nextRules = existingRules.filter(
            (rule) => !shouldDeleteRule(rule as Record<string, unknown>)
          ) as Record<string, unknown>[];
          if (nextRules.length === existingRules.length) return { changed: false };
          if (nextRules.length === 0) {
            await deleteCephAdminBucketLifecycle(selectedEndpointId, bucketName);
            return { changed: true };
          }
          await putCephAdminBucketLifecycle(selectedEndpointId, bucketName, nextRules);
          return { changed: true };
        }
        if (bulkOperation === "add_cors" && parsedCorsRules) {
          const cors = await getCephAdminBucketCors(selectedEndpointId, bucketName);
          const existingRules = cors.rules ?? [];
          const { nextRules, changes } = mergeCorsRules(
            existingRules as Record<string, unknown>[],
            parsedCorsRules,
            { onlyUpdateExisting: bulkCorsUpdateOnlyExisting }
          );
          if (changes.length === 0) return { changed: false };
          await putCephAdminBucketCors(selectedEndpointId, bucketName, nextRules);
          return { changed: true };
        }
        if (bulkOperation === "delete_cors" && deleteCorsIds && deleteCorsTypes) {
          const cors = await getCephAdminBucketCors(selectedEndpointId, bucketName);
          const existingRules = cors.rules ?? [];
          const shouldDeleteRule = (rule: Record<string, unknown>) => {
            const ruleId = getLifecycleRuleId(rule);
            if (ruleId && deleteCorsIds.has(ruleId)) return true;
            if (deleteCorsTypes.size === 0) return false;
            const ruleTypes = getCorsRuleTypes(rule);
            return ruleTypes.some((type) => deleteCorsTypes.has(type));
          };
          const nextRules = existingRules.filter(
            (rule) => !shouldDeleteRule(rule as Record<string, unknown>)
          ) as Record<string, unknown>[];
          if (nextRules.length === existingRules.length) return { changed: false };
          if (nextRules.length === 0) {
            await deleteCephAdminBucketCors(selectedEndpointId, bucketName);
            return { changed: true };
          }
          await putCephAdminBucketCors(selectedEndpointId, bucketName, nextRules);
          return { changed: true };
        }
        if (bulkOperation === "add_policy" && parsedPolicyStatements) {
          const policy = await getCephAdminBucketPolicy(selectedEndpointId, bucketName);
          const existingPolicy = policy.policy ?? {};
          const existingStatements = Array.isArray((existingPolicy as Record<string, unknown>).Statement)
            ? ((existingPolicy as Record<string, unknown>).Statement as Record<string, unknown>[])
            : [];
          const { nextStatements, changes } = mergePolicyStatements(
            existingStatements,
            parsedPolicyStatements,
            { onlyUpdateExisting: bulkPolicyUpdateOnlyExisting }
          );
          if (changes.length === 0) return { changed: false };
          const nextPolicy = {
            ...(Object.keys(existingPolicy).length > 0 ? (existingPolicy as Record<string, unknown>) : (parsedPolicy ?? {})),
            Statement: nextStatements,
          };
          await putCephAdminBucketPolicy(selectedEndpointId, bucketName, nextPolicy);
          return { changed: true };
        }
        if (bulkOperation === "delete_policy" && deletePolicyIds && deletePolicyTypes) {
          const policy = await getCephAdminBucketPolicy(selectedEndpointId, bucketName);
          const existingPolicy = policy.policy ?? {};
          const existingStatements = Array.isArray((existingPolicy as Record<string, unknown>).Statement)
            ? ((existingPolicy as Record<string, unknown>).Statement as Record<string, unknown>[])
            : [];
          const shouldDeleteStatement = (statement: Record<string, unknown>) => {
            const sid = getPolicyStatementSid(statement);
            if (sid && deletePolicyIds.has(sid)) return true;
            if (deletePolicyTypes.size === 0) return false;
            const types = getPolicyStatementTypes(statement);
            return types.some((type) => deletePolicyTypes.has(type));
          };
          const nextStatements = existingStatements.filter(
            (statement) => !shouldDeleteStatement(statement as Record<string, unknown>)
          ) as Record<string, unknown>[];
          if (nextStatements.length === existingStatements.length) return { changed: false };
          if (nextStatements.length === 0) {
            await deleteCephAdminBucketPolicy(selectedEndpointId, bucketName);
            return { changed: true };
          }
          const nextPolicy = {
            ...(existingPolicy as Record<string, unknown>),
            Statement: nextStatements,
          };
          await putCephAdminBucketPolicy(selectedEndpointId, bucketName, nextPolicy);
          return { changed: true };
        }
        return { changed: false };
      },
      (result) => {
        setBulkApplyProgress((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            completed: Math.min(prev.total, prev.completed + 1),
            failed: prev.failed + (result.status === "rejected" ? 1 : 0),
          };
        });
      }
    );

    const failed = results.filter((result) => result.status === "rejected");
    const changedCount = results.filter(
      (result): result is PromiseFulfilledResult<{ changed: boolean }> =>
        result.status === "fulfilled" && result.value.changed
    ).length;
    const unchangedCount = results.filter(
      (result): result is PromiseFulfilledResult<{ changed: boolean }> =>
        result.status === "fulfilled" && !result.value.changed
    ).length;

    if (failed.length > 0) {
      setBulkApplyError(`${failed.length} bucket(s) failed to update.`);
    }
    setBulkApplySummary(
      `Updated ${changedCount} bucket${changedCount !== 1 ? "s" : ""}${unchangedCount > 0 ? ` (${unchangedCount} unchanged)` : ""}.`
    );
    setBulkApplyLoading(false);
    void fetchBuckets();
  };

  const updateAdvancedField = (field: keyof AdvancedFilterState, value: string) => {
    setAdvancedDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateFeatureFilter = (feature: FeatureKey, value: FeatureFilterState) => {
    setAdvancedDraft((prev) => ({ ...prev, features: { ...prev.features, [feature]: value } }));
  };

  const applyAdvancedFilter = () => {
    setAdvancedApplied(advancedDraft);
    setPage(1);
  };

  const resetAdvancedFilter = () => {
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setPage(1);
  };

  const advancedFilterActive = hasAdvancedFilters(advancedApplied) || tagFilters.length > 0;
  const quickFilterActive = filterValue.trim().length > 0;
  const filtersActive = quickFilterActive || advancedFilterActive;
  const availableTagFilters = useMemo(() => {
    const selected = new Set(tagFilters.map((tag) => tag.toLowerCase()));
    return availableUiTags.filter((tag) => !selected.has(tag.toLowerCase()));
  }, [availableUiTags, tagFilters]);
  const showTagFilterBar = availableUiTags.length > 0 || tagFilters.length > 0;
  const isActiveTextFilter = (value: string) => value.trim().length > 0;
  const isActiveNumericFilter = (value: string) => value.trim().length > 0;
  const isActiveFeatureFilter = (value: FeatureFilterState) => value !== "any";
  const activeFieldClass = "border-primary/60 bg-primary/5 dark:bg-primary/10";
  const activeLabelClass = "text-primary";
  const resetAllFilters = () => {
    setFilter("");
    setFilterValue("");
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setTagFilters([]);
    setTagFilterMode("any");
    setShowAdvancedFilter(false);
    setPage(1);
  };
  const clearOrphanedTags = () => {
    if (orphanedTagBuckets.length === 0) return;
    setUiTags((prev) => {
      const next = { ...prev };
      orphanedTagBuckets.forEach((bucketName) => {
        delete next[bucketName];
      });
      return next;
    });
    setOrphanedTagBuckets([]);
  };
  const previewStats = useMemo(() => {
    const errors = bulkPreview.filter((item) => item.error).length;
    const changed = bulkPreview.filter((item) => !item.error && item.changed).length;
    const unchanged = bulkPreview.length - changed - errors;
    return { changed, unchanged, errors };
  }, [bulkPreview]);
  const bulkApplyProgressPercent = useMemo(() => {
    if (!bulkApplyProgress || bulkApplyProgress.total <= 0) return 0;
    return Math.min(100, Math.round((bulkApplyProgress.completed / bulkApplyProgress.total) * 100));
  }, [bulkApplyProgress]);
  const hasDeleteCriteria =
    bulkLifecycleDeleteIds.trim().length > 0 || Object.values(bulkLifecycleDeleteTypes).some(Boolean);
  const hasCorsDeleteCriteria =
    bulkCorsDeleteIds.trim().length > 0 || Object.values(bulkCorsDeleteTypes).some(Boolean);
  const hasPolicyDeleteCriteria =
    bulkPolicyDeleteIds.trim().length > 0 || Object.values(bulkPolicyDeleteTypes).some(Boolean);
  const hasPublicAccessBlockTargetCriteria = Object.values(bulkPublicAccessBlockTargets).some(Boolean);

  const diffToneClasses = (tone?: BulkPreviewTone) => {
    if (tone === "added") {
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100";
    }
    if (tone === "removed") {
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100";
    }
    return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";
  };

  const renderPreviewLines = (lines: BulkPreviewLine[]) => (
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

  type ColumnDef = {
    id: string;
    label: string;
    field?: SortField | null;
    align?: "left" | "right";
    header?: ReactNode;
    headerClassName?: string;
    render: (bucket: CephAdminBucket) => ReactNode;
  };

  const quotaConfigured = (bucket: CephAdminBucket) =>
    Boolean((bucket.quota_max_size_bytes ?? 0) > 0 || (bucket.quota_max_objects ?? 0) > 0);

  const renderTagList = (tags?: CephAdminBucket["tags"]) => {
    const safeTags = Array.isArray(tags) ? tags.filter((t) => (t.key ?? "").trim()) : [];
    if (safeTags.length === 0) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    const maxShown = 3;
    const shown = safeTags.slice(0, maxShown);
    const remaining = safeTags.length - shown.length;
    const title = safeTags.map((t) => `${t.key}=${t.value}`).join("\n");
    return (
      <div className="flex flex-wrap gap-1.5" title={title}>
        {shown.map((t) => {
          const label = `${t.key}=${t.value}`;
          const colors = getTagColors(label);
          return (
            <span
              key={`${t.key}:${t.value}`}
              className="rounded-full border px-2 py-0.5 ui-caption font-semibold"
              style={{ backgroundColor: colors.background, color: colors.text, borderColor: colors.border }}
            >
              {label}
            </span>
          );
        })}
        {remaining > 0 && (
          <span className="rounded-full border border-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            +{remaining}
          </span>
        )}
      </div>
    );
  };

  const renderUiTags = (bucketName: string) => {
    const tags = uiTags[bucketName] ?? [];
    const draft = tagDrafts[bucketName] ?? "";
    const normalizedDraft = draft.trim().toLowerCase();
    const existingSet = new Set(tags.map((tag) => tag.toLowerCase()));
    const suggestions = normalizedDraft
      ? availableUiTags.filter(
          (tag) => tag.toLowerCase().includes(normalizedDraft) && !existingSet.has(tag.toLowerCase())
        )
      : availableUiTags.filter((tag) => !existingSet.has(tag.toLowerCase()));
    const showSuggestions = tagSuggestionBucket === bucketName && suggestions.length > 0;
    return (
      <div className="group relative flex flex-wrap items-center gap-2">
        {tags.map((tag) => {
          const colors = getTagColors(tag);
          return (
            <span
              key={`${bucketName}:${tag}`}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 ui-caption font-semibold"
              style={{ backgroundColor: colors.background, color: colors.text, borderColor: colors.border }}
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTagForBucket(bucketName, tag)}
                className="opacity-70 hover:opacity-100"
                title="Remove tag"
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          type="text"
          value={draft}
          onChange={(e) => updateTagDraft(bucketName, e.target.value)}
          onFocus={() => setTagSuggestionBucket(bucketName)}
          onBlur={() => {
            window.setTimeout(() => {
              setTagSuggestionBucket((prev) => (prev === bucketName ? null : prev));
            }, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTagsForBucket(bucketName, draft);
              updateTagDraft(bucketName, "");
            }
          }}
          placeholder="+"
          className={`border-0 bg-transparent p-0 ui-caption text-slate-500 placeholder:text-slate-400 transition-all duration-150 focus:outline-none focus:ring-0 dark:text-slate-300 ${
            draft ? "w-24 opacity-100" : "w-0 opacity-0 group-hover:w-6 group-hover:opacity-100 focus:w-24 focus:opacity-100"
          }`}
        />
        {showSuggestions && (
          <div
            className="absolute left-0 top-full z-20 mt-1 max-h-40 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.map((tag) => (
              <button
                key={`${bucketName}:suggest:${tag}`}
                type="button"
                onClick={() => {
                  addTagsForBucket(bucketName, tag);
                  updateTagDraft(bucketName, "");
                }}
                className="flex w-full items-center rounded-md px-2 py-1 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };


  const renderFeatureChip = (featureKey: string, bucket: CephAdminBucket) => {
    const status = bucket.features?.[featureKey] ?? null;
    if (!status) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    return <PropertySummaryChip compact state={status.state} tone={status.tone} title={`${featureKey}: ${status.state}`} />;
  };

  const bucketTableColumns: ColumnDef[] = (() => {
    const cols: ColumnDef[] = [
      {
        id: "select",
        label: "",
        field: null,
        header: (
          <input
            ref={selectionHeaderRef}
            type="checkbox"
            checked={allSelectedOnPage}
            onChange={(e) => setSelectionForPage(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
          />
        ),
        align: "left",
        render: (bucket) => (
          <input
            type="checkbox"
            checked={selectedBuckets.has(bucket.name)}
            onChange={() => toggleSelection(bucket.name)}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
          />
        ),
      },
      {
        id: "name",
        label: "Name",
        field: "name",
        render: (bucket) => (
          <Link to={`/ceph-admin/buckets/${encodeURIComponent(bucket.name)}`} className="hover:text-primary-700 dark:hover:text-primary-200">
            {bucket.name}
          </Link>
        ),
      },
    ];

    const visible = new Set(visibleColumns);
    if (visible.has("ui_tags")) {
      cols.push({
        id: "ui_tags",
        label: "UI tags",
        field: null,
        header: <span>UI tags</span>,
        headerClassName: "min-w-[200px]",
        render: (bucket) => renderUiTags(bucket.name),
      });
    }
    if (visible.has("tenant")) {
      cols.push({
        id: "tenant",
        label: "Tenant",
        field: "tenant",
        render: (bucket) => bucket.tenant ?? "-",
      });
    }
    if (visible.has("owner")) {
      cols.push({
        id: "owner",
        label: "Owner",
        field: "owner",
        render: (bucket) => bucket.owner ?? "-",
      });
    }
    if (visible.has("owner_name")) {
      cols.push({
        id: "owner_name",
        label: "Owner name",
        field: null,
        render: (bucket) => bucket.owner_name ?? "-",
      });
    }
    if (visible.has("used_bytes")) {
      cols.push({
        id: "used_bytes",
        label: "Used",
        field: "used_bytes",
        render: (bucket) => formatBytes(bucket.used_bytes),
      });
    }
    if (visible.has("quota_max_size_bytes")) {
      cols.push({
        id: "quota_max_size_bytes",
        label: "Quota",
        field: null,
        render: (bucket) => <QuotaBar usedBytes={bucket.used_bytes} quotaBytes={bucket.quota_max_size_bytes ?? null} />,
      });
    }
    if (visible.has("object_count")) {
      cols.push({
        id: "object_count",
        label: "Objects",
        field: "object_count",
        render: (bucket) => formatNumber(bucket.object_count),
      });
    }
    if (visible.has("quota_max_objects")) {
      cols.push({
        id: "quota_max_objects",
        label: "Object quota",
        field: null,
        render: (bucket) => <QuotaObjectsBar usedObjects={bucket.object_count} quotaObjects={bucket.quota_max_objects ?? null} />,
      });
    }
    if (visible.has("tags")) {
      cols.push({
        id: "tags",
        label: "Tags",
        field: null,
        render: (bucket) => renderTagList(bucket.tags),
      });
    }

    const featureColumns: { id: ColumnId; label: string; key: string }[] = [
      { id: "versioning", label: "Versioning", key: "versioning" },
      { id: "object_lock", label: "Object Lock", key: "object_lock" },
      { id: "block_public_access", label: "Block public access", key: "block_public_access" },
      { id: "lifecycle_rules", label: "Lifecycle rules", key: "lifecycle_rules" },
      { id: "static_website", label: "Static website", key: "static_website" },
      { id: "bucket_policy", label: "Bucket policy", key: "bucket_policy" },
      { id: "cors", label: "CORS", key: "cors" },
      { id: "access_logging", label: "Access logging", key: "access_logging" },
    ];

    featureColumns.forEach((c) => {
      if (!visible.has(c.id)) return;
      cols.push({
        id: c.id,
        label: c.label,
        field: null,
        render: (bucket) => renderFeatureChip(c.key, bucket),
      });
    });

    if (visible.has("quota_status")) {
      cols.push({
        id: "quota_status",
        label: "Quota status",
        field: null,
        render: (bucket) => (
          <PropertySummaryChip
            compact
            state={quotaConfigured(bucket) ? "Configured" : "Not set"}
            tone={quotaConfigured(bucket) ? "active" : "inactive"}
            title={`Quota: ${quotaConfigured(bucket) ? "Configured" : "Not set"}`}
          />
        ),
      });
    }

    cols.push({
      id: "actions",
      label: "Actions",
      field: null,
      align: "right",
      render: (bucket) => (
        <Link to={`/ceph-admin/buckets/${encodeURIComponent(bucket.name)}`} className={tableActionButtonClasses}>
          Configure
        </Link>
      ),
    });

    return cols;
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Buckets"
        description="Listing cluster-level des buckets (Admin Ops + S3)."
        breadcrumbs={[{ label: "Ceph Admin", to: "/ceph-admin" }, { label: "Buckets" }]}
      />

      {!selectedEndpointId && <PageBanner tone="warning">Select a Ceph endpoint first.</PageBanner>}
      {selectedEndpoint && (
        <PageBanner tone="info">
          Endpoint: <span className="font-semibold">{selectedEndpoint.name}</span>
        </PageBanner>
      )}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {orphanedTagBuckets.length > 0 && (
        <PageBanner tone="warning">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              UI tags exist for {orphanedTagBuckets.length} bucket{orphanedTagBuckets.length > 1 ? "s" : ""} that{" "}
              {orphanedTagBuckets.length > 1 ? "no longer exist" : "no longer exists"}.
            </span>
            <button
              type="button"
              onClick={clearOrphanedTags}
              className="rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 ui-caption font-semibold text-amber-800 hover:border-amber-400 dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100"
            >
              Remove tags
            </button>
          </div>
        </PageBanner>
      )}

        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Buckets</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">{total} result(s)</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <div className="relative" ref={columnPickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowColumnPicker((prev) => !prev)}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    Columns
                  </button>
                  {showColumnPicker && (
                    <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between gap-2">
                        <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Visible columns</p>
                        <button
                          type="button"
                          onClick={resetColumns}
                          className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          Reset
                        </button>
                      </div>

                      <div className="mt-3 space-y-3">
                        <div className="space-y-2">
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Core</p>
                          {[
                            { id: "ui_tags" as const, label: "UI tags" },
                            { id: "tenant" as const, label: "Tenant" },
                            { id: "owner" as const, label: "Owner" },
                            { id: "owner_name" as const, label: "Owner name" },
                            { id: "used_bytes" as const, label: "Used" },
                            { id: "object_count" as const, label: "Objects" },
                            { id: "quota_max_size_bytes" as const, label: "Quota" },
                            { id: "quota_max_objects" as const, label: "Object quota" },
                            { id: "quota_status" as const, label: "Quota status" },
                            { id: "tags" as const, label: "S3 Tags" },
                          ].map((opt) => (
                            <label key={opt.id} className="flex items-center justify-between ui-body text-slate-700 dark:text-slate-200">
                              <span>{opt.label}</span>
                              <input
                                type="checkbox"
                                checked={visibleColumns.includes(opt.id)}
                                onChange={() => toggleColumn(opt.id)}
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                              />
                            </label>
                          ))}
                        </div>

                        <div className="space-y-2">
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Features</p>
                          {[
                            { id: "versioning" as const, label: "Versioning" },
                            { id: "object_lock" as const, label: "Object Lock" },
                            { id: "block_public_access" as const, label: "Block public access" },
                            { id: "lifecycle_rules" as const, label: "Lifecycle rules" },
                            { id: "static_website" as const, label: "Static website" },
                            { id: "bucket_policy" as const, label: "Bucket policy" },
                            { id: "cors" as const, label: "CORS" },
                            { id: "access_logging" as const, label: "Access logging" },
                          ].map((opt) => (
                            <label key={opt.id} className="flex items-center justify-between ui-body text-slate-700 dark:text-slate-200">
                              <span>{opt.label}</span>
                              <input
                                type="checkbox"
                                checked={visibleColumns.includes(opt.id)}
                                onChange={() => toggleColumn(opt.id)}
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                              />
                            </label>
                          ))}
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
                            Feature checks run only when their column is enabled.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filters</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Quick filter + Advanced filter</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedFilter((prev) => !prev)}
                    className={`rounded-md border px-3 py-2 ui-body font-semibold ${
                      showAdvancedFilter || advancedFilterActive
                        ? "border-primary/40 bg-primary-50 text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/10 dark:text-primary-100"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    Advanced filter{advancedFilterActive ? " · Active" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    disabled={!filtersActive}
                    className={`rounded-md border px-3 py-2 ui-body font-semibold ${
                      filtersActive
                        ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                        : "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                    }`}
                  >
                    Clear all filters
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Quick filter
                  </label>
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Bucket name"
                    className={`w-full rounded-md border bg-white px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-slate-900 dark:text-slate-100 ${
                      quickFilterActive ? activeFieldClass : "border-slate-200 dark:border-slate-700"
                    }`}
                  />
                </div>
                {showTagFilterBar && (
                  <div className="space-y-1 sm:col-span-2">
                    <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Tag filter
                    </label>
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {tagFilters.map((tag) => {
                          const colors = getTagColors(tag);
                          return (
                            <span
                              key={`filter:${tag}`}
                              className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 ui-caption font-semibold"
                              style={{ backgroundColor: colors.background, color: colors.text, borderColor: colors.border }}
                            >
                              {tag}
                              <button
                                type="button"
                                onClick={() => removeTagFilter(tag)}
                                className="opacity-70 hover:opacity-100"
                                title="Remove tag filter"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                        {availableTagFilters.map((tag) => (
                          <button
                            type="button"
                            key={`available:${tag}`}
                            onClick={() => addTagFilter(tag)}
                            className="rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 ui-caption font-semibold text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                      <select
                        value={tagFilterMode}
                        onChange={(e) => {
                          setTagFilterMode(e.target.value as "any" | "all");
                          setPage(1);
                        }}
                        className="rounded-md border border-slate-200 px-1.5 py-0.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="any">OR</option>
                        <option value="all">AND</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {showAdvancedFilter && (
                <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <label
                    className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                      isActiveTextFilter(advancedDraft.tenant) ? activeLabelClass : ""
                    }`}
                  >
                    Tenant
                  </label>
                  <input
                    type="text"
                    value={advancedDraft.tenant}
                    onChange={(e) => updateAdvancedField("tenant", e.target.value)}
                    placeholder="tenant-a"
                    className={`w-full rounded-md border border-slate-200 px-2 py-1 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                      isActiveTextFilter(advancedDraft.tenant) ? activeFieldClass : ""
                    }`}
                  />
                </div>
                <div className="space-y-1">
                  <label
                    className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                      isActiveTextFilter(advancedDraft.owner) ? activeLabelClass : ""
                    }`}
                  >
                    Owner
                  </label>
                  <input
                    type="text"
                    value={advancedDraft.owner}
                    onChange={(e) => updateAdvancedField("owner", e.target.value)}
                    placeholder="owner uid"
                    className={`w-full rounded-md border border-slate-200 px-2 py-1 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                      isActiveTextFilter(advancedDraft.owner) ? activeFieldClass : ""
                    }`}
                  />
                </div>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
                {[
                  { id: "minUsedBytes" as const, label: "Used ≥" },
                  { id: "maxUsedBytes" as const, label: "Used ≤" },
                  { id: "minObjects" as const, label: "Objects ≥" },
                  { id: "maxObjects" as const, label: "Objects ≤" },
                  { id: "minQuotaBytes" as const, label: "Quota bytes ≥" },
                  { id: "maxQuotaBytes" as const, label: "Quota bytes ≤" },
                  { id: "minQuotaObjects" as const, label: "Quota objects ≥" },
                  { id: "maxQuotaObjects" as const, label: "Quota objects ≤" },
                ].map((field) => {
                  const isActive = isActiveNumericFilter(advancedDraft[field.id]);
                  return (
                    <div key={field.id} className="space-y-1">
                      <label
                        className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                          isActive ? activeLabelClass : ""
                        }`}
                      >
                        {field.label}
                      </label>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={advancedDraft[field.id]}
                        onChange={(e) => updateAdvancedField(field.id, e.target.value)}
                        className={`w-full rounded-md border border-slate-200 px-2 py-1 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                          isActive ? activeFieldClass : ""
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">Numeric values are in bytes.</p>

              <div className="mt-2">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Features</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
                  {[
                    { id: "versioning" as const, label: "Versioning" },
                    { id: "object_lock" as const, label: "Object Lock" },
                    { id: "block_public_access" as const, label: "Block public access" },
                    { id: "lifecycle_rules" as const, label: "Lifecycle rules" },
                    { id: "static_website" as const, label: "Static website" },
                    { id: "bucket_policy" as const, label: "Bucket policy" },
                    { id: "cors" as const, label: "CORS" },
                    { id: "access_logging" as const, label: "Access logging" },
                  ].map((feature) => {
                    const isActive = isActiveFeatureFilter(advancedDraft.features[feature.id]);
                    return (
                      <label
                        key={feature.id}
                        className={`flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200 ${
                          isActive ? activeLabelClass : ""
                        }`}
                      >
                        <span>{feature.label}</span>
                        <select
                          value={advancedDraft.features[feature.id]}
                          onChange={(e) => updateFeatureFilter(feature.id, e.target.value as FeatureFilterState)}
                          className={`w-full rounded-md border border-slate-200 px-2 py-1 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                            isActive ? activeFieldClass : ""
                          }`}
                        >
                          {feature.id === "versioning" ? (
                            <>
                              <option value="any">Any</option>
                              <option value="enabled">Enabled</option>
                              <option value="disabled">Disabled</option>
                              <option value="suspended">Suspended</option>
                              <option value="disabled_or_suspended">Disabled or Suspended</option>
                            </>
                          ) : (
                            <>
                              <option value="any">Any</option>
                              <option value="enabled">Enabled</option>
                              <option value="disabled">Disabled</option>
                            </>
                          )}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={resetAdvancedFilter}
                  className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={applyAdvancedFilter}
                  className="rounded-md bg-primary px-2 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600"
                >
                  Apply filter
                </button>
              </div>
                </div>
              )}
            </div>
          </div>
          {selectedCount > 0 && (
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                  {selectedCount} bucket{selectedCount > 1 ? "s" : ""} selected
                  {hiddenSelectedCount > 0 && (
                    <span className="ml-2 ui-caption font-semibold text-red-600 dark:text-red-400">
                      ({hiddenSelectedCount} not visible)
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={openBulkUpdateModal}
                    className="rounded-md bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600"
                  >
                    Bulk update
                  </button>
                  <button
                    type="button"
                    onClick={() => openTagEditor(Array.from(selectedBuckets))}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
                  >
                    Edit UI tags
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
                  >
                    Clear selection
                  </button>
                </div>
              </div>
            </div>
          )}

        <div className="overflow-x-auto">
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {bucketTableColumns.map((col) =>
                  col.header ? (
                    <th
                      key={col.id}
                      className={`py-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                        col.align === "right" ? "text-right" : "text-left"
                      } ${col.id === "select" ? "w-10 px-3" : "px-6"} ${col.headerClassName ?? ""}`}
                    >
                      <div className="flex items-start">{col.header}</div>
                    </th>
                  ) : (
                    <SortableHeader
                      key={col.id}
                      label={col.label}
                      field={col.field}
                      activeField={sort.field}
                      direction={sort.direction}
                      align={col.align ?? (col.label === "Actions" ? "right" : "left")}
                      onSort={col.field ? (field) => toggleSort(field as SortField) : undefined}
                    />
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && <TableEmptyState colSpan={bucketTableColumns.length} message="Loading buckets..." />}
              {error && !loading && items.length === 0 && (
                <TableEmptyState colSpan={bucketTableColumns.length} message="Unable to load buckets." />
              )}
              {!loading && !error && items.length === 0 && (
                <TableEmptyState colSpan={bucketTableColumns.length} message="No buckets found." />
              )}
              {!loading &&
                !error &&
                items.map((bucket) => (
                  <tr key={`${bucket.tenant ?? ""}:${bucket.name}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    {bucketTableColumns.map((col) => {
                      const align = col.align ?? (col.id === "actions" ? "right" : "left");
                      const cellBase =
                        align === "right"
                          ? "px-6 py-4 text-right"
                          : col.id === "select"
                            ? "px-3 py-4"
                            : "px-6 py-4";
                      const isSelect = col.id === "select";
                      const textClass =
                        isSelect
                          ? ""
                          : col.id === "name"
                          ? "manager-table-cell ui-body font-semibold text-slate-900 dark:text-slate-100"
                          : "ui-body text-slate-600 dark:text-slate-300";
                      return (
                        <td key={`${bucket.name}:${col.id}`} className={`${cellBase} ${textClass}`}>
                          {col.render(bucket)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(next) => setPage(next)}
          onPageSizeChange={(next) => {
            setPageSize(next);
            setPage(1);
          }}
          disabled={loading || !selectedEndpointId}
        />
      </div>
      <datalist id="ui-tag-options">
        {availableUiTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      {showBulkUpdateModal && (
        <Modal title="Bulk update" onClose={closeBulkUpdateModal} maxWidthClass="max-w-6xl">
          <div className="space-y-4">
            <p className="ui-body text-slate-700 dark:text-slate-200">
              Apply configuration to{" "}
              <span className="font-semibold">
                {selectedCount} bucket{selectedCount > 1 ? "s" : ""}
              </span>
              .
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Operation
                </label>
                <select
                  value={bulkOperation}
                  onChange={(e) => setBulkOperation(e.target.value as BulkOperation)}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Select an operation</option>
                  <option value="set_quota">Set bucket quota</option>
                  <option value="add_public_access_block">Add block public access</option>
                  <option value="remove_public_access_block">Remove block public access</option>
                  <option value="enable_versioning">Enable versioning</option>
                  <option value="disable_versioning">Disable versioning</option>
                  <option value="add_lifecycle">Add or update lifecycle rules</option>
                  <option value="delete_lifecycle">Delete lifecycle rules</option>
                  <option value="add_cors">Add or update CORS rules</option>
                  <option value="delete_cors">Delete CORS rules</option>
                  <option value="add_policy">Add or update policy statements</option>
                  <option value="delete_policy">Delete policy statements</option>
                </select>
              </div>
            </div>
            {bulkOperation === "set_quota" && (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 ui-caption text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={bulkQuotaApplySize}
                      onChange={(event) => setBulkQuotaApplySize(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                    />
                    Update storage quota
                  </label>
                  <label className="flex items-center gap-2 ui-caption text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={bulkQuotaApplyObjects}
                      onChange={(event) => setBulkQuotaApplyObjects(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                    />
                    Update object quota
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                  <div className="space-y-1">
                    <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Storage quota
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={bulkQuotaSizeValue}
                      onChange={(event) => setBulkQuotaSizeValue(event.target.value)}
                      placeholder="Leave empty to clear"
                      disabled={!bulkQuotaApplySize}
                      className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Unit
                    </label>
                    <select
                      value={bulkQuotaSizeUnit}
                      onChange={(event) => setBulkQuotaSizeUnit(event.target.value as QuotaSizeUnit)}
                      disabled={!bulkQuotaApplySize}
                      className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="MiB">MiB</option>
                      <option value="GiB">GiB</option>
                      <option value="TiB">TiB</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Object quota
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={bulkQuotaObjects}
                    onChange={(event) => setBulkQuotaObjects(event.target.value)}
                    placeholder="Leave empty to clear"
                    disabled={!bulkQuotaApplyObjects}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <label className="flex items-center gap-2 ui-caption text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={bulkQuotaSkipConfigured}
                    onChange={(event) => setBulkQuotaSkipConfigured(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  />
                  Do not change buckets that already have a quota.
                </label>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Leave both fields empty to remove quotas from the selected buckets.
                </p>
              </div>
            )}
            {(bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") && (
              <div className="space-y-3">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Options to {bulkOperation === "add_public_access_block" ? "block" : "unblock"}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PUBLIC_ACCESS_BLOCK_OPTIONS.map((option) => (
                    <label
                      key={option.key}
                      className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                    >
                      <input
                        type="checkbox"
                        checked={bulkPublicAccessBlockTargets[option.key]}
                        onChange={(event) =>
                          setBulkPublicAccessBlockTargets((prev) => ({ ...prev, [option.key]: event.target.checked }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Only selected options are updated. Unselected options remain unchanged.
                </p>
              </div>
            )}
            {bulkOperation === "add_lifecycle" && (
              <div className="space-y-2">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Lifecycle rules (JSON)
                </label>
                <textarea
                  value={bulkLifecycleRuleText}
                  onChange={(event) => setBulkLifecycleRuleText(event.target.value)}
                  rows={8}
                  placeholder='{"ID":"rule-1","Status":"Enabled","Filter":{"Prefix":"logs/"}}'
                  className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Provide a JSON object or array. Rules will be appended, or will replace existing rules with the same ID.
                </p>
                <label className="flex items-center gap-2 ui-caption text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={bulkLifecycleUpdateOnlyExisting}
                    onChange={(event) => setBulkLifecycleUpdateOnlyExisting(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  />
                  Only update rules that already exist (do not add new rules).
                </label>
              </div>
            )}
            {bulkOperation === "delete_lifecycle" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Rule IDs (comma, newline, or JSON array)
                  </label>
                  <textarea
                    value={bulkLifecycleDeleteIds}
                    onChange={(event) => setBulkLifecycleDeleteIds(event.target.value)}
                    rows={4}
                    placeholder='rule-1, rule-2 or ["rule-1","rule-2"]'
                    className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Rule types
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {LIFECYCLE_TYPE_OPTIONS.map((option) => (
                      <label
                        key={option.key}
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        <input
                          type="checkbox"
                          checked={bulkLifecycleDeleteTypes[option.key]}
                          onChange={(event) =>
                            setBulkLifecycleDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Rules are deleted if the ID matches or if any selected type is present in the rule.
                  </p>
                </div>
              </div>
            )}
            {bulkOperation === "add_cors" && (
              <div className="space-y-2">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  CORS rules (JSON)
                </label>
                <textarea
                  value={bulkCorsRuleText}
                  onChange={(event) => setBulkCorsRuleText(event.target.value)}
                  rows={8}
                  placeholder='{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"]}'
                  className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Provide a JSON object or array. Rules are merged by rule ID (if present) or by AllowedOrigins +
                  AllowedMethods.
                </p>
                <label className="flex items-center gap-2 ui-caption text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={bulkCorsUpdateOnlyExisting}
                    onChange={(event) => setBulkCorsUpdateOnlyExisting(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  />
                  Only update rules that already exist (do not add new rules).
                </label>
              </div>
            )}
            {bulkOperation === "delete_cors" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Rule IDs (comma, newline, or JSON array)
                  </label>
                  <textarea
                    value={bulkCorsDeleteIds}
                    onChange={(event) => setBulkCorsDeleteIds(event.target.value)}
                    rows={4}
                    placeholder='rule-1, rule-2 or ["rule-1","rule-2"]'
                    className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Rule types
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CORS_TYPE_OPTIONS.map((option) => (
                      <label
                        key={option.key}
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        <input
                          type="checkbox"
                          checked={bulkCorsDeleteTypes[option.key]}
                          onChange={(event) =>
                            setBulkCorsDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Rules are deleted if the ID matches or if any selected type is present in the rule.
                  </p>
                </div>
              </div>
            )}
            {bulkOperation === "add_policy" && (
              <div className="space-y-2">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Policy (JSON)
                </label>
                <textarea
                  value={bulkPolicyText}
                  onChange={(event) => setBulkPolicyText(event.target.value)}
                  rows={8}
                  placeholder='{"Version":"2012-10-17","Statement":[{"Sid":"AllowRead","Effect":"Allow","Action":["s3:GetObject"],"Resource":"*","Principal":"*"}]}'
                  className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Provide a policy object, a statement array, or a single statement. Statements are merged by Sid or by
                  Effect/Action/Principal/Resource.
                </p>
                <label className="flex items-center gap-2 ui-caption text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={bulkPolicyUpdateOnlyExisting}
                    onChange={(event) => setBulkPolicyUpdateOnlyExisting(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  />
                  Only update statements that already exist (do not add new statements).
                </label>
              </div>
            )}
            {bulkOperation === "delete_policy" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Statement IDs (Sid) (comma, newline, or JSON array)
                  </label>
                  <textarea
                    value={bulkPolicyDeleteIds}
                    onChange={(event) => setBulkPolicyDeleteIds(event.target.value)}
                    rows={4}
                    placeholder='AllowRead, DenyWrite or ["AllowRead","DenyWrite"]'
                    className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Statement types
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {POLICY_TYPE_OPTIONS.map((option) => (
                      <label
                        key={option.key}
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        <input
                          type="checkbox"
                          checked={bulkPolicyDeleteTypes[option.key]}
                          onChange={(event) =>
                            setBulkPolicyDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Statements are deleted if the Sid matches or if any selected type is present.
                  </p>
                </div>
              </div>
            )}
            {bulkPreviewError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{bulkPreviewError}</p>}
            {bulkApplyError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{bulkApplyError}</p>}
            {bulkApplySummary && <p className="ui-caption font-semibold text-emerald-600 dark:text-emerald-200">{bulkApplySummary}</p>}
            {bulkApplyLoading && bulkApplyProgress && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
                  <span>
                    Processing {bulkApplyProgress.completed} / {bulkApplyProgress.total} buckets
                  </span>
                  <span>{bulkApplyProgressPercent}%</span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full bg-primary-500 transition-[width] duration-200" style={{ width: `${bulkApplyProgressPercent}%` }} />
                </div>
                {bulkApplyProgress.failed > 0 && (
                  <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                    Failures so far: {bulkApplyProgress.failed}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runBulkPreview}
                disabled={
                  bulkPreviewLoading ||
                  bulkApplyLoading ||
                  !bulkOperation ||
                  ((bulkOperation === "add_public_access_block" || bulkOperation === "remove_public_access_block") &&
                    !hasPublicAccessBlockTargetCriteria) ||
                  (bulkOperation === "add_lifecycle" && !bulkLifecycleRuleText.trim()) ||
                  (bulkOperation === "delete_lifecycle" && !hasDeleteCriteria) ||
                  (bulkOperation === "add_cors" && !bulkCorsRuleText.trim()) ||
                  (bulkOperation === "delete_cors" && !hasCorsDeleteCriteria) ||
                  (bulkOperation === "add_policy" && !bulkPolicyText.trim()) ||
                  (bulkOperation === "delete_policy" && !hasPolicyDeleteCriteria)
                }
                className="rounded-md bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bulkPreviewLoading ? "Previewing..." : "Preview"}
              </button>
              {bulkPreviewReady && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Changes: {previewStats.changed} / Unchanged: {previewStats.unchanged} / Errors: {previewStats.errors}
                </p>
              )}
            </div>
            {bulkPreview.length > 0 && (
              <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                  <thead className="bg-slate-100 dark:bg-slate-900/60">
                    <tr>
                      <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Bucket
                      </th>
                      <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Before
                      </th>
                      <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        After
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {bulkPreview.map((item) => (
                      <tr key={item.bucket} className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-3 font-semibold text-slate-900 dark:text-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="truncate">{item.bucket}</span>
                            {item.error ? (
                              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
                                Error
                              </span>
                            ) : item.changed ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100">
                                Change
                              </span>
                            ) : (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200">
                                No change
                              </span>
                            )}
                          </div>
                        </td>
                        {item.error ? (
                          <>
                            <td className="px-3 py-3 text-sm text-rose-600 dark:text-rose-200">{item.error}</td>
                            <td className="px-3 py-3 text-sm text-rose-600 dark:text-rose-200">{item.error}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-3">{renderPreviewLines(item.before)}</td>
                            <td className="px-3 py-3">{renderPreviewLines(item.after)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200"
                onClick={closeBulkUpdateModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={applyBulkUpdate}
                disabled={!bulkPreviewReady || bulkApplyLoading}
              >
                {bulkApplyLoading ? "Applying..." : "Apply changes"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {showTagEditor && (
        <Modal
          title="UI tags"
          onClose={() => {
            setShowTagEditor(false);
            setTagTargets([]);
            setTagInput("");
            setTagRemoveInput("");
          }}
          maxWidthClass="max-w-lg"
        >
          {tagTargets.length > 1 ? (
            <div className="space-y-4">
              <p className="ui-body text-slate-700 dark:text-slate-200">
                Add or remove UI tags for{" "}
                <span className="font-semibold">
                  {tagTargets.length} bucket{tagTargets.length > 1 ? "s" : ""}
                </span>
                . Existing tags are preserved.
              </p>
              <div className="space-y-2">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Add tags (comma separated)
                </label>
                <input
                  type="text"
                  value={tagInput}
                  list="ui-tag-options"
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="team-a, analytics, archived"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="space-y-2">
                <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Remove tags (comma separated)
                </label>
                <input
                  type="text"
                  value={tagRemoveInput}
                  list="ui-tag-options"
                  onChange={(e) => setTagRemoveInput(e.target.value)}
                  placeholder="archived, deprecated"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              {availableUiTags.length > 0 && (
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Existing tags
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {availableUiTags.map((tag) => (
                      <button
                        type="button"
                        key={tag}
                        onClick={() => setTagInput((prev) => (prev ? `${prev}, ${tag}` : tag))}
                        className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 ui-caption font-semibold text-amber-700 hover:border-amber-300 dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-full border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200"
                  onClick={() => {
                    setShowTagEditor(false);
                    setTagTargets([]);
                    setTagInput("");
                    setTagRemoveInput("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-full bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600"
                  onClick={applyTagsToTargets}
                >
                  Save tags
                </button>
              </div>
            </div>
          ) : (
          <div className="space-y-4">
            <p className="ui-body text-slate-700 dark:text-slate-200">
              Apply UI tags to{" "}
              <span className="font-semibold">
                {tagTargets.length} bucket{tagTargets.length > 1 ? "s" : ""}
              </span>
              .
            </p>
            <div className="space-y-2">
              <label className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Tags (comma separated)
              </label>
              <input
                type="text"
                value={tagInput}
                list="ui-tag-options"
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="team-a, analytics, archived"
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            {availableUiTags.length > 0 && (
              <div className="space-y-2">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Existing tags
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableUiTags.map((tag) => (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => setTagInput((prev) => (prev ? `${prev}, ${tag}` : tag))}
                      className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 ui-caption font-semibold text-amber-700 hover:border-amber-300 dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200"
                onClick={() => {
                  setShowTagEditor(false);
                  setTagTargets([]);
                  setTagInput("");
                  setTagRemoveInput("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600"
                onClick={applyTagsToTargets}
              >
                Save tags
              </button>
            </div>
          </div>
          )}
        </Modal>
      )}
    </div>
  );
}

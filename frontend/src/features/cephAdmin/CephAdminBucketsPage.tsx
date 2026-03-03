/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import Modal from "../../components/Modal";
import TableEmptyState from "../../components/TableEmptyState";
import SortableHeader from "../../components/SortableHeader";
import PaginationControls from "../../components/PaginationControls";
import PropertySummaryChip from "../../components/PropertySummaryChip";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  BucketProperties,
  CephAdminBucket,
  deleteCephAdminBucketLogging,
  deleteCephAdminBucketCors,
  deleteCephAdminBucketLifecycle,
  deleteCephAdminBucketPolicy,
  getCephAdminBucketCors,
  getCephAdminBucketEncryption,
  getCephAdminBucketLifecycle,
  getCephAdminBucketLogging,
  getCephAdminBucketPolicy,
  getCephAdminBucketProperties,
  getCephAdminBucketPublicAccessBlock,
  getCephAdminBucketWebsite,
  listCephAdminBuckets,
  putCephAdminBucketLogging,
  putCephAdminBucketCors,
  putCephAdminBucketLifecycle,
  putCephAdminBucketPolicy,
  setCephAdminBucketVersioning,
  updateCephAdminBucketObjectLock,
  updateCephAdminBucketPublicAccessBlock,
  updateCephAdminBucketQuota,
} from "../../api/cephAdmin";
import { tableActionMenuItemClasses } from "../../components/tableActionClasses";
import { parseCorsRules, parseLifecycleRules, parsePolicyStatements, parseRuleIds, stableStringify } from "./bucketJsonParsers";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import { useCephAdminBucketListing } from "./useCephAdminBucketListing";
import CephAdminBucketCompareModal from "./CephAdminBucketCompareModal";
import BucketDetailPage from "../manager/BucketDetailPage";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import {
  buildFeatureDetailRules,
  clearFeatureDetailField,
  defaultFeatureDetailFilters,
  featureDetailSummary,
  featureDetailSummaryItems,
  hasFeatureDetailFilters,
  sanitizeFeatureDetailFilters,
  type FeatureDetailFilterKey,
  type FeatureDetailFilters,
  type NumericComparisonOpUi,
} from "./filtering/bucketAdvancedFilter";

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

const formatAdvancedSearchStage = (stage: string) => {
  if (!stage.trim()) return "";
  return stage
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const sanitizeExportFilenamePart = (value?: string | null) => {
  const normalized = (value ?? "").trim();
  const cleaned = normalized.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "buckets";
};

const csvEscape = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

const triggerDownload = (filename: string, content: string, mimeType: string) => {
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

function SpinnerIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`${className} animate-spin`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" className="opacity-30" stroke="currentColor" strokeWidth="2.5" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

const BULK_CONCURRENCY_LIMIT = 6;

type BulkOperation =
  | ""
  | "copy_configs"
  | "paste_configs"
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

type BulkCopyFeatureKey =
  | "quota"
  | "versioning"
  | "object_lock"
  | "public_access_block"
  | "lifecycle"
  | "cors"
  | "policy"
  | "access_logging";

type BulkCopyFeatureSelection = Record<BulkCopyFeatureKey, boolean>;

type BulkQuotaSnapshot = {
  maxSizeBytes: number | null;
  maxObjects: number | null;
};

type BulkObjectLockSnapshot = {
  enabled: boolean;
  mode: string | null;
  days: number | null;
  years: number | null;
};

type BulkAccessLoggingSnapshot = {
  enabled: boolean;
  target_bucket: string | null;
  target_prefix: string | null;
};

type BulkConfigClipboardBucket = {
  name: string;
  quota: BulkQuotaSnapshot | null;
  versioningEnabled: boolean | null;
  objectLock: BulkObjectLockSnapshot | null;
  publicAccessBlock: PublicAccessBlockState | null;
  lifecycleRules: Record<string, unknown>[] | null;
  corsRules: Record<string, unknown>[] | null;
  policy: Record<string, unknown> | null;
  accessLogging: BulkAccessLoggingSnapshot | null;
};

type BulkConfigClipboard = {
  version: 1;
  copiedAt: string;
  sourceEndpointId: number;
  sourceEndpointName: string | null;
  features: BulkCopyFeatureSelection;
  buckets: BulkConfigClipboardBucket[];
};

type BulkPastePlanItem = {
  sourceBucket: string;
  destinationBucket: string;
  sourceConfig: BulkConfigClipboardBucket;
};

type BulkPastePlan = {
  mode: "one_to_many" | "one_to_one" | null;
  mappings: BulkPastePlanItem[];
  error: string | null;
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

const normalizeObjectLockSnapshot = (value?: Record<string, unknown> | null): BulkObjectLockSnapshot => {
  const enabled = Boolean(value?.enabled);
  const rawMode = value?.mode;
  const mode = typeof rawMode === "string" && rawMode.trim() ? rawMode.trim() : null;
  const rawDays = value?.days;
  const rawYears = value?.years;
  const days = typeof rawDays === "number" && Number.isFinite(rawDays) ? rawDays : null;
  const years = typeof rawYears === "number" && Number.isFinite(rawYears) ? rawYears : null;
  return { enabled, mode, days, years };
};

const isObjectLockSnapshotEqual = (a: BulkObjectLockSnapshot, b: BulkObjectLockSnapshot) =>
  a.enabled === b.enabled &&
  a.mode === b.mode &&
  a.days === b.days &&
  a.years === b.years;

const formatObjectLockSnapshot = (value: BulkObjectLockSnapshot) =>
  JSON.stringify(
    {
      enabled: value.enabled,
      mode: value.mode,
      days: value.days,
      years: value.years,
    },
    null,
    2
  );

const normalizeAccessLoggingSnapshot = (value?: Record<string, unknown> | null): BulkAccessLoggingSnapshot => {
  const rawTargetBucket = value?.target_bucket;
  const rawTargetPrefix = value?.target_prefix;
  const target_bucket = typeof rawTargetBucket === "string" && rawTargetBucket.trim() ? rawTargetBucket.trim() : null;
  const target_prefix = typeof rawTargetPrefix === "string" && rawTargetPrefix.trim() ? rawTargetPrefix.trim() : null;
  const enabled = Boolean(value?.enabled && target_bucket);
  return { enabled, target_bucket, target_prefix };
};

const isAccessLoggingSnapshotEqual = (a: BulkAccessLoggingSnapshot, b: BulkAccessLoggingSnapshot) =>
  a.enabled === b.enabled && a.target_bucket === b.target_bucket && a.target_prefix === b.target_prefix;

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

const BULK_COPY_FEATURE_LABELS: Record<BulkCopyFeatureKey, string> = {
  quota: "Quota",
  versioning: "Versioning",
  object_lock: "Object Lock",
  public_access_block: "Block public access",
  lifecycle: "Lifecycle rules",
  cors: "CORS",
  policy: "Bucket policy",
  access_logging: "Access logging",
};

const DEFAULT_BULK_COPY_FEATURE_SELECTION: BulkCopyFeatureSelection = {
  quota: false,
  versioning: false,
  object_lock: false,
  public_access_block: false,
  lifecycle: false,
  cors: false,
  policy: false,
  access_logging: false,
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

const computeQuotaUsagePercent = (used?: number | null, quota?: number | null) => {
  const normalizedQuota = normalizeQuotaLimit(quota);
  if (normalizedQuota === null) return null;
  const safeUsed = Math.max(0, used ?? 0);
  if (normalizedQuota <= 0) return null;
  const percent = (safeUsed / normalizedQuota) * 100;
  if (!Number.isFinite(percent)) return null;
  return Math.max(0, percent);
};

const formatQuotaPercent = (value?: number | null) => {
  if (value === null || value === undefined) return null;
  if (value >= 100) return `${Math.round(value)}%`;
  if (value >= 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
};

type ColumnId =
  | "tenant"
  | "owner"
  | "owner_name"
  | "used_bytes"
  | "object_count"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "quota_usage_percent"
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
  | "server_side_encryption"
  | "lifecycle_expiration_days"
  | "lifecycle_noncurrent_expiration_days"
  | "lifecycle_transition_days"
  | "lifecycle_abort_multipart_days"
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
  | "access_logging"
  | "server_side_encryption";
type FeatureFilterState = "any" | "enabled" | "disabled" | "suspended" | "disabled_or_suspended";
type TextMatchMode = "contains" | "exact";
type AdvancedNumericField =
  | "minUsedBytes"
  | "maxUsedBytes"
  | "minObjects"
  | "maxObjects"
  | "minQuotaBytes"
  | "maxQuotaBytes"
  | "minQuotaObjects"
  | "maxQuotaObjects";
type OwnerNameScope = "any" | "account" | "user";
type AdvancedTextOrNumericField = "tenant" | "owner" | "ownerName" | "s3Tags" | AdvancedNumericField;
type ActiveFilterRemoveAction =
  | { type: "quick" }
  | { type: "tag_mode" }
  | { type: "tag"; tag: string }
  | { type: "advanced_text"; field: "tenant" | "owner" | "ownerName" | "s3Tags" }
  | { type: "advanced_owner_scope" }
  | { type: "advanced_numeric"; field: AdvancedNumericField }
  | { type: "advanced_feature"; feature: FeatureKey }
  | { type: "advanced_feature_detail"; field: FeatureDetailFilterKey };
type ActiveFilterSummaryItem = {
  id: string;
  label: string;
  remove: ActiveFilterRemoveAction;
};
type FilterCostLevel = "none" | "low" | "medium" | "high";

type FeatureTooltipState =
  | { status: "loading" }
  | { status: "ready"; lines: string[] }
  | { status: "error"; message: string };
type OwnerTooltipState =
  | { status: "loading" }
  | { status: "ready"; ownerName: string | null }
  | { status: "error"; message: string };

type AdvancedFilterState = {
  tenant: string;
  tenantMatchMode: TextMatchMode;
  owner: string;
  ownerMatchMode: TextMatchMode;
  ownerName: string;
  ownerNameMatchMode: TextMatchMode;
  ownerNameScope: OwnerNameScope;
  s3Tags: string;
  s3TagsMatchMode: TextMatchMode;
  minUsedBytes: string;
  maxUsedBytes: string;
  minObjects: string;
  maxObjects: string;
  minQuotaBytes: string;
  maxQuotaBytes: string;
  minQuotaObjects: string;
  maxQuotaObjects: string;
  features: Record<FeatureKey, FeatureFilterState>;
  featureDetails: FeatureDetailFilters;
};

const defaultAdvancedFilter: AdvancedFilterState = {
  tenant: "",
  tenantMatchMode: "contains",
  owner: "",
  ownerMatchMode: "contains",
  ownerName: "",
  ownerNameMatchMode: "contains",
  ownerNameScope: "any",
  s3Tags: "",
  s3TagsMatchMode: "contains",
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
    server_side_encryption: "any",
  },
  featureDetails: { ...defaultFeatureDetailFilters },
};

const FEATURE_LABELS: Record<FeatureKey, string> = {
  versioning: "Versioning",
  object_lock: "Object Lock",
  block_public_access: "Block public access",
  lifecycle_rules: "Lifecycle rules",
  static_website: "Static website",
  bucket_policy: "Bucket policy",
  cors: "CORS",
  access_logging: "Access logging",
  server_side_encryption: "Server-side encryption",
};

const FEATURE_STATE_OPTIONS: Array<{ id: FeatureKey; label: string }> = [
  { id: "versioning", label: "Versioning" },
  { id: "object_lock", label: "Object Lock" },
  { id: "block_public_access", label: "Block public access" },
  { id: "lifecycle_rules", label: "Lifecycle rules" },
  { id: "static_website", label: "Static website" },
  { id: "bucket_policy", label: "Bucket policy" },
  { id: "cors", label: "CORS" },
  { id: "access_logging", label: "Access logging" },
  { id: "server_side_encryption", label: "Server-side encryption" },
];
type FeatureDetailColumnOption = {
  id: ColumnId;
  label: string;
  feature: FeatureKey;
  include: string;
};
const FEATURE_DETAIL_COLUMN_OPTIONS: FeatureDetailColumnOption[] = [
  {
    id: "lifecycle_expiration_days",
    label: "Lifecycle expiration days",
    feature: "lifecycle_rules",
    include: "lifecycle_expiration_days",
  },
  {
    id: "lifecycle_noncurrent_expiration_days",
    label: "Lifecycle noncurrent expiration days",
    feature: "lifecycle_rules",
    include: "lifecycle_noncurrent_expiration_days",
  },
  {
    id: "lifecycle_transition_days",
    label: "Lifecycle transition days",
    feature: "lifecycle_rules",
    include: "lifecycle_transition_days",
  },
  {
    id: "lifecycle_abort_multipart_days",
    label: "Lifecycle abort multipart days",
    feature: "lifecycle_rules",
    include: "lifecycle_abort_multipart_days",
  },
];
const FEATURE_DETAIL_COLUMN_IDS = FEATURE_DETAIL_COLUMN_OPTIONS.map((option) => option.id);
const BOOLEAN_FILTER_OPTIONS: Array<{ value: "any" | "true" | "false"; label: string }> = [
  { value: "any", label: "Any" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const NUMERIC_FILTER_OPTIONS: NumericComparisonOpUi[] = ["=", "!=", ">", ">=", "<", "<="];

const formatFeatureFilterStateLabel = (state: FeatureFilterState) => {
  if (state === "disabled_or_suspended") return "Disabled or Suspended";
  return state.charAt(0).toUpperCase() + state.slice(1);
};

const formatTextMatchModeLabel = (mode: TextMatchMode) => (mode === "exact" ? "exact" : "contains");
const FILTER_COST_LABEL: Record<FilterCostLevel, string> = {
  none: "No additional cost",
  low: "Low cost",
  medium: "Medium cost",
  high: "High cost",
};

const FILTER_COST_ENABLED_DOTS: Record<FilterCostLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const FILTER_COST_DOT_CLASS: Record<Exclude<FilterCostLevel, "none">, string> = {
  low: "bg-emerald-500 dark:bg-emerald-300",
  medium: "bg-amber-500 dark:bg-amber-300",
  high: "bg-rose-500 dark:bg-rose-300",
};

const renderFilterCostIndicator = (level: FilterCostLevel, tooltip: string) => {
  const enabledDots = FILTER_COST_ENABLED_DOTS[level];
  const activeClass = level === "none" ? "" : FILTER_COST_DOT_CLASS[level];
  return (
    <span
      className="inline-flex items-center gap-1"
      title={tooltip}
      aria-label={tooltip}
    >
      {[0, 1, 2].map((idx) => (
        <span
          key={`${level}-${idx}`}
          className={`h-1.5 w-1.5 rounded-full ${idx < enabledDots ? activeClass : "bg-slate-300 dark:bg-slate-600"}`}
        />
      ))}
    </span>
  );
};

const parseS3TagExpressions = (value: string): string[] => {
  const seen = new Set<string>();
  const expressions: string[] = [];
  value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      expressions.push(item);
    });
  return expressions;
};

type ParsedExactListInput = {
  values: string[];
  listProvided: boolean;
};

const parseExactListInput = (value: string): ParsedExactListInput => {
  const raw = value.trim();
  if (!raw) return { values: [], listProvided: false };
  const listProvided = /[\n,]/.test(value);
  if (!listProvided) {
    return { values: [raw], listProvided: false };
  }
  const seen = new Set<string>();
  const values: string[] = [];
  value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      values.push(item);
    });
  return { values, listProvided: true };
};

const buildTextFieldRules = (
  field: "name" | "tenant" | "owner" | "owner_name",
  rawValue: string,
  mode: TextMatchMode
): Array<Record<string, unknown>> => {
  const parsed = parseExactListInput(rawValue);
  if (parsed.values.length === 0) return [];
  if (parsed.listProvided) {
    if (parsed.values.length === 1) {
      return [{ field, op: "eq", value: parsed.values[0] }];
    }
    return [{ field, op: "in", value: parsed.values }];
  }
  return [{ field, op: mode === "exact" ? "eq" : "contains", value: parsed.values[0] }];
};

const formatTextFilterSummary = (
  label: string,
  rawValue: string,
  mode: TextMatchMode
) => {
  const parsed = parseExactListInput(rawValue);
  if (parsed.values.length === 0) return null;
  if (parsed.listProvided) {
    const preview = formatBucketNamesPreview(parsed.values, 2);
    return `${label} exact list: ${preview}`;
  }
  return `${label} ${formatTextMatchModeLabel(mode)}: ${parsed.values[0]}`;
};

const serializeS3TagExpressions = (values: string[]) =>
  values
    .map((value) => value.toLowerCase())
    .sort((a, b) => a.localeCompare(b))
    .join("\u001f");

const buildAdvancedFilterPayload = (
  basicFilter: string,
  basicFilterMode: TextMatchMode,
  advanced: AdvancedFilterState | null,
  taggedBuckets: string[] | null,
  allowStatsFilters: boolean = true,
  featureSupport: Partial<Record<FeatureKey, boolean>> = {}
) => {
  const parsedBasicFilter = parseExactListInput(basicFilter);
  const trimmedFilter = parsedBasicFilter.values[0] ?? "";
  if (!advanced && !taggedBuckets) {
    if (parsedBasicFilter.values.length === 0) return undefined;
    if (!parsedBasicFilter.listProvided && basicFilterMode === "contains") return trimmedFilter;
    if (parsedBasicFilter.listProvided && parsedBasicFilter.values.length > 1) {
      return JSON.stringify({
        match: "all",
        rules: [{ field: "name", op: "in", value: parsedBasicFilter.values }],
      });
    }
    return JSON.stringify({
      match: "all",
      rules: [{ field: "name", op: "eq", value: trimmedFilter }],
    });
  }
  const rules: Array<Record<string, unknown>> = [];
  rules.push(...buildTextFieldRules("name", basicFilter, basicFilterMode));
  if (advanced) {
    rules.push(...buildTextFieldRules("tenant", advanced.tenant, advanced.tenantMatchMode));
    rules.push(...buildTextFieldRules("owner", advanced.owner, advanced.ownerMatchMode));
    rules.push(...buildTextFieldRules("owner_name", advanced.ownerName, advanced.ownerNameMatchMode));
    if (advanced.ownerNameScope !== "any") {
      rules.push({ field: "owner_kind", op: "eq", value: advanced.ownerNameScope });
    }
    const tagExpressions = parseS3TagExpressions(advanced.s3Tags);
    if (tagExpressions.length > 0) {
      const parsedS3Tags = parseExactListInput(advanced.s3Tags);
      const tagsForceExact = parsedS3Tags.listProvided && parsedS3Tags.values.length > 0;
      const tagOp = tagsForceExact || advanced.s3TagsMatchMode === "exact" ? "eq" : "contains";
      tagExpressions.forEach((expression) => {
        rules.push({ field: "tag", op: tagOp, value: expression });
      });
    }
    const addNumericRule = (field: string, op: string, raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return;
      rules.push({ field, op, value });
    };
    if (allowStatsFilters) {
      addNumericRule("used_bytes", "gte", advanced.minUsedBytes);
      addNumericRule("used_bytes", "lte", advanced.maxUsedBytes);
      addNumericRule("object_count", "gte", advanced.minObjects);
      addNumericRule("object_count", "lte", advanced.maxObjects);
      addNumericRule("quota_max_size_bytes", "gte", advanced.minQuotaBytes);
      addNumericRule("quota_max_size_bytes", "lte", advanced.maxQuotaBytes);
      addNumericRule("quota_max_objects", "gte", advanced.minQuotaObjects);
      addNumericRule("quota_max_objects", "lte", advanced.maxQuotaObjects);
    }

    (Object.keys(advanced.features) as FeatureKey[]).forEach((key) => {
      if (featureSupport[key] === false) return;
      const state = advanced.features[key];
      if (state === "any") return;
      rules.push({ feature: key, state });
    });
    rules.push(...buildFeatureDetailRules(advanced.featureDetails));
  }

  if (taggedBuckets) {
    rules.push({ field: "name", op: "in", value: taggedBuckets });
  }

  if (rules.length === 0) {
    return trimmedFilter ? trimmedFilter : undefined;
  }
  return JSON.stringify({ match: "all", rules });
};

const hasAdvancedFilters = (
  advanced: AdvancedFilterState | null,
  allowStatsFilters: boolean = true,
  featureSupport: Partial<Record<FeatureKey, boolean>> = {}
) => {
  if (!advanced) return false;
  if (
    advanced.tenant.trim() ||
    advanced.owner.trim() ||
    advanced.ownerName.trim() ||
    advanced.ownerNameScope !== "any" ||
    parseS3TagExpressions(advanced.s3Tags).length > 0
  ) {
    return true;
  }
  if (
    allowStatsFilters &&
    (
      advanced.minUsedBytes ||
      advanced.maxUsedBytes ||
      advanced.minObjects ||
      advanced.maxObjects ||
      advanced.minQuotaBytes ||
      advanced.maxQuotaBytes ||
      advanced.minQuotaObjects ||
      advanced.maxQuotaObjects
    )
  ) {
    return true;
  }
  if (
    (Object.keys(advanced.features) as FeatureKey[]).some(
      (feature) => featureSupport[feature] !== false && advanced.features[feature] !== "any"
    )
  ) {
    return true;
  }
  return hasFeatureDetailFilters(advanced.featureDetails);
};

const COLUMNS_STORAGE_KEY = "ceph-admin.bucket_list.columns.v1";
const UI_TAGS_STORAGE_KEY = "ceph-admin.bucket_list.ui_tags.v1";
const BUCKETS_STATE_STORAGE_KEY = "ceph-admin.bucket_list.state.v1";
const BULK_CONFIG_CLIPBOARD_STORAGE_KEY = "ceph-admin.bucket_list.bulk_config_clipboard.v1";
const BUCKET_UI_TAG_KEY_SEPARATOR = "\u001f";
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_SORT: { field: SortField; direction: "asc" | "desc" } = { field: "name", direction: "asc" };
const defaultVisibleColumns: ColumnId[] = ["ui_tags", "owner", "used_bytes", "object_count"];

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
      "quota_usage_percent",
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
      "server_side_encryption",
      "lifecycle_expiration_days",
      "lifecycle_noncurrent_expiration_days",
      "lifecycle_transition_days",
      "lifecycle_abort_multipart_days",
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

const loadBulkConfigClipboard = (): BulkConfigClipboard | null => {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(BULK_CONFIG_CLIPBOARD_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BulkConfigClipboard> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const sourceEndpointId = Number(parsed.sourceEndpointId);
    if (!Number.isFinite(sourceEndpointId) || sourceEndpointId <= 0) return null;
    const rawFeatures = (parsed.features ?? {}) as Partial<Record<BulkCopyFeatureKey, unknown>>;
    const features: BulkCopyFeatureSelection = {
      quota: rawFeatures.quota === true,
      versioning: rawFeatures.versioning === true,
      object_lock: rawFeatures.object_lock === true,
      public_access_block: rawFeatures.public_access_block === true,
      lifecycle: rawFeatures.lifecycle === true,
      cors: rawFeatures.cors === true,
      policy: rawFeatures.policy === true,
      access_logging: rawFeatures.access_logging === true,
    };
    const bucketsRaw = Array.isArray(parsed.buckets) ? parsed.buckets : [];
    const byName = new Map<string, BulkConfigClipboardBucket>();
    bucketsRaw.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const rawName = (entry as { name?: unknown }).name;
      if (typeof rawName !== "string" || !rawName.trim()) return;
      const name = rawName.trim();
      const parseRules = (value: unknown): Record<string, unknown>[] | null => {
        if (!Array.isArray(value)) return null;
        return value.filter(
          (rule): rule is Record<string, unknown> => Boolean(rule) && typeof rule === "object" && !Array.isArray(rule)
        );
      };
      const rawQuota = (entry as { quota?: unknown }).quota;
      const quota =
        rawQuota && typeof rawQuota === "object"
          ? {
              maxSizeBytes: normalizeQuotaLimit((rawQuota as { maxSizeBytes?: number | null }).maxSizeBytes),
              maxObjects: normalizeQuotaLimit((rawQuota as { maxObjects?: number | null }).maxObjects),
            }
          : null;
      const rawVersioning = (entry as { versioningEnabled?: unknown }).versioningEnabled;
      const versioningEnabled = typeof rawVersioning === "boolean" ? rawVersioning : null;
      const rawObjectLock = (entry as { objectLock?: unknown }).objectLock;
      const objectLock =
        rawObjectLock && typeof rawObjectLock === "object"
          ? normalizeObjectLockSnapshot(rawObjectLock as Record<string, unknown>)
          : null;
      const rawPublicAccessBlock = (entry as { publicAccessBlock?: unknown }).publicAccessBlock;
      const publicAccessBlock =
        rawPublicAccessBlock && typeof rawPublicAccessBlock === "object"
          ? normalizePublicAccessBlockState(rawPublicAccessBlock as Partial<PublicAccessBlockState>)
          : null;
      const lifecycleRules = parseRules((entry as { lifecycleRules?: unknown }).lifecycleRules);
      const corsRules = parseRules((entry as { corsRules?: unknown }).corsRules);
      const rawPolicy = (entry as { policy?: unknown }).policy;
      const policy = rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy)
        ? (rawPolicy as Record<string, unknown>)
        : null;
      const rawAccessLogging = (entry as { accessLogging?: unknown }).accessLogging;
      const accessLogging =
        rawAccessLogging && typeof rawAccessLogging === "object"
          ? normalizeAccessLoggingSnapshot(rawAccessLogging as Record<string, unknown>)
          : null;
      byName.set(name.toLowerCase(), {
        name,
        quota,
        versioningEnabled,
        objectLock,
        publicAccessBlock,
        lifecycleRules,
        corsRules,
        policy,
        accessLogging,
      });
    });
    const buckets = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (buckets.length === 0) return null;
    const sourceEndpointName =
      typeof parsed.sourceEndpointName === "string" && parsed.sourceEndpointName.trim()
        ? parsed.sourceEndpointName.trim()
        : null;
    const copiedAt =
      typeof parsed.copiedAt === "string" && !Number.isNaN(Date.parse(parsed.copiedAt))
        ? parsed.copiedAt
        : new Date().toISOString();
    return {
      version: 1,
      copiedAt,
      sourceEndpointId,
      sourceEndpointName,
      features,
      buckets,
    };
  } catch {
    return null;
  }
};

const persistBulkConfigClipboard = (value: BulkConfigClipboard | null) => {
  if (typeof window === "undefined") return;
  if (!value) {
    localStorage.removeItem(BULK_CONFIG_CLIPBOARD_STORAGE_KEY);
    return;
  }
  localStorage.setItem(BULK_CONFIG_CLIPBOARD_STORAGE_KEY, JSON.stringify(value));
};

type BucketUiTags = Record<string, string[]>;
type BucketTagTarget = { key: string; name: string; tenant: string | null };

const buildBucketUiTagKey = (bucketName: string, tenant?: string | null) => {
  const normalizedName = bucketName.trim();
  const normalizedTenant = (tenant ?? "").trim();
  return `${normalizedTenant}${BUCKET_UI_TAG_KEY_SEPARATOR}${normalizedName}`;
};

const parseBucketUiTagKey = (value: string): { name: string; tenant: string | null } | null => {
  if (typeof value !== "string") return null;
  const separatorIndex = value.indexOf(BUCKET_UI_TAG_KEY_SEPARATOR);
  if (separatorIndex < 0) return null;
  const tenantPart = value.slice(0, separatorIndex).trim();
  const namePart = value.slice(separatorIndex + BUCKET_UI_TAG_KEY_SEPARATOR.length).trim();
  if (!namePart) return null;
  return { name: namePart, tenant: tenantPart || null };
};

const toBucketTagTarget = (bucketName: string, tenant?: string | null): BucketTagTarget => {
  const name = bucketName.trim();
  const normalizedTenant = (tenant ?? "").trim();
  const tenantValue = normalizedTenant || null;
  return {
    key: buildBucketUiTagKey(name, tenantValue),
    name,
    tenant: tenantValue,
  };
};

const formatBucketNamesPreview = (names: string[], max: number = 8) => {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} (+${names.length - max} more)`;
};

const normalizeUiTagValues = (values: string[]) => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });
  return normalized;
};

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
      const parsedKey = parseBucketUiTagKey(key);
      if (!parsedKey) return;
      const normalizedKey = buildBucketUiTagKey(parsedKey.name, parsedKey.tenant);
      const items = normalizeUiTagValues(value as string[]);
      if (items.length > 0) {
        cleaned[normalizedKey] = normalizeUiTagValues([...(cleaned[normalizedKey] ?? []), ...items]);
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
  quickFilterMode: TextMatchMode;
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
  const parseMatchMode = (input: unknown): TextMatchMode => (input === "exact" ? "exact" : "contains");
  const parseOwnerNameScope = (input: unknown): OwnerNameScope => {
    if (input === "account" || input === "user") return input;
    return "any";
  };
  return {
    tenant: safeString(data.tenant),
    tenantMatchMode: parseMatchMode(data.tenantMatchMode),
    owner: safeString(data.owner),
    ownerMatchMode: parseMatchMode(data.ownerMatchMode),
    ownerName: safeString(data.ownerName),
    ownerNameMatchMode: parseMatchMode(data.ownerNameMatchMode),
    ownerNameScope: parseOwnerNameScope(data.ownerNameScope),
    s3Tags: safeString(data.s3Tags),
    s3TagsMatchMode: parseMatchMode(data.s3TagsMatchMode),
    minUsedBytes: safeString(data.minUsedBytes),
    maxUsedBytes: safeString(data.maxUsedBytes),
    minObjects: safeString(data.minObjects),
    maxObjects: safeString(data.maxObjects),
    minQuotaBytes: safeString(data.minQuotaBytes),
    maxQuotaBytes: safeString(data.maxQuotaBytes),
    minQuotaObjects: safeString(data.minQuotaObjects),
    maxQuotaObjects: safeString(data.maxQuotaObjects),
    features,
    featureDetails: sanitizeFeatureDetailFilters(data.featureDetails),
  };
};

const stripUnsupportedAdvancedFeatureFilters = (
  value: AdvancedFilterState,
  featureSupport: Partial<Record<FeatureKey, boolean>>
): AdvancedFilterState => {
  let changed = false;
  const nextFeatures: Record<FeatureKey, FeatureFilterState> = { ...value.features };
  (Object.keys(nextFeatures) as FeatureKey[]).forEach((feature) => {
    if (featureSupport[feature] !== false) return;
    if (nextFeatures[feature] === "any") return;
    nextFeatures[feature] = "any";
    changed = true;
  });
  if (!changed) return value;
  return { ...value, features: nextFeatures };
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
      quickFilterMode: data.quickFilterMode === "exact" ? "exact" : "contains",
      advancedApplied: data.advancedApplied ? sanitizeAdvancedFilter(data.advancedApplied) : null,
      tagFilters: normalizeUiTagValues(sanitizeStringArray(data.tagFilters) as string[]),
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
  return normalizeUiTagValues(value.split(","));
};

const mergeUiTags = (existing: string[], incoming: string[]) => {
  return normalizeUiTagValues([...existing, ...incoming]);
};

const normalizeBucketName = (value: string) => value.trim().toLowerCase();
const areStringMapEqual = (a: Record<string, string>, b: Record<string, string>) => {
  const aKeys = Object.keys(a).sort((x, y) => x.localeCompare(y));
  const bKeys = Object.keys(b).sort((x, y) => x.localeCompare(y));
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    const key = aKeys[i];
    if (key !== bKeys[i]) return false;
    if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  }
  return true;
};
const ownerFilterFromSearch = (search: string) => {
  if (!search) return null;
  const value = new URLSearchParams(search).get("owner");
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const getTagColors = (tag: string) => {
  const hue = Array.from(tag).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;
  return {
    background: `hsl(${hue} 70% 90% / 0.9)`,
    text: `hsl(${hue} 60% 30%)`,
    border: `hsl(${hue} 60% 70% / 0.7)`,
  };
};

export default function CephAdminBucketsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { generalSettings } = useGeneralSettings();
  const { selectedEndpointId, selectedEndpoint, endpoints } = useCephAdminEndpoint();
  const cephAdminBrowserEnabled = generalSettings.browser_enabled && generalSettings.browser_ceph_admin_enabled;
  const usageFeatureEnabled = selectedEndpoint?.capabilities?.metrics !== false;
  const staticWebsiteFeatureEnabled = selectedEndpoint?.capabilities?.static_website === true;
  const sseFeatureEnabled = selectedEndpoint?.capabilities?.sse !== false;
  const featureSupport = useMemo<Record<FeatureKey, boolean>>(
    () => ({
      versioning: true,
      object_lock: true,
      block_public_access: true,
      lifecycle_rules: true,
      static_website: staticWebsiteFeatureEnabled,
      bucket_policy: true,
      cors: true,
      access_logging: true,
      server_side_encryption: sseFeatureEnabled,
    }),
    [staticWebsiteFeatureEnabled, sseFeatureEnabled]
  );
  const featureStateOptions = useMemo(
    () => FEATURE_STATE_OPTIONS.map((option) => ({ ...option, supported: featureSupport[option.id] !== false })),
    [featureSupport]
  );
  const [filter, setFilter] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(loadVisibleColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [expandedFeatureColumnGroups, setExpandedFeatureColumnGroups] = useState<Partial<Record<FeatureKey, boolean>>>({
    lifecycle_rules: true,
  });
  const columnPickerRef = useRef<HTMLDivElement | null>(null);
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedFilterState>(defaultAdvancedFilter);
  const [advancedApplied, setAdvancedApplied] = useState<AdvancedFilterState | null>(null);
  const [uiTags, setUiTags] = useState<BucketUiTags>(() => loadUiTags(selectedEndpointId));
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagFilterMode, setTagFilterMode] = useState<"any" | "all">("any");
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());
  const [editingBucketName, setEditingBucketName] = useState<string | null>(null);
  const [allFilteredBucketNames, setAllFilteredBucketNames] = useState<string[] | null>(null);
  const [allFilteredBucketNamesKey, setAllFilteredBucketNamesKey] = useState<string | null>(null);
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [orphanedTagBuckets, setOrphanedTagBuckets] = useState<string[]>([]);
  const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [bulkOperation, setBulkOperation] = useState<BulkOperation>("");
  const [bulkConfigClipboard, setBulkConfigClipboard] = useState<BulkConfigClipboard | null>(loadBulkConfigClipboard);
  const [bulkCopyFeatures, setBulkCopyFeatures] = useState<BulkCopyFeatureSelection>(DEFAULT_BULK_COPY_FEATURE_SELECTION);
  const [bulkCopyLoading, setBulkCopyLoading] = useState(false);
  const [bulkCopyError, setBulkCopyError] = useState<string | null>(null);
  const [bulkCopySummary, setBulkCopySummary] = useState<string | null>(null);
  const [bulkPasteMapping, setBulkPasteMapping] = useState<Record<string, string>>({});
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
  const [selectionTagActionLoading, setSelectionTagActionLoading] = useState<"add" | "remove" | null>(null);
  const [selectionTagAddInput, setSelectionTagAddInput] = useState("");
  const [selectionExportLoading, setSelectionExportLoading] = useState<"text" | "csv" | "json" | null>(null);
  const [tagSuggestionBucket, setTagSuggestionBucket] = useState<string | null>(null);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [activeOwnerTooltipKey, setActiveOwnerTooltipKey] = useState<string | null>(null);
  const [ownerTooltipState, setOwnerTooltipState] = useState<Record<string, OwnerTooltipState>>({});
  const ownerTooltipInflightRef = useRef<Record<string, Promise<void>>>({});
  const ownerNameCacheRef = useRef<Record<string, string | null>>({});
  const [activeFeatureTooltipKey, setActiveFeatureTooltipKey] = useState<string | null>(null);
  const [featureTooltipState, setFeatureTooltipState] = useState<Record<string, FeatureTooltipState>>({});
  const featureTooltipInflightRef = useRef<Record<string, Promise<void>>>({});
  const bucketPropertiesCacheRef = useRef<Record<string, BucketProperties>>({});
  const bucketPropertiesInflightRef = useRef<Record<string, Promise<BucketProperties>>>({});
  const selectionHeaderRef = useRef<HTMLInputElement | null>(null);
  const restoreFilterRef = useRef<string | null>(null);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>(DEFAULT_SORT);
  const taggedBucketTargets = useMemo(() => {
    const byKey = new Map<string, BucketTagTarget>();
    Object.entries(uiTags).forEach(([storageKey, tags]) => {
      if (!Array.isArray(tags) || tags.length === 0) return;
      const parsed = parseBucketUiTagKey(storageKey);
      if (!parsed) return;
      const target = toBucketTagTarget(parsed.name, parsed.tenant);
      byKey.set(target.key, target);
    });
    return Array.from(byKey.values());
  }, [uiTags]);
  const tagBucketSignature = useMemo(
    () =>
      taggedBucketTargets
        .map((target) => target.key)
        .sort((a, b) => a.localeCompare(b))
        .join("|"),
    [taggedBucketTargets]
  );
  const ownerQueryFilter = useMemo(() => ownerFilterFromSearch(location.search), [location.search]);

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
    setAdvancedDraft((prev) => stripUnsupportedAdvancedFeatureFilters(prev, featureSupport));
    setAdvancedApplied((prev) => (prev ? stripUnsupportedAdvancedFeatureFilters(prev, featureSupport) : prev));
  }, [featureSupport]);

  useEffect(() => {
    setVisibleColumns((prev) => {
      const next = prev.filter((column) => {
        if (column === "static_website") return staticWebsiteFeatureEnabled;
        if (column === "server_side_encryption") return sseFeatureEnabled;
        return true;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [staticWebsiteFeatureEnabled, sseFeatureEnabled]);

  useEffect(() => {
    if (!showAdvancedFilter) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAdvancedFilter(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showAdvancedFilter]);

  useEffect(() => {
    if (!showAdvancedFilter) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showAdvancedFilter]);

  useEffect(() => {
    setUiTags(loadUiTags(selectedEndpointId));
    setEditingBucketName(null);
    setSelectionTagActionLoading(null);
    setSelectionTagAddInput("");
    setSelectionExportLoading(null);
    setTagSuggestionBucket(null);
    setTagDrafts({});
    setActiveOwnerTooltipKey(null);
    setOwnerTooltipState({});
    ownerTooltipInflightRef.current = {};
    ownerNameCacheRef.current = {};
    setActiveFeatureTooltipKey(null);
    setFeatureTooltipState({});
    featureTooltipInflightRef.current = {};
    bucketPropertiesCacheRef.current = {};
    bucketPropertiesInflightRef.current = {};
    const stored = loadBucketListState(selectedEndpointId);
    if (ownerQueryFilter) {
      const ownerPrefill: AdvancedFilterState = {
        ...defaultAdvancedFilter,
        owner: ownerQueryFilter,
        ownerMatchMode: "exact",
      };
      restoreFilterRef.current = null;
      setFilter("");
      setFilterValue("");
      setQuickFilterMode("contains");
      setAdvancedApplied(ownerPrefill);
      setAdvancedDraft(ownerPrefill);
      setTagFilters([]);
      setTagFilterMode("any");
      setSelectedBuckets(new Set());
      setPage(1);
      setPageSize(stored?.pageSize ?? DEFAULT_PAGE_SIZE);
      setSort(stored?.sort ?? DEFAULT_SORT);
    } else if (stored) {
      restoreFilterRef.current = stored.filter;
      setFilter(stored.filter);
      setFilterValue(stored.filter.trim());
      setQuickFilterMode(stored.quickFilterMode);
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
      setQuickFilterMode("contains");
      setAdvancedApplied(null);
      setAdvancedDraft(defaultAdvancedFilter);
      setTagFilters([]);
      setTagFilterMode("any");
      setSelectedBuckets(new Set());
      setPage(1);
      setPageSize(DEFAULT_PAGE_SIZE);
      setSort(DEFAULT_SORT);
    }
  }, [selectedEndpointId, ownerQueryFilter]);

  useEffect(() => {
    persistUiTags(selectedEndpointId, uiTags);
  }, [uiTags, selectedEndpointId]);

  useEffect(() => {
    persistBulkConfigClipboard(bulkConfigClipboard);
  }, [bulkConfigClipboard]);

  useEffect(() => {
    if (!selectedEndpointId) return;
    persistBucketListState(selectedEndpointId, {
      filter,
      quickFilterMode,
      advancedApplied,
      tagFilters,
      tagFilterMode,
      selectedBuckets: Array.from(selectedBuckets),
      page,
      pageSize,
      sort,
    });
  }, [selectedEndpointId, filter, quickFilterMode, advancedApplied, tagFilters, tagFilterMode, selectedBuckets, page, pageSize, sort]);

  useEffect(() => {
    if (!selectedEndpointId || taggedBucketTargets.length === 0) {
      setOrphanedTagBuckets([]);
      return;
    }
    let active = true;
    const loadOrphanedTags = async () => {
      try {
        const knownBucketKeys = new Set<string>();
        const uniqueNames = Array.from(new Set(taggedBucketTargets.map((target) => target.name)));
        const chunkSize = 50;
        for (let start = 0; start < uniqueNames.length; start += chunkSize) {
          const chunk = uniqueNames.slice(start, start + chunkSize);
          const advancedFilter = JSON.stringify({
            match: "any",
            rules: [{ field: "name", op: "in", value: chunk }],
          });
          let nextPage = 1;
          while (true) {
            const response = await listCephAdminBuckets(selectedEndpointId, {
              page: nextPage,
              page_size: 200,
              advanced_filter: advancedFilter,
              with_stats: false,
            });
            if (!active) return;
            (response.items ?? []).forEach((bucket) => {
              const target = toBucketTagTarget(bucket.name, bucket.tenant);
              knownBucketKeys.add(target.key);
            });
            if (!response.has_next) break;
            nextPage += 1;
          }
        }
        if (!active) return;
        const missing = taggedBucketTargets
          .filter((target) => !knownBucketKeys.has(target.key))
          .map((target) => target.key)
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
  }, [selectedEndpointId, tagBucketSignature, taggedBucketTargets]);

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

  const featureColumnOptions = useMemo(
    () => featureStateOptions.filter((option) => option.supported).map((option) => ({ ...option, key: option.id })),
    [featureStateOptions]
  );
  const featureDetailColumnsByFeature = useMemo(() => {
    const supported = new Set(featureColumnOptions.map((option) => option.id));
    const groups: Partial<Record<FeatureKey, FeatureDetailColumnOption[]>> = {};
    FEATURE_DETAIL_COLUMN_OPTIONS.forEach((option) => {
      if (!supported.has(option.feature)) return;
      const current = groups[option.feature] ?? [];
      groups[option.feature] = [...current, option];
    });
    return groups;
  }, [featureColumnOptions]);
  const exportIncludeParams = useMemo(() => {
    const include = new Set<string>(["owner_name", "tags"]);
    featureColumnOptions.forEach((column) => include.add(column.id));
    FEATURE_DETAIL_COLUMN_OPTIONS.forEach((column) => include.add(column.include));
    return Array.from(include.values());
  }, [featureColumnOptions]);

  const includeParams = useMemo(() => {
    const include: string[] = [];
    if (visibleColumns.includes("owner_name")) include.push("owner_name");
    if (visibleColumns.includes("tags")) include.push("tags");
    featureColumnOptions.forEach(({ id }) => {
      if (visibleColumns.includes(id)) include.push(id);
    });
    FEATURE_DETAIL_COLUMN_OPTIONS.forEach((column) => {
      if (visibleColumns.includes(column.id)) include.push(column.include);
    });
    return include;
  }, [featureColumnOptions, visibleColumns]);

  const advancedStatsRequired = useMemo(() => {
    if (!usageFeatureEnabled || !advancedApplied) return false;
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
  }, [advancedApplied, usageFeatureEnabled]);

  const requiresStats = useMemo(() => {
    if (!usageFeatureEnabled) return false;
    if (advancedStatsRequired) return true;
    return (
      visibleColumns.includes("used_bytes") ||
      visibleColumns.includes("object_count") ||
      visibleColumns.includes("quota_max_size_bytes") ||
      visibleColumns.includes("quota_max_objects") ||
      visibleColumns.includes("quota_usage_percent") ||
      visibleColumns.includes("quota_status")
    );
  }, [advancedStatsRequired, usageFeatureEnabled, visibleColumns]);
  const sortRequiresStats = useMemo(() => sort.field === "used_bytes" || sort.field === "object_count", [sort.field]);
  const baseRequiresStats = useMemo(
    () => usageFeatureEnabled && (advancedStatsRequired || sortRequiresStats),
    [advancedStatsRequired, sortRequiresStats, usageFeatureEnabled]
  );
  const detailLoadingColumnIds = useMemo(() => {
    const ids = new Set<string>(includeParams);
    if (requiresStats && !baseRequiresStats) {
      ["used_bytes", "object_count", "quota_max_size_bytes", "quota_max_objects", "quota_usage_percent", "quota_status"].forEach((id) => ids.add(id));
    }
    return ids;
  }, [includeParams, requiresStats, baseRequiresStats]);

  const availableUiTags = useMemo(() => {
    const tags: string[] = [];
    Object.values(uiTags).forEach((bucketTags) => {
      tags.push(...normalizeUiTagValues(bucketTags));
    });
    return normalizeUiTagValues(tags).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [uiTags]);

  const taggedBuckets = useMemo(() => {
    if (tagFilters.length === 0) return null;
    const normalizedFilters = normalizeUiTagValues(tagFilters).map((tag) => tag.toLowerCase());
    const matchedNames = Object.entries(uiTags)
      .filter(([, tags]) => {
        const lowerTags = normalizeUiTagValues(tags).map((tag) => tag.toLowerCase());
        if (tagFilterMode === "all") {
          return normalizedFilters.every((filterTag) => lowerTags.includes(filterTag));
        }
        return normalizedFilters.some((filterTag) => lowerTags.includes(filterTag));
      })
      .map(([storageKey]) => parseBucketUiTagKey(storageKey)?.name ?? null)
      .filter((value): value is string => Boolean(value));
    const names = Array.from(new Set(matchedNames))
      .sort((a, b) => a.localeCompare(b));
    return names;
  }, [tagFilters, tagFilterMode, uiTags]);

  const quickFilterDraftParsed = useMemo(() => parseExactListInput(filter), [filter]);
  const quickFilterAppliedParsed = useMemo(() => parseExactListInput(filterValue), [filterValue]);
  const quickFilterDraftForcesExact = quickFilterDraftParsed.listProvided && quickFilterDraftParsed.values.length > 0;
  const quickFilterAppliedForcesExact = quickFilterAppliedParsed.listProvided && quickFilterAppliedParsed.values.length > 0;
  const quickFilterModeForDisplay: TextMatchMode = quickFilterDraftForcesExact ? "exact" : quickFilterMode;
  const effectiveQuickFilterMode: TextMatchMode = quickFilterAppliedForcesExact ? "exact" : quickFilterMode;
  const effectiveQuickSearchValue = effectiveQuickFilterMode === "contains" ? filterValue : "";
  const advancedFilterParam = useMemo(
    () =>
      buildAdvancedFilterPayload(
        effectiveQuickFilterMode === "exact" ? filterValue : "",
        effectiveQuickFilterMode,
        advancedApplied,
        taggedBuckets,
        usageFeatureEnabled,
        featureSupport
      ),
    [advancedApplied, filterValue, effectiveQuickFilterMode, taggedBuckets, usageFeatureEnabled, featureSupport]
  );

  const {
    items,
    total,
    loading,
    loadingDetails,
    advancedProgress,
    error,
    setError,
    refresh: refreshBuckets,
  } = useCephAdminBucketListing({
    selectedEndpointId,
    page,
    pageSize,
    filterValue: effectiveQuickSearchValue,
    advancedFilterParam,
    advancedSearchEnabled: Boolean(advancedFilterParam),
    sort,
    includeParams,
    requiresStats,
    baseRequiresStats,
    extractError,
  });

  const selectionQueryKey = useMemo(
    () =>
      JSON.stringify({
        endpoint: selectedEndpointId ?? null,
        filter: effectiveQuickSearchValue.trim() || null,
        quickFilterMode: effectiveQuickFilterMode,
        advanced: advancedFilterParam || null,
        withStats: baseRequiresStats,
      }),
    [selectedEndpointId, effectiveQuickSearchValue, effectiveQuickFilterMode, advancedFilterParam, baseRequiresStats]
  );

  useEffect(() => {
    setAllFilteredBucketNames(null);
    setAllFilteredBucketNamesKey(null);
    setSelectAllLoading(false);
  }, [selectionQueryKey]);

  useEffect(() => {
    if (allFilteredBucketNamesKey !== selectionQueryKey || !allFilteredBucketNames) return;
    if (total !== allFilteredBucketNames.length) {
      setAllFilteredBucketNames(null);
      setAllFilteredBucketNamesKey(null);
    }
  }, [allFilteredBucketNamesKey, allFilteredBucketNames, selectionQueryKey, total]);

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
  const toggleFeatureColumnGroup = (feature: FeatureKey) => {
    setExpandedFeatureColumnGroups((prev) => ({ ...prev, [feature]: !prev[feature] }));
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

  const loadAllFilteredBucketNames = async () => {
    if (!selectedEndpointId) return [];
    if (allFilteredBucketNamesKey === selectionQueryKey && allFilteredBucketNames) {
      return allFilteredBucketNames;
    }
    const names = new Set<string>();
    let nextPage = 1;
    let expectedTotal: number | null = null;
    while (true) {
      const response = await listCephAdminBuckets(selectedEndpointId, {
        page: nextPage,
        page_size: 200,
        filter: effectiveQuickSearchValue.trim() || undefined,
        advanced_filter: advancedFilterParam,
        sort_by: sort.field,
        sort_dir: sort.direction,
        with_stats: baseRequiresStats,
      });
      (response.items ?? []).forEach((bucket) => {
        if (bucket.name) names.add(bucket.name);
      });
      if (expectedTotal === null && typeof response.total === "number") {
        expectedTotal = response.total;
      }
      if (!response.has_next) {
        break;
      }
      if (expectedTotal !== null && names.size >= expectedTotal) {
        break;
      }
      nextPage += 1;
    }
    const resolved = Array.from(names.values());
    setAllFilteredBucketNames(resolved);
    setAllFilteredBucketNamesKey(selectionQueryKey);
    return resolved;
  };

  const setSelectionForFilteredResults = async (checked: boolean) => {
    if (!selectedEndpointId) return;
    setSelectAllLoading(true);
    try {
      const names = await loadAllFilteredBucketNames();
      setSelectedBuckets((prev) => {
        const next = new Set(prev);
        names.forEach((name) => {
          if (checked) {
            next.add(name);
          } else {
            next.delete(name);
          }
        });
        return next;
      });
    } catch (err) {
      console.error(err);
      setError(extractError(err));
    } finally {
      setSelectAllLoading(false);
    }
  };

  const clearSelection = () => {
    setSelectedBuckets(new Set());
    setBulkOperation("");
    setBulkCopyFeatures(DEFAULT_BULK_COPY_FEATURE_SELECTION);
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
    setBulkPasteMapping({});
    setBulkCopyError(null);
    setBulkCopySummary(null);
    setBulkPreview([]);
    setBulkPreviewError(null);
    setBulkPreviewReady(false);
    setBulkApplyError(null);
    setBulkApplySummary(null);
    setSelectionTagActionLoading(null);
    setSelectionTagAddInput("");
    setSelectionExportLoading(null);
  };

  const updateTagDraft = (bucketKey: string, value: string) => {
    setTagDrafts((prev) => ({ ...prev, [bucketKey]: value }));
  };

  const addTagFilter = (value: string) => {
    const parsed = parseUiTags(value);
    if (parsed.length === 0) return;
    setTagFilters((prev) => mergeUiTags(prev, parsed));
    setTagFilterInput("");
    setPage(1);
  };

  const removeTagFilter = (tag: string) => {
    const target = tag.trim().toLowerCase();
    setTagFilters((prev) => prev.filter((item) => item.trim().toLowerCase() !== target));
    setPage(1);
  };

  const addTagsForBucket = (target: BucketTagTarget, raw: string) => {
    const parsed = parseUiTags(raw);
    if (parsed.length === 0) return;
    setUiTags((prev) => {
      const existing = prev[target.key] ?? [];
      const merged = mergeUiTags(existing, parsed);
      return { ...prev, [target.key]: merged };
    });
  };

  const removeTagForBucket = (bucketTarget: BucketTagTarget, tag: string) => {
    const normalizedTag = tag.trim().toLowerCase();
    setUiTags((prev) => {
      const existing = normalizeUiTagValues(prev[bucketTarget.key] ?? []);
      const next = existing.filter((item) => item.toLowerCase() !== normalizedTag);
      const updated = { ...prev };
      if (next.length === 0) {
        delete updated[bucketTarget.key];
      } else {
        updated[bucketTarget.key] = next;
      }
      return updated;
    });
  };

  const selectedCount = selectedBuckets.size;
  const selectedOnPageCount = items.filter((bucket) => selectedBuckets.has(bucket.name)).length;
  const hasResolvedFilteredNames =
    allFilteredBucketNamesKey === selectionQueryKey && Array.isArray(allFilteredBucketNames) && allFilteredBucketNames.length > 0;
  const selectedOnFilteredCount = hasResolvedFilteredNames
    ? allFilteredBucketNames.reduce((count, bucketName) => count + (selectedBuckets.has(bucketName) ? 1 : 0), 0)
    : selectedOnPageCount;
  const allSelectedOnFiltered =
    hasResolvedFilteredNames && total > 0 && allFilteredBucketNames.length === total && selectedOnFilteredCount === total;
  const hiddenSelectedCount = Math.max(selectedCount - selectedOnPageCount, 0);
  const allSelectedOnPage = items.length > 0 && selectedOnPageCount === items.length;
  const headerChecked = hasResolvedFilteredNames ? allSelectedOnFiltered : allSelectedOnPage;
  const headerIndeterminate = hasResolvedFilteredNames
    ? selectedOnFilteredCount > 0 && !allSelectedOnFiltered
    : selectedOnPageCount > 0 && !allSelectedOnPage;

  useEffect(() => {
    if (!selectionHeaderRef.current) return;
    selectionHeaderRef.current.indeterminate = headerIndeterminate;
  }, [headerIndeterminate]);

  const resolveBucketTargetsByNames = async (bucketNames: string[]) => {
    if (!selectedEndpointId || bucketNames.length === 0) {
      return { targets: [] as BucketTagTarget[], missingNames: bucketNames };
    }
    const chunks: string[][] = [];
    const chunkSize = 50;
    for (let start = 0; start < bucketNames.length; start += chunkSize) {
      chunks.push(bucketNames.slice(start, start + chunkSize));
    }
    const chunkResults = await runWithConcurrency(chunks, 4, async (chunk) => {
      const resolved: BucketTagTarget[] = [];
      let nextPage = 1;
      const advancedFilter = JSON.stringify({
        match: "any",
        rules: [{ field: "name", op: "in", value: chunk }],
      });
      while (true) {
        const response = await listCephAdminBuckets(selectedEndpointId, {
          page: nextPage,
          page_size: 200,
          advanced_filter: advancedFilter,
          with_stats: false,
        });
        (response.items ?? []).forEach((bucket) => {
          resolved.push(toBucketTagTarget(bucket.name, bucket.tenant));
        });
        if (!response.has_next) break;
        nextPage += 1;
      }
      return resolved;
    });
    const targetByKey = new Map<string, BucketTagTarget>();
    const existingNames = new Set<string>();
    chunkResults.flat().forEach((target) => {
      targetByKey.set(target.key, target);
      existingNames.add(target.name);
    });
    const missingNames = bucketNames.filter((name) => !existingNames.has(name));
    const targets = Array.from(targetByKey.values()).sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return (a.tenant ?? "").localeCompare(b.tenant ?? "");
    });
    return { targets, missingNames };
  };

  const applyUiTagsToTargets = (
    targets: BucketTagTarget[],
    parsedAdd: string[],
    parsedRemove: string[]
  ) => {
    if (targets.length === 0) return;
    const removeSet = new Set(parsedRemove.map((tag) => tag.toLowerCase()));
    setUiTags((prev) => {
      const next = { ...prev };
      targets.forEach((target) => {
        let updated = prev[target.key] ?? [];
        if (parsedAdd.length > 0) {
          updated = mergeUiTags(updated, parsedAdd);
        }
        if (removeSet.size > 0) {
          updated = updated.filter((tag) => !removeSet.has(tag.toLowerCase()));
        }
        if (updated.length === 0) {
          delete next[target.key];
        } else {
          next[target.key] = updated;
        }
      });
      return next;
    });
  };

  const selectedBucketList = useMemo(
    () => Array.from(selectedBuckets.values()).sort((a, b) => a.localeCompare(b)),
    [selectedBuckets]
  );
  const selectedUiTagSuggestions = useMemo(() => {
    if (selectedBucketList.length === 0) return [];
    const selectedNames = new Set(selectedBucketList.map(normalizeBucketName));
    const tags: string[] = [];
    Object.entries(uiTags).forEach(([storageKey, bucketTags]) => {
      const parsed = parseBucketUiTagKey(storageKey);
      if (!parsed) return;
      if (!selectedNames.has(normalizeBucketName(parsed.name))) return;
      tags.push(...normalizeUiTagValues(bucketTags));
    });
    return normalizeUiTagValues(tags).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [selectedBucketList, uiTags]);
  const parsedSelectionTagAddInput = useMemo(() => parseUiTags(selectionTagAddInput), [selectionTagAddInput]);

  const applyUiTagToSelection = async (rawTag: string, action: "add" | "remove") => {
    if (!selectedEndpointId || selectedBucketList.length === 0 || selectionTagActionLoading) return;
    const parsedTagValues = parseUiTags(rawTag);
    if (parsedTagValues.length === 0) return;
    setSelectionTagActionLoading(action);
    try {
      const { targets, missingNames } = await resolveBucketTargetsByNames(selectedBucketList);
      if (targets.length === 0) {
        setError("Unable to resolve selected buckets for UI tag update.");
        return;
      }
      if (missingNames.length > 0) {
        setError(`Some selected buckets no longer exist: ${formatBucketNamesPreview(missingNames)}.`);
      }
      if (action === "add") {
        applyUiTagsToTargets(targets, parsedTagValues, []);
      } else {
        applyUiTagsToTargets(targets, [], parsedTagValues);
      }
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSelectionTagActionLoading(null);
    }
  };

  const bulkClipboardSourceBuckets = useMemo(
    () => (bulkConfigClipboard ? bulkConfigClipboard.buckets.map((bucket) => bucket.name) : []),
    [bulkConfigClipboard]
  );
  const bulkClipboardSameEndpoint = Boolean(
    bulkConfigClipboard && selectedEndpointId && bulkConfigClipboard.sourceEndpointId === selectedEndpointId
  );
  const bulkPastePlan = useMemo<BulkPastePlan>(() => {
    if (!bulkConfigClipboard) {
      return { mode: null, mappings: [], error: "No copied configuration available." };
    }
    if (!selectedEndpointId) {
      return { mode: null, mappings: [], error: "Select an endpoint first." };
    }
    const enabledFeatures = (Object.keys(bulkConfigClipboard.features) as BulkCopyFeatureKey[]).filter(
      (feature) => bulkConfigClipboard.features[feature]
    );
    if (enabledFeatures.length === 0) {
      return { mode: null, mappings: [], error: "Clipboard does not include any copied configuration." };
    }
    const sourceBuckets = bulkConfigClipboard.buckets;
    if (sourceBuckets.length === 0) {
      return { mode: null, mappings: [], error: "Copied selection is empty." };
    }
    if (selectedBucketList.length === 0) {
      return { mode: null, mappings: [], error: "Select destination buckets first." };
    }

    if (sourceBuckets.length === 1) {
      const source = sourceBuckets[0];
      if (bulkClipboardSameEndpoint) {
        const conflictingDestinations = selectedBucketList.filter(
          (destination) => normalizeBucketName(destination) === normalizeBucketName(source.name)
        );
        if (conflictingDestinations.length > 0) {
          return {
            mode: "one_to_many",
            mappings: [],
            error: `Copy/paste on the same bucket is not allowed: ${formatBucketNamesPreview(conflictingDestinations)}.`,
          };
        }
      }
      return {
        mode: "one_to_many",
        mappings: selectedBucketList.map((destinationBucket) => ({
          sourceBucket: source.name,
          destinationBucket,
          sourceConfig: source,
        })),
        error: null,
      };
    }

    if (sourceBuckets.length !== selectedBucketList.length) {
      return {
        mode: null,
        mappings: [],
        error: `Mapping impossible: source has ${sourceBuckets.length} bucket(s), destination has ${selectedBucketList.length}.`,
      };
    }

    const destinationByNormalized = new Map<string, string>();
    selectedBucketList.forEach((destination) => {
      destinationByNormalized.set(normalizeBucketName(destination), destination);
    });

    const usedDestinations = new Set<string>();
    const unresolvedSources: string[] = [];
    const duplicateDestinations: string[] = [];
    const invalidDestinations: string[] = [];
    const sameBucketConflicts: string[] = [];
    const mappings: BulkPastePlanItem[] = [];

    sourceBuckets.forEach((source) => {
      const selectedDestination = (bulkPasteMapping[source.name] ?? "").trim();
      if (!selectedDestination) {
        unresolvedSources.push(source.name);
        return;
      }
      const normalizedDestination = normalizeBucketName(selectedDestination);
      const destinationBucket = destinationByNormalized.get(normalizedDestination);
      if (!destinationBucket) {
        invalidDestinations.push(selectedDestination);
        return;
      }
      if (bulkClipboardSameEndpoint && normalizedDestination === normalizeBucketName(source.name)) {
        sameBucketConflicts.push(source.name);
        return;
      }
      if (usedDestinations.has(normalizedDestination)) {
        duplicateDestinations.push(destinationBucket);
        return;
      }
      usedDestinations.add(normalizedDestination);
      mappings.push({
        sourceBucket: source.name,
        destinationBucket,
        sourceConfig: source,
      });
    });

    if (unresolvedSources.length > 0) {
      return {
        mode: "one_to_one",
        mappings: [],
        error: `Complete the mapping for all source buckets (${unresolvedSources.length} missing).`,
      };
    }
    if (invalidDestinations.length > 0) {
      return {
        mode: "one_to_one",
        mappings: [],
        error: `Some mapped destinations are invalid: ${formatBucketNamesPreview(invalidDestinations)}.`,
      };
    }
    if (sameBucketConflicts.length > 0) {
      return {
        mode: "one_to_one",
        mappings: [],
        error: `Copy/paste on the same bucket is not allowed: ${formatBucketNamesPreview(sameBucketConflicts)}.`,
      };
    }
    if (duplicateDestinations.length > 0) {
      return {
        mode: "one_to_one",
        mappings: [],
        error: "Each destination bucket can only be used once in 1:1 mapping.",
      };
    }

    return { mode: "one_to_one", mappings, error: null };
  }, [bulkConfigClipboard, bulkClipboardSameEndpoint, bulkPasteMapping, selectedBucketList, selectedEndpointId]);

  useEffect(() => {
    if (!showBulkUpdateModal || bulkOperation !== "paste_configs" || !bulkConfigClipboard) return;
    const sourceBuckets = bulkConfigClipboard.buckets.map((bucket) => bucket.name);
    if (sourceBuckets.length <= 1 || sourceBuckets.length !== selectedBucketList.length) {
      setBulkPasteMapping((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const destinationByNormalized = new Map<string, string>();
    selectedBucketList.forEach((destination) => {
      destinationByNormalized.set(normalizeBucketName(destination), destination);
    });

    setBulkPasteMapping((prev) => {
      const next: Record<string, string> = {};
      const usedDestinations = new Set<string>();

      sourceBuckets.forEach((sourceBucket) => {
        const previousValue = (prev[sourceBucket] ?? "").trim();
        if (!previousValue) return;
        const normalizedDestination = normalizeBucketName(previousValue);
        const destination = destinationByNormalized.get(normalizedDestination);
        if (!destination) return;
        if (bulkClipboardSameEndpoint && normalizedDestination === normalizeBucketName(sourceBucket)) return;
        if (usedDestinations.has(normalizedDestination)) return;
        next[sourceBucket] = destination;
        usedDestinations.add(normalizedDestination);
      });

      if (!bulkClipboardSameEndpoint) {
        sourceBuckets.forEach((sourceBucket) => {
          if (next[sourceBucket]) return;
          const normalizedSource = normalizeBucketName(sourceBucket);
          const destination = destinationByNormalized.get(normalizedSource);
          if (!destination) return;
          if (usedDestinations.has(normalizedSource)) return;
          next[sourceBucket] = destination;
          usedDestinations.add(normalizedSource);
        });
      }

      return areStringMapEqual(prev, next) ? prev : next;
    });
  }, [bulkConfigClipboard, bulkClipboardSameEndpoint, bulkOperation, selectedBucketList, showBulkUpdateModal]);

  const loadSelectedBucketsForExport = async () => {
    const bucketsByName = new Map<string, CephAdminBucket>();
    items.forEach((bucket) => {
      if (selectedBuckets.has(bucket.name)) {
        bucketsByName.set(bucket.name, bucket);
      }
    });
    if (!selectedEndpointId || selectedBucketList.length === 0) {
      return bucketsByName;
    }

    const chunkSize = 50;
    for (let start = 0; start < selectedBucketList.length; start += chunkSize) {
      const chunk = selectedBucketList.slice(start, start + chunkSize);
      const advancedFilter = JSON.stringify({
        match: "any",
        rules: [{ field: "name", op: "in", value: chunk }],
      });
      let nextPage = 1;
      while (true) {
        const response = await listCephAdminBuckets(selectedEndpointId, {
          page: nextPage,
          page_size: 200,
          advanced_filter: advancedFilter,
          include: exportIncludeParams,
          with_stats: usageFeatureEnabled,
        });
        (response.items ?? []).forEach((bucket) => {
          if (selectedBuckets.has(bucket.name)) {
            bucketsByName.set(bucket.name, bucket);
          }
        });
        if (!response.has_next) break;
        nextPage += 1;
      }
    }

    return bucketsByName;
  };

  const buildExportColumns = (columnIds: ColumnId[]) => {
    const featureColumnById = new Map(featureColumnOptions.map((column) => [column.id, column]));
    const exportColumns: Array<{ id: string; label: string; getValue: (bucket: CephAdminBucket) => string }> = [
      { id: "name", label: "Name", getValue: (bucket) => bucket.name ?? "-" },
    ];

    columnIds.forEach((col) => {
      if (col === "tenant") {
        exportColumns.push({ id: col, label: "Tenant", getValue: (bucket) => bucket.tenant ?? "-" });
        return;
      }
      if (col === "owner") {
        exportColumns.push({ id: col, label: "Owner", getValue: (bucket) => bucket.owner ?? "-" });
        return;
      }
      if (col === "owner_name") {
        exportColumns.push({ id: col, label: "Owner name", getValue: (bucket) => bucket.owner_name ?? "-" });
        return;
      }
      if (col === "used_bytes") {
        exportColumns.push({ id: col, label: "Used", getValue: (bucket) => formatBytes(bucket.used_bytes) });
        return;
      }
      if (col === "quota_max_size_bytes") {
        exportColumns.push({
          id: col,
          label: "Quota",
          getValue: (bucket) => {
            const quota = normalizeQuotaLimit(bucket.quota_max_size_bytes);
            return quota !== null ? formatBytes(quota) : "-";
          },
        });
        return;
      }
      if (col === "object_count") {
        exportColumns.push({ id: col, label: "Objects", getValue: (bucket) => formatNumber(bucket.object_count) });
        return;
      }
      if (col === "quota_max_objects") {
        exportColumns.push({
          id: col,
          label: "Object quota",
          getValue: (bucket) => {
            const quota = normalizeQuotaLimit(bucket.quota_max_objects);
            return quota !== null ? formatNumber(quota) : "-";
          },
        });
        return;
      }
      if (col === "quota_usage_percent") {
        exportColumns.push({
          id: col,
          label: "Quota usage %",
          getValue: (bucket) => {
            const sizePercent = computeQuotaUsagePercent(bucket.used_bytes, bucket.quota_max_size_bytes);
            const objectPercent = computeQuotaUsagePercent(bucket.object_count, bucket.quota_max_objects);
            if (sizePercent === null && objectPercent === null) return "-";
            const parts: string[] = [];
            if (sizePercent !== null) parts.push(`Size: ${formatQuotaPercent(sizePercent)}`);
            if (objectPercent !== null) parts.push(`Obj: ${formatQuotaPercent(objectPercent)}`);
            return parts.join("; ");
          },
        });
        return;
      }
      if (col === "tags") {
        exportColumns.push({
          id: col,
          label: "Tags",
          getValue: (bucket) => {
            const tags = Array.isArray(bucket.tags) ? bucket.tags : [];
            if (tags.length === 0) return "-";
            return tags
              .filter((tag) => (tag.key ?? "").trim())
              .map((tag) => `${tag.key}=${tag.value}`)
              .join(", ");
          },
        });
        return;
      }
      if (col === "ui_tags") {
        exportColumns.push({
          id: col,
          label: "UI tags",
          getValue: (bucket) => {
            const key = toBucketTagTarget(bucket.name, bucket.tenant).key;
            const tags = uiTags[key] ?? [];
            return tags.length > 0 ? tags.join(", ") : "-";
          },
        });
        return;
      }
      if (col === "quota_status") {
        exportColumns.push({
          id: col,
          label: "Quota status",
          getValue: (bucket) => (quotaConfigured(bucket) ? "Configured" : "Not set"),
        });
        return;
      }
      if (col === "lifecycle_expiration_days") {
        exportColumns.push({
          id: col,
          label: "Lifecycle expiration days",
          getValue: (bucket) => formatLifecycleDayDetail(bucket, "lifecycle_expiration_days"),
        });
        return;
      }
      if (col === "lifecycle_noncurrent_expiration_days") {
        exportColumns.push({
          id: col,
          label: "Lifecycle noncurrent expiration days",
          getValue: (bucket) => formatLifecycleDayDetail(bucket, "lifecycle_noncurrent_expiration_days"),
        });
        return;
      }
      if (col === "lifecycle_transition_days") {
        exportColumns.push({
          id: col,
          label: "Lifecycle transition days",
          getValue: (bucket) => formatLifecycleDayDetail(bucket, "lifecycle_transition_days"),
        });
        return;
      }
      if (col === "lifecycle_abort_multipart_days") {
        exportColumns.push({
          id: col,
          label: "Lifecycle abort multipart days",
          getValue: (bucket) => formatLifecycleDayDetail(bucket, "lifecycle_abort_multipart_days"),
        });
        return;
      }
      const featureColumn = featureColumnById.get(col);
      if (featureColumn) {
        exportColumns.push({
          id: col,
          label: featureColumn.label,
          getValue: (bucket) => bucket.features?.[featureColumn.key]?.state ?? "-",
        });
      }
    });

    return exportColumns;
  };

  const exportSelectedBuckets = async (format: "text" | "csv" | "json") => {
    if (selectedBucketList.length === 0 || selectionExportLoading) return;
    setSelectionExportLoading(format);
    try {
      const exportedAt = new Date().toISOString();
      const timestamp = exportedAt.replace(/[:.]/g, "-");
      const endpointPart = sanitizeExportFilenamePart(
        selectedEndpoint?.name ?? (selectedEndpointId ? `endpoint-${selectedEndpointId}` : "endpoint")
      );

      if (format === "text") {
        triggerDownload(
          `ceph-admin-buckets-${endpointPart}-${timestamp}.txt`,
          selectedBucketList.join("\n"),
          "text/plain;charset=utf-8"
        );
        return;
      }

      const bucketsByName = await loadSelectedBucketsForExport();
      const exportColumns = buildExportColumns(visibleColumns);
      if (format === "csv") {
        const lines = [
          exportColumns.map((column) => csvEscape(column.label)).join(","),
          ...selectedBucketList.map((bucketName) => {
            const bucket = bucketsByName.get(bucketName);
            const values = exportColumns.map((column) => (bucket ? column.getValue(bucket) : "-"));
            return values.map((value) => csvEscape(String(value ?? "-"))).join(",");
          }),
        ];
        triggerDownload(
          `ceph-admin-buckets-${endpointPart}-${timestamp}.csv`,
          lines.join("\n"),
          "text/csv;charset=utf-8"
        );
        return;
      }

      const jsonPayload = {
        generated_at: exportedAt,
        endpoint: {
          id: selectedEndpointId ?? null,
          name: selectedEndpoint?.name ?? null,
        },
        items: selectedBucketList.map((bucketName) => {
          const bucket = bucketsByName.get(bucketName);
          const row: Record<string, string> = {};
          exportColumns.forEach((column) => {
            row[column.id] = bucket ? column.getValue(bucket) : "-";
          });
          return row;
        }),
      };
      triggerDownload(
        `ceph-admin-buckets-${endpointPart}-${timestamp}.json`,
        JSON.stringify(jsonPayload, null, 2),
        "application/json"
      );
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSelectionExportLoading(null);
    }
  };

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
    bulkCopyFeatures,
    bulkPasteMapping,
    bulkConfigClipboard,
    selectedBuckets,
    showBulkUpdateModal,
  ]);

  useEffect(() => {
    if (!usageFeatureEnabled && bulkOperation === "set_quota") {
      setBulkOperation("");
    }
  }, [bulkOperation, usageFeatureEnabled]);

  const openBulkUpdateModal = () => {
    setShowBulkUpdateModal(true);
    setBulkOperation("");
    setBulkCopyFeatures(DEFAULT_BULK_COPY_FEATURE_SELECTION);
    setBulkCopyError(null);
    setBulkCopySummary(null);
    setBulkPasteMapping({});
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
    setBulkCopyError(null);
    setBulkCopySummary(null);
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
      with_stats: usageFeatureEnabled,
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

  const copyBulkConfigs = async () => {
    if (!selectedEndpointId || selectedBucketList.length === 0) return;
    const selectedFeatures = (Object.keys(bulkCopyFeatures) as BulkCopyFeatureKey[]).filter(
      (feature) => bulkCopyFeatures[feature]
    );
    if (selectedFeatures.length === 0) {
      setBulkCopyError("Select at least one configuration to copy.");
      return;
    }
    setBulkCopyLoading(true);
    setBulkCopyError(null);
    setBulkCopySummary(null);
    try {
      const results = await runWithConcurrencySettled(
        selectedBucketList,
        BULK_CONCURRENCY_LIMIT,
        async (bucketName) => {
          let props: BucketProperties | null = null;
          if (bulkCopyFeatures.versioning || bulkCopyFeatures.object_lock) {
            props = await getCephAdminBucketProperties(selectedEndpointId, bucketName);
          }
          const quota = bulkCopyFeatures.quota ? await fetchBucketQuota(bucketName) : null;
          const versioningEnabled = bulkCopyFeatures.versioning
            ? normalizeVersioningStatus(props?.versioning_status) === true
            : null;
          const rawObjectLock =
            props?.object_lock && typeof props.object_lock === "object"
              ? (props.object_lock as Record<string, unknown>)
              : {};
          const objectLock = bulkCopyFeatures.object_lock
            ? normalizeObjectLockSnapshot({
                ...rawObjectLock,
                enabled: Boolean(props?.object_lock_enabled ?? rawObjectLock.enabled),
              })
            : null;
          const publicAccessBlock = bulkCopyFeatures.public_access_block
            ? normalizePublicAccessBlockState(await getCephAdminBucketPublicAccessBlock(selectedEndpointId, bucketName))
            : null;
          const lifecycleRules = bulkCopyFeatures.lifecycle
            ? ((await getCephAdminBucketLifecycle(selectedEndpointId, bucketName)).rules ?? []) as Record<string, unknown>[]
            : null;
          const corsRules = bulkCopyFeatures.cors
            ? ((await getCephAdminBucketCors(selectedEndpointId, bucketName)).rules ?? []) as Record<string, unknown>[]
            : null;
          const policy = bulkCopyFeatures.policy
            ? (((await getCephAdminBucketPolicy(selectedEndpointId, bucketName)).policy ?? null) as Record<string, unknown> | null)
            : null;
          const accessLogging = bulkCopyFeatures.access_logging
            ? normalizeAccessLoggingSnapshot(
                (await getCephAdminBucketLogging(selectedEndpointId, bucketName)) as unknown as Record<string, unknown>
              )
            : null;
          return {
            name: bucketName,
            quota,
            versioningEnabled,
            objectLock,
            publicAccessBlock,
            lifecycleRules,
            corsRules,
            policy,
            accessLogging,
          };
        }
      );
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length > 0) {
        setBulkCopyError(`${failed.length} source bucket(s) failed while copying configs.`);
        return;
      }
      const copiedBuckets = results
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{
            name: string;
            quota: BulkQuotaSnapshot | null;
            versioningEnabled: boolean | null;
            objectLock: BulkObjectLockSnapshot | null;
            publicAccessBlock: PublicAccessBlockState | null;
            lifecycleRules: Record<string, unknown>[] | null;
            corsRules: Record<string, unknown>[] | null;
            policy: Record<string, unknown> | null;
            accessLogging: BulkAccessLoggingSnapshot | null;
          }> => result.status === "fulfilled"
        )
        .map((result) => ({
          name: result.value.name,
          quota: result.value.quota,
          versioningEnabled: result.value.versioningEnabled,
          objectLock: result.value.objectLock,
          publicAccessBlock: result.value.publicAccessBlock,
          lifecycleRules: result.value.lifecycleRules,
          corsRules: result.value.corsRules,
          policy: result.value.policy,
          accessLogging: result.value.accessLogging,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (copiedBuckets.length === 0) {
        setBulkCopyError("No source bucket configuration could be copied.");
        return;
      }
      setBulkConfigClipboard({
        version: 1,
        copiedAt: new Date().toISOString(),
        sourceEndpointId: selectedEndpointId,
        sourceEndpointName: selectedEndpoint?.name ?? null,
        features: {
          quota: bulkCopyFeatures.quota,
          versioning: bulkCopyFeatures.versioning,
          object_lock: bulkCopyFeatures.object_lock,
          public_access_block: bulkCopyFeatures.public_access_block,
          lifecycle: bulkCopyFeatures.lifecycle,
          cors: bulkCopyFeatures.cors,
          policy: bulkCopyFeatures.policy,
          access_logging: bulkCopyFeatures.access_logging,
        },
        buckets: copiedBuckets,
      });
      const featureLabelText = selectedFeatures.map((feature) => BULK_COPY_FEATURE_LABELS[feature]).join(", ");
      setBulkCopySummary(`Copied ${featureLabelText} from ${copiedBuckets.length} bucket(s).`);
    } catch (err) {
      setBulkCopyError(extractError(err));
    } finally {
      setBulkCopyLoading(false);
    }
  };

  const buildPasteConfigPreview = async (mapping: BulkPastePlanItem): Promise<BulkPreviewItem> => {
    const features = bulkConfigClipboard?.features;
    const source = mapping.sourceConfig;
    if (!features) {
      return {
        bucket: mapping.destinationBucket,
        changed: false,
        before: [{ text: "Clipboard unavailable." }],
        after: [{ text: "Clipboard unavailable." }],
      };
    }
    let changed = false;
    const before: BulkPreviewLine[] = [{ text: `Source bucket: ${mapping.sourceBucket}` }];
    const after: BulkPreviewLine[] = [{ text: `Source bucket: ${mapping.sourceBucket}` }];
    const pushSection = (label: string, beforeLines: BulkPreviewLine[], afterLines: BulkPreviewLine[]) => {
      before.push({ text: `[${label}]` }, ...beforeLines);
      after.push({ text: `[${label}]` }, ...afterLines);
    };

    let props: BucketProperties | null = null;
    if (features.versioning || features.object_lock) {
      props = await getCephAdminBucketProperties(selectedEndpointId!, mapping.destinationBucket);
    }

    if (features.quota && source.quota) {
      const currentQuota = await fetchBucketQuota(mapping.destinationBucket);
      const sectionChanged =
        currentQuota.maxSizeBytes !== source.quota.maxSizeBytes || currentQuota.maxObjects !== source.quota.maxObjects;
      changed = changed || sectionChanged;
      pushSection(
        "Quota",
        [
          {
            text: `Size: ${currentQuota.maxSizeBytes != null ? formatBytes(currentQuota.maxSizeBytes) : "Not set"}`,
            tone: sectionChanged ? "removed" : undefined,
          },
          {
            text: `Objects: ${currentQuota.maxObjects != null ? formatNumber(currentQuota.maxObjects) : "Not set"}`,
            tone: sectionChanged ? "removed" : undefined,
          },
        ],
        [
          {
            text: `Size: ${source.quota.maxSizeBytes != null ? formatBytes(source.quota.maxSizeBytes) : "Not set"}`,
            tone: sectionChanged ? "added" : undefined,
          },
          {
            text: `Objects: ${source.quota.maxObjects != null ? formatNumber(source.quota.maxObjects) : "Not set"}`,
            tone: sectionChanged ? "added" : undefined,
          },
        ]
      );
    }

    if (features.versioning && source.versioningEnabled !== null) {
      const currentEnabled = normalizeVersioningStatus(props?.versioning_status);
      const currentStatus = formatVersioningStatus(props?.versioning_status);
      const targetStatus = source.versioningEnabled ? "Enabled" : "Suspended";
      const sectionChanged = currentEnabled === null ? true : currentEnabled !== source.versioningEnabled;
      changed = changed || sectionChanged;
      pushSection(
        "Versioning",
        [{ text: currentStatus, tone: sectionChanged ? "removed" : undefined }],
        [{ text: targetStatus, tone: sectionChanged ? "added" : undefined }]
      );
    }

    if (features.object_lock && source.objectLock) {
      const rawCurrentObjectLock =
        props?.object_lock && typeof props.object_lock === "object"
          ? (props.object_lock as Record<string, unknown>)
          : {};
      const currentObjectLock = normalizeObjectLockSnapshot({
        ...rawCurrentObjectLock,
        enabled: Boolean(props?.object_lock_enabled ?? rawCurrentObjectLock.enabled),
      });
      const sectionChanged = !isObjectLockSnapshotEqual(currentObjectLock, source.objectLock);
      changed = changed || sectionChanged;
      pushSection(
        "Object Lock",
        [{ text: formatObjectLockSnapshot(currentObjectLock), tone: sectionChanged ? "removed" : undefined }],
        [{ text: formatObjectLockSnapshot(source.objectLock), tone: sectionChanged ? "added" : undefined }]
      );
    }

    if (features.public_access_block && source.publicAccessBlock) {
      const currentPublicAccessBlock = normalizePublicAccessBlockState(
        await getCephAdminBucketPublicAccessBlock(selectedEndpointId!, mapping.destinationBucket)
      );
      const sectionChanged = !isPublicAccessBlockEquivalent(currentPublicAccessBlock, source.publicAccessBlock);
      changed = changed || sectionChanged;
      pushSection(
        "Block Public Access",
        [{ text: JSON.stringify(currentPublicAccessBlock, null, 2), tone: sectionChanged ? "removed" : undefined }],
        [{ text: JSON.stringify(source.publicAccessBlock, null, 2), tone: sectionChanged ? "added" : undefined }]
      );
    }

    if (features.lifecycle && source.lifecycleRules) {
      const currentLifecycle = ((await getCephAdminBucketLifecycle(selectedEndpointId!, mapping.destinationBucket)).rules ??
        []) as Record<string, unknown>[];
      const sectionChanged = stableStringify(currentLifecycle) !== stableStringify(source.lifecycleRules);
      changed = changed || sectionChanged;
      pushSection(
        "Lifecycle",
        currentLifecycle.length === 0
          ? [{ text: "(no rules)" }]
          : currentLifecycle.map((rule) => ({ text: formatLifecycleRule(rule), tone: sectionChanged ? "removed" : undefined })),
        source.lifecycleRules.length === 0
          ? [{ text: "(no rules)" }]
          : source.lifecycleRules.map((rule) => ({ text: formatLifecycleRule(rule), tone: sectionChanged ? "added" : undefined }))
      );
    }

    if (features.cors && source.corsRules) {
      const currentCors = ((await getCephAdminBucketCors(selectedEndpointId!, mapping.destinationBucket)).rules ??
        []) as Record<string, unknown>[];
      const sectionChanged = stableStringify(currentCors) !== stableStringify(source.corsRules);
      changed = changed || sectionChanged;
      pushSection(
        "CORS",
        currentCors.length === 0
          ? [{ text: "(no rules)" }]
          : currentCors.map((rule) => ({ text: formatCorsRule(rule), tone: sectionChanged ? "removed" : undefined })),
        source.corsRules.length === 0
          ? [{ text: "(no rules)" }]
          : source.corsRules.map((rule) => ({ text: formatCorsRule(rule), tone: sectionChanged ? "added" : undefined }))
      );
    }

    if (features.policy) {
      const currentPolicy = ((await getCephAdminBucketPolicy(selectedEndpointId!, mapping.destinationBucket)).policy ??
        null) as Record<string, unknown> | null;
      const sectionChanged = stableStringify(currentPolicy) !== stableStringify(source.policy);
      changed = changed || sectionChanged;
      pushSection(
        "Bucket Policy",
        [{ text: currentPolicy ? JSON.stringify(currentPolicy, null, 2) : "(no policy)", tone: sectionChanged ? "removed" : undefined }],
        [{ text: source.policy ? JSON.stringify(source.policy, null, 2) : "(no policy)", tone: sectionChanged ? "added" : undefined }]
      );
    }

    if (features.access_logging && source.accessLogging) {
      const currentAccessLogging = normalizeAccessLoggingSnapshot(
        (await getCephAdminBucketLogging(selectedEndpointId!, mapping.destinationBucket)) as unknown as Record<string, unknown>
      );
      const sectionChanged = !isAccessLoggingSnapshotEqual(currentAccessLogging, source.accessLogging);
      changed = changed || sectionChanged;
      pushSection(
        "Access logging",
        [{ text: JSON.stringify(currentAccessLogging, null, 2), tone: sectionChanged ? "removed" : undefined }],
        [{ text: JSON.stringify(source.accessLogging, null, 2), tone: sectionChanged ? "added" : undefined }]
      );
    }

    return {
      bucket: mapping.destinationBucket,
      changed,
      before,
      after,
    };
  };

  const runBulkPreview = async () => {
    if (!selectedEndpointId || selectedBucketList.length === 0) return;
    if (!bulkOperation) {
      setBulkPreviewError("Select an operation first.");
      return;
    }
    if (bulkOperation === "copy_configs") {
      setBulkPreviewError("Use 'Copy selected configs' for this operation.");
      return;
    }
    if (bulkOperation === "paste_configs") {
      if (bulkPastePlan.error) {
        setBulkPreviewError(bulkPastePlan.error);
        return;
      }
      setBulkPreviewLoading(true);
      setBulkPreviewError(null);
      setBulkPreview([]);
      setBulkPreviewReady(false);
      setBulkApplyError(null);
      setBulkApplySummary(null);

      const previewItems = await runWithConcurrency(
        bulkPastePlan.mappings,
        BULK_CONCURRENCY_LIMIT,
        async (mapping) => {
          try {
            return await buildPasteConfigPreview(mapping);
          } catch (err) {
            return {
              bucket: mapping.destinationBucket,
              before: [{ text: `Source bucket: ${mapping.sourceBucket}` }, { text: "Preview failed." }],
              after: [{ text: `Source bucket: ${mapping.sourceBucket}` }, { text: "Preview failed." }],
              changed: false,
              error: extractError(err),
            };
          }
        }
      );
      setBulkPreview(previewItems);
      setBulkPreviewReady(true);
      setBulkPreviewLoading(false);
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
    if (bulkOperation === "copy_configs") {
      setBulkApplyError("Use 'Copy selected configs' for this operation.");
      return;
    }
    if (bulkOperation === "paste_configs") {
      if (bulkPastePlan.error) {
        setBulkApplyError(bulkPastePlan.error);
        return;
      }
      setBulkApplyLoading(true);
      setBulkApplyError(null);
      setBulkApplySummary(null);
      setBulkApplyProgress({ completed: 0, total: bulkPastePlan.mappings.length, failed: 0 });

      const results = await runWithConcurrencySettled(
        bulkPastePlan.mappings,
        BULK_CONCURRENCY_LIMIT,
        async (mapping) => {
          const features = bulkConfigClipboard?.features;
          if (!features) {
            throw new Error("Copied configuration is no longer available.");
          }
          const source = mapping.sourceConfig;
          let changed = false;

          let props: BucketProperties | null = null;
          if (features.versioning || features.object_lock) {
            props = await getCephAdminBucketProperties(selectedEndpointId, mapping.destinationBucket);
          }

          if (features.quota && source.quota) {
            const currentQuota = await fetchBucketQuota(mapping.destinationBucket);
            const quotaChanged =
              currentQuota.maxSizeBytes !== source.quota.maxSizeBytes || currentQuota.maxObjects !== source.quota.maxObjects;
            if (quotaChanged) {
              const payloadSizeGb = source.quota.maxSizeBytes != null ? bytesToGiB(source.quota.maxSizeBytes) : null;
              await updateCephAdminBucketQuota(selectedEndpointId, mapping.destinationBucket, {
                max_size_gb: payloadSizeGb,
                max_size_unit: payloadSizeGb != null ? "GiB" : null,
                max_objects: source.quota.maxObjects,
              });
              changed = true;
            }
          }

          if (features.versioning && source.versioningEnabled !== null) {
            const currentEnabled = normalizeVersioningStatus(props?.versioning_status);
            const versioningChanged = currentEnabled === null ? true : currentEnabled !== source.versioningEnabled;
            if (versioningChanged) {
              await setCephAdminBucketVersioning(selectedEndpointId, mapping.destinationBucket, source.versioningEnabled);
              changed = true;
            }
          }

          if (features.object_lock && source.objectLock) {
            const rawCurrentObjectLock =
              props?.object_lock && typeof props.object_lock === "object"
                ? (props.object_lock as Record<string, unknown>)
                : {};
            const currentObjectLock = normalizeObjectLockSnapshot({
              ...rawCurrentObjectLock,
              enabled: Boolean(props?.object_lock_enabled ?? rawCurrentObjectLock.enabled),
            });
            if (!isObjectLockSnapshotEqual(currentObjectLock, source.objectLock)) {
              await updateCephAdminBucketObjectLock(selectedEndpointId, mapping.destinationBucket, source.objectLock);
              changed = true;
            }
          }

          if (features.public_access_block && source.publicAccessBlock) {
            const currentPublicAccessBlock = normalizePublicAccessBlockState(
              await getCephAdminBucketPublicAccessBlock(selectedEndpointId, mapping.destinationBucket)
            );
            if (!isPublicAccessBlockEquivalent(currentPublicAccessBlock, source.publicAccessBlock)) {
              await updateCephAdminBucketPublicAccessBlock(selectedEndpointId, mapping.destinationBucket, source.publicAccessBlock);
              changed = true;
            }
          }

          if (features.lifecycle && source.lifecycleRules) {
            const currentLifecycle = (
              (await getCephAdminBucketLifecycle(selectedEndpointId, mapping.destinationBucket)).rules ?? []
            ) as Record<string, unknown>[];
            if (stableStringify(currentLifecycle) !== stableStringify(source.lifecycleRules)) {
              if (source.lifecycleRules.length === 0) {
                if (currentLifecycle.length > 0) {
                  await deleteCephAdminBucketLifecycle(selectedEndpointId, mapping.destinationBucket);
                  changed = true;
                }
              } else {
                await putCephAdminBucketLifecycle(selectedEndpointId, mapping.destinationBucket, source.lifecycleRules);
                changed = true;
              }
            }
          }

          if (features.cors && source.corsRules) {
            const currentCors = (
              (await getCephAdminBucketCors(selectedEndpointId, mapping.destinationBucket)).rules ?? []
            ) as Record<string, unknown>[];
            if (stableStringify(currentCors) !== stableStringify(source.corsRules)) {
              if (source.corsRules.length === 0) {
                if (currentCors.length > 0) {
                  await deleteCephAdminBucketCors(selectedEndpointId, mapping.destinationBucket);
                  changed = true;
                }
              } else {
                await putCephAdminBucketCors(selectedEndpointId, mapping.destinationBucket, source.corsRules);
                changed = true;
              }
            }
          }

          if (features.policy) {
            const currentPolicy = (
              (await getCephAdminBucketPolicy(selectedEndpointId, mapping.destinationBucket)).policy ?? null
            ) as Record<string, unknown> | null;
            if (stableStringify(currentPolicy) !== stableStringify(source.policy)) {
              if (!source.policy) {
                if (currentPolicy) {
                  await deleteCephAdminBucketPolicy(selectedEndpointId, mapping.destinationBucket);
                  changed = true;
                }
              } else {
                await putCephAdminBucketPolicy(selectedEndpointId, mapping.destinationBucket, source.policy);
                changed = true;
              }
            }
          }

          if (features.access_logging && source.accessLogging) {
            const currentAccessLogging = normalizeAccessLoggingSnapshot(
              (await getCephAdminBucketLogging(selectedEndpointId, mapping.destinationBucket)) as unknown as Record<string, unknown>
            );
            if (!isAccessLoggingSnapshotEqual(currentAccessLogging, source.accessLogging)) {
              const hasTargetBucket = Boolean(source.accessLogging.target_bucket);
              if (!source.accessLogging.enabled || !hasTargetBucket) {
                if (currentAccessLogging.enabled || currentAccessLogging.target_bucket) {
                  await deleteCephAdminBucketLogging(selectedEndpointId, mapping.destinationBucket);
                  changed = true;
                }
              } else {
                await putCephAdminBucketLogging(selectedEndpointId, mapping.destinationBucket, {
                  enabled: source.accessLogging.enabled,
                  target_bucket: source.accessLogging.target_bucket,
                  target_prefix: source.accessLogging.target_prefix ?? "",
                });
                changed = true;
              }
            }
          }

          return { changed };
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
      refreshBuckets();
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
    refreshBuckets();
  };

  const updateAdvancedField = (field: AdvancedTextOrNumericField, value: string) => {
    setAdvancedDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateAdvancedMatchMode = (
    field: "tenantMatchMode" | "ownerMatchMode" | "ownerNameMatchMode" | "s3TagsMatchMode",
    value: TextMatchMode
  ) => {
    setAdvancedDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateFeatureFilter = (feature: FeatureKey, value: FeatureFilterState) => {
    setAdvancedDraft((prev) => ({ ...prev, features: { ...prev.features, [feature]: value } }));
  };

  const updateFeatureDetailFilter = (
    field: FeatureDetailFilterKey,
    value: FeatureDetailFilters[FeatureDetailFilterKey]
  ) => {
    setAdvancedDraft((prev) => ({
      ...prev,
      featureDetails: {
        ...prev.featureDetails,
        [field]: value,
      },
    }));
  };

  const closeAdvancedFilterDrawer = () => {
    setShowAdvancedFilter(false);
  };

  const applyAdvancedFilter = () => {
    setAdvancedApplied(advancedDraft);
    setPage(1);
    setShowAdvancedFilter(false);
  };

  const resetAdvancedFilter = () => {
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setPage(1);
  };

  const advancedFiltersApplied = hasAdvancedFilters(advancedApplied, usageFeatureEnabled, featureSupport);
  const advancedAppliedPayload = useMemo(
    () => buildAdvancedFilterPayload("", "contains", advancedApplied, null, usageFeatureEnabled, featureSupport),
    [advancedApplied, usageFeatureEnabled, featureSupport]
  );
  const advancedDraftPayload = useMemo(
    () => buildAdvancedFilterPayload("", "contains", advancedDraft, null, usageFeatureEnabled, featureSupport),
    [advancedDraft, usageFeatureEnabled, featureSupport]
  );
  const hasPendingAdvancedChanges = advancedDraftPayload !== advancedAppliedPayload;
  const hasAnyAdvancedToClear = advancedDraftPayload !== undefined || advancedAppliedPayload !== undefined;
  const quickFilterActive = filterValue.trim().length > 0;
  const columnsCustomized = useMemo(() => {
    if (visibleColumns.length !== defaultVisibleColumns.length) return true;
    const current = new Set(visibleColumns);
    return defaultVisibleColumns.some((column) => !current.has(column));
  }, [visibleColumns]);
  const availableTagFilters = useMemo(() => {
    const selected = new Set(normalizeUiTagValues(tagFilters).map((tag) => tag.toLowerCase()));
    return availableUiTags.filter((tag) => !selected.has(tag.toLowerCase()));
  }, [availableUiTags, tagFilters]);
  const showTagFilterBar = availableUiTags.length > 0 || tagFilters.length > 0;
  const activeFieldClass =
    "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200/70 dark:border-emerald-400/70 dark:bg-emerald-500/15 dark:ring-emerald-500/25";
  const activeLabelClass = "text-emerald-700 dark:text-emerald-200";
  const pendingFieldClass =
    "border-amber-400 bg-amber-50 ring-2 ring-amber-300/70 dark:border-amber-400/70 dark:bg-amber-500/20 dark:ring-amber-500/25";
  const pendingLabelClass = "text-amber-700 dark:text-amber-300";
  const modeToggleBaseClass =
    "absolute right-1 top-1 rounded border px-1 py-0 ui-caption font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-0";
  const modeToggleClass = (mode: TextMatchMode, isPending: boolean, locked: boolean = false) => {
    if (locked) {
      return `${modeToggleBaseClass} cursor-not-allowed border-primary-400 bg-primary-100 text-primary-700 opacity-80 dark:border-primary-400/60 dark:bg-primary-500/20 dark:text-primary-100`;
    }
    if (isPending) {
      return `${modeToggleBaseClass} border-amber-400 bg-amber-100 text-amber-700 focus:ring-amber-300 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200`;
    }
    if (mode === "exact") {
      return `${modeToggleBaseClass} border-primary-400 bg-primary-100 text-primary-700 focus:ring-primary/35 dark:border-primary-400/60 dark:bg-primary-500/20 dark:text-primary-100`;
    }
    return `${modeToggleBaseClass} border-slate-200 bg-white text-slate-500 hover:border-primary hover:text-primary focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100`;
  };
  const matchModeButtonClass = (active: boolean, locked: boolean = false) => {
    if (locked) {
      if (active) {
        return "cursor-not-allowed rounded-md border border-primary-300 bg-primary-100 px-2 py-1 ui-caption font-semibold text-primary-700 opacity-80 dark:border-primary-500/50 dark:bg-primary-500/20 dark:text-primary-100";
      }
      return "cursor-not-allowed rounded-md border border-slate-200 bg-white px-2 py-1 ui-caption font-semibold text-slate-400 opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500";
    }
    if (active) {
      return "rounded-md border border-primary-300 bg-primary-100 px-2 py-1 ui-caption font-semibold text-primary-700 dark:border-primary-500/50 dark:bg-primary-500/20 dark:text-primary-100";
    }
    return "rounded-md border border-slate-200 bg-white px-2 py-1 ui-caption font-semibold text-slate-600 hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100";
  };
  const fieldHighlight = (isApplied: boolean, isPending: boolean) => {
    if (isPending) return { labelClass: pendingLabelClass, fieldClass: pendingFieldClass };
    if (isApplied) return { labelClass: activeLabelClass, fieldClass: activeFieldClass };
    return { labelClass: "", fieldClass: "" };
  };
  const tenantAppliedValue = (advancedApplied?.tenant ?? "").trim();
  const ownerAppliedValue = (advancedApplied?.owner ?? "").trim();
  const ownerNameAppliedValue = (advancedApplied?.ownerName ?? "").trim();
  const s3TagsAppliedExpressions = parseS3TagExpressions(advancedApplied?.s3Tags ?? "");
  const s3TagsAppliedSerialized = serializeS3TagExpressions(s3TagsAppliedExpressions);
  const tenantAppliedMatchMode = advancedApplied?.tenantMatchMode ?? "contains";
  const ownerAppliedMatchMode = advancedApplied?.ownerMatchMode ?? "contains";
  const ownerNameAppliedMatchMode = advancedApplied?.ownerNameMatchMode ?? "contains";
  const s3TagsAppliedMatchMode = advancedApplied?.s3TagsMatchMode ?? "contains";
  const tenantAppliedParsed = parseExactListInput(advancedApplied?.tenant ?? "");
  const ownerAppliedParsed = parseExactListInput(advancedApplied?.owner ?? "");
  const ownerNameAppliedParsed = parseExactListInput(advancedApplied?.ownerName ?? "");
  const s3TagsAppliedParsed = parseExactListInput(advancedApplied?.s3Tags ?? "");
  const tenantAppliedForcesExact = tenantAppliedParsed.listProvided && tenantAppliedParsed.values.length > 0;
  const ownerAppliedForcesExact = ownerAppliedParsed.listProvided && ownerAppliedParsed.values.length > 0;
  const ownerNameAppliedForcesExact = ownerNameAppliedParsed.listProvided && ownerNameAppliedParsed.values.length > 0;
  const s3TagsAppliedForcesExact = s3TagsAppliedParsed.listProvided && s3TagsAppliedParsed.values.length > 0;
  const tenantAppliedEffectiveMatchMode: TextMatchMode = tenantAppliedForcesExact ? "exact" : tenantAppliedMatchMode;
  const ownerAppliedEffectiveMatchMode: TextMatchMode = ownerAppliedForcesExact ? "exact" : ownerAppliedMatchMode;
  const ownerNameAppliedEffectiveMatchMode: TextMatchMode = ownerNameAppliedForcesExact ? "exact" : ownerNameAppliedMatchMode;
  const s3TagsAppliedEffectiveMatchMode: TextMatchMode = s3TagsAppliedForcesExact ? "exact" : s3TagsAppliedMatchMode;
  const ownerNameAppliedScope = advancedApplied?.ownerNameScope ?? "any";
  const tenantDraftValue = advancedDraft.tenant.trim();
  const ownerDraftValue = advancedDraft.owner.trim();
  const ownerNameDraftValue = advancedDraft.ownerName.trim();
  const s3TagsDraftExpressions = parseS3TagExpressions(advancedDraft.s3Tags);
  const s3TagsDraftSerialized = serializeS3TagExpressions(s3TagsDraftExpressions);
  const tenantDraftMatchMode = advancedDraft.tenantMatchMode;
  const ownerDraftMatchMode = advancedDraft.ownerMatchMode;
  const ownerNameDraftMatchMode = advancedDraft.ownerNameMatchMode;
  const s3TagsDraftMatchMode = advancedDraft.s3TagsMatchMode;
  const tenantDraftParsed = parseExactListInput(advancedDraft.tenant);
  const ownerDraftParsed = parseExactListInput(advancedDraft.owner);
  const ownerNameDraftParsed = parseExactListInput(advancedDraft.ownerName);
  const s3TagsDraftParsed = parseExactListInput(advancedDraft.s3Tags);
  const tenantDraftForcesExact = tenantDraftParsed.listProvided && tenantDraftParsed.values.length > 0;
  const ownerDraftForcesExact = ownerDraftParsed.listProvided && ownerDraftParsed.values.length > 0;
  const ownerNameDraftForcesExact = ownerNameDraftParsed.listProvided && ownerNameDraftParsed.values.length > 0;
  const s3TagsDraftForcesExact = s3TagsDraftParsed.listProvided && s3TagsDraftParsed.values.length > 0;
  const tenantDraftEffectiveMatchMode: TextMatchMode = tenantDraftForcesExact ? "exact" : tenantDraftMatchMode;
  const ownerDraftEffectiveMatchMode: TextMatchMode = ownerDraftForcesExact ? "exact" : ownerDraftMatchMode;
  const ownerNameDraftEffectiveMatchMode: TextMatchMode = ownerNameDraftForcesExact ? "exact" : ownerNameDraftMatchMode;
  const s3TagsDraftEffectiveMatchMode: TextMatchMode = s3TagsDraftForcesExact ? "exact" : s3TagsDraftMatchMode;
  const ownerNameDraftScope = advancedDraft.ownerNameScope;
  const tenantPending =
    tenantDraftValue !== tenantAppliedValue || (tenantDraftValue.length > 0 && tenantDraftEffectiveMatchMode !== tenantAppliedEffectiveMatchMode);
  const ownerPending =
    ownerDraftValue !== ownerAppliedValue || (ownerDraftValue.length > 0 && ownerDraftEffectiveMatchMode !== ownerAppliedEffectiveMatchMode);
  const ownerNamePending =
    ownerNameDraftValue !== ownerNameAppliedValue ||
    ownerNameDraftScope !== ownerNameAppliedScope ||
    (ownerNameDraftValue.length > 0 && ownerNameDraftEffectiveMatchMode !== ownerNameAppliedEffectiveMatchMode);
  const s3TagsPending =
    s3TagsDraftSerialized !== s3TagsAppliedSerialized ||
    (s3TagsDraftExpressions.length > 0 && s3TagsDraftEffectiveMatchMode !== s3TagsAppliedEffectiveMatchMode);
  const tenantFieldState = fieldHighlight(
    Boolean(tenantAppliedValue),
    tenantPending
  );
  const ownerFieldState = fieldHighlight(
    Boolean(ownerAppliedValue),
    ownerPending
  );
  const ownerNameFieldState = fieldHighlight(
    Boolean(ownerNameAppliedValue || ownerNameAppliedScope !== "any"),
    ownerNamePending
  );
  const s3TagsFieldState = fieldHighlight(
    s3TagsAppliedExpressions.length > 0,
    s3TagsPending
  );
  const quickDraftValue = filter.trim();
  const quickAppliedValue = filterValue.trim();
  const quickFilterPending = quickDraftValue !== quickAppliedValue;
  const quickFilterFieldState = fieldHighlight(
    quickAppliedValue.length > 0,
    quickFilterPending
  );
  const ownerNameLookupActive = ownerNameDraftValue.length > 0;
  const s3TagsLookupActive = s3TagsDraftExpressions.length > 0;
  const featureDetailDraftLabels = useMemo(
    () => featureDetailSummary(advancedDraft.featureDetails),
    [advancedDraft.featureDetails]
  );
  const featureDetailFiltersActive = featureDetailDraftLabels.length > 0;
  const ownerPrefilterActive = tenantDraftValue.length > 0 || ownerDraftValue.length > 0 || ownerNameDraftScope !== "any";
  const advancedDraftIdentityCount =
    Number(tenantDraftValue.length > 0) +
    Number(ownerDraftValue.length > 0) +
    Number(ownerNameLookupActive) +
    Number(ownerNameDraftScope !== "any");
  const advancedDraftRangeCount = useMemo(() => {
    if (!usageFeatureEnabled) return 0;
    return [
      advancedDraft.minUsedBytes,
      advancedDraft.maxUsedBytes,
      advancedDraft.minObjects,
      advancedDraft.maxObjects,
      advancedDraft.minQuotaBytes,
      advancedDraft.maxQuotaBytes,
      advancedDraft.minQuotaObjects,
      advancedDraft.maxQuotaObjects,
    ].filter((value) => value.trim().length > 0).length;
  }, [advancedDraft, usageFeatureEnabled]);
  const advancedDraftFeatureCount = useMemo(
    () =>
      (Object.keys(advancedDraft.features) as FeatureKey[]).filter(
        (key) => featureSupport[key] !== false && advancedDraft.features[key] !== "any"
      ).length,
    [advancedDraft, featureSupport]
  );
  const advancedDraftTagCount = s3TagsDraftExpressions.length;
  const advancedDraftFeatureDetailCount = featureDetailDraftLabels.length;
  const advancedDraftActiveCount =
    advancedDraftIdentityCount + advancedDraftRangeCount + advancedDraftFeatureCount + advancedDraftTagCount + advancedDraftFeatureDetailCount;
  const multipleFeatureFiltersActive = advancedDraftFeatureCount > 1;
  const featureCostReducedByPrefilter =
    advancedDraftFeatureCount === 1 && ownerPrefilterActive && !ownerNameLookupActive && !s3TagsLookupActive;
  const advancedDraftGlobalCostLevel: FilterCostLevel = useMemo(() => {
    if (featureDetailFiltersActive) return "high";
    if (s3TagsLookupActive) return "high";
    if (advancedDraftFeatureCount > 0) {
      if (multipleFeatureFiltersActive) return "high";
      return featureCostReducedByPrefilter ? "medium" : "high";
    }
    if (ownerNameLookupActive) return "medium";
    if (advancedDraftRangeCount > 0) return "medium";
    if (advancedDraftIdentityCount > 0) return "low";
    return "none";
  }, [
    advancedDraftFeatureCount,
    advancedDraftRangeCount,
    advancedDraftIdentityCount,
    ownerNameLookupActive,
    s3TagsLookupActive,
    featureCostReducedByPrefilter,
    multipleFeatureFiltersActive,
    featureDetailFiltersActive,
  ]);
  const advancedDraftGlobalCostTooltip = useMemo(() => {
    if (advancedDraftGlobalCostLevel === "high") {
      if (featureDetailFiltersActive) {
        return `${FILTER_COST_LABEL.high}: feature detail filters require additional per-bucket configuration reads.`;
      }
      if (s3TagsLookupActive) {
        return `${FILTER_COST_LABEL.high}: S3 tag filters require bucket tag retrieval.`;
      }
      if (multipleFeatureFiltersActive) {
        return `${FILTER_COST_LABEL.high}: ${advancedDraftFeatureCount} feature-state filters are active, which increases per-bucket checks even with prefilters.`;
      }
      return `${FILTER_COST_LABEL.high}: feature-state filters are active and may require additional checks.`;
    }
    if (advancedDraftGlobalCostLevel === "medium") {
      if (ownerNameLookupActive) {
        return `${FILTER_COST_LABEL.medium}: owner-name filters require owner identity lookups.`;
      }
      if (featureCostReducedByPrefilter) {
        return `${FILTER_COST_LABEL.medium}: feature-state filters are active, but owner/tenant prefilters reduce buckets to inspect.`;
      }
      return `${FILTER_COST_LABEL.medium}: usage/quota filters are active and require stats retrieval.`;
    }
    if (advancedDraftGlobalCostLevel === "low") {
      return `${FILTER_COST_LABEL.low}: identity filters use already available bucket fields.`;
    }
    return FILTER_COST_LABEL.none;
  }, [
    advancedDraftGlobalCostLevel,
    ownerNameLookupActive,
    s3TagsLookupActive,
    featureCostReducedByPrefilter,
    multipleFeatureFiltersActive,
    advancedDraftFeatureCount,
    featureDetailFiltersActive,
  ]);
  const toggleQuickFilterMode = () => {
    if (quickFilterDraftForcesExact) return;
    setQuickFilterMode((prev) => (prev === "contains" ? "exact" : "contains"));
    setPage(1);
  };
  const resetAllFilters = () => {
    setFilter("");
    setFilterValue("");
    setQuickFilterMode("contains");
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setTagFilters([]);
    setTagFilterMode("any");
    setShowAdvancedFilter(false);
    setPage(1);
  };
  const clearAdvancedTextOrNumericField = (field: AdvancedTextOrNumericField) => {
    setAdvancedDraft((prev) => ({ ...prev, [field]: "" }));
    setAdvancedApplied((prev) => (prev ? { ...prev, [field]: "" } : prev));
    setPage(1);
  };
  const clearAdvancedOwnerScope = () => {
    setAdvancedDraft((prev) => ({ ...prev, ownerNameScope: "any" }));
    setAdvancedApplied((prev) => (prev ? { ...prev, ownerNameScope: "any" } : prev));
    setPage(1);
  };
  const clearAdvancedFeatureField = (feature: FeatureKey) => {
    setAdvancedDraft((prev) => ({ ...prev, features: { ...prev.features, [feature]: "any" } }));
    setAdvancedApplied((prev) => (prev ? { ...prev, features: { ...prev.features, [feature]: "any" } } : prev));
    setPage(1);
  };
  const clearAdvancedFeatureDetailFilterField = (field: FeatureDetailFilterKey) => {
    setAdvancedDraft((prev) => ({ ...prev, featureDetails: clearFeatureDetailField(prev.featureDetails, field) }));
    setAdvancedApplied((prev) =>
      prev ? { ...prev, featureDetails: clearFeatureDetailField(prev.featureDetails, field) } : prev
    );
    setPage(1);
  };
  const removeActiveFilterItem = (action: ActiveFilterRemoveAction) => {
    if (action.type === "quick") {
      setFilter("");
      setFilterValue("");
      setPage(1);
      return;
    }
    if (action.type === "tag_mode") {
      setTagFilterMode("any");
      setPage(1);
      return;
    }
    if (action.type === "tag") {
      removeTagFilter(action.tag);
      return;
    }
    if (action.type === "advanced_owner_scope") {
      clearAdvancedOwnerScope();
      return;
    }
    if (action.type === "advanced_text" || action.type === "advanced_numeric") {
      clearAdvancedTextOrNumericField(action.field);
      return;
    }
    if (action.type === "advanced_feature_detail") {
      clearAdvancedFeatureDetailFilterField(action.field);
      return;
    }
    clearAdvancedFeatureField(action.feature);
  };
  const activeFilterSummaryItems = useMemo(() => {
    const items: ActiveFilterSummaryItem[] = [];
    const quick = quickFilterActive ? filterValue.trim() : "";
    if (quickFilterActive && quick) {
      const quickLabel = formatTextFilterSummary("Name", filterValue, effectiveQuickFilterMode);
      if (quickLabel) {
        items.push({
          id: "quick",
          label: quickLabel,
          remove: { type: "quick" },
        });
      }
    }

    const normalizedActiveTags = normalizeUiTagValues(tagFilters);
    if (normalizedActiveTags.length > 0) {
      if (normalizedActiveTags.length > 1) {
        items.push({
          id: "tag-mode",
          label: `UI tags mode: ${tagFilterMode === "all" ? "AND" : "OR"}`,
          remove: { type: "tag_mode" },
        });
      }
      normalizedActiveTags.forEach((tag) => {
        items.push({
          id: `tag-${tag.toLowerCase()}`,
          label: `UI tag: ${tag}`,
          remove: { type: "tag", tag },
        });
      });
    }

    if (advancedApplied && hasAdvancedFilters(advancedApplied, usageFeatureEnabled, featureSupport)) {
      const tenant = advancedApplied.tenant.trim();
      if (tenant) {
        const label = formatTextFilterSummary("Tenant", advancedApplied.tenant, tenantAppliedEffectiveMatchMode);
        if (label) {
          items.push({
            id: "tenant",
            label,
            remove: { type: "advanced_text", field: "tenant" },
          });
        }
      }

      const owner = advancedApplied.owner.trim();
      if (owner) {
        const label = formatTextFilterSummary("Owner", advancedApplied.owner, ownerAppliedEffectiveMatchMode);
        if (label) {
          items.push({
            id: "owner",
            label,
            remove: { type: "advanced_text", field: "owner" },
          });
        }
      }
      const ownerName = advancedApplied.ownerName.trim();
      if (ownerName) {
        const label = formatTextFilterSummary("Owner name", advancedApplied.ownerName, ownerNameAppliedEffectiveMatchMode);
        if (label) {
          items.push({
            id: "owner-name",
            label,
            remove: { type: "advanced_text", field: "ownerName" },
          });
        }
      }
      if (advancedApplied.ownerNameScope !== "any") {
        items.push({
          id: "owner-kind",
          label: `Owner kind: ${advancedApplied.ownerNameScope === "account" ? "Accounts" : "Users"}`,
          remove: { type: "advanced_owner_scope" },
        });
      }
      const s3TagExpressions = parseS3TagExpressions(advancedApplied.s3Tags);
      if (s3TagExpressions.length > 0) {
        const preview = formatBucketNamesPreview(s3TagExpressions, 2);
        items.push({
          id: "s3-tags",
          label: `S3 tags ${formatTextMatchModeLabel(s3TagsAppliedEffectiveMatchMode)}: ${preview}`,
          remove: { type: "advanced_text", field: "s3Tags" },
        });
      }

      const numericFilters: Array<{ id: AdvancedNumericField; label: string }> = usageFeatureEnabled
        ? [
            { id: "minUsedBytes", label: "Used bytes >=" },
            { id: "maxUsedBytes", label: "Used bytes <=" },
            { id: "minObjects", label: "Objects >=" },
            { id: "maxObjects", label: "Objects <=" },
            { id: "minQuotaBytes", label: "Quota bytes >=" },
            { id: "maxQuotaBytes", label: "Quota bytes <=" },
            { id: "minQuotaObjects", label: "Quota objects >=" },
            { id: "maxQuotaObjects", label: "Quota objects <=" },
          ]
        : [];
      numericFilters.forEach(({ id, label }) => {
        const value = (advancedApplied[id] as string).trim();
        if (!value) return;
        const asNumber = Number(value);
        const display = Number.isFinite(asNumber) ? formatNumber(asNumber) : value;
        items.push({
          id: `num-${id}`,
          label: `${label} ${display}`,
          remove: { type: "advanced_numeric", field: id },
        });
      });

      (Object.keys(advancedApplied.features) as FeatureKey[]).forEach((feature) => {
        if (featureSupport[feature] === false) return;
        const state = advancedApplied.features[feature];
        if (state === "any") return;
        items.push({
          id: `feature-${feature}`,
          label: `${FEATURE_LABELS[feature]}: ${formatFeatureFilterStateLabel(state)}`,
          remove: { type: "advanced_feature", feature },
        });
      });
      featureDetailSummaryItems(advancedApplied.featureDetails).forEach((entry) => {
        items.push({
          id: `feature-detail-${entry.field}`,
          label: entry.label,
          remove: { type: "advanced_feature_detail", field: entry.field },
        });
      });
    }

    return items;
  }, [
    quickFilterActive,
    filterValue,
    effectiveQuickFilterMode,
    tagFilters,
    tagFilterMode,
    advancedApplied,
    usageFeatureEnabled,
    featureSupport,
    tenantAppliedEffectiveMatchMode,
    ownerAppliedEffectiveMatchMode,
    ownerNameAppliedEffectiveMatchMode,
    s3TagsAppliedEffectiveMatchMode,
  ]);
  const showActiveFiltersCard =
    activeFilterSummaryItems.length > 0 &&
    !(
      activeFilterSummaryItems.length === 1 &&
      quickFilterActive &&
      !advancedFiltersApplied &&
      tagFilters.length === 0 &&
      !quickFilterAppliedParsed.listProvided
    );
  const advancedDraftSummaryItems = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [];
    const tenantLabel = formatTextFilterSummary("Tenant", advancedDraft.tenant, tenantDraftEffectiveMatchMode);
    if (tenantLabel) items.push({ id: "draft-tenant", label: tenantLabel });

    const ownerLabel = formatTextFilterSummary("Owner", advancedDraft.owner, ownerDraftEffectiveMatchMode);
    if (ownerLabel) items.push({ id: "draft-owner", label: ownerLabel });
    const ownerNameLabel = formatTextFilterSummary("Owner name", advancedDraft.ownerName, ownerNameDraftEffectiveMatchMode);
    if (ownerNameLabel) {
      items.push({
        id: "draft-owner-name",
        label: ownerNameLabel,
      });
    }
    if (advancedDraft.ownerNameScope !== "any") {
      items.push({
        id: "draft-owner-kind",
        label: `Owner kind: ${advancedDraft.ownerNameScope === "account" ? "Accounts" : "Users"}`,
      });
    }
    const s3TagExpressions = parseS3TagExpressions(advancedDraft.s3Tags);
    if (s3TagExpressions.length > 0) {
      items.push({
        id: "draft-s3-tags",
        label: `S3 tags ${formatTextMatchModeLabel(s3TagsDraftEffectiveMatchMode)}: ${formatBucketNamesPreview(s3TagExpressions, 2)}`,
      });
    }

    if (usageFeatureEnabled) {
      const numericFilters: Array<{ id: keyof AdvancedFilterState; label: string }> = [
        { id: "minUsedBytes", label: "Used bytes >=" },
        { id: "maxUsedBytes", label: "Used bytes <=" },
        { id: "minObjects", label: "Objects >=" },
        { id: "maxObjects", label: "Objects <=" },
        { id: "minQuotaBytes", label: "Quota bytes >=" },
        { id: "maxQuotaBytes", label: "Quota bytes <=" },
        { id: "minQuotaObjects", label: "Quota objects >=" },
        { id: "maxQuotaObjects", label: "Quota objects <=" },
      ];
      numericFilters.forEach(({ id, label }) => {
        const value = (advancedDraft[id] as string).trim();
        if (!value) return;
        const asNumber = Number(value);
        const display = Number.isFinite(asNumber) ? formatNumber(asNumber) : value;
        items.push({ id: `draft-num-${id}`, label: `${label} ${display}` });
      });
    }

    (Object.keys(advancedDraft.features) as FeatureKey[]).forEach((feature) => {
      if (featureSupport[feature] === false) return;
      const state = advancedDraft.features[feature];
      if (state === "any") return;
      items.push({
        id: `draft-feature-${feature}`,
        label: `${FEATURE_LABELS[feature]}: ${formatFeatureFilterStateLabel(state)}`,
      });
    });
    featureDetailSummaryItems(advancedDraft.featureDetails).forEach((entry) => {
      items.push({
        id: `draft-feature-detail-${entry.field}`,
        label: entry.label,
      });
    });

    return items;
  }, [
    advancedDraft,
    usageFeatureEnabled,
    featureSupport,
    tenantDraftEffectiveMatchMode,
    ownerDraftEffectiveMatchMode,
    ownerNameDraftEffectiveMatchMode,
    s3TagsDraftEffectiveMatchMode,
  ]);
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
  const hasSelectedCopyFeatures = useMemo(
    () => (Object.keys(bulkCopyFeatures) as BulkCopyFeatureKey[]).some((feature) => bulkCopyFeatures[feature]),
    [bulkCopyFeatures]
  );
  const bulkClipboardCopiedAtLabel = useMemo(() => {
    if (!bulkConfigClipboard) return null;
    const parsed = new Date(bulkConfigClipboard.copiedAt);
    if (Number.isNaN(parsed.getTime())) return bulkConfigClipboard.copiedAt;
    return parsed.toLocaleString();
  }, [bulkConfigClipboard]);
  const bulkClipboardFeatureLabels = useMemo(() => {
    if (!bulkConfigClipboard) return [];
    return (Object.keys(bulkConfigClipboard.features) as BulkCopyFeatureKey[])
      .filter((feature) => bulkConfigClipboard.features[feature])
      .map((feature) => BULK_COPY_FEATURE_LABELS[feature]);
  }, [bulkConfigClipboard]);

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

  type BulkPreviewSection = {
    key: string;
    label: string;
    before: BulkPreviewLine[];
    after: BulkPreviewLine[];
    changed: boolean;
    error?: string;
  };

  const sectionLabelByOperation = (() => {
    switch (bulkOperation) {
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
  })();

  const splitPreviewLinesBySection = (lines: BulkPreviewLine[], fallbackLabel: string) => {
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

  const buildPreviewSections = (item: BulkPreviewItem): BulkPreviewSection[] => {
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
    const beforeSections = splitPreviewLinesBySection(item.before, sectionLabelByOperation);
    const afterSections = splitPreviewLinesBySection(item.after, sectionLabelByOperation);
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
      const before = beforeSections.find((section) => section.label.trim().toLowerCase() === normalized)?.lines ?? [];
      const after = afterSections.find((section) => section.label.trim().toLowerCase() === normalized)?.lines ?? [];
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
  };

  const bucketPreviewBadgeClasses = (item: BulkPreviewItem) => {
    if (item.error) {
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100";
    }
    if (item.changed) {
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100";
    }
    return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";
  };

  const sectionPreviewBadgeClasses = (changed: boolean) =>
    changed
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
      : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";

  const exportBulkPreviewChanges = () => {
    if (bulkPreview.length === 0) return;
    const exportedAt = new Date().toISOString();
    const timestamp = exportedAt.replace(/[:.]/g, "-");
    const endpointPart = sanitizeExportFilenamePart(
      selectedEndpoint?.name ?? (selectedEndpointId ? `endpoint-${selectedEndpointId}` : "endpoint")
    );
    const operationPart = sanitizeExportFilenamePart(bulkOperation || "operation");

    const itemsWithChanges = bulkPreview.filter((item) => item.changed || Boolean(item.error));
    const payload = {
      generated_at: exportedAt,
      endpoint: {
        id: selectedEndpointId ?? null,
        name: selectedEndpoint?.name ?? null,
      },
      operation: bulkOperation || null,
      summary: {
        total: bulkPreview.length,
        changed: previewStats.changed,
        unchanged: previewStats.unchanged,
        errors: previewStats.errors,
        exported_items: itemsWithChanges.length,
      },
      items: itemsWithChanges.map((item) => {
        const sections = buildPreviewSections(item);
        return {
          bucket: item.bucket,
          changed: item.changed,
          error: item.error ?? null,
          sections: sections
            .filter((section) => section.changed || Boolean(section.error))
            .map((section) => ({
              label: section.label,
              changed: section.changed,
              error: section.error ?? null,
              before: section.before,
              after: section.after,
            })),
        };
      }),
    };

    triggerDownload(
      `ceph-admin-bulk-preview-${endpointPart}-${operationPart}-${timestamp}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  };

  type ColumnDef = {
    id: string;
    label: string;
    field?: SortField | null;
    align?: "left" | "right";
    expensive?: boolean;
    header?: ReactNode;
    headerClassName?: string;
    cellClassName?: string;
    render: (bucket: CephAdminBucket) => ReactNode;
  };

  const expensiveColumnClass = "bg-amber-50/60 dark:bg-amber-900/20";
  const defaultColumnMinWidthClass = "min-w-[9rem]";

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

  const renderUiTags = (bucket: CephAdminBucket) => {
    const bucketTarget = toBucketTagTarget(bucket.name, bucket.tenant);
    const tags = uiTags[bucketTarget.key] ?? [];
    const draft = tagDrafts[bucketTarget.key] ?? "";
    const normalizedDraft = draft.trim().toLowerCase();
    const existingSet = new Set(tags.map((tag) => tag.toLowerCase()));
    const suggestions = normalizedDraft
      ? availableUiTags.filter(
          (tag) => tag.toLowerCase().includes(normalizedDraft) && !existingSet.has(tag.toLowerCase())
        )
      : availableUiTags.filter((tag) => !existingSet.has(tag.toLowerCase()));
    const showSuggestions = tagSuggestionBucket === bucketTarget.key && suggestions.length > 0;
    return (
      <div className="group relative flex flex-wrap items-center gap-2">
        {tags.map((tag) => {
          const colors = getTagColors(tag);
          return (
            <span
              key={`${bucketTarget.key}:${tag}`}
              className="flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10px] font-semibold leading-4"
              style={{ backgroundColor: colors.background, color: colors.text, borderColor: colors.border }}
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTagForBucket(bucketTarget, tag)}
                className="ml-0.5 leading-none opacity-70 hover:opacity-100"
                title="Remove tag"
              >
                ×
              </button>
            </span>
          );
        })}
        <div className="w-24 shrink-0">
          <input
            type="text"
            value={draft}
            onChange={(e) => updateTagDraft(bucketTarget.key, e.target.value)}
            onFocus={() => setTagSuggestionBucket(bucketTarget.key)}
            onBlur={() => {
              window.setTimeout(() => {
                setTagSuggestionBucket((prev) => (prev === bucketTarget.key ? null : prev));
              }, 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTagsForBucket(bucketTarget, draft);
                updateTagDraft(bucketTarget.key, "");
              }
            }}
            placeholder="+"
            className={`w-full border-0 bg-transparent p-0 ui-caption text-slate-500 placeholder:text-slate-400 transition-opacity duration-150 focus:outline-none focus:ring-0 dark:text-slate-300 ${
              draft ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
            }`}
          />
        </div>
        {showSuggestions && (
          <div
            className="absolute left-0 top-full z-20 mt-1 max-h-40 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.map((tag) => (
              <button
                key={`${bucketTarget.key}:suggest:${tag}`}
                type="button"
                onClick={() => {
                  addTagsForBucket(bucketTarget, tag);
                  updateTagDraft(bucketTarget.key, "");
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

  const bucketTooltipCacheKey = (bucket: CephAdminBucket) => `${bucket.tenant ?? ""}:${bucket.name}`;
  const ownerTooltipCacheKey = (bucket: CephAdminBucket) =>
    `${bucketTooltipCacheKey(bucket)}:${bucket.owner ?? ""}:owner`;
  const featureTooltipCacheKey = (bucket: CephAdminBucket, featureKey: FeatureKey) =>
    `${bucketTooltipCacheKey(bucket)}:${featureKey}`;

  const resolveOwnerNameForBucket = async (bucket: CephAdminBucket): Promise<string | null> => {
    const inlineOwnerName = (bucket.owner_name || "").trim();
    if (inlineOwnerName) {
      return inlineOwnerName;
    }
    if (!selectedEndpointId) return null;
    const bucketKey = bucketTooltipCacheKey(bucket);
    if (Object.prototype.hasOwnProperty.call(ownerNameCacheRef.current, bucketKey)) {
      return ownerNameCacheRef.current[bucketKey];
    }

    const rules: Array<Record<string, unknown>> = [{ field: "name", op: "eq", value: bucket.name }];
    if (bucket.tenant && bucket.tenant.trim()) {
      rules.push({ field: "tenant", op: "eq", value: bucket.tenant });
    }
    if (bucket.owner && bucket.owner.trim()) {
      rules.push({ field: "owner", op: "eq", value: bucket.owner });
    }
    const response = await listCephAdminBuckets(selectedEndpointId, {
      page: 1,
      page_size: 5,
      advanced_filter: JSON.stringify({ match: "all", rules }),
      include: ["owner_name"],
      with_stats: false,
    });
    const candidate = (response.items ?? []).find(
      (item) =>
        item.name === bucket.name &&
        (item.tenant ?? "") === (bucket.tenant ?? "") &&
        (item.owner ?? "") === (bucket.owner ?? "")
    );
    const resolvedOwnerName = (candidate?.owner_name || "").trim() || null;
    ownerNameCacheRef.current[bucketKey] = resolvedOwnerName;
    return resolvedOwnerName;
  };

  const loadOwnerTooltip = (bucket: CephAdminBucket) => {
    if (!selectedEndpointId || !bucket.owner) return;
    const key = ownerTooltipCacheKey(bucket);
    const current = ownerTooltipState[key];
    if (current?.status === "ready" || current?.status === "loading") return;
    if (ownerTooltipInflightRef.current[key]) return;

    const work = (async () => {
      setOwnerTooltipState((prev) => ({ ...prev, [key]: { status: "loading" } }));
      try {
        const ownerName = await resolveOwnerNameForBucket(bucket);
        setOwnerTooltipState((prev) => ({ ...prev, [key]: { status: "ready", ownerName } }));
      } catch (err) {
        setOwnerTooltipState((prev) => ({
          ...prev,
          [key]: { status: "error", message: extractError(err) },
        }));
      } finally {
        delete ownerTooltipInflightRef.current[key];
      }
    })();
    ownerTooltipInflightRef.current[key] = work;
  };

  const getBucketPropertiesCached = async (bucket: CephAdminBucket): Promise<BucketProperties> => {
    if (!selectedEndpointId) {
      throw new Error("No endpoint selected.");
    }
    const bucketKey = bucketTooltipCacheKey(bucket);
    const cached = bucketPropertiesCacheRef.current[bucketKey];
    if (cached) return cached;
    const inflight = bucketPropertiesInflightRef.current[bucketKey];
    if (inflight) return inflight;
    const promise = getCephAdminBucketProperties(selectedEndpointId, bucket.name)
      .then((props) => {
        bucketPropertiesCacheRef.current[bucketKey] = props;
        return props;
      })
      .finally(() => {
        delete bucketPropertiesInflightRef.current[bucketKey];
      });
    bucketPropertiesInflightRef.current[bucketKey] = promise;
    return promise;
  };

  const buildFeatureTooltipLines = async (bucket: CephAdminBucket, featureKey: FeatureKey): Promise<string[]> => {
    if (!selectedEndpointId) return ["No endpoint selected."];

    if (featureKey === "versioning") {
      const props = await getBucketPropertiesCached(bucket);
      const status = (props.versioning_status || "Disabled").trim() || "Disabled";
      return [`Versioning: ${status}`];
    }

    if (featureKey === "object_lock") {
      const props = await getBucketPropertiesCached(bucket);
      const objectLock = props.object_lock;
      const enabled = Boolean(props.object_lock_enabled ?? objectLock?.enabled);
      const lines = [`Enabled: ${enabled ? "Yes" : "No"}`];
      if (objectLock?.mode) lines.push(`Mode: ${objectLock.mode}`);
      if (objectLock?.days != null) lines.push(`Default retention: ${objectLock.days} day(s)`);
      if (objectLock?.years != null) lines.push(`Default retention: ${objectLock.years} year(s)`);
      return lines;
    }

    if (featureKey === "block_public_access") {
      const props = await getBucketPropertiesCached(bucket);
      const cfg = normalizePublicAccessBlockState(props.public_access_block);
      const lines = [`State: ${formatPublicAccessBlockState(cfg)}`];
      PUBLIC_ACCESS_BLOCK_OPTIONS.forEach((option) => {
        lines.push(`${option.label}: ${formatPublicAccessBlockFlag(cfg[option.key])}`);
      });
      return lines;
    }

    if (featureKey === "lifecycle_rules") {
      const props = await getBucketPropertiesCached(bucket);
      const rules = Array.isArray(props.lifecycle_rules) ? props.lifecycle_rules : [];
      if (rules.length === 0) {
        return ["Rules: 0 (disabled)"];
      }
      const lines = [`Rules: ${rules.length}`];
      rules.slice(0, 3).forEach((rule, idx) => {
        const id = (rule.id || "").trim() || `Rule ${idx + 1}`;
        const status = (rule.status || "Unknown").trim() || "Unknown";
        const prefix = (rule.prefix || "/").trim() || "/";
        lines.push(`${id}: ${status} · prefix ${prefix}`);
      });
      if (rules.length > 3) {
        lines.push(`+${rules.length - 3} more rule(s)`);
      }
      return lines;
    }

    if (featureKey === "cors") {
      const props = await getBucketPropertiesCached(bucket);
      const rules = Array.isArray(props.cors_rules) ? props.cors_rules : [];
      if (rules.length === 0) {
        return ["Rules: 0 (not configured)"];
      }
      const lines = [`Rules: ${rules.length}`];
      const firstRule = rules[0] as Record<string, unknown>;
      const methods = Array.isArray(firstRule?.AllowedMethods)
        ? firstRule.AllowedMethods.map((item) => String(item)).filter(Boolean)
        : [];
      const origins = Array.isArray(firstRule?.AllowedOrigins)
        ? firstRule.AllowedOrigins.map((item) => String(item)).filter(Boolean)
        : [];
      if (methods.length > 0) lines.push(`Methods: ${methods.slice(0, 4).join(", ")}`);
      if (origins.length > 0) lines.push(`Origins: ${origins.slice(0, 3).join(", ")}`);
      if (rules.length > 1) lines.push(`+${rules.length - 1} additional rule(s)`);
      return lines;
    }

    if (featureKey === "static_website") {
      const website = await getCephAdminBucketWebsite(selectedEndpointId, bucket.name);
      const routingRules = Array.isArray(website.routing_rules) ? website.routing_rules : [];
      const redirectHost = (website.redirect_all_requests_to?.host_name || "").trim();
      const indexDocument = (website.index_document || "").trim();
      const errorDocument = (website.error_document || "").trim();
      const enabled = Boolean(redirectHost || indexDocument || routingRules.length > 0);
      const lines = [`Enabled: ${enabled ? "Yes" : "No"}`];
      if (indexDocument) lines.push(`Index document: ${indexDocument}`);
      if (errorDocument) lines.push(`Error document: ${errorDocument}`);
      if (redirectHost) lines.push(`Redirect host: ${redirectHost}`);
      if (routingRules.length > 0) lines.push(`Routing rules: ${routingRules.length}`);
      return lines;
    }

    if (featureKey === "bucket_policy") {
      const payload = await getCephAdminBucketPolicy(selectedEndpointId, bucket.name);
      const policy = payload.policy;
      if (!policy || typeof policy !== "object") {
        return ["Policy: Not set"];
      }
      const doc = policy as Record<string, unknown>;
      const rawStatements = doc.Statement;
      const statements = Array.isArray(rawStatements) ? rawStatements : rawStatements ? [rawStatements] : [];
      const lines = ["Policy: Configured", `Statements: ${statements.length}`];
      if (typeof doc.Version === "string" && doc.Version.trim()) {
        lines.push(`Version: ${doc.Version}`);
      }
      const hasConditions = statements.some(
        (statement) =>
          statement &&
          typeof statement === "object" &&
          Object.keys((statement as Record<string, unknown>).Condition || {}).length > 0
      );
      lines.push(`Has conditions: ${hasConditions ? "Yes" : "No"}`);
      return lines;
    }

    if (featureKey === "access_logging") {
      const logging = await getCephAdminBucketLogging(selectedEndpointId, bucket.name);
      const targetBucket = (logging.target_bucket || "").trim();
      const targetPrefix = (logging.target_prefix || "").trim();
      const enabled = Boolean(logging.enabled && targetBucket);
      const lines = [`Enabled: ${enabled ? "Yes" : "No"}`];
      if (targetBucket) lines.push(`Target bucket: ${targetBucket}`);
      if (targetPrefix) lines.push(`Target prefix: ${targetPrefix}`);
      return lines;
    }

    if (featureKey === "server_side_encryption") {
      const encryption = await getCephAdminBucketEncryption(selectedEndpointId, bucket.name);
      const rules = Array.isArray(encryption.rules) ? encryption.rules : [];
      if (rules.length === 0) {
        return ["Enabled: No"];
      }
      const lines = [`Enabled: Yes`, `Rules: ${rules.length}`];
      const firstRule = rules[0] as Record<string, unknown>;
      const defaultSse = firstRule.ApplyServerSideEncryptionByDefault as Record<string, unknown> | undefined;
      const algorithm = typeof defaultSse?.SSEAlgorithm === "string" ? defaultSse.SSEAlgorithm.trim() : "";
      const kmsKeyId = typeof defaultSse?.KMSMasterKeyID === "string" ? defaultSse.KMSMasterKeyID.trim() : "";
      if (algorithm) lines.push(`Algorithm: ${algorithm}`);
      if (kmsKeyId) lines.push(`KMS key: ${kmsKeyId}`);
      return lines;
    }

    return ["No additional details available."];
  };

  const loadFeatureTooltip = (bucket: CephAdminBucket, featureKey: FeatureKey) => {
    if (!selectedEndpointId) return;
    const key = featureTooltipCacheKey(bucket, featureKey);
    const current = featureTooltipState[key];
    if (current?.status === "ready" || current?.status === "loading") return;
    if (featureTooltipInflightRef.current[key]) return;

    const work = (async () => {
      setFeatureTooltipState((prev) => ({ ...prev, [key]: { status: "loading" } }));
      try {
        const lines = await buildFeatureTooltipLines(bucket, featureKey);
        setFeatureTooltipState((prev) => ({ ...prev, [key]: { status: "ready", lines } }));
      } catch (err) {
        setFeatureTooltipState((prev) => ({
          ...prev,
          [key]: { status: "error", message: extractError(err) },
        }));
      } finally {
        delete featureTooltipInflightRef.current[key];
      }
    })();
    featureTooltipInflightRef.current[key] = work;
  };

  const renderOwnerCell = (bucket: CephAdminBucket) => {
    const owner = (bucket.owner || "").trim();
    if (!owner) return "-";
    const tooltipKey = ownerTooltipCacheKey(bucket);
    const tooltip = ownerTooltipState[tooltipKey];
    const isTooltipVisible = activeOwnerTooltipKey === tooltipKey;
    return (
      <div
        className="relative inline-flex"
        onMouseEnter={() => {
          setActiveOwnerTooltipKey(tooltipKey);
          loadOwnerTooltip(bucket);
        }}
        onMouseLeave={() => {
          setActiveOwnerTooltipKey((prev) => (prev === tooltipKey ? null : prev));
        }}
      >
        <button
          type="button"
          className="inline-flex cursor-help text-left decoration-dotted underline-offset-2 hover:underline focus:underline"
          onFocus={() => {
            setActiveOwnerTooltipKey(tooltipKey);
            loadOwnerTooltip(bucket);
          }}
          onBlur={() => {
            setActiveOwnerTooltipKey((prev) => (prev === tooltipKey ? null : prev));
          }}
          aria-label="Resolve owner name"
        >
          {owner}
        </button>
        {isTooltipVisible && (
          <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">Owner</p>
            <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">UID: {owner}</p>
            {(!tooltip || tooltip.status === "loading") && (
              <div className="mt-1.5 inline-flex items-center gap-1.5 ui-caption text-slate-500 dark:text-slate-300">
                <SpinnerIcon />
                Resolving owner name...
              </div>
            )}
            {tooltip?.status === "error" && (
              <p className="mt-1.5 ui-caption text-rose-600 dark:text-rose-300">{tooltip.message}</p>
            )}
            {tooltip?.status === "ready" && (
              <p className="mt-1.5 ui-caption text-slate-600 dark:text-slate-300">
                Owner name: {tooltip.ownerName ? tooltip.ownerName : "Not found"}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderFeatureChip = (featureKey: FeatureKey, bucket: CephAdminBucket) => {
    const status = bucket.features?.[featureKey] ?? null;
    if (!status) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    const tooltipKey = featureTooltipCacheKey(bucket, featureKey);
    const tooltip = featureTooltipState[tooltipKey];
    const isTooltipVisible = activeFeatureTooltipKey === tooltipKey;
    return (
      <div
        className="relative inline-flex"
        onMouseEnter={() => {
          setActiveFeatureTooltipKey(tooltipKey);
          loadFeatureTooltip(bucket, featureKey);
        }}
        onMouseLeave={() => {
          setActiveFeatureTooltipKey((prev) => (prev === tooltipKey ? null : prev));
        }}
      >
        <button
          type="button"
          className="inline-flex cursor-default"
          onFocus={() => {
            setActiveFeatureTooltipKey(tooltipKey);
            loadFeatureTooltip(bucket, featureKey);
          }}
          onBlur={() => {
            setActiveFeatureTooltipKey((prev) => (prev === tooltipKey ? null : prev));
          }}
          aria-label={`${FEATURE_LABELS[featureKey]} details`}
        >
          <PropertySummaryChip compact state={status.state} tone={status.tone} />
        </button>
        {isTooltipVisible && (
          <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">{FEATURE_LABELS[featureKey]}</p>
            {(!tooltip || tooltip.status === "loading") && (
              <div className="mt-1.5 inline-flex items-center gap-1.5 ui-caption text-slate-500 dark:text-slate-300">
                <SpinnerIcon />
                Loading configuration...
              </div>
            )}
            {tooltip?.status === "error" && (
              <p className="mt-1.5 ui-caption text-rose-600 dark:text-rose-300">{tooltip.message}</p>
            )}
            {tooltip?.status === "ready" && (
              <div className="mt-1.5 space-y-1">
                {tooltip.lines.map((line, idx) => (
                  <p key={`${tooltipKey}:${idx}`} className="ui-caption text-slate-600 dark:text-slate-300">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const formatLifecycleDayDetail = (
    bucket: CephAdminBucket,
    detailKey:
      | "lifecycle_expiration_days"
      | "lifecycle_noncurrent_expiration_days"
      | "lifecycle_transition_days"
      | "lifecycle_abort_multipart_days"
  ): string => {
    const details = bucket.column_details as Record<string, unknown> | null | undefined;
    const raw = details?.[detailKey];
    if (raw === null || raw === undefined) return "-";
    if (!Array.isArray(raw)) return "-";
    const values = raw
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
      .map((item) => Math.trunc(item))
      .sort((a, b) => a - b);
    if (values.length === 0) return "None";
    return Array.from(new Set(values)).join(", ");
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
            checked={headerChecked}
            onChange={(e) => {
              void setSelectionForFilteredResults(e.target.checked);
            }}
            disabled={loading || selectAllLoading || !selectedEndpointId || total === 0}
            className={uiCheckboxClass}
          />
        ),
        align: "left",
        render: (bucket) => (
          <input
            type="checkbox"
            checked={selectedBuckets.has(bucket.name)}
            onChange={() => toggleSelection(bucket.name)}
            className={uiCheckboxClass}
          />
        ),
      },
      {
        id: "name",
        label: "Name",
        field: "name",
        headerClassName: "w-[12rem] min-w-[10rem] max-w-[20rem]",
        cellClassName: "w-[12rem] min-w-[10rem] max-w-[20rem]",
        render: (bucket) => (
          <button
            type="button"
            onClick={() => setEditingBucketName(bucket.name)}
            className="block w-full truncate text-left hover:text-primary-700 dark:hover:text-primary-200"
            title={bucket.name}
          >
            {bucket.name}
          </button>
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
        headerClassName: "min-w-[12rem] max-w-[24rem]",
        cellClassName: "min-w-[12rem] max-w-[24rem]",
        render: (bucket) => renderUiTags(bucket),
      });
    }
    if (visible.has("tenant")) {
      cols.push({
        id: "tenant",
        label: "Tenant",
        field: "tenant",
        headerClassName: "min-w-[8rem] max-w-[12rem]",
        cellClassName: "min-w-[8rem] max-w-[12rem]",
        render: (bucket) => bucket.tenant ?? "-",
      });
    }
    if (visible.has("owner")) {
      cols.push({
        id: "owner",
        label: "Owner",
        field: "owner",
        headerClassName: "min-w-[14rem]",
        cellClassName: "min-w-[12rem] max-w-[24rem]",
        render: (bucket) => renderOwnerCell(bucket),
      });
    }
    if (visible.has("owner_name")) {
      cols.push({
        id: "owner_name",
        label: "Owner name",
        field: null,
        expensive: true,
        headerClassName: "min-w-[12rem] max-w-[24rem]",
        cellClassName: "min-w-[12rem] max-w-[24rem]",
        render: (bucket) => bucket.owner_name ?? "-",
      });
    }
    if (visible.has("used_bytes")) {
      cols.push({
        id: "used_bytes",
        label: "Used",
        field: "used_bytes",
        headerClassName: "w-28",
        render: (bucket) => formatBytes(bucket.used_bytes),
      });
    }
    if (visible.has("quota_max_size_bytes")) {
      cols.push({
        id: "quota_max_size_bytes",
        label: "Quota",
        field: null,
        headerClassName: "w-36",
        render: (bucket) => {
          const quota = normalizeQuotaLimit(bucket.quota_max_size_bytes);
          return quota !== null ? formatBytes(quota) : "-";
        },
      });
    }
    if (visible.has("object_count")) {
      cols.push({
        id: "object_count",
        label: "Objects",
        field: "object_count",
        headerClassName: "w-24",
        render: (bucket) => formatNumber(bucket.object_count),
      });
    }
    if (visible.has("quota_max_objects")) {
      cols.push({
        id: "quota_max_objects",
        label: "Object quota",
        field: null,
        headerClassName: "w-36",
        render: (bucket) => {
          const quota = normalizeQuotaLimit(bucket.quota_max_objects);
          return quota !== null ? formatNumber(quota) : "-";
        },
      });
    }
    if (visible.has("quota_usage_percent")) {
      cols.push({
        id: "quota_usage_percent",
        label: "Quota usage %",
        field: null,
        headerClassName: "w-40",
        render: (bucket) => {
          const sizePercent = computeQuotaUsagePercent(bucket.used_bytes, bucket.quota_max_size_bytes);
          const objectPercent = computeQuotaUsagePercent(bucket.object_count, bucket.quota_max_objects);
          if (sizePercent === null && objectPercent === null) {
            return "-";
          }
          return (
            <div className="space-y-0.5">
              {sizePercent !== null && (
                <p className="ui-caption text-slate-600 dark:text-slate-300">
                  Size: <span className="font-semibold">{formatQuotaPercent(sizePercent)}</span>
                </p>
              )}
              {objectPercent !== null && (
                <p className="ui-caption text-slate-600 dark:text-slate-300">
                  Obj: <span className="font-semibold">{formatQuotaPercent(objectPercent)}</span>
                </p>
              )}
            </div>
          );
        },
      });
    }
    if (visible.has("tags")) {
      cols.push({
        id: "tags",
        label: "Tags",
        field: null,
        expensive: true,
        headerClassName: "min-w-[12rem] max-w-[24rem]",
        cellClassName: "min-w-[12rem] max-w-[24rem]",
        render: (bucket) => renderTagList(bucket.tags),
      });
    }

    featureColumnOptions.forEach((c) => {
      if (!visible.has(c.id)) return;
      cols.push({
        id: c.id,
        label: c.label,
        field: null,
        expensive: true,
        headerClassName: "w-36",
        render: (bucket) => renderFeatureChip(c.key, bucket),
      });
    });

    if (visible.has("lifecycle_expiration_days")) {
      cols.push({
        id: "lifecycle_expiration_days",
        label: "LC Expiration d",
        field: null,
        expensive: true,
        headerClassName: "w-36",
        render: (bucket) => formatLifecycleDayDetail(bucket, "lifecycle_expiration_days"),
      });
    }
    if (visible.has("lifecycle_noncurrent_expiration_days")) {
      cols.push({
        id: "lifecycle_noncurrent_expiration_days",
        label: "LC Noncurrent exp d",
        field: null,
        expensive: true,
        headerClassName: "w-44",
        render: (bucket) => formatLifecycleDayDetail(bucket, "lifecycle_noncurrent_expiration_days"),
      });
    }
    if (visible.has("lifecycle_transition_days")) {
      cols.push({
        id: "lifecycle_transition_days",
        label: "LC Transition d",
        field: null,
        expensive: true,
        headerClassName: "w-36",
        render: (bucket) => formatLifecycleDayDetail(bucket, "lifecycle_transition_days"),
      });
    }
    if (visible.has("lifecycle_abort_multipart_days")) {
      cols.push({
        id: "lifecycle_abort_multipart_days",
        label: "LC Abort mp d",
        field: null,
        expensive: true,
        headerClassName: "w-36",
        render: (bucket) => formatLifecycleDayDetail(bucket, "lifecycle_abort_multipart_days"),
      });
    }

    if (visible.has("quota_status")) {
      cols.push({
        id: "quota_status",
        label: "Quota status",
        field: null,
        headerClassName: "w-32",
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
      label: "Act.",
      field: null,
      align: "right",
      headerClassName: "w-16",
      cellClassName: "!py-1.5",
      render: (bucket) => (
        <div className="inline-flex items-center">
          <details className="relative">
            <summary
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-600 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100 list-none [&::-webkit-details-marker]:hidden"
              aria-label="More actions"
              title="More actions"
            >
              ⋮
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                disabled={!selectedEndpointId || !cephAdminBrowserEnabled}
                className={`${tableActionMenuItemClasses} !px-2 !py-1 !text-[11px]`}
                title={
                  selectedEndpointId && cephAdminBrowserEnabled
                    ? "Open this bucket in Ceph Admin Browser"
                    : "Ceph Admin Browser is disabled in application settings"
                }
                onClick={(event) => {
                  event.preventDefault();
                  if (!selectedEndpointId || !cephAdminBrowserEnabled) return;
                  const params = new URLSearchParams();
                  params.set("ep", String(selectedEndpointId));
                  params.set("bucket", bucket.name);
                  navigate({ pathname: "/ceph-admin/browser", search: `?${params.toString()}` });
                  const parent = event.currentTarget.closest("details");
                  if (parent) parent.removeAttribute("open");
                }}
              >
                Open in Browser
              </button>
              <button
                type="button"
                className={`${tableActionMenuItemClasses} !px-2 !py-1 !text-[11px]`}
                onClick={(event) => {
                  event.preventDefault();
                  setEditingBucketName(bucket.name);
                  const parent = event.currentTarget.closest("details");
                  if (parent) parent.removeAttribute("open");
                }}
              >
                Configure
              </button>
            </div>
          </details>
        </div>
      ),
    });

    return cols;
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Buckets"
        description="Cluster-level bucket listing (Admin Ops + S3)."
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
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    Columns
                  </button>
                  {showColumnPicker && (
                    <div className="absolute right-0 z-30 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
                            { id: "quota_usage_percent" as const, label: "Quota usage %" },
                            { id: "quota_status" as const, label: "Quota status" },
                            { id: "tags" as const, label: "S3 Tags" },
                          ].map((opt) => (
                            <UiCheckboxField
                              key={opt.id}
                              checked={visibleColumns.includes(opt.id)}
                              onChange={() => toggleColumn(opt.id)}
                              className="flex items-center justify-between ui-body text-slate-700 dark:text-slate-200"
                              inputPosition="end"
                            >
                              <span>{opt.label}</span>
                            </UiCheckboxField>
                          ))}
                        </div>

                        <div className="space-y-2">
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Features</p>
                          <div className="space-y-1.5">
                            {featureColumnOptions.map((opt) => {
                              const detailOptions = featureDetailColumnsByFeature[opt.id] ?? [];
                              const expanded = expandedFeatureColumnGroups[opt.id] === true;
                              return (
                                <div key={opt.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                                  <div className="flex items-center justify-between gap-2">
                                    <UiCheckboxField
                                      checked={visibleColumns.includes(opt.id)}
                                      onChange={() => toggleColumn(opt.id)}
                                      className="flex-1 ui-body text-slate-700 dark:text-slate-200"
                                      inputPosition="end"
                                    >
                                      <span>{opt.label}</span>
                                    </UiCheckboxField>
                                    {detailOptions.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => toggleFeatureColumnGroup(opt.id)}
                                        className="rounded-md border border-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-600 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100"
                                        aria-expanded={expanded}
                                      >
                                        {expanded ? "Details ▾" : "Details ▸"}
                                      </button>
                                    )}
                                  </div>
                                  {detailOptions.length > 0 && expanded && (
                                    <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
                                      {detailOptions.map((detail) => (
                                        <UiCheckboxField
                                          key={detail.id}
                                          checked={visibleColumns.includes(detail.id)}
                                          onChange={() => toggleColumn(detail.id)}
                                          className="flex items-center justify-between ui-caption text-slate-600 dark:text-slate-300"
                                          inputPosition="end"
                                        >
                                          <span>{detail.label}</span>
                                        </UiCheckboxField>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
                            Feature checks and detail values are loaded only for enabled columns.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={resetColumns}
                  disabled={!columnsCustomized}
                  className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
                    columnsCustomized
                      ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                      : "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                  }`}
                >
                  Reset Columns
                </button>
              </div>
            </div>
          </div>
          <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filters</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedFilter(true)}
                    className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
                      showAdvancedFilter || advancedFiltersApplied
                        ? "border-primary/40 bg-primary-50 text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/10 dark:text-primary-100"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    Advanced filter{advancedFiltersApplied ? " · Active" : ""}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <div className="relative">
                    <textarea
                      aria-label="Quick filter"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                      placeholder="Bucket name(s)"
                      rows={1}
                      className={`w-full resize-y rounded-md border bg-white px-2.5 py-1.5 pr-9 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-slate-900 dark:text-slate-100 ${
                        quickFilterFieldState.fieldClass || "border-slate-200 dark:border-slate-700"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={toggleQuickFilterMode}
                      disabled={quickFilterDraftForcesExact}
                      className={modeToggleClass(quickFilterModeForDisplay, quickFilterPending, quickFilterDraftForcesExact)}
                      title={
                        quickFilterDraftForcesExact
                          ? "Quick filter mode: exact (locked by list input)"
                          : `Quick filter mode: ${quickFilterModeForDisplay === "contains" ? "contains" : "exact"}`
                      }
                      aria-label="Toggle quick filter match mode"
                    >
                      {quickFilterModeForDisplay === "contains" ? "~" : "="}
                    </button>
                  </div>
                </div>
                {showTagFilterBar && (
                  <div className="space-y-1 sm:col-span-2">
                    <div className="flex flex-wrap items-center gap-2">
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
                <div className="fixed inset-x-0 bottom-0 top-14 z-40">
                  <button
                    type="button"
                    onClick={closeAdvancedFilterDrawer}
                    className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]"
                    aria-label="Close advanced filter drawer"
                  />
                  <div className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                    <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Advanced filter</p>
                          <p className="ui-caption text-slate-500 dark:text-slate-400">Buckets listing</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {advancedDraftActiveCount} rule{advancedDraftActiveCount > 1 ? "s" : ""}
                            </span>
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                              title={advancedDraftGlobalCostTooltip}
                            >
                              Global draft cost
                              {renderFilterCostIndicator(advancedDraftGlobalCostLevel, advancedDraftGlobalCostTooltip)}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 ui-caption font-semibold ${
                                hasPendingAdvancedChanges
                                  ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-200"
                                  : "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/20 dark:text-emerald-200"
                              }`}
                            >
                              {hasPendingAdvancedChanges ? "Unsaved changes" : "In sync"}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={closeAdvancedFilterDrawer}
                          className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 py-4">
                      <div className="space-y-4">
                        <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Draft summary
                          </p>
                          {advancedDraftSummaryItems.length === 0 ? (
                            <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                              No advanced rule in draft.
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {advancedDraftSummaryItems.map((item) => (
                                <span
                                  key={item.id}
                                  className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 ui-caption font-semibold text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/15 dark:text-primary-100"
                                >
                                  {item.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="inline-flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <span>Identity and tags</span>
                            </p>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${tenantFieldState.labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>Tenant</span>
                                    {renderFilterCostIndicator("low", "Low cost: tenant filter runs on direct bucket metadata.")}
                                  </span>
                                </label>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={tenantDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("tenantMatchMode", "contains")}
                                    className={matchModeButtonClass(tenantDraftEffectiveMatchMode === "contains", tenantDraftForcesExact)}
                                  >
                                    Contains
                                  </button>
                                  <button
                                    type="button"
                                    disabled={tenantDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("tenantMatchMode", "exact")}
                                    className={matchModeButtonClass(tenantDraftEffectiveMatchMode === "exact", tenantDraftForcesExact)}
                                  >
                                    Exact
                                  </button>
                                </div>
                              </div>
                              <textarea
                                value={advancedDraft.tenant}
                                onChange={(e) => updateAdvancedField("tenant", e.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                                placeholder="tenant-a, tenant-b"
                                rows={2}
                                className={`mt-2 w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                                  tenantFieldState.fieldClass
                                }`}
                              />
                            </div>

                            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${ownerFieldState.labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>Owner</span>
                                    {renderFilterCostIndicator("low", "Low cost: owner filter runs on direct bucket metadata.")}
                                  </span>
                                </label>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={ownerDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("ownerMatchMode", "contains")}
                                    className={matchModeButtonClass(ownerDraftEffectiveMatchMode === "contains", ownerDraftForcesExact)}
                                  >
                                    Contains
                                  </button>
                                  <button
                                    type="button"
                                    disabled={ownerDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("ownerMatchMode", "exact")}
                                    className={matchModeButtonClass(ownerDraftEffectiveMatchMode === "exact", ownerDraftForcesExact)}
                                  >
                                    Exact
                                  </button>
                                </div>
                              </div>
                              <textarea
                                value={advancedDraft.owner}
                                onChange={(e) => updateAdvancedField("owner", e.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                                placeholder="owner uid(s)"
                                rows={2}
                                className={`mt-2 w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                                  ownerFieldState.fieldClass
                                }`}
                              />
                            </div>

                            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700 md:col-span-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <label
                                  className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${ownerNameFieldState.labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>Owner name</span>
                                    {renderFilterCostIndicator("medium", "Medium cost: owner-name filters require owner identity lookups.")}
                                  </span>
                                </label>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={ownerNameDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("ownerNameMatchMode", "contains")}
                                    className={matchModeButtonClass(ownerNameDraftEffectiveMatchMode === "contains", ownerNameDraftForcesExact)}
                                  >
                                    Contains
                                  </button>
                                  <button
                                    type="button"
                                    disabled={ownerNameDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("ownerNameMatchMode", "exact")}
                                    className={matchModeButtonClass(ownerNameDraftEffectiveMatchMode === "exact", ownerNameDraftForcesExact)}
                                  >
                                    Exact
                                  </button>
                                </div>
                              </div>
                              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
                                <textarea
                                  value={advancedDraft.ownerName}
                                  onChange={(e) => updateAdvancedField("ownerName", e.target.value)}
                                  onKeyDown={(event) => event.stopPropagation()}
                                  placeholder="display name(s)"
                                  rows={2}
                                  className={`w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                                    ownerNameFieldState.fieldClass
                                  }`}
                                />
                                <select
                                  value={advancedDraft.ownerNameScope}
                                  onChange={(e) => setAdvancedDraft((prev) => ({ ...prev, ownerNameScope: e.target.value as OwnerNameScope }))}
                                  className={`rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                                    ownerNameFieldState.fieldClass
                                  }`}
                                  title="Owner entity scope"
                                >
                                  <option value="any">Accounts + Users</option>
                                  <option value="account">Accounts only</option>
                                  <option value="user">Users only</option>
                                </select>
                              </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700 md:col-span-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <label
                                  className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${s3TagsFieldState.labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>S3 tags</span>
                                    {renderFilterCostIndicator("high", "High cost: S3 tag filters require bucket tag retrieval.")}
                                  </span>
                                </label>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={s3TagsDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("s3TagsMatchMode", "contains")}
                                    className={matchModeButtonClass(s3TagsDraftEffectiveMatchMode === "contains", s3TagsDraftForcesExact)}
                                  >
                                    Contains
                                  </button>
                                  <button
                                    type="button"
                                    disabled={s3TagsDraftForcesExact}
                                    onClick={() => updateAdvancedMatchMode("s3TagsMatchMode", "exact")}
                                    className={matchModeButtonClass(s3TagsDraftEffectiveMatchMode === "exact", s3TagsDraftForcesExact)}
                                  >
                                    Exact
                                  </button>
                                </div>
                              </div>
                              <textarea
                                value={advancedDraft.s3Tags}
                                onChange={(e) => updateAdvancedField("s3Tags", e.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                                placeholder="env=prod, team=storage"
                                rows={2}
                                className={`mt-2 w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                                  s3TagsFieldState.fieldClass
                                }`}
                              />
                              <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                Comma or newline separated expressions. Format examples: <code>key=value</code>, <code>env</code>.
                              </p>
                            </div>
                          </div>
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="inline-flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <span>Storage Metrics and Quota</span>
                              {renderFilterCostIndicator(
                                "medium",
                                "Medium cost: storage metrics and quota filters require bucket stats."
                              )}
                            </p>
                            {!usageFeatureEnabled && (
                              <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 ui-caption font-semibold text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-200">
                                Storage metrics disabled on endpoint
                              </span>
                            )}
                          </div>

                          {!usageFeatureEnabled ? (
                            <p className="ui-caption text-slate-500 dark:text-slate-400">
                              This endpoint does not expose storage metrics, so range filters are disabled.
                            </p>
                          ) : (
                            <div className="grid gap-3 lg:grid-cols-2">
                              {[
                                {
                                  title: "Usage",
                                  rows: [
                                    { label: "Bytes", minId: "minUsedBytes" as const, maxId: "maxUsedBytes" as const },
                                    { label: "Objects", minId: "minObjects" as const, maxId: "maxObjects" as const },
                                  ],
                                },
                                {
                                  title: "Quota",
                                  rows: [
                                    { label: "Bytes", minId: "minQuotaBytes" as const, maxId: "maxQuotaBytes" as const },
                                    { label: "Objects", minId: "minQuotaObjects" as const, maxId: "maxQuotaObjects" as const },
                                  ],
                                },
                              ].map((section) => (
                                <div key={section.title} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    {section.title}
                                  </p>
                                  <div className="mt-2 space-y-2">
                                    {section.rows.map((row) => {
                                      const minApplied = (advancedApplied?.[row.minId] ?? "").trim();
                                      const minDraft = advancedDraft[row.minId].trim();
                                      const maxApplied = (advancedApplied?.[row.maxId] ?? "").trim();
                                      const maxDraft = advancedDraft[row.maxId].trim();
                                      const rowState = fieldHighlight(
                                        Boolean(minApplied || maxApplied),
                                        minDraft !== minApplied || maxDraft !== maxApplied
                                      );
                                      const minState = fieldHighlight(Boolean(minApplied), minDraft !== minApplied);
                                      const maxState = fieldHighlight(Boolean(maxApplied), maxDraft !== maxApplied);
                                      return (
                                        <div key={`${section.title}:${row.label}`}>
                                          <label className={`ui-caption font-medium text-slate-600 dark:text-slate-300 ${rowState.labelClass}`}>{row.label}</label>
                                          <div className="mt-1 grid grid-cols-2 gap-2">
                                            <input
                                              type="number"
                                              min="0"
                                              inputMode="numeric"
                                              value={advancedDraft[row.minId]}
                                              onChange={(e) => updateAdvancedField(row.minId, e.target.value)}
                                              placeholder="min"
                                              className={`w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${minState.fieldClass}`}
                                            />
                                            <input
                                              type="number"
                                              min="0"
                                              inputMode="numeric"
                                              value={advancedDraft[row.maxId]}
                                              onChange={(e) => updateAdvancedField(row.maxId, e.target.value)}
                                              placeholder="max"
                                              className={`w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${maxState.fieldClass}`}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="inline-flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <span>Feature states</span>
                              {renderFilterCostIndicator("high", "High cost: feature-state filters may trigger extra checks.")}
                            </p>
                            <span className="ui-caption text-slate-500 dark:text-slate-400">
                              {advancedDraftFeatureCount} active
                            </span>
                          </div>
                          {featureStateOptions.some((feature) => !feature.supported) && (
                            <p className="mb-3 ui-caption text-slate-500 dark:text-slate-400">
                              Some features are disabled on this endpoint and cannot be filtered.
                            </p>
                          )}
                          <div className="grid gap-2 sm:grid-cols-2">
                            {featureStateOptions.map((feature) => {
                              const disabled = !feature.supported;
                              const appliedValue = advancedApplied?.features[feature.id] ?? "any";
                              const draftValue = advancedDraft.features[feature.id];
                              const state = disabled
                                ? { labelClass: "", fieldClass: "" }
                                : fieldHighlight(appliedValue !== "any", draftValue !== appliedValue);
                              return (
                                <div
                                  key={feature.id}
                                  className={`rounded-lg border border-slate-200 p-2.5 dark:border-slate-700 ${disabled ? "opacity-60" : ""}`}
                                >
                                  <label className={`ui-caption font-medium text-slate-700 dark:text-slate-200 ${state.labelClass}`}>{feature.label}</label>
                                  <select
                                    value={advancedDraft.features[feature.id]}
                                    onChange={(e) => updateFeatureFilter(feature.id, e.target.value as FeatureFilterState)}
                                    className={`mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${state.fieldClass}`}
                                    disabled={disabled}
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
                                  {disabled && (
                                    <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                      {feature.label} is disabled on this endpoint.
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="inline-flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <span>Feature details</span>
                              {renderFilterCostIndicator(
                                "high",
                                "High cost: feature-detail filters may trigger additional per-bucket data retrieval."
                              )}
                            </p>
                            <span className="ui-caption text-slate-500 dark:text-slate-400">
                              {featureDetailDraftLabels.length} active
                            </span>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Lifecycle
                              </p>
                              <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                Rule name, type and lifecycle day conditions are evaluated on the same lifecycle rule.
                              </p>
                              <div className="mt-2 space-y-2">
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule name</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleRuleNameMode}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleRuleNameMode",
                                          e.target.value as FeatureDetailFilters["lifecycleRuleNameMode"]
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="any">Any</option>
                                      <option value="has_named">Has named rule</option>
                                      <option value="has_not_named">Has no named rule</option>
                                    </select>
                                    <input
                                      type="text"
                                      value={advancedDraft.featureDetails.lifecycleRuleName}
                                      onChange={(e) => updateFeatureDetailFilter("lifecycleRuleName", e.target.value)}
                                      placeholder="rule-id"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Rule type</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleRuleTypeMode}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleRuleTypeMode",
                                          e.target.value as FeatureDetailFilters["lifecycleRuleTypeMode"]
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="any">Any</option>
                                      <option value="has">Has rule type</option>
                                      <option value="has_not">Has no rule type</option>
                                    </select>
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleRuleTypeValue}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleRuleTypeValue",
                                          e.target.value as FeatureDetailFilters["lifecycleRuleTypeValue"]
                                        )
                                      }
                                      disabled={advancedDraft.featureDetails.lifecycleRuleTypeMode === "any"}
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="">Select type</option>
                                      {LIFECYCLE_TYPE_OPTIONS.map((option) => (
                                        <option key={option.key} value={option.key}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Expiration days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleExpirationDaysOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleExpirationDaysOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.lifecycleExpirationDays}
                                      onChange={(e) => updateFeatureDetailFilter("lifecycleExpirationDays", e.target.value)}
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Noncurrent expiration days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleNoncurrentExpirationDaysOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleNoncurrentExpirationDaysOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.lifecycleNoncurrentExpirationDays}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter("lifecycleNoncurrentExpirationDays", e.target.value)
                                      }
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Transition days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleTransitionDaysOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleTransitionDaysOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.lifecycleTransitionDays}
                                      onChange={(e) => updateFeatureDetailFilter("lifecycleTransitionDays", e.target.value)}
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Abort days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.lifecycleAbortDaysOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "lifecycleAbortDaysOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.lifecycleAbortDays}
                                      onChange={(e) => updateFeatureDetailFilter("lifecycleAbortDays", e.target.value)}
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Object Lock and BPA
                              </p>
                              <div className="mt-2 space-y-2">
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Object Lock mode</label>
                                  <select
                                    value={advancedDraft.featureDetails.objectLockMode}
                                    onChange={(e) =>
                                      updateFeatureDetailFilter(
                                        "objectLockMode",
                                        e.target.value as FeatureDetailFilters["objectLockMode"]
                                      )
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    <option value="">Any</option>
                                    <option value="GOVERNANCE">GOVERNANCE</option>
                                    <option value="COMPLIANCE">COMPLIANCE</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Object Lock retention days</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.objectLockRetentionOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "objectLockRetentionOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.objectLockRetentionDays}
                                      onChange={(e) => updateFeatureDetailFilter("objectLockRetentionDays", e.target.value)}
                                      placeholder="days"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  {[
                                    { key: "bpaBlockPublicAcls" as const, label: "Block public ACLs" },
                                    { key: "bpaIgnorePublicAcls" as const, label: "Ignore public ACLs" },
                                    { key: "bpaBlockPublicPolicy" as const, label: "Block public policy" },
                                    { key: "bpaRestrictPublicBuckets" as const, label: "Restrict public buckets" },
                                  ].map((entry) => (
                                    <div key={entry.key}>
                                      <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">{entry.label}</label>
                                      <select
                                        value={advancedDraft.featureDetails[entry.key]}
                                        onChange={(e) =>
                                          updateFeatureDetailFilter(
                                            entry.key,
                                            e.target.value as FeatureDetailFilters[typeof entry.key]
                                          )
                                        }
                                        className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      >
                                        {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                CORS and Logging
                              </p>
                              <div className="mt-2 space-y-2">
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">CORS method</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.corsMethodMode}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "corsMethodMode",
                                          e.target.value as FeatureDetailFilters["corsMethodMode"]
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="any">Any</option>
                                      <option value="has">Has</option>
                                      <option value="has_not">Has not</option>
                                    </select>
                                    <input
                                      type="text"
                                      value={advancedDraft.featureDetails.corsMethodValue}
                                      onChange={(e) => updateFeatureDetailFilter("corsMethodValue", e.target.value)}
                                      placeholder="GET"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">CORS origin</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.corsOriginMode}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "corsOriginMode",
                                          e.target.value as FeatureDetailFilters["corsOriginMode"]
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      <option value="any">Any</option>
                                      <option value="has">Has</option>
                                      <option value="has_not">Has not</option>
                                    </select>
                                    <input
                                      type="text"
                                      value={advancedDraft.featureDetails.corsOriginValue}
                                      onChange={(e) => updateFeatureDetailFilter("corsOriginValue", e.target.value)}
                                      placeholder="https://example.test"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Logging enabled</label>
                                  <select
                                    value={advancedDraft.featureDetails.loggingEnabled}
                                    onChange={(e) =>
                                      updateFeatureDetailFilter(
                                        "loggingEnabled",
                                        e.target.value as FeatureDetailFilters["loggingEnabled"]
                                      )
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Logging target bucket</label>
                                  <input
                                    type="text"
                                    value={advancedDraft.featureDetails.loggingTargetBucket}
                                    onChange={(e) => updateFeatureDetailFilter("loggingTargetBucket", e.target.value)}
                                    placeholder="audit-bucket"
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Website and Policy
                              </p>
                              <div className="mt-2 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website index present</label>
                                    <select
                                      value={advancedDraft.featureDetails.websiteIndexPresent}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "websiteIndexPresent",
                                          e.target.value as FeatureDetailFilters["websiteIndexPresent"]
                                        )
                                      }
                                      className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Website redirect host present</label>
                                    <select
                                      value={advancedDraft.featureDetails.websiteRedirectHostPresent}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "websiteRedirectHostPresent",
                                          e.target.value as FeatureDetailFilters["websiteRedirectHostPresent"]
                                        )
                                      }
                                      className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Policy statements</label>
                                  <div className="mt-1 grid grid-cols-5 gap-2">
                                    <select
                                      value={advancedDraft.featureDetails.policyStatementOp}
                                      onChange={(e) =>
                                        updateFeatureDetailFilter(
                                          "policyStatementOp",
                                          e.target.value as NumericComparisonOpUi
                                        )
                                      }
                                      className="col-span-2 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                      {NUMERIC_FILTER_OPTIONS.map((op) => (
                                        <option key={op} value={op}>
                                          {op}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      value={advancedDraft.featureDetails.policyStatementCount}
                                      onChange={(e) => updateFeatureDetailFilter("policyStatementCount", e.target.value)}
                                      placeholder="count"
                                      className="col-span-3 rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">Policy has conditions</label>
                                  <select
                                    value={advancedDraft.featureDetails.policyHasConditions}
                                    onChange={(e) =>
                                      updateFeatureDetailFilter(
                                        "policyHasConditions",
                                        e.target.value as FeatureDetailFilters["policyHasConditions"]
                                      )
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    {BOOLEAN_FILTER_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>
                        </section>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 bg-white/95 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/95">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          {hasPendingAdvancedChanges
                            ? "Draft has unapplied changes."
                            : advancedDraftActiveCount > 0
                              ? "Draft matches applied filters."
                              : "No advanced filter configured."}
                        </p>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={resetAdvancedFilter}
                            disabled={!hasAnyAdvancedToClear}
                            className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
                              hasAnyAdvancedToClear
                                ? "border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
                                : "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                            }`}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            onClick={closeAdvancedFilterDrawer}
                            className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
                          >
                            Close
                          </button>
                          <button
                            type="button"
                            onClick={applyAdvancedFilter}
                            disabled={!hasPendingAdvancedChanges}
                            className={`rounded-md px-2.5 py-1.5 ui-caption font-semibold ${
                              hasPendingAdvancedChanges
                                ? "bg-primary text-white shadow-sm hover:bg-primary-600"
                                : "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                            }`}
                          >
                            Apply filters
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {showActiveFiltersCard && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="ui-caption font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-200">ACTIVE FILTERS</p>
                    {activeFilterSummaryItems.map((item) => (
                      <span
                        key={item.id}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 ui-caption font-semibold text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/15 dark:text-primary-100"
                      >
                        {item.label}
                        <button
                          type="button"
                          onClick={() => removeActiveFilterItem(item.remove)}
                          className="rounded-full px-1 leading-none opacity-75 transition hover:bg-primary/20 hover:opacity-100 dark:hover:bg-primary-400/20"
                          title={`Remove ${item.label}`}
                          aria-label={`Remove ${item.label}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 ui-caption font-semibold text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {selectedCount > 0 && (
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                    {selectedCount} bucket{selectedCount > 1 ? "s" : ""} selected
                    {hiddenSelectedCount > 0 && (
                      <span className="ml-2 ui-caption font-semibold text-red-600 dark:text-red-400">
                        ({hiddenSelectedCount} not visible)
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 ui-caption font-semibold text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                  >
                    Clear selection
                  </button>
                  <details className="relative">
                    <summary className="list-none rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600 [&::-webkit-details-marker]:hidden">
                      + Tag selection
                    </summary>
                    <div className="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {availableUiTags.length === 0 ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">No existing UI tags yet.</p>
                      ) : (
                        <>
                          <p className="px-1 pb-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Suggestions
                          </p>
                          <div className="max-h-40 space-y-1 overflow-auto">
                            {availableUiTags.map((tag) => (
                              <button
                                key={`selection-add:${tag}`}
                                type="button"
                                className="flex w-full items-center rounded-md px-2 py-1 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                                onClick={(event) => {
                                  event.preventDefault();
                                  void applyUiTagToSelection(tag, "add");
                                  const parent = event.currentTarget.closest("details");
                                  if (parent) parent.removeAttribute("open");
                                }}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
                        <p className="px-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Custom</p>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={selectionTagAddInput}
                            onChange={(event) => setSelectionTagAddInput(event.target.value)}
                            placeholder="new-tag"
                            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                          <button
                            type="button"
                            className="rounded-md bg-primary px-2 py-1 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={parsedSelectionTagAddInput.length === 0 || selectionTagActionLoading !== null}
                            onClick={(event) => {
                              event.preventDefault();
                              const customTag = selectionTagAddInput;
                              setSelectionTagAddInput("");
                              void applyUiTagToSelection(customTag, "add");
                              const parent = event.currentTarget.closest("details");
                              if (parent) parent.removeAttribute("open");
                            }}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                  </details>
                  <details className="relative">
                    <summary className="list-none rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600 [&::-webkit-details-marker]:hidden">
                      - Tag selection
                    </summary>
                    <div className="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {selectedUiTagSuggestions.length === 0 ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">No UI tags found on this selection.</p>
                      ) : (
                        <div className="max-h-48 space-y-1 overflow-auto">
                          {selectedUiTagSuggestions.map((tag) => (
                            <button
                              key={`selection-remove:${tag}`}
                              type="button"
                              className="flex w-full items-center rounded-md px-2 py-1 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                              onClick={(event) => {
                                event.preventDefault();
                                void applyUiTagToSelection(tag, "remove");
                                const parent = event.currentTarget.closest("details");
                                if (parent) parent.removeAttribute("open");
                              }}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <details className="relative">
                    <summary className="list-none rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600 [&::-webkit-details-marker]:hidden">
                      {selectionExportLoading ? "Exporting..." : "Export list"}
                    </summary>
                    <div className="absolute left-0 z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      <button
                        type="button"
                        className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800"
                        disabled={selectionExportLoading !== null}
                        onClick={(event) => {
                          event.preventDefault();
                          void exportSelectedBuckets("text");
                          const parent = event.currentTarget.closest("details");
                          if (parent) parent.removeAttribute("open");
                        }}
                      >
                        Text (bucket names only)
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800"
                        disabled={selectionExportLoading !== null}
                        onClick={(event) => {
                          event.preventDefault();
                          void exportSelectedBuckets("csv");
                          const parent = event.currentTarget.closest("details");
                          if (parent) parent.removeAttribute("open");
                        }}
                      >
                        CSV (selected columns)
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800"
                        disabled={selectionExportLoading !== null}
                        onClick={(event) => {
                          event.preventDefault();
                          void exportSelectedBuckets("json");
                          const parent = event.currentTarget.closest("details");
                          if (parent) parent.removeAttribute("open");
                        }}
                      >
                        JSON (selected columns)
                      </button>
                    </div>
                  </details>
                  <button
                    type="button"
                    onClick={() => setShowCompareModal(true)}
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
                  >
                    Compare buckets
                  </button>
                  <button
                    type="button"
                    onClick={openBulkUpdateModal}
                    className="rounded-md bg-primary px-2.5 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600"
                  >
                    Bulk update
                  </button>
                </div>
              </div>
            </div>
          )}

        {advancedProgress.active && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-white/90 p-3 dark:border-slate-700 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                {advancedProgress.determinate
                  ? `Advanced search in progress · ${Math.max(0, Math.min(100, Math.round(advancedProgress.percent)))}%`
                  : "Advanced search in progress..."}
              </p>
              {(advancedProgress.message || advancedProgress.stage) && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {advancedProgress.message || formatAdvancedSearchStage(advancedProgress.stage)}
                </p>
              )}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar">
              {advancedProgress.determinate ? (
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, Math.round(advancedProgress.percent)))}%` }}
                />
              ) : (
                <div className="h-full w-full animate-pulse rounded-full bg-primary/70" />
              )}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="manager-table !table-auto !w-max min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {bucketTableColumns.map((col) => {
                  const detailLoadingClass = loadingDetails && detailLoadingColumnIds.has(col.id) ? "animate-pulse" : "";
                  const minWidthClass =
                    col.id !== "select" && !col.headerClassName ? defaultColumnMinWidthClass : "";
                  const stickyHeaderClass =
                    col.id === "select"
                      ? "sticky left-0 z-40 bg-slate-100 dark:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),10px_0_14px_-12px_rgba(15,23,42,0.4)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),10px_0_14px_-12px_rgba(2,6,23,0.85)]"
                      : col.id === "name"
                        ? "sticky left-10 z-30 bg-slate-100 dark:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),12px_0_16px_-12px_rgba(15,23,42,0.45)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),12px_0_16px_-12px_rgba(2,6,23,0.85)]"
                        : "";
                  const headerClass = `${minWidthClass} ${col.headerClassName ?? ""} ${col.expensive ? expensiveColumnClass : ""} ${detailLoadingClass} ${stickyHeaderClass}`;
                  if (col.header || !col.field) {
                    return (
                    <th
                      key={col.id}
                      className={`py-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                        col.align === "right" ? "text-right" : "text-left"
                      } ${col.id === "select" ? "w-10 px-3" : "px-6"} ${headerClass}`}
                    >
                      <div className="flex items-start">{col.header ?? col.label}</div>
                    </th>
                    );
                  }
                  return (
                    <SortableHeader
                      key={col.id}
                      label={col.label}
                      field={col.field}
                      activeField={sort.field}
                      direction={sort.direction}
                      align={col.align ?? (col.label === "Actions" ? "right" : "left")}
                      className={headerClass}
                      onSort={col.field ? (field) => toggleSort(field as SortField) : undefined}
                    />
                  );
                })}
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
                  <tr key={`${bucket.tenant ?? ""}:${bucket.name}`} className="group hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    {bucketTableColumns.map((col) => {
                      const align = col.align ?? (col.id === "actions" ? "right" : "left");
                      const cellBase =
                        align === "right"
                          ? "px-6 py-4 text-right"
                          : col.id === "select"
                            ? "w-10 px-3 py-4"
                            : "px-6 py-4";
                      const isSelect = col.id === "select";
                      const textClass =
                        isSelect
                          ? ""
                          : col.id === "name"
                          ? "manager-table-cell ui-body font-semibold text-slate-900 dark:text-slate-100"
                          : "ui-body text-slate-600 dark:text-slate-300";
                      const isDetailLoadingColumn = loadingDetails && detailLoadingColumnIds.has(col.id);
                      const detailLoadingCellClass = isDetailLoadingColumn
                        ? col.expensive
                          ? "animate-pulse bg-amber-100/70 dark:bg-amber-900/30"
                          : "animate-pulse bg-slate-100/70 dark:bg-slate-800/60"
                        : "";
                      const stickyCellClass =
                        col.id === "select"
                          ? "sticky left-0 z-20 bg-white dark:bg-slate-900 group-hover:bg-slate-100 dark:group-hover:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),10px_0_14px_-12px_rgba(15,23,42,0.4)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),10px_0_14px_-12px_rgba(2,6,23,0.85)]"
                          : col.id === "name"
                            ? "sticky left-10 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-100 dark:group-hover:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),12px_0_16px_-12px_rgba(15,23,42,0.45)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),12px_0_16px_-12px_rgba(2,6,23,0.85)]"
                            : "";
                      return (
                        <td
                          key={`${bucket.name}:${col.id}`}
                          className={`${cellBase} ${textClass} ${col.cellClassName ?? ""} ${col.expensive ? expensiveColumnClass : ""} ${detailLoadingCellClass} ${stickyCellClass}`}
                        >
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
      {editingBucketName && (
        <Modal
          title={`Configure bucket · ${editingBucketName}`}
          onClose={() => setEditingBucketName(null)}
          maxWidthClass="max-w-7xl"
          maxBodyHeightClass="max-h-[85vh]"
        >
          <BucketDetailPage mode="ceph-admin" bucketNameOverride={editingBucketName} embedded />
        </Modal>
      )}
      {showCompareModal && selectedEndpointId && (
        <CephAdminBucketCompareModal
          sourceEndpointId={selectedEndpointId}
          sourceEndpointName={selectedEndpoint?.name}
          sourceBuckets={selectedBucketList}
          endpoints={endpoints}
          onClose={() => setShowCompareModal(false)}
        />
      )}
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
                  <option value="copy_configs">Copy configs</option>
                  <option value="paste_configs" disabled={!bulkConfigClipboard}>
                    {bulkConfigClipboard ? "Paste copied configs" : "Paste copied configs (nothing copied)"}
                  </option>
                  <option value="set_quota" disabled={!usageFeatureEnabled}>
                    {usageFeatureEnabled ? "Set bucket quota" : "Set bucket quota (storage metrics disabled)"}
                  </option>
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
            {bulkOperation === "copy_configs" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Configurations to copy
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(Object.keys(BULK_COPY_FEATURE_LABELS) as BulkCopyFeatureKey[]).map((feature) => (
                      <UiCheckboxField
                        key={feature}
                        checked={bulkCopyFeatures[feature]}
                        onChange={(event) =>
                          setBulkCopyFeatures((prev) => ({ ...prev, [feature]: event.target.checked }))
                        }
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        {BULK_COPY_FEATURE_LABELS[feature]}
                      </UiCheckboxField>
                    ))}
                  </div>
                </div>
                {bulkConfigClipboard && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                    <p className="ui-caption text-slate-600 dark:text-slate-300">
                      Clipboard currently contains config from{" "}
                      <span className="font-semibold">{bulkConfigClipboard.buckets.length}</span> bucket
                      {bulkConfigClipboard.buckets.length > 1 ? "s" : ""} on{" "}
                      <span className="font-semibold">
                        {bulkConfigClipboard.sourceEndpointName ?? `Endpoint #${bulkConfigClipboard.sourceEndpointId}`}
                      </span>
                      {bulkClipboardCopiedAtLabel ? ` (copied ${bulkClipboardCopiedAtLabel})` : ""}.
                    </p>
                    {bulkClipboardFeatureLabels.length > 0 && (
                      <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                        Features: {bulkClipboardFeatureLabels.join(", ")}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {bulkOperation === "paste_configs" && (
              <div className="space-y-4">
                {!bulkConfigClipboard ? (
                  <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                    No copied configuration available. Use "Copy configs" first.
                  </p>
                ) : (
                  <>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                      <p className="ui-caption text-slate-700 dark:text-slate-200">
                        Source:{" "}
                        <span className="font-semibold">
                          {bulkConfigClipboard.sourceEndpointName ?? `Endpoint #${bulkConfigClipboard.sourceEndpointId}`}
                        </span>{" "}
                        · {bulkConfigClipboard.buckets.length} bucket{bulkConfigClipboard.buckets.length > 1 ? "s" : ""} ·
                        {bulkClipboardCopiedAtLabel ? ` copied ${bulkClipboardCopiedAtLabel}` : " copied recently"}
                      </p>
                      <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                        Destination selection: {selectedBucketList.length} bucket{selectedBucketList.length > 1 ? "s" : ""}.
                      </p>
                      {bulkClipboardFeatureLabels.length > 0 && (
                        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                          Pasted features: {bulkClipboardFeatureLabels.join(", ")}.
                        </p>
                      )}
                    </div>
                    {bulkPastePlan.mode === "one_to_many" && (
                      <div className="space-y-1 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                        <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                          Proposed mapping: 1 source to all selected destinations.
                        </p>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Source bucket:{" "}
                          <span className="font-semibold">{bulkConfigClipboard.buckets[0]?.name ?? "-"}</span>
                        </p>
                      </div>
                    )}
                    {bulkPastePlan.mode === "one_to_one" && (
                      <div className="space-y-2">
                        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Proposed mapping (1:1)
                        </p>
                        <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                          <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                            <thead className="bg-slate-100 dark:bg-slate-900/60">
                              <tr>
                                <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Source bucket
                                </th>
                                <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Destination bucket
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                              {bulkClipboardSourceBuckets.map((sourceBucket) => {
                                const usedByOther = new Set(
                                  Object.entries(bulkPasteMapping)
                                    .filter(([otherSource, destination]) => otherSource !== sourceBucket && destination.trim())
                                    .map(([, destination]) => normalizeBucketName(destination))
                                );
                                return (
                                  <tr key={sourceBucket}>
                                    <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{sourceBucket}</td>
                                    <td className="px-3 py-2">
                                      <select
                                        value={bulkPasteMapping[sourceBucket] ?? ""}
                                        onChange={(event) =>
                                          setBulkPasteMapping((prev) => ({ ...prev, [sourceBucket]: event.target.value }))
                                        }
                                        className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      >
                                        <option value="">Select destination bucket</option>
                                        {selectedBucketList.map((destinationBucket) => {
                                          const normalizedDestination = normalizeBucketName(destinationBucket);
                                          const isUsed = usedByOther.has(normalizedDestination);
                                          const isSameBucketConflict =
                                            bulkClipboardSameEndpoint &&
                                            normalizeBucketName(sourceBucket) === normalizedDestination;
                                          return (
                                            <option
                                              key={`${sourceBucket}-${destinationBucket}`}
                                              value={destinationBucket}
                                              disabled={isUsed || isSameBucketConflict}
                                            >
                                              {destinationBucket}
                                              {isSameBucketConflict ? " (same bucket not allowed)" : isUsed ? " (already used)" : ""}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {!bulkPastePlan.mode && (
                      <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                        Mapping impossible with current source/destination selections.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            {bulkOperation === "set_quota" && (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <UiCheckboxField
                    checked={bulkQuotaApplySize}
                    onChange={(event) => setBulkQuotaApplySize(event.target.checked)}
                    className="ui-caption text-slate-600 dark:text-slate-300"
                  >
                    Update storage quota
                  </UiCheckboxField>
                  <UiCheckboxField
                    checked={bulkQuotaApplyObjects}
                    onChange={(event) => setBulkQuotaApplyObjects(event.target.checked)}
                    className="ui-caption text-slate-600 dark:text-slate-300"
                  >
                    Update object quota
                  </UiCheckboxField>
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
                <UiCheckboxField
                  checked={bulkQuotaSkipConfigured}
                  onChange={(event) => setBulkQuotaSkipConfigured(event.target.checked)}
                  className="ui-caption text-slate-600 dark:text-slate-300"
                >
                  Do not change buckets that already have a quota.
                </UiCheckboxField>
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
                    <UiCheckboxField
                      key={option.key}
                      checked={bulkPublicAccessBlockTargets[option.key]}
                      onChange={(event) =>
                        setBulkPublicAccessBlockTargets((prev) => ({ ...prev, [option.key]: event.target.checked }))
                      }
                      className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                    >
                      {option.label}
                    </UiCheckboxField>
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
                <UiCheckboxField
                  checked={bulkLifecycleUpdateOnlyExisting}
                  onChange={(event) => setBulkLifecycleUpdateOnlyExisting(event.target.checked)}
                  className="ui-caption text-slate-600 dark:text-slate-300"
                >
                  Only update rules that already exist (do not add new rules).
                </UiCheckboxField>
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
                      <UiCheckboxField
                        key={option.key}
                        checked={bulkLifecycleDeleteTypes[option.key]}
                        onChange={(event) =>
                          setBulkLifecycleDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                        }
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        {option.label}
                      </UiCheckboxField>
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
                <UiCheckboxField
                  checked={bulkCorsUpdateOnlyExisting}
                  onChange={(event) => setBulkCorsUpdateOnlyExisting(event.target.checked)}
                  className="ui-caption text-slate-600 dark:text-slate-300"
                >
                  Only update rules that already exist (do not add new rules).
                </UiCheckboxField>
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
                      <UiCheckboxField
                        key={option.key}
                        checked={bulkCorsDeleteTypes[option.key]}
                        onChange={(event) =>
                          setBulkCorsDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                        }
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        {option.label}
                      </UiCheckboxField>
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
                <UiCheckboxField
                  checked={bulkPolicyUpdateOnlyExisting}
                  onChange={(event) => setBulkPolicyUpdateOnlyExisting(event.target.checked)}
                  className="ui-caption text-slate-600 dark:text-slate-300"
                >
                  Only update statements that already exist (do not add new statements).
                </UiCheckboxField>
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
                      <UiCheckboxField
                        key={option.key}
                        checked={bulkPolicyDeleteTypes[option.key]}
                        onChange={(event) =>
                          setBulkPolicyDeleteTypes((prev) => ({ ...prev, [option.key]: event.target.checked }))
                        }
                        className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                      >
                        {option.label}
                      </UiCheckboxField>
                    ))}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Statements are deleted if the Sid matches or if any selected type is present.
                  </p>
                </div>
              </div>
            )}
            {bulkOperation === "paste_configs" && bulkPastePlan.error && (
              <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{bulkPastePlan.error}</p>
            )}
            {bulkCopyError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{bulkCopyError}</p>}
            {bulkCopySummary && <p className="ui-caption font-semibold text-emerald-600 dark:text-emerald-200">{bulkCopySummary}</p>}
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
              {bulkOperation === "copy_configs" ? (
                <button
                  type="button"
                  onClick={() => {
                    void copyBulkConfigs();
                  }}
                  disabled={bulkCopyLoading || !hasSelectedCopyFeatures}
                  className="rounded-md bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkCopyLoading ? "Copying..." : "Copy selected configs"}
                </button>
              ) : (
                <>
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
                      (bulkOperation === "delete_policy" && !hasPolicyDeleteCriteria) ||
                      (bulkOperation === "paste_configs" && Boolean(bulkPastePlan.error))
                    }
                    className="rounded-md bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {bulkPreviewLoading ? "Previewing..." : "Preview"}
                  </button>
                  <button
                    type="button"
                    onClick={exportBulkPreviewChanges}
                    disabled={bulkPreviewLoading || bulkPreview.length === 0}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
                  >
                    Export changes
                  </button>
                  {bulkPreviewReady && (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      Changes: {previewStats.changed} / Unchanged: {previewStats.unchanged} / Errors: {previewStats.errors}
                    </p>
                  )}
                </>
              )}
            </div>
            {bulkPreview.length > 0 && (
              <div className="max-h-[420px] space-y-2 overflow-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                {bulkPreview.map((item) => {
                  const sections = buildPreviewSections(item);
                  const changedSections = sections.filter((section) => section.changed).length;
                  return (
                    <details
                      key={item.bucket}
                      defaultOpen={Boolean(item.error || item.changed)}
                      className="rounded-lg border border-slate-200 dark:border-slate-800"
                    >
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{item.bucket}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${bucketPreviewBadgeClasses(item)}`}
                          >
                            {item.error ? "Error" : item.changed ? "Change" : "No change"}
                          </span>
                          <span className="ui-caption text-slate-500 dark:text-slate-400">
                            Changed sections {changedSections}/{sections.length}
                          </span>
                        </div>
                      </summary>
                      <div className="space-y-2 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                        {sections.map((section) => (
                          <details
                            key={`${item.bucket}:${section.key}`}
                            defaultOpen={Boolean(section.error || section.changed)}
                            className="rounded-md border border-slate-200 dark:border-slate-800"
                          >
                            <summary className="cursor-pointer list-none px-2.5 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{section.label}</span>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sectionPreviewBadgeClasses(
                                    section.changed
                                  )}`}
                                >
                                  {section.changed ? "Changed" : "Unchanged"}
                                </span>
                              </div>
                            </summary>
                            <div className="space-y-2 border-t border-slate-200 px-2.5 py-2 dark:border-slate-800">
                              {section.error ? (
                                <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{section.error}</p>
                              ) : (
                                <div className="grid gap-2 lg:grid-cols-2">
                                  <div className="space-y-1">
                                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                      Before
                                    </p>
                                    {renderPreviewLines(section.before)}
                                  </div>
                                  <div className="space-y-1">
                                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                      After
                                    </p>
                                    {renderPreviewLines(section.after)}
                                  </div>
                                </div>
                              )}
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  );
                })}
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
              {bulkOperation !== "copy_configs" && (
                <button
                  type="button"
                  className="rounded-full bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={applyBulkUpdate}
                  disabled={!bulkPreviewReady || bulkApplyLoading}
                >
                  {bulkApplyLoading ? "Applying..." : "Apply changes"}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

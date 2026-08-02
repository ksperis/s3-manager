/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  isNotificationConfigurationEmpty,
  normalizeNotificationConfigurationForBulk,
  stableStringify,
  type NotificationConfigurationTypeKey,
} from "../cephAdmin/bucketJsonParsers";

export type LifecycleRuleTypeKey =
  | "expiration"
  | "delete_markers"
  | "noncurrent_expiration"
  | "abort_multipart"
  | "transition"
  | "noncurrent_transition";

export type CorsRuleTypeKey =
  | "wildcard_origins"
  | "read_methods"
  | "write_methods"
  | "allow_credentials"
  | "expose_headers"
  | "max_age";

export type PolicyRuleTypeKey =
  | "allow"
  | "deny"
  | "read_actions"
  | "write_actions"
  | "condition"
  | "public_principal";

export const NOTIFICATION_TYPE_OPTIONS: Array<{
  key: NotificationConfigurationTypeKey;
  label: string;
}> = [
  { key: "topic", label: "Topic configurations" },
  { key: "queue", label: "Queue configurations" },
  { key: "lambda", label: "Lambda configurations" },
  { key: "eventbridge", label: "EventBridge configuration" },
];

export const LIFECYCLE_TYPE_OPTIONS: Array<{
  key: LifecycleRuleTypeKey;
  label: string;
}> = [
  { key: "expiration", label: "Expiration (current versions)" },
  { key: "delete_markers", label: "Expired object delete markers" },
  {
    key: "noncurrent_expiration",
    label: "Expiration (noncurrent versions)",
  },
  {
    key: "abort_multipart",
    label: "Abort incomplete multipart uploads",
  },
  { key: "transition", label: "Transitions" },
  { key: "noncurrent_transition", label: "Noncurrent transitions" },
];

export const CORS_TYPE_OPTIONS: Array<{
  key: CorsRuleTypeKey;
  label: string;
}> = [
  { key: "wildcard_origins", label: "Wildcard origins (*)" },
  { key: "read_methods", label: "Read methods (GET/HEAD)" },
  { key: "write_methods", label: "Write methods (PUT/POST/DELETE)" },
  { key: "allow_credentials", label: "Allow credentials" },
  { key: "expose_headers", label: "Expose headers" },
  { key: "max_age", label: "Max age" },
];

export const POLICY_TYPE_OPTIONS: Array<{
  key: PolicyRuleTypeKey;
  label: string;
}> = [
  { key: "allow", label: "Allow statements" },
  { key: "deny", label: "Deny statements" },
  { key: "read_actions", label: "Read actions (Get/List/Head)" },
  { key: "write_actions", label: "Write actions (Put/Delete)" },
  { key: "condition", label: "Has condition" },
  { key: "public_principal", label: "Public principal (*)" },
];

export const formatLifecycleRule = (rule: Record<string, unknown>) =>
  JSON.stringify(rule, null, 2);

export const formatCorsRule = (rule: Record<string, unknown>) =>
  JSON.stringify(rule, null, 2);

export const formatPolicyRule = (rule: Record<string, unknown>) =>
  JSON.stringify(rule, null, 2);

export const formatNotificationConfiguration = (
  configuration: Record<string, unknown>,
) => {
  const normalized = normalizeNotificationConfigurationForBulk(configuration);
  if (isNotificationConfigurationEmpty(normalized)) {
    return "(no notification configurations)";
  }
  return JSON.stringify(normalized, null, 2);
};

export const getLifecycleRuleId = (rule: Record<string, unknown>) => {
  const rawId =
    rule.ID ?? (rule as { Id?: unknown }).Id ?? (rule as { id?: unknown }).id;
  if (typeof rawId === "string") {
    const trimmed = rawId.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof rawId === "number") {
    return String(rawId);
  }
  return null;
};

export const getPolicyStatementSid = (
  statement: Record<string, unknown>,
) => {
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

export const mergeLifecycleRules = (
  existingRules: Record<string, unknown>[],
  incomingRules: Record<string, unknown>[],
  options?: { onlyUpdateExisting?: boolean },
) => {
  const changes: LifecycleChange[] = [];
  const nextRules = [...existingRules];
  const serialize = (value: Record<string, unknown>) => stableStringify(value);

  incomingRules.forEach((incoming) => {
    const ruleId = getLifecycleRuleId(incoming);
    if (options?.onlyUpdateExisting) {
      if (!ruleId) return;
      const idx = nextRules.findIndex(
        (existing) => getLifecycleRuleId(existing) === ruleId,
      );
      if (idx < 0) return;
      if (serialize(nextRules[idx]) !== serialize(incoming)) {
        changes.push({
          action: "replace",
          index: idx,
          before: nextRules[idx],
          after: incoming,
        });
        nextRules[idx] = incoming;
      }
      return;
    }
    if (ruleId) {
      const idx = nextRules.findIndex(
        (existing) => getLifecycleRuleId(existing) === ruleId,
      );
      if (idx >= 0) {
        if (serialize(nextRules[idx]) !== serialize(incoming)) {
          changes.push({
            action: "replace",
            index: idx,
            before: nextRules[idx],
            after: incoming,
          });
          nextRules[idx] = incoming;
        }
        return;
      }
    }
    const existsByContent = nextRules.some(
      (existing) => serialize(existing) === serialize(incoming),
    );
    if (!existsByContent) {
      changes.push({ action: "add", index: nextRules.length, after: incoming });
      nextRules.push(incoming);
    }
  });

  return { nextRules, changes };
};

export const getLifecycleRuleTypes = (
  rule: Record<string, unknown>,
): LifecycleRuleTypeKey[] => {
  const types: LifecycleRuleTypeKey[] = [];
  const expiration = rule.Expiration as Record<string, unknown> | undefined;
  if (expiration?.Days != null) types.push("expiration");
  if (expiration?.ExpiredObjectDeleteMarker) types.push("delete_markers");
  const noncurrentExp = rule.NoncurrentVersionExpiration as
    | Record<string, unknown>
    | undefined;
  if (noncurrentExp?.NoncurrentDays != null) {
    types.push("noncurrent_expiration");
  }
  const multipart = rule.AbortIncompleteMultipartUpload as
    | Record<string, unknown>
    | undefined;
  if (multipart?.DaysAfterInitiation != null) types.push("abort_multipart");
  const transitions = Array.isArray(rule.Transitions) ? rule.Transitions : [];
  if (transitions.length > 0) types.push("transition");
  const noncurrentTransitions = Array.isArray(
    rule.NoncurrentVersionTransitions,
  )
    ? rule.NoncurrentVersionTransitions
    : [];
  if (noncurrentTransitions.length > 0) {
    types.push("noncurrent_transition");
  }
  return types;
};

export const getCorsRuleKey = (rule: Record<string, unknown>) => {
  const origins = Array.isArray(rule.AllowedOrigins)
    ? rule.AllowedOrigins
    : [];
  const methods = Array.isArray(rule.AllowedMethods)
    ? rule.AllowedMethods
    : [];
  const normalizedOrigins = origins
    .map((value) => String(value).trim())
    .filter(Boolean)
    .sort();
  const normalizedMethods = methods
    .map((value) => String(value).trim().toUpperCase())
    .filter(Boolean)
    .sort();
  if (normalizedOrigins.length === 0 && normalizedMethods.length === 0) {
    return null;
  }
  return `${normalizedOrigins.join("|")}||${normalizedMethods.join("|")}`;
};

export const getCorsRuleTypes = (
  rule: Record<string, unknown>,
): CorsRuleTypeKey[] => {
  const types: CorsRuleTypeKey[] = [];
  const origins = Array.isArray(rule.AllowedOrigins)
    ? rule.AllowedOrigins
    : [];
  const methods = Array.isArray(rule.AllowedMethods)
    ? rule.AllowedMethods
    : [];
  const normalizedMethods = methods
    .map((value) => String(value).trim().toUpperCase())
    .filter(Boolean);
  if (origins.some((origin) => String(origin).trim() === "*")) {
    types.push("wildcard_origins");
  }
  if (
    normalizedMethods.some(
      (method) => method === "GET" || method === "HEAD",
    )
  ) {
    types.push("read_methods");
  }
  if (
    normalizedMethods.some(
      (method) =>
        method === "PUT" || method === "POST" || method === "DELETE",
    )
  ) {
    types.push("write_methods");
  }
  if ((rule as { AllowCredentials?: unknown }).AllowCredentials === true) {
    types.push("allow_credentials");
  }
  const exposeHeaders = Array.isArray(rule.ExposeHeaders)
    ? rule.ExposeHeaders
    : [];
  if (exposeHeaders.length > 0) types.push("expose_headers");
  if ((rule as { MaxAgeSeconds?: unknown }).MaxAgeSeconds != null) {
    types.push("max_age");
  }
  return types;
};

const getPolicyStatementKey = (statement: Record<string, unknown>) => {
  const sid = getPolicyStatementSid(statement);
  if (sid) return `sid:${sid}`;
  const effect =
    statement.Effect ?? (statement as { effect?: unknown }).effect ?? "";
  const action =
    statement.Action ?? (statement as { action?: unknown }).action ?? "";
  const notAction =
    statement.NotAction ??
    (statement as { notAction?: unknown }).notAction ??
    "";
  const principal =
    statement.Principal ??
    (statement as { principal?: unknown }).principal ??
    "";
  const notPrincipal =
    statement.NotPrincipal ??
    (statement as { notPrincipal?: unknown }).notPrincipal ??
    "";
  const resource =
    statement.Resource ?? (statement as { resource?: unknown }).resource ?? "";
  const notResource =
    statement.NotResource ??
    (statement as { notResource?: unknown }).notResource ??
    "";
  const condition =
    statement.Condition ??
    (statement as { condition?: unknown }).condition ??
    "";
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

export const getPolicyStatementTypes = (
  statement: Record<string, unknown>,
): PolicyRuleTypeKey[] => {
  const types: PolicyRuleTypeKey[] = [];
  const effect = String(statement.Effect ?? "").toLowerCase();
  if (effect === "allow") types.push("allow");
  if (effect === "deny") types.push("deny");
  const condition =
    statement.Condition ?? (statement as { condition?: unknown }).condition;
  if (
    condition &&
    typeof condition === "object" &&
    Object.keys(condition as Record<string, unknown>).length > 0
  ) {
    types.push("condition");
  }
  const principal =
    statement.Principal ?? (statement as { principal?: unknown }).principal;
  const isPublicPrincipal = (value: unknown): boolean => {
    if (value === "*") return true;
    if (!value || typeof value !== "object") return false;
    const aws = (value as { AWS?: unknown }).AWS;
    if (aws === "*") return true;
    return Array.isArray(aws) && aws.some((item) => item === "*");
  };
  if (isPublicPrincipal(principal)) types.push("public_principal");
  const actionsRaw =
    statement.Action ?? (statement as { action?: unknown }).action ?? [];
  const notActionsRaw =
    statement.NotAction ??
    (statement as { notAction?: unknown }).notAction ??
    [];
  const actions = Array.isArray(actionsRaw) ? actionsRaw : [actionsRaw];
  const notActions = Array.isArray(notActionsRaw)
    ? notActionsRaw
    : [notActionsRaw];
  const normalizedActions = [...actions, ...notActions]
    .map((action) => String(action).trim())
    .filter(Boolean);
  const hasRead = normalizedActions.some(
    (action) =>
      action === "*" ||
      action.startsWith("s3:Get") ||
      action.startsWith("s3:List") ||
      action.startsWith("s3:Head"),
  );
  const hasWrite = normalizedActions.some(
    (action) =>
      action === "*" ||
      action.startsWith("s3:Put") ||
      action.startsWith("s3:Delete") ||
      action.startsWith("s3:Abort") ||
      action.startsWith("s3:Restore"),
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

export const mergePolicyStatements = (
  existingStatements: Record<string, unknown>[],
  incomingStatements: Record<string, unknown>[],
  options?: { onlyUpdateExisting?: boolean },
) => {
  const changes: PolicyChange[] = [];
  const nextStatements = [...existingStatements];
  const serialize = (value: Record<string, unknown>) => stableStringify(value);

  const findMatchIndex = (incoming: Record<string, unknown>) => {
    const sid = getPolicyStatementSid(incoming);
    if (sid) {
      const idx = nextStatements.findIndex(
        (existing) => getPolicyStatementSid(existing) === sid,
      );
      if (idx >= 0) return idx;
    }
    const key = getPolicyStatementKey(incoming);
    return nextStatements.findIndex(
      (existing) => getPolicyStatementKey(existing) === key,
    );
  };

  incomingStatements.forEach((incoming) => {
    const idx = findMatchIndex(incoming);
    if (options?.onlyUpdateExisting) {
      if (idx < 0) return;
      if (serialize(nextStatements[idx]) !== serialize(incoming)) {
        changes.push({
          action: "replace",
          index: idx,
          before: nextStatements[idx],
          after: incoming,
        });
        nextStatements[idx] = incoming;
      }
      return;
    }
    if (idx >= 0) {
      if (serialize(nextStatements[idx]) !== serialize(incoming)) {
        changes.push({
          action: "replace",
          index: idx,
          before: nextStatements[idx],
          after: incoming,
        });
        nextStatements[idx] = incoming;
      }
      return;
    }
    const existsByContent = nextStatements.some(
      (existing) => serialize(existing) === serialize(incoming),
    );
    if (!existsByContent) {
      changes.push({
        action: "add",
        index: nextStatements.length,
        after: incoming,
      });
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

export const mergeCorsRules = (
  existingRules: Record<string, unknown>[],
  incomingRules: Record<string, unknown>[],
  options?: { onlyUpdateExisting?: boolean },
) => {
  const changes: CorsChange[] = [];
  const nextRules = [...existingRules];
  const serialize = (value: Record<string, unknown>) => stableStringify(value);

  const findMatchIndex = (incoming: Record<string, unknown>) => {
    const ruleId = getLifecycleRuleId(incoming);
    if (ruleId) {
      const idx = nextRules.findIndex(
        (existing) => getLifecycleRuleId(existing) === ruleId,
      );
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
        changes.push({
          action: "replace",
          index: idx,
          before: nextRules[idx],
          after: incoming,
        });
        nextRules[idx] = incoming;
      }
      return;
    }
    if (idx >= 0) {
      if (serialize(nextRules[idx]) !== serialize(incoming)) {
        changes.push({
          action: "replace",
          index: idx,
          before: nextRules[idx],
          after: incoming,
        });
        nextRules[idx] = incoming;
      }
      return;
    }
    const existsByContent = nextRules.some(
      (existing) => serialize(existing) === serialize(incoming),
    );
    if (!existsByContent) {
      changes.push({ action: "add", index: nextRules.length, after: incoming });
      nextRules.push(incoming);
    }
  });

  return { nextRules, changes };
};

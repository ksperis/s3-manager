/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

type BucketFeatureRecord = Record<string, unknown>;
type RecordValue = BucketFeatureRecord;

type BucketFeatureTagSummary = {
  key?: string | null;
  value?: string | null;
};

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function displayValue(value: unknown, maxItems = 3): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const rendered = value.slice(0, maxItems).map((item) => displayValue(item, maxItems)).filter(Boolean);
    const remaining = value.length - rendered.length;
    return `${rendered.join(", ")}${remaining > 0 ? `, +${remaining}` : ""}`;
  }
  const record = asRecord(value);
  if (record) {
    const entries = Object.entries(record).slice(0, maxItems);
    const rendered = entries.map(([key, entry]) => `${key}: ${displayValue(entry, maxItems)}`).filter(Boolean);
    const remaining = Object.keys(record).length - rendered.length;
    return `${rendered.join("; ")}${remaining > 0 ? `; +${remaining}` : ""}`;
  }
  return "";
}

function joinParts(parts: Array<string | null | undefined>, fallback: string): string {
  const cleaned = parts.filter((part): part is string => Boolean(part));
  return cleaned.length > 0 ? cleaned.join(" - ") : fallback;
}

function ruleFilterSummary(rule: RecordValue): string | null {
  const topLevelPrefix = stringValue(rule.Prefix ?? rule.prefix);
  if (topLevelPrefix) return `Prefix: ${topLevelPrefix}`;

  const filter = asRecord(rule.Filter ?? rule.filter);
  if (!filter) return null;

  const prefix = stringValue(filter.Prefix ?? filter.prefix);
  if (prefix) return `Prefix: ${prefix}`;

  const tag = asRecord(filter.Tag ?? filter.tag);
  if (tag) {
    const key = stringValue(tag.Key ?? tag.key);
    const value = stringValue(tag.Value ?? tag.value);
    if (key && value) return `Tag: ${key}=${value}`;
    if (key) return `Tag: ${key}`;
  }

  const andFilter = asRecord(filter.And ?? filter.and);
  if (!andFilter) return null;

  const andPrefix = stringValue(andFilter.Prefix ?? andFilter.prefix);
  const tags = listValue(andFilter.Tags ?? andFilter.tags)
    .map(asRecord)
    .filter((entry): entry is RecordValue => Boolean(entry))
    .map((entry) => {
      const key = stringValue(entry.Key ?? entry.key);
      const value = stringValue(entry.Value ?? entry.value);
      if (key && value) return `${key}=${value}`;
      return key;
    })
    .filter((entry): entry is string => Boolean(entry));

  return joinParts(
    [andPrefix ? `Prefix: ${andPrefix}` : null, tags.length > 0 ? `Tags: ${tags.join(", ")}` : null],
    "Combined filter"
  );
}

function lifecycleActionSummary(rule: RecordValue): string | null {
  const actions: string[] = [];
  const expiration = asRecord(rule.Expiration ?? rule.expiration);
  if (expiration?.Days != null) actions.push(`expire current after ${expiration.Days}d`);
  if (expiration?.ExpiredObjectDeleteMarker === true) actions.push("delete expired markers");

  const noncurrent = asRecord(rule.NoncurrentVersionExpiration ?? rule.noncurrentVersionExpiration);
  if (noncurrent?.NoncurrentDays != null) actions.push(`expire noncurrent after ${noncurrent.NoncurrentDays}d`);

  const multipart = asRecord(rule.AbortIncompleteMultipartUpload ?? rule.abortIncompleteMultipartUpload);
  if (multipart?.DaysAfterInitiation != null) actions.push(`abort multipart after ${multipart.DaysAfterInitiation}d`);

  const transitions = listValue(rule.Transitions ?? rule.transitions);
  if (transitions.length > 0) actions.push(`${transitions.length} transition(s)`);

  const noncurrentTransitions = listValue(rule.NoncurrentVersionTransitions ?? rule.noncurrentVersionTransitions);
  if (noncurrentTransitions.length > 0) actions.push(`${noncurrentTransitions.length} noncurrent transition(s)`);

  return actions.length > 0 ? actions.join(", ") : null;
}

export function buildVersioningSummaryLines(status?: string | null): string[] {
  const normalized = (status || "Disabled").trim() || "Disabled";
  return [`Versioning: ${normalized}`];
}

export function buildObjectLockSummaryLines(
  objectLockEnabled?: boolean | null,
  objectLock?: { enabled?: boolean | null; mode?: string | null; days?: number | null; years?: number | null } | null
): string[] {
  const enabled = Boolean(objectLockEnabled ?? objectLock?.enabled);
  const lines = [`Enabled: ${enabled ? "Yes" : "No"}`];
  if (objectLock?.mode) lines.push(`Mode: ${objectLock.mode}`);
  if (objectLock?.days != null) lines.push(`Default retention: ${objectLock.days} day(s)`);
  if (objectLock?.years != null) lines.push(`Default retention: ${objectLock.years} year(s)`);
  return lines;
}

export function buildPublicAccessBlockSummaryLines(value?: RecordValue | null): string[] {
  const flags = [
    ["BlockPublicAcls", Boolean(value?.block_public_acls)],
    ["IgnorePublicAcls", Boolean(value?.ignore_public_acls)],
    ["BlockPublicPolicy", Boolean(value?.block_public_policy)],
    ["RestrictPublicBuckets", Boolean(value?.restrict_public_buckets)],
  ] as const;
  const enabledCount = flags.filter(([, enabled]) => enabled).length;
  const state = enabledCount === 4 ? "Enabled" : enabledCount === 0 ? "Disabled" : `Partial (${enabledCount}/4)`;
  return [`State: ${state}`, ...flags.map(([label, enabled]) => `${label}: ${enabled ? "Blocked" : "Unblocked"}`)];
}

export function buildLifecycleRuleSummaryLines(rules?: unknown[] | null): string[] {
  const normalized = listValue(rules).map(asRecord).filter((rule): rule is RecordValue => Boolean(rule));
  if (normalized.length === 0) return ["Rules: 0 (disabled)"];

  const lines = [`Rules: ${normalized.length}`];
  normalized.slice(0, 3).forEach((rule, index) => {
    const id =
      stringValue(rule.ID ?? rule.Id ?? rule.id) ||
      `Rule ${index + 1}`;
    const status = stringValue(rule.Status ?? rule.status) || "Enabled";
    lines.push(joinParts([`${id}: ${status}`, ruleFilterSummary(rule), lifecycleActionSummary(rule)], "Lifecycle rule"));
  });
  if (normalized.length > 3) lines.push(`+${normalized.length - 3} more rule(s)`);
  return lines;
}

function policyStatements(policy: RecordValue | null | undefined): RecordValue[] {
  if (!policy) return [];
  const raw = policy.Statement ?? policy.statement;
  if (Array.isArray(raw)) return raw.map(asRecord).filter((entry): entry is RecordValue => Boolean(entry));
  const statement = asRecord(raw);
  return statement ? [statement] : [];
}

function statementField(statement: RecordValue, field: string): unknown {
  const lowerCamel = `${field[0].toLowerCase()}${field.slice(1)}`;
  return statement[field] ?? statement[lowerCamel] ?? statement[field.toLowerCase()];
}

export function buildBucketPolicySummaryLines(policy?: RecordValue | null): string[] {
  if (!policy) return ["Policy: Not set"];
  const statements = policyStatements(policy);
  const lines = ["Policy: Configured", `Statements: ${statements.length}`];
  const version = stringValue(policy.Version ?? policy.version);
  if (version) lines.push(`Version: ${version}`);
  statements.slice(0, 2).forEach((statement, index) => {
    const sid = stringValue(statement.Sid ?? statement.sid) || `Statement ${index + 1}`;
    const effect = stringValue(statement.Effect ?? statement.effect) || "-";
    const action = statementField(statement, "Action") ?? statementField(statement, "NotAction");
    const actionLabel = statementField(statement, "Action") == null && action != null ? "NotAction" : "Action";
    const condition = asRecord(statement.Condition ?? statement.condition);
    lines.push(joinParts([`${effect} ${sid}`, action != null ? `${actionLabel}: ${displayValue(action)}` : null], "Policy statement"));
    if (condition && Object.keys(condition).length > 0) lines.push(`${sid}: has condition`);
  });
  if (statements.length > 2) lines.push(`+${statements.length - 2} more statement(s)`);
  return lines;
}

export function buildCorsRuleSummaryLines(rules?: unknown[] | null): string[] {
  const normalized = listValue(rules).map(asRecord).filter((rule): rule is RecordValue => Boolean(rule));
  if (normalized.length === 0) return ["Rules: 0 (not configured)"];
  const lines = [`Rules: ${normalized.length}`];
  normalized.slice(0, 3).forEach((rule, index) => {
    const methods = displayValue(rule.AllowedMethods ?? rule.allowedMethods ?? []);
    const origins = displayValue(rule.AllowedOrigins ?? rule.allowedOrigins ?? []);
    lines.push(joinParts([`Rule ${index + 1}`, methods ? `Methods: ${methods}` : null, origins ? `Origins: ${origins}` : null], "CORS rule"));
  });
  if (normalized.length > 3) lines.push(`+${normalized.length - 3} more rule(s)`);
  return lines;
}

function notificationFilterSummary(rule: RecordValue): string | null {
  const filter = asRecord(rule.Filter ?? rule.filter);
  const key = asRecord(filter?.Key ?? filter?.key);
  const parts = listValue(key?.FilterRules ?? key?.filterRules)
    .map(asRecord)
    .filter((entry): entry is RecordValue => Boolean(entry))
    .map((entry) => {
      const name = stringValue(entry.Name ?? entry.name);
      const value = stringValue(entry.Value ?? entry.value);
      return name && value ? `${name}: ${value}` : null;
    })
    .filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join(", ") : null;
}

function notificationDestination(type: string, rule: RecordValue): string | null {
  const fieldByType: Record<string, string> = {
    topic: "TopicArn",
    queue: "QueueArn",
    lambda: "LambdaFunctionArn",
  };
  const value = stringValue(rule[fieldByType[type]]);
  return value ? value.split(":").pop() || value : null;
}

export function buildNotificationSummaryLines(configuration?: RecordValue | null): string[] {
  const config = configuration ?? {};
  const specs = [
    ["topic", "TopicConfigurations"],
    ["queue", "QueueConfigurations"],
    ["lambda", "LambdaFunctionConfigurations"],
  ] as const;
  const entries = specs.flatMap(([type, key]) =>
    listValue(config[key]).map(asRecord).filter((entry): entry is RecordValue => Boolean(entry)).map((entry) => ({ type, entry }))
  );
  const eventBridge = asRecord(config.EventBridgeConfiguration);
  const configured = entries.length > 0 || Boolean(eventBridge);
  const lines = [`Configured: ${configured ? "Yes" : "No"}`];
  specs.forEach(([, key]) => {
    const count = listValue(config[key]).length;
    if (count > 0) lines.push(`${key.replace("Configurations", " configurations")}: ${count}`);
  });
  entries.slice(0, 3).forEach(({ type, entry }, index) => {
    const id = stringValue(entry.Id ?? entry.ID ?? entry.id) || `${type} ${index + 1}`;
    const events = displayValue(entry.Events ?? entry.events ?? []);
    const destination = notificationDestination(type, entry);
    lines.push(joinParts([`${type}: ${id}`, events ? `Events: ${events}` : null, destination ? `Destination: ${destination}` : null, notificationFilterSummary(entry)], "Notification rule"));
  });
  if (eventBridge) lines.push("EventBridge: Configured");
  if (entries.length > 3) lines.push(`+${entries.length - 3} more notification(s)`);
  return lines;
}

export function buildBucketTagSummaryLines(tags?: BucketFeatureTagSummary[] | null): string[] {
  const normalized = Array.isArray(tags)
    ? tags.filter((tag) => (tag.key ?? "").trim())
    : [];
  if (normalized.length === 0) return ["Tags: 0 (not configured)"];
  const lines = [`Tags: ${normalized.length}`];
  normalized.slice(0, 3).forEach((tag) => {
    const key = (tag.key ?? "").trim();
    const value = tag.value ?? "";
    lines.push(value ? `${key}: ${value}` : `${key}: (empty value)`);
  });
  if (normalized.length > 3) lines.push(`+${normalized.length - 3} more tag(s)`);
  return lines;
}

export function buildWebsiteSummaryLines(website?: RecordValue | null): string[] {
  const routingRules = listValue(website?.routing_rules);
  const redirect = asRecord(website?.redirect_all_requests_to);
  const redirectHost = stringValue(redirect?.host_name);
  const indexDocument = stringValue(website?.index_document);
  const errorDocument = stringValue(website?.error_document);
  const enabled = Boolean(redirectHost || indexDocument || routingRules.length > 0);
  const lines = [`Enabled: ${enabled ? "Yes" : "No"}`];
  if (indexDocument) lines.push(`Index document: ${indexDocument}`);
  if (errorDocument) lines.push(`Error document: ${errorDocument}`);
  if (redirectHost) lines.push(`Redirect host: ${redirectHost}`);
  if (routingRules.length > 0) lines.push(`Routing rules: ${routingRules.length}`);
  return lines;
}

export function buildLoggingSummaryLines(logging?: RecordValue | null): string[] {
  const targetBucket = stringValue(logging?.target_bucket);
  const targetPrefix = stringValue(logging?.target_prefix);
  const enabled = Boolean(logging?.enabled && targetBucket);
  const lines = [`Enabled: ${enabled ? "Yes" : "No"}`];
  if (targetBucket) lines.push(`Target bucket: ${targetBucket}`);
  if (targetPrefix) lines.push(`Target prefix: ${targetPrefix}`);
  return lines;
}

export function buildEncryptionSummaryLines(rules?: unknown[] | null): string[] {
  const normalized = listValue(rules).map(asRecord).filter((rule): rule is RecordValue => Boolean(rule));
  if (normalized.length === 0) return ["Enabled: No"];
  const lines = ["Enabled: Yes", `Rules: ${normalized.length}`];
  const firstRule = normalized[0];
  const defaultSse = asRecord(firstRule.ApplyServerSideEncryptionByDefault);
  const algorithm = stringValue(defaultSse?.SSEAlgorithm);
  const kmsKeyId = stringValue(defaultSse?.KMSMasterKeyID);
  if (algorithm) lines.push(`Algorithm: ${algorithm}`);
  if (kmsKeyId) lines.push(`KMS key: ${kmsKeyId}`);
  return lines;
}

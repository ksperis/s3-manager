/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

type LifecycleRuleRecord = Record<string, unknown>;

function asRecord(value: unknown): LifecycleRuleRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as LifecycleRuleRecord)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function getLifecycleRuleId(rule: LifecycleRuleRecord, index: number): string {
  return stringValue(rule.ID) ?? stringValue(rule.Id) ?? stringValue(rule.id) ?? `(no ID #${index + 1})`;
}

export function getLifecycleRuleStatus(rule: LifecycleRuleRecord): string {
  return stringValue(rule.Status) ?? stringValue(rule.status) ?? "Enabled";
}

export function formatLifecycleFilter(rule: LifecycleRuleRecord): string {
  const filter = asRecord(rule.Filter);
  const topLevelPrefix = stringValue(rule.Prefix);
  if (topLevelPrefix) return `Prefix: ${topLevelPrefix}`;
  if (!filter) return "-";

  const prefix = stringValue(filter.Prefix);
  if (prefix) return `Prefix: ${prefix}`;

  const tag = asRecord(filter.Tag);
  if (tag) {
    const key = stringValue(tag.Key);
    const value = stringValue(tag.Value);
    if (key && value) return `Tag: ${key}=${value}`;
    if (key) return `Tag: ${key}`;
  }

  const andFilter = asRecord(filter.And);
  if (andFilter) {
    const andPrefix = stringValue(andFilter.Prefix) ? `Prefix: ${andFilter.Prefix}` : "";
    const tags = Array.isArray(andFilter.Tags) ? andFilter.Tags : [];
    const andTags = tags
      .map((entry) => {
        const item = asRecord(entry);
        if (!item) return "";
        const key = stringValue(item.Key);
        const value = stringValue(item.Value);
        if (key && value) return `${key}=${value}`;
        return key ?? "";
      })
      .filter(Boolean);
    return [andPrefix, andTags.length > 0 ? `Tags: ${andTags.join(", ")}` : ""]
      .filter(Boolean)
      .join(" · ") || "Combined filter";
  }

  return "-";
}

export function describeLifecycleActions(rule: LifecycleRuleRecord): string {
  const actions: string[] = [];
  const expiration = asRecord(rule.Expiration);
  if (expiration?.Days != null) {
    actions.push(`Expire current objects after ${expiration.Days}d`);
  }
  if (expiration?.ExpiredObjectDeleteMarker) {
    actions.push("Delete expired delete markers");
  }

  const noncurrentExp = asRecord(rule.NoncurrentVersionExpiration);
  if (noncurrentExp?.NoncurrentDays != null) {
    actions.push(`Expire noncurrent versions after ${noncurrentExp.NoncurrentDays}d`);
  }

  const multipart = asRecord(rule.AbortIncompleteMultipartUpload);
  if (multipart?.DaysAfterInitiation != null) {
    actions.push(`Abort incomplete multipart uploads after ${multipart.DaysAfterInitiation}d`);
  }

  const transitions = Array.isArray(rule.Transitions) ? rule.Transitions : [];
  if (transitions.length > 0) {
    actions.push(`Transitions (${transitions.length})`);
  }

  const noncurrentTransitions = Array.isArray(rule.NoncurrentVersionTransitions)
    ? rule.NoncurrentVersionTransitions
    : [];
  if (noncurrentTransitions.length > 0) {
    actions.push(`Noncurrent transitions (${noncurrentTransitions.length})`);
  }

  if (actions.length === 0) return "No actions detected";
  return actions.join(" · ");
}

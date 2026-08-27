/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

type LifecycleRuleStatus = "Enabled" | "Disabled";
type LifecycleTagFilter = { Key?: unknown; Value?: unknown };
type LifecycleAndFilter = { Prefix?: unknown; Tags?: unknown };
type LifecycleFilter = {
  Prefix?: unknown;
  Tag?: LifecycleTagFilter;
  And?: LifecycleAndFilter;
};

export type LifecycleRuleRecord = Record<string, unknown> & {
  ID?: unknown;
  Prefix?: unknown;
  Status?: unknown;
  Filter?: LifecycleFilter;
};

export function lifecycleRuleId(rule: LifecycleRuleRecord): string | null {
  return typeof rule.ID === "string" && rule.ID.trim() ? rule.ID.trim() : null;
}

export function lifecycleRulePrefix(rule: LifecycleRuleRecord): string | null {
  return typeof rule.Prefix === "string" && rule.Prefix.trim()
    ? rule.Prefix.trim()
    : null;
}

export function lifecycleRuleStatus(
  rule: LifecycleRuleRecord,
): LifecycleRuleStatus {
  return rule.Status === "Disabled" ? "Disabled" : "Enabled";
}

function lifecycleTagLabel(tag: LifecycleTagFilter): string | null {
  if (typeof tag.Key !== "string" || !tag.Key.trim()) return null;
  return `${tag.Key.trim()}=${typeof tag.Value === "string" ? tag.Value.trim() : ""}`;
}

export function lifecycleFilterLabel(
  filter: LifecycleFilter | undefined,
): string {
  if (!filter) return "-";
  if (typeof filter.Prefix === "string" && filter.Prefix.trim()) {
    return `Prefix: ${filter.Prefix.trim()}`;
  }
  if (filter.Tag) {
    const tag = lifecycleTagLabel(filter.Tag);
    if (tag) return `Tag: ${tag}`;
  }
  if (filter.And) {
    const prefix =
      typeof filter.And.Prefix === "string" && filter.And.Prefix.trim()
        ? `Prefix: ${filter.And.Prefix.trim()}`
        : "";
    const tags = Array.isArray(filter.And.Tags)
      ? filter.And.Tags
          .filter(
            (tag): tag is LifecycleTagFilter =>
              Boolean(tag) && typeof tag === "object",
          )
          .map(lifecycleTagLabel)
          .filter((tag): tag is string => Boolean(tag))
      : [];
    const tagSummary = tags.length > 0 ? `Tags: ${tags.join(", ")}` : "";
    return [prefix, tagSummary].filter(Boolean).join(" · ") || "Combined filter";
  }
  return "-";
}

export function describeLifecycleActions(rule: LifecycleRuleRecord): string {
  const actions: string[] = [];
  const expiration = rule.Expiration as Record<string, unknown> | undefined;
  if (expiration?.Days != null) {
    actions.push(`Expire current objects after ${expiration.Days}d`);
  }
  if (expiration?.ExpiredObjectDeleteMarker) {
    actions.push("Delete expired delete markers");
  }
  const noncurrentExpiration = rule.NoncurrentVersionExpiration as
    | Record<string, unknown>
    | undefined;
  if (noncurrentExpiration?.NoncurrentDays != null) {
    actions.push(
      `Expire noncurrent versions after ${noncurrentExpiration.NoncurrentDays}d`,
    );
  }
  const multipart = rule.AbortIncompleteMultipartUpload as
    | Record<string, unknown>
    | undefined;
  if (multipart?.DaysAfterInitiation != null) {
    actions.push(
      `Abort incomplete multipart uploads after ${multipart.DaysAfterInitiation}d`,
    );
  }
  const transitions = Array.isArray(rule.Transitions) ? rule.Transitions : [];
  if (transitions.length > 0) {
    actions.push(`Transitions (${transitions.length})`);
  }
  const noncurrentTransitions = Array.isArray(
    rule.NoncurrentVersionTransitions,
  )
    ? rule.NoncurrentVersionTransitions
    : [];
  if (noncurrentTransitions.length > 0) {
    actions.push(`Noncurrent transitions (${noncurrentTransitions.length})`);
  }
  return actions.length > 0 ? actions.join(" · ") : "No actions detected";
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shouldSortArray(entries: unknown[]): boolean {
  if (entries.length < 2) return false;
  if (entries.every((entry) => entry === null || ["boolean", "number", "string"].includes(typeof entry))) {
    return true;
  }
  return entries.every(
    (entry) =>
      isPlainObject(entry) &&
      ("id" in entry || "key" in entry || "name" in entry || "arn" in entry)
  );
}

export function normalizeForStableSignature(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeForStableSignature(entry));
    if (shouldSortArray(normalized)) {
      return [...normalized].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return normalized;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, normalizeForStableSignature(entry)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

export function stableSignature(value: unknown): string {
  return JSON.stringify(normalizeForStableSignature(value));
}

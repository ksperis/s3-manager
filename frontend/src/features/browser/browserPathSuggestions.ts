/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { CLIENT_STORAGE_KEYS, readClientJson, writeClientJson } from "../../utils/clientStorage";
import { normalizePrefix, shortName } from "./browserUtils";

export type PathSuggestionSource = "local" | "remote" | "history";

export type PathSuggestion = {
  value: string;
  label: string;
  source: PathSuggestionSource;
};

export type PathDraftContext = {
  parentPrefix: string;
  fragment: string;
};

const PATH_SUGGESTIONS_LIMIT = 20;
const PATH_HISTORY_LIMIT = 20;
const PATH_HISTORY_STORAGE_KEY = CLIENT_STORAGE_KEYS.browserPathHistory;

const PATH_SUGGESTION_SOURCE_WEIGHT: Record<PathSuggestionSource, number> = {
  history: 300,
  local: 200,
  remote: 100,
};

export const normalizePathDraftValue = (value: string) =>
  value.trim().replace(/^\/+/, "");

export const resolvePathDraftContext = (value: string): PathDraftContext => {
  const cleaned = normalizePathDraftValue(value);
  const hasTrailingSlash = cleaned.endsWith("/");
  const slashIndex = cleaned.lastIndexOf("/");
  const parentRaw = slashIndex >= 0 ? cleaned.slice(0, slashIndex + 1) : "";
  const fragment = hasTrailingSlash
    ? ""
    : slashIndex >= 0
      ? cleaned.slice(slashIndex + 1)
      : cleaned;
  return {
    parentPrefix: parentRaw ? normalizePrefix(parentRaw) : "",
    fragment,
  };
};

export const buildPathSuggestionEntries = (
  prefixes: string[],
  parentPrefix: string,
  fragment: string,
  source: PathSuggestionSource,
): PathSuggestion[] => {
  const normalizedFragment = fragment.trim().toLowerCase();
  const seen = new Set<string>();
  const entries: PathSuggestion[] = [];
  prefixes.forEach((entry) => {
    const normalized = normalizePrefix(normalizePathDraftValue(entry || ""));
    if (!normalized) return;
    if (parentPrefix && !normalized.startsWith(parentPrefix)) return;
    const relative = shortName(normalized, parentPrefix || "");
    const label = relative.endsWith("/") ? relative.slice(0, -1) : relative;
    if (!label) return;
    if (normalizedFragment && !label.toLowerCase().includes(normalizedFragment))
      return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    entries.push({ value: normalized, label, source });
  });
  return entries;
};

export const scorePathSuggestion = (
  entry: PathSuggestion,
  fragment: string,
): number => {
  const query = fragment.trim().toLowerCase();
  const label = entry.label.toLowerCase();
  let score = PATH_SUGGESTION_SOURCE_WEIGHT[entry.source] ?? 0;
  if (!query) {
    return score + Math.max(0, 80 - Math.min(label.length, 80));
  }
  if (label === query) {
    score += 1200;
  } else if (label.startsWith(query)) {
    score += 1000;
  } else if (label.split("/").some((segment) => segment.startsWith(query))) {
    score += 800;
  } else if (label.includes(query)) {
    score += 600;
  }
  const index = label.indexOf(query);
  if (index >= 0) {
    score += Math.max(0, 120 - index * 4);
  }
  score += Math.max(0, 60 - Math.min(label.length, 60));
  return score;
};

export const mergePathSuggestions = (
  fragment: string,
  ...groups: PathSuggestion[][]
): PathSuggestion[] => {
  const byValue = new Map<string, PathSuggestion>();
  groups.forEach((group) => {
    group.forEach((entry) => {
      const existing = byValue.get(entry.value);
      if (!existing) {
        byValue.set(entry.value, entry);
        return;
      }
      if (
        (PATH_SUGGESTION_SOURCE_WEIGHT[entry.source] ?? 0) >
        (PATH_SUGGESTION_SOURCE_WEIGHT[existing.source] ?? 0)
      ) {
        byValue.set(entry.value, entry);
      }
    });
  });
  return Array.from(byValue.values())
    .sort((a, b) => {
      const scoreDiff =
        scorePathSuggestion(b, fragment) - scorePathSuggestion(a, fragment);
      if (scoreDiff !== 0) return scoreDiff;
      return a.label.localeCompare(b.label);
    })
    .slice(0, PATH_SUGGESTIONS_LIMIT);
};

const readPathHistoryStore = (): Record<string, string[]> => {
  if (typeof window === "undefined") return {};
  const parsed = readClientJson<unknown>(PATH_HISTORY_STORAGE_KEY);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, string[]>;
};

export const readBucketPathHistory = (bucketName: string): string[] => {
  if (!bucketName) return [];
  const store = readPathHistoryStore();
  const rawEntries = Array.isArray(store[bucketName]) ? store[bucketName] : [];
  const seen = new Set<string>();
  const entries: string[] = [];
  rawEntries.forEach((value) => {
    const normalized = normalizePrefix(normalizePathDraftValue(value || ""));
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    entries.push(normalized);
  });
  return entries.slice(0, PATH_HISTORY_LIMIT);
};

export const pushBucketPathHistory = (
  bucketName: string,
  prefixValue: string,
): string[] => {
  if (!bucketName || typeof window === "undefined") return [];
  const normalized = normalizePrefix(
    normalizePathDraftValue(prefixValue || ""),
  );
  if (!normalized) return readBucketPathHistory(bucketName);
  const store = readPathHistoryStore();
  const current = readBucketPathHistory(bucketName);
  const next = [
    normalized,
    ...current.filter((entry) => entry !== normalized),
  ].slice(0, PATH_HISTORY_LIMIT);
  store[bucketName] = next;
  writeClientJson(PATH_HISTORY_STORAGE_KEY, store);
  return next;
};

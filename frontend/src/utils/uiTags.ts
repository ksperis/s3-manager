/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { TagColorKey, TagDefinitionInput, TagDefinitionSummary } from "../api/tags";

export type UiTagDefinition = TagDefinitionInput & {
  id?: number | null;
};

export type UiTagLike =
  | string
  | UiTagDefinition
  | TagDefinitionSummary
  | null
  | undefined;

export type UiTagItem = {
  key: string;
  label: string;
  color_key: TagColorKey;
  title?: string;
};

const DEFAULT_TAG_COLOR_KEY: TagColorKey = "neutral";

export function normalizeUiTags(values?: Array<UiTagLike> | null): UiTagDefinition[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: UiTagDefinition[] = [];
  values.forEach((entry) => {
    if (typeof entry === "string") {
      const cleaned = entry.trim();
      const key = cleaned.toLocaleLowerCase();
      if (!cleaned || seen.has(key)) return;
      seen.add(key);
      normalized.push({ label: cleaned, color_key: DEFAULT_TAG_COLOR_KEY });
      return;
    }
    if (!entry || typeof entry.label !== "string") return;
    const cleaned = entry.label.trim();
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    normalized.push({
      id: typeof entry.id === "number" ? entry.id : undefined,
      label: cleaned,
      color_key: (entry.color_key ?? DEFAULT_TAG_COLOR_KEY) as TagColorKey,
    });
  });
  return normalized;
}

export function extractUiTagLabels(values?: Array<UiTagLike> | null): string[] {
  return normalizeUiTags(values).map((entry) => entry.label);
}

export function buildUiTagItems(
  entityTags?: Array<UiTagLike> | null,
  endpointTags?: Array<UiTagLike> | null
): UiTagItem[] {
  const items: UiTagItem[] = [];
  normalizeUiTags(entityTags).forEach((entry, index) => {
    items.push({
      key: `entity-${entry.id ?? entry.label}-${index}`,
      label: entry.label,
      color_key: entry.color_key,
      title: `Tag: ${entry.label}`,
    });
  });
  normalizeUiTags(endpointTags).forEach((entry, index) => {
    items.push({
      key: `endpoint-${entry.id ?? entry.label}-${index}`,
      label: entry.label,
      color_key: entry.color_key,
      title: `Endpoint tag: ${entry.label}`,
    });
  });
  return items;
}

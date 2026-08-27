/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ExecutionContext } from "../../api/executionContexts";
import {
  buildUiTagItems,
  extractUiTagLabels,
  filterSelectorVisibleUiTags,
  type UiTagItem,
} from "../../utils/uiTags";
import {
  formatStorageOpsContextKindLabel,
  normalizeAdvancedSelectionValues,
  toStorageOpsContextKind,
} from "./bucketOpsAdvancedFilterModel";

type BucketOpsStorageContextItem = {
  id: string;
  name: string;
  kind: ReturnType<typeof toStorageOpsContextKind>;
  typeLabel: string;
  endpointName: string | null;
  tagItems: UiTagItem[];
  haystack: string;
};

type BucketOpsStorageEndpointItem = {
  name: string;
  contextNames: string[];
  tagItems: UiTagItem[];
  haystack: string;
};

type BuildBucketOpsStorageScopeProjectionOptions = {
  contexts: ExecutionContext[];
  contextFilter: string;
  endpointFilter: string;
  selectedContextIds?: string[] | null;
  selectedEndpointNames?: string[] | null;
};

function buildSearchHaystack(values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ").toLowerCase();
}

function buildContextItem(context: ExecutionContext): BucketOpsStorageContextItem {
  const kind = toStorageOpsContextKind(context.kind);
  const typeLabel = formatStorageOpsContextKindLabel(kind);
  const entityTags = filterSelectorVisibleUiTags(context.tags);
  const endpointTags = filterSelectorVisibleUiTags(context.endpoint_tags);

  return {
    id: context.id,
    name: context.display_name,
    kind,
    typeLabel,
    endpointName: context.endpoint_name ?? null,
    tagItems: buildUiTagItems(entityTags, endpointTags),
    haystack: buildSearchHaystack([
      context.id,
      context.display_name,
      context.endpoint_name,
      typeLabel,
      context.kind,
      kind,
      ...extractUiTagLabels(entityTags),
      ...extractUiTagLabels(endpointTags),
    ]),
  };
}

function buildEndpointItems(contexts: ExecutionContext[]): BucketOpsStorageEndpointItem[] {
  const byName = new Map<string, BucketOpsStorageEndpointItem>();

  contexts.forEach((context) => {
    const endpointName = (context.endpoint_name ?? "").trim();
    if (!endpointName) return;

    const entityTags = filterSelectorVisibleUiTags(context.tags);
    const endpointTags = filterSelectorVisibleUiTags(context.endpoint_tags);
    const tagItems = buildUiTagItems(entityTags, endpointTags);
    const searchValues = [
      context.display_name,
      formatStorageOpsContextKindLabel(context.kind),
      context.kind,
      ...extractUiTagLabels(entityTags),
      ...extractUiTagLabels(endpointTags),
    ];
    const existing = byName.get(endpointName);

    if (existing) {
      if (!existing.contextNames.includes(context.display_name)) {
        existing.contextNames.push(context.display_name);
      }
      const knownTagKeys = new Set(existing.tagItems.map((tag) => tag.key));
      tagItems.forEach((tag) => {
        if (knownTagKeys.has(tag.key)) return;
        existing.tagItems.push(tag);
        knownTagKeys.add(tag.key);
      });
      existing.haystack = buildSearchHaystack([existing.haystack, ...searchValues]);
      return;
    }

    byName.set(endpointName, {
      name: endpointName,
      contextNames: [context.display_name],
      tagItems,
      haystack: buildSearchHaystack([endpointName, ...searchValues]),
    });
  });

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

function filterBySearch<T extends { haystack: string }>(items: T[], filter: string): T[] {
  const query = filter.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => item.haystack.includes(query));
}

export function buildBucketOpsStorageScopeProjection({
  contexts,
  contextFilter,
  endpointFilter,
  selectedContextIds,
  selectedEndpointNames,
}: BuildBucketOpsStorageScopeProjectionOptions) {
  const contextItems = contexts
    .filter(
      (context) =>
        context.kind === "account" ||
        context.kind === "connection" ||
        context.kind === "s3_user"
    )
    .map(buildContextItem)
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (byName !== 0) return byName;
      return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
    });
  const contextLabelById = new Map(
    contextItems.map((context) => [context.id, context.name])
  );
  const filteredContextItems = filterBySearch(contextItems, contextFilter);
  const contextSelectionSet = new Set(normalizeAdvancedSelectionValues(selectedContextIds));
  const endpointItems = buildEndpointItems(contexts);
  const filteredEndpointItems = filterBySearch(endpointItems, endpointFilter);
  const endpointSelectionSet = new Set(normalizeAdvancedSelectionValues(selectedEndpointNames));

  return {
    contextItems,
    contextLabelById,
    filteredContextItems,
    contextSelectionSet,
    allFilteredContextsSelected:
      filteredContextItems.length > 0 &&
      filteredContextItems.every((context) => contextSelectionSet.has(context.id)),
    hasFilteredContextSelection: filteredContextItems.some((context) =>
      contextSelectionSet.has(context.id)
    ),
    endpointItems,
    filteredEndpointItems,
    endpointSelectionSet,
    allFilteredEndpointsSelected:
      filteredEndpointItems.length > 0 &&
      filteredEndpointItems.every((endpoint) => endpointSelectionSet.has(endpoint.name)),
    hasFilteredEndpointSelection: filteredEndpointItems.some((endpoint) =>
      endpointSelectionSet.has(endpoint.name)
    ),
  };
}

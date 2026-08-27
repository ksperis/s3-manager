/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  BucketUiTagDefinition,
  BucketUiTagVisibility,
} from "../../api/bucketUiTags";

export type BucketUiTagDraft = {
  draftId: string;
  label: string;
  color_key: string;
  scope: "standard";
  visibility: BucketUiTagVisibility;
};

export function createBucketUiTagDrafts(
  labels: readonly string[],
  sequence: number,
): BucketUiTagDraft[] {
  return labels.map((label, index) => ({
    draftId: `ui-tag-draft:${sequence}:${index}`,
    label,
    color_key: "neutral",
    scope: "standard",
    visibility: "private",
  }));
}

type BucketOpsRowTagProjectionInput = {
  assignedTags: readonly BucketUiTagDefinition[];
  availableTags: readonly BucketUiTagDefinition[];
  creationDrafts: readonly BucketUiTagDraft[];
  draft: string;
  suggestionsOpen: boolean;
};

export function buildBucketOpsRowTagProjection({
  assignedTags,
  availableTags,
  creationDrafts,
  draft,
  suggestionsOpen,
}: BucketOpsRowTagProjectionInput) {
  const definitionById = new Map(availableTags.map((tag) => [tag.id, tag]));
  const tags = assignedTags.map((tag) => definitionById.get(tag.id) ?? tag);
  const assignedIds = new Set(tags.map((tag) => tag.id));
  const normalizedDraft = draft.trim().toLowerCase();
  const suggestions = availableTags.filter(
    (tag) =>
      !assignedIds.has(tag.id) &&
      (!normalizedDraft || tag.label.toLowerCase().includes(normalizedDraft)),
  );

  return {
    creationDrafts,
    draft,
    showSuggestions: suggestionsOpen && suggestions.length > 0,
    suggestions,
    tags,
  };
}

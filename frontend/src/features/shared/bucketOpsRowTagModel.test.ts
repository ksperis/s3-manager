/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import {
  buildBucketOpsRowTagProjection,
  createBucketUiTagDrafts,
  type BucketUiTagDraft,
} from "./bucketOpsRowTagModel";

const tag = (id: number, label: string, colorKey = "neutral"): BucketUiTagDefinition => ({
  id,
  label,
  color_key: colorKey,
  scope: "standard",
  visibility: "private",
});

const draft: BucketUiTagDraft = {
  draftId: "draft-1",
  label: "Pending",
  color_key: "neutral",
  scope: "standard",
  visibility: "private",
};

describe("buildBucketOpsRowTagProjection", () => {
  it("creates deterministic configurable drafts", () => {
    expect(createBucketUiTagDrafts(["Alpha", "Beta"], 4)).toEqual([
      {
        draftId: "ui-tag-draft:4:0",
        label: "Alpha",
        color_key: "neutral",
        scope: "standard",
        visibility: "private",
      },
      {
        draftId: "ui-tag-draft:4:1",
        label: "Beta",
        color_key: "neutral",
        scope: "standard",
        visibility: "private",
      },
    ]);
  });

  it("uses current catalogue definitions and excludes assigned tags from suggestions", () => {
    const currentAlpha = tag(1, "Alpha", "blue");
    const result = buildBucketOpsRowTagProjection({
      assignedTags: [tag(1, "Old alpha", "red")],
      availableTags: [currentAlpha, tag(2, "Beta"), tag(3, "Gamma")],
      creationDrafts: [draft],
      draft: "a",
      suggestionsOpen: true,
    });

    expect(result.tags).toEqual([currentAlpha]);
    expect(result.creationDrafts).toEqual([draft]);
    expect(result.suggestions.map((item) => item.label)).toEqual(["Beta", "Gamma"]);
    expect(result.showSuggestions).toBe(true);
  });

  it("hides an open suggestions menu when nothing matches", () => {
    const result = buildBucketOpsRowTagProjection({
      assignedTags: [],
      availableTags: [tag(1, "Alpha")],
      creationDrafts: [],
      draft: "missing",
      suggestionsOpen: true,
    });

    expect(result.suggestions).toEqual([]);
    expect(result.showSuggestions).toBe(false);
  });
});

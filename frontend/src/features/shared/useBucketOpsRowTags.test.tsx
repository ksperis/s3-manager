/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import type { BucketUiTagTarget } from "./bucketUiTags";
import { useBucketOpsRowTags } from "./useBucketOpsRowTags";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const tag = (id: number, label: string): BucketUiTagDefinition => ({
  id,
  label,
  color_key: "neutral",
  scope: "standard",
  visibility: "private",
});

const target: BucketUiTagTarget = {
  key: "ceph-admin:7:reports",
  endpointId: 7,
  identity: "reports",
  name: "reports",
  tenant: null,
  contextId: null,
};

function createOptions() {
  return {
    availableUiTags: [tag(1, "Existing"), tag(2, "Suggested")],
    extractError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    persistUiTagChanges: vi.fn(async () => undefined),
    persistUiTagDefinition: vi.fn(async () => undefined),
    refreshBuckets: vi.fn(),
    scopeKey: "ceph-admin:7",
    setError: vi.fn(),
  };
}

describe("useBucketOpsRowTags", () => {
  it("stages, edits, and removes deterministic local drafts", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBucketOpsRowTags(options));

    act(() => {
      result.current.updateTagDraft(target.key, "Alpha, Beta");
      result.current.setTagSuggestionBucket(target.key);
      result.current.stageTagsForBucket(target, "Alpha, Beta");
    });
    let projection = result.current.getRowTagProjection(target, []);
    expect(projection.draft).toBe("");
    expect(projection.showSuggestions).toBe(false);
    expect(projection.creationDrafts).toEqual([
      expect.objectContaining({ draftId: "ui-tag-draft:1:0", label: "Alpha" }),
      expect.objectContaining({ draftId: "ui-tag-draft:1:1", label: "Beta" }),
    ]);

    act(() => {
      result.current.updateTagCreationDraft(
        target.key,
        "ui-tag-draft:1:0",
        { color_key: "blue" },
      );
      result.current.removeTagCreationDraft(target.key, "ui-tag-draft:1:1");
    });
    projection = result.current.getRowTagProjection(target, []);
    expect(projection.creationDrafts).toEqual([
      expect.objectContaining({ draftId: "ui-tag-draft:1:0", color_key: "blue" }),
    ]);
  });

  it("commits a draft, removes it locally, and refreshes the listing", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBucketOpsRowTags(options));
    act(() => result.current.stageTagsForBucket(target, "New tag"));
    const staged = result.current.getRowTagProjection(target, []).creationDrafts[0];

    await act(async () => result.current.addTagDraftForBucket(target, staged));

    expect(options.persistUiTagChanges).toHaveBeenCalledWith([target], [staged], []);
    expect(options.refreshBuckets).toHaveBeenCalledOnce();
    expect(result.current.getRowTagProjection(target, []).creationDrafts).toEqual([]);
  });

  it("surfaces current-scope mutation errors and refreshes authoritative data", async () => {
    const options = createOptions();
    options.persistUiTagDefinition.mockRejectedValueOnce(new Error("Update failed"));
    const { result } = renderHook(() => useBucketOpsRowTags(options));

    await act(async () =>
      result.current.updateBucketUiTagDefinition(tag(1, "Existing"), { color_key: "red" }),
    );

    expect(options.setError).toHaveBeenCalledWith("Update failed");
    expect(options.refreshBuckets).toHaveBeenCalledOnce();
  });

  it("ignores a mutation completion after the editing scope changes", async () => {
    const options = createOptions();
    const deferred = createDeferred<void>();
    options.persistUiTagChanges.mockReturnValueOnce(deferred.promise);
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useBucketOpsRowTags({ ...options, scopeKey }),
      { initialProps: { scopeKey: "ceph-admin:7" } },
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.addExistingTagForBucket(target, tag(2, "Suggested"));
    });
    rerender({ scopeKey: "ceph-admin:8" });
    await act(async () => {
      deferred.resolve();
      await pending;
    });

    expect(options.refreshBuckets).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
  });
});

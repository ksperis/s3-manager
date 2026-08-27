/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BucketUiTagDefinition,
  BucketUiTagDefinitionPatch,
} from "../../api/bucketUiTags";
import { parseUiTags } from "./bucketOpsListState";
import {
  buildBucketOpsRowTagProjection,
  createBucketUiTagDrafts,
  type BucketUiTagDraft,
} from "./bucketOpsRowTagModel";
import type { BucketUiTagTarget } from "./bucketUiTags";

type BucketUiTagMutationItem = BucketUiTagDefinition | BucketUiTagDraft;

type UseBucketOpsRowTagsInput = {
  availableUiTags: readonly BucketUiTagDefinition[];
  extractError: (error: unknown) => string;
  persistUiTagChanges: (
    targets: BucketUiTagTarget[],
    add: BucketUiTagMutationItem[],
    remove: BucketUiTagDefinition[],
  ) => Promise<unknown>;
  persistUiTagDefinition: (
    tagId: number,
    changes: BucketUiTagDefinitionPatch,
  ) => Promise<unknown>;
  refreshBuckets: () => void;
  scopeKey: string;
  setError: (message: string) => void;
};

export function useBucketOpsRowTags({
  availableUiTags,
  extractError,
  persistUiTagChanges,
  persistUiTagDefinition,
  refreshBuckets,
  scopeKey,
  setError,
}: UseBucketOpsRowTagsInput) {
  const [tagSuggestionBucket, setTagSuggestionBucket] = useState<string | null>(null);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [tagCreationDrafts, setTagCreationDrafts] = useState<
    Record<string, BucketUiTagDraft[]>
  >({});
  const draftSequenceRef = useRef(0);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    setTagSuggestionBucket(null);
    setTagDrafts({});
    setTagCreationDrafts({});
    return () => {
      generationRef.current += 1;
    };
  }, [scopeKey]);

  const updateTagDraft = useCallback((bucketKey: string, value: string) => {
    setTagDrafts((previous) => ({ ...previous, [bucketKey]: value }));
  }, []);

  const stageTagsForBucket = useCallback(
    (target: BucketUiTagTarget, raw: string) => {
      const labels = parseUiTags(raw);
      if (labels.length === 0) return;
      draftSequenceRef.current += 1;
      const sequence = draftSequenceRef.current;
      const nextDrafts = createBucketUiTagDrafts(labels, sequence);
      setTagCreationDrafts((current) => ({
        ...current,
        [target.key]: [...(current[target.key] ?? []), ...nextDrafts],
      }));
      updateTagDraft(target.key, "");
      setTagSuggestionBucket(null);
    },
    [updateTagDraft],
  );

  const updateTagCreationDraft = useCallback(
    (targetKey: string, draftId: string, changes: BucketUiTagDefinitionPatch) => {
      setTagCreationDrafts((current) => ({
        ...current,
        [targetKey]: (current[targetKey] ?? []).map((draft) =>
          draft.draftId === draftId ? { ...draft, ...changes } : draft,
        ),
      }));
    },
    [],
  );

  const removeTagCreationDraft = useCallback((targetKey: string, draftId: string) => {
    setTagCreationDrafts((current) => ({
      ...current,
      [targetKey]: (current[targetKey] ?? []).filter(
        (draft) => draft.draftId !== draftId,
      ),
    }));
  }, []);

  const runMutation = useCallback(
    async (mutation: () => Promise<unknown>) => {
      const generation = generationRef.current;
      try {
        await mutation();
        if (generation !== generationRef.current) return false;
        refreshBuckets();
        return true;
      } catch (error) {
        if (generation !== generationRef.current) return false;
        setError(extractError(error));
        refreshBuckets();
        return false;
      }
    },
    [extractError, refreshBuckets, setError],
  );

  const addTagDraftForBucket = useCallback(
    async (target: BucketUiTagTarget, draft: BucketUiTagDraft) => {
      const committed = await runMutation(() =>
        persistUiTagChanges([target], [draft], []),
      );
      if (committed) removeTagCreationDraft(target.key, draft.draftId);
    },
    [persistUiTagChanges, removeTagCreationDraft, runMutation],
  );

  const updateBucketUiTagDefinition = useCallback(
    async (tag: BucketUiTagDefinition, changes: BucketUiTagDefinitionPatch) => {
      await runMutation(() => persistUiTagDefinition(tag.id, changes));
    },
    [persistUiTagDefinition, runMutation],
  );

  const addExistingTagForBucket = useCallback(
    async (target: BucketUiTagTarget, tag: BucketUiTagDefinition) => {
      await runMutation(() => persistUiTagChanges([target], [tag], []));
    },
    [persistUiTagChanges, runMutation],
  );

  const removeTagForBucket = useCallback(
    async (target: BucketUiTagTarget, tag: BucketUiTagDefinition) => {
      await runMutation(() => persistUiTagChanges([target], [], [tag]));
    },
    [persistUiTagChanges, runMutation],
  );

  const getRowTagProjection = useCallback(
    (target: BucketUiTagTarget, assignedTags: readonly BucketUiTagDefinition[]) =>
      buildBucketOpsRowTagProjection({
        assignedTags,
        availableTags: availableUiTags,
        creationDrafts: tagCreationDrafts[target.key] ?? [],
        draft: tagDrafts[target.key] ?? "",
        suggestionsOpen: tagSuggestionBucket === target.key,
      }),
    [availableUiTags, tagCreationDrafts, tagDrafts, tagSuggestionBucket],
  );

  return {
    addExistingTagForBucket,
    addTagDraftForBucket,
    getRowTagProjection,
    removeTagCreationDraft,
    removeTagForBucket,
    setTagSuggestionBucket,
    stageTagsForBucket,
    updateBucketUiTagDefinition,
    updateTagCreationDraft,
    updateTagDraft,
  };
}

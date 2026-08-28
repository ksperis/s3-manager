/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import { UiTagBadge } from "../../components/UiTagSettings";
import type { BucketUiTagTarget } from "./bucketUiTags";
import BucketUiTagSettingsBadge from "./BucketUiTagSettingsBadge";
import type { useBucketOpsRowTags } from "./useBucketOpsRowTags";

type RowTagsController = ReturnType<typeof useBucketOpsRowTags>;

export type BucketOpsUiTagsCellController = Pick<
  RowTagsController,
  | "addExistingTagForBucket"
  | "addTagDraftForBucket"
  | "getRowTagProjection"
  | "removeTagCreationDraft"
  | "removeTagForBucket"
  | "setTagSuggestionBucket"
  | "stageTagsForBucket"
  | "updateBucketUiTagDefinition"
  | "updateTagCreationDraft"
  | "updateTagDraft"
>;

type BucketOpsUiTagsCellProps = {
  assignedTags: readonly BucketUiTagDefinition[];
  controller: BucketOpsUiTagsCellController;
  isStorageOps: boolean;
  target: BucketUiTagTarget | null;
  updatingDefinitionIds: ReadonlySet<number>;
};

export default function BucketOpsUiTagsCell({
  assignedTags,
  controller,
  isStorageOps,
  target,
  updatingDefinitionIds,
}: BucketOpsUiTagsCellProps) {
  if (!target) {
    return (
      <span
        className="ui-caption text-slate-500 dark:text-slate-400"
        title="UI tags require a configured storage endpoint."
      >
        Endpoint required
      </span>
    );
  }

  const {
    creationDrafts,
    draft,
    showSuggestions,
    suggestions,
    tags,
  } = controller.getRowTagProjection(target, assignedTags);
  return (
    <div className="group relative flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <BucketUiTagSettingsBadge
          key={`${target.key}:${tag.id}`}
          tag={tag}
          isStorageOps={isStorageOps}
          disabled={updatingDefinitionIds.has(tag.id)}
          onChange={(changes) =>
            controller.updateBucketUiTagDefinition(tag, changes)
          }
          onRemove={() => void controller.removeTagForBucket(target, tag)}
        />
      ))}
      {creationDrafts.map((creationDraft, index) => (
        <BucketUiTagSettingsBadge
          key={creationDraft.draftId}
          tag={creationDraft}
          isStorageOps={isStorageOps}
          initiallyOpen={index === creationDrafts.length - 1}
          onChange={(changes) =>
            controller.updateTagCreationDraft(
              target.key,
              creationDraft.draftId,
              changes,
            )
          }
          onRemove={() =>
            controller.removeTagCreationDraft(
              target.key,
              creationDraft.draftId,
            )
          }
          onCommit={() =>
            controller.addTagDraftForBucket(target, creationDraft)
          }
        />
      ))}
      <div className="flex w-28 shrink-0 items-center gap-1">
        <input
          type="text"
          aria-label={`Add UI tags to ${target.name}`}
          value={draft}
          onChange={(event) =>
            controller.updateTagDraft(target.key, event.target.value)
          }
          onFocus={() => controller.setTagSuggestionBucket(target.key)}
          onBlur={() => {
            window.setTimeout(() => {
              controller.setTagSuggestionBucket((previous) =>
                previous === target.key ? null : previous,
              );
            }, 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              controller.stageTagsForBucket(target, draft);
            }
          }}
          placeholder="+"
          className={`w-full border-0 bg-transparent p-0 ui-caption text-slate-500 placeholder:text-slate-400 transition-opacity duration-150 focus:outline-none focus:ring-0 dark:text-slate-300 ${
            draft
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        />
      </div>
      {showSuggestions && (
        <div
          className="absolute left-0 top-full z-20 mt-1 max-h-40 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          onMouseDown={(event) => event.preventDefault()}
        >
          {suggestions.map((tag) => (
            <button
              key={`${target.key}:suggest:${tag.id}`}
              type="button"
              onClick={() => {
                void controller.addExistingTagForBucket(target, tag);
                controller.updateTagDraft(target.key, "");
              }}
              className="flex w-full items-center rounded-md px-2 py-1 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <UiTagBadge
                label={tag.label}
                colorKey={tag.color_key}
                visibility={tag.visibility}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import { UiTagBadge } from "../../components/UiTagSettings";
import {
  toolbarCompactButtonClasses,
  toolbarCompactInputClasses,
  toolbarCompactSelectClasses,
} from "../../components/toolbarControlClasses";
import { cx } from "../../components/ui/styles";
import type { useBucketOpsFilterController } from "./useBucketOpsFilterController";

type FilterController = ReturnType<typeof useBucketOpsFilterController>;

type QuickFilterController = Pick<
  FilterController,
  | "quickFilterDraftForcesExact"
  | "quickFilterFieldState"
  | "quickFilterModeForDisplay"
  | "quickFilterPending"
  | "toggleQuickFilterMode"
  | "updateQuickFilterDraft"
>;

type TagFilterController = Pick<
  FilterController,
  | "addTagFilter"
  | "advancedFiltersApplied"
  | "openAdvancedFilterDrawer"
  | "removeTagFilter"
  | "showAdvancedFilter"
  | "updateTagFilterMode"
>;

const modeToggleBaseClass =
  "absolute right-1 top-1 rounded border px-1 py-0 ui-caption font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-0";

function modeToggleClass(
  mode: "contains" | "exact",
  isPending: boolean,
  locked: boolean,
) {
  if (locked) {
    return `${modeToggleBaseClass} cursor-not-allowed border-primary-400 bg-primary-100 text-primary-700 opacity-80 dark:border-primary-400/60 dark:bg-primary-500/20 dark:text-primary-100`;
  }
  if (isPending) {
    return `${modeToggleBaseClass} border-amber-400 bg-amber-100 text-amber-700 focus:ring-amber-300 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200`;
  }
  if (mode === "exact") {
    return `${modeToggleBaseClass} border-primary-400 bg-primary-100 text-primary-700 focus:ring-primary/35 dark:border-primary-400/60 dark:bg-primary-500/20 dark:text-primary-100`;
  }
  return `${modeToggleBaseClass} border-slate-200 bg-white text-slate-500 hover:border-primary hover:text-primary focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100`;
}

export function BucketOpsQuickFilter({
  controller,
  value,
}: {
  controller: QuickFilterController;
  value: string;
}) {
  const {
    quickFilterDraftForcesExact,
    quickFilterFieldState,
    quickFilterModeForDisplay,
    quickFilterPending,
    toggleQuickFilterMode,
    updateQuickFilterDraft,
  } = controller;
  return (
    <div className="relative w-full min-w-[16rem] sm:w-72">
      <textarea
        aria-label="Quick filter"
        value={value}
        onChange={(event) => updateQuickFilterDraft(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder="Bucket name(s)"
        rows={1}
        className={cx(
          toolbarCompactInputClasses,
          "min-h-[2rem] w-full resize-y pr-9",
          quickFilterFieldState.fieldClass ||
            "border-slate-200 dark:border-slate-700",
        )}
      />
      <button
        type="button"
        onClick={toggleQuickFilterMode}
        disabled={quickFilterDraftForcesExact}
        className={modeToggleClass(
          quickFilterModeForDisplay,
          quickFilterPending,
          quickFilterDraftForcesExact,
        )}
        title={
          quickFilterDraftForcesExact
            ? "Quick filter mode: exact (locked by list input)"
            : `Quick filter mode: ${quickFilterModeForDisplay === "contains" ? "contains" : "exact"}`
        }
        aria-label="Toggle quick filter match mode"
      >
        {quickFilterModeForDisplay === "contains" ? "~" : "="}
      </button>
    </div>
  );
}

const visibilityLabel = (tag: BucketUiTagDefinition) =>
  tag.visibility === "shared" ? "Shared" : "Private";

export function BucketOpsTagAndAdvancedFilters({
  availableUiTags,
  controller,
  tagFilterMode,
  tagFilters,
}: {
  availableUiTags: readonly BucketUiTagDefinition[];
  controller: TagFilterController;
  tagFilterMode: "any" | "all";
  tagFilters: readonly number[];
}) {
  const {
    addTagFilter,
    advancedFiltersApplied,
    openAdvancedFilterDrawer,
    removeTagFilter,
    showAdvancedFilter,
    updateTagFilterMode,
  } = controller;
  const selectedIds = new Set(tagFilters);
  const availableTagFilters = availableUiTags.filter(
    (tag) => !selectedIds.has(tag.id),
  );
  const showTagFilterBar = availableUiTags.length > 0 || tagFilters.length > 0;

  return (
    <>
      {showTagFilterBar ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {tagFilters.map((tagId) => {
              const tag = availableUiTags.find((item) => item.id === tagId);
              if (!tag) return null;
              const visibility = visibilityLabel(tag);
              return (
                <UiTagBadge
                  key={`filter:${tag.id}`}
                  label={tag.label}
                  colorKey={tag.color_key}
                  visibility={tag.visibility}
                  selectionState="selected"
                  className="text-xs"
                  ariaLabel={`Selected UI tag filter ${tag.label}, ${visibility}`}
                  title={`Selected UI tag filter: ${tag.label}, ${visibility}`}
                  onRemove={() => removeTagFilter(tag.id)}
                  removeAriaLabel={`Remove UI tag filter ${tag.label}, ${visibility}`}
                />
              );
            })}
            {availableTagFilters.map((tag) => {
              const visibility = visibilityLabel(tag);
              return (
                <UiTagBadge
                  key={`available:${tag.id}`}
                  label={tag.label}
                  colorKey={tag.color_key}
                  visibility={tag.visibility}
                  selectionState="available"
                  onClick={() => addTagFilter(tag.id)}
                  ariaLabel={`Add UI tag filter ${tag.label}, ${visibility}`}
                  title={`Available UI tag filter: ${tag.label}, ${visibility}. Click to add.`}
                />
              );
            })}
          </div>
          <select
            aria-label="UI tag filter match mode"
            value={tagFilterMode}
            onChange={(event) =>
              updateTagFilterMode(event.target.value as "any" | "all")
            }
            className={cx(
              toolbarCompactSelectClasses,
              "w-auto px-2 py-1",
            )}
          >
            <option value="any">OR</option>
            <option value="all">AND</option>
          </select>
        </div>
      ) : null}
      <button
        type="button"
        onClick={openAdvancedFilterDrawer}
        className={cx(
          toolbarCompactButtonClasses,
          showAdvancedFilter || advancedFiltersApplied
            ? "border-primary/40 bg-primary-50 text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/10 dark:text-primary-100"
            : "",
        )}
      >
        Advanced filter{advancedFiltersApplied ? " · Active" : ""}
      </button>
    </>
  );
}

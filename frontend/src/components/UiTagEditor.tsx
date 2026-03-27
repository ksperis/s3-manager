/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { KeyboardEvent, useMemo, useState } from "react";
import type { TagColorKey, TagDefinitionSummary } from "../api/tags";
import { normalizeUiTags, type UiTagDefinition } from "../utils/uiTags";
import { getTagColorOption, TAG_COLOR_OPTIONS } from "../utils/tagPalette";
import UiBadge from "./ui/UiBadge";
import { cx, uiInputClass, uiLabelClass } from "./ui/styles";

type UiTagEditorProps = {
  label?: string;
  tags: UiTagDefinition[];
  catalog?: TagDefinitionSummary[];
  onChange: (nextTags: UiTagDefinition[]) => void;
  placeholder?: string;
  hint?: string;
  catalogMode?: "shared" | "private";
};

function getLabelKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function renderColorSwatch(
  option: (typeof TAG_COLOR_OPTIONS)[number],
  selected: boolean,
  onClick: () => void,
  ariaLabel: string,
  disabled = false
) {
  return (
    <button
      key={option.key}
      type="button"
      aria-label={ariaLabel}
      title={option.label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition",
        disabled ? "cursor-not-allowed opacity-50" : "hover:scale-105",
        selected
          ? "border-slate-900 ring-2 ring-primary/50 dark:border-slate-100"
          : "border-slate-300 dark:border-slate-600"
      )}
    >
      <span className={cx("h-4 w-4 rounded-full", option.swatchClassName)} />
    </button>
  );
}

export default function UiTagEditor({
  label = "Tags",
  tags,
  catalog,
  onChange,
  placeholder = "Add a tag",
  hint,
  catalogMode = "shared",
}: UiTagEditorProps) {
  const [existingSearch, setExistingSearch] = useState("");
  const [newTagLabel, setNewTagLabel] = useState("");
  const [newTagColorKey, setNewTagColorKey] = useState<TagColorKey>("neutral");
  const [colorEditorTagKey, setColorEditorTagKey] = useState<string | null>(null);
  const [pendingSharedColorKey, setPendingSharedColorKey] = useState<TagColorKey>("neutral");
  const normalizedTags = useMemo(() => normalizeUiTags(tags), [tags]);
  const normalizedCatalog = useMemo(() => normalizeUiTags(catalog), [catalog]);
  const selectedLabelKeys = useMemo(
    () => new Set(normalizedTags.map((tag) => getLabelKey(tag.label))),
    [normalizedTags]
  );
  const activeColorEditorTag = useMemo(
    () => normalizedTags.find((tag) => getLabelKey(tag.label) === colorEditorTagKey) ?? null,
    [colorEditorTagKey, normalizedTags]
  );
  const availableCatalogTags = useMemo(() => {
    const needle = existingSearch.trim().toLocaleLowerCase();
    return normalizedCatalog
      .filter((tag) => !selectedLabelKeys.has(getLabelKey(tag.label)))
      .filter((tag) => !needle || tag.label.toLocaleLowerCase().includes(needle))
      .slice(0, 8);
  }, [existingSearch, normalizedCatalog, selectedLabelKeys]);
  const trimmedNewTagLabel = newTagLabel.trim();
  const newTagLabelKey = getLabelKey(trimmedNewTagLabel);
  const exactCatalogMatch = useMemo(
    () =>
      trimmedNewTagLabel
        ? normalizedCatalog.find((entry) => getLabelKey(entry.label) === newTagLabelKey) ?? null
        : null,
    [newTagLabelKey, normalizedCatalog, trimmedNewTagLabel]
  );
  const newTagAlreadySelected = Boolean(trimmedNewTagLabel && selectedLabelKeys.has(newTagLabelKey));
  const newTagValidationMessage = newTagAlreadySelected
    ? "This tag is already selected."
    : exactCatalogMatch
      ? "This tag already exists. Add it from Add existing tag."
      : null;
  const canCreateNewTag = Boolean(trimmedNewTagLabel) && !newTagValidationMessage;
  const canPickNewTagColor = canCreateNewTag;
  const existingTagHelp =
    catalogMode === "private"
      ? "Reuse a private tag from your private-connection tag catalog."
      : "Reuse a shared tag from this catalog.";
  const createTagHelp =
    catalogMode === "private"
      ? "Create a new private tag with its initial color."
      : "Create a new shared tag with its initial color.";
  const sharedColorHelp =
    catalogMode === "private"
      ? "This updates the private tag definition for your private-connection tag catalog."
      : "This updates the shared tag definition for all objects in this domain.";

  const addExistingTag = (tag: UiTagDefinition) => {
    onChange(normalizeUiTags([...normalizedTags, tag]));
    setExistingSearch("");
  };

  const createNewTag = () => {
    if (!canCreateNewTag) return;
    onChange(normalizeUiTags([...normalizedTags, { label: trimmedNewTagLabel, color_key: newTagColorKey }]));
    setNewTagLabel("");
    setNewTagColorKey("neutral");
  };

  const removeTag = (value: string) => {
    const target = getLabelKey(value);
    onChange(normalizeUiTags(normalizedTags.filter((tag) => getLabelKey(tag.label) !== target)));
    if (colorEditorTagKey === target) {
      setColorEditorTagKey(null);
    }
  };

  const recolorTag = (value: string, colorKey: TagColorKey) => {
    const target = getLabelKey(value);
    onChange(
      normalizeUiTags(
        normalizedTags.map((tag) =>
          getLabelKey(tag.label) === target ? { ...tag, color_key: colorKey } : tag
        )
      )
    );
  };

  const openColorEditor = (tag: UiTagDefinition) => {
    const target = getLabelKey(tag.label);
    setColorEditorTagKey((current) => {
      if (current === target) return null;
      setPendingSharedColorKey(tag.color_key);
      return target;
    });
  };

  const handleCreateInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    createNewTag();
  };

  return (
    <div className="space-y-2">
      <label className={uiLabelClass}>{label}</label>
      <div className="space-y-4 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Selected tags
            </span>
            <span className="ui-caption text-slate-400 dark:text-slate-500">{normalizedTags.length}</span>
          </div>
          {normalizedTags.length === 0 ? (
            <span className="ui-caption text-slate-400 dark:text-slate-500">No tags selected</span>
          ) : (
            <div className="space-y-2">
              {normalizedTags.map((tag) => {
                const isColorEditorOpen = colorEditorTagKey === getLabelKey(tag.label);
                const isSharedTag = typeof tag.id === "number";
                const previewColor = isSharedTag ? pendingSharedColorKey : tag.color_key;
                return (
                  <div
                    key={`${tag.id ?? tag.label}-${tag.color_key}`}
                    className={cx(
                      "space-y-2 rounded-lg border px-2.5 py-2",
                      isColorEditorOpen
                        ? "border-primary/40 bg-primary-50/60 dark:border-primary-500/40 dark:bg-primary-950/20"
                        : "border-slate-200/70 bg-white/80 dark:border-slate-700 dark:bg-slate-900/60"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <UiBadge
                        disableToneStyles
                        className={cx(
                          "max-w-full gap-1 px-2 py-0.5 text-[10px]",
                          getTagColorOption(tag.color_key).badgeClassName
                        )}
                      >
                        <span className="truncate">{tag.label}</span>
                      </UiBadge>
                      <button
                        type="button"
                        aria-label={`${isSharedTag ? "Change shared color" : "Change color"} for ${tag.label}`}
                        onClick={() => openColorEditor(tag)}
                        className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-600 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100"
                      >
                        {isSharedTag ? "Change shared color" : "Change color"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTag(tag.label)}
                        className="rounded-md border border-rose-200 px-2 py-1 ui-caption font-semibold text-rose-700 transition hover:bg-rose-50 dark:border-rose-900/40 dark:text-rose-100 dark:hover:bg-rose-950/40"
                      >
                        Remove
                      </button>
                    </div>

                    {isColorEditorOpen && (
                      <div className="space-y-2 rounded-lg border border-slate-200/70 bg-white/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/60">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {isSharedTag ? "Change shared color" : "Change color"}
                          </p>
                          <UiBadge
                            disableToneStyles
                            className={cx(
                              "max-w-full gap-1 px-2 py-0.5 text-[10px]",
                              getTagColorOption(previewColor).badgeClassName
                            )}
                          >
                            <span className="truncate">{tag.label}</span>
                          </UiBadge>
                        </div>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          {isSharedTag
                            ? sharedColorHelp
                            : "This color only affects the new tag you are editing on this object."}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {TAG_COLOR_OPTIONS.map((option) =>
                            renderColorSwatch(
                              option,
                              option.key === previewColor,
                              () => {
                                if (isSharedTag) {
                                  setPendingSharedColorKey(option.key);
                                  return;
                                }
                                recolorTag(tag.label, option.key);
                                setColorEditorTagKey(null);
                              },
                              `${isSharedTag ? "Select" : "Use"} ${option.label} for ${tag.label}`
                            )
                          )}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setColorEditorTagKey(null)}
                            className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                          >
                            {isSharedTag ? "Cancel" : "Close"}
                          </button>
                          {isSharedTag && (
                            <button
                              type="button"
                              onClick={() => {
                                recolorTag(tag.label, pendingSharedColorKey);
                                setColorEditorTagKey(null);
                              }}
                              className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 ui-caption font-semibold text-primary transition hover:bg-primary/15 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-100"
                            >
                              Apply color change
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200/70 bg-white/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/60">
          <div className="space-y-1">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Add existing tag
            </p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">{existingTagHelp}</p>
          </div>
          <input
            type="text"
            value={existingSearch}
            onChange={(event) => setExistingSearch(event.target.value)}
            aria-label="Search existing tags"
            className={uiInputClass}
            placeholder="Search existing tags"
          />
          {availableCatalogTags.length === 0 ? (
            <p className="ui-caption text-slate-400 dark:text-slate-500">
              {normalizedCatalog.length === 0
                ? "No existing tags available."
                : existingSearch.trim()
                  ? "No matching existing tags."
                  : "All catalog tags are already selected."}
            </p>
          ) : (
            <div className="space-y-2">
              {availableCatalogTags.map((tag) => (
                <div
                  key={tag.id ?? tag.label}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-slate-50/80 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/50"
                >
                  <UiBadge
                    disableToneStyles
                    className={cx(
                      "max-w-full gap-1 px-2 py-0.5 text-[10px]",
                      getTagColorOption(tag.color_key).badgeClassName
                    )}
                  >
                    <span className="truncate">{tag.label}</span>
                  </UiBadge>
                  <button
                    type="button"
                    aria-label={`Add ${tag.label}`}
                    onClick={() => addExistingTag(tag)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 ui-caption font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200/70 bg-white/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/60">
          <div className="space-y-1">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Create new tag
            </p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">{createTagHelp}</p>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              value={newTagLabel}
              onChange={(event) => setNewTagLabel(event.target.value)}
              onKeyDown={handleCreateInputKeyDown}
              aria-label="New tag label"
              className={uiInputClass}
              placeholder={placeholder}
            />
            {newTagValidationMessage && (
              <p className="ui-caption text-amber-700 dark:text-amber-300">{newTagValidationMessage}</p>
            )}
          </div>
          <div className={cx("space-y-2", !canPickNewTagColor && "opacity-60")}>
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Initial color
            </p>
            <div className="flex flex-wrap gap-2">
              {TAG_COLOR_OPTIONS.map((option) =>
                renderColorSwatch(
                  option,
                  option.key === newTagColorKey,
                  () => setNewTagColorKey(option.key),
                  `Use ${option.label} for new tag`,
                  !canPickNewTagColor
                )
              )}
            </div>
            {canPickNewTagColor && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="ui-caption text-slate-500 dark:text-slate-400">Preview</span>
                <UiBadge
                  disableToneStyles
                  className={cx("px-2 py-0.5 text-[10px]", getTagColorOption(newTagColorKey).badgeClassName)}
                >
                  {trimmedNewTagLabel}
                </UiBadge>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={createNewTag}
              className="rounded-md border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-700 transition hover:border-primary hover:text-primary disabled:opacity-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
              disabled={!canCreateNewTag}
            >
              Create and add tag
            </button>
          </div>
        </div>
      </div>
      {hint && <p className="ui-caption text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

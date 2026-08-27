/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { TagDefinitionSummary } from "../api/tags";
import { DEFAULT_TAG_SCOPE, normalizeUiTags, type UiTagDefinition } from "../utils/uiTags";
import {
  getUiTagScopeOption,
  UiTagBadge,
  UiTagColorPalette,
  UiTagScopeSettings,
  UiTagSettingsPopover,
} from "./UiTagSettings";
import { cx, uiLabelClass } from "./ui/styles";

type UiTagEditorProps = {
  label?: string;
  tags: UiTagDefinition[];
  catalog?: TagDefinitionSummary[];
  onChange: (nextTags: UiTagDefinition[]) => void;
  placeholder?: string;
  hint?: string;
  catalogMode?: "shared" | "private";
  hideLabel?: boolean;
  compact?: boolean;
};

function getLabelKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

export default function UiTagEditor({
  label = "Tags",
  tags,
  catalog,
  onChange,
  placeholder = "Add a tag",
  hint,
  catalogMode = "shared",
  hideLabel = false,
  compact = false,
}: UiTagEditorProps) {
  const [draft, setDraft] = useState("");
  const [activeTagKey, setActiveTagKey] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputId = useId();
  const normalizedTags = useMemo(() => normalizeUiTags(tags), [tags]);
  const normalizedCatalog = useMemo(() => normalizeUiTags(catalog), [catalog]);
  const selectedTagKeys = useMemo(
    () => new Set(normalizedTags.map((tag) => getLabelKey(tag.label))),
    [normalizedTags]
  );
  const draftKey = getLabelKey(draft);
  const exactCatalogMatch = useMemo(
    () =>
      draftKey ? normalizedCatalog.find((entry) => getLabelKey(entry.label) === draftKey) ?? null : null,
    [draftKey, normalizedCatalog]
  );
  const suggestions = useMemo(() => {
    const needle = draft.trim().toLocaleLowerCase();
    return normalizedCatalog
      .filter((entry) => !selectedTagKeys.has(getLabelKey(entry.label)))
      .filter((entry) => !needle || entry.label.toLocaleLowerCase().includes(needle))
      .slice(0, 8);
  }, [draft, normalizedCatalog, selectedTagKeys]);
  const activeTag = useMemo(
    () => normalizedTags.find((entry) => getLabelKey(entry.label) === activeTagKey) ?? null,
    [activeTagKey, normalizedTags]
  );
  const tagAnchorRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const activeTagAnchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    activeTagAnchorRef.current = activeTagKey ? tagAnchorRefs.current[activeTagKey] ?? null : null;
  }, [activeTagKey, normalizedTags]);

  useEffect(() => {
    if (!activeTagKey) return;
    if (!normalizedTags.some((entry) => getLabelKey(entry.label) === activeTagKey)) {
      setActiveTagKey(null);
    }
  }, [activeTagKey, normalizedTags]);

  const addTag = (tag: UiTagDefinition) => {
    onChange(normalizeUiTags([...normalizedTags, tag]));
    setDraft("");
    setShowSuggestions(false);
  };

  const removeTag = (labelValue: string) => {
    const targetKey = getLabelKey(labelValue);
    onChange(normalizeUiTags(normalizedTags.filter((entry) => getLabelKey(entry.label) !== targetKey)));
    if (activeTagKey === targetKey) {
      setActiveTagKey(null);
    }
  };

  const updateTag = (labelValue: string, updates: Partial<Pick<UiTagDefinition, "color_key" | "scope">>) => {
    const targetKey = getLabelKey(labelValue);
    onChange(
      normalizeUiTags(
        normalizedTags.map((entry) =>
          getLabelKey(entry.label) === targetKey ? { ...entry, ...updates } : entry
        )
      )
    );
  };

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const nextKey = getLabelKey(trimmed);
    if (selectedTagKeys.has(nextKey)) {
      setDraft("");
      setShowSuggestions(false);
      return;
    }
    if (exactCatalogMatch) {
      addTag(exactCatalogMatch);
      return;
    }
    addTag({
      label: trimmed,
      color_key: "neutral",
      scope: DEFAULT_TAG_SCOPE,
    });
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitDraft();
    }
    if (event.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const openPopoverForTag = (tag: UiTagDefinition) => {
    const tagKey = getLabelKey(tag.label);
    activeTagAnchorRef.current = tagAnchorRefs.current[tagKey] ?? null;
    setActiveTagKey((current) => (current === tagKey ? null : tagKey));
  };

  const sharedModeHelp =
    catalogMode === "private"
      ? "This tag belongs to your private-connection tag catalog."
      : "This tag is shared across the current domain.";
  const scopeHelp =
    catalogMode === "private"
      ? "Administrative tags stay in your private-connection management views. Standard tags can also appear in selectors."
      : "Administrative tags stay in management views. Standard tags can also appear in selectors.";

  return (
    <div className="flex flex-col gap-1">
      {!hideLabel && (
        <label htmlFor={inputId} className={uiLabelClass}>
          {label}
        </label>
      )}
      <div className="space-y-2">
        <div className="relative">
          <div
            className={cx(
              "group flex flex-wrap items-center gap-2 border border-slate-200/80 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/40",
              compact ? "min-h-10 rounded-lg px-2.5 py-1.5" : "min-h-11 rounded-xl px-3 py-2"
            )}
          >
            {normalizedTags.map((tag) => {
              const tagKey = getLabelKey(tag.label);
              const isActive = activeTagKey === tagKey;
              return (
                <span
                  key={`${tag.id ?? tag.label}-${tag.color_key}-${tag.scope}`}
                  ref={(node) => {
                    tagAnchorRefs.current[tagKey] = node;
                  }}
                >
                  <UiTagBadge
                    label={tag.label}
                    colorKey={tag.color_key}
                    active={isActive}
                    ariaLabel={`Edit tag ${tag.label}`}
                    title={`${tag.label} • ${getUiTagScopeOption(tag.scope).label}`}
                    onClick={() => openPopoverForTag(tag)}
                    onRemove={() => removeTag(tag.label)}
                    removeAriaLabel={`Remove tag ${tag.label}`}
                  />
                </span>
              );
            })}
            <div className="min-w-[5rem] flex-1">
              <input
                id={inputId}
                type="text"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => {
                  window.setTimeout(() => {
                    setShowSuggestions(false);
                  }, 120);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder={normalizedTags.length === 0 ? placeholder : "+"}
                className="w-full border-0 bg-transparent p-0 ui-caption text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-200 dark:placeholder:text-slate-500"
                aria-label={placeholder}
              />
            </div>
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div
              className="absolute left-0 top-full z-20 mt-1 max-h-44 w-64 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
              onMouseDown={(event) => event.preventDefault()}
            >
              {suggestions.map((tag) => (
                <button
                  key={`${tag.id ?? tag.label}-${tag.color_key}-${tag.scope}`}
                  type="button"
                  aria-label={`Add tag ${tag.label}`}
                  onClick={() => addTag(tag)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left ui-caption font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <UiTagBadge label={tag.label} colorKey={tag.color_key} />
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {getUiTagScopeOption(tag.scope).label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {hint && <p className="ui-caption text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>

      <UiTagSettingsPopover
        open={Boolean(activeTag && activeTagAnchorRef.current)}
        anchorRef={activeTagAnchorRef}
        label={activeTag?.label ?? ""}
        colorKey={activeTag?.color_key ?? "neutral"}
        description={
          activeTag
            ? typeof activeTag.id === "number"
              ? sharedModeHelp
              : "This new tag stays local to the form until you save."
            : ""
        }
        onDismiss={() => setActiveTagKey(null)}
      >
        {activeTag ? (
          <>
            <UiTagColorPalette
              label={activeTag.label}
              value={activeTag.color_key}
              onChange={(colorKey) =>
                updateTag(activeTag.label, { color_key: colorKey })
              }
            />
            <UiTagScopeSettings
              value={activeTag.scope ?? DEFAULT_TAG_SCOPE}
              onChange={(scope) => updateTag(activeTag.label, { scope })}
              help={
                <>
                  {getUiTagScopeOption(activeTag.scope).description} {scopeHelp}
                </>
              }
            />
          </>
        ) : null}
      </UiTagSettingsPopover>
    </div>
  );
}

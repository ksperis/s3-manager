/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { TagDefinitionSummary, TagScope } from "../api/tags";
import { getTagColorOption, TAG_COLOR_OPTIONS } from "../utils/tagPalette";
import { DEFAULT_TAG_SCOPE, normalizeUiTags, type UiTagDefinition } from "../utils/uiTags";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import UiBadge from "./ui/UiBadge";
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

const SCOPE_OPTIONS: Array<{ key: TagScope; label: string; description: string }> = [
  {
    key: "standard",
    label: "Standard",
    description: "Also visible in selectors.",
  },
  {
    key: "administrative",
    label: "Administrative",
    description: "Visible only in management lists and edit surfaces.",
  },
];

function getLabelKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function getScopeOption(scope: TagScope | undefined) {
  return SCOPE_OPTIONS.find((option) => option.key === scope) ?? SCOPE_OPTIONS[0];
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
  const tagButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeTagAnchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeTagAnchorRef.current = activeTagKey ? tagButtonRefs.current[activeTagKey] ?? null : null;
  }, [activeTagKey, normalizedTags]);

  useEffect(() => {
    if (!activeTagKey) return;
    if (!normalizedTags.some((entry) => getLabelKey(entry.label) === activeTagKey)) {
      setActiveTagKey(null);
    }
  }, [activeTagKey, normalizedTags]);

  useEffect(() => {
    if (!activeTagKey) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (activeTagAnchorRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setActiveTagKey(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveTagKey(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown as unknown as EventListener);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown as unknown as EventListener);
    };
  }, [activeTagKey]);

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

  const openPopoverForTag = (tag: UiTagDefinition, anchor: HTMLButtonElement) => {
    const tagKey = getLabelKey(tag.label);
    activeTagAnchorRef.current = anchor;
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
    <div className={compact && hideLabel ? "space-y-1" : "space-y-2"}>
      {!hideLabel && <label className={uiLabelClass}>{label}</label>}
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
              const colorOption = getTagColorOption(tag.color_key);
              const scopeOption = getScopeOption(tag.scope);
              const isActive = activeTagKey === tagKey;
              return (
                <span
                  key={`${tag.id ?? tag.label}-${tag.color_key}-${tag.scope}`}
                  className={cx(
                    "inline-flex max-w-full items-center overflow-hidden rounded-full border shadow-sm transition",
                    colorOption.badgeClassName,
                    isActive && "ring-2 ring-primary/40"
                  )}
                >
                  <button
                    type="button"
                    ref={(node) => {
                      tagButtonRefs.current[tagKey] = node;
                    }}
                    onClick={(event) => openPopoverForTag(tag, event.currentTarget)}
                    aria-label={`Edit tag ${tag.label}`}
                    title={`${tag.label} • ${scopeOption.label}`}
                    className="min-w-0 px-2 py-0.5 text-[10px] font-semibold leading-4 focus:outline-none"
                  >
                    <span className="truncate">{tag.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeTag(tag.label);
                    }}
                    aria-label={`Remove tag ${tag.label}`}
                    className="border-l border-current/15 px-1.5 py-0.5 text-[10px] font-semibold leading-4 opacity-70 transition hover:opacity-100 focus:outline-none"
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <div className="min-w-[5rem] flex-1">
              <input
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
                  <UiBadge
                    disableToneStyles
                    className={cx("max-w-full truncate px-2 py-0.5 text-[10px]", getTagColorOption(tag.color_key).badgeClassName)}
                  >
                    <span className="truncate">{tag.label}</span>
                  </UiBadge>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {getScopeOption(tag.scope).label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {hint && <p className="ui-caption text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>

      <AnchoredPortalMenu
        open={Boolean(activeTag && activeTagAnchorRef.current)}
        anchorRef={activeTagAnchorRef}
        placement="bottom-start"
        offset={6}
        minWidth={288}
        className="z-[90]"
      >
        {activeTag ? (
          <div
            ref={popoverRef}
            role="group"
            aria-label={`Tag settings for ${activeTag.label}`}
            className="w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <span className={uiLabelClass}>Tag settings</span>
                <div className="flex items-start justify-between gap-3">
                  <UiBadge
                    disableToneStyles
                    className={cx(
                      "max-w-full truncate px-2 py-0.5 text-[10px]",
                      getTagColorOption(activeTag.color_key).badgeClassName
                    )}
                  >
                    <span className="truncate">{activeTag.label}</span>
                  </UiBadge>
                  <button
                    type="button"
                    onClick={() => setActiveTagKey(null)}
                    className="ui-caption font-semibold text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
                    aria-label="Close tag settings"
                  >
                    ×
                  </button>
                </div>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {typeof activeTag.id === "number"
                    ? sharedModeHelp
                    : "This new tag stays local to the form until you save."}
                </p>
              </div>

              <div className="space-y-2">
                <span className={uiLabelClass}>Color</span>
                <div className="grid grid-cols-6 gap-2">
                  {TAG_COLOR_OPTIONS.map((option) => {
                    const selected = option.key === activeTag.color_key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        aria-label={`Set ${activeTag.label} color to ${option.label}`}
                        title={option.label}
                        onClick={() => updateTag(activeTag.label, { color_key: option.key })}
                        className={cx(
                          "inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition hover:scale-105",
                          selected
                            ? "border-slate-900 ring-2 ring-primary/50 dark:border-slate-100"
                            : "border-slate-300 dark:border-slate-600"
                        )}
                      >
                        <span className={cx("h-4 w-4 rounded-full", option.swatchClassName)} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <span className={uiLabelClass}>Scope</span>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/70">
                  {SCOPE_OPTIONS.map((option) => {
                    const selected = (activeTag.scope ?? DEFAULT_TAG_SCOPE) === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => updateTag(activeTag.label, { scope: option.key })}
                        className={cx(
                          "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
                          selected
                            ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                            : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {getScopeOption(activeTag.scope).description} {scopeHelp}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </AnchoredPortalMenu>
    </div>
  );
}

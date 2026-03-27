/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ExecutionContext } from "../api/executionContexts";
import { formatAccountLabel } from "../features/shared/storageEndpointLabel";
import UiTagBadgeList from "./UiTagBadgeList";
import TopbarControlTrigger from "./TopbarControlTrigger";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { useSelectorTagsPreference } from "../utils/selectorTagsPreference";
import { buildUiTagItems, extractUiTagLabels } from "../utils/uiTags";

export type ContextAccessMode = "admin" | "session" | "s3_user" | "connection" | null;

export function getContextAccessModeVisual(mode: ContextAccessMode): {
  label: string;
  shortLabel: string;
  classes: string;
} {
  if (mode === "admin") {
    return {
      label: "Admin mode",
      shortLabel: "Admin",
      classes: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100",
    };
  }
  if (mode === "connection") {
    return {
      label: "Connection mode",
      shortLabel: "Connection",
      classes: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-100",
    };
  }
  if (mode === "s3_user") {
    return {
      label: "S3 user mode",
      shortLabel: "S3 user",
      classes: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-100",
    };
  }
  return {
    label: "Session",
    shortLabel: "Session",
    classes: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  };
}

function contextKindRank(kind: ExecutionContext["kind"]): number {
  if (kind === "account") return 0;
  if (kind === "legacy_user") return 1;
  return 2;
}

type TopbarContextAccountSelectorProps = {
  contexts: ExecutionContext[];
  selectedContextId: string | null;
  onContextChange: (selectedValue: string) => void;
  selectedLabel: string;
  identityLabel: string | null;
  defaultEndpointId: number | null;
  defaultEndpointName: string | null;
  widthClassName?: string;
  searchThreshold?: number;
  openInPortal?: boolean;
  triggerMode?: "icon" | "icon_label";
};

export default function TopbarContextAccountSelector({
  contexts,
  selectedContextId,
  onContextChange,
  selectedLabel,
  identityLabel,
  defaultEndpointId,
  defaultEndpointName,
  widthClassName = "w-[32rem] max-w-[70vw] min-w-[22rem]",
  searchThreshold = 6,
  openInPortal = true,
  triggerMode = "icon_label",
}: TopbarContextAccountSelectorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const showSelectorTags = useSelectorTagsPreference();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const contextItems = useMemo(
    () =>
      contexts
        .map((context) => {
          const label = formatAccountLabel(context, defaultEndpointId, defaultEndpointName);
          const description =
            context.kind === "connection"
              ? "Private connection"
              : context.kind === "legacy_user"
                ? "Legacy S3 user identity"
                : "RGW account";
          const displayName = context.display_name.trim();
          const haystack = [
            label,
            context.display_name,
            context.endpoint_name,
            context.endpoint_url,
            description,
            ...extractUiTagLabels(context.tags),
            ...extractUiTagLabels(context.endpoint_tags),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          const tagItems = buildUiTagItems(context.tags, context.endpoint_tags);
          return {
            id: context.id,
            kind: context.kind,
            typeRank: contextKindRank(context.kind),
            displayName,
            label,
            description,
            haystack,
            endpointUrl: context.endpoint_url ?? null,
            tagItems,
          };
        })
        .sort((a, b) => {
          if (a.typeRank !== b.typeRank) return a.typeRank - b.typeRank;
          const byDisplayName = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
          if (byDisplayName !== 0) return byDisplayName;
          const byLabel = a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
          if (byLabel !== 0) return byLabel;
          return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
        }),
    [contexts, defaultEndpointId, defaultEndpointName]
  );

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return contextItems;
    return contextItems.filter((item) => item.haystack.includes(normalized));
  }, [contextItems, query]);
  const selectedItem = useMemo(
    () => contextItems.find((item) => item.id === selectedContextId) ?? null,
    [contextItems, selectedContextId]
  );

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuSurfaceRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) setQuery("");
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const currentIndex = filteredItems.findIndex((item) => item.id === selectedContextId);
    setActiveIndex(currentIndex >= 0 ? currentIndex : filteredItems.length > 0 ? 0 : -1);
  }, [filteredItems, menuOpen, selectedContextId]);

  useEffect(() => {
    if (!menuOpen) return;
    requestAnimationFrame(() => {
      listboxRef.current?.focus();
    });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    if (filteredItems.length === 0) {
      setActiveIndex(-1);
      return;
    }
    if (activeIndex < 0 || activeIndex >= filteredItems.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, filteredItems.length, menuOpen]);

  const closeMenuAndFocusTrigger = () => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  const activateByIndex = (index: number) => {
    if (index < 0 || index >= filteredItems.length) return;
    const item = filteredItems[index];
    setMenuOpen(false);
    if (item.id !== selectedContextId) onContextChange(item.id);
    triggerRef.current?.focus();
  };

  const handleListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenuAndFocusTrigger();
      return;
    }
    if (event.key === "Tab") {
      setMenuOpen(false);
      return;
    }
    if (filteredItems.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current < 0 ? 0 : (current + 1) % filteredItems.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current < 0 ? filteredItems.length - 1 : (current - 1 + filteredItems.length) % filteredItems.length
      );
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(filteredItems.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeIndex >= 0) activateByIndex(activeIndex);
    }
  };

  const menuContent = (
    <div ref={menuSurfaceRef} className="w-full rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <div className="rounded-lg border border-slate-200/70 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70">
        <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Current IAM identity</p>
        <p className="truncate ui-caption font-semibold text-slate-800 dark:text-slate-100">
          {identityLabel ?? "Not available for this context"}
        </p>
      </div>

      {contextItems.length > searchThreshold && (
        <div className="relative mt-2">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search account..."
            className="h-9 w-full rounded-lg border border-slate-200/80 bg-white pl-8 pr-3 ui-caption text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      )}

      <div
        id={listboxId}
        ref={listboxRef}
        className="mt-2 max-h-72 overflow-y-auto focus:outline-none"
        role="listbox"
        tabIndex={0}
        aria-label="Select context account"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        onKeyDown={handleListboxKeyDown}
      >
        {filteredItems.length === 0 ? (
          <div className="rounded-lg px-3 py-2 ui-caption text-slate-500 dark:text-slate-400">
            No account matches your search.
          </div>
        ) : (
          filteredItems.map((item, index) => {
            const active = item.id === selectedContextId;
            const highlighted = index === activeIndex;
            return (
              <button
                key={item.id}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  setMenuOpen(false);
                  if (item.id !== selectedContextId) onContextChange(item.id);
                  triggerRef.current?.focus();
                }}
                className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition ${
                  active
                    ? "bg-primary-50 text-primary-900 dark:bg-primary-900/30 dark:text-primary-100"
                    : highlighted
                      ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <span className="mt-0.5 h-4 w-4 shrink-0">
                  {active ? <CheckIcon className="h-4 w-4" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="block min-w-0 flex-1 truncate ui-caption font-semibold">{item.label}</span>
                    {showSelectorTags && item.tagItems.length > 0 && (
                      <div className="ml-auto min-w-0 max-w-[14rem] shrink-0 overflow-hidden">
                        <UiTagBadgeList
                          items={item.tagItems}
                          layout="inline-compact"
                          className="max-w-full"
                          maxVisible={4}
                        />
                      </div>
                    )}
                  </div>
                  <span className="block truncate ui-caption text-slate-500 dark:text-slate-400">
                    {item.description}
                    {item.endpointUrl ? ` · ${item.endpointUrl}` : ""}
                  </span>
                </div>
                </button>
              );
          })
        )}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={`relative shrink-0 ${widthClassName}`}>
      <TopbarControlTrigger
        buttonRef={triggerRef}
        mode={triggerMode}
        label="Account"
        value={selectedLabel}
        icon={<AccountIcon className="h-4 w-4 text-slate-500 dark:text-slate-300" />}
        open={menuOpen}
        ariaLabel="Select context account"
        title={identityLabel ?? undefined}
        rightAddon={
          showSelectorTags && triggerMode !== "icon" && selectedItem && selectedItem.tagItems.length > 0 ? (
            <UiTagBadgeList
              items={selectedItem.tagItems}
              layout="inline-compact"
              maxVisible={3}
              className="max-w-full"
            />
          ) : undefined
        }
        onClick={() => setMenuOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!menuOpen) setMenuOpen(true);
          }
        }}
      />

      {menuOpen &&
        (openInPortal ? (
          <AnchoredPortalMenu
            open={menuOpen}
            anchorRef={triggerRef}
            placement="bottom-start"
            minWidth="anchor"
          >
            {menuContent}
          </AnchoredPortalMenu>
        ) : (
          <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-full">{menuContent}</div>
        ))}
    </div>
  );
}

function AccountIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M3 10h18" />
      <circle cx="8.5" cy="14.2" r="1.1" strokeWidth={1.4} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M12 14.2h6" />
    </svg>
  );
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="11" cy="11" r="6.5" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeWidth={1.6} d="m16 16 4.5 4.5" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m4.5 10.5 3.2 3.2 7.8-7.8" />
    </svg>
  );
}

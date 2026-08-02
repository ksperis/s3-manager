/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import TopbarControlTrigger from "./TopbarControlTrigger";

export type TopbarDropdownOption = {
  value: string;
  label: string;
  description?: string;
  title?: string;
  searchText?: string;
  icon?: ReactNode;
  details?: ReactNode;
  inlineAddon?: ReactNode;
  triggerAddon?: ReactNode;
};

export type TopbarDropdownSearchConfig = {
  threshold?: number;
  ariaLabel: string;
  placeholder: string;
  emptyMessage: string;
};

type TopbarDropdownSelectProps = {
  value: string;
  options: TopbarDropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  triggerValue?: string;
  title?: string;
  disabled?: boolean;
  align?: "left" | "right";
  widthClassName?: string;
  menuMinWidthClassName?: string;
  menuHeader?: ReactNode;
  search?: TopbarDropdownSearchConfig;
  icon?: ReactNode;
  triggerLabel?: string;
  compactOnNarrow?: boolean;
  openInPortal?: boolean;
  triggerMode?: "icon" | "icon_label";
};

function optionSearchText(option: TopbarDropdownOption): string {
  return [option.label, option.description, option.title, option.searchText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function TopbarDropdownSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Select",
  triggerValue,
  title,
  disabled = false,
  align = "left",
  widthClassName = "w-56",
  menuMinWidthClassName = "min-w-full",
  menuHeader,
  search,
  icon,
  triggerLabel,
  compactOnNarrow = false,
  openInPortal = true,
  triggerMode = "icon_label",
}: TopbarDropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const showSearch = Boolean(search && options.length > (search.threshold ?? 0));
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!showSearch || !normalized) return options;
    return options.filter((option) => optionSearchText(option).includes(normalized));
  }, [options, query, showSearch]);
  const selectedFilteredIndex = useMemo(
    () => filteredOptions.findIndex((option) => option.value === value),
    [filteredOptions, value],
  );
  const listboxId = useId();
  const menuPositionClass = align === "right" ? "right-0" : "left-0";
  const iconOnly = triggerMode === "icon";

  const closeMenuAndFocusTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const activateByIndex = (index: number) => {
    if (index < 0 || index >= filteredOptions.length) return;
    const option = filteredOptions[index];
    setOpen(false);
    if (option.value !== value) onChange(option.value);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuSurfaceRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!showSearch && query) setQuery("");
  }, [query, showSearch]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(
      selectedFilteredIndex >= 0
        ? selectedFilteredIndex
        : filteredOptions.length > 0
          ? 0
          : -1,
    );
  }, [filteredOptions, open, selectedFilteredIndex]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (showSearch) {
        searchInputRef.current?.focus();
      } else {
        listboxRef.current?.focus();
      }
    });
  }, [open, showSearch]);

  const handleListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenuAndFocusTrigger();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (filteredOptions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        current < 0 ? 0 : (current + 1) % filteredOptions.length,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current < 0
          ? filteredOptions.length - 1
          : (current - 1 + filteredOptions.length) % filteredOptions.length,
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
      setActiveIndex(filteredOptions.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeIndex >= 0) activateByIndex(activeIndex);
    }
  };

  const menuContent = (
    <>
      {menuHeader}
      {showSearch && search ? (
        <div className={`relative ${menuHeader ? "mt-1.5" : ""}`}>
          <SearchIcon className="shell-icon-muted pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                listboxRef.current?.focus();
              }
            }}
            aria-label={search.ariaLabel}
            placeholder={search.placeholder}
            className="shell-control h-8 w-full rounded-md border pl-8 pr-3 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      ) : null}
      <div
        id={listboxId}
        ref={listboxRef}
        className={`${menuHeader || showSearch ? "mt-1.5 " : ""}max-h-72 overflow-y-auto focus:outline-none`}
        role="listbox"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-activedescendant={
          activeIndex >= 0 && activeIndex < filteredOptions.length
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        onKeyDown={handleListboxKeyDown}
      >
        {filteredOptions.length === 0 && search ? (
          <div className="shell-muted-text rounded-md px-3 py-1.5 ui-caption">
            {search.emptyMessage}
          </div>
        ) : (
          filteredOptions.map((option, index) => {
            const active = option.value === value;
            const highlighted =
              filteredOptions[activeIndex]?.value === option.value;
            return (
              <button
                key={option.value || "__empty"}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={active}
                title={option.title}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activateByIndex(index)}
                className={`flex w-full items-start gap-2 rounded-md px-3 py-1.5 text-left transition ${
                  active
                    ? "shell-menu-item-active"
                    : highlighted
                      ? "shell-menu-item-highlighted"
                      : "shell-menu-item hover:bg-[var(--shell-hover)]"
                }`}
              >
                <span className="mt-0.5 h-4 w-4 shrink-0">
                  {active ? <CheckIcon className="h-4 w-4" /> : null}
                </span>
                {option.icon ? (
                  <span className="shell-icon-muted mt-0.5 h-4 w-4 shrink-0">
                    {option.icon}
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="block min-w-0 flex-1 truncate ui-caption font-semibold">
                      {option.label}
                    </span>
                    {option.inlineAddon ? (
                      <div className="ml-auto min-w-0 max-w-[14rem] shrink-0 overflow-hidden">
                        {option.inlineAddon}
                      </div>
                    ) : null}
                  </div>
                  {option.description ? (
                    <span className="shell-muted-text block truncate ui-caption">
                      {option.description}
                    </span>
                  ) : null}
                  {option.details ? (
                    <span className="mt-1 block">{option.details}</span>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <div ref={rootRef} className={`relative shrink-0 ${widthClassName}`}>
      <TopbarControlTrigger
        buttonRef={triggerRef}
        mode={triggerMode}
        label={triggerLabel ?? ariaLabel}
        value={triggerValue ?? selectedOption?.label ?? placeholder}
        icon={icon}
        open={open}
        disabled={disabled}
        ariaLabel={ariaLabel}
        title={title}
        rightAddon={selectedOption?.triggerAddon}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
          }
        }}
        className={
          compactOnNarrow && !iconOnly
            ? `shell-control inline-flex h-10 items-center gap-2.5 rounded-lg border px-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${open ? "shell-control-active" : ""}`
            : undefined
        }
      />

      {open &&
        (openInPortal ? (
          <AnchoredPortalMenu
            open={open}
            anchorRef={triggerRef}
            placement={align === "right" ? "bottom-end" : "bottom-start"}
            minWidth="anchor"
            className={`shell-menu ${menuMinWidthClassName} overflow-hidden rounded-lg border p-1.5`}
          >
            <div ref={menuSurfaceRef}>{menuContent}</div>
          </AnchoredPortalMenu>
        ) : (
          <div
            ref={menuSurfaceRef}
            className={`shell-menu absolute ${menuPositionClass} top-[calc(100%+6px)] z-50 ${menuMinWidthClassName} overflow-hidden rounded-lg border p-1.5`}
          >
            {menuContent}
          </div>
        ))}
    </div>
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
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="m4.5 10.5 3.2 3.2 7.8-7.8"
      />
    </svg>
  );
}

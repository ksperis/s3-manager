/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import TopbarControlTrigger from "./TopbarControlTrigger";

export type TopbarDropdownOption = {
  value: string;
  label: string;
  description?: string;
  title?: string;
  icon?: ReactNode;
};

type TopbarDropdownSelectProps = {
  value: string;
  options: TopbarDropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  align?: "left" | "right";
  widthClassName?: string;
  menuMinWidthClassName?: string;
  icon?: ReactNode;
  triggerLabel?: string;
  compactOnNarrow?: boolean;
  openInPortal?: boolean;
  triggerMode?: "icon" | "icon_label";
};

export default function TopbarDropdownSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Select",
  title,
  disabled = false,
  align = "left",
  widthClassName = "w-56",
  menuMinWidthClassName = "min-w-full",
  icon,
  triggerLabel,
  compactOnNarrow = false,
  openInPortal = true,
  triggerMode = "icon_label",
}: TopbarDropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);
  const selectedIndex = useMemo(() => options.findIndex((option) => option.value === value), [options, value]);
  const listboxId = useId();
  const menuPositionClass = align === "right" ? "right-0" : "left-0";
  const iconOnly = triggerMode === "icon";

  const closeMenuAndFocusTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const activateByIndex = (index: number) => {
    if (index < 0 || index >= options.length) return;
    const option = options[index];
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
    if (!open) return;
    const nextIndex = selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1;
    setActiveIndex(nextIndex);
    // Focus listbox after mount for immediate keyboard navigation.
    requestAnimationFrame(() => {
      listboxRef.current?.focus();
    });
  }, [open, options.length, selectedIndex]);

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
    if (options.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current < 0 ? 0 : (current + 1) % options.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeIndex >= 0) activateByIndex(activeIndex);
    }
  };

  return (
    <div ref={rootRef} className={`relative shrink-0 ${widthClassName}`}>
      <TopbarControlTrigger
        buttonRef={triggerRef}
        mode={triggerMode}
        label={triggerLabel ?? ariaLabel}
        value={selectedOption?.label ?? placeholder}
        icon={icon}
        open={open}
        disabled={disabled}
        ariaLabel={ariaLabel}
        title={title}
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
            ? `inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-2 min-[560px]:px-3 text-left shadow-sm transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-500 dark:focus-visible:ring-offset-slate-900 ${open ? "border-primary/70" : ""}`
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
            className={`${menuMinWidthClassName} overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900`}
          >
            <div ref={menuSurfaceRef}>
              <div
                id={listboxId}
                ref={listboxRef}
                className="max-h-72 overflow-y-auto focus:outline-none"
                role="listbox"
                tabIndex={0}
                aria-label={ariaLabel}
                aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
                onKeyDown={handleListboxKeyDown}
              >
                {options.map((option, index) => {
                  const active = option.value === value;
                  const highlighted = options[activeIndex]?.value === option.value;
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
                      onClick={() => {
                        setOpen(false);
                        if (option.value !== value) onChange(option.value);
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
                      {option.icon && (
                        <span className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-300">{option.icon}</span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate ui-caption font-semibold">{option.label}</span>
                        {option.description && (
                          <span className="block truncate ui-caption text-slate-500 dark:text-slate-400">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </AnchoredPortalMenu>
        ) : (
          <div
            ref={menuSurfaceRef}
            className={`absolute ${menuPositionClass} top-[calc(100%+8px)] z-50 ${menuMinWidthClassName} overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900`}
          >
            <div
              id={listboxId}
              ref={listboxRef}
              className="max-h-72 overflow-y-auto focus:outline-none"
              role="listbox"
              tabIndex={0}
              aria-label={ariaLabel}
              aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
              onKeyDown={handleListboxKeyDown}
            >
              {options.map((option, index) => {
                const active = option.value === value;
                const highlighted = options[activeIndex]?.value === option.value;
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
                    onClick={() => {
                      setOpen(false);
                      if (option.value !== value) onChange(option.value);
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
                    {option.icon && <span className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-300">{option.icon}</span>}
                    <span className="min-w-0">
                      <span className="block truncate ui-caption font-semibold">{option.label}</span>
                      {option.description && (
                        <span className="block truncate ui-caption text-slate-500 dark:text-slate-400">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m4.5 10.5 3.2 3.2 7.8-7.8" />
    </svg>
  );
}

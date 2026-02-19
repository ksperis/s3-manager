/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

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
  icon?: ReactNode;
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
  icon,
}: TopbarDropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);
  const menuPositionClass = align === "right" ? "right-0" : "left-0";

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div ref={rootRef} className={`relative ${widthClassName}`}>
      <button
        type="button"
        title={title}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 text-left ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-primary-500 dark:focus-visible:ring-offset-slate-900 ${
          open ? "border-primary/70" : ""
        }`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? placeholder}</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 text-slate-500 transition-transform dark:text-slate-300 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className={`absolute ${menuPositionClass} top-[calc(100%+8px)] z-50 min-w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900`}>
          <div className="max-h-72 overflow-y-auto" role="listbox" aria-label={ariaLabel}>
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value || "__empty"}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={option.title}
                  onClick={() => {
                    setOpen(false);
                    if (option.value !== value) onChange(option.value);
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition ${
                    active
                      ? "bg-primary-50 text-primary-900 dark:bg-primary-900/30 dark:text-primary-100"
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
      )}
    </div>
  );
}

function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m5 7 5 6 5-6" />
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

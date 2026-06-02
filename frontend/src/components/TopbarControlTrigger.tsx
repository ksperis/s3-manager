/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type Ref } from "react";

type TopbarControlTriggerProps = {
  mode: "icon" | "icon_label";
  label: string;
  value: string;
  icon?: ReactNode;
  open?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  rightAddon?: ReactNode;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  className?: string;
  iconModeClassName?: string;
  iconSlotClassName?: string;
  buttonRef?: Ref<HTMLButtonElement>;
};

export default function TopbarControlTrigger({
  mode,
  label,
  value,
  icon,
  open = false,
  disabled = false,
  ariaLabel,
  title,
  rightAddon,
  onClick,
  onKeyDown,
  className,
  iconModeClassName,
  iconSlotClassName,
  buttonRef,
}: TopbarControlTriggerProps) {
  const iconOnly = mode === "icon";

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={
        className ??
        `inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white text-left shadow-sm transition hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-primary-400 dark:focus-visible:ring-offset-slate-900 ${
          iconOnly ? iconModeClassName ?? "w-8 justify-center px-0" : "w-full px-2"
        } ${open ? "border-blue-400" : ""}`
      }
    >
      {iconOnly ? (
        <>
          <span className="text-slate-500 dark:text-slate-300">{icon}</span>
          <span className="sr-only">{value}</span>
        </>
      ) : (
        <>
          <span
            className={
              iconSlotClassName ??
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-100"
            }
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400">{label}</span>
            <span
              data-slot="topbar-trigger-value"
              className="mt-px block min-w-0 truncate text-[12px] font-semibold leading-4 text-slate-950 dark:text-slate-100"
            >
              {value}
            </span>
          </div>
          {rightAddon ? (
            <div
              data-slot="topbar-trigger-addon"
              className="ml-1.5 flex min-w-0 max-w-[12rem] shrink-0 items-center overflow-hidden"
            >
              {rightAddon}
            </div>
          ) : null}
          <ChevronDownIcon
            className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-slate-300 ${open ? "rotate-180" : ""}`}
          />
        </>
      )}
    </button>
  );
}

function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m5 7 5 6 5-6" />
    </svg>
  );
}

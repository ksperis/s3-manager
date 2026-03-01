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
        `inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200/80 bg-white text-left shadow-sm transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-500 dark:focus-visible:ring-offset-slate-900 ${
          iconOnly ? iconModeClassName ?? "w-9 justify-center px-0" : "w-full px-2"
        } ${open ? "border-primary/70" : ""}`
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
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-100"
            }
          >
            {icon}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate ui-caption uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
            <span className="block truncate ui-caption font-semibold text-slate-700 dark:text-slate-100">{value}</span>
          </span>
          {rightAddon}
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

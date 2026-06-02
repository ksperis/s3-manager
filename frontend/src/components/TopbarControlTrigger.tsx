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
        `shell-control inline-flex items-center rounded-lg border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${
          iconOnly ? iconModeClassName ?? "h-9 w-9 justify-center px-0" : "h-10 w-full gap-2.5 px-3"
        } ${open ? "shell-control-active" : ""}`
      }
    >
      {iconOnly ? (
        <>
          <span className="shell-icon-muted">{icon}</span>
          <span className="sr-only">{value}</span>
        </>
      ) : (
        <>
          {icon ? (
            <span
              className={
                iconSlotClassName ??
                "shell-menu-muted shell-icon-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
              }
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0 flex-1 leading-tight">
            <span className="shell-muted-text block truncate text-[10px] font-medium">{label}</span>
            <span
              data-slot="topbar-trigger-value"
              className="mt-0.5 block min-w-0 truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]"
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
            className={`shell-icon-muted h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
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

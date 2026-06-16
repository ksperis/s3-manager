/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useRef } from "react";
import type { ReactNode, RefObject } from "react";
import PropertySummaryChip from "../../components/PropertySummaryChip";
import type { PropertySummaryTone } from "../../components/PropertySummaryChip";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";

export type BucketFeatureTooltipState =
  | { status: "loading" }
  | { status: "ready"; lines: string[] }
  | { status: "error"; message: string };

const toAnchorRef = (node: HTMLElement | null): RefObject<HTMLElement | null> => ({ current: node });

function SpinnerIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className} animate-spin`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" className="opacity-30" stroke="currentColor" strokeWidth="2.5" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function BucketSummaryTooltip({
  label,
  tooltip,
  open,
  onOpen,
  onClose,
  cacheKey,
  children,
  loadingLabel = "Loading configuration...",
  buttonClassName = "inline-flex cursor-default",
}: {
  label: string;
  tooltip?: BucketFeatureTooltipState;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  cacheKey: string;
  children: ReactNode;
  loadingLabel?: string;
  buttonClassName?: string;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="relative inline-flex max-w-full" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        ref={anchorRef}
        type="button"
        className={buttonClassName}
        onFocus={onOpen}
        onBlur={onClose}
        aria-label={`${label} details`}
      >
        {children}
      </button>
      <AnchoredPortalMenu
        open={open}
        anchorRef={toAnchorRef(anchorRef.current)}
        placement="bottom-start"
        offset={4}
        minWidth={288}
        className="pointer-events-none w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        <div>
          <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">{label}</p>
          {(!tooltip || tooltip.status === "loading") && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 ui-caption text-slate-500 dark:text-slate-300">
              <SpinnerIcon />
              {loadingLabel}
            </div>
          )}
          {tooltip?.status === "error" && (
            <p className="mt-1.5 ui-caption text-rose-600 dark:text-rose-300">{tooltip.message}</p>
          )}
          {tooltip?.status === "ready" && (
            <div className="mt-1.5 space-y-1">
              {tooltip.lines.map((line, index) => (
                <p key={`${cacheKey}:${index}`} className="ui-caption text-slate-600 dark:text-slate-300">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      </AnchoredPortalMenu>
    </div>
  );
}

export function BucketFeatureSummaryChip({
  label,
  state,
  tone,
  tooltip,
  open,
  onOpen,
  onClose,
  cacheKey,
}: {
  label: string;
  state: string;
  tone: PropertySummaryTone;
  tooltip?: BucketFeatureTooltipState;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  cacheKey: string;
}) {
  return (
    <BucketSummaryTooltip
      label={label}
      tooltip={tooltip}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      cacheKey={cacheKey}
    >
      <PropertySummaryChip compact state={state} tone={tone} />
    </BucketSummaryTooltip>
  );
}

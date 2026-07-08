/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { cx, uiButtonBaseClass, uiButtonVariants, uiMutedTextClass } from "./ui/styles";

export type ActiveFilterBarItem = {
  id: string;
  label: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
};

type ActiveFiltersBarProps = {
  items: ActiveFilterBarItem[];
  onClearAll: () => void;
  label?: ReactNode;
  clearLabel?: ReactNode;
  className?: string;
};

export default function ActiveFiltersBar({
  items,
  onClearAll,
  label = "Active filters:",
  clearLabel = "Clear all",
  className,
}: ActiveFiltersBarProps) {
  if (items.length === 0) return null;

  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      <span className={cx("shrink-0 ui-caption font-semibold", uiMutedTextClass)}>{label}</span>
      {items.map((item) => (
        <span
          key={item.id}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 ui-caption font-semibold text-primary-700 dark:border-primary-400/35 dark:bg-primary-500/15 dark:text-primary-100"
        >
          <span className="min-w-0 truncate">{item.label}</span>
          {item.onRemove ? (
            <button
              type="button"
              onClick={item.onRemove}
              className="rounded-full px-1 leading-none opacity-75 transition hover:bg-primary/20 hover:opacity-100 dark:hover:bg-primary-400/20"
              title={item.removeLabel}
              aria-label={item.removeLabel ?? "Remove filter"}
            >
              x
            </button>
          ) : null}
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className={cx(uiButtonBaseClass, uiButtonVariants.danger, "h-7 rounded-md px-2 py-1 ui-caption")}
      >
        {clearLabel}
      </button>
    </div>
  );
}

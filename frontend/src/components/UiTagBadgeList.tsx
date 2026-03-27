/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiBadge from "./ui/UiBadge";
import { cx } from "./ui/styles";
import { getTagColorOption } from "../utils/tagPalette";
import type { UiTagItem } from "../utils/uiTags";

type UiTagBadgeListProps = {
  items: UiTagItem[];
  className?: string;
  maxVisible?: number;
  emptyLabel?: string | null;
  variant?: "default" | "listing-compact";
  layout?: "wrap" | "inline-compact";
};

export default function UiTagBadgeList({
  items,
  className,
  maxVisible,
  emptyLabel = null,
  variant = "default",
  layout = "wrap",
}: UiTagBadgeListProps) {
  if (items.length === 0) {
    if (!emptyLabel) return null;
    return <span className="ui-caption text-slate-400 dark:text-slate-500">{emptyLabel}</span>;
  }

  const visibleItems = typeof maxVisible === "number" ? items.slice(0, Math.max(0, maxVisible)) : items;
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const compact = variant === "listing-compact";
  const containerClasses =
    layout === "inline-compact"
      ? "flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
      : compact
        ? "flex min-w-0 flex-wrap items-center gap-1"
        : "flex min-w-0 flex-wrap items-center gap-1";
  const badgeClasses = compact
    ? "max-w-full truncate px-2 py-0.5 text-[10px]"
    : "max-w-full truncate px-2 py-0.5 text-[10px]";

  return (
    <div className={cx(containerClasses, className)}>
      {visibleItems.map((item, index) => (
        <UiBadge
          key={item.key || `${item.label}-${index}`}
          disableToneStyles
          title={item.title ?? item.label}
          className={cx(badgeClasses, getTagColorOption(item.color_key).badgeClassName)}
        >
          <span className="truncate">
            {item.label}
          </span>
        </UiBadge>
      ))}
      {hiddenCount > 0 && (
        <UiBadge
          tone="neutral"
          className={badgeClasses}
        >
          +{hiddenCount}
        </UiBadge>
      )}
    </div>
  );
}

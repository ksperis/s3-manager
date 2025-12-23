/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type SortDirection = "asc" | "desc";

type SortableHeaderProps<T extends string | null = string> = {
  label: string;
  field?: T | null;
  activeField?: T | null;
  direction?: SortDirection;
  align?: "left" | "right";
  onSort?: (field: NonNullable<T>) => void;
};

export default function SortableHeader<T extends string | null = string>({
  label,
  field,
  activeField,
  direction = "asc",
  align = "left",
  onSort,
}: SortableHeaderProps<T>) {
  const isSortable = Boolean(field && onSort);
  const isActive = isSortable && field === activeField;
  const alignClass = align === "right" ? "text-right" : "text-left";

  if (!isSortable) {
    return (
      <th className={`px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${alignClass}`}>
        <div className={`flex items-center ${align === "right" ? "justify-end" : "gap-1"}`}>{label}</div>
      </th>
    );
  }

  return (
    <th className={`px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${alignClass}`}>
      <button
        type="button"
        onClick={() => field && onSort?.(field as NonNullable<T>)}
        className={`flex w-full items-center ${align === "right" ? "justify-end" : "gap-1"} text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100`}
      >
        <span>{label}</span>
        {isActive && <span className="text-[10px]">{direction === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

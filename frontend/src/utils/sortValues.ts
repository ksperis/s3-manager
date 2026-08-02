/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type SortDirection = "asc" | "desc";
export type SortableValue = string | number | boolean | null | undefined;
export type SortableField<T> = Extract<
  {
    [K in keyof T]-?: T[K] extends SortableValue ? K : never;
  }[keyof T],
  string
>;

const compareDefinedValues = (left: Exclude<SortableValue, null | undefined>, right: Exclude<SortableValue, null | undefined>) => {
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const diff = leftNumber - rightNumber;
  if (!Number.isNaN(diff)) {
    return diff;
  }

  return String(left).localeCompare(String(right));
};

export const compareNullableValues = (left: SortableValue, right: SortableValue, direction: SortDirection) => {
  if (left == null && right == null) return 0;
  if (left == null) return direction === "asc" ? 1 : -1;
  if (right == null) return direction === "asc" ? -1 : 1;

  const result = compareDefinedValues(left, right);
  return direction === "asc" ? result : -result;
};

export const compareByNullableField = <T, K extends SortableField<T>>(
  left: T,
  right: T,
  field: K,
  direction: SortDirection
) => compareNullableValues(left[field] as SortableValue, right[field] as SortableValue, direction);

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY =
  "browser:embedded-object-columns:v1";
export const BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY =
  "browser:embedded-object-column-widths:v1";

const normalizeColumns = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
};

const normalizeColumnWidths = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce<Record<string, number>>(
    (acc, [key, entry]) => {
      if (
        typeof key !== "string" ||
        key.trim().length === 0 ||
        typeof entry !== "number" ||
        !Number.isFinite(entry) ||
        entry <= 0
      ) {
        return acc;
      }
      acc[key] = Math.round(entry);
      return acc;
    },
    {},
  );
};

export const readBrowserEmbeddedObjectColumns = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(
      BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY,
    );
    if (!raw) return [];
    return normalizeColumns(JSON.parse(raw));
  } catch {
    return [];
  }
};

export const writeBrowserEmbeddedObjectColumns = (columns: string[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY,
      JSON.stringify(normalizeColumns(columns)),
    );
  } catch {
    // Ignore storage write failures (private mode / quota).
  }
};

export const readBrowserEmbeddedObjectColumnWidths = (): Record<
  string,
  number
> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(
      BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY,
    );
    if (!raw) return {};
    return normalizeColumnWidths(JSON.parse(raw));
  } catch {
    return {};
  }
};

export const writeBrowserEmbeddedObjectColumnWidths = (
  widths: Record<string, number>,
) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY,
      JSON.stringify(normalizeColumnWidths(widths)),
    );
  } catch {
    // Ignore storage write failures (private mode / quota).
  }
};

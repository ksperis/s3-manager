/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { CLIENT_STORAGE_KEYS, readClientJson, writeClientJson } from "../../utils/clientStorage";

export const BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY =
  CLIENT_STORAGE_KEYS.browserEmbeddedObjectColumns;
export const BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY =
  CLIENT_STORAGE_KEYS.browserEmbeddedObjectColumnWidths;

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
  return normalizeColumns(readClientJson<unknown>(BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY));
};

export const writeBrowserEmbeddedObjectColumns = (columns: string[]) => {
  if (typeof window === "undefined") return;
  writeClientJson(BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY, normalizeColumns(columns));
};

export const readBrowserEmbeddedObjectColumnWidths = (): Record<
  string,
  number
> => {
  if (typeof window === "undefined") return {};
  return normalizeColumnWidths(readClientJson<unknown>(BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY));
};

export const writeBrowserEmbeddedObjectColumnWidths = (
  widths: Record<string, number>,
) => {
  if (typeof window === "undefined") return;
  writeClientJson(BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY, normalizeColumnWidths(widths));
};

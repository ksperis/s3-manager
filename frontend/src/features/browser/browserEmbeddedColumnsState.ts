/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY =
  "browser:embedded-object-columns:v1";

const normalizeColumns = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
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

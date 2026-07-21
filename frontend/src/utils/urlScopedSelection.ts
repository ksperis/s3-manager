/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

type ResolveUrlScopedSelectionOptions = {
  availableIds: readonly string[];
  urlValue: string | null;
  currentValue: string | null;
  fallbackValues?: readonly (string | null | undefined)[];
};

/**
 * Resolve a selector without letting another tab's shared preference replace
 * the context already owned by this tab. A valid URL is authoritative; the
 * current mounted value comes next when an in-app link omits the query string.
 */
export function resolveUrlScopedSelection({
  availableIds,
  urlValue,
  currentValue,
  fallbackValues = [],
}: ResolveUrlScopedSelectionOptions): string | null {
  const available = new Set(availableIds);
  const candidates = [urlValue, currentValue, ...fallbackValues];
  for (const candidate of candidates) {
    if (candidate && available.has(candidate)) {
      return candidate;
    }
  }
  return availableIds[0] ?? null;
}

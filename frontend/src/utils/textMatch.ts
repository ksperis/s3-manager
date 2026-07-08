/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type TextMatchMode = "contains" | "exact";

export function matchesExactTextCandidate(candidates: Array<string | number | null | undefined>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return candidates.some((candidate) => String(candidate ?? "").trim().toLowerCase() === needle);
}

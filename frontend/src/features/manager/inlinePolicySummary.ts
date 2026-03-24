/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export function summarizeInlinePolicyDocument(document: Record<string, unknown> | null | undefined): string {
  if (!document || Object.keys(document).length === 0) {
    return "Empty JSON document";
  }

  const topLevelKeys = Object.keys(document).length;
  const statements = Array.isArray((document as { Statement?: unknown }).Statement)
    ? ((document as { Statement: unknown[] }).Statement?.length ?? 0)
    : null;

  const parts: string[] = [];
  if (statements !== null) {
    parts.push(`${statements} statement${statements === 1 ? "" : "s"}`);
  }
  parts.push(`${topLevelKeys} top-level ${topLevelKeys === 1 ? "field" : "fields"}`);

  return parts.join(" • ");
}

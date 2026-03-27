/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import {
  listAdminTagDefinitions,
  listPrivateConnectionTagDefinitions,
  type TagCatalogDomain,
  type TagDefinitionSummary,
} from "../api/tags";
import { extractApiError } from "../utils/apiError";

type TagCatalogScope =
  | { kind: "admin"; domain: TagCatalogDomain }
  | { kind: "private" };

export function useTagCatalog(scope: TagCatalogScope | null, enabled = true) {
  const [catalog, setCatalog] = useState<TagDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeKind = scope?.kind ?? null;
  const scopeDomain = scope?.kind === "admin" ? scope.domain : null;

  const load = useCallback(async () => {
    if (!enabled || !scopeKind) return;
    setLoading(true);
    setError(null);
    try {
      const items =
        scopeKind === "admin"
          ? await listAdminTagDefinitions(scopeDomain as TagCatalogDomain)
          : await listPrivateConnectionTagDefinitions();
      setCatalog(items);
    } catch (err) {
      setError(extractApiError(err, "Unable to load tag catalog."));
    } finally {
      setLoading(false);
    }
  }, [enabled, scopeDomain, scopeKind]);

  useEffect(() => {
    void load();
  }, [load]);

  return { catalog, loading, error, reload: load };
}

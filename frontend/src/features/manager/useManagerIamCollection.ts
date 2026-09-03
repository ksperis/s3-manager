/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import { extractApiError } from "../../utils/apiError";

type ListManagerIamItems<Item> = (accountId: S3AccountSelector) => Promise<Item[]>;

export function useManagerIamCollection<Item>(listItems: ListManagerIamItems<Item>) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (accountId: S3AccountSelector) => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listItems(accountId));
    } catch (loadError) {
      setError(extractApiError(loadError, "Unexpected error"));
    } finally {
      setLoading(false);
    }
  }, [listItems]);

  const loadRelated = useCallback(async <RelatedItem>(
    accountId: S3AccountSelector,
    listRelatedItems: ListManagerIamItems<RelatedItem>,
    setRelatedItems: (items: RelatedItem[]) => void,
  ) => {
    try {
      setRelatedItems(await listRelatedItems(accountId));
    } catch (loadError) {
      setError(extractApiError(loadError, "Unexpected error"));
    }
  }, []);

  return { error, items, load, loadRelated, loading, setError, setItems, setLoading };
}

/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { TextMatchMode } from "./advancedFilterShared";

type StringState<State> = {
  [Field in keyof State]: string;
};

type CephAdminFilterRemoveAction<Field extends PropertyKey> =
  | { type: "quick" }
  | { type: "advanced"; field: Field };

type UseCephAdminListingFiltersOptions<State> = {
  endpointId: number | null;
  defaultAdvancedFilter: State;
  setPage: Dispatch<SetStateAction<number>>;
};

export function useCephAdminListingFilters<State extends StringState<State>>({
  endpointId,
  defaultAdvancedFilter,
  setPage,
}: UseCephAdminListingFiltersOptions<State>) {
  const [filter, setFilter] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState<State>(defaultAdvancedFilter);
  const [advancedApplied, setAdvancedApplied] = useState<State | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchValue(filter.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [filter, setPage]);

  useEffect(() => {
    setPage(1);
    setFilter("");
    setSearchValue("");
    setQuickFilterMode("contains");
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
  }, [defaultAdvancedFilter, endpointId, setPage]);

  const updateAdvancedField = useCallback(<Field extends keyof State>(field: Field, value: State[Field]) => {
    setAdvancedDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const applyAdvancedFilter = useCallback(() => {
    setAdvancedApplied(advancedDraft);
    setShowAdvancedFilter(false);
    setPage(1);
  }, [advancedDraft, setPage]);

  const resetAdvancedFilter = useCallback(() => {
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setPage(1);
  }, [defaultAdvancedFilter, setPage]);

  const resetAllFilters = useCallback(() => {
    setFilter("");
    setSearchValue("");
    setQuickFilterMode("contains");
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setShowAdvancedFilter(false);
    setPage(1);
  }, [defaultAdvancedFilter, setPage]);

  const clearAdvancedField = useCallback(
    (field: keyof State) => {
      const defaultValue = defaultAdvancedFilter[field];
      setAdvancedDraft((current) => ({ ...current, [field]: defaultValue }));
      setAdvancedApplied((current) => (current ? { ...current, [field]: defaultValue } : current));
      setPage(1);
    },
    [defaultAdvancedFilter, setPage]
  );

  const removeActiveFilterItem = useCallback(
    (action: CephAdminFilterRemoveAction<keyof State>) => {
      if (action.type === "quick") {
        setFilter("");
        setSearchValue("");
        setPage(1);
        return;
      }
      clearAdvancedField(action.field);
    },
    [clearAdvancedField, setPage]
  );

  return {
    filter,
    setFilter,
    searchValue,
    quickFilterMode,
    setQuickFilterMode,
    showAdvancedFilter,
    setShowAdvancedFilter,
    advancedDraft,
    advancedApplied,
    updateAdvancedField,
    applyAdvancedFilter,
    resetAdvancedFilter,
    resetAllFilters,
    removeActiveFilterItem,
  };
}

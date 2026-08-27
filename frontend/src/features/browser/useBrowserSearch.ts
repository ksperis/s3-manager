/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

type BrowserSearchScope = "prefix" | "bucket";
type BrowserSearchTypeFilter = "all" | "file" | "folder";

type UseBrowserSearchOptions = {
  isPortalProfile: boolean;
  scopeKey: string;
};

export function useBrowserSearch({
  isPortalProfile,
  scopeKey,
}: UseBrowserSearchOptions) {
  const [filter, setFilter] = useState("");
  const [showSearchOptionsMenu, setShowSearchOptionsMenu] = useState(false);
  const [searchScope, setSearchScope] =
    useState<BrowserSearchScope>("prefix");
  const [searchRecursive, setSearchRecursive] = useState(false);
  const [searchExactMatch, setSearchExactMatch] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [typeFilter, setTypeFilter] =
    useState<BrowserSearchTypeFilter>("all");
  const [storageFilter, setStorageFilter] = useState("all");

  const hasSearchQuery = filter.trim().length > 0;
  const isSearchingInWholeBucket =
    hasSearchQuery && searchScope === "bucket";
  const hasAdvancedSearchOptionsActive =
    !isPortalProfile &&
    (searchScope !== "prefix" ||
      searchRecursive ||
      searchExactMatch ||
      searchCaseSensitive ||
      typeFilter !== "all" ||
      storageFilter !== "all");
  const hasActiveSearchFilters =
    hasSearchQuery || hasAdvancedSearchOptionsActive;
  const searchResultScopeLabel = hasSearchQuery
    ? isSearchingInWholeBucket
      ? "Whole bucket"
      : searchRecursive
        ? "Current path + subfolders"
        : "Current path"
    : "Filters applied";
  const activeSearchStatusChips = [
    hasSearchQuery ? { label: "Query", value: filter } : null,
    hasSearchQuery
      ? { label: "Scope", value: searchResultScopeLabel }
      : null,
    searchRecursive && !isSearchingInWholeBucket
      ? { label: "Mode", value: "Recursive" }
      : null,
    searchExactMatch ? { label: "Match", value: "Exact" } : null,
    searchCaseSensitive ? { label: "Case", value: "Sensitive" } : null,
    typeFilter !== "all" ? { label: "Type", value: typeFilter } : null,
    storageFilter !== "all"
      ? { label: "Storage", value: storageFilter }
      : null,
  ].filter((entry): entry is { label: string; value: string } =>
    Boolean(entry),
  );

  const changeSearchScope = useCallback((scope: BrowserSearchScope) => {
    setSearchScope(scope);
    if (scope === "bucket") {
      setSearchRecursive(false);
    }
  }, []);

  const clearSearchFilters = useCallback(() => {
    setFilter("");
    setSearchScope("prefix");
    setSearchRecursive(false);
    setSearchExactMatch(false);
    setSearchCaseSensitive(false);
    setTypeFilter("all");
    setStorageFilter("all");
  }, []);

  const toggleSearchOptionsMenu = useCallback(() => {
    setShowSearchOptionsMenu((current) => !current);
  }, []);

  useEffect(() => {
    setShowSearchOptionsMenu(false);
  }, [scopeKey]);

  useEffect(() => {
    if (isPortalProfile) {
      setShowSearchOptionsMenu(false);
      if (searchScope !== "prefix") setSearchScope("prefix");
      if (searchRecursive) setSearchRecursive(false);
      if (searchExactMatch) setSearchExactMatch(false);
      if (searchCaseSensitive) setSearchCaseSensitive(false);
      if (typeFilter !== "all") setTypeFilter("all");
      if (storageFilter !== "all") setStorageFilter("all");
      return;
    }
    if (hasSearchQuery) return;
    if (searchScope !== "prefix") setSearchScope("prefix");
    if (searchRecursive) setSearchRecursive(false);
    if (searchExactMatch) setSearchExactMatch(false);
    if (searchCaseSensitive) setSearchCaseSensitive(false);
  }, [
    hasSearchQuery,
    isPortalProfile,
    searchCaseSensitive,
    searchExactMatch,
    searchRecursive,
    searchScope,
    storageFilter,
    typeFilter,
  ]);

  return {
    activeSearchStatusChips,
    changeSearchScope,
    clearSearchFilters,
    filter,
    hasActiveSearchFilters,
    hasAdvancedSearchOptionsActive,
    hasSearchQuery,
    isSearchingInWholeBucket,
    searchCaseSensitive,
    searchExactMatch,
    searchRecursive,
    searchScope,
    setFilter,
    setSearchCaseSensitive,
    setSearchExactMatch,
    setSearchRecursive,
    setShowSearchOptionsMenu,
    setStorageFilter,
    setTypeFilter,
    showSearchOptionsMenu,
    storageFilter,
    typeFilter,
    toggleSearchOptionsMenu,
  };
}

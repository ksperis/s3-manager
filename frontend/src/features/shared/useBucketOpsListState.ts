/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  defaultAdvancedFilter,
  stripUnsupportedAdvancedFeatureFilters,
  type AdvancedFilterState,
  type FeatureKey,
} from "./bucketOpsAdvancedFilterModel";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  FEATURE_DETAIL_COLUMN_OPTIONS,
  loadBucketListState,
  loadVisibleColumns,
  persistBucketListState,
  persistVisibleColumns,
  type BucketListState,
  type ColumnId,
} from "./bucketOpsListState";

type MutableBucketOpsListState = BucketListState & {
  advancedDraft: AdvancedFilterState;
  filterValue: string;
  visibleColumns: ColumnId[];
};

type ScopedBucketOpsListState = MutableBucketOpsListState & {
  scopeIdentity: string;
};

type UseBucketOpsListStateOptions = {
  bucketsStateStorageKey: string;
  columnsStorageKey: string;
  defaultVisibleColumns: ColumnId[];
  featureSupport: Record<FeatureKey, boolean>;
  isStorageOps: boolean;
  ownerQueryFilter: string | null;
  selectedScopeId: number | null;
  snsFeatureEnabled: boolean;
  sseFeatureEnabled: boolean;
  staticWebsiteFeatureEnabled: boolean;
};

type RestoreBucketOpsListStateOptions = Pick<
  UseBucketOpsListStateOptions,
  | "bucketsStateStorageKey"
  | "columnsStorageKey"
  | "defaultVisibleColumns"
  | "isStorageOps"
  | "ownerQueryFilter"
  | "selectedScopeId"
>;

function createScopeIdentity({
  bucketsStateStorageKey,
  columnsStorageKey,
  defaultVisibleColumns,
  isStorageOps,
  ownerQueryFilter,
  selectedScopeId,
}: RestoreBucketOpsListStateOptions): string {
  return JSON.stringify([
    bucketsStateStorageKey,
    columnsStorageKey,
    defaultVisibleColumns,
    isStorageOps,
    ownerQueryFilter,
    selectedScopeId,
  ]);
}

function restoreListState(
  options: RestoreBucketOpsListStateOptions,
  scopeIdentity: string,
): ScopedBucketOpsListState {
  const stored = loadBucketListState(
    options.bucketsStateStorageKey,
    options.selectedScopeId,
  );
  const ownerPrefill: AdvancedFilterState | null = options.ownerQueryFilter
    ? {
        ...defaultAdvancedFilter,
        owner: options.ownerQueryFilter,
        ownerMatchMode: "exact",
      }
    : null;
  const advancedApplied = ownerPrefill ?? stored?.advancedApplied ?? null;
  const filter = options.ownerQueryFilter ? "" : stored?.filter ?? "";

  return {
    scopeIdentity,
    filter,
    filterValue: filter.trim(),
    quickFilterMode: options.ownerQueryFilter
      ? "contains"
      : stored?.quickFilterMode ?? "contains",
    advancedApplied,
    advancedDraft: advancedApplied ?? defaultAdvancedFilter,
    tagFilters: options.ownerQueryFilter ? [] : stored?.tagFilters ?? [],
    tagFilterMode: options.ownerQueryFilter
      ? "any"
      : stored?.tagFilterMode ?? "any",
    page: options.ownerQueryFilter ? 1 : stored?.page ?? 1,
    pageSize: stored?.pageSize ?? DEFAULT_PAGE_SIZE,
    sort: stored?.sort ?? DEFAULT_SORT,
    visibleColumns: loadVisibleColumns(
      options.columnsStorageKey,
      options.defaultVisibleColumns,
      options.isStorageOps,
    ),
  };
}

export function useBucketOpsListState(options: UseBucketOpsListStateOptions) {
  const restorationOptions = useMemo<RestoreBucketOpsListStateOptions>(
    () => ({
      bucketsStateStorageKey: options.bucketsStateStorageKey,
      columnsStorageKey: options.columnsStorageKey,
      defaultVisibleColumns: options.defaultVisibleColumns,
      isStorageOps: options.isStorageOps,
      ownerQueryFilter: options.ownerQueryFilter,
      selectedScopeId: options.selectedScopeId,
    }),
    [
      options.bucketsStateStorageKey,
      options.columnsStorageKey,
      options.defaultVisibleColumns,
      options.isStorageOps,
      options.ownerQueryFilter,
      options.selectedScopeId,
    ],
  );
  const scopeIdentity = useMemo(
    () => createScopeIdentity(restorationOptions),
    [restorationOptions],
  );
  const [state, setState] = useState<ScopedBucketOpsListState>(() =>
    restoreListState(restorationOptions, scopeIdentity),
  );
  const restoredFilterRef = useRef<string | null>(state.filter);

  useEffect(() => {
    if (state.scopeIdentity === scopeIdentity) return;
    const restored = restoreListState(restorationOptions, scopeIdentity);
    restoredFilterRef.current = restored.filter;
    setState(restored);
  }, [restorationOptions, scopeIdentity, state.scopeIdentity]);

  const setters = useMemo(() => {
    const createSetter = <Key extends keyof MutableBucketOpsListState>(
      field: Key,
    ): Dispatch<SetStateAction<MutableBucketOpsListState[Key]>> =>
      (action) => {
        setState((previous) => {
          const current = previous[field];
          const value =
            typeof action === "function"
              ? (
                  action as (
                    previousValue: MutableBucketOpsListState[Key],
                  ) => MutableBucketOpsListState[Key]
                )(current)
              : action;
          return Object.is(value, current)
            ? previous
            : { ...previous, [field]: value };
        });
      };

    return {
      setAdvancedApplied: createSetter("advancedApplied"),
      setAdvancedDraft: createSetter("advancedDraft"),
      setFilter: createSetter("filter"),
      setFilterValue: createSetter("filterValue"),
      setPage: createSetter("page"),
      setPageSize: createSetter("pageSize"),
      setQuickFilterMode: createSetter("quickFilterMode"),
      setSort: createSetter("sort"),
      setTagFilterMode: createSetter("tagFilterMode"),
      setTagFilters: createSetter("tagFilters"),
      setVisibleColumns: createSetter("visibleColumns"),
    };
  }, []);

  useEffect(() => {
    const scheduledScopeIdentity = state.scopeIdentity;
    const handle = window.setTimeout(() => {
      setState((previous) => {
        if (previous.scopeIdentity !== scheduledScopeIdentity) return previous;
        const filterValue = previous.filter.trim();
        const keepRestoredPage = restoredFilterRef.current === previous.filter;
        restoredFilterRef.current = null;
        const page = keepRestoredPage ? previous.page : 1;
        if (previous.filterValue === filterValue && previous.page === page) {
          return previous;
        }
        return { ...previous, filterValue, page };
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [state.filter, state.scopeIdentity]);

  useEffect(() => {
    if (state.scopeIdentity !== scopeIdentity) return;
    persistVisibleColumns(options.columnsStorageKey, state.visibleColumns);
  }, [options.columnsStorageKey, scopeIdentity, state.scopeIdentity, state.visibleColumns]);

  const persistedState = useMemo(
    () => ({
      filter: state.filter,
      quickFilterMode: state.quickFilterMode,
      advancedApplied: state.advancedApplied,
      tagFilters: state.tagFilters,
      tagFilterMode: state.tagFilterMode,
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
    }),
    [
      state.advancedApplied,
      state.filter,
      state.page,
      state.pageSize,
      state.quickFilterMode,
      state.sort,
      state.tagFilterMode,
      state.tagFilters,
    ],
  );

  useEffect(() => {
    if (
      state.scopeIdentity !== scopeIdentity ||
      options.selectedScopeId === null
    ) {
      return;
    }
    persistBucketListState(
      options.bucketsStateStorageKey,
      options.selectedScopeId,
      persistedState,
    );
  }, [
    options.bucketsStateStorageKey,
    options.selectedScopeId,
    persistedState,
    scopeIdentity,
    state.scopeIdentity,
  ]);

  useEffect(() => {
    setState((previous) => {
      const advancedDraft = stripUnsupportedAdvancedFeatureFilters(
        previous.advancedDraft,
        options.featureSupport,
      );
      const advancedApplied = previous.advancedApplied
        ? stripUnsupportedAdvancedFeatureFilters(
            previous.advancedApplied,
            options.featureSupport,
          )
        : null;
      return advancedDraft === previous.advancedDraft &&
        advancedApplied === previous.advancedApplied
        ? previous
        : { ...previous, advancedDraft, advancedApplied };
    });
  }, [options.featureSupport, state.scopeIdentity]);

  useEffect(() => {
    setState((previous) => {
      const visibleColumns = previous.visibleColumns.filter((column) => {
        if (column === "static_website") {
          return options.staticWebsiteFeatureEnabled;
        }
        if (column === "notifications") return options.snsFeatureEnabled;
        if (column === "server_side_encryption") {
          return options.sseFeatureEnabled;
        }
        const detail = FEATURE_DETAIL_COLUMN_OPTIONS.find(
          (option) => option.id === column,
        );
        if (detail?.feature === "static_website") {
          return options.staticWebsiteFeatureEnabled;
        }
        if (detail?.feature === "notifications") {
          return options.snsFeatureEnabled;
        }
        if (detail?.feature === "server_side_encryption") {
          return options.sseFeatureEnabled;
        }
        return true;
      });
      return visibleColumns.length === previous.visibleColumns.length
        ? previous
        : { ...previous, visibleColumns };
    });
  }, [
    options.snsFeatureEnabled,
    options.sseFeatureEnabled,
    options.staticWebsiteFeatureEnabled,
    state.scopeIdentity,
  ]);

  const persistCurrentListState = useCallback(() => {
    if (
      state.scopeIdentity !== scopeIdentity ||
      options.selectedScopeId === null
    ) {
      return;
    }
    persistBucketListState(
      options.bucketsStateStorageKey,
      options.selectedScopeId,
      persistedState,
    );
  }, [
    options.bucketsStateStorageKey,
    options.selectedScopeId,
    persistedState,
    scopeIdentity,
    state.scopeIdentity,
  ]);

  return {
    advancedApplied: state.advancedApplied,
    advancedDraft: state.advancedDraft,
    filter: state.filter,
    filterValue: state.filterValue,
    page: state.page,
    pageSize: state.pageSize,
    persistCurrentListState,
    quickFilterMode: state.quickFilterMode,
    sort: state.sort,
    tagFilterMode: state.tagFilterMode,
    tagFilters: state.tagFilters,
    visibleColumns: state.visibleColumns,
    ...setters,
  };
}

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
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import {
  clearFeatureDetailField,
  type FeatureDetailFilterKey,
  type FeatureDetailFilters,
} from "../cephAdmin/filtering/bucketAdvancedFilter";
import { parseExactListInput } from "../cephAdmin/filtering/advancedFilterShared";
import {
  buildAdvancedFilterPayload,
  buildAdvancedFilterSecondarySectionState,
  defaultAdvancedFilter,
  hasAdvancedFilters,
  type ActiveFilterRemoveAction,
  type AdvancedFilterSecondarySectionId,
  type AdvancedFilterSecondarySectionState,
  type AdvancedFilterState,
  type AdvancedTextOrNumericField,
  type FeatureFilterState,
  type FeatureKey,
  type TextMatchMode,
} from "./bucketOpsAdvancedFilterModel";
import { buildBucketOpsAdvancedFilterUiProjection } from "./bucketOpsAdvancedFilterUiProjection";
import type { BucketListState } from "./bucketOpsListState";

type StateSetter<Value> = Dispatch<SetStateAction<Value>>;
type AdvancedFilterRemoveAction = Exclude<
  ActiveFilterRemoveAction,
  { type: "quick" | "tag_mode" | "tag" }
>;

function clearAdvancedFilterAction(
  state: AdvancedFilterState,
  action: AdvancedFilterRemoveAction,
): AdvancedFilterState {
  switch (action.type) {
    case "advanced_owner_scope":
      return { ...state, ownerNameScope: "any" };
    case "advanced_owner_suspended":
      return { ...state, ownerSuspended: "any" };
    case "advanced_context_ids":
      return { ...state, contextIds: [] };
    case "advanced_endpoint_names":
      return { ...state, endpointNames: [] };
    case "advanced_text":
    case "advanced_numeric":
      return { ...state, [action.field]: "" };
    case "advanced_feature_detail":
      return {
        ...state,
        featureDetails: clearFeatureDetailField(
          state.featureDetails,
          action.field,
        ),
      };
    case "advanced_feature":
      return {
        ...state,
        features: { ...state.features, [action.feature]: "any" },
      };
  }
}

type UseBucketOpsFilterControllerOptions = {
  advancedApplied: AdvancedFilterState | null;
  advancedDraft: AdvancedFilterState;
  featureSupport: Record<FeatureKey, boolean>;
  filter: string;
  filterValue: string;
  isStorageOps: boolean;
  quickFilterMode: TextMatchMode;
  setAdvancedApplied: StateSetter<AdvancedFilterState | null>;
  setAdvancedDraft: StateSetter<AdvancedFilterState>;
  setFilter: StateSetter<string>;
  setFilterValue: StateSetter<string>;
  setPage: StateSetter<number>;
  setQuickFilterMode: StateSetter<TextMatchMode>;
  setTagFilterMode: StateSetter<BucketListState["tagFilterMode"]>;
  setTagFilters: StateSetter<number[]>;
  usageFeatureEnabled: boolean;
};

export function useBucketOpsFilterController({
  advancedApplied,
  advancedDraft,
  featureSupport,
  filter,
  filterValue,
  isStorageOps,
  quickFilterMode,
  setAdvancedApplied,
  setAdvancedDraft,
  setFilter,
  setFilterValue,
  setPage,
  setQuickFilterMode,
  setTagFilterMode,
  setTagFilters,
  usageFeatureEnabled,
}: UseBucketOpsFilterControllerOptions) {
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [advancedFilterSecondarySections, setAdvancedFilterSecondarySections] =
    useState<AdvancedFilterSecondarySectionState>(() =>
      buildAdvancedFilterSecondarySectionState(),
    );
  const advancedFilterWasOpenRef = useRef(false);

  const quickFilterDraftParsed = useMemo(
    () => parseExactListInput(filter),
    [filter],
  );
  const quickFilterAppliedParsed = useMemo(
    () => parseExactListInput(filterValue),
    [filterValue],
  );
  const quickFilterDraftForcesExact =
    quickFilterDraftParsed.listProvided &&
    quickFilterDraftParsed.values.length > 0;
  const quickFilterAppliedForcesExact =
    quickFilterAppliedParsed.listProvided &&
    quickFilterAppliedParsed.values.length > 0;
  const quickFilterModeForDisplay: TextMatchMode = quickFilterDraftForcesExact
    ? "exact"
    : quickFilterMode;
  const effectiveQuickFilterMode: TextMatchMode =
    quickFilterAppliedForcesExact ? "exact" : quickFilterMode;
  const effectiveQuickSearchValue =
    effectiveQuickFilterMode === "contains" ? filterValue : "";
  const advancedFilterParam = useMemo(
    () =>
      buildAdvancedFilterPayload(
        effectiveQuickFilterMode === "exact" ? filterValue : "",
        effectiveQuickFilterMode,
        advancedApplied,
        null,
        isStorageOps,
        usageFeatureEnabled,
        featureSupport,
      ),
    [
      advancedApplied,
      effectiveQuickFilterMode,
      featureSupport,
      filterValue,
      isStorageOps,
      usageFeatureEnabled,
    ],
  );

  const advancedFiltersApplied = hasAdvancedFilters(
    advancedApplied,
    isStorageOps,
    usageFeatureEnabled,
    featureSupport,
  );
  const advancedAppliedPayload = useMemo(
    () =>
      buildAdvancedFilterPayload(
        "",
        "contains",
        advancedApplied,
        null,
        isStorageOps,
        usageFeatureEnabled,
        featureSupport,
      ),
    [advancedApplied, featureSupport, isStorageOps, usageFeatureEnabled],
  );
  const advancedDraftPayload = useMemo(
    () =>
      buildAdvancedFilterPayload(
        "",
        "contains",
        advancedDraft,
        null,
        isStorageOps,
        usageFeatureEnabled,
        featureSupport,
      ),
    [advancedDraft, featureSupport, isStorageOps, usageFeatureEnabled],
  );
  const hasPendingAdvancedChanges =
    advancedDraftPayload !== advancedAppliedPayload;
  const hasAnyAdvancedToClear =
    advancedDraftPayload !== undefined || advancedAppliedPayload !== undefined;

  const closeAdvancedFilterDrawer = useCallback(() => {
    setAdvancedDraft(advancedApplied ?? defaultAdvancedFilter);
    setShowAdvancedFilter(false);
  }, [advancedApplied, setAdvancedDraft]);
  const openAdvancedFilterDrawer = useCallback(() => {
    setShowAdvancedFilter(true);
  }, []);
  const advancedFilterCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedFilter && hasPendingAdvancedChanges,
    onClose: closeAdvancedFilterDrawer,
    zIndexClass: "z-[70]",
  });
  const requestAdvancedFilterClose = advancedFilterCloseGuard.requestClose;

  useEffect(() => {
    if (!showAdvancedFilter) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestAdvancedFilterClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [requestAdvancedFilterClose, showAdvancedFilter]);

  useEffect(() => {
    if (!showAdvancedFilter) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showAdvancedFilter]);

  const projection = useMemo(
    () =>
      buildBucketOpsAdvancedFilterUiProjection({
        advancedApplied,
        advancedDraft,
        featureSupport,
        isStorageOps,
        quickFilterApplied: filterValue,
        quickFilterDraft: filter,
        usageFeatureEnabled,
      }),
    [
      advancedApplied,
      advancedDraft,
      featureSupport,
      filter,
      filterValue,
      isStorageOps,
      usageFeatureEnabled,
    ],
  );

  useEffect(() => {
    if (showAdvancedFilter && !advancedFilterWasOpenRef.current) {
      setAdvancedFilterSecondarySections(
        buildAdvancedFilterSecondarySectionState({
          metrics: projection.advancedDraftRangeCount,
          featureStates: projection.advancedDraftFeatureCount,
          featureDetails: projection.advancedDraftFeatureDetailCount,
        }),
      );
    }
    advancedFilterWasOpenRef.current = showAdvancedFilter;
  }, [
    projection.advancedDraftFeatureCount,
    projection.advancedDraftFeatureDetailCount,
    projection.advancedDraftRangeCount,
    showAdvancedFilter,
  ]);

  const updateAdvancedField = useCallback(
    (field: AdvancedTextOrNumericField, value: string) => {
      setAdvancedDraft((previous) => ({ ...previous, [field]: value }));
    },
    [setAdvancedDraft],
  );

  const updateAdvancedMatchMode = useCallback(
    (
      field:
        | "tenantMatchMode"
        | "ownerMatchMode"
        | "ownerNameMatchMode"
        | "s3TagsMatchMode",
      value: TextMatchMode,
    ) => {
      setAdvancedDraft((previous) => ({ ...previous, [field]: value }));
    },
    [setAdvancedDraft],
  );

  const updateFeatureFilter = useCallback(
    (feature: FeatureKey, value: FeatureFilterState) => {
      setAdvancedDraft((previous) => ({
        ...previous,
        features: { ...previous.features, [feature]: value },
      }));
    },
    [setAdvancedDraft],
  );

  const updateFeatureDetailFilter = useCallback(
    (
      field: FeatureDetailFilterKey,
      value: FeatureDetailFilters[FeatureDetailFilterKey],
    ) => {
      setAdvancedDraft((previous) => ({
        ...previous,
        featureDetails: {
          ...previous.featureDetails,
          [field]: value,
        },
      }));
    },
    [setAdvancedDraft],
  );

  const applyAdvancedFilter = useCallback(() => {
    setAdvancedApplied(advancedDraft);
    setPage(1);
    setShowAdvancedFilter(false);
  }, [advancedDraft, setAdvancedApplied, setPage]);

  const resetAdvancedFilter = useCallback(() => {
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setPage(1);
  }, [setAdvancedApplied, setAdvancedDraft, setPage]);

  const toggleAdvancedFilterSecondarySection = useCallback(
    (sectionId: AdvancedFilterSecondarySectionId) => {
      setAdvancedFilterSecondarySections((previous) => ({
        ...previous,
        [sectionId]: !previous[sectionId],
      }));
    },
    [],
  );

  const toggleQuickFilterMode = useCallback(() => {
    if (quickFilterDraftForcesExact) return;
    setQuickFilterMode((previous) =>
      previous === "contains" ? "exact" : "contains",
    );
    setPage(1);
  }, [quickFilterDraftForcesExact, setPage, setQuickFilterMode]);

  const resetAllFilters = useCallback(() => {
    setFilter("");
    setFilterValue("");
    setQuickFilterMode("contains");
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setTagFilters([]);
    setTagFilterMode("any");
    setShowAdvancedFilter(false);
    setPage(1);
  }, [
    setAdvancedApplied,
    setAdvancedDraft,
    setFilter,
    setFilterValue,
    setPage,
    setQuickFilterMode,
    setTagFilterMode,
    setTagFilters,
  ]);

  const addTagFilter = useCallback(
    (tagId: number) => {
      setTagFilters((previous) =>
        previous.includes(tagId) ? previous : [...previous, tagId],
      );
      setPage(1);
    },
    [setPage, setTagFilters],
  );

  const removeTagFilter = useCallback(
    (tagId: number) => {
      setTagFilters((previous) =>
        previous.filter((item) => item !== tagId),
      );
      setPage(1);
    },
    [setPage, setTagFilters],
  );

  const removeActiveFilterItem = useCallback(
    (action: ActiveFilterRemoveAction) => {
      if (action.type === "quick") {
        setFilter("");
        setFilterValue("");
        setPage(1);
        return;
      }
      if (action.type === "tag_mode") {
        setTagFilterMode("any");
        setPage(1);
        return;
      }
      if (action.type === "tag") {
        removeTagFilter(action.tag);
        return;
      }
      setAdvancedDraft((previous) =>
        clearAdvancedFilterAction(previous, action),
      );
      setAdvancedApplied((previous) =>
        previous ? clearAdvancedFilterAction(previous, action) : previous,
      );
      setPage(1);
    },
    [
      removeTagFilter,
      setAdvancedApplied,
      setAdvancedDraft,
      setFilter,
      setFilterValue,
      setPage,
      setTagFilterMode,
    ],
  );

  return {
    ...projection,
    addTagFilter,
    advancedFilterCloseGuard,
    advancedFilterParam,
    advancedFilterSecondarySections,
    advancedFiltersApplied,
    applyAdvancedFilter,
    effectiveQuickFilterMode,
    effectiveQuickSearchValue,
    hasAnyAdvancedToClear,
    hasPendingAdvancedChanges,
    openAdvancedFilterDrawer,
    quickFilterAppliedParsed,
    quickFilterDraftForcesExact,
    quickFilterModeForDisplay,
    removeActiveFilterItem,
    removeTagFilter,
    resetAdvancedFilter,
    resetAllFilters,
    showAdvancedFilter,
    toggleAdvancedFilterSecondarySection,
    toggleQuickFilterMode,
    updateAdvancedField,
    updateAdvancedMatchMode,
    updateFeatureDetailFilter,
    updateFeatureFilter,
  };
}

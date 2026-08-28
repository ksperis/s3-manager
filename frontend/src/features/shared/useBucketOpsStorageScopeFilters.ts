/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { listExecutionContexts } from "../../api/executionContexts";
import {
  normalizeAdvancedSelectionValues,
  type AdvancedFilterState,
} from "./bucketOpsAdvancedFilterModel";
import { buildBucketOpsStorageScopeProjection } from "./bucketOpsStorageScopeProjection";

type UseBucketOpsStorageScopeFiltersOptions = {
  advancedDraft: AdvancedFilterState;
  extractError: (error: unknown) => string;
  isStorageOps: boolean;
  loadExecutionContexts?: typeof listExecutionContexts;
  setAdvancedDraft: Dispatch<SetStateAction<AdvancedFilterState>>;
};

export function useBucketOpsStorageScopeFilters({
  advancedDraft,
  extractError,
  isStorageOps,
  loadExecutionContexts = listExecutionContexts,
  setAdvancedDraft,
}: UseBucketOpsStorageScopeFiltersOptions) {
  const [contexts, setContexts] = useState<
    Awaited<ReturnType<typeof listExecutionContexts>>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextFilter, setContextFilter] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("");

  useEffect(() => {
    if (!isStorageOps) {
      setContexts([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadExecutionContexts("manager", { signal: controller.signal })
      .then((items) => {
        if (!controller.signal.aborted) {
          setContexts(items);
        }
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setContexts([]);
        setError(extractError(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [extractError, isStorageOps, loadExecutionContexts]);

  const projection = useMemo(
    () =>
      buildBucketOpsStorageScopeProjection({
        contexts,
        contextFilter,
        endpointFilter,
        selectedContextIds: advancedDraft.contextIds,
        selectedEndpointNames: advancedDraft.endpointNames,
      }),
    [
      advancedDraft.contextIds,
      advancedDraft.endpointNames,
      contextFilter,
      contexts,
      endpointFilter,
    ],
  );

  const toggleContextId = useCallback(
    (contextId: string) => {
      setAdvancedDraft((previous) => {
        const contextIds = normalizeAdvancedSelectionValues(previous.contextIds);
        return {
          ...previous,
          contextIds: contextIds.includes(contextId)
            ? contextIds.filter((id) => id !== contextId)
            : [...contextIds, contextId],
        };
      });
    },
    [setAdvancedDraft],
  );

  const selectFilteredContexts = useCallback(() => {
    setAdvancedDraft((previous) => {
      const contextIds = normalizeAdvancedSelectionValues(previous.contextIds);
      const selected = new Set(contextIds);
      projection.filteredContextItems.forEach((context) => selected.add(context.id));
      return { ...previous, contextIds: Array.from(selected) };
    });
  }, [projection.filteredContextItems, setAdvancedDraft]);

  const deselectFilteredContexts = useCallback(() => {
    const filteredIds = new Set(
      projection.filteredContextItems.map((context) => context.id),
    );
    setAdvancedDraft((previous) => ({
      ...previous,
      contextIds: normalizeAdvancedSelectionValues(previous.contextIds).filter(
        (id) => !filteredIds.has(id),
      ),
    }));
  }, [projection.filteredContextItems, setAdvancedDraft]);

  const toggleEndpointName = useCallback(
    (endpointName: string) => {
      setAdvancedDraft((previous) => {
        const endpointNames = normalizeAdvancedSelectionValues(
          previous.endpointNames,
        );
        return {
          ...previous,
          endpointNames: endpointNames.includes(endpointName)
            ? endpointNames.filter((name) => name !== endpointName)
            : [...endpointNames, endpointName],
        };
      });
    },
    [setAdvancedDraft],
  );

  const selectFilteredEndpoints = useCallback(() => {
    setAdvancedDraft((previous) => {
      const endpointNames = normalizeAdvancedSelectionValues(previous.endpointNames);
      const selected = new Set(endpointNames);
      projection.filteredEndpointItems.forEach((endpoint) =>
        selected.add(endpoint.name),
      );
      return { ...previous, endpointNames: Array.from(selected) };
    });
  }, [projection.filteredEndpointItems, setAdvancedDraft]);

  const deselectFilteredEndpoints = useCallback(() => {
    const filteredNames = new Set(
      projection.filteredEndpointItems.map((endpoint) => endpoint.name),
    );
    setAdvancedDraft((previous) => ({
      ...previous,
      endpointNames: normalizeAdvancedSelectionValues(previous.endpointNames).filter(
        (name) => !filteredNames.has(name),
      ),
    }));
  }, [projection.filteredEndpointItems, setAdvancedDraft]);

  return {
    allFilteredStorageOpsContextsSelected:
      projection.allFilteredContextsSelected,
    allFilteredStorageOpsEndpointsSelected:
      projection.allFilteredEndpointsSelected,
    deselectFilteredStorageOpsContexts: deselectFilteredContexts,
    deselectFilteredStorageOpsEndpoints: deselectFilteredEndpoints,
    filteredStorageOpsContextItems: projection.filteredContextItems,
    filteredStorageOpsEndpointItems: projection.filteredEndpointItems,
    hasFilteredStorageOpsContextSelection:
      projection.hasFilteredContextSelection,
    hasFilteredStorageOpsEndpointSelection:
      projection.hasFilteredEndpointSelection,
    selectFilteredStorageOpsContexts: selectFilteredContexts,
    selectFilteredStorageOpsEndpoints: selectFilteredEndpoints,
    setStorageOpsContextFilter: setContextFilter,
    setStorageOpsEndpointFilter: setEndpointFilter,
    storageOpsContextFilter: contextFilter,
    storageOpsContextItems: projection.contextItems,
    storageOpsContextLabelById: projection.contextLabelById,
    storageOpsContextSelectionSet: projection.contextSelectionSet,
    storageOpsContextsError: error,
    storageOpsContextsLoading: loading,
    storageOpsEndpointFilter: endpointFilter,
    storageOpsEndpointItems: projection.endpointItems,
    storageOpsEndpointSelectionSet: projection.endpointSelectionSet,
    toggleAdvancedContextId: toggleContextId,
    toggleAdvancedEndpointName: toggleEndpointName,
  };
}

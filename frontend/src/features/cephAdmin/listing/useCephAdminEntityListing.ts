/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CephAdminListingStreamProgress } from "../../../api/cephAdminEntityListing";
import { extractApiError, isCancelledError } from "../../../utils/apiError";
import {
  INACTIVE_ADVANCED_PROGRESS,
  progressFromAdvancedSearchEvent,
  type AdvancedSearchProgress,
} from "../filtering/advancedFilterShared";

type SortDirection = "asc" | "desc";

type EntityListingParams = {
  page: number;
  page_size: number;
  search?: string;
  advanced_filter?: string;
  sort_by: string;
  sort_dir: SortDirection;
  include?: string[];
};

type EntityListingResponse<Entity> = {
  items?: Entity[];
  total?: number;
};

type ListEntities<Entity> = (
  endpointId: number,
  params: EntityListingParams,
  options: { signal: AbortSignal }
) => Promise<EntityListingResponse<Entity>>;

type StreamEntities<Entity> = (
  endpointId: number,
  params: EntityListingParams,
  options: {
    signal: AbortSignal;
    onProgress: (event: CephAdminListingStreamProgress) => void;
  }
) => Promise<EntityListingResponse<Entity>>;

type UseCephAdminEntityListingOptions<Entity> = {
  endpointId: number | null;
  page: number;
  pageSize: number;
  search: string;
  advancedFilter?: string;
  sortBy: string;
  sortDirection: SortDirection;
  includes: string[];
  reloadNonce: number;
  listEntities: ListEntities<Entity>;
  streamEntities: StreamEntities<Entity>;
  entityKey: (entity: Entity) => string;
};

type CephAdminEntityListingState<Entity> = {
  items: Entity[];
  total: number;
  loading: boolean;
  loadingDetails: boolean;
  advancedProgress: AdvancedSearchProgress;
  error: string | null;
  updateEntity: (key: string, update: (entity: Entity) => Entity) => void;
};

const PREPARING_ADVANCED_PROGRESS: AdvancedSearchProgress = {
  active: true,
  determinate: true,
  percent: 0,
  stage: "prepare",
  message: "Preparing advanced search...",
  processed: 0,
  total: 0,
};

const FALLBACK_ADVANCED_PROGRESS: AdvancedSearchProgress = {
  active: true,
  determinate: false,
  percent: 0,
  stage: "fallback",
  message: "Advanced search in progress...",
  processed: 0,
  total: 0,
};

export function useCephAdminEntityListing<Entity>({
  endpointId,
  page,
  pageSize,
  search,
  advancedFilter,
  sortBy,
  sortDirection,
  includes,
  reloadNonce,
  listEntities,
  streamEntities,
  entityKey,
}: UseCephAdminEntityListingOptions<Entity>): CephAdminEntityListingState<Entity> {
  const [items, setItems] = useState<Entity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [advancedProgress, setAdvancedProgress] = useState(INACTIVE_ADVANCED_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const includesKey = JSON.stringify(includes);

  useEffect(() => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;

    if (!endpointId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingDetails(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
      setError(null);
      return;
    }

    const requestAbort = new AbortController();
    const isCurrentRequest = () => requestId === requestSequence.current && !requestAbort.signal.aborted;
    const baseParams: EntityListingParams = {
      page,
      page_size: pageSize,
      search: search || undefined,
      advanced_filter: advancedFilter,
      sort_by: sortBy,
      sort_dir: sortDirection,
    };
    const requestedIncludes = JSON.parse(includesKey) as string[];

    const load = async () => {
      setLoading(true);
      setLoadingDetails(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
      setError(null);
      setItems([]);
      setTotal(0);

      try {
        const canUseAdvancedStream = Boolean(advancedFilter?.trim().startsWith("{"));
        let baseResponse: EntityListingResponse<Entity>;

        if (canUseAdvancedStream) {
          setAdvancedProgress(PREPARING_ADVANCED_PROGRESS);
          try {
            baseResponse = await streamEntities(endpointId, baseParams, {
              signal: requestAbort.signal,
              onProgress: (event) => {
                if (!isCurrentRequest()) return;
                setAdvancedProgress(progressFromAdvancedSearchEvent(event));
              },
            });
          } catch (streamError) {
            if (isCancelledError(streamError) || !isCurrentRequest()) return;
            setAdvancedProgress(FALLBACK_ADVANCED_PROGRESS);
            baseResponse = await listEntities(endpointId, baseParams, { signal: requestAbort.signal });
          }
        } else {
          baseResponse = await listEntities(endpointId, baseParams, { signal: requestAbort.signal });
        }

        if (!isCurrentRequest()) return;
        const baseItems = baseResponse.items ?? [];
        setItems(baseItems);
        setTotal(baseResponse.total ?? 0);
        setLoading(false);
        setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);

        if (requestedIncludes.length === 0 || baseItems.length === 0) return;

        setLoadingDetails(true);
        try {
          const detailResponse = await listEntities(
            endpointId,
            { ...baseParams, include: requestedIncludes },
            { signal: requestAbort.signal }
          );
          if (!isCurrentRequest()) return;

          const detailsByKey = new Map((detailResponse.items ?? []).map((entity) => [entityKey(entity), entity]));
          setItems(baseItems.map((entity) => detailsByKey.get(entityKey(entity)) ?? entity));
        } finally {
          if (isCurrentRequest()) setLoadingDetails(false);
        }
      } catch (loadError) {
        if (isCancelledError(loadError) || !isCurrentRequest()) return;
        setError(extractApiError(loadError, "Unexpected error"));
        setItems([]);
        setTotal(0);
        setLoading(false);
        setLoadingDetails(false);
        setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
      }
    };

    void load();

    return () => {
      requestAbort.abort();
    };
  }, [
    advancedFilter,
    endpointId,
    entityKey,
    includesKey,
    listEntities,
    page,
    pageSize,
    reloadNonce,
    search,
    sortBy,
    sortDirection,
    streamEntities,
  ]);

  const updateEntity = useCallback(
    (key: string, update: (entity: Entity) => Entity) => {
      setItems((currentItems) =>
        currentItems.map((entity) => (entityKey(entity) === key ? update(entity) : entity))
      );
    },
    [entityKey]
  );

  return { items, total, loading, loadingDetails, advancedProgress, error, updateEntity };
}

/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  getBucketVersioning,
  listBrowserObjects,
  listObjectVersions,
} from "../../api/browser";
import type {
  BrowserObject,
  BrowserObjectVersion,
} from "../../api/browserContracts";
import {
  DELETED_RESULTS_TARGET,
  DELETED_VERSIONS_SCAN_LIMIT,
  OBJECTS_LIST_HARD_LIMIT,
  OBJECTS_PAGE_SIZE,
  VERSIONS_PAGE_SIZE,
} from "./browserConstants";
import {
  normalizeBrowserListingIssue,
  UNKNOWN_BUCKET_ACCESS,
  type BucketAccessEntry,
  type BrowserListingIssue,
} from "./browserBucketsPanelHelpers";
import {
  mergeDeletedObjectsWithLimit,
  mergeUniqueStringsWithLimit,
} from "./browserListingState";
import {
  BROWSER_QUERY_DEBOUNCE_MS,
  isStaleRequest,
  prepareLatestRequest,
} from "./browserSearchHelpers";
import { isAbortError, normalizePrefix } from "./browserUtils";

type BrowserObjectSearchScope = "prefix" | "bucket";
type BrowserObjectSortBy =
  | "name"
  | "size"
  | "modified"
  | "storage_class"
  | "etag";

type UseBrowserObjectListingOptions = {
  accountId: S3AccountSelector;
  accountSwitchInFlight: boolean;
  bucketName: string;
  caseSensitive: boolean;
  enabled: boolean;
  exactMatch: boolean;
  filter: string;
  getBucketAccessEntry: (bucketName: string) => BucketAccessEntry;
  isPortalProfile: boolean;
  onWarning: (message: string) => void;
  prefix: string;
  recursive: boolean;
  requestOptions?: BrowserRequestOptions;
  searchScope: BrowserObjectSearchScope;
  showDeletedObjects: boolean;
  sortBy: BrowserObjectSortBy;
  sortDirection: "asc" | "desc";
  sortId: string;
  storageFilter: string;
  typeFilter: "all" | "file" | "folder";
  updateBucketAccessEntry: (
    bucketName: string,
    entry: BucketAccessEntry,
  ) => void;
};

type LoadBrowserObjectsOptions = {
  append?: boolean;
  continuationToken?: string | null;
  prefixOverride?: string;
  silent?: boolean;
  loadDeletedOnly?: boolean;
  forceRefresh?: boolean;
};

type DeletedListingResult = {
  deletedObjects: BrowserObject[];
  deletedPrefixes: string[];
  nextKeyMarker: string | null;
  nextVersionIdMarker: string | null;
  isTruncated: boolean;
};

const EMPTY_DELETED_LISTING: DeletedListingResult = {
  deletedObjects: [],
  deletedPrefixes: [],
  nextKeyMarker: null,
  nextVersionIdMarker: null,
  isTruncated: false,
};

export function useBrowserObjectListing({
  accountId,
  accountSwitchInFlight,
  bucketName,
  caseSensitive,
  enabled,
  exactMatch,
  filter,
  getBucketAccessEntry,
  isPortalProfile,
  onWarning,
  prefix,
  recursive,
  requestOptions,
  searchScope,
  showDeletedObjects,
  sortBy,
  sortDirection,
  sortId,
  storageFilter,
  typeFilter,
  updateBucketAccessEntry,
}: UseBrowserObjectListingOptions) {
  const [objects, setObjects] = useState<BrowserObject[]>([]);
  const [deletedObjects, setDeletedObjects] = useState<BrowserObject[]>([]);
  const [deletedPrefixes, setDeletedPrefixes] = useState<string[]>([]);
  const [deletedObjectsNextKeyMarker, setDeletedObjectsNextKeyMarker] =
    useState<string | null>(null);
  const [deletedObjectsNextVersionIdMarker, setDeletedObjectsNextVersionIdMarker] =
    useState<string | null>(null);
  const [deletedObjectsIsTruncated, setDeletedObjectsIsTruncated] =
    useState(false);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsNextToken, setObjectsNextToken] = useState<string | null>(null);
  const [objectsIsTruncated, setObjectsIsTruncated] = useState(false);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsLoadingMore, setObjectsLoadingMore] = useState(false);
  const [objectsIssue, setObjectsIssue] =
    useState<BrowserListingIssue | null>(null);
  const [showObjectsIssueTechnicalDetails, setShowObjectsIssueTechnicalDetails] =
    useState(false);
  const [isVersioningEnabled, setIsVersioningEnabled] = useState(false);
  const objectsRequestSeqRef = useRef(0);
  const objectsAbortControllerRef = useRef<AbortController | null>(null);
  const objectsSearchDebounceRef = useRef<number | null>(null);
  const objectsNavigationKeyRef = useRef<string | null>(null);
  const objectsRef = useRef(objects);
  const prefixesRef = useRef(prefixes);
  const deletedObjectsRef = useRef(deletedObjects);
  const deletedPrefixesRef = useRef(deletedPrefixes);
  const deletedObjectsNextKeyMarkerRef = useRef(deletedObjectsNextKeyMarker);
  const deletedObjectsNextVersionIdMarkerRef = useRef(
    deletedObjectsNextVersionIdMarker,
  );
  const deletedObjectsIsTruncatedRef = useRef(deletedObjectsIsTruncated);
  const stableRequestOptions = useMemo<BrowserRequestOptions | undefined>(
    () =>
      requestOptions?.workspaceSurface
        ? { workspaceSurface: requestOptions.workspaceSurface }
        : undefined,
    [requestOptions?.workspaceSurface],
  );
  const requestScopeKey = JSON.stringify([
    accountId ?? null,
    enabled,
    stableRequestOptions?.workspaceSurface ?? null,
  ]);
  const activeRequestScopeRef = useRef(requestScopeKey);

  const clearDeletedListing = useCallback(() => {
    setDeletedObjects([]);
    setDeletedPrefixes([]);
    setDeletedObjectsNextKeyMarker(null);
    setDeletedObjectsNextVersionIdMarker(null);
    setDeletedObjectsIsTruncated(false);
  }, []);

  const resetObjectListingState = useCallback(() => {
    setObjects([]);
    clearDeletedListing();
    setPrefixes([]);
    setObjectsNextToken(null);
    setObjectsIsTruncated(false);
    setObjectsIssue(null);
    setShowObjectsIssueTechnicalDetails(false);
    setObjectsLoadingMore(false);
  }, [clearDeletedListing]);

  const invalidateRequests = useCallback(() => {
    objectsRequestSeqRef.current += 1;
    objectsAbortControllerRef.current?.abort();
    objectsAbortControllerRef.current = null;
    if (objectsSearchDebounceRef.current !== null) {
      window.clearTimeout(objectsSearchDebounceRef.current);
      objectsSearchDebounceRef.current = null;
    }
    objectsNavigationKeyRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (activeRequestScopeRef.current === requestScopeKey) return;
    activeRequestScopeRef.current = requestScopeKey;
    invalidateRequests();
    resetObjectListingState();
    setObjectsLoading(false);
    setIsVersioningEnabled(false);
  }, [invalidateRequests, requestScopeKey, resetObjectListingState]);

  useEffect(() => {
    objectsRef.current = objects;
    prefixesRef.current = prefixes;
    deletedObjectsRef.current = deletedObjects;
    deletedPrefixesRef.current = deletedPrefixes;
    deletedObjectsNextKeyMarkerRef.current = deletedObjectsNextKeyMarker;
    deletedObjectsNextVersionIdMarkerRef.current =
      deletedObjectsNextVersionIdMarker;
    deletedObjectsIsTruncatedRef.current = deletedObjectsIsTruncated;
  }, [
    deletedObjects,
    deletedObjectsIsTruncated,
    deletedObjectsNextKeyMarker,
    deletedObjectsNextVersionIdMarker,
    deletedPrefixes,
    objects,
    prefixes,
  ]);

  const listDeletedObjectsForPrefix = useCallback(
    async (
      targetPrefix: string,
      existingObjects: BrowserObject[],
      existingPrefixes: string[],
      queryValue: string,
      options?: {
        recursive?: boolean;
        exactMatch?: boolean;
        caseSensitive?: boolean;
        keyMarker?: string | null;
        versionIdMarker?: string | null;
        signal?: AbortSignal;
      },
    ): Promise<DeletedListingResult> => {
      if (
        !bucketName ||
        !enabled ||
        !isVersioningEnabled ||
        !showDeletedObjects ||
        storageFilter !== "all"
      ) {
        return EMPTY_DELETED_LISTING;
      }
      const activeKeys = new Set(existingObjects.map((item) => item.key));
      const activePrefixes = new Set(existingPrefixes);
      const latestMarkersByKey = new Map<string, BrowserObjectVersion>();
      const markerPrefixes = new Set<string>();
      const isRecursiveSearch = Boolean(options?.recursive);
      const queryExactMatch = Boolean(options?.exactMatch);
      const queryCaseSensitive = Boolean(options?.caseSensitive);
      const normalizedQuery = queryCaseSensitive
        ? queryValue
        : queryValue.toLowerCase();
      const requestedVersionPrefix =
        isPortalProfile && queryValue
          ? `${targetPrefix}${queryValue.replace(/^\/+/, "")}`
          : targetPrefix;

      const matchesQuery = (key: string) => {
        if (!normalizedQuery) return true;
        let relative = key;
        if (targetPrefix && relative.startsWith(targetPrefix)) {
          relative = relative.slice(targetPrefix.length);
        }
        if (relative.endsWith("/")) relative = relative.slice(0, -1);
        const comparable = queryCaseSensitive
          ? relative
          : relative.toLowerCase();
        return queryExactMatch
          ? comparable === normalizedQuery
          : comparable.includes(normalizedQuery);
      };

      let nextKeyMarker = options?.keyMarker ?? null;
      let nextVersionIdMarker = options?.versionIdMarker ?? null;
      let isTruncated = true;
      let scannedEntries = 0;
      let firstPage = true;
      while (
        isTruncated &&
        scannedEntries < DELETED_VERSIONS_SCAN_LIMIT &&
        (firstPage ||
          latestMarkersByKey.size + markerPrefixes.size <
            DELETED_RESULTS_TARGET)
      ) {
        const data = await listObjectVersions(accountId, bucketName, {
          prefix: requestedVersionPrefix,
          delimiter: isRecursiveSearch ? undefined : "/",
          keyMarker: nextKeyMarker ?? undefined,
          versionIdMarker: nextVersionIdMarker ?? undefined,
          maxKeys: VERSIONS_PAGE_SIZE,
          signal: options?.signal,
          requestOptions: stableRequestOptions,
        });
        firstPage = false;
        scannedEntries +=
          data.versions.length +
          data.delete_markers.length +
          (data.common_prefixes?.length ?? 0);
        (data.common_prefixes ?? []).forEach((prefixKey) => {
          if (typeFilter === "file") return;
          if (!prefixKey.startsWith(targetPrefix)) return;
          if (activePrefixes.has(prefixKey)) return;
          if (!matchesQuery(prefixKey)) return;
          markerPrefixes.add(prefixKey);
        });
        data.delete_markers.forEach((marker) => {
          if (!marker.is_latest) return;
          if (!marker.key || !marker.key.startsWith(targetPrefix)) return;
          const relative = marker.key.slice(targetPrefix.length);
          if (!relative) return;
          const isFolderMarker = marker.key.endsWith("/");
          if (relative.includes("/") && !isRecursiveSearch) {
            if (typeFilter === "file") return;
            const child = relative.split("/")[0];
            if (!child) return;
            const childPrefix = `${targetPrefix}${child}/`;
            if (activePrefixes.has(childPrefix)) return;
            if (!matchesQuery(childPrefix)) return;
            markerPrefixes.add(childPrefix);
            return;
          }
          if (typeFilter !== "file" && isRecursiveSearch) {
            const segments = relative.split("/").filter(Boolean);
            if (segments.length > 1) {
              let running = targetPrefix;
              for (const segment of segments.slice(0, -1)) {
                running = `${running}${segment}/`;
                if (activePrefixes.has(running)) continue;
                if (!matchesQuery(running)) continue;
                markerPrefixes.add(running);
              }
            }
            if (
              isFolderMarker &&
              !activePrefixes.has(marker.key) &&
              matchesQuery(marker.key)
            ) {
              markerPrefixes.add(marker.key);
            }
          }
          if (typeFilter === "folder" || isFolderMarker) return;
          if (activeKeys.has(marker.key)) return;
          if (!matchesQuery(marker.key)) return;
          latestMarkersByKey.set(marker.key, marker);
        });
        nextKeyMarker = data.next_key_marker ?? null;
        nextVersionIdMarker = data.next_version_id_marker ?? null;
        isTruncated = Boolean(
          data.is_truncated && (nextKeyMarker || nextVersionIdMarker),
        );
      }

      return {
        deletedObjects: Array.from(latestMarkersByKey.values())
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((marker) => ({
            key: marker.key,
            size: 0,
            last_modified: marker.last_modified ?? null,
            etag: null,
            storage_class: null,
            is_delete_marker: true,
            version_id: marker.version_id ?? null,
          })),
        deletedPrefixes: Array.from(markerPrefixes.values()).sort((a, b) =>
          a.localeCompare(b),
        ),
        nextKeyMarker,
        nextVersionIdMarker,
        isTruncated,
      };
    },
    [
      accountId,
      bucketName,
      enabled,
      isPortalProfile,
      isVersioningEnabled,
      showDeletedObjects,
      stableRequestOptions,
      storageFilter,
      typeFilter,
    ],
  );

  const loadObjects = useCallback(
    async (options?: LoadBrowserObjectsOptions) => {
      if (!bucketName || !enabled) return;
      const targetPrefix = normalizePrefix(options?.prefixOverride ?? prefix);
      const isAppend = Boolean(options?.append);
      const isSilent = Boolean(options?.silent);
      const loadDeletedOnly = Boolean(options?.loadDeletedOnly);
      const { requestSeq, controller } = prepareLatestRequest(
        objectsAbortControllerRef.current,
        objectsRequestSeqRef.current,
      );
      objectsRequestSeqRef.current = requestSeq;
      objectsAbortControllerRef.current = controller;
      if (!isAppend) {
        if (!isSilent) {
          setObjectsLoading(true);
          setObjectsLoadingMore(false);
          setObjectsIssue(null);
          setShowObjectsIssueTechnicalDetails(false);
        }
      } else {
        setObjectsLoadingMore(true);
      }
      const query = filter.trim();
      const searchFromBucket = searchScope === "bucket" && Boolean(query);
      const requestPrefix = searchFromBucket ? "" : targetPrefix;
      const requestRecursive =
        Boolean(query) && (searchFromBucket || recursive);
      try {
        let loadedObjects: BrowserObject[] = [];
        let loadedPrefixes: string[] = [];
        let loadedObjectsNextToken: string | null = null;
        let loadedObjectsTruncated = false;

        if (!loadDeletedOnly) {
          const data = await listBrowserObjects(accountId, bucketName, {
            prefix: requestPrefix,
            continuationToken: options?.continuationToken ?? undefined,
            maxKeys: OBJECTS_PAGE_SIZE,
            query: query || undefined,
            exactMatch,
            caseSensitive,
            type: typeFilter,
            storageClass: storageFilter,
            recursive: requestRecursive,
            sortBy,
            sortDir: sortDirection,
            signal: controller.signal,
            forceRefresh: options?.forceRefresh,
            ...stableRequestOptions,
          });
          if (isStaleRequest(requestSeq, objectsRequestSeqRef.current)) return;
          loadedObjects = data.objects;
          loadedPrefixes = data.prefixes;
          loadedObjectsNextToken = data.next_continuation_token ?? null;
          loadedObjectsTruncated = Boolean(data.is_truncated);
          setObjectsIssue(null);
          setShowObjectsIssueTechnicalDetails(false);
          updateBucketAccessEntry(bucketName, {
            status: "available",
            detail: null,
          });
        }

        const currentObjects = objectsRef.current;
        const currentPrefixes = prefixesRef.current;
        const currentDeletedObjects = deletedObjectsRef.current;
        const currentDeletedPrefixes = deletedPrefixesRef.current;
        const currentDeletedKeyMarker =
          deletedObjectsNextKeyMarkerRef.current;
        const currentDeletedVersionIdMarker =
          deletedObjectsNextVersionIdMarkerRef.current;
        const currentDeletedTruncated =
          deletedObjectsIsTruncatedRef.current;
        const mergedObjects = isAppend
          ? [...currentObjects, ...loadedObjects]
          : loadedObjects;
        const mergedPrefixesRaw = isAppend
          ? Array.from(new Set([...currentPrefixes, ...loadedPrefixes]))
          : loadedPrefixes;
        const objectsLimitReached =
          mergedObjects.length > OBJECTS_LIST_HARD_LIMIT;
        const prefixesLimitReached =
          mergedPrefixesRaw.length > OBJECTS_LIST_HARD_LIMIT;
        const boundedObjects = mergedObjects.slice(0, OBJECTS_LIST_HARD_LIMIT);
        const boundedPrefixes = mergedPrefixesRaw.slice(
          0,
          OBJECTS_LIST_HARD_LIMIT,
        );

        const shouldLoadDeleted =
          showDeletedObjects && isVersioningEnabled && storageFilter === "all";
        let nextDeletedObjects = isAppend ? currentDeletedObjects : [];
        let nextDeletedPrefixes = isAppend ? currentDeletedPrefixes : [];
        let nextDeletedKeyMarker = isAppend ? currentDeletedKeyMarker : null;
        let nextDeletedVersionIdMarker = isAppend
          ? currentDeletedVersionIdMarker
          : null;
        let nextDeletedTruncated = isAppend ? currentDeletedTruncated : false;
        let deletedLimitReached = false;

        if (shouldLoadDeleted) {
          try {
            const deletedResult = await listDeletedObjectsForPrefix(
              requestPrefix,
              boundedObjects,
              boundedPrefixes,
              query,
              {
                recursive: requestRecursive,
                exactMatch,
                caseSensitive,
                keyMarker: isAppend ? currentDeletedKeyMarker : null,
                versionIdMarker: isAppend
                  ? currentDeletedVersionIdMarker
                  : null,
                signal: controller.signal,
              },
            );
            if (isStaleRequest(requestSeq, objectsRequestSeqRef.current)) return;
            const deletedObjectsMerged = isAppend
              ? mergeDeletedObjectsWithLimit(
                  currentDeletedObjects,
                  deletedResult.deletedObjects,
                  OBJECTS_LIST_HARD_LIMIT,
                )
              : {
                  items: deletedResult.deletedObjects.slice(
                    0,
                    OBJECTS_LIST_HARD_LIMIT,
                  ),
                  limitReached:
                    deletedResult.deletedObjects.length >
                    OBJECTS_LIST_HARD_LIMIT,
                };
            const deletedPrefixesMerged = isAppend
              ? mergeUniqueStringsWithLimit(
                  currentDeletedPrefixes,
                  deletedResult.deletedPrefixes,
                  OBJECTS_LIST_HARD_LIMIT,
                )
              : {
                  items: deletedResult.deletedPrefixes.slice(
                    0,
                    OBJECTS_LIST_HARD_LIMIT,
                  ),
                  limitReached:
                    deletedResult.deletedPrefixes.length >
                    OBJECTS_LIST_HARD_LIMIT,
                };
            deletedLimitReached =
              deletedObjectsMerged.limitReached ||
              deletedPrefixesMerged.limitReached;
            nextDeletedObjects = deletedObjectsMerged.items;
            nextDeletedPrefixes = deletedPrefixesMerged.items;
            if (deletedLimitReached) {
              nextDeletedKeyMarker = null;
              nextDeletedVersionIdMarker = null;
              nextDeletedTruncated = false;
            } else {
              nextDeletedKeyMarker = deletedResult.nextKeyMarker;
              nextDeletedVersionIdMarker = deletedResult.nextVersionIdMarker;
              nextDeletedTruncated = deletedResult.isTruncated;
            }
          } catch {
            if (!isAppend) {
              nextDeletedObjects = [];
              nextDeletedPrefixes = [];
              nextDeletedKeyMarker = null;
              nextDeletedVersionIdMarker = null;
              nextDeletedTruncated = false;
            }
          }
        } else {
          nextDeletedObjects = [];
          nextDeletedPrefixes = [];
          nextDeletedKeyMarker = null;
          nextDeletedVersionIdMarker = null;
          nextDeletedTruncated = false;
        }

        if (isStaleRequest(requestSeq, objectsRequestSeqRef.current)) return;
        setObjects(boundedObjects);
        setPrefixes(boundedPrefixes);
        setDeletedObjects(nextDeletedObjects);
        setDeletedPrefixes(nextDeletedPrefixes);
        setDeletedObjectsNextKeyMarker(nextDeletedKeyMarker);
        setDeletedObjectsNextVersionIdMarker(nextDeletedVersionIdMarker);
        setDeletedObjectsIsTruncated(nextDeletedTruncated);

        if (objectsLimitReached || prefixesLimitReached) {
          setObjectsNextToken(null);
          setObjectsIsTruncated(false);
          onWarning(
            `Object listing is limited to ${OBJECTS_LIST_HARD_LIMIT.toLocaleString()} entries. Narrow your path or search to continue.`,
          );
        } else {
          setObjectsNextToken(loadedObjectsNextToken);
          setObjectsIsTruncated(!loadDeletedOnly && loadedObjectsTruncated);
        }
        if (deletedLimitReached) {
          onWarning(
            `Deleted markers listing is limited to ${OBJECTS_LIST_HARD_LIMIT.toLocaleString()} entries. Narrow your path or search to continue.`,
          );
        }
      } catch (error) {
        if (isAbortError(error)) return;
        if (isStaleRequest(requestSeq, objectsRequestSeqRef.current)) return;
        const issue = normalizeBrowserListingIssue(
          error,
          "Unable to list objects for this prefix.",
        );
        const previousAccess = getBucketAccessEntry(bucketName);
        if (issue.kind === "access_denied") {
          updateBucketAccessEntry(bucketName, {
            status: "unavailable",
            detail: issue.technicalDetail,
          });
        } else if (
          previousAccess.status === "unavailable" ||
          previousAccess.status === "checking"
        ) {
          updateBucketAccessEntry(bucketName, UNKNOWN_BUCKET_ACCESS);
        }
        setObjectsIssue(issue);
        setShowObjectsIssueTechnicalDetails(false);
      } finally {
        if (objectsAbortControllerRef.current === controller) {
          objectsAbortControllerRef.current = null;
        }
        if (!isStaleRequest(requestSeq, objectsRequestSeqRef.current)) {
          if (!isAppend) {
            if (!isSilent) setObjectsLoading(false);
          } else {
            setObjectsLoadingMore(false);
          }
        }
      }
    },
    [
      accountId,
      bucketName,
      caseSensitive,
      enabled,
      exactMatch,
      filter,
      getBucketAccessEntry,
      isVersioningEnabled,
      listDeletedObjectsForPrefix,
      onWarning,
      prefix,
      recursive,
      searchScope,
      showDeletedObjects,
      sortBy,
      sortDirection,
      stableRequestOptions,
      storageFilter,
      typeFilter,
      updateBucketAccessEntry,
    ],
  );

  useEffect(() => {
    if (accountSwitchInFlight) {
      invalidateRequests();
      return;
    }
    if (objectsSearchDebounceRef.current !== null) {
      window.clearTimeout(objectsSearchDebounceRef.current);
      objectsSearchDebounceRef.current = null;
    }
    if (!bucketName || !enabled) {
      invalidateRequests();
      resetObjectListingState();
      setObjectsLoading(false);
      return;
    }
    const navigationKey = `${String(accountId ?? "")}::${bucketName}::${normalizePrefix(prefix)}::${sortId}`;
    const shouldLoadImmediately =
      objectsNavigationKeyRef.current !== navigationKey;
    objectsNavigationKeyRef.current = navigationKey;
    if (shouldLoadImmediately) {
      resetObjectListingState();
      setObjectsLoading(true);
      void loadObjects({ prefixOverride: prefix });
      return;
    }
    objectsSearchDebounceRef.current = window.setTimeout(() => {
      void loadObjects({ prefixOverride: prefix });
    }, BROWSER_QUERY_DEBOUNCE_MS);
    return () => {
      if (objectsSearchDebounceRef.current !== null) {
        window.clearTimeout(objectsSearchDebounceRef.current);
        objectsSearchDebounceRef.current = null;
      }
    };
  }, [
    accountId,
    accountSwitchInFlight,
    bucketName,
    caseSensitive,
    enabled,
    exactMatch,
    filter,
    isVersioningEnabled,
    invalidateRequests,
    loadObjects,
    prefix,
    recursive,
    resetObjectListingState,
    searchScope,
    showDeletedObjects,
    sortId,
    storageFilter,
    typeFilter,
  ]);

  useEffect(() => {
    if (accountSwitchInFlight || !bucketName || !enabled) {
      setIsVersioningEnabled(false);
      return;
    }
    let active = true;
    getBucketVersioning(accountId, bucketName, stableRequestOptions)
      .then((data) => {
        if (!active) return;
        setIsVersioningEnabled(
          data.status === "Enabled" || data.status === "Suspended",
        );
      })
      .catch(() => {
        if (active) setIsVersioningEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [
    accountId,
    accountSwitchInFlight,
    bucketName,
    enabled,
    stableRequestOptions,
  ]);

  useEffect(() => {
    if (isVersioningEnabled && showDeletedObjects) return;
    clearDeletedListing();
  }, [clearDeletedListing, isVersioningEnabled, showDeletedObjects]);

  useEffect(
    () => () => {
      invalidateRequests();
    },
    [invalidateRequests],
  );

  return {
    deletedObjects,
    deletedObjectsIsTruncated,
    deletedPrefixes,
    isVersioningEnabled,
    loadObjects,
    objects,
    objectsIsTruncated,
    objectsIssue,
    objectsLoading,
    objectsLoadingMore,
    objectsNextToken,
    prefixes,
    setShowObjectsIssueTechnicalDetails,
    showObjectsIssueTechnicalDetails,
  };
}

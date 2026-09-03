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
  type Dispatch,
  type SetStateAction,
} from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  searchBrowserBuckets,
  type BrowserBucket,
} from "../../api/browser";
import { BUCKET_MENU_LIMIT } from "./browserConstants";
import { extractBucketListError } from "./browserBucketsPanelHelpers";
import {
  readBrowserRootContextSelection,
  writeBrowserRootContextSelection,
} from "./browserRootUiState";
import {
  BROWSER_QUERY_DEBOUNCE_MS,
  mergeBucketSearchItems,
} from "./browserSearchHelpers";
import { normalizePrefix } from "./browserUtils";
import { useBrowserBucketAccess } from "./useBrowserBucketAccess";

type UseBrowserBucketCatalogOptions = {
  accountId: S3AccountSelector;
  accessContextKey: string | null;
  browserRootContextId: string | null;
  enabled: boolean;
  isCephAdminContext: boolean;
  isMainBrowserPath: boolean;
  lockedBucketName: string;
  onSelectedBucketNameChange?: (bucketName: string) => void;
  requestOptions?: BrowserRequestOptions;
  requestedBucket: string;
  requestedPrefix: string;
  searchActive: boolean;
  usePortalWorkspaceLabels: boolean;
};

type BucketSelectionSource =
  | "preferred"
  | "requested"
  | "stored"
  | "previous"
  | "single"
  | "ceph-requested"
  | "none";

export function useBrowserBucketCatalog({
  accountId,
  accessContextKey,
  browserRootContextId,
  enabled,
  isCephAdminContext,
  isMainBrowserPath,
  lockedBucketName,
  onSelectedBucketNameChange,
  requestOptions,
  requestedBucket,
  requestedPrefix,
  searchActive,
  usePortalWorkspaceLabels,
}: UseBrowserBucketCatalogOptions) {
  const [bucketNameState, setBucketNameState] = useState("");
  const [prefixState, setPrefixState] = useState("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [bucketMenuItems, setBucketMenuItems] = useState<BrowserBucket[]>([]);
  const [bucketMenuPage, setBucketMenuPage] = useState(1);
  const [bucketMenuHasNext, setBucketMenuHasNext] = useState(false);
  const [bucketMenuTotal, setBucketMenuTotal] = useState(0);
  const [bucketTotalCount, setBucketTotalCount] = useState(0);
  const [bucketMenuLoadingMore, setBucketMenuLoadingMore] = useState(false);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const bucketNameRef = useRef(bucketNameState);
  const prefixRef = useRef(prefixState);
  const searchDebounceRef = useRef<number | null>(null);
  const searchValueRef = useRef("");
  const requestIdRef = useRef(0);
  const activeContextKeyRef = useRef<string | null>(accessContextKey);
  const previousAccountIdRef = useRef(accountId);
  const selectionPersistenceReadyRef = useRef(false);
  const selectionPersistenceContextIdRef = useRef<string | null>(
    browserRootContextId,
  );
  const accountSwitchInFlight = previousAccountIdRef.current !== accountId;
  const stableRequestOptions = useMemo<BrowserRequestOptions | undefined>(
    () =>
      requestOptions?.workspaceSurface
        ? { workspaceSurface: requestOptions.workspaceSurface }
        : undefined,
    [requestOptions?.workspaceSurface],
  );

  const setBucketName = useCallback<Dispatch<SetStateAction<string>>>(
    (value) => {
      const nextValue =
        typeof value === "function" ? value(bucketNameRef.current) : value;
      bucketNameRef.current = nextValue;
      setBucketNameState(nextValue);
    },
    [],
  );

  const setPrefix = useCallback<Dispatch<SetStateAction<string>>>(
    (value) => {
      const nextValue =
        typeof value === "function" ? value(prefixRef.current) : value;
      prefixRef.current = nextValue;
      setPrefixState(nextValue);
    },
    [],
  );

  const setSelection = useCallback(
    (bucketName: string, prefix: string) => {
      setBucketName(bucketName);
      setPrefix(prefix);
    },
    [setBucketName, setPrefix],
  );

  const {
    accessByName,
    clearBucketAccessEntries,
    getBucketAccessEntry,
    resetBucketAccessQueue,
    scheduleBucketAccessProbe,
    updateBucketAccessEntry,
  } = useBrowserBucketAccess({
    accountId,
    activeBucketName: bucketNameState,
    contextKey: accessContextKey,
    enabled,
    requestOptions: stableRequestOptions,
  });

  const resetMenu = useCallback(() => {
    setBucketMenuItems([]);
    setBucketMenuPage(1);
    setBucketMenuHasNext(false);
    setBucketMenuTotal(0);
  }, []);

  const requestIsCurrent = useCallback(
    (requestId: number, contextKey: string | null) =>
      requestId === requestIdRef.current &&
      contextKey === activeContextKeyRef.current,
    [],
  );

  useLayoutEffect(() => {
    activeContextKeyRef.current = enabled ? accessContextKey : null;
    requestIdRef.current += 1;
    if (previousAccountIdRef.current === accountId) return;
    previousAccountIdRef.current = accountId;
    selectionPersistenceReadyRef.current = false;
    selectionPersistenceContextIdRef.current = browserRootContextId;
    setSelection("", "");
  }, [
    accessContextKey,
    accountId,
    browserRootContextId,
    enabled,
    setSelection,
  ]);

  const refreshBucketList = useCallback(
    async (options?: { preferredBucket?: string | null }) => {
      const requestContextKey = enabled ? accessContextKey : null;
      if (activeContextKeyRef.current !== requestContextKey) return;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      resetBucketAccessQueue();
      if (isMainBrowserPath) {
        selectionPersistenceReadyRef.current = false;
        selectionPersistenceContextIdRef.current = browserRootContextId;
      }
      if (!enabled) {
        resetMenu();
        setBucketTotalCount(0);
        searchValueRef.current = "";
        clearBucketAccessEntries();
        setSelection("", "");
        setLoadingBuckets(false);
        setBucketMenuLoadingMore(false);
        setBucketError(null);
        return;
      }
      if (lockedBucketName) {
        const previousBucket = bucketNameRef.current;
        const previousPrefix = prefixRef.current;
        setLoadingBuckets(false);
        setBucketMenuLoadingMore(false);
        setBucketError(null);
        setBucketMenuItems([{ name: lockedBucketName }]);
        setBucketMenuPage(1);
        setBucketMenuHasNext(false);
        setBucketMenuTotal(1);
        setBucketTotalCount(1);
        searchValueRef.current = "";
        clearBucketAccessEntries();
        setSelection(
          lockedBucketName,
          requestedPrefix ||
            (previousBucket === lockedBucketName ? previousPrefix : ""),
        );
        if (isMainBrowserPath) {
          selectionPersistenceContextIdRef.current = browserRootContextId;
          selectionPersistenceReadyRef.current = true;
        }
        return;
      }
      setLoadingBuckets(true);
      setBucketMenuLoadingMore(false);
      setBucketError(null);
      try {
        const firstPage = await searchBrowserBuckets(accountId, {
          page: 1,
          pageSize: BUCKET_MENU_LIMIT,
          ...stableRequestOptions,
        });
        if (!requestIsCurrent(requestId, requestContextKey)) return;
        searchValueRef.current = "";
        setBucketMenuItems(firstPage.items);
        setBucketMenuPage(firstPage.page);
        setBucketMenuHasNext(firstPage.has_next);
        setBucketMenuTotal(firstPage.total);
        setBucketTotalCount(firstPage.total);
        const previousBucket = bucketNameRef.current;
        const previousPrefix = prefixRef.current;
        const preferredBucket = options?.preferredBucket?.trim() ?? "";
        const storedSelection = isMainBrowserPath
          ? readBrowserRootContextSelection(browserRootContextId)
          : null;
        const exactMatchCache = new Map<string, boolean>();

        const bucketExists = async (value: string): Promise<boolean> => {
          if (!value) return false;
          if (exactMatchCache.has(value)) {
            return Boolean(exactMatchCache.get(value));
          }
          if (firstPage.items.some((bucket) => bucket.name === value)) {
            exactMatchCache.set(value, true);
            return true;
          }
          const exactResult = await searchBrowserBuckets(accountId, {
            search: value,
            exact: true,
            page: 1,
            pageSize: 1,
            ...stableRequestOptions,
          });
          if (!requestIsCurrent(requestId, requestContextKey)) return false;
          const exists = exactResult.total > 0;
          exactMatchCache.set(value, exists);
          return exists;
        };

        let nextBucket = "";
        let nextPrefix = previousPrefix;
        let bucketSource: BucketSelectionSource = "none";
        if (preferredBucket && (await bucketExists(preferredBucket))) {
          nextBucket = preferredBucket;
          bucketSource = "preferred";
        } else if (isCephAdminContext && requestedBucket) {
          nextBucket = requestedBucket;
          bucketSource = "ceph-requested";
        } else if (requestedBucket && (await bucketExists(requestedBucket))) {
          nextBucket = requestedBucket;
          bucketSource = "requested";
        } else if (
          storedSelection?.bucketName &&
          (await bucketExists(storedSelection.bucketName))
        ) {
          nextBucket = storedSelection.bucketName;
          nextPrefix = normalizePrefix(storedSelection.prefix);
          bucketSource = "stored";
        } else if (previousBucket && (await bucketExists(previousBucket))) {
          nextBucket = previousBucket;
          bucketSource = "previous";
        } else if (firstPage.total === 1 && firstPage.items.length === 1) {
          nextBucket = firstPage.items[0].name;
          bucketSource = "single";
        }
        if (!requestIsCurrent(requestId, requestContextKey)) return;
        if (bucketSource !== "stored") {
          if (
            bucketSource === "requested" ||
            bucketSource === "ceph-requested"
          ) {
            nextPrefix = requestedPrefix;
          } else {
            nextPrefix =
              bucketSource === "preferred" || nextBucket !== previousBucket
                ? ""
                : previousPrefix;
          }
        }
        setSelection(nextBucket, nextPrefix);
        if (isMainBrowserPath) {
          selectionPersistenceContextIdRef.current = browserRootContextId;
          selectionPersistenceReadyRef.current = true;
        }
      } catch (error) {
        if (!requestIsCurrent(requestId, requestContextKey)) return;
        searchValueRef.current = "";
        setBucketError(
          extractBucketListError(error, usePortalWorkspaceLabels),
        );
        resetMenu();
        setBucketTotalCount(0);
        setSelection(
          isCephAdminContext && requestedBucket ? requestedBucket : "",
          "",
        );
        selectionPersistenceContextIdRef.current = browserRootContextId;
      } finally {
        if (requestIsCurrent(requestId, requestContextKey)) {
          setLoadingBuckets(false);
        }
      }
    },
    [
      accessContextKey,
      accountId,
      browserRootContextId,
      clearBucketAccessEntries,
      enabled,
      isCephAdminContext,
      isMainBrowserPath,
      lockedBucketName,
      requestIsCurrent,
      requestedBucket,
      requestedPrefix,
      resetBucketAccessQueue,
      resetMenu,
      setSelection,
      stableRequestOptions,
      usePortalWorkspaceLabels,
    ],
  );

  useEffect(() => {
    void refreshBucketList();
  }, [refreshBucketList]);

  const loadBucketSearchPage = useCallback(
    async (options?: { search?: string; page?: number; append?: boolean }) => {
      const requestContextKey = enabled ? accessContextKey : null;
      if (activeContextKeyRef.current !== requestContextKey) return;
      if (!enabled) {
        resetMenu();
        return;
      }
      if (lockedBucketName) {
        setBucketMenuItems([{ name: lockedBucketName }]);
        setBucketMenuPage(1);
        setBucketMenuHasNext(false);
        setBucketMenuTotal(1);
        setBucketTotalCount(1);
        setLoadingBuckets(false);
        setBucketMenuLoadingMore(false);
        return;
      }
      const searchValue = (options?.search ?? "").trim();
      const targetPage = Math.max(1, options?.page ?? 1);
      const append = Boolean(options?.append && targetPage > 1);
      if (!append) resetBucketAccessQueue();
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (append) {
        setBucketMenuLoadingMore(true);
      } else {
        setLoadingBuckets(true);
      }
      setBucketError(null);
      try {
        const data = await searchBrowserBuckets(accountId, {
          search: searchValue || undefined,
          page: targetPage,
          pageSize: BUCKET_MENU_LIMIT,
          ...stableRequestOptions,
        });
        if (!requestIsCurrent(requestId, requestContextKey)) return;
        searchValueRef.current = searchValue;
        setBucketMenuItems((previous) =>
          mergeBucketSearchItems(previous, data.items, append),
        );
        setBucketMenuPage(data.page);
        setBucketMenuHasNext(data.has_next);
        setBucketMenuTotal(data.total);
        if (!searchValue) setBucketTotalCount(data.total);
      } catch (error) {
        if (!requestIsCurrent(requestId, requestContextKey)) return;
        setBucketError(
          extractBucketListError(error, usePortalWorkspaceLabels),
        );
        if (!append) resetMenu();
      } finally {
        if (requestIsCurrent(requestId, requestContextKey)) {
          if (append) {
            setBucketMenuLoadingMore(false);
          } else {
            setLoadingBuckets(false);
          }
        }
      }
    },
    [
      accessContextKey,
      accountId,
      enabled,
      lockedBucketName,
      requestIsCurrent,
      resetBucketAccessQueue,
      resetMenu,
      stableRequestOptions,
      usePortalWorkspaceLabels,
    ],
  );

  useEffect(() => {
    if (!searchActive) return;
    const nextSearchValue = bucketFilter.trim();
    if (nextSearchValue === searchValueRef.current) return;
    if (searchDebounceRef.current !== null) {
      window.clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = window.setTimeout(() => {
      void loadBucketSearchPage({
        search: nextSearchValue,
        page: 1,
        append: false,
      });
    }, BROWSER_QUERY_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [bucketFilter, loadBucketSearchPage, searchActive]);

  useEffect(() => {
    onSelectedBucketNameChange?.(bucketNameState);
  }, [bucketNameState, onSelectedBucketNameChange]);

  useEffect(
    () => () => {
      onSelectedBucketNameChange?.("");
    },
    [onSelectedBucketNameChange],
  );

  useEffect(() => {
    if (!isMainBrowserPath || !browserRootContextId || !enabled) return;
    if (!selectionPersistenceReadyRef.current) return;
    if (selectionPersistenceContextIdRef.current !== browserRootContextId) {
      return;
    }
    writeBrowserRootContextSelection(browserRootContextId, {
      bucketName: bucketNameState,
      prefix: prefixState,
    });
  }, [
    browserRootContextId,
    bucketNameState,
    enabled,
    isMainBrowserPath,
    prefixState,
  ]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    },
    [],
  );

  const canLoadMore =
    bucketMenuHasNext && !loadingBuckets && !bucketMenuLoadingMore;

  const loadMore = useCallback(() => {
    if (!canLoadMore) return;
    void loadBucketSearchPage({
      search: bucketFilter,
      page: bucketMenuPage + 1,
      append: true,
    });
  }, [
    bucketFilter,
    bucketMenuPage,
    canLoadMore,
    loadBucketSearchPage,
  ]);

  const selectBucket = useCallback(
    (bucketName: string) => {
      setBucketFilter("");
      if (
        lockedBucketName ||
        !bucketName ||
        bucketName === bucketNameRef.current
      ) {
        return false;
      }
      setSelection(bucketName, "");
      return true;
    },
    [lockedBucketName, setSelection],
  );

  return {
    accessByName,
    accountSwitchInFlight,
    bucketError,
    bucketFilter,
    bucketMenuItems,
    bucketMenuLoadingMore,
    bucketMenuTotal,
    bucketName: bucketNameState,
    bucketTotalCount,
    canLoadMore,
    getBucketAccessEntry,
    loadMore,
    loadingBuckets,
    prefix: prefixState,
    refreshBucketList,
    scheduleBucketAccessProbe,
    selectBucket,
    setBucketFilter,
    setBucketName,
    setPrefix,
    updateBucketAccessEntry,
  };
}

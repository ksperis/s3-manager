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
import { listBrowserObjects } from "../../api/browser";
import {
  TREE_PREFIXES_HARD_LIMIT,
  TREE_PREFIXES_PAGE_SIZE,
} from "./browserConstants";
import {
  buildTreeNodes,
  findTreeNodeByPrefix,
  normalizePrefix,
  updateTreeNodes,
} from "./browserUtils";
import type { TreeNode } from "./browserTypes";

type UseBrowserFolderTreeOptions = {
  accountId: S3AccountSelector;
  accountSwitchInFlight: boolean;
  bucketName: string;
  currentBucketUnavailable: boolean;
  enabled: boolean;
  onWarning: (message: string) => void;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
};

type LoadTreeChildrenOptions = {
  expand?: boolean;
};

const TREE_PREFIXES_PAGE_BUDGET = 50;

export function useBrowserFolderTree({
  accountId,
  accountSwitchInFlight,
  bucketName,
  currentBucketUnavailable,
  enabled,
  onWarning,
  prefix,
  requestOptions,
}: UseBrowserFolderTreeOptions) {
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const requestControllersRef = useRef(
    new Map<string, AbortController>(),
  );
  const stableRequestOptions = useMemo<BrowserRequestOptions | undefined>(
    () =>
      requestOptions?.workspaceSurface
        ? { workspaceSurface: requestOptions.workspaceSurface }
        : undefined,
    [requestOptions?.workspaceSurface],
  );
  const requestScopeKey = JSON.stringify([
    accountId ?? null,
    accountSwitchInFlight,
    bucketName,
    enabled,
    currentBucketUnavailable,
    stableRequestOptions?.workspaceSurface ?? null,
  ]);
  const activeRequestScopeRef = useRef(requestScopeKey);

  const invalidateRequests = useCallback(() => {
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
  }, []);

  useLayoutEffect(() => {
    if (activeRequestScopeRef.current === requestScopeKey) return;
    activeRequestScopeRef.current = requestScopeKey;
    invalidateRequests();
    setTreeNodes([]);
  }, [invalidateRequests, requestScopeKey]);

  const listTreePrefixes = useCallback(
    async (targetPrefix: string, signal: AbortSignal) => {
      const prefixesCollected: string[] = [];
      let continuationToken: string | null = null;
      let hasMore = true;
      let pagesScanned = 0;

      while (
        hasMore &&
        pagesScanned < TREE_PREFIXES_PAGE_BUDGET &&
        prefixesCollected.length < TREE_PREFIXES_HARD_LIMIT
      ) {
        const data = await listBrowserObjects(accountId, bucketName, {
          prefix: targetPrefix,
          continuationToken: continuationToken ?? undefined,
          maxKeys: TREE_PREFIXES_PAGE_SIZE,
          signal,
          ...stableRequestOptions,
        });
        if (signal.aborted) break;
        prefixesCollected.push(...data.prefixes);
        continuationToken = data.next_continuation_token ?? null;
        hasMore = Boolean(data.is_truncated && continuationToken);
        pagesScanned += 1;
      }

      const uniquePrefixes = Array.from(new Set(prefixesCollected));
      const reachedHardLimit = uniquePrefixes.length > TREE_PREFIXES_HARD_LIMIT;
      return {
        prefixes: uniquePrefixes.slice(0, TREE_PREFIXES_HARD_LIMIT),
        truncated: hasMore || reachedHardLimit,
      };
    },
    [accountId, bucketName, stableRequestOptions],
  );

  const loadTreeChildren = useCallback(
    async (
      targetPrefix: string,
      options: LoadTreeChildrenOptions = {},
    ) => {
      if (
        accountSwitchInFlight ||
        !bucketName ||
        !enabled ||
        currentBucketUnavailable
      ) {
        return;
      }
      const normalizedPrefix = targetPrefix
        ? normalizePrefix(targetPrefix)
        : "";
      const shouldExpand = options.expand ?? true;
      requestControllersRef.current.get(normalizedPrefix)?.abort();
      const controller = new AbortController();
      const requestScope = activeRequestScopeRef.current;
      requestControllersRef.current.set(normalizedPrefix, controller);
      const isCurrentRequest = () =>
        activeRequestScopeRef.current === requestScope &&
        requestControllersRef.current.get(normalizedPrefix) === controller;

      setTreeNodes((current) =>
        updateTreeNodes(current, normalizedPrefix, (node) => ({
          ...node,
          isLoading: true,
        })),
      );
      try {
        const data = await listTreePrefixes(
          normalizedPrefix,
          controller.signal,
        );
        if (!isCurrentRequest()) return;
        if (data.truncated) {
          onWarning(
            `Folders panel is limited to ${TREE_PREFIXES_HARD_LIMIT.toLocaleString()} prefixes. Narrow the path to continue.`,
          );
        }
        const children = buildTreeNodes(data.prefixes, normalizedPrefix);
        setTreeNodes((current) =>
          updateTreeNodes(current, normalizedPrefix, (node) => ({
            ...node,
            children,
            isExpanded: shouldExpand ? true : node.isExpanded,
            isLoaded: true,
            isLoading: false,
          })),
        );
      } catch {
        if (!isCurrentRequest()) return;
        setTreeNodes((current) =>
          updateTreeNodes(current, normalizedPrefix, (node) => ({
            ...node,
            isLoaded: true,
            isLoading: false,
          })),
        );
      } finally {
        if (isCurrentRequest()) {
          requestControllersRef.current.delete(normalizedPrefix);
        }
      }
    },
    [
      accountSwitchInFlight,
      bucketName,
      currentBucketUnavailable,
      enabled,
      listTreePrefixes,
      onWarning,
    ],
  );

  useEffect(() => {
    if (
      accountSwitchInFlight ||
      !bucketName ||
      !enabled ||
      currentBucketUnavailable
    ) {
      setTreeNodes([]);
      return;
    }
    setTreeNodes([
      {
        id: "root",
        name: bucketName,
        prefix: "",
        children: [],
        isExpanded: true,
        isLoaded: false,
        isLoading: true,
      },
    ]);
    void loadTreeChildren("");
  }, [
    accountSwitchInFlight,
    bucketName,
    currentBucketUnavailable,
    enabled,
    loadTreeChildren,
  ]);

  useEffect(() => {
    if (
      !bucketName ||
      !enabled ||
      currentBucketUnavailable ||
      treeNodes.length === 0
    ) {
      return;
    }
    const rootNode = treeNodes.find((node) => node.prefix === "");
    if (!rootNode || rootNode.isLoading) return;
    const targetPrefix = prefix ? normalizePrefix(prefix) : "";
    if (!targetPrefix) {
      if (!rootNode.isExpanded) {
        setTreeNodes((current) =>
          updateTreeNodes(current, "", (node) => ({
            ...node,
            isExpanded: true,
          })),
        );
      }
      return;
    }
    const segments = targetPrefix.split("/").filter(Boolean);
    let currentPrefix = "";
    const prefixesToExpand: string[] = [];
    for (const segment of segments) {
      currentPrefix = `${currentPrefix}${segment}/`;
      prefixesToExpand.push(currentPrefix);
      const node = findTreeNodeByPrefix(treeNodes, currentPrefix);
      if (!node) return;
      if (!node.isLoaded && !node.isLoading) {
        void loadTreeChildren(currentPrefix);
        return;
      }
    }
    const prefixesNeedingExpansion = prefixesToExpand.filter((prefixKey) => {
      const node = findTreeNodeByPrefix(treeNodes, prefixKey);
      return Boolean(node && !node.isExpanded);
    });
    const needsRootExpansion = !rootNode.isExpanded;
    if (!needsRootExpansion && prefixesNeedingExpansion.length === 0) return;
    setTreeNodes((current) => {
      let next = current;
      if (needsRootExpansion) {
        next = updateTreeNodes(next, "", (node) => ({
          ...node,
          isExpanded: true,
        }));
      }
      prefixesNeedingExpansion.forEach((prefixKey) => {
        const node = findTreeNodeByPrefix(next, prefixKey);
        if (!node || node.isExpanded) return;
        next = updateTreeNodes(next, prefixKey, (entry) => ({
          ...entry,
          isExpanded: true,
        }));
      });
      return next;
    });
  }, [
    bucketName,
    currentBucketUnavailable,
    enabled,
    loadTreeChildren,
    prefix,
    treeNodes,
  ]);

  const toggleTreeNode = useCallback(
    (node: TreeNode) => {
      if (node.isExpanded) {
        setTreeNodes((current) =>
          updateTreeNodes(current, node.prefix, (entry) => ({
            ...entry,
            isExpanded: false,
          })),
        );
        return;
      }
      if (!node.isLoaded) {
        void loadTreeChildren(node.prefix);
        return;
      }
      setTreeNodes((current) =>
        updateTreeNodes(current, node.prefix, (entry) => ({
          ...entry,
          isExpanded: true,
        })),
      );
    },
    [loadTreeChildren],
  );

  useEffect(
    () => () => {
      invalidateRequests();
    },
    [invalidateRequests],
  );

  const treeRootNode = useMemo(
    () => treeNodes.find((node) => node.prefix === "") ?? null,
    [treeNodes],
  );

  return {
    loadTreeChildren,
    toggleTreeNode,
    treeRootNode,
  };
}

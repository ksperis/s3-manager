/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  listBrowserObjects,
  type BrowserObject,
} from "../../api/browser";

const RECURSIVE_LIST_PAGE_SIZE = 1000;

export type ListAllBrowserObjectsForPrefix = (
  prefix: string,
  bucketName?: string,
  accountId?: S3AccountSelector,
  signal?: AbortSignal,
) => Promise<BrowserObject[]>;

type UseBrowserRecursiveObjectListingOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  enabled: boolean;
  requestOptions?: BrowserRequestOptions;
};

export function useBrowserRecursiveObjectListing({
  accountId,
  bucketName,
  enabled,
  requestOptions,
}: UseBrowserRecursiveObjectListingOptions): ListAllBrowserObjectsForPrefix {
  return useCallback(
    async (
      prefix: string,
      targetBucketName?: string,
      targetAccountId?: S3AccountSelector,
      signal?: AbortSignal,
    ) => {
      const resolvedBucketName = targetBucketName ?? bucketName;
      if (!resolvedBucketName || !enabled) return [];

      const objects: BrowserObject[] = [];
      let continuationToken: string | null = null;
      let hasMore = true;
      while (hasMore) {
        const page = await listBrowserObjects(
          targetAccountId ?? accountId,
          resolvedBucketName,
          {
            prefix,
            continuationToken,
            maxKeys: RECURSIVE_LIST_PAGE_SIZE,
            type: "file",
            recursive: true,
            signal,
            ...requestOptions,
          },
        );
        objects.push(...page.objects);
        continuationToken = page.next_continuation_token ?? null;
        hasMore = Boolean(page.is_truncated && continuationToken);
      }
      return objects;
    },
    [accountId, bucketName, enabled, requestOptions],
  );
}

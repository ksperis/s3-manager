/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browser";
import {
  VERSIONS_LIST_HARD_LIMIT,
  VERSIONS_PAGE_SIZE,
} from "./browserConstants";
import { useBrowserVersionListing } from "./useBrowserVersionListing";

type UseBrowserPrefixVersionsOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  contextEnabled: boolean;
  onHardLimit: () => void;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
  versioningEnabled: boolean;
};

export function useBrowserPrefixVersions({
  accountId,
  bucketName,
  contextEnabled,
  onHardLimit,
  prefix,
  requestOptions,
  versioningEnabled,
}: UseBrowserPrefixVersionsOptions) {
  const [visible, setVisible] = useState(false);
  const { canLoadMore, error, load, loading, rows } =
    useBrowserVersionListing({
      accountId,
      autoLoad: true,
      bucketName,
      enabled: visible && contextEnabled && versioningEnabled,
      errorMessage: "Unable to list versions for this prefix.",
      hardLimit: VERSIONS_LIST_HARD_LIMIT,
      onHardLimit,
      pageSize: VERSIONS_PAGE_SIZE,
      prefix,
      requestOptions,
    });

  useEffect(() => {
    if (!versioningEnabled) setVisible(false);
  }, [versioningEnabled]);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const refresh = useCallback(() => load({ force: true }), [load]);
  const refreshIfVisible = useCallback(async () => {
    if (!visible) return;
    await load({ force: true });
  }, [load, visible]);
  const loadMore = useCallback(() => load({ append: true }), [load]);

  return {
    canLoadMore,
    close,
    error,
    loadMore,
    loading,
    open,
    refresh,
    refreshIfVisible,
    rows,
    visible,
  };
}

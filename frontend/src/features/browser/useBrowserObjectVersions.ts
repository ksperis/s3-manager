/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import { type BrowserObjectVersion } from "../../api/browserContracts";
import { runBrowserScopedSave } from "./browserScopedSave";
import { useBrowserVersionListing } from "./useBrowserVersionListing";

type ObjectVersionAction = "restore" | "delete";

type UseBrowserObjectVersionsOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  enabled: boolean;
  onDeleteVersion: (version: BrowserObjectVersion) => Promise<void> | void;
  onRestoreVersion: (version: BrowserObjectVersion) => Promise<void> | void;
  objectKey: string;
  requestOptions?: BrowserRequestOptions;
};

export function useBrowserObjectVersions({
  accountId,
  bucketName,
  enabled,
  onDeleteVersion,
  onRestoreVersion,
  objectKey,
  requestOptions,
}: UseBrowserObjectVersionsOptions) {
  const [savingAction, setSavingAction] = useState(false);
  const {
    canLoadMore,
    error,
    isCurrentScope,
    latestRow,
    load,
    loaded,
    loading,
    rows,
  } = useBrowserVersionListing({
    accountId,
    bucketName,
    enabled,
    objectKey,
    requestOptions,
  });

  const runAction = useCallback(
    async (action: ObjectVersionAction, version: BrowserObjectVersion) => {
      if (!isCurrentScope() || !enabled) return false;
      return (
        (await runBrowserScopedSave(
          isCurrentScope,
          setSavingAction,
          async () => {
            if (action === "restore") {
              await onRestoreVersion(version);
            } else {
              await onDeleteVersion(version);
            }
            if (!isCurrentScope()) return false;
            await load({ force: true });
            return true;
          },
        )) ?? false
      );
    },
    [
      enabled,
      isCurrentScope,
      load,
      onDeleteVersion,
      onRestoreVersion,
    ],
  );

  useEffect(() => setSavingAction(false), [isCurrentScope]);

  return {
    rows,
    latestRow,
    loading,
    loaded,
    error,
    savingAction,
    canLoadMore,
    load,
    isCurrentScope,
    runAction,
  };
}

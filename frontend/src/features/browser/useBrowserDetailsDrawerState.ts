/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import type { BrowserItem, ObjectDetailsTabId } from "./browserTypes";

type ObjectDetailsTarget = {
  item: BrowserItem;
  initialTab: ObjectDetailsTabId;
  intent?: "create-public-link";
};

type UseBrowserDetailsDrawerStateOptions = {
  scopeKey: string;
  versioningEnabled: boolean;
  onRequestDiscardChanges: (onConfirm: () => void) => void;
};

export function useBrowserDetailsDrawerState({
  scopeKey,
  versioningEnabled,
  onRequestDiscardChanges,
}: UseBrowserDetailsDrawerStateOptions) {
  const [objectTarget, setObjectTarget] =
    useState<ObjectDetailsTarget | null>(null);
  const [bucketName, setBucketName] = useState<string | null>(null);
  const [objectDirty, setObjectDirty] = useState(false);
  const [bucketDirty, setBucketDirty] = useState(false);

  const closeObject = useCallback(() => {
    setObjectDirty(false);
    setObjectTarget(null);
  }, []);

  const closeBucket = useCallback(() => {
    setBucketDirty(false);
    setBucketName(null);
  }, []);

  const closeAll = useCallback(() => {
    setObjectDirty(false);
    setBucketDirty(false);
    setObjectTarget(null);
    setBucketName(null);
  }, []);

  useEffect(() => {
    closeAll();
  }, [closeAll, scopeKey]);

  useEffect(() => {
    if (versioningEnabled || objectTarget?.initialTab !== "versions") return;
    closeObject();
  }, [closeObject, objectTarget?.initialTab, versioningEnabled]);

  const openObject = useCallback(
    (
      item: BrowserItem,
      initialTab: ObjectDetailsTabId,
      intent?: "create-public-link",
    ) => {
      setObjectTarget({ item, initialTab, intent });
    },
    [],
  );

  const openBucket = useCallback((nextBucketName: string) => {
    setBucketName(nextBucketName);
  }, []);

  const hasUnsavedChanges = objectDirty || bucketDirty;
  const requestTransition = useCallback(
    (transition: () => void): boolean => {
      const completeTransition = () => {
        closeAll();
        transition();
      };

      if (!hasUnsavedChanges) {
        completeTransition();
        return true;
      }

      onRequestDiscardChanges(completeTransition);
      return false;
    },
    [closeAll, hasUnsavedChanges, onRequestDiscardChanges],
  );

  return {
    bucketName,
    closeBucket,
    closeObject,
    hasUnsavedChanges,
    objectTarget,
    openBucket,
    openObject,
    requestTransition,
    setBucketDirty,
    setObjectDirty,
  };
}

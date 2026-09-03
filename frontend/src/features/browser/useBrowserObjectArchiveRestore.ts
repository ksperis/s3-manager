/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import { restoreObject } from "../../api/browser";
import type { ObjectRestoreRequest } from "../../api/browserContracts";
import { runBrowserScopedSave } from "./browserScopedSave";

export type ObjectRestoreTier = "Standard" | "Bulk" | "Expedited";
type RestoreArchiveResult = "restored" | "invalid" | "skipped";

type UseBrowserObjectArchiveRestoreOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  loadProperties: (force?: boolean) => Promise<void>;
  objectKey: string;
  requestOptions?: BrowserRequestOptions;
  versionId?: string | null;
};

export function useBrowserObjectArchiveRestore({
  accountId,
  bucketName,
  loadProperties,
  objectKey,
  requestOptions,
  versionId,
}: UseBrowserObjectArchiveRestoreOptions) {
  const scope = JSON.stringify([
    accountId,
    bucketName,
    objectKey,
    requestOptions?.workspaceSurface ?? null,
    versionId ?? null,
  ]);
  const [days, setDays] = useState("7");
  const [tier, setTier] = useState<ObjectRestoreTier>("Standard");
  const [saving, setSaving] = useState(false);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const isCurrentScope = useCallback(
    () => scope === scopeRef.current,
    [scope],
  );

  const reset = useCallback(() => {
    setDays("7");
    setTier("Standard");
    setSaving(false);
  }, []);

  const restore = useCallback(async (): Promise<RestoreArchiveResult> => {
    if (!isCurrentScope() || !accountId || !bucketName || !objectKey) {
      return "skipped";
    }
    const restoreDays = Number(days);
    if (!Number.isFinite(restoreDays) || restoreDays <= 0) return "invalid";

    return (
      (await runBrowserScopedSave(isCurrentScope, setSaving, async () => {
        await restoreObject(
          accountId,
          bucketName,
          {
            key: objectKey,
            days: restoreDays,
            tier,
            version_id: versionId ?? null,
          } satisfies ObjectRestoreRequest,
          requestOptions,
        );
        if (!isCurrentScope()) return "skipped" as const;
        await loadProperties(true);
        return "restored" as const;
      })) ?? "skipped"
    );
  }, [
    accountId,
    bucketName,
    days,
    isCurrentScope,
    loadProperties,
    objectKey,
    requestOptions,
    tier,
    versionId,
  ]);

  useEffect(() => reset(), [reset, scope]);

  return {
    days,
    setDays,
    tier,
    setTier,
    saving,
    isCurrentScope,
    restore,
  };
}

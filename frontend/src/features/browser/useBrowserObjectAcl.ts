/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  updateObjectAcl,
  type BrowserRequestOptions,
} from "../../api/browser";
import { runBrowserScopedSave } from "./browserScopedSave";

type UseBrowserObjectAclOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  objectKey: string;
  requestOptions?: BrowserRequestOptions;
  versionId?: string | null;
};

export function useBrowserObjectAcl({
  accountId,
  bucketName,
  objectKey,
  requestOptions,
  versionId,
}: UseBrowserObjectAclOptions) {
  const scope = JSON.stringify([
    accountId,
    bucketName,
    objectKey,
    requestOptions?.workspaceSurface ?? null,
    versionId ?? null,
  ]);
  const [value, setValue] = useState("private");
  const [saving, setSaving] = useState(false);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const isCurrentScope = useCallback(
    () => scope === scopeRef.current,
    [scope],
  );

  const reset = useCallback(() => {
    setValue("private");
    setSaving(false);
  }, []);

  const save = useCallback(async () => {
    if (!isCurrentScope() || !accountId || !bucketName || !objectKey) {
      return false;
    }
    return (
      (await runBrowserScopedSave(isCurrentScope, setSaving, async () => {
        await updateObjectAcl(
          accountId,
          bucketName,
          {
            key: objectKey,
            acl: value,
            version_id: versionId ?? null,
          },
          undefined,
          requestOptions,
        );
        return true;
      })) ?? false
    );
  }, [
    accountId,
    bucketName,
    isCurrentScope,
    objectKey,
    requestOptions,
    value,
    versionId,
  ]);

  useEffect(() => reset(), [reset, scope]);

  return {
    value,
    setValue,
    saving,
    isCurrentScope,
    save,
  };
}

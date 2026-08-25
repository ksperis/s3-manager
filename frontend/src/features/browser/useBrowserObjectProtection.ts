/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  getObjectLegalHold,
  getObjectRetention,
  updateObjectLegalHold,
  updateObjectRetention,
  type BrowserRequestOptions,
  type ObjectLegalHold,
  type ObjectRetention,
} from "../../api/browser";
import { extractApiError } from "../../utils/apiError";
import { formatLocalDateTime, toIsoString } from "./browserUtils";
import { isObjectLockUnavailableMessage } from "./browserObjectDetailsModel";
import { runBrowserScopedSave } from "./browserScopedSave";

export type ObjectRetentionMode = "" | "GOVERNANCE" | "COMPLIANCE";
type SaveObjectRetentionResult = "saved" | "invalid" | "skipped";

type UseBrowserObjectProtectionOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  enabled: boolean;
  objectKey: string;
  requestOptions?: BrowserRequestOptions;
  versionId?: string | null;
};

export function useBrowserObjectProtection({
  accountId,
  bucketName,
  enabled,
  objectKey,
  requestOptions,
  versionId,
}: UseBrowserObjectProtectionOptions) {
  const scope = JSON.stringify([
    accountId,
    bucketName,
    objectKey,
    requestOptions?.workspaceSurface ?? null,
    versionId ?? null,
  ]);
  const [legalHoldStatus, setLegalHoldStatus] = useState<"ON" | "OFF">("OFF");
  const [legalHoldError, setLegalHoldError] = useState<string | null>(null);
  const [retentionMode, setRetentionMode] = useState<ObjectRetentionMode>("");
  const [retentionDate, setRetentionDate] = useState("");
  const [retentionBypass, setRetentionBypass] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [objectLockUnavailable, setObjectLockUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingLegalHold, setSavingLegalHold] = useState(false);
  const [savingRetention, setSavingRetention] = useState(false);
  const legalHoldLoadedRef = useRef(false);
  const retentionLoadedRef = useRef(false);
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    legalHoldLoadedRef.current = false;
    retentionLoadedRef.current = false;
    loadingRef.current = false;
    setLegalHoldStatus("OFF");
    setLegalHoldError(null);
    setRetentionMode("");
    setRetentionDate("");
    setRetentionBypass(false);
    setRetentionError(null);
    setObjectLockUnavailable(false);
    setLoading(false);
    setSavingLegalHold(false);
    setSavingRetention(false);
  }, []);

  const isCurrentScope = useCallback(
    () => scope === scopeRef.current,
    [scope],
  );

  const load = useCallback(
    async (force = false) => {
      if (scope !== scopeRef.current) return;
      if (!accountId || !bucketName || !objectKey) return;
      if (
        !force &&
        ((legalHoldLoadedRef.current && retentionLoadedRef.current) ||
          loadingRef.current)
      ) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      loadingRef.current = true;
      setLoading(true);
      setLegalHoldError(null);
      setRetentionError(null);
      setObjectLockUnavailable(false);

      try {
        const [nextLegalHold, nextRetention] = await Promise.allSettled([
          getObjectLegalHold(
            accountId,
            bucketName,
            objectKey,
            versionId ?? null,
            requestOptions,
          ),
          getObjectRetention(
            accountId,
            bucketName,
            objectKey,
            versionId ?? null,
            requestOptions,
          ),
        ]);
        if (requestId !== requestIdRef.current) return;

        const legalHoldFailure =
          nextLegalHold.status === "rejected"
            ? extractApiError(
                nextLegalHold.reason,
                "Unable to load legal hold.",
              )
            : null;
        const retentionFailure =
          nextRetention.status === "rejected"
            ? extractApiError(nextRetention.reason, "Unable to load retention.")
            : null;
        const unavailable = [legalHoldFailure, retentionFailure]
          .filter((message): message is string => Boolean(message))
          .some((message) => isObjectLockUnavailableMessage(message));

        if (unavailable) {
          legalHoldLoadedRef.current = true;
          retentionLoadedRef.current = true;
          setLegalHoldStatus("OFF");
          setRetentionMode("");
          setRetentionDate("");
          setRetentionBypass(false);
          setLegalHoldError(null);
          setRetentionError(null);
          setObjectLockUnavailable(true);
          return;
        }

        if (nextLegalHold.status === "fulfilled") {
          legalHoldLoadedRef.current = true;
          setLegalHoldStatus(
            nextLegalHold.value.status === "ON" ? "ON" : "OFF",
          );
          setLegalHoldError(null);
        } else {
          legalHoldLoadedRef.current = false;
          setLegalHoldError(legalHoldFailure);
        }

        if (nextRetention.status === "fulfilled") {
          retentionLoadedRef.current = true;
          setRetentionMode(nextRetention.value.mode ?? "");
          setRetentionDate(
            formatLocalDateTime(nextRetention.value.retain_until),
          );
          setRetentionError(null);
        } else {
          retentionLoadedRef.current = false;
          setRetentionError(retentionFailure);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [accountId, bucketName, objectKey, requestOptions, scope, versionId],
  );

  const saveLegalHold = useCallback(async () => {
    if (
      !isCurrentScope() ||
      !accountId ||
      !bucketName ||
      !objectKey ||
      objectLockUnavailable
    ) {
      return false;
    }
    return (
      (await runBrowserScopedSave(isCurrentScope, setSavingLegalHold, async () => {
        await updateObjectLegalHold(
          accountId,
          bucketName,
          {
            key: objectKey,
            status: legalHoldStatus,
            version_id: versionId ?? null,
          } satisfies ObjectLegalHold,
          undefined,
          requestOptions,
        );
        await load(true);
        return true;
      })) ?? false
    );
  }, [
    accountId,
    bucketName,
    isCurrentScope,
    legalHoldStatus,
    load,
    objectKey,
    objectLockUnavailable,
    requestOptions,
    versionId,
  ]);

  const saveRetention = useCallback(
    async (): Promise<SaveObjectRetentionResult> => {
      if (
        !isCurrentScope() ||
        !accountId ||
        !bucketName ||
        !objectKey ||
        !retentionMode ||
        !retentionDate ||
        objectLockUnavailable
      ) {
        return "skipped";
      }
      const retainUntil = toIsoString(retentionDate);
      if (!retainUntil) return "invalid";

      return (
        (await runBrowserScopedSave(
          isCurrentScope,
          setSavingRetention,
          async () => {
            await updateObjectRetention(
              accountId,
              bucketName,
              {
                key: objectKey,
                mode: retentionMode,
                retain_until: retainUntil,
                bypass_governance: retentionBypass,
                version_id: versionId ?? null,
              } satisfies ObjectRetention,
              undefined,
              requestOptions,
            );
            await load(true);
            return "saved" as const;
          },
        )) ?? "skipped"
      );
    },
    [
      accountId,
      bucketName,
      isCurrentScope,
      load,
      objectKey,
      objectLockUnavailable,
      requestOptions,
      retentionBypass,
      retentionDate,
      retentionMode,
      versionId,
    ],
  );

  useEffect(() => reset(), [reset, scope]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  return {
    legalHoldStatus,
    setLegalHoldStatus,
    legalHoldError,
    retentionMode,
    setRetentionMode,
    retentionDate,
    setRetentionDate,
    retentionBypass,
    setRetentionBypass,
    retentionError,
    objectLockUnavailable,
    loading,
    savingLegalHold,
    savingRetention,
    load,
    isCurrentScope,
    saveLegalHold,
    saveRetention,
  };
}

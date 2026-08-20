/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  getStsCredentials,
  getStsStatus,
  type BrowserRequestOptions,
  type StsCredentials,
  type StsStatus,
} from "../../api/browser";
import { extractApiError } from "../../utils/apiError";
import { isStsCredentialsExpiring } from "./browserTransferPresentation";

type ScopedValue<T> = {
  scopeKey: string;
  value: T;
};

type InFlightCredentials = {
  scopeKey: string;
  request: Promise<StsCredentials | null>;
};

type UseBrowserStsSessionOptions = {
  accountIdForApi: S3AccountSelector;
  enabled: boolean;
  hasContext: boolean;
  requestOptions?: BrowserRequestOptions;
};

function createScopeKey(
  accountIdForApi: S3AccountSelector,
  requestOptions?: BrowserRequestOptions,
): string {
  return `${String(accountIdForApi ?? "")}::${requestOptions?.workspaceSurface ?? "browser"}`;
}

export function useBrowserStsSession({
  accountIdForApi,
  enabled,
  hasContext,
  requestOptions,
}: UseBrowserStsSessionOptions) {
  const scopeKey =
    enabled && hasContext
      ? createScopeKey(accountIdForApi, requestOptions)
      : null;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;

  const [statusState, setStatusState] =
    useState<ScopedValue<StsStatus> | null>(null);
  const [credentialsState, setCredentialsState] =
    useState<ScopedValue<StsCredentials> | null>(null);
  const [errorState, setErrorState] =
    useState<ScopedValue<string> | null>(null);
  const credentialsCacheRef = useRef<ScopedValue<StsCredentials> | null>(null);
  const inFlightRef = useRef<InFlightCredentials | null>(null);

  const status = statusState?.scopeKey === scopeKey ? statusState.value : null;
  const credentials =
    credentialsState?.scopeKey === scopeKey ? credentialsState.value : null;
  const credentialsError =
    errorState?.scopeKey === scopeKey ? errorState.value : null;

  const ensureCredentials = useCallback(
    async (force = false): Promise<StsCredentials | null> => {
      if (!scopeKey || !status?.available) return null;

      const cached = credentialsCacheRef.current;
      if (
        !force &&
        cached?.scopeKey === scopeKey &&
        !isStsCredentialsExpiring(cached.value.expiration)
      ) {
        return cached.value;
      }

      const inFlight = inFlightRef.current;
      if (inFlight?.scopeKey === scopeKey) {
        return inFlight.request;
      }

      const requestedScopeKey = scopeKey;
      const request = getStsCredentials(accountIdForApi, requestOptions)
        .then((nextCredentials) => {
          if (activeScopeRef.current !== requestedScopeKey) return null;
          const scopedCredentials = {
            scopeKey: requestedScopeKey,
            value: nextCredentials,
          };
          credentialsCacheRef.current = scopedCredentials;
          setCredentialsState(scopedCredentials);
          setErrorState(null);
          return nextCredentials;
        })
        .catch((requestError) => {
          if (activeScopeRef.current !== requestedScopeKey) return null;
          credentialsCacheRef.current = null;
          setCredentialsState(null);
          setErrorState({
            scopeKey: requestedScopeKey,
            value: extractApiError(
              requestError,
              "Unable to load STS credentials.",
            ),
          });
          return null;
        })
        .finally(() => {
          if (inFlightRef.current?.request === request) {
            inFlightRef.current = null;
          }
        });
      inFlightRef.current = { scopeKey: requestedScopeKey, request };
      return request;
    }, [accountIdForApi, requestOptions, scopeKey, status?.available],
  );

  useEffect(() => {
    credentialsCacheRef.current = null;
    setStatusState(null);
    setCredentialsState(null);
    setErrorState(null);
    if (!scopeKey) return;

    let active = true;
    getStsStatus(accountIdForApi, requestOptions)
      .then((nextStatus) => {
        if (!active || activeScopeRef.current !== scopeKey) return;
        setStatusState({ scopeKey, value: nextStatus });
      })
      .catch((statusError) => {
        if (!active || activeScopeRef.current !== scopeKey) return;
        setStatusState({
          scopeKey,
          value: {
            available: false,
            error: extractApiError(
              statusError,
              "Unable to reach STS endpoint.",
            ),
          },
        });
      });
    return () => {
      active = false;
    };
  }, [accountIdForApi, requestOptions, scopeKey]);

  useEffect(() => {
    if (!status?.available) return;
    void ensureCredentials(true);
  }, [ensureCredentials, status?.available]);

  return {
    available: Boolean(scopeKey && status?.available),
    credentials,
    credentialsError,
    ensureCredentials,
  };
}

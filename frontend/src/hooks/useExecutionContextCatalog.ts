/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  listExecutionContexts,
  type ExecutionContext,
} from "../api/executionContexts";
import {
  readClientStorage,
  removeClientStorage,
  writeClientStorage,
} from "../utils/clientStorage";
import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../utils/executionContextRefresh";
import { resolveUrlScopedSelection } from "../utils/urlScopedSelection";
import { readStoredUser } from "../utils/workspaces";

const EXECUTION_CONTEXT_URL_PARAM = "ctx";

type ExecutionContextSelectionPolicy = "first-available" | "explicit";

type UseExecutionContextCatalogOptions = {
  scope: "manager" | "browser";
  storageKey: Parameters<typeof readClientStorage>[0];
  selectionPolicy: ExecutionContextSelectionPolicy;
  accessDeniedMessage: string;
  revokedSelectionMessage: string;
};

type SessionInfo = {
  isSession: boolean;
  accountName: string | null;
};

function readSessionInfo(): SessionInfo {
  const user = readStoredUser();
  if (!user) {
    return { isSession: false, accountName: null };
  }
  return {
    isSession: user.authType === "s3_session",
    accountName: user.accountName ?? user.accountId ?? null,
  };
}

export function useExecutionContextCatalog({
  scope,
  storageKey,
  selectionPolicy,
  accessDeniedMessage,
  revokedSelectionMessage,
}: UseExecutionContextCatalogOptions) {
  const sessionInfo = useMemo(readSessionInfo, []);
  const requiresSelection = !sessionInfo.isSession;
  const [contexts, setContexts] = useState<ExecutionContext[]>([]);
  const [contextsLoaded, setContextsLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedContextId, setSelectedContextIdState] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const handleRefresh = () => setRefreshToken((value) => value + 1);
    window.addEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, handleRefresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setAccessError(null);
      setLoadFailed(false);
      if (!requiresSelection) {
        setContexts([]);
        setContextsLoaded(true);
        return;
      }
      try {
        const data = await listExecutionContexts(scope, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setContexts(Array.isArray(data) ? data : []);
      } catch {
        if (controller.signal.aborted) return;
        setContexts([]);
        setLoadFailed(true);
        setAccessError(accessDeniedMessage);
      } finally {
        if (!controller.signal.aborted) {
          setContextsLoaded(true);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [accessDeniedMessage, refreshToken, requiresSelection, scope]);

  useEffect(() => {
    const clearSelection = () => {
      setSelectedContextIdState(null);
      removeClientStorage(storageKey);
      if (!searchParams.has(EXECUTION_CONTEXT_URL_PARAM)) return;
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
      setSearchParams(nextParams, { replace: true });
    };

    if (!requiresSelection) {
      clearSelection();
      return;
    }
    if (!contextsLoaded || loadFailed) return;

    const availableIds = contexts.map((context) => context.id);
    const urlContext = searchParams.get(EXECUTION_CONTEXT_URL_PARAM);
    const storedContext = readClientStorage(storageKey);
    const requestedContext = urlContext ?? selectedContextId ?? storedContext;
    const nextId = selectionPolicy === "first-available"
      ? resolveUrlScopedSelection({
          availableIds,
          urlValue: urlContext,
          currentValue: selectedContextId,
          fallbackValues: [storedContext],
        })
      : requestedContext && availableIds.includes(requestedContext)
        ? requestedContext
        : null;

    if (!nextId) {
      const requestedContextWasRevoked = Boolean(requestedContext);
      clearSelection();
      if (selectionPolicy === "explicit" && requestedContextWasRevoked) {
        setAccessError(revokedSelectionMessage);
      }
      return;
    }

    if (nextId !== selectedContextId) {
      setSelectedContextIdState(nextId);
    }
    writeClientStorage(storageKey, nextId);
    if (urlContext !== nextId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, nextId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    contexts,
    contextsLoaded,
    loadFailed,
    requiresSelection,
    revokedSelectionMessage,
    searchParams,
    selectedContextId,
    selectionPolicy,
    setSearchParams,
    storageKey,
  ]);

  const setSelectedContextId = (id: string | null) => {
    if (!requiresSelection) return;
    setAccessError(null);
    setSelectedContextIdState(id);
    const nextParams = new URLSearchParams(searchParams);
    if (id === null) {
      removeClientStorage(storageKey);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
    } else {
      writeClientStorage(storageKey, id);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, id);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const selectedContext = useMemo(
    () => contexts.find((context) => context.id === selectedContextId) ?? null,
    [contexts, selectedContextId],
  );

  return {
    contexts,
    contextsLoaded,
    selectedContextId,
    selectedContext,
    setSelectedContextId,
    requiresSelection,
    accessError,
    sessionAccountName: sessionInfo.accountName,
  };
}

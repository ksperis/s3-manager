/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { S3AccountSelector } from "../../api/accountParams";
import { ExecutionContext, ExecutionContextKind, listExecutionContexts } from "../../api/executionContexts";
import { CLIENT_STORAGE_KEYS, readClientJson, readClientStorage, removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";

const EXECUTION_CONTEXT_STORAGE_KEY = CLIENT_STORAGE_KEYS.selectedBrowserExecutionContext;
const EXECUTION_CONTEXT_URL_PARAM = "ctx";

type BrowserContextState = {
  contexts: ExecutionContext[];
  contextsLoaded: boolean;
  selectedContextId: string | null;
  selectedContext: ExecutionContext | null;
  setSelectedContextId: (id: string | null) => void;
  requiresContextSelection: boolean;
  hasContext: boolean;
  selectorForApi: S3AccountSelector;
  selectedKind: ExecutionContextKind | null;
  sessionAccountName: string | null;
  accessError?: string | null;
};

const Ctx = createContext<BrowserContextState>({
  contexts: [],
  contextsLoaded: false,
  selectedContextId: null,
  selectedContext: null,
  setSelectedContextId: () => {},
  requiresContextSelection: true,
  hasContext: false,
  selectorForApi: null,
  selectedKind: null,
  sessionAccountName: null,
  accessError: null,
});

type SessionInfo = {
  isSession: boolean;
  accountName: string | null;
};

function readSessionInfo(): SessionInfo {
  if (typeof window === "undefined") {
    return { isSession: false, accountName: null };
  }
  const parsed = readClientJson<{ authType?: string | null; accountName?: string | null; accountId?: string | null }>(
    CLIENT_STORAGE_KEYS.sessionUser
  );
  if (!parsed) {
    return { isSession: false, accountName: null };
  }
  const isSession = parsed.authType === "s3_session";
  const accountName = parsed.accountName ?? parsed.accountId ?? null;
  return { isSession, accountName };
}

export function BrowserContextProvider({ children }: { children: ReactNode }) {
  const sessionInfo = useMemo(() => readSessionInfo(), []);
  const requiresContextSelection = !sessionInfo.isSession;
  const [contexts, setContexts] = useState<ExecutionContext[]>([]);
  const [contextsRefreshToken, setContextsRefreshToken] = useState(0);
  const [selectedContextId, setSelectedContextIdState] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [contextsLoaded, setContextsLoaded] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRefresh = () => setContextsRefreshToken((value) => value + 1);
    window.addEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, handleRefresh);
  }, []);

  useEffect(() => {
    const load = async () => {
      setAccessError(null);
      if (!requiresContextSelection) {
        setContexts([]);
        return;
      }
      try {
        const data = await listExecutionContexts("browser");
        setContexts(data);
        setContextsLoaded(true);
      } catch {
        setContexts([]);
        setContextsLoaded(true);
        setAccessError("Access to /browser is denied for this user.");
      }
    };
    load();
  }, [contextsRefreshToken, requiresContextSelection]);

  useEffect(() => {
    if (!requiresContextSelection) {
      setSelectedContextIdState(null);
      removeClientStorage(EXECUTION_CONTEXT_STORAGE_KEY);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
      setSearchParams(nextParams, { replace: true });
      return;
    }
    if (!contextsLoaded) return;
    const urlContext = searchParams.get(EXECUTION_CONTEXT_URL_PARAM);
    const storedContext = readClientStorage(EXECUTION_CONTEXT_STORAGE_KEY);
    const nextId = urlContext || selectedContextId || storedContext;
    if (!nextId) return;
    if (!contexts.some((context) => context.id === nextId)) {
      setSelectedContextIdState(null);
      removeClientStorage(EXECUTION_CONTEXT_STORAGE_KEY);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
      setSearchParams(nextParams, { replace: true });
      setAccessError("The previously selected Browser account is no longer authorized. Select an available account.");
      return;
    }
    if (nextId !== selectedContextId) {
      setSelectedContextIdState(nextId);
    }
    writeClientStorage(EXECUTION_CONTEXT_STORAGE_KEY, nextId);
    if (urlContext !== nextId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, nextId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [contexts, contextsLoaded, requiresContextSelection, searchParams, selectedContextId, setSearchParams]);

  const setSelectedContextId = (id: string | null) => {
    if (!requiresContextSelection) {
      return;
    }
    setSelectedContextIdState(id);
    if (id == null) {
      removeClientStorage(EXECUTION_CONTEXT_STORAGE_KEY);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
      setSearchParams(nextParams, { replace: true });
    } else {
      writeClientStorage(EXECUTION_CONTEXT_STORAGE_KEY, id);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, id);
      setSearchParams(nextParams, { replace: true });
    }
  };

  const selected = useMemo(() => contexts.find((c) => c.id === selectedContextId), [contexts, selectedContextId]);
  const selectedKind = selected?.kind ?? null;
  const hasContext = requiresContextSelection ? selected != null : true;
  const selectorForApi: S3AccountSelector = requiresContextSelection ? selectedContextId : null;

  return (
    <Ctx.Provider
      value={{
        contexts,
        contextsLoaded,
        selectedContextId,
        selectedContext: selected ?? null,
        setSelectedContextId,
        requiresContextSelection,
        hasContext,
        selectorForApi,
        selectedKind,
        sessionAccountName: sessionInfo.accountName,
        accessError,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useBrowserContext() {
  return useContext(Ctx);
}

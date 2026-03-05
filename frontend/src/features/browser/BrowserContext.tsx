/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { S3AccountSelector } from "../../api/accountParams";
import { ExecutionContext, ExecutionContextKind, listExecutionContexts } from "../../api/executionContexts";
export type BrowserAccessMode = "admin" | "portal";

const EXECUTION_CONTEXT_STORAGE_KEY = "selectedExecutionContextId";
const EXECUTION_CONTEXT_URL_PARAM = "ctx";

type BrowserContextState = {
  contexts: ExecutionContext[];
  selectedContextId: string | null;
  setSelectedContextId: (id: string | null) => void;
  requiresContextSelection: boolean;
  hasContext: boolean;
  selectorForApi: S3AccountSelector;
  selectedKind: ExecutionContextKind | null;
  sessionAccountName: string | null;
  accessMode: BrowserAccessMode | null;
  setAccessMode: (mode: BrowserAccessMode) => void;
  canSwitchAccess: boolean;
  accessError?: string | null;
};

const Ctx = createContext<BrowserContextState>({
  contexts: [],
  selectedContextId: null,
  setSelectedContextId: () => {},
  requiresContextSelection: true,
  hasContext: false,
  selectorForApi: null,
  selectedKind: null,
  sessionAccountName: null,
  accessMode: null,
  setAccessMode: () => {},
  canSwitchAccess: false,
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
  const raw = localStorage.getItem("user");
  if (!raw) {
    return { isSession: false, accountName: null };
  }
  try {
    const parsed = JSON.parse(raw) as { authType?: string | null; accountName?: string | null; accountId?: string | null };
    const isSession = parsed.authType === "s3_session";
    const accountName = parsed.accountName ?? parsed.accountId ?? null;
    return { isSession, accountName };
  } catch {
    return { isSession: false, accountName: null };
  }
}

export function BrowserContextProvider({ children }: { children: ReactNode }) {
  const sessionInfo = useMemo(() => readSessionInfo(), []);
  const requiresContextSelection = !sessionInfo.isSession;
  const [contexts, setContexts] = useState<ExecutionContext[]>([]);
  const [selectedContextId, setSelectedContextIdState] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessMode, setAccessModeState] = useState<BrowserAccessMode | null>(null);
  const [canSwitchAccess, setCanSwitchAccess] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

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
      } catch {
        setContexts([]);
        setAccessError("Access to /browser is denied for this user.");
      }
    };
    load();
  }, [requiresContextSelection]);

  useEffect(() => {
    if (!requiresContextSelection) {
      setSelectedContextIdState(null);
      localStorage.removeItem(EXECUTION_CONTEXT_STORAGE_KEY);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
      setSearchParams(nextParams, { replace: true });
      return;
    }
    if (contexts.length === 0) return;
    const urlContext = searchParams.get(EXECUTION_CONTEXT_URL_PARAM);
    const stored = localStorage.getItem(EXECUTION_CONTEXT_STORAGE_KEY);
    if (urlContext && contexts.some((context) => context.id === urlContext)) {
      if (urlContext !== selectedContextId) {
        setSelectedContextIdState(urlContext);
      }
      localStorage.setItem(EXECUTION_CONTEXT_STORAGE_KEY, urlContext);
      return;
    }
    if (stored && contexts.some((context) => context.id === stored)) {
      if (stored !== selectedContextId) {
        setSelectedContextIdState(stored);
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, stored);
      setSearchParams(nextParams, { replace: true });
      return;
    }
    const selectedExists = selectedContextId ? contexts.some((context) => context.id === selectedContextId) : false;
    if (!selectedContextId || !selectedExists) {
      const nextId = contexts[0].id;
      setSelectedContextIdState(nextId);
      localStorage.setItem(EXECUTION_CONTEXT_STORAGE_KEY, nextId);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, nextId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [contexts, requiresContextSelection, searchParams, selectedContextId, setSearchParams]);

  const setSelectedContextId = (id: string | null) => {
    if (!requiresContextSelection) {
      return;
    }
    setSelectedContextIdState(id);
    if (id == null) {
      localStorage.removeItem(EXECUTION_CONTEXT_STORAGE_KEY);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
      setSearchParams(nextParams, { replace: true });
    } else {
      localStorage.setItem(EXECUTION_CONTEXT_STORAGE_KEY, id);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, id);
      setSearchParams(nextParams, { replace: true });
    }
  };

  const selected = useMemo(() => contexts.find((c) => c.id === selectedContextId), [contexts, selectedContextId]);
  const selectedKind = selected?.kind ?? null;
  const hasContext = requiresContextSelection ? selected != null : true;
  const selectorForApi: S3AccountSelector = requiresContextSelection ? selectedContextId : null;

  // For step 2, we keep /browser simple: no root/portal switching.
  useEffect(() => {
    setAccessModeState(null);
    setCanSwitchAccess(false);
  }, [selectedContextId, selectedKind]);

  const setAccessMode = (mode: BrowserAccessMode) => {
    if (!selectedContextId) return;
    localStorage.setItem(`browserAccessMode:${selectedContextId}`, mode);
    setAccessModeState(mode);
  };

  return (
    <Ctx.Provider
      value={{
        contexts,
        selectedContextId,
        setSelectedContextId,
        requiresContextSelection,
        hasContext,
        selectorForApi,
        selectedKind,
        sessionAccountName: sessionInfo.accountName,
        accessMode,
        setAccessMode,
        canSwitchAccess,
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

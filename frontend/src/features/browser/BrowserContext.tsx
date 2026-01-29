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
const LEGACY_CONTEXT_KEYS = ["selectedBrowserContextId", "selectedS3AccountId"];

type BrowserContextState = {
  contexts: ExecutionContext[];
  selectedContextId: string | null;
  setSelectedContextId: (id: string | null) => void;
  hasContext: boolean;
  selectorForApi: S3AccountSelector;
  selectedKind: ExecutionContextKind | null;
  accessMode: BrowserAccessMode | null;
  setAccessMode: (mode: BrowserAccessMode) => void;
  canSwitchAccess: boolean;
  accessError?: string | null;
};

const Ctx = createContext<BrowserContextState>({
  contexts: [],
  selectedContextId: null,
  setSelectedContextId: () => {},
  hasContext: false,
  selectorForApi: null,
  selectedKind: null,
  accessMode: null,
  setAccessMode: () => {},
  canSwitchAccess: false,
  accessError: null,
});

export function BrowserContextProvider({ children }: { children: ReactNode }) {
  const [contexts, setContexts] = useState<ExecutionContext[]>([]);
  const [selectedContextId, setSelectedContextIdState] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessMode, setAccessModeState] = useState<BrowserAccessMode | null>(null);
  const [canSwitchAccess, setCanSwitchAccess] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const load = async () => {
      setAccessError(null);
      try {
        const data = await listExecutionContexts();
        setContexts(data);
      } catch {
        setContexts([]);
        setAccessError("Access to /browser is denied for this user.");
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (contexts.length === 0) return;
    const urlContext = searchParams.get(EXECUTION_CONTEXT_URL_PARAM);
    const stored =
      localStorage.getItem(EXECUTION_CONTEXT_STORAGE_KEY) ??
      LEGACY_CONTEXT_KEYS.map((key) => localStorage.getItem(key)).find((value) => value);
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
    if (!selectedContextId) {
      const nextId = contexts[0].id;
      setSelectedContextIdState(nextId);
      localStorage.setItem(EXECUTION_CONTEXT_STORAGE_KEY, nextId);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, nextId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [contexts, searchParams, selectedContextId, setSearchParams]);

  const setSelectedContextId = (id: string | null) => {
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
  const hasContext = selected != null;
  const selectorForApi: S3AccountSelector = selectedContextId;

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
        hasContext,
        selectorForApi,
        selectedKind,
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

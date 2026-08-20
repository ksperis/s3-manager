/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, ReactNode } from "react";
import { S3AccountSelector } from "../../api/accountParams";
import { ExecutionContext, ExecutionContextKind } from "../../api/executionContexts";
import { useExecutionContextCatalog } from "../../hooks/useExecutionContextCatalog";
import { CLIENT_STORAGE_KEYS } from "../../utils/clientStorage";

const EXECUTION_CONTEXT_STORAGE_KEY = CLIENT_STORAGE_KEYS.selectedBrowserExecutionContext;

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

export function BrowserContextProvider({ children }: { children: ReactNode }) {
  const {
    contexts,
    contextsLoaded,
    selectedContextId,
    selectedContext,
    setSelectedContextId,
    requiresSelection: requiresContextSelection,
    accessError,
    sessionAccountName,
  } = useExecutionContextCatalog({
    scope: "browser",
    storageKey: EXECUTION_CONTEXT_STORAGE_KEY,
    selectionPolicy: "explicit",
    accessDeniedMessage: "Access to /browser is denied for this user.",
    revokedSelectionMessage:
      "The previously selected Browser account is no longer authorized. Select an available account.",
  });
  const selectedKind = selectedContext?.kind ?? null;
  const hasContext = requiresContextSelection ? selectedContext !== null : true;
  const selectorForApi: S3AccountSelector = requiresContextSelection ? selectedContextId : null;

  return (
    <Ctx.Provider
      value={{
        contexts,
        contextsLoaded,
        selectedContextId,
        selectedContext,
        setSelectedContextId,
        requiresContextSelection,
        hasContext,
        selectorForApi,
        selectedKind,
        sessionAccountName,
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

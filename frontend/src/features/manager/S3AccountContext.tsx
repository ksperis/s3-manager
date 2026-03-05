/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { S3AccountSelector } from "../../api/accountParams";
import { ExecutionContext, listExecutionContexts } from "../../api/executionContexts";
import { fetchManagerContext, type ManagerAccessMode } from "../../api/managerContext";

const EXECUTION_CONTEXT_STORAGE_KEY = "selectedExecutionContextId";
const EXECUTION_CONTEXT_URL_PARAM = "ctx";

type S3AccountContextType = {
  accounts: ExecutionContext[];
  selectedS3AccountId: string | null;
  setSelectedS3AccountId: (id: string | null) => void;
  requiresS3AccountSelection: boolean;
  hasS3AccountContext: boolean;
  accountIdForApi: S3AccountSelector;
  sessionS3AccountName: string | null;
  selectedS3AccountType: string | null;
  accessError?: string | null;
  iamIdentity: string | null;
  accessMode: ManagerAccessMode | null;
  setAccessMode: (mode: ManagerAccessMode) => void;
  canSwitchAccess: boolean;
  managerStatsEnabled: boolean | null;
  managerBrowserEnabled: boolean | null;
};

const S3AccountContext = createContext<S3AccountContextType>({
  accounts: [],
  selectedS3AccountId: null,
  setSelectedS3AccountId: () => {},
  requiresS3AccountSelection: true,
  hasS3AccountContext: false,
  accountIdForApi: null,
  sessionS3AccountName: null,
  selectedS3AccountType: null,
  accessError: null,
  iamIdentity: null,
  accessMode: null,
  setAccessMode: () => {},
  canSwitchAccess: false,
  managerStatsEnabled: null,
  managerBrowserEnabled: null,
});

type SessionInfo = {
  isSession: boolean;
  accountName: string | null;
};

type S3AccountProviderScope = "manager" | "browser";

type S3AccountProviderProps = {
  children: ReactNode;
  scope?: S3AccountProviderScope;
};

function deriveS3AccountType(context: ExecutionContext | null | undefined): string | null {
  if (!context) return null;
  if (context.kind === "connection" || context.id.startsWith("conn-")) {
    return "connection";
  }
  if (context.kind === "legacy_user" || context.id.startsWith("s3u-")) {
    return "s3_user";
  }
  return "tenant";
}

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

export function S3AccountProvider({ children, scope = "manager" }: S3AccountProviderProps) {
  const sessionInfo = useMemo(() => readSessionInfo(), []);
  const requiresS3AccountSelection = !sessionInfo.isSession;
  const [accounts, setS3Accounts] = useState<ExecutionContext[]>([]);
  const [selectedS3AccountId, setSelectedS3AccountId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [iamIdentity, setIamIdentity] = useState<string | null>(null);
  const [accessMode, setAccessModeState] = useState<ManagerAccessMode | null>(null);
  const [canSwitchAccess, setCanSwitchAccess] = useState(false);
  const [managerStatsEnabled, setManagerStatsEnabled] = useState<boolean | null>(null);
  const [managerBrowserEnabled, setManagerBrowserEnabled] = useState<boolean | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const load = async () => {
      setAccessError(null);
      if (!requiresS3AccountSelection) {
        setS3Accounts([]);
        return;
      }
      try {
        const data = await listExecutionContexts(scope);
        setS3Accounts(data);
      } catch {
        setS3Accounts([]);
        setAccessError(
          scope === "browser"
            ? "Access to browser contexts is denied for this user."
            : "Access to manager is denied for this user."
        );
      }
    };
    load();
  }, [requiresS3AccountSelection, scope]);

  useEffect(() => {
    if (!requiresS3AccountSelection) {
      setSelectedS3AccountId(null);
      localStorage.removeItem(EXECUTION_CONTEXT_STORAGE_KEY);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
      setSearchParams(nextParams, { replace: true });
      return;
    }
    if (accounts.length === 0) return;
    const urlContext = searchParams.get(EXECUTION_CONTEXT_URL_PARAM);
    const stored = localStorage.getItem(EXECUTION_CONTEXT_STORAGE_KEY);
    if (urlContext && accounts.some((context) => context.id === urlContext)) {
      if (urlContext !== selectedS3AccountId) {
        setSelectedS3AccountId(urlContext);
      }
      localStorage.setItem(EXECUTION_CONTEXT_STORAGE_KEY, urlContext);
      return;
    }
    if (stored && accounts.some((context) => context.id === stored)) {
      if (stored !== selectedS3AccountId) {
        setSelectedS3AccountId(stored);
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, stored);
      setSearchParams(nextParams, { replace: true });
      return;
    }
    const selectedExists = selectedS3AccountId ? accounts.some((context) => context.id === selectedS3AccountId) : false;
    if (!selectedS3AccountId || !selectedExists) {
      const nextId = String(accounts[0].id);
      setSelectedS3AccountId(nextId);
      localStorage.setItem(EXECUTION_CONTEXT_STORAGE_KEY, nextId);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, nextId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [accounts, requiresS3AccountSelection, searchParams, selectedS3AccountId, setSearchParams]);

  const updateSelected = (id: string | null) => {
    setSelectedS3AccountId(id);
    if (!requiresS3AccountSelection) {
      return;
    }
    if (id === null) {
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

  const setAccessMode = (mode: ManagerAccessMode) => {
    if (!selectedS3AccountId) return;
    localStorage.setItem(`managerAccessMode:${selectedS3AccountId}`, mode);
    setAccessModeState(mode);
  };

  const selectedS3Account = useMemo(
    () => accounts.find((account) => account.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );

  const hasS3AccountContext = requiresS3AccountSelection ? selectedS3AccountId !== null && selectedS3Account !== undefined : true;
  const accountIdForApi: S3AccountSelector = requiresS3AccountSelection ? selectedS3AccountId : null;
  const selectedS3AccountType = deriveS3AccountType(selectedS3Account);

  useEffect(() => {
    if (!selectedS3AccountId) {
      setAccessModeState(null);
      return;
    }
    const stored = localStorage.getItem(`managerAccessMode:${selectedS3AccountId}`);
    if (stored === "admin" || stored === "portal") {
      setAccessModeState(stored);
    } else {
      setAccessModeState(null);
    }
  }, [selectedS3AccountId]);

  useEffect(() => {
    if (!hasS3AccountContext) {
      setIamIdentity(null);
      setCanSwitchAccess(false);
      setManagerStatsEnabled(null);
      setManagerBrowserEnabled(null);
      return;
    }
    let isMounted = true;
    setManagerStatsEnabled(null);
    setManagerBrowserEnabled(null);
    fetchManagerContext(accountIdForApi)
      .then((data) => {
        if (!isMounted) return;
        setIamIdentity(data.iam_identity ?? null);
        setCanSwitchAccess(Boolean(data.can_switch_access));
        setAccessModeState(data.access_mode);
        setManagerStatsEnabled(Boolean(data.manager_stats_enabled));
        setManagerBrowserEnabled(data.manager_browser_enabled !== false);
        if (selectedS3AccountId && (data.access_mode === "admin" || data.access_mode === "portal")) {
          localStorage.setItem(`managerAccessMode:${selectedS3AccountId}`, data.access_mode);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setIamIdentity(null);
        setCanSwitchAccess(false);
        setManagerStatsEnabled(null);
        setManagerBrowserEnabled(null);
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, hasS3AccountContext, accessMode, selectedS3AccountId]);

  return (
    <S3AccountContext.Provider
      value={{
        accounts,
        selectedS3AccountId,
        setSelectedS3AccountId: updateSelected,
        requiresS3AccountSelection,
        hasS3AccountContext,
        accountIdForApi,
        sessionS3AccountName: sessionInfo.accountName,
        selectedS3AccountType,
        accessError,
        iamIdentity,
        accessMode,
        setAccessMode,
        canSwitchAccess,
        managerStatsEnabled,
        managerBrowserEnabled,
      }}
    >
      {children}
    </S3AccountContext.Provider>
  );
}

export function useS3AccountContext() {
  return useContext(S3AccountContext);
}

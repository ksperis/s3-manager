/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { S3AccountSelector } from "../../api/accountParams";
import { ExecutionContext, listExecutionContexts } from "../../api/executionContexts";
import { fetchManagerContext, type ManagerAccessMode } from "../../api/managerContext";
import { CLIENT_STORAGE_KEYS, readClientJson, readClientStorage, removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";
import { resolveUrlScopedSelection } from "../../utils/urlScopedSelection";

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
  managerStatsEnabled: boolean | null;
  managerStatsMessage: string | null;
  managerBrowserEnabled: boolean | null;
  managerBrowserMessage: string | null;
  managerBucketQuotaEnabled: boolean | null;
  managerCephKeysEnabled: boolean | null;
  managerPrivateAccessEnabled: boolean | null;
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
  managerStatsEnabled: null,
  managerStatsMessage: null,
  managerBrowserEnabled: null,
  managerBrowserMessage: null,
  managerBucketQuotaEnabled: null,
  managerCephKeysEnabled: null,
  managerPrivateAccessEnabled: null,
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
  if (context.kind === "connection") {
    return "connection";
  }
  if (context.kind === "legacy_user") {
    return "s3_user";
  }
  return "tenant";
}

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

export function S3AccountProvider({ children, scope = "manager" }: S3AccountProviderProps) {
  const executionContextStorageKey = scope === "browser"
    ? CLIENT_STORAGE_KEYS.selectedBrowserExecutionContext
    : CLIENT_STORAGE_KEYS.selectedManagerExecutionContext;
  const sessionInfo = useMemo(() => readSessionInfo(), []);
  const requiresS3AccountSelection = !sessionInfo.isSession;
  const [accounts, setS3Accounts] = useState<ExecutionContext[]>([]);
  const [contextsRefreshToken, setContextsRefreshToken] = useState(0);
  const [selectedS3AccountId, setSelectedS3AccountId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [iamIdentity, setIamIdentity] = useState<string | null>(null);
  const [accessMode, setAccessModeState] = useState<ManagerAccessMode | null>(null);
  const [managerStatsEnabled, setManagerStatsEnabled] = useState<boolean | null>(null);
  const [managerStatsMessage, setManagerStatsMessage] = useState<string | null>(null);
  const [managerBrowserEnabled, setManagerBrowserEnabled] = useState<boolean | null>(null);
  const [managerBrowserMessage, setManagerBrowserMessage] = useState<string | null>(null);
  const [managerBucketQuotaEnabled, setManagerBucketQuotaEnabled] = useState<boolean | null>(null);
  const [managerCephKeysEnabled, setManagerCephKeysEnabled] = useState<boolean | null>(null);
  const [managerPrivateAccessEnabled, setManagerPrivateAccessEnabled] = useState<boolean | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRefresh = () => setContextsRefreshToken((value) => value + 1);
    window.addEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, handleRefresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setAccessError(null);
      if (!requiresS3AccountSelection) {
        setS3Accounts([]);
        return;
      }
      try {
        const data = await listExecutionContexts(scope, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setS3Accounts(data);
      } catch {
        if (controller.signal.aborted) return;
        setS3Accounts([]);
        setAccessError(
          scope === "browser"
            ? "Access to browser contexts is denied for this user."
            : "Access to manager is denied for this user."
        );
      }
    };
    void load();
    return () => controller.abort();
  }, [contextsRefreshToken, requiresS3AccountSelection, scope]);

  useEffect(() => {
    if (!requiresS3AccountSelection) {
      setSelectedS3AccountId(null);
      removeClientStorage(executionContextStorageKey);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
      setSearchParams(nextParams, { replace: true });
      return;
    }
    if (accounts.length === 0) return;
    const urlContext = searchParams.get(EXECUTION_CONTEXT_URL_PARAM);
    const nextId = resolveUrlScopedSelection({
      availableIds: accounts.map((context) => context.id),
      urlValue: urlContext,
      currentValue: selectedS3AccountId,
      fallbackValues: [readClientStorage(executionContextStorageKey)],
    });
    if (!nextId) return;
    if (nextId !== selectedS3AccountId) {
      setSelectedS3AccountId(nextId);
    }
    writeClientStorage(executionContextStorageKey, nextId);
    if (urlContext !== nextId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, nextId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [accounts, executionContextStorageKey, requiresS3AccountSelection, searchParams, selectedS3AccountId, setSearchParams]);

  const updateSelected = (id: string | null) => {
    setSelectedS3AccountId(id);
    if (!requiresS3AccountSelection) {
      return;
    }
    if (id === null) {
      removeClientStorage(executionContextStorageKey);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(EXECUTION_CONTEXT_URL_PARAM);
      setSearchParams(nextParams, { replace: true });
    } else {
      writeClientStorage(executionContextStorageKey, id);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(EXECUTION_CONTEXT_URL_PARAM, id);
      setSearchParams(nextParams, { replace: true });
    }
  };

  const selectedS3Account = useMemo(
    () => accounts.find((account) => account.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );

  const hasS3AccountContext = requiresS3AccountSelection ? selectedS3AccountId !== null && selectedS3Account !== undefined : true;
  const accountIdForApi: S3AccountSelector = requiresS3AccountSelection ? selectedS3AccountId : null;
  const selectedS3AccountType = deriveS3AccountType(selectedS3Account);

  useEffect(() => {
    if (!hasS3AccountContext) {
      setIamIdentity(null);
      setAccessModeState(null);
      setManagerStatsEnabled(null);
      setManagerStatsMessage(null);
      setManagerBrowserEnabled(null);
      setManagerBrowserMessage(null);
      setManagerBucketQuotaEnabled(null);
      setManagerCephKeysEnabled(null);
      setManagerPrivateAccessEnabled(null);
      return;
    }
    let isMounted = true;
    setManagerStatsEnabled(null);
    setManagerStatsMessage(null);
    setManagerBrowserEnabled(null);
    setManagerBrowserMessage(null);
    setManagerBucketQuotaEnabled(null);
    setManagerCephKeysEnabled(null);
    setManagerPrivateAccessEnabled(null);
    fetchManagerContext(accountIdForApi)
      .then((data) => {
        if (!isMounted) return;
        setIamIdentity(data.iam_identity ?? null);
        setAccessModeState(data.access_mode);
        setManagerStatsEnabled(Boolean(data.manager_stats_enabled));
        setManagerStatsMessage(data.manager_stats_message ?? null);
        setManagerBrowserEnabled(data.manager_browser_enabled === true);
        setManagerBrowserMessage(data.manager_browser_message ?? null);
        setManagerBucketQuotaEnabled(Boolean(data.manager_bucket_quota_enabled));
        setManagerCephKeysEnabled(Boolean(data.manager_ceph_keys_enabled));
        setManagerPrivateAccessEnabled(Boolean(data.manager_private_access_enabled));
      })
      .catch(() => {
        if (!isMounted) return;
        setIamIdentity(null);
        setAccessModeState(null);
        setManagerStatsEnabled(null);
        setManagerStatsMessage(null);
        setManagerBrowserEnabled(null);
        setManagerBrowserMessage(null);
        setManagerBucketQuotaEnabled(null);
        setManagerCephKeysEnabled(null);
        setManagerPrivateAccessEnabled(null);
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, hasS3AccountContext]);

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
        managerStatsEnabled,
        managerStatsMessage,
        managerBrowserEnabled,
        managerBrowserMessage,
        managerBucketQuotaEnabled,
        managerCephKeysEnabled,
        managerPrivateAccessEnabled,
      }}
    >
      {children}
    </S3AccountContext.Provider>
  );
}

export function useS3AccountContext() {
  return useContext(S3AccountContext);
}

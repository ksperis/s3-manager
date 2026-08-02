/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { S3AccountSelector } from "../../api/accountParams";
import { useI18n } from "../../i18n";
import { listPortalAccounts, type PortalAccount } from "../../api/portal";
import { extractApiError } from "../../utils/apiError";
import { CLIENT_STORAGE_KEYS, readClientStorage, removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { readStoredUser } from "../../utils/workspaces";
import { resolveUrlScopedSelection } from "../../utils/urlScopedSelection";

const PORTAL_ACCOUNT_STORAGE_KEY = CLIENT_STORAGE_KEYS.selectedPortalAccount;
const PORTAL_ACCOUNT_URL_PARAM = "project";

type PortalAccountContextType = {
  accounts: PortalAccount[];
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  hasAccountContext: boolean;
  accountIdForApi: S3AccountSelector;
  selectedAccount: PortalAccount | null;
  loading: boolean;
  error: string | null;
};

const PortalAccountContext = createContext<PortalAccountContextType>({
  accounts: [],
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  hasAccountContext: false,
  accountIdForApi: null,
  selectedAccount: null,
  loading: false,
  error: null,
});

export function PortalAccountProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listPortalAccounts({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setAccounts(data);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            extractApiError(
              err,
              t({
                en: "Unable to load projects.",
                fr: "Impossible de charger les projets.",
                de: "Projekte konnen nicht geladen werden.",
              })
            )
          );
          setAccounts([]);
          setSelectedAccountId(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoaded(true);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [t]);

  useEffect(() => {
    if (!loaded) return;
    const urlAccount = searchParams.get(PORTAL_ACCOUNT_URL_PARAM);
    if (accounts.length === 0) {
      setSelectedAccountId(null);
      removeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY);
      if (urlAccount !== null) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete(PORTAL_ACCOUNT_URL_PARAM);
        setSearchParams(nextParams, { replace: true });
      }
      return;
    }
    const preferred = readStoredUser()?.ui_preferences?.selected_portal_account_id ?? null;
    const nextId = resolveUrlScopedSelection({
      availableIds: accounts.map((account) => String(account.id)),
      urlValue: urlAccount,
      currentValue: selectedAccountId,
      fallbackValues: [readClientStorage(PORTAL_ACCOUNT_STORAGE_KEY), preferred],
    });
    if (!nextId) return;
    if (nextId !== selectedAccountId) {
      setSelectedAccountId(nextId);
    }
    writeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY, nextId);
    if (urlAccount !== nextId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(PORTAL_ACCOUNT_URL_PARAM, nextId);
      setSearchParams(nextParams, { replace: true });
    }
  }, [accounts, loaded, searchParams, selectedAccountId, setSearchParams]);

  const updateSelected = (id: string | null) => {
    setSelectedAccountId(id);
    if (id === null) {
      removeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY);
    } else {
      writeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY, id);
    }
    const nextParams = new URLSearchParams(searchParams);
    if (id === null) {
      nextParams.delete(PORTAL_ACCOUNT_URL_PARAM);
    } else {
      nextParams.set(PORTAL_ACCOUNT_URL_PARAM, id);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const selectedAccount = useMemo(
    () => accounts.find((acc) => acc.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const hasAccountContext = Boolean(selectedAccount);
  const accountIdForApi: S3AccountSelector = hasAccountContext ? selectedAccount?.id ?? null : null;

  return (
    <PortalAccountContext.Provider
      value={{
        accounts,
        selectedAccountId,
        setSelectedAccountId: updateSelected,
        hasAccountContext,
        accountIdForApi,
        selectedAccount,
        loading,
        error,
      }}
    >
      {children}
    </PortalAccountContext.Provider>
  );
}

export function usePortalAccountContext() {
  return useContext(PortalAccountContext);
}

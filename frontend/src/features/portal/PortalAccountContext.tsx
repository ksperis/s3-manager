/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { S3AccountSelector } from "../../api/accountParams";
import { S3Account } from "../../api/accounts";
import { useI18n } from "../../i18n";
import { listPortalAccounts } from "../../api/portal";
import { extractApiError } from "../../utils/apiError";
import { CLIENT_STORAGE_KEYS, readClientStorage, removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { readStoredUser } from "../../utils/workspaces";

const PORTAL_ACCOUNT_STORAGE_KEY = CLIENT_STORAGE_KEYS.selectedPortalAccount;

type PortalAccountContextType = {
  accounts: S3Account[];
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  hasAccountContext: boolean;
  accountIdForApi: S3AccountSelector;
  selectedAccount: S3Account | null;
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
  const [accounts, setAccounts] = useState<S3Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listPortalAccounts({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setAccounts(data);
        if (data.length === 0) {
          setSelectedAccountId(null);
          removeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY);
          return;
        }
        const stored = readClientStorage(PORTAL_ACCOUNT_STORAGE_KEY);
        const preferred = readStoredUser()?.ui_preferences?.selected_portal_account_id ?? null;
        const candidate = [stored, preferred].find((id) => id && data.some((account) => account.id === id));
        if (candidate) {
          setSelectedAccountId(candidate);
          writeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY, candidate);
          return;
        }
        const defaultId = String(data[0].id);
        setSelectedAccountId(defaultId);
        writeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY, defaultId);
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
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [t]);

  const updateSelected = (id: string | null) => {
    setSelectedAccountId(id);
    if (id === null) {
      removeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY);
    } else {
      writeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY, id);
    }
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

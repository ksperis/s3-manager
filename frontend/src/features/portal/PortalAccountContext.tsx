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
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listPortalAccounts();
        if (cancelled) return;
        setAccounts(data);
        if (data.length === 0) {
          setSelectedAccountId(null);
          localStorage.removeItem("selectedPortalAccountId");
          return;
        }
        const stored = localStorage.getItem("selectedPortalAccountId");
        if (stored && data.some((a) => a.id === stored)) {
          setSelectedAccountId(stored);
          return;
        }
        const defaultId = String(data[0].id);
        setSelectedAccountId(defaultId);
        localStorage.setItem("selectedPortalAccountId", defaultId);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(
            extractApiError(
              err,
              t({
                en: "Unable to load S3 accounts.",
                fr: "Impossible de charger les comptes S3.",
                de: "S3-Konten konnen nicht geladen werden.",
              })
            )
          );
          setAccounts([]);
          setSelectedAccountId(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const updateSelected = (id: string | null) => {
    setSelectedAccountId(id);
    if (id === null) {
      localStorage.removeItem("selectedPortalAccountId");
    } else {
      localStorage.setItem("selectedPortalAccountId", id);
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

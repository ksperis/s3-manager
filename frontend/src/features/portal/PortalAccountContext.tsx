/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { S3AccountSelector } from "../../api/accountParams";
import { PortalAccountListItem, PortalContextResponse, fetchPortalContext, listPortalAccounts } from "../../api/portal";

type PortalAccountContextType = {
  accounts: PortalAccountListItem[];
  reloadAccounts: () => Promise<void>;
  selectedAccountId: number | null;
  setSelectedAccountId: (id: number | null) => void;
  hasAccountContext: boolean;
  accountIdForApi: S3AccountSelector;
  selectedAccount: PortalAccountListItem | null;
  portalContext: PortalContextResponse | null;
  reloadPortalContext: () => Promise<void>;
  loading: boolean;
  contextLoading: boolean;
  error: string | null;
  contextError: string | null;
};

const PortalAccountContext = createContext<PortalAccountContextType>({
  accounts: [],
  reloadAccounts: async () => {},
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  hasAccountContext: false,
  accountIdForApi: null,
  selectedAccount: null,
  portalContext: null,
  reloadPortalContext: async () => {},
  loading: false,
  contextLoading: false,
  error: null,
  contextError: null,
});

export function PortalAccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<PortalAccountListItem[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalContext, setPortalContext] = useState<PortalContextResponse | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const resolveSelection = (items: PortalAccountListItem[], currentId: number | null): number | null => {
    if (items.length === 0) return null;
    if (items.length === 1) return items[0].id;
    if (currentId && items.some((acc) => acc.id === currentId)) return currentId;
    const stored = localStorage.getItem("selectedPortalAccountId");
    const storedId = stored ? Number(stored) : null;
    if (storedId && items.some((acc) => acc.id === storedId)) return storedId;
    return null;
  };

  const reloadAccounts = async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const data = await listPortalAccounts();
      setAccounts(data);
      const nextSelected = resolveSelection(data, selectedAccountId);
      setSelectedAccountId(nextSelected);
      if (nextSelected === null) {
        localStorage.removeItem("selectedPortalAccountId");
      } else {
        localStorage.setItem("selectedPortalAccountId", String(nextSelected));
      }
    } catch (err) {
      console.error(err);
      setError("Impossible de charger les comptes S3.");
      setAccounts([]);
      setSelectedAccountId(null);
      localStorage.removeItem("selectedPortalAccountId");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSelected = (id: number | null) => {
    setSelectedAccountId(id);
    if (id === null) {
      localStorage.removeItem("selectedPortalAccountId");
    } else {
      localStorage.setItem("selectedPortalAccountId", String(id));
    }
  };

  const selectedAccount = useMemo(
    () => accounts.find((acc) => acc.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const hasAccountContext = Boolean(selectedAccountId && selectedAccount);
  const accountIdForApi: S3AccountSelector = hasAccountContext ? selectedAccountId : null;

  const reloadPortalContext = async (): Promise<void> => {
    if (!selectedAccountId) {
      setPortalContext(null);
      setContextError(null);
      return;
    }
    try {
      setContextLoading(true);
      setContextError(null);
      const data = await fetchPortalContext(selectedAccountId);
      setPortalContext(data);
    } catch (err) {
      console.error(err);
      setPortalContext(null);
      setContextError("Impossible de charger le contexte du portail.");
    } finally {
      setContextLoading(false);
    }
  };

  useEffect(() => {
    void reloadPortalContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  return (
    <PortalAccountContext.Provider
      value={{
        accounts,
        reloadAccounts,
        selectedAccountId,
        setSelectedAccountId: updateSelected,
        hasAccountContext,
        accountIdForApi,
        selectedAccount,
        portalContext,
        reloadPortalContext,
        loading,
        contextLoading,
        error,
        contextError,
      }}
    >
      {children}
    </PortalAccountContext.Provider>
  );
}

export function usePortalAccountContext() {
  return useContext(PortalAccountContext);
}

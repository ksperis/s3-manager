/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { S3AccountSelector } from "../../api/accountParams";
import { PortalAccountListItem, PortalContextResponse, fetchPortalContext, listPortalAccounts } from "../../api/portal";

type PortalAccountContextType = {
  accounts: PortalAccountListItem[];
  selectedAccountId: number | null;
  setSelectedAccountId: (id: number | null) => void;
  hasAccountContext: boolean;
  accountIdForApi: S3AccountSelector;
  selectedAccount: PortalAccountListItem | null;
  portalContext: PortalContextResponse | null;
  loading: boolean;
  contextLoading: boolean;
  error: string | null;
  contextError: string | null;
};

const PortalAccountContext = createContext<PortalAccountContextType>({
  accounts: [],
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  hasAccountContext: false,
  accountIdForApi: null,
  selectedAccount: null,
  portalContext: null,
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
        if (data.length === 1) {
          const onlyId = data[0].id;
          setSelectedAccountId(onlyId);
          localStorage.setItem("selectedPortalAccountId", String(onlyId));
          return;
        }
        const stored = localStorage.getItem("selectedPortalAccountId");
        const storedId = stored ? Number(stored) : null;
        if (storedId && data.some((a) => a.id === storedId)) {
          setSelectedAccountId(storedId);
          return;
        }
        setSelectedAccountId(null);
        localStorage.removeItem("selectedPortalAccountId");
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError("Impossible de charger les comptes S3.");
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

  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      if (!selectedAccountId) {
        setPortalContext(null);
        setContextError(null);
        return;
      }
      try {
        setContextLoading(true);
        setContextError(null);
        const data = await fetchPortalContext(selectedAccountId);
        if (!cancelled) {
          setPortalContext(data);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setPortalContext(null);
          setContextError("Impossible de charger le contexte du portail.");
        }
      } finally {
        if (!cancelled) {
          setContextLoading(false);
        }
      }
    };
    loadContext();
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  return (
    <PortalAccountContext.Provider
      value={{
        accounts,
        selectedAccountId,
        setSelectedAccountId: updateSelected,
        hasAccountContext,
        accountIdForApi,
        selectedAccount,
        portalContext,
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

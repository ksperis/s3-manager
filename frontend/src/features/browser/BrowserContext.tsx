/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { S3Account } from "../../api/accounts";
import { S3AccountSelector } from "../../api/accountParams";
import { listConnections, type S3Connection } from "../../api/connections";
import { listManagerS3Accounts } from "../../api/managerS3Accounts";
export type BrowserAccessMode = "admin" | "portal";

export type BrowserContextKind = "account" | "connection" | "s3_user";

export type BrowserContextItem = {
  id: string;
  kind: BrowserContextKind;
  name: string;
  endpoint?: string | null;
  provider_hint?: string | null;
  raw?: S3Account | S3Connection;
};

type BrowserContextState = {
  contexts: BrowserContextItem[];
  selectedContextId: string | null;
  setSelectedContextId: (id: string | null) => void;
  hasContext: boolean;
  selectorForApi: S3AccountSelector;
  selectedKind: BrowserContextKind | null;
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

function isS3UserAccount(account: S3Account): boolean {
  if (account.is_s3_user != null) return Boolean(account.is_s3_user);
  return account.id.startsWith("s3u-") || !account.rgw_account_id;
}

function normalizeAccountToContextItem(account: S3Account): BrowserContextItem {
  const kind: BrowserContextKind = isS3UserAccount(account) ? "s3_user" : "account";
  return {
    id: String(account.id),
    kind,
    name: account.name,
    endpoint: account.storage_endpoint_url ?? null,
    raw: account,
  };
}

function normalizeConnectionToContextItem(conn: S3Connection): BrowserContextItem {
  return {
    id: `conn-${conn.id}`,
    kind: "connection",
    name: conn.name,
    endpoint: conn.endpoint_url,
    provider_hint: conn.provider_hint ?? null,
    raw: conn,
  };
}

export function BrowserContextProvider({ children }: { children: ReactNode }) {
  const [contexts, setContexts] = useState<BrowserContextItem[]>([]);
  const [selectedContextId, setSelectedContextIdState] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessMode, setAccessModeState] = useState<BrowserAccessMode | null>(null);
  const [canSwitchAccess, setCanSwitchAccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      setAccessError(null);
      try {
        const [connections, accounts] = await Promise.all([
          listConnections().catch(() => [] as S3Connection[]),
          listManagerS3Accounts().catch(() => [] as S3Account[]),
        ]);
        const combined: BrowserContextItem[] = [
          ...connections.map(normalizeConnectionToContextItem),
          ...accounts.map(normalizeAccountToContextItem),
        ];
        setContexts(combined);
        const stored = localStorage.getItem("selectedBrowserContextId");
        if (stored && combined.some((c) => c.id === stored)) {
          setSelectedContextIdState(stored);
          return;
        }
        if (combined.length > 0) {
          setSelectedContextIdState(combined[0].id);
          localStorage.setItem("selectedBrowserContextId", combined[0].id);
        }
      } catch {
        setContexts([]);
        setAccessError("Access to /browser is denied for this user.");
      }
    };
    load();
  }, []);

  const setSelectedContextId = (id: string | null) => {
    setSelectedContextIdState(id);
    if (id == null) {
      localStorage.removeItem("selectedBrowserContextId");
    } else {
      localStorage.setItem("selectedBrowserContextId", id);
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

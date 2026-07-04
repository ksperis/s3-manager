/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { S3AccountSelector } from "../../api/accountParams";
import { S3Account } from "../../api/accounts";
import { useI18n } from "../../i18n";
import { listPortalProjects, type PortalProject, type PortalProjectAccount } from "../../api/portal";
import { extractApiError } from "../../utils/apiError";
import { CLIENT_STORAGE_KEYS, readClientStorage, removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { readStoredUser } from "../../utils/workspaces";

const PORTAL_ACCOUNT_STORAGE_KEY = CLIENT_STORAGE_KEYS.selectedPortalAccount;

const DEV_FALLBACK_ACCOUNT: S3Account = {
  id: "proj-dev",
  name: "Laurent",
  tags: [],
  storage_endpoint_id: 1,
  storage_endpoint_name: "eu-west-3",
};

const DEV_FALLBACK_PROJECT: PortalProject = {
  id: "proj-dev",
  db_id: 0,
  name: "Laurent",
  description: null,
  account_role: "portal_manager",
  accounts: [
    {
      account_id: 1,
      account_name: "Laurent",
      display_name: "eu-west-3",
      storage_endpoint_id: 1,
      storage_endpoint_name: "eu-west-3",
    },
  ],
};

type PortalAccountContextType = {
  accounts: S3Account[];
  projects: PortalProject[];
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  hasAccountContext: boolean;
  accountIdForApi: S3AccountSelector;
  selectedAccount: S3Account | null;
  selectedProject: PortalProject | null;
  selectedProjectAccounts: PortalProjectAccount[];
  loading: boolean;
  error: string | null;
};

const PortalAccountContext = createContext<PortalAccountContextType>({
  accounts: [],
  projects: [],
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  hasAccountContext: false,
  accountIdForApi: null,
  selectedAccount: null,
  selectedProject: null,
  selectedProjectAccounts: [],
  loading: false,
  error: null,
});

function projectToSyntheticAccount(project: PortalProject): S3Account {
  const firstAccount = project.accounts[0];
  const knownQuotaSize = project.accounts
    .map((account) => account.quota_max_size_gb)
    .filter((value): value is number => value != null);
  const knownQuotaObjects = project.accounts
    .map((account) => account.quota_max_objects)
    .filter((value): value is number => value != null);
  return {
    id: project.id,
    db_id: project.db_id,
    name: project.name,
    tags: [],
    quota_max_size_gb: knownQuotaSize.length > 0 ? knownQuotaSize.reduce((sum, value) => sum + value, 0) : null,
    quota_max_objects: knownQuotaObjects.length > 0 ? knownQuotaObjects.reduce((sum, value) => sum + value, 0) : null,
    storage_endpoint_id: firstAccount?.storage_endpoint_id ?? null,
    storage_endpoint_name:
      project.accounts.length === 1
        ? firstAccount?.storage_endpoint_name ?? firstAccount?.display_name ?? null
        : `${project.accounts.length} S3 accounts`,
    storage_endpoint_url: firstAccount?.storage_endpoint_url ?? null,
  };
}

export function PortalAccountProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<S3Account[]>([]);
  const [projects, setProjects] = useState<PortalProject[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listPortalProjects();
        if (cancelled) return;
        setProjects(data);
        setAccounts(data.map(projectToSyntheticAccount));
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
        console.error(err);
        if (!cancelled) {
          if (import.meta.env.DEV) {
            setProjects([DEV_FALLBACK_PROJECT]);
            setAccounts([DEV_FALLBACK_ACCOUNT]);
            setSelectedAccountId(DEV_FALLBACK_ACCOUNT.id);
            writeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY, DEV_FALLBACK_ACCOUNT.id);
            setError(null);
            return;
          }
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
          setProjects([]);
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
      removeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY);
    } else {
      writeClientStorage(PORTAL_ACCOUNT_STORAGE_KEY, id);
    }
  };

  const selectedAccount = useMemo(
    () => accounts.find((acc) => acc.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedAccountId) ?? null,
    [projects, selectedAccountId]
  );
  const selectedProjectAccounts = selectedProject?.accounts ?? [];
  const hasAccountContext = Boolean(selectedProject);
  const accountIdForApi: S3AccountSelector = hasAccountContext ? selectedProject?.id ?? null : null;

  return (
    <PortalAccountContext.Provider
      value={{
        accounts,
        projects,
        selectedAccountId,
        setSelectedAccountId: updateSelected,
        hasAccountContext,
        accountIdForApi,
        selectedAccount,
        selectedProject,
        selectedProjectAccounts,
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

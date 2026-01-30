/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent } from "react";
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { SidebarSection } from "../../components/Sidebar";
import { PortalAccountProvider, usePortalAccountContext } from "./PortalAccountContext";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

type StoredUser = {
  account_links?: { account_id: number; account_role?: string | null }[] | null;
};

function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

function resolvePortalRole(user: StoredUser | null, accountId: string | null): string | null {
  if (!user || !accountId) return null;
  const numericId = Number(accountId);
  if (!Number.isFinite(numericId)) return null;
  const link = (user.account_links ?? []).find((entry) => Number(entry.account_id) === numericId);
  return link?.account_role ?? null;
}

function AccountSelector() {
  const { accounts, selectedAccountId, setSelectedAccountId, selectedAccount, loading, error } = usePortalAccountContext();
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const selectClasses =
    "appearance-none w-48 rounded-full border border-slate-200 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900";
  const pillClasses =
    "w-48 rounded-full border border-slate-200 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

  if (loading) {
    return <div className={pillClasses}>Chargement…</div>;
  }

  if (error) {
    return <div className="ui-body font-semibold text-rose-600">{error}</div>;
  }

  if (accounts.length <= 1) {
    return (
      <div className={pillClasses} title={selectedAccount?.storage_endpoint_url || undefined}>
        {selectedAccount
          ? formatAccountLabel(selectedAccount, defaultEndpointId, defaultEndpointName, false)
          : "Aucun compte"}
      </div>
    );
  }

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || null;
    setSelectedAccountId(value);
  };

  return (
    <div className="relative">
      <select className={selectClasses} value={selectedAccountId ?? ""} onChange={handleChange}>
        {!selectedAccount && <option value="">Sélectionnez un compte</option>}
        {accounts.map((acc) => (
          <option key={acc.id} value={acc.id} title={acc.storage_endpoint_url || undefined}>
            {formatAccountLabel(acc, defaultEndpointId, defaultEndpointName, false)}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center ui-caption text-slate-500 dark:text-slate-300">▼</div>
    </div>
  );
}

function PortalShell() {
  const { selectedAccountId } = usePortalAccountContext();
  const { generalSettings } = useGeneralSettings();
  const accountRole = resolvePortalRole(getStoredUser(), selectedAccountId);
  const hideSidebar = accountRole === "portal_user";
  const isPortalManager = accountRole === "portal_manager";
  const navSections: SidebarSection[] = [
    {
      label: "Portail",
      links: [
        { to: "/portal", label: "Accueil", end: true },
        ...(isPortalManager ? [{ to: "/portal/buckets", label: "Buckets" }] : []),
        ...(generalSettings.browser_enabled && generalSettings.browser_portal_enabled
          ? [{ to: "/portal/browser", label: "Browser" }]
          : []),
        { to: "/portal/manage", label: "Gestion" },
        { to: "/portal/settings", label: "Configuration" },
      ],
    },
  ];

  return (
    <Layout
      headerTitle="Portail"
      navSections={navSections}
      sidebarTitle="PORTAL"
      hideSidebar={hideSidebar}
      hideHeader
      topbarContent={
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account</span>
          <AccountSelector />
        </div>
      }
    >
      <Outlet />
    </Layout>
  );
}

export default function PortalLayout() {
  return (
    <PortalAccountProvider>
      <PortalShell />
    </PortalAccountProvider>
  );
}

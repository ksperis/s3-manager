/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { SidebarSection } from "../../components/Sidebar";
import TopbarDropdownSelect, { TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
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
  const options: TopbarDropdownOption[] = [
    ...(!selectedAccount ? [{ value: "", label: "Sélectionnez un compte" }] : []),
    ...accounts.map((acc) => ({
      value: acc.id,
      label: formatAccountLabel(acc, defaultEndpointId, defaultEndpointName, false),
      title: acc.storage_endpoint_url || undefined,
    })),
  ];
  const pillClasses =
    "inline-flex h-9 w-56 items-center rounded-xl border border-slate-200/80 bg-white px-3 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

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

  const handleChange = (selectedValue: string) => {
    const value = selectedValue || null;
    setSelectedAccountId(value);
  };

  return (
    <TopbarDropdownSelect
      value={selectedAccountId ?? ""}
      options={options}
      onChange={handleChange}
      ariaLabel="Sélectionner un compte portail"
      widthClassName="w-56"
    />
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
        ...(generalSettings.billing_enabled ? [{ to: "/portal/billing", label: "Billing" }] : []),
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
        <div className="flex items-center gap-3">
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

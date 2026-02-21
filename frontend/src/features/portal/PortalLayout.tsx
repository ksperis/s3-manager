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
import { useI18n } from "../../i18n";

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
  const { t } = useI18n();
  const { accounts, selectedAccountId, setSelectedAccountId, selectedAccount, loading, error } = usePortalAccountContext();
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const options: TopbarDropdownOption[] = [
    ...(!selectedAccount
      ? [
          {
            value: "",
            label: t({ en: "Select an account", fr: "Selectionnez un compte", de: "Konto auswahlen" }),
          },
        ]
      : []),
    ...accounts.map((acc) => ({
      value: acc.id,
      label: formatAccountLabel(acc, defaultEndpointId, defaultEndpointName, false),
      title: acc.storage_endpoint_url || undefined,
    })),
  ];
  const pillClasses =
    "inline-flex h-9 w-56 items-center rounded-xl border border-slate-200/80 bg-white px-3 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

  if (loading) {
    return <div className={pillClasses}>{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })}</div>;
  }

  if (error) {
    return <div className="ui-body font-semibold text-rose-600">{error}</div>;
  }

  if (accounts.length <= 1) {
    return (
      <div className={pillClasses} title={selectedAccount?.storage_endpoint_url || undefined}>
        {selectedAccount
          ? formatAccountLabel(selectedAccount, defaultEndpointId, defaultEndpointName, false)
          : t({ en: "No account", fr: "Aucun compte", de: "Kein Konto" })}
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
      ariaLabel={t({ en: "Select portal account", fr: "Selectionner un compte portail", de: "Portal-Konto auswahlen" })}
      widthClassName="w-56"
    />
  );
}

function PortalShell() {
  const { t } = useI18n();
  const { selectedAccountId } = usePortalAccountContext();
  const { generalSettings } = useGeneralSettings();
  const accountRole = resolvePortalRole(getStoredUser(), selectedAccountId);
  const hideSidebar = accountRole === "portal_user";
  const isPortalManager = accountRole === "portal_manager";
  const navSections: SidebarSection[] = [
    {
      label: t({ en: "Portal", fr: "Portail", de: "Portal" }),
      links: [
        { to: "/portal", label: t({ en: "Home", fr: "Accueil", de: "Startseite" }), end: true },
        ...(isPortalManager ? [{ to: "/portal/buckets", label: t({ en: "Buckets", fr: "Buckets", de: "Buckets" }) }] : []),
        ...(generalSettings.browser_enabled && generalSettings.browser_portal_enabled
          ? [{ to: "/portal/browser", label: t({ en: "Browser", fr: "Browser", de: "Browser" }) }]
          : []),
        { to: "/portal/manage", label: t({ en: "Manage", fr: "Gestion", de: "Verwaltung" }) },
        ...(generalSettings.billing_enabled
          ? [{ to: "/portal/billing", label: t({ en: "Billing", fr: "Facturation", de: "Abrechnung" }) }]
          : []),
        { to: "/portal/settings", label: t({ en: "Settings", fr: "Configuration", de: "Einstellungen" }) },
      ],
    },
  ];

  return (
    <Layout
      headerTitle={t({ en: "Portal", fr: "Portail", de: "Portal" })}
      navSections={navSections}
      sidebarTitle="PORTAL"
      hideSidebar={hideSidebar}
      hideHeader
      topbarContent={
        <div className="flex items-center gap-3">
          <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t({ en: "Account", fr: "Compte", de: "Konto" })}
          </span>
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

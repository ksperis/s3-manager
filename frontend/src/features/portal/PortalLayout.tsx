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
import type { TopbarControlDescriptor } from "../../components/topbarControlsLayout";

type StoredUser = {
  account_links?: { account_id: number | string; account_role?: string | null }[] | null;
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

function normalizePortalRole(value?: string | null): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "portal_user" || normalized === "portal_manager" || normalized === "portal_none") {
    return normalized;
  }
  return null;
}

function resolvePortalRole(user: StoredUser | null, accountId: string | null): string | null {
  if (!user || !accountId) return null;
  const normalizedTargetId = String(accountId).trim();
  if (!normalizedTargetId) return null;
  const links = user.account_links ?? [];
  const direct = links.find((entry) => String(entry.account_id).trim() === normalizedTargetId);
  if (direct) return normalizePortalRole(direct.account_role);

  const numericTargetId = Number(normalizedTargetId);
  if (!Number.isFinite(numericTargetId)) return null;
  const numeric = links.find((entry) => Number(entry.account_id) === numericTargetId);
  return normalizePortalRole(numeric?.account_role);
}

type AccountSelectorProps = {
  triggerMode?: "icon" | "icon_label";
  openInPortal?: boolean;
  widthClassName?: string;
  menuMinWidthClassName?: string;
};

function AccountSelector({
  triggerMode = "icon_label",
  openInPortal = true,
  widthClassName,
  menuMinWidthClassName = "min-w-full",
}: AccountSelectorProps) {
  const { t } = useI18n();
  const { accounts, selectedAccountId, setSelectedAccountId, selectedAccount, loading, error } = usePortalAccountContext();
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const iconOnly = triggerMode === "icon";
  const selectedLabel = selectedAccount
    ? formatAccountLabel(selectedAccount, defaultEndpointId, defaultEndpointName, false)
    : t({ en: "No account", fr: "Aucun compte", de: "Kein Konto" });
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
  const iconButtonClasses =
    "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

  if (loading) {
    if (iconOnly) {
      return (
        <button
          type="button"
          disabled
          aria-label={t({ en: "Loading account", fr: "Chargement du compte", de: "Konto wird geladen" })}
          className={iconButtonClasses}
        >
          <AccountControlIcon className="h-4 w-4 animate-pulse" />
        </button>
      );
    }
    return <div className={pillClasses}>{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })}</div>;
  }

  if (error) {
    if (iconOnly) {
      return (
        <button type="button" aria-label={error} title={error} className={`${iconButtonClasses} text-rose-600 dark:text-rose-300`}>
          <WarningIcon className="h-4 w-4" />
        </button>
      );
    }
    return <div className="ui-body font-semibold text-rose-600">{error}</div>;
  }

  if (accounts.length <= 1) {
    if (iconOnly) {
      return (
        <button
          type="button"
          aria-label={selectedLabel}
          title={selectedAccount?.storage_endpoint_url || selectedLabel}
          className={iconButtonClasses}
        >
          <AccountControlIcon className="h-4 w-4" />
        </button>
      );
    }
    return (
      <div className={pillClasses} title={selectedAccount?.storage_endpoint_url || undefined}>
        {selectedLabel}
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
      triggerLabel={t({ en: "Account", fr: "Compte", de: "Konto" })}
      widthClassName={widthClassName ?? (iconOnly ? "w-9" : "w-56 lg:w-64")}
      menuMinWidthClassName={menuMinWidthClassName}
      triggerMode={triggerMode}
      openInPortal={openInPortal}
      icon={<AccountControlIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />}
    />
  );
}

function PortalShell() {
  const { t } = useI18n();
  const { selectedAccountId, selectedAccount, loading } = usePortalAccountContext();
  const { generalSettings } = useGeneralSettings();
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const storedUser = getStoredUser();
  const accountRole = resolvePortalRole(storedUser, selectedAccountId);
  const storedRoles = (storedUser?.account_links ?? [])
    .map((entry) => normalizePortalRole(entry.account_role))
    .filter((role): role is string => Boolean(role));
  const hasPortalManagerRole = storedRoles.includes("portal_manager");
  const hasPortalUserRole = storedRoles.includes("portal_user");
  const effectiveAccountRole = accountRole ?? (hasPortalUserRole && !hasPortalManagerRole ? "portal_user" : null);
  const isPortalManager = effectiveAccountRole === "portal_manager";
  const selectedPortalLabel = selectedAccount
    ? formatAccountLabel(selectedAccount, defaultEndpointId, defaultEndpointName, false)
    : loading
      ? t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })
      : t({ en: "No account", fr: "Aucun compte", de: "Kein Konto" });
  const navSections: SidebarSection[] = [
    {
      label: t({ en: "Portal", fr: "Portail", de: "Portal" }),
      links: [
        { to: "/portal", label: t({ en: "Home", fr: "Accueil", de: "Startseite" }), end: true },
        ...(generalSettings.browser_enabled && generalSettings.browser_portal_enabled
          ? [{ to: "/portal/browser", label: t({ en: "Browser", fr: "Browser", de: "Browser" }) }]
          : []),
        ...(isPortalManager ? [{ to: "/portal/buckets", label: t({ en: "Buckets", fr: "Buckets", de: "Buckets" }) }] : []),
        { to: "/portal/manage", label: t({ en: "Access", fr: "Acces", de: "Zugriff" }) },
        ...(generalSettings.billing_enabled
          ? [{ to: "/portal/billing", label: t({ en: "Billing", fr: "Facturation", de: "Abrechnung" }) }]
          : []),
        { to: "/portal/settings", label: t({ en: "Settings", fr: "Configuration", de: "Einstellungen" }) },
      ],
    },
  ];

  const topbarControlDescriptors: TopbarControlDescriptor[] = [
    {
      id: "account",
      icon: <AccountControlIcon className="h-4 w-4" />,
      selectedLabel: selectedPortalLabel,
      priority: 10,
      estimatedIconWidth: 36,
      estimatedLabelWidth: 220,
      renderControl: (mode) => (
        <AccountSelector triggerMode={mode} openInPortal widthClassName={mode === "icon" ? "w-9" : "w-56 lg:w-64"} />
      ),
    },
  ];

  return (
    <Layout
      headerTitle={t({ en: "Portal", fr: "Portail", de: "Portal" })}
      navSections={navSections}
      sidebarTitle="PORTAL"
      hideHeader
      topbarControlDescriptors={topbarControlDescriptors}
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

function AccountControlIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M3 10h18" />
      <circle cx="8.5" cy="14.2" r="1.1" strokeWidth={1.4} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M12 14.2h6" />
    </svg>
  );
}

function WarningIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m12 4 9 16H3l9-16Z" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M12 9v5.5" />
      <circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

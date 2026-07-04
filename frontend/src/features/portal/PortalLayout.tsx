/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, type ReactNode } from "react";
import Layout from "../../components/Layout";
import type { SidebarSection } from "../../components/Sidebar";
import { TopbarStaticControl } from "../../components/TopbarControlTrigger";
import TopbarDropdownSelect, { type TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
import type { TopbarControlDescriptor, TopbarControlRenderMode } from "../../components/topbarControlsLayout";
import {
  TOPBAR_CONTEXT_SELECTOR_ESTIMATED_LABEL_WIDTH,
  TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
} from "../../components/topbarControlWidths";
import { useI18n } from "../../i18n";
import { PortalAccountProvider, usePortalAccountContext } from "./PortalAccountContext";

function usePortalNavSections(): SidebarSection[] {
  const { t } = useI18n();
  return useMemo(
    () => [
      {
        label: t({ en: "Workspace", fr: "Espace de travail", de: "Arbeitsbereich" }),
        links: [
          { to: "/portal", label: t({ en: "Dashboard", fr: "Tableau de bord", de: "Dashboard" }), end: true, icon: <HomeIcon /> },
          { to: "/portal/storage-spaces", label: t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }), icon: <StorageIcon /> },
          { to: "/portal/replications", label: t({ en: "Replications", fr: "Réplications", de: "Replikationen" }), icon: <ReplicationIcon /> },
          { to: "/portal/shares", label: t({ en: "Shares", fr: "Partages", de: "Freigaben" }), icon: <ShareIcon /> },
          { to: "/portal/access-keys", label: t({ en: "Access keys", fr: "Clés d'accès", de: "Zugriffsschlüssel" }), icon: <KeyIcon /> },
          { to: "/portal/activity", label: t({ en: "Activity", fr: "Activité", de: "Aktivität" }), icon: <ActivityIcon /> },
          { to: "/portal/transfers", label: t({ en: "Transfers", fr: "Transferts", de: "Transfers" }), icon: <TransferIcon /> },
          { to: "/portal/usage", label: t({ en: "Usage & Analytics", fr: "Utilisation et analyses", de: "Nutzung und Analysen" }), icon: <ChartIcon /> },
          { to: "/portal/settings", label: t({ en: "Settings", fr: "Paramètres", de: "Einstellungen" }), icon: <SettingsIcon /> },
        ],
      },
    ],
    [t]
  );
}

function PortalAccountTopbarSelector({ mode }: { mode: TopbarControlRenderMode }) {
  const { t } = useI18n();
  const { projects, selectedProject, selectedAccountId, setSelectedAccountId, loading } = usePortalAccountContext();
  const selectedLabel = selectedProject
    ? selectedProject.name
    : loading
      ? t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })
      : t({ en: "No project selected", fr: "Aucun projet sélectionné", de: "Kein Projekt ausgewählt" });
  const options: TopbarDropdownOption[] = projects.map((project) => ({
    value: String(project.id),
    label: project.name,
    description: project.accounts.length === 1
      ? project.accounts[0]?.display_name
      : t({ en: `${project.accounts.length} storage locations`, fr: `${project.accounts.length} localisations de stockage`, de: `${project.accounts.length} Speicherstandorte` }),
    icon: <AccountControlIcon className="h-4 w-4" />,
  }));

  if (projects.length > 1) {
    return (
      <TopbarDropdownSelect
        value={selectedAccountId ?? ""}
        options={options}
        onChange={(value) => setSelectedAccountId(value || null)}
        ariaLabel={t({ en: "Select portal project", fr: "Sélectionner un projet Portal", de: "Portal-Projekt auswählen" })}
        triggerLabel={t({ en: "Project", fr: "Projet", de: "Projekt" })}
        placeholder={selectedLabel}
        widthClassName={mode === "icon" ? TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS : TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS}
        menuMinWidthClassName="min-w-[18rem]"
        icon={<AccountControlIcon className="h-4 w-4" />}
        disabled={loading}
        triggerMode={mode}
      />
    );
  }

  if (mode === "icon") {
    return (
      <TopbarStaticControl
        mode="icon"
        label={t({ en: "Project", fr: "Projet", de: "Projekt" })}
        value={selectedLabel}
        icon={<AccountControlIcon className="h-4 w-4" />}
        ariaLabel={t({ en: `Portal project ${selectedLabel}`, fr: `Projet Portal ${selectedLabel}`, de: `Portal-Projekt ${selectedLabel}` })}
        title={selectedLabel}
      />
    );
  }
  return (
    <TopbarStaticControl
      mode="icon_label"
      label={t({ en: "Project", fr: "Projet", de: "Projekt" })}
      value={selectedLabel}
      icon={<AccountControlIcon className="h-4 w-4" />}
      ariaLabel={t({ en: `Portal project ${selectedLabel}`, fr: `Projet Portal ${selectedLabel}`, de: `Portal-Projekt ${selectedLabel}` })}
      title={selectedLabel}
      className={TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS}
    />
  );
}

function PortalShell() {
  const { t } = useI18n();
  const portalNavSections = usePortalNavSections();
  const { selectedProject, loading } = usePortalAccountContext();
  const selectedLabel = selectedProject
    ? selectedProject.name
    : loading
      ? t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })
      : t({ en: "No project selected", fr: "Aucun projet sélectionné", de: "Kein Projekt ausgewählt" });
  const topbarControlDescriptors: TopbarControlDescriptor[] = [
    {
      id: "account",
      icon: <AccountControlIcon className="h-4 w-4" />,
      selectedLabel,
      priority: 10,
      estimatedIconWidth: 40,
      estimatedLabelWidth: TOPBAR_CONTEXT_SELECTOR_ESTIMATED_LABEL_WIDTH,
      renderControl: (mode) => <PortalAccountTopbarSelector mode={mode} />,
    },
  ];

  return (
    <Layout
      navSections={portalNavSections}
      headerTitle="Portal"
      sidebarTitle="PORTAL"
      hideHeader
      topbarControlDescriptors={topbarControlDescriptors}
    />
  );
}

export default function PortalLayout() {
  return (
    <PortalAccountProvider>
      <PortalShell />
    </PortalAccountProvider>
  );
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="h-4 w-4">
      {children}
    </svg>
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

function HomeIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 9.3 10 4l7 5.3V16H3V9.3Z" />
    </IconBase>
  );
}

function StorageIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3.5 6.2 10 3.5l6.5 2.7L10 9 3.5 6.2Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3.5 10 10 12.8 16.5 10M3.5 13.7 10 16.5l6.5-2.8" />
    </IconBase>
  );
}

function KeyIcon() {
  return (
    <IconBase>
      <circle cx="7.2" cy="10" r="3.2" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10.2 10h6.3m-2 0v2.4m-2.2-2.4v1.7" />
    </IconBase>
  );
}

function ShareIcon() {
  return (
    <IconBase>
      <circle cx="6" cy="10" r="2.2" strokeWidth={1.7} />
      <circle cx="14.5" cy="5.8" r="2" strokeWidth={1.7} />
      <circle cx="14.5" cy="14.2" r="2" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeWidth={1.7} d="m8 9 4.5-2.3M8 11l4.5 2.3" />
    </IconBase>
  );
}

function ReplicationIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 6.5h7.8c2 0 3.7 1.6 3.7 3.7v.3" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m14.2 4 2.7 2.7-2.7 2.7" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15 13.5H7.2c-2 0-3.7-1.6-3.7-3.7v-.3" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m5.8 16-2.7-2.7 2.7-2.7" />
    </IconBase>
  );
}

function ActivityIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 10h3l2-4 3.5 8L14 10h3" />
    </IconBase>
  );
}

function TransferIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 6h10m0 0-2.5-2.5M14 6 11.5 8.5M16 14H6m0 0 2.5-2.5M6 14l2.5 2.5" />
    </IconBase>
  );
}

function ChartIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 16V9m6 7V4m6 12v-5" />
    </IconBase>
  );
}

function SettingsIcon() {
  return (
    <IconBase>
      <path strokeLinecap="round" strokeWidth={1.7} d="M4 5.5h12M4 10h12M4 14.5h12" />
      <circle cx="7.2" cy="5.5" r="1.4" strokeWidth={1.7} />
      <circle cx="12.4" cy="10" r="1.4" strokeWidth={1.7} />
      <circle cx="9.5" cy="14.5" r="1.4" strokeWidth={1.7} />
    </IconBase>
  );
}

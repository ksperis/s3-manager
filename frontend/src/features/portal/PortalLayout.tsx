/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import Layout from "../../components/Layout";
import type { SidebarSection } from "../../components/Sidebar";
import { TopbarStaticControl } from "../../components/TopbarControlTrigger";
import TopbarDropdownSelect, { type TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
import type { TopbarControlDescriptor, TopbarControlRenderMode } from "../../components/topbarControlsLayout";
import {
  TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
} from "../../components/topbarControlWidths";
import { PortalAccountProvider, usePortalAccountContext } from "./PortalAccountContext";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";

const portalNavSections: SidebarSection[] = [
  {
    label: "Workspace",
    links: [
      { to: "/portal", label: "Dashboard", end: true, icon: <HomeIcon /> },
      { to: "/portal/storage-spaces", label: "Storage Spaces", icon: <StorageIcon /> },
      { to: "/portal/shares", label: "Shares", icon: <ShareIcon /> },
      { to: "/portal/access-keys", label: "Access keys", icon: <KeyIcon /> },
      { to: "/portal/activity", label: "Activity", icon: <ActivityIcon /> },
      { to: "/portal/transfers", label: "Transfers", icon: <TransferIcon /> },
      { to: "/portal/usage", label: "Usage & Analytics", icon: <ChartIcon /> },
      { to: "/portal/settings", label: "Settings", icon: <SettingsIcon /> },
    ],
  },
];

function PortalAccountTopbarSelector({ mode }: { mode: TopbarControlRenderMode }) {
  const { accounts, selectedAccount, selectedAccountId, setSelectedAccountId, loading } = usePortalAccountContext();
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const selectedLabel = selectedAccount
    ? formatAccountLabel(selectedAccount, defaultEndpointId, defaultEndpointName, false)
    : loading
      ? "Loading..."
      : "No account selected";
  const options: TopbarDropdownOption[] = accounts.map((account) => ({
    value: String(account.id),
    label: formatAccountLabel(account, defaultEndpointId, defaultEndpointName, false),
    icon: <AccountControlIcon className="h-4 w-4" />,
  }));

  if (accounts.length > 1) {
    return (
      <TopbarDropdownSelect
        value={selectedAccountId ?? ""}
        options={options}
        onChange={(value) => setSelectedAccountId(value || null)}
        ariaLabel="Select portal account"
        triggerLabel="Account"
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
        label="Account"
        value={selectedLabel}
        icon={<AccountControlIcon className="h-4 w-4" />}
        ariaLabel={`Portal account ${selectedLabel}`}
        title={selectedLabel}
      />
    );
  }
  return (
    <TopbarStaticControl
      mode="icon_label"
      label="Account"
      value={selectedLabel}
      icon={<AccountControlIcon className="h-4 w-4" />}
      ariaLabel={`Portal account ${selectedLabel}`}
      title={selectedLabel}
      className={TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS}
    />
  );
}

function PortalShell() {
  const { selectedAccount, loading } = usePortalAccountContext();
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const selectedLabel = selectedAccount
    ? formatAccountLabel(selectedAccount, defaultEndpointId, defaultEndpointName, false)
    : loading
      ? "Loading..."
      : "No account selected";
  const topbarControlDescriptors: TopbarControlDescriptor[] = [
    {
      id: "account",
      icon: <AccountControlIcon className="h-4 w-4" />,
      selectedLabel,
      priority: 10,
      estimatedIconWidth: 40,
      estimatedLabelWidth: 240,
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

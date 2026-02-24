/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import TopbarDropdownSelect, { TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
import { SidebarSection } from "../../components/Sidebar";
import PageBanner from "../../components/PageBanner";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { CephAdminEndpointProvider, useCephAdminEndpoint } from "./CephAdminEndpointContext";

function CephAdminShell() {
  const { generalSettings } = useGeneralSettings();
  const {
    endpoints,
    selectedEndpointId,
    setSelectedEndpointId,
    selectedEndpoint,
    selectedEndpointAccess,
    selectedEndpointAccessLoading,
    selectedEndpointAccessError,
    loading,
    error,
  } = useCephAdminEndpoint();
  const showSelector = endpoints.length > 1;
  const selectorEnabled = endpoints.length > 0;
  const endpointSelected = selectorEnabled && selectedEndpointId != null;
  const usageFeatureEnabled = selectedEndpoint?.capabilities?.metrics !== false;
  const trafficFeatureEnabled = selectedEndpoint?.capabilities?.usage !== false;
  const canAdmin = endpointSelected && !selectedEndpointAccessLoading && Boolean(selectedEndpointAccess?.can_admin);
  const canMetrics =
    endpointSelected &&
    !selectedEndpointAccessLoading &&
    Boolean(selectedEndpointAccess?.can_metrics) &&
    (usageFeatureEnabled || trafficFeatureEnabled);
  const canAccounts =
    endpointSelected &&
    !selectedEndpointAccessLoading &&
    canAdmin &&
    Boolean(selectedEndpointAccess?.can_accounts);
  const canBrowser =
    endpointSelected &&
    !selectedEndpointAccessLoading &&
    canAdmin &&
    generalSettings.browser_enabled &&
    generalSettings.browser_ceph_admin_enabled;
  const adminWarning = endpointSelected && !selectedEndpointAccessLoading ? selectedEndpointAccess?.admin_warning ?? null : null;

  const handleChange = (selectedValue: string) => {
    const next = Number(selectedValue);
    if (!Number.isFinite(next) || next <= 0) return;
    if (next === selectedEndpointId) return;
    setSelectedEndpointId(next);
  };

  const navSections: SidebarSection[] = [
    {
      label: "Overview",
      links: [
        { to: "/ceph-admin", label: "Dashboard", end: true },
        { to: "/ceph-admin/metrics", label: "Metrics", disabled: !canMetrics },
      ],
    },
    {
      label: "CEPH S3",
      links: [
        { to: "/ceph-admin/accounts", label: "RGW Accounts", disabled: !canAccounts },
        { to: "/ceph-admin/users", label: "RGW Users", disabled: !canAdmin },
        { to: "/ceph-admin/buckets", label: "Buckets", disabled: !canAdmin },
        { to: "/ceph-admin/browser", label: "Browser", disabled: !canBrowser },
      ],
    },
  ];

  const endpointOptions: TopbarDropdownOption[] = endpoints.map((endpoint) => ({
    value: String(endpoint.id),
    label: `${endpoint.name}${endpoint.is_default ? " · Default" : ""}`,
    description: endpoint.endpoint_url,
    title: endpoint.endpoint_url,
    icon: <EndpointItemIcon className="h-4 w-4" />,
  }));
  const pillClasses =
    "inline-flex h-9 items-center rounded-xl border border-slate-200/80 bg-white px-3 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

  const topbarContent = (
    <div className="flex items-center gap-3">
      <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Endpoint</span>
      {showSelector ? (
        <TopbarDropdownSelect
          value={selectedEndpointId ? String(selectedEndpointId) : ""}
          options={endpointOptions}
          onChange={handleChange}
          ariaLabel="Select Ceph endpoint"
          title={selectedEndpoint?.endpoint_url ?? undefined}
          widthClassName="w-80"
          icon={<EndpointIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />}
          disabled={!selectorEnabled || loading}
        />
      ) : (
        <div className={`${pillClasses} gap-2`}>
          <EndpointIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />
          <span>{selectedEndpoint ? selectedEndpoint.name : loading ? "Loading..." : "No endpoint selected"}</span>
        </div>
      )}
    </div>
  );

  return (
    <Layout navSections={navSections} sidebarTitle="CEPH ADMIN" hideHeader topbarContent={topbarContent}>
      <>
        {error && <PageBanner tone="warning" className="mb-4">{error}</PageBanner>}
        {selectedEndpointAccessError && <PageBanner tone="warning" className="mb-4">{selectedEndpointAccessError}</PageBanner>}
        {adminWarning && (
          <PageBanner tone="warning" className="mb-4">
            {adminWarning}
          </PageBanner>
        )}
        <Outlet />
      </>
    </Layout>
  );
}

export default function CephAdminLayout() {
  return (
    <CephAdminEndpointProvider>
      <CephAdminShell />
    </CephAdminEndpointProvider>
  );
}

function EndpointIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <ellipse cx="12" cy="6.5" rx="6.5" ry="2.7" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M5.5 6.5v5.5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V6.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M5.5 12v5.5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V12" />
    </svg>
  );
}

function EndpointItemIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

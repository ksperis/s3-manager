/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent } from "react";
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { SidebarSection } from "../../components/Sidebar";
import PageBanner from "../../components/PageBanner";
import { CephAdminEndpointProvider, useCephAdminEndpoint } from "./CephAdminEndpointContext";

function CephAdminShell() {
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
  const usageFeatureEnabled = selectedEndpoint?.capabilities?.usage !== false;
  const trafficFeatureEnabled = selectedEndpoint?.capabilities?.metrics !== false;
  const canAdmin = endpointSelected && !selectedEndpointAccessLoading && Boolean(selectedEndpointAccess?.can_admin);
  const canMetrics =
    endpointSelected &&
    !selectedEndpointAccessLoading &&
    Boolean(selectedEndpointAccess?.can_metrics) &&
    (usageFeatureEnabled || trafficFeatureEnabled);
  const adminWarning = endpointSelected && !selectedEndpointAccessLoading ? selectedEndpointAccess?.admin_warning ?? null : null;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = Number(event.target.value);
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
      label: "Ceph S3",
      links: [
        { to: "/ceph-admin/accounts", label: "RGW Accounts", disabled: !canAdmin },
        { to: "/ceph-admin/users", label: "RGW Users", disabled: !canAdmin },
        { to: "/ceph-admin/buckets", label: "Buckets", disabled: !canAdmin },
      ],
    },
  ];

  const selectClasses =
    "appearance-none rounded-full border border-slate-200 bg-white px-3 py-1.5 pr-8 ui-caption font-semibold text-slate-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900";

  const topbarContent = (
    <div className="flex items-center gap-3">
      <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Endpoint</span>
      {showSelector ? (
        <div className="relative">
          <select className={selectClasses} value={selectedEndpointId ?? ""} onChange={handleChange} disabled={!selectorEnabled || loading}>
            {!selectedEndpoint && <option value="">No endpoint selected</option>}
            {endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id} title={endpoint.endpoint_url}>
                {endpoint.name}
                {endpoint.is_default ? " · Default" : ""}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center ui-caption text-slate-500 dark:text-slate-300">
            ▼
          </div>
        </div>
      ) : (
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          {selectedEndpoint ? selectedEndpoint.name : loading ? "Loading..." : "No endpoint selected"}
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

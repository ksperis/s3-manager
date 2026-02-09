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
  const { endpoints, selectedEndpointId, setSelectedEndpointId, selectedEndpoint, loading, error } = useCephAdminEndpoint();
  const showSelector = endpoints.length > 1;
  const selectorEnabled = endpoints.length > 0;
  const workspaceBlocked = !loading && !selectorEnabled && Boolean(error);

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = Number(event.target.value);
    if (!Number.isFinite(next) || next <= 0) return;
    if (next === selectedEndpointId) return;
    setSelectedEndpointId(next);
  };

  const navSections: SidebarSection[] = [
    {
      label: "Overview",
      links: [{ to: "/ceph-admin", label: "Dashboard", end: true }],
    },
    {
      label: "Ceph S3",
      links: [
        { to: "/ceph-admin/accounts", label: "RGW Accounts", disabled: !selectorEnabled },
        { to: "/ceph-admin/users", label: "RGW Users", disabled: !selectorEnabled },
        { to: "/ceph-admin/buckets", label: "Buckets", disabled: !selectorEnabled },
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
        {workspaceBlocked ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            Ceph Admin pages are hidden until the dedicated credential is mapped to an RGW user with
            <code> --admin </code> or <code> --system </code> privileges.
          </div>
        ) : (
          <Outlet />
        )}
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

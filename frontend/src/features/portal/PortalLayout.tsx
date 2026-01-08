/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent, useMemo } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import Layout from "../../components/Layout";
import { SidebarSection } from "../../components/Sidebar";
import { PortalAccountProvider, usePortalAccountContext } from "./PortalAccountContext";

function Badge({ label, tone }: { label: string; tone: "slate" | "sky" | "emerald" | "amber" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100",
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold ${tones[tone]}`}>{label}</span>;
}

function AccountSelector() {
  const { accounts, selectedAccountId, setSelectedAccountId, selectedAccount, portalContext, loading, error } = usePortalAccountContext();
  const navigate = useNavigate();
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
        {selectedAccount ? selectedAccount.name : "Aucun compte"}
      </div>
    );
  }

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const raw = event.target.value || "";
    const value = raw ? Number(raw) : null;
    setSelectedAccountId(value);
    navigate("/portal");
  };

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <div className="relative">
        <select className={selectClasses} value={selectedAccountId ?? ""} onChange={handleChange}>
          {!selectedAccountId && <option value="">Select an account</option>}
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id} title={acc.storage_endpoint_url || undefined}>
              {acc.name} — {acc.portal_role} • {acc.access_mode === "external_enabled" ? "External enabled" : "Portal-only"} •{" "}
              {acc.integrated_mode === "sts" ? "STS" : "Presigned"}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center ui-caption text-slate-500 dark:text-slate-300">▼</div>
      </div>
      {portalContext && (
        <div className="flex flex-wrap items-center gap-1">
          <Badge label={portalContext.portal_role} tone="sky" />
          <Badge label={portalContext.external_enabled ? "External enabled" : "Portal-only"} tone="emerald" />
          <Badge label={portalContext.endpoint.sts_enabled ? "STS" : "Presigned"} tone="amber" />
        </div>
      )}
    </div>
  );
}

function AccountSelectionScreen() {
  const { accounts, setSelectedAccountId } = usePortalAccountContext();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <h1 className="ui-title font-semibold text-slate-900 dark:text-white">Select an account</h1>
        <p className="mt-1 ui-body text-slate-600 dark:text-slate-300">Your portal session is scoped to one account at a time.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            type="button"
            onClick={() => setSelectedAccountId(acc.id)}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-primary/60 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="ui-section font-semibold text-slate-900 dark:text-white">{acc.name}</div>
                <div className="mt-1 ui-caption text-slate-500 dark:text-slate-400">{acc.storage_endpoint_name ?? "Endpoint"}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge label={acc.portal_role} tone="sky" />
                <Badge label={acc.access_mode === "external_enabled" ? "External enabled" : "Portal-only"} tone="emerald" />
                <Badge label={acc.integrated_mode === "sts" ? "STS" : "Presigned"} tone="amber" />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PortalShell() {
  const { hasAccountContext, accounts, selectedAccountId, portalContext, contextLoading, contextError } = usePortalAccountContext();
  const location = useLocation();

  const permissions = portalContext?.permissions ?? [];
  const can = (perm: string) => permissions.includes(perm);

  const navSections: SidebarSection[] = useMemo(() => {
    const sections: SidebarSection[] = [];
    sections.push({
      label: "Portal",
      links: [
        { to: "/portal", label: "Dashboard", end: true, disabled: !can("portal.dashboard.view") },
        { to: "/portal/buckets", label: "Buckets", disabled: !can("portal.buckets.view") },
        { to: "/portal/browser", label: "Browser", disabled: !can("portal.browser.view") },
      ],
    });
    sections.push({
      label: "Access",
      links: [
        {
          to: "/portal/access",
          label: "External access",
          disabled: !can("portal.external.self.manage") && !can("portal.external.team.manage"),
        },
        { to: "/portal/users", label: "Users", disabled: !can("portal.members.view") },
      ],
    });
    sections.push({
      label: "Governance",
      links: [
        { to: "/portal/audit", label: "Audit", disabled: !can("portal.audit.view") },
        { to: "/portal/admin", label: "Admin", disabled: !can("portal.admin.view") },
      ],
    });
    return sections;
  }, [permissions]);

  const needsSelection = !selectedAccountId && accounts.length > 1;
  const showSelection = needsSelection && location.pathname === "/portal";
  if (showSelection) {
    return <AccountSelectionScreen />;
  }
  if (needsSelection) {
    return <Navigate to="/portal" replace />;
  }

  const topbarInline = (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account</span>
      <AccountSelector />
      {contextLoading && hasAccountContext && (
        <span className="ui-caption text-slate-500 dark:text-slate-300">Loading…</span>
      )}
      {contextError && (
        <span className="ui-caption font-semibold text-rose-600">{contextError}</span>
      )}
    </div>
  );

  return (
    <Layout
      navSections={navSections}
      sidebarTitle="PORTAL"
      hideHeader
      topbarContent={
        topbarInline
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

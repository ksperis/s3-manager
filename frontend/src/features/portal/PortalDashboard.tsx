/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { usePortalAccountContext } from "./PortalAccountContext";

function Badge({ label, tone }: { label: string; tone: "slate" | "sky" | "emerald" | "amber" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100",
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold ${tones[tone]}`}>{label}</span>;
}

export default function PortalDashboard() {
  const { selectedAccount, hasAccountContext, portalContext, loading, error, contextLoading, contextError } = usePortalAccountContext();

  if (loading) {
    return <PageBanner tone="info">Loading portal accounts…</PageBanner>;
  }

  if (error) {
    return <PageBanner tone="error">{error}</PageBanner>;
  }

  if (!hasAccountContext || !selectedAccount) {
    return (
      <div className="space-y-4">
        <PageHeader title="Portal" />
        <PageBanner tone="warning">No account selected. Select an account to start using the portal.</PageBanner>
      </div>
    );
  }

  if (contextLoading) {
    return <PageBanner tone="info">Loading portal context…</PageBanner>;
  }

  if (contextError) {
    return <PageBanner tone="error">{contextError}</PageBanner>;
  }

  if (!portalContext) {
    return <PageBanner tone="error">Portal context unavailable</PageBanner>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        inlineContent={
          <div className="flex flex-wrap items-center gap-2">
            <Badge label={portalContext.portal_role} tone="sky" />
            <Badge label={portalContext.external_enabled ? "External enabled" : "Portal-only"} tone="emerald" />
            <Badge label={portalContext.endpoint.sts_enabled ? "STS" : "Presigned"} tone="amber" />
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account</p>
          <p className="mt-1 ui-section font-semibold text-slate-900 dark:text-white">{selectedAccount.name}</p>
          <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
            Endpoint: {selectedAccount.storage_endpoint_name ?? "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Access</p>
          <p className="mt-1 ui-body text-slate-700 dark:text-slate-200">
            Integrated browsing is enabled in Basic Mode (list/upload/download/delete). Advanced features ship incrementally.
          </p>
        </div>
      </div>
    </div>
  );
}

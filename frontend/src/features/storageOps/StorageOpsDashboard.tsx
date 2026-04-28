/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { fetchStorageOpsSummary, type StorageOpsSummary } from "../../api/storageOps";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import WorkspaceNavCards from "../../components/WorkspaceNavCards";
import { uiCardClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";

const cards = [
  {
    title: "Buckets",
    description: "Cross-account, S3 user and cross-connection bucket listing, filtering and bulk operations.",
    to: "/storage-ops/buckets",
    eyebrow: "Next step",
  },
];

export default function StorageOpsDashboard() {
  const [summary, setSummary] = useState<StorageOpsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStorageOpsSummary()
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setSummaryError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSummary(null);
        setSummaryError(extractApiError(err, "Unable to load Storage Ops summary."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Storage Ops"
        description="Operations workspace for advanced S3 bucket administration across your authorized contexts."
        breadcrumbs={[{ label: "Storage Ops" }]}
      />
      {summaryError && <PageBanner tone="error">{summaryError}</PageBanner>}
      <section className={`${uiCardClass} px-4 py-4`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Managed contexts
            </p>
            <p className="mt-1.5 ui-title font-semibold text-slate-900 dark:text-white">
              {summary ? summary.total_contexts : "—"}
            </p>
          </div>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Accounts: {summary?.total_accounts ?? "—"} | S3 users: {summary?.total_s3_users ?? "—"} | Connections:{" "}
            {summary?.total_connections ?? "—"} | Shared: {summary?.total_shared_connections ?? "—"} | Private:{" "}
            {summary?.total_private_connections ?? "—"} | Endpoints: {summary?.total_endpoints ?? "—"}
          </p>
        </div>
      </section>
      <WorkspaceNavCards items={cards} />
    </div>
  );
}

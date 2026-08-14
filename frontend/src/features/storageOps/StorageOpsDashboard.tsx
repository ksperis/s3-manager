/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStorageOpsSummary, type StorageOpsSummary } from "../../api/storageOps";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import { storageOpsPageBreadcrumbs } from "./storageOpsBreadcrumbs";
import { cx, uiButtonBaseClass, uiButtonVariants, uiCardClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";

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
    <PageShell
      title="Storage Ops"
      description="Operations workspace for advanced S3 bucket administration across your authorized contexts."
      breadcrumbs={storageOpsPageBreadcrumbs("dashboard")}
    >
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
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Accounts: {summary?.total_accounts ?? "—"} | S3 users: {summary?.total_s3_users ?? "—"} | Connections:{" "}
              {summary?.total_connections ?? "—"} | Shared: {summary?.total_shared_connections ?? "—"} | Private:{" "}
              {summary?.total_private_connections ?? "—"} | Endpoints: {summary?.total_endpoints ?? "—"}
            </p>
            <Link
              to="/storage-ops/buckets"
              className={cx(uiButtonBaseClass, uiButtonVariants.primary, "px-3 py-1.5 text-xs")}
            >
              Open buckets
            </Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

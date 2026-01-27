/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import PageBanner from "../../components/PageBanner";
import StorageUsageCard from "../../components/StorageUsageCard";
import { ManagerStats } from "../../api/stats";
import { IamOverview } from "../../api/iamOverview";

type UsageOverviewProps = {
  accountName?: string;
  storage: { used?: number | null; quotaBytes?: number | null };
  objects: { used?: number | null; quota?: number | null };
  stats?: ManagerStats | null;
  statsError?: string | null;
  loading?: boolean;
  iamDisabled?: boolean;
  metricsDisabled?: boolean;
  iamOverview?: IamOverview | null;
  iamLoading?: boolean;
  iamError?: string | null;
};

export default function UsageOverview({
  accountName,
  storage,
  objects,
  stats,
  statsError,
  loading,
  iamDisabled,
  metricsDisabled,
  iamOverview,
  iamLoading,
  iamError,
}: UsageOverviewProps) {
  const iamTiles = [
    {
      label: "IAM users",
      value: iamOverview?.iam_users ?? stats?.total_iam_users ?? 0,
      to: "/manager/users",
    },
    {
      label: "Groups",
      value: iamOverview?.iam_groups ?? stats?.total_iam_groups ?? 0,
      to: "/manager/groups",
    },
    {
      label: "Roles",
      value: iamOverview?.iam_roles ?? stats?.total_iam_roles ?? 0,
      to: "/manager/roles",
    },
    {
      label: "Policies",
      value: iamOverview?.iam_policies ?? stats?.total_iam_policies ?? 0,
      to: "/manager/iam/policies",
    },
  ];

  const totalComposition = iamTiles.reduce((acc, item) => acc + (item.value ?? 0), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <StorageUsageCard
        accountName={accountName}
        storage={storage}
        objects={objects}
        bucketOverview={stats?.bucket_overview}
        loading={loading}
        metricsDisabled={metricsDisabled}
        errorMessage={metricsDisabled ? null : statsError}
      />

      <section
        className={`relative space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${iamDisabled ? "opacity-60" : ""}`}
        aria-disabled={iamDisabled}
      >
        <header className="space-y-1">
          <p className="ui-caption font-semibold uppercase tracking-wide text-primary">IAM resources</p>
          <h3 className="ui-section font-semibold text-slate-900 dark:text-slate-100">Inventory overview</h3>
        </header>

        {!iamDisabled && iamError && <PageBanner tone="error">{iamError}</PageBanner>}

        {iamDisabled && (
          <div className="absolute inset-0 flex cursor-not-allowed items-center justify-center rounded-xl bg-white/80 text-center ui-caption font-semibold text-slate-600 dark:bg-slate-900/70 dark:text-slate-200">
            IAM features are hidden for IAM-only credentials.
          </div>
        )}

        {!iamLoading && totalComposition === 0 && !iamDisabled && !iamError ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center ui-caption text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
            No IAM resources yet.
          </div>
        ) : null}

        {!iamDisabled && totalComposition > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {iamTiles.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="flex items-center gap-3 rounded-lg border border-slate-200/80 bg-white p-3 text-left shadow-sm transition hover:-translate-y-[1px] hover:border-primary hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 ui-caption font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  {item.label.slice(0, 1)}
                </div>
                <div className="flex-1">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.label}</p>
                  <p className="mt-1 ui-title font-semibold text-slate-900 dark:text-white">{Number(item.value ?? 0).toLocaleString()}</p>
                </div>
                <div className="ui-caption font-medium text-primary flex items-center gap-1 dark:text-primary-200">
                  <span>View</span>
                  <span aria-hidden>→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

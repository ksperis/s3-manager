/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import PageBanner from "../../components/PageBanner";
import StorageUsageCard from "../../components/StorageUsageCard";
import { cx, uiCardClass, uiCardMutedClass, uiLabelClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
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
  bucketCount?: number | null;
  bucketLoading?: boolean;
  bucketError?: string | null;
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
  bucketCount,
  bucketLoading,
  bucketError,
}: UsageOverviewProps) {
  const showStorageUsage = !metricsDisabled;
  const displayedBucketCount = bucketCount ?? stats?.total_buckets ?? null;
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
      {showStorageUsage && (
        <StorageUsageCard
          accountName={accountName}
          storage={storage}
          objects={objects}
          bucketOverview={stats?.bucket_overview}
          loading={loading}
          metricsDisabled={metricsDisabled}
          errorMessage={statsError}
        />
      )}

      <section className={cx(uiCardClass, "space-y-4 p-4")}>
        <header className="space-y-1">
          <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Buckets</p>
          <h3 className={cx("ui-section", uiTitleTextClass)}>Bucket overview</h3>
        </header>

        {bucketError && <PageBanner tone="error">{bucketError}</PageBanner>}

        <div className="grid gap-2">
          <Link
            to="/manager/buckets"
            className={cx(
              uiCardMutedClass,
              "flex items-center gap-3 p-3 text-left transition hover:-translate-y-[1px] hover:border-primary hover:shadow-[var(--shell-menu-shadow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:hover:border-primary-700/60"
            )}
          >
            <div className={cx("flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--ui-border)] bg-[var(--ui-surface)] ui-caption", uiTitleTextClass)}>
              B
            </div>
            <div className="flex-1">
              <p className={uiLabelClass}>Buckets</p>
              <p className={cx("mt-1 ui-title", uiTitleTextClass)}>
                {bucketLoading || displayedBucketCount == null ? "—" : Number(displayedBucketCount).toLocaleString()}
              </p>
            </div>
            <div className="ui-caption font-medium text-primary flex items-center gap-1 dark:text-primary-200">
              <span>View</span>
              <span aria-hidden>→</span>
            </div>
          </Link>
        </div>
      </section>

      {!iamDisabled && (
        <section className={cx(uiCardClass, "space-y-4 p-4")}>
          <header className="space-y-1">
            <p className="ui-caption font-semibold uppercase tracking-wide text-primary">IAM resources</p>
            <h3 className={cx("ui-section", uiTitleTextClass)}>Inventory overview</h3>
          </header>

          {iamError && <PageBanner tone="error">{iamError}</PageBanner>}

          {!iamLoading && totalComposition === 0 && !iamError ? (
            <div className={cx(uiCardMutedClass, "border-dashed px-3 py-4 text-center ui-caption", uiMutedTextClass)}>
              No IAM resources yet.
            </div>
          ) : null}

          {totalComposition > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {iamTiles.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className={cx(
                    uiCardMutedClass,
                    "flex items-center gap-3 p-3 text-left transition hover:-translate-y-[1px] hover:border-primary hover:shadow-[var(--shell-menu-shadow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:hover:border-primary-700/60"
                  )}
                >
                  <div className={cx("flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--ui-border)] bg-[var(--ui-surface)] ui-caption", uiTitleTextClass)}>
                    {item.label.slice(0, 1)}
                  </div>
                  <div className="flex-1">
                    <p className={uiLabelClass}>{item.label}</p>
                    <p className={cx("mt-1 ui-title", uiTitleTextClass)}>{Number(item.value ?? 0).toLocaleString()}</p>
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
      )}
    </div>
  );
}

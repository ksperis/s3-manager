/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { BucketOverview } from "../api/stats";
import { formatBytes, formatCompactNumber } from "../utils/format";
import PageBanner from "./PageBanner";
import UsageTile from "./UsageTile";

type QuotaProps = {
  used?: number | null;
  quotaBytes?: number | null;
};

type ObjectQuotaProps = {
  used?: number | null;
  quota?: number | null;
};

type StorageUsageCardProps = {
  accountName?: string;
  storage: QuotaProps;
  objects: ObjectQuotaProps;
  bucketOverview?: BucketOverview | null;
  loading?: boolean;
  metricsDisabled?: boolean;
  errorMessage?: string | null;
};

export default function StorageUsageCard({
  accountName,
  storage,
  objects,
  bucketOverview,
  loading,
  metricsDisabled,
  errorMessage,
}: StorageUsageCardProps) {
  const hasBucketStats = Boolean(bucketOverview && bucketOverview.bucket_count > 0);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="space-y-1">
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Storage Usage</p>
        <h3 className="ui-section font-semibold text-slate-900 dark:text-slate-100">
          {accountName ? `Storage usage for ${accountName}` : "S3Account storage usage"}
        </h3>
      </header>

      {metricsDisabled && <PageBanner tone="warning">Storage metrics are not available for these credentials.</PageBanner>}

      {!metricsDisabled && errorMessage && <PageBanner tone="error">{errorMessage}</PageBanner>}

      <div className="grid gap-2 sm:grid-cols-2">
        <UsageTile
          label="Storage"
          used={storage.used}
          quota={storage.quotaBytes}
          formatter={formatBytes}
          quotaFormatter={formatBytes}
          loading={loading}
          emptyHint="No storage quota defined."
        />
        <UsageTile
          label="Objects"
          used={objects.used}
          quota={objects.quota}
          formatter={formatCompactNumber}
          quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
          loading={loading}
          unitHint="objects"
          emptyHint="No object quota defined."
        />
      </div>

      {hasBucketStats && bucketOverview && !metricsDisabled && (
        <div className="grid gap-2 sm:grid-cols-3">
          <BucketStatCard
            label="Active buckets"
            value={`${bucketOverview.non_empty_buckets}/${bucketOverview.bucket_count}`}
            hint="With data"
          />
          <BucketStatCard label="Empty buckets" value={bucketOverview.empty_buckets.toString()} hint="No objects" />
          <BucketStatCard
            label="Average size"
            value={bucketOverview.avg_bucket_size_bytes ? formatBytes(bucketOverview.avg_bucket_size_bytes) : "—"}
            hint={
              bucketOverview.avg_objects_per_bucket
                ? `${formatCompactNumber(bucketOverview.avg_objects_per_bucket)} objects`
                : "Object count unavailable"
            }
          />
        </div>
      )}
    </section>
  );
}

type BucketStatProps = {
  label: string;
  value: string;
  hint?: string;
};

function BucketStatCard({ label, value, hint }: BucketStatProps) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1.5 ui-title font-semibold text-slate-900 dark:text-white">{value}</p>
      {hint && <p className="ui-caption text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

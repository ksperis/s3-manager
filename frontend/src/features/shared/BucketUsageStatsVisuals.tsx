/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  BucketUsageStatsAggregate,
  BucketUsageStatsDistributionEntry,
  BucketUsageStatsSnapshot,
} from "../../api/bucketUsageStats";
import { MetricsEmptyState, MetricsTile } from "../../components/MetricsCard";
import PageBanner from "../../components/PageBanner";
import { cx, uiCardClass, uiMutedTextClass } from "../../components/ui/styles";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import {
  formatUsageStatsDate,
  nonEmptyUsageStatsEntries,
  UsageStatsChartShell,
  UsageStatsDataTypeDonut,
  UsageStatsDistributionBars,
  UsageStatsEmptyChart,
  usageStatsChartColor,
} from "./BucketUsageStatsCharts";

type BucketUsageStatsVisualSource = BucketUsageStatsSnapshot | BucketUsageStatsAggregate;

type SummaryMetric = {
  label: string;
  value: string;
  hint?: string;
};

type BucketUsageStatsCompositionVisualsProps = {
  stats: BucketUsageStatsVisualSource;
  finalMetric: SummaryMetric;
  currentVsNoncurrentEmptyMessage?: string;
  showVersionListingWarning?: boolean;
};

type BucketUsageStatsDataTypesCardProps = {
  aggregate?: BucketUsageStatsAggregate | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
  "data-testid"?: string;
};

function SummaryMetricCard({ label, value, hint }: SummaryMetric) {
  return <MetricsTile label={label} value={value} hint={hint} />;
}

function usageStatsRatio(bytes: number, totalBytes: number): string {
  return totalBytes > 0 ? formatPercentage((bytes / totalBytes) * 100) : "Unavailable";
}

function topEntries(entries: BucketUsageStatsDistributionEntry[], limit = 5): BucketUsageStatsDistributionEntry[] {
  return [...entries].sort((left, right) => right.bytes - left.bytes).slice(0, limit);
}

export function BucketUsageStatsCompositionVisuals({
  stats,
  finalMetric,
  currentVsNoncurrentEmptyMessage = "Unavailable for fallback current-only scans.",
  showVersionListingWarning,
}: BucketUsageStatsCompositionVisualsProps) {
  const dataTypes = nonEmptyUsageStatsEntries(stats.data_type_distribution);
  const storageClasses = nonEmptyUsageStatsEntries(stats.storage_class_distribution);
  const sizeDistribution = stats.size_distribution ?? [];
  const ageDistribution = stats.age_distribution ?? [];
  const currentVsNoncurrent = stats.current_vs_noncurrent ?? [];
  const versionBytes = (stats.current_bytes ?? 0) + (stats.noncurrent_bytes ?? 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryMetricCard
          label="Logical bytes"
          value={formatBytes(stats.total_bytes)}
          hint={`${formatCompactNumber(stats.object_version_count)} version(s)`}
        />
        <SummaryMetricCard
          label="Current bytes"
          value={formatBytes(stats.current_bytes)}
          hint={usageStatsRatio(stats.current_bytes, versionBytes)}
        />
        <SummaryMetricCard
          label="Non-current bytes"
          value={formatBytes(stats.noncurrent_bytes)}
          hint={usageStatsRatio(stats.noncurrent_bytes, versionBytes)}
        />
        <SummaryMetricCard {...finalMetric} />
      </div>

      {showVersionListingWarning && (
        <PageBanner tone="warning">
          Version listing was unavailable. Current/non-current space distribution cannot be calculated from the fallback listing.
        </PageBanner>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <UsageStatsChartShell title="Data types" subtitle="Logical bytes by inferred object type">
          <UsageStatsDataTypeDonut entries={dataTypes} />
        </UsageStatsChartShell>
        <UsageStatsChartShell title="Current vs non-current" subtitle="Stored object-version bytes">
          {currentVsNoncurrent.length > 0 ? (
            <UsageStatsDataTypeDonut entries={currentVsNoncurrent} />
          ) : (
            <UsageStatsEmptyChart message={currentVsNoncurrentEmptyMessage} />
          )}
        </UsageStatsChartShell>
        <UsageStatsChartShell title="Storage classes" subtitle="Logical bytes by storage class">
          <UsageStatsDistributionBars entries={storageClasses} />
        </UsageStatsChartShell>
        <UsageStatsChartShell title="Object sizes" subtitle="Version count by object size">
          <UsageStatsDistributionBars entries={sizeDistribution} bytesAxis={false} />
        </UsageStatsChartShell>
        <UsageStatsChartShell title="Object age" subtitle="Version count by last modified date">
          <UsageStatsDistributionBars entries={ageDistribution} bytesAxis={false} />
        </UsageStatsChartShell>
      </div>
    </div>
  );
}

export function BucketUsageStatsDataTypesCard({
  aggregate,
  loading,
  error,
  className,
  "data-testid": dataTestId,
}: BucketUsageStatsDataTypesCardProps) {
  const rawEntries = nonEmptyUsageStatsEntries(aggregate?.data_type_distribution);
  const entries = topEntries(rawEntries, rawEntries.length);
  const topDataTypes = entries.slice(0, 4);
  const hasSnapshot = Boolean(aggregate && aggregate.buckets_with_snapshot > 0);
  const coverage = aggregate ? `${aggregate.buckets_with_snapshot} / ${aggregate.bucket_count} buckets covered` : "";
  const latest = aggregate?.newest_snapshot_at ? formatUsageStatsDate(aggregate.newest_snapshot_at) : null;

  return (
    <section className={cx(uiCardClass, "h-full p-4", className)} data-testid={dataTestId}>
      <div>
        <div className="min-w-0">
          <h2 className="ui-subtitle font-semibold text-[var(--ui-text)]">Data types</h2>
          <div className={cx("mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 ui-caption", uiMutedTextClass)}>
            <span>{latest ? `Latest ${latest}` : "Latest bucket snapshots"}</span>
            {aggregate && <span>{coverage}</span>}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-3">
          <PageBanner tone="warning">{error}</PageBanner>
        </div>
      ) : loading && !aggregate ? (
        <div className="mt-3 h-36 animate-pulse rounded-md bg-[var(--ui-surface-muted)]" />
      ) : !hasSnapshot ? (
        <MetricsEmptyState className="mt-3 py-6 ui-caption">No usage stats snapshot yet.</MetricsEmptyState>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-[128px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[128px_minmax(0,1fr)]">
          <div className="h-32 min-w-0">
            <UsageStatsDataTypeDonut entries={entries} height={128} legendWidth={0} />
          </div>
          <div className="min-w-0 divide-y divide-[color:var(--ui-border-soft)]">
            {topDataTypes.map((entry, index) => (
              <div key={entry.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    data-testid={`manager-dashboard-data-type-color-${entry.key}`}
                    style={{ backgroundColor: usageStatsChartColor(index) }}
                  />
                  <span className="truncate ui-caption font-semibold text-[var(--ui-text)]" title={entry.label}>
                    {entry.label}
                  </span>
                </span>
                <span className={cx("shrink-0 ui-caption font-semibold", uiMutedTextClass)}>
                  {formatPercentage(entry.ratio_bytes * 100)}
                </span>
                <span className={cx("col-span-2 truncate ui-caption", uiMutedTextClass)}>{formatBytes(entry.bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

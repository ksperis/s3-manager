/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BucketUsageStatsAggregate } from "../../api/bucketUsageStats";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import PageBanner from "../../components/PageBanner";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { formatUsageStatsDate } from "./BucketUsageStatsCharts";
import { BucketUsageStatsCompositionVisuals } from "./BucketUsageStatsVisuals";

type BucketUsageStatsAggregateCardProps = {
  title: string;
  description: string;
  aggregate?: BucketUsageStatsAggregate | null;
  loading?: boolean;
  error?: string | null;
  recalculating?: boolean;
  recalculateLabel: string;
  onRecalculate?: () => void;
  className?: string;
};

export default function BucketUsageStatsAggregateCard({
  title,
  description,
  aggregate,
  loading,
  error,
  recalculating,
  recalculateLabel,
  onRecalculate,
  className,
}: BucketUsageStatsAggregateCardProps) {
  const hasSnapshot = Boolean(aggregate && aggregate.buckets_with_snapshot > 0);
  const coverageLabel = aggregate ? `${aggregate.buckets_with_snapshot} / ${aggregate.bucket_count} buckets covered` : "";
  const lastCalculated = aggregate?.newest_snapshot_at ? `Latest ${formatUsageStatsDate(aggregate.newest_snapshot_at)}` : undefined;
  const accountCoverage =
    aggregate?.managed_account_count != null
      ? `${aggregate.accounts_with_listed_buckets ?? 0} / ${aggregate.managed_account_count} managed accounts listed`
      : undefined;
  const coverageHint = accountCoverage ? `${accountCoverage}${lastCalculated ? ` · ${lastCalculated}` : ""}` : lastCalculated;

  return (
    <MetricsCard
      title={title}
      description={description}
      className={className}
      actions={
        onRecalculate ? (
          <button
            type="button"
            onClick={onRecalculate}
            disabled={loading || recalculating}
            className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "shrink-0")}
          >
            {recalculating ? "Calculating..." : recalculateLabel}
          </button>
        ) : null
      }
    >

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {loading && !aggregate ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="h-14 animate-pulse rounded-md bg-[var(--ui-surface-muted)]" />
          ))}
        </div>
      ) : !aggregate || !hasSnapshot ? (
        <MetricsEmptyState>
          <span className={cx("block font-semibold", uiTitleTextClass)}>No usage stats calculated yet.</span>
          <span className={cx("block ui-caption", uiMutedTextClass)}>
            {aggregate?.bucket_count ? `0 / ${aggregate.bucket_count} buckets covered.` : "Run a calculation to create the first snapshot."}
          </span>
        </MetricsEmptyState>
      ) : (
        <>
          {aggregate.warnings.map((warning) => (
            <PageBanner key={warning} tone="warning">{warning}</PageBanner>
          ))}

          <BucketUsageStatsCompositionVisuals
            stats={aggregate}
            finalMetric={{ label: "Coverage", value: coverageLabel, hint: coverageHint }}
            currentVsNoncurrentEmptyMessage="Current/non-current unavailable."
          />
        </>
      )}
    </MetricsCard>
  );
}

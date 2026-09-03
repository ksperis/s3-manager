/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BucketUsageStatsSnapshot } from "../../api/bucketUsageStats";
import { MetricsCard, MetricsEmptyState } from "../../components/MetricsCard";
import PageBanner from "../../components/PageBanner";
import { cx, uiButtonBaseClass, uiButtonVariants } from "../../components/ui/styles";
import { formatCompactNumber } from "../../utils/format";
import { formatLocalDateTime } from "../../utils/dateTime";
import { BucketUsageStatsCompositionVisuals } from "./BucketUsageStatsVisuals";

type BucketUsageStatsPanelProps = {
  snapshot?: BucketUsageStatsSnapshot | null;
  loading?: boolean;
  error?: string | null;
  recalculating?: boolean;
  onRefresh?: () => void;
  onRecalculate?: () => void;
};

export default function BucketUsageStatsPanel({
  snapshot,
  loading,
  error,
  recalculating,
  onRefresh,
  onRecalculate,
}: BucketUsageStatsPanelProps) {
  return (
    <MetricsCard
      title="Usage stats"
      description="Latest persisted calculation from object listings. Space ratios use logical object-version bytes."
      actions={
        <>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || recalculating}
              className={cx(uiButtonBaseClass, uiButtonVariants.secondary)}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          )}
          {onRecalculate && (
            <button
              type="button"
              onClick={onRecalculate}
              disabled={recalculating}
              className={cx(uiButtonBaseClass, uiButtonVariants.primary)}
            >
              {recalculating ? "Calculating..." : "Recalculate"}
            </button>
          )}
        </>
      }
    >

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {snapshot?.warnings?.map((warning) => (
        <PageBanner key={warning} tone="warning">{warning}</PageBanner>
      ))}

      {loading && !snapshot ? (
        <div className="grid gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="h-20 animate-pulse rounded-lg bg-[var(--ui-surface-muted)]" />
          ))}
        </div>
      ) : !snapshot ? (
        <MetricsEmptyState>
          <span className="block font-semibold text-[var(--ui-text)]">No usage stats calculated yet.</span>
          <span className="block ui-caption">Run a calculation to persist the latest bucket snapshot.</span>
        </MetricsEmptyState>
      ) : (
        <BucketUsageStatsCompositionVisuals
          stats={snapshot}
          finalMetric={{
            label: "Delete markers",
            value: formatCompactNumber(snapshot.delete_marker_count),
            hint: `Calculated ${formatLocalDateTime(snapshot.calculated_at)}`,
          }}
          showVersionListingWarning={!snapshot.version_listing_available}
        />
      )}
    </MetricsCard>
  );
}

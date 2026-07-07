/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import { type Bucket, listBuckets } from "../../api/buckets";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import UiButton from "../../components/ui/UiButton";
import { extractApiError } from "../../utils/apiError";
import BucketPurgeRunModal from "../shared/BucketPurgeRunModal";
import ManagerBucketSelectionPanel from "./ManagerBucketSelectionPanel";
import { useS3AccountContext } from "./S3AccountContext";

export default function ManagerBucketPurgePage() {
  const { accounts, selectedS3AccountId, requiresS3AccountSelection } = useS3AccountContext();
  const sourceContextId = selectedS3AccountId ?? "";
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());
  const [showPurgeModal, setShowPurgeModal] = useState(false);

  const sourceContext = useMemo(
    () => accounts.find((context) => context.id === sourceContextId) ?? null,
    [accounts, sourceContextId]
  );

  useEffect(() => {
    if (!sourceContextId) {
      setBuckets([]);
      setSelectedBuckets(new Set());
      return;
    }
    let canceled = false;
    setLoading(true);
    setError(null);
    listBuckets(sourceContextId, { with_stats: false })
      .then((items) => {
        if (canceled) return;
        const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
        setBuckets(sorted);
        setSelectedBuckets((current) => {
          const availableNames = new Set(sorted.map((bucket) => bucket.name));
          return new Set([...current].filter((bucketName) => availableNames.has(bucketName)));
        });
      })
      .catch((err) => {
        if (canceled) return;
        setError(extractApiError(err, "Unable to load buckets."));
        setBuckets([]);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [sourceContextId]);

  const filteredBuckets = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return buckets;
    return buckets.filter((bucket) => bucket.name.toLowerCase().includes(needle));
  }, [buckets, filter]);

  const selectedBucketList = useMemo(() => {
    return [...selectedBuckets].sort((a, b) => a.localeCompare(b));
  }, [selectedBuckets]);

  const selectedTargets = useMemo(
    () =>
      selectedBucketList.map((bucketName) => ({
        bucketName,
        contextId: sourceContextId,
        contextName: sourceContext?.display_name ?? sourceContextId,
      })),
    [selectedBucketList, sourceContext?.display_name, sourceContextId]
  );

  const toggleBucket = (bucketName: string) => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      if (next.has(bucketName)) {
        next.delete(bucketName);
      } else {
        next.add(bucketName);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      filteredBuckets.forEach((bucket) => next.add(bucket.name));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedBuckets(new Set());
  };

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredBuckets.length,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bucket purge"
        description="Empty selected buckets without deleting bucket configuration."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Purge" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!requiresS3AccountSelection ? (
        <PageEmptyState
          title="Bucket purge is unavailable in session mode"
          description="This tool needs a persistent execution context so the selected buckets can be purged with the same manager identity."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title="Select a context before purging buckets"
          description="Choose a manager execution context to load its buckets and launch a purge."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ManagerBucketSelectionPanel
          description={`${sourceContext ? sourceContext.display_name : "Source context"} - Select buckets to purge.`}
          filter={filter}
          filterPlaceholder="Filter buckets"
          onFilterChange={setFilter}
          buckets={filteredBuckets}
          selectedBuckets={selectedBuckets}
          onToggleBucket={toggleBucket}
          onSelectFiltered={selectAllFiltered}
          onClearSelection={clearSelection}
          tableStatus={tableStatus}
          loadingMessage="Loading buckets..."
          errorMessage="Unable to load buckets."
          emptyMessage="No buckets."
          action={
            <UiButton
              type="button"
              onClick={() => setShowPurgeModal(true)}
              disabled={selectedBuckets.size === 0 || loading}
              variant="danger"
              size="sm"
            >
              Purge selected ({selectedBuckets.size})
            </UiButton>
          }
        />
      )}

      {showPurgeModal && sourceContextId && selectedTargets.length > 0 && (
        <BucketPurgeRunModal
          mode="manager"
          contextId={sourceContextId}
          contextName={sourceContext?.display_name ?? sourceContextId}
          targets={selectedTargets}
          onClose={() => setShowPurgeModal(false)}
        />
      )}
    </div>
  );
}
